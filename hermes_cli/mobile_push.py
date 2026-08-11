"""Profile-local Web Push subscriptions and durable opaque delivery workers.

Notification content and Web Push work are stored in one SQLite database so a
notification row and its per-device delivery jobs commit atomically. Delivery
runs outside request and gateway paths through a bounded leased queue.
"""
from __future__ import annotations

from contextlib import closing
import ipaddress
from pathlib import Path
import json
import re
import secrets
import socket
import sqlite3
import threading
import time
from typing import Any, Callable
from urllib.parse import urlparse

from hermes_cli.mobile_notifications import _connect as _notification_connect

try:  # Optional: deployments without Web Push must continue to start normally.
    from pywebpush import webpush
except ImportError:  # pragma: no cover - injected transports cover queue behavior
    webpush = None

CATEGORIES = frozenset({"info", "success", "warning", "error"})
MAX_BATCH_SIZE = 25
MAX_ATTEMPTS = 5
LEASE_SECONDS = 60.0
_RETRY_DELAYS = (5.0, 30.0, 120.0, 600.0, 1800.0)
_worker_guard = threading.Lock()
_running_workers: set[str] = set()
_PUSH_HOSTS = frozenset({"fcm.googleapis.com", "web.push.apple.com"})
_PUSH_HOST_SUFFIXES = (".push.services.mozilla.com", ".notify.windows.com")
DNS_RESOLUTION_TIMEOUT = 3.0
NETWORK_TIMEOUT = (3.05, 10.0)
_DNS_RESOLUTION_SLOTS = threading.BoundedSemaphore(4)


def _resolve_host_addresses(host: str) -> list[str]:
    if not _DNS_RESOLUTION_SLOTS.acquire(timeout=0.1):
        raise OSError("Web Push DNS resolver is saturated")
    outcome: dict[str, Any] = {}

    def resolve() -> None:
        try:
            outcome["addresses"] = sorted({
                str(item[4][0])
                for item in socket.getaddrinfo(host, 443, type=socket.SOCK_STREAM)
            })
        except BaseException as exc:
            outcome["error"] = exc
        finally:
            _DNS_RESOLUTION_SLOTS.release()

    thread = threading.Thread(target=resolve, name="mobile-push-dns", daemon=True)
    thread.start()
    thread.join(DNS_RESOLUTION_TIMEOUT)
    if thread.is_alive():
        raise OSError("Web Push DNS resolution timed out")
    error = outcome.get("error")
    if error is not None:
        raise OSError("Web Push DNS resolution failed") from error
    return list(outcome.get("addresses", []))


def validate_push_endpoint(endpoint: str) -> None:
    """Reject non-provider and non-public destinations at persistence and send time."""
    parsed = urlparse(endpoint)
    host = (parsed.hostname or "").rstrip(".").lower()
    if (
        parsed.scheme != "https" or not host or parsed.username or parsed.password
        or parsed.fragment or parsed.port not in {None, 443} or len(endpoint) > 2048
    ):
        raise ValueError("invalid Web Push endpoint")
    if host not in _PUSH_HOSTS and not any(host.endswith(suffix) for suffix in _PUSH_HOST_SUFFIXES):
        raise ValueError("Web Push endpoint is not a supported public push service")
    try:
        addresses = _resolve_host_addresses(host)
    except OSError as exc:
        raise ValueError("Web Push endpoint host could not be resolved") from exc
    if not addresses:
        raise ValueError("Web Push endpoint host could not be resolved")
    for value in addresses:
        address = ipaddress.ip_address(value)
        mapped = getattr(address, "ipv4_mapped", None)
        if not address.is_global or (mapped is not None and not mapped.is_global):
            raise ValueError("Web Push endpoint must resolve only to public addresses")


def push_settings(config: dict[str, Any]) -> tuple[bool, str]:
    mobile = config.get("mobile") if isinstance(config, dict) else None
    push = mobile.get("push") if isinstance(mobile, dict) else None
    enabled = isinstance(push, dict) and push.get("enabled") is True
    subject = push.get("vapid_subject") if isinstance(push, dict) else None
    if not isinstance(subject, str) or not subject.strip():
        subject = "mailto:admin@localhost"
    return enabled, subject.strip()


def is_transport_available() -> bool:
    return webpush is not None


def ensure_vapid_keypair(home: Path) -> str:
    """Create or load the active Hermes home's VAPID keypair with a 0600 private key."""
    import base64
    import os
    from cryptography.hazmat.primitives import serialization
    from cryptography.hazmat.primitives.asymmetric import ec

    secrets_dir = home / "secrets"
    secrets_dir.mkdir(parents=True, exist_ok=True, mode=0o700)
    try:
        secrets_dir.chmod(0o700)
    except OSError:
        pass
    private_path = secrets_dir / "mobile-web-push-vapid-private.pem"
    public_path = home / "mobile-web-push-vapid-public.txt"

    if private_path.exists():
        private_path.chmod(0o600)
        private_key = serialization.load_pem_private_key(private_path.read_bytes(), password=None)
    else:
        generated = ec.generate_private_key(ec.SECP256R1())
        encoded = generated.private_bytes(
            serialization.Encoding.PEM,
            serialization.PrivateFormat.PKCS8,
            serialization.NoEncryption(),
        )
        try:
            descriptor = os.open(private_path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        except FileExistsError:
            private_path.chmod(0o600)
            private_key = serialization.load_pem_private_key(private_path.read_bytes(), password=None)
        else:
            with os.fdopen(descriptor, "wb") as handle:
                handle.write(encoded)
                handle.flush()
                os.fsync(handle.fileno())
            private_key = generated

    if not isinstance(private_key, ec.EllipticCurvePrivateKey) or not isinstance(private_key.curve, ec.SECP256R1):
        raise ValueError("Web Push VAPID private key must use P-256")
    public_bytes = private_key.public_key().public_bytes(
        serialization.Encoding.X962,
        serialization.PublicFormat.UncompressedPoint,
    )
    public_key = base64.urlsafe_b64encode(public_bytes).rstrip(b"=").decode("ascii")
    temporary = public_path.with_name(f".{public_path.name}.{secrets.token_hex(6)}.tmp")
    temporary.write_text(f"{public_key}\n", encoding="ascii")
    temporary.chmod(0o644)
    temporary.replace(public_path)
    return public_key


def read_vapid_public_key(home: Path) -> str | None:
    path = home / "mobile-web-push-vapid-public.txt"
    try:
        value = path.read_text(encoding="ascii").strip()
    except (OSError, UnicodeError):
        return None
    return value if len(value) == 87 and all(char.isalnum() or char in "_-" for char in value) else None


def _read_vapid_private_key(home: Path) -> str | None:
    path = home / "secrets" / "mobile-web-push-vapid-private.pem"
    try:
        if path.stat().st_mode & 0o777 != 0o600:
            return None
        return path.read_text(encoding="ascii")
    except (OSError, UnicodeError):
        return None


def _connect(home: Path) -> sqlite3.Connection:
    return _notification_connect(home)


def get_subscription(home: Path, device_id: str) -> dict[str, Any] | None:
    with closing(_connect(home)) as conn:
        row = conn.execute(
            "SELECT device_id, categories FROM mobile_push_devices WHERE device_id = ?",
            (device_id,),
        ).fetchone()
    return None if row is None else {"device_id": row["device_id"], "categories": row["categories"].split(",")}


def list_subscriptions(home: Path) -> list[dict[str, Any]]:
    with closing(_connect(home)) as conn:
        rows = conn.execute(
            """SELECT device_id, categories, created_at, last_seen_at, failure_count
               FROM mobile_push_devices ORDER BY created_at"""
        ).fetchall()
    return [{**dict(row), "categories": row["categories"].split(",")} for row in rows]


def upsert_subscription(
    home: Path,
    *,
    device_id: str,
    endpoint: str,
    p256dh: str,
    auth: str,
    categories: list[str],
) -> None:
    normalized = sorted(set(categories))
    if not normalized or any(category not in CATEGORIES for category in normalized):
        raise ValueError("unsupported push category")
    if not re.fullmatch(r"[A-Za-z0-9_-]{12,128}", device_id):
        raise ValueError("invalid Web Push device ID")
    if not re.fullmatch(r"[A-Za-z0-9_-]{87}", p256dh) or not re.fullmatch(r"[A-Za-z0-9_-]{22}", auth):
        raise ValueError("invalid Web Push key material")
    validate_push_endpoint(endpoint)
    now = time.time()
    with closing(_connect(home)) as conn:
        conn.execute("BEGIN IMMEDIATE")
        by_device = conn.execute(
            "SELECT id FROM mobile_push_devices WHERE device_id = ?", (device_id,)
        ).fetchone()
        by_endpoint = conn.execute(
            "SELECT id FROM mobile_push_devices WHERE endpoint = ?", (endpoint,)
        ).fetchone()
        if by_endpoint is not None and by_device is not None and by_endpoint["id"] != by_device["id"]:
            # The browser endpoint is the durable identity after local storage loss.
            # Remove the stale new-device row before adopting its ID atomically.
            conn.execute("DELETE FROM mobile_push_devices WHERE id = ?", (by_device["id"],))
            target_id = by_endpoint["id"]
        elif by_endpoint is not None:
            target_id = by_endpoint["id"]
        elif by_device is not None:
            target_id = by_device["id"]
        else:
            target_id = None
        if target_id is None:
            conn.execute(
                """INSERT INTO mobile_push_devices
                   (id, device_id, endpoint, p256dh, auth, categories, created_at, last_seen_at)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
                (
                    secrets.token_urlsafe(18), device_id, endpoint, p256dh, auth,
                    ",".join(normalized), now, now,
                ),
            )
        else:
            conn.execute(
                """UPDATE mobile_push_devices
                   SET device_id=?, endpoint=?, p256dh=?, auth=?, categories=?,
                       last_seen_at=?, failure_count=0, last_failure_at=NULL
                   WHERE id=?""",
                (device_id, endpoint, p256dh, auth, ",".join(normalized), now, target_id),
            )
        conn.commit()


def remove_subscription(home: Path, *, device_id: str) -> bool:
    with closing(_connect(home)) as conn:
        removed = conn.execute(
            "DELETE FROM mobile_push_devices WHERE device_id = ?", (device_id,)
        ).rowcount
        conn.commit()
    return bool(removed)


def make_pywebpush_sender(
    secret_getter: Callable[[str, str | None], str | None],
    *,
    home: Path | None = None,
    subject: str = "mailto:admin@localhost",
) -> Callable[..., None]:
    """Create a short-lived sender without persisting or returning private VAPID material."""
    if webpush is None:
        raise RuntimeError("Web Push transport is unavailable")
    private_key = secret_getter("HERMES_MOBILE_WEB_PUSH_VAPID_PRIVATE_KEY", None)
    if not private_key and home is not None:
        private_key = _read_vapid_private_key(home)
    if not private_key:
        raise RuntimeError("Web Push transport is not configured")
    parsed_subject = urlparse(subject)
    if not (
        (parsed_subject.scheme == "mailto" and bool(parsed_subject.path))
        or (parsed_subject.scheme == "https" and bool(parsed_subject.hostname))
    ):
        raise ValueError("Web Push VAPID subject must be a mailto: or HTTPS contact")
    import requests
    requests_session = requests.Session()
    requests_session.max_redirects = 0
    requests_session.trust_env = False

    def send(
        subscription: dict[str, Any],
        payload: dict[str, Any],
        *,
        ttl: int,
        urgency: str,
    ) -> None:
        validate_push_endpoint(str(subscription["endpoint"]))
        webpush(
            subscription_info={
                "endpoint": subscription["endpoint"],
                "keys": {"p256dh": subscription["p256dh"], "auth": subscription["auth"]},
            },
            data=json.dumps(payload, separators=(",", ":")),
            vapid_private_key=private_key,
            vapid_claims={"sub": subject},
            requests_session=requests_session,
            ttl=ttl,
            headers={"Urgency": urgency},
            timeout=NETWORK_TIMEOUT,
        )

    return send


def opaque_payload(
    _notification_id: str,
    _category: str,
    _profile_hint: str,
    _target: str | None = None,
) -> dict[str, int]:
    """Return a versioned wake-up only; details require authenticated foreground retrieval."""
    return {"v": 1}


def list_delivery_jobs(home: Path) -> list[dict[str, Any]]:
    """Return queue metadata without subscription secrets or notification content."""
    with closing(_connect(home)) as conn:
        rows = conn.execute(
            """SELECT id, notification_id, category, profile, state, attempt_count,
                      next_attempt_at, lease_until, created_at, updated_at
               FROM mobile_push_deliveries ORDER BY created_at, id"""
        ).fetchall()
    return [dict(row) for row in rows]


def lease_delivery_jobs(
    home: Path,
    *,
    now: float | None = None,
    lease_seconds: float = LEASE_SECONDS,
    limit: int = MAX_BATCH_SIZE,
) -> list[dict[str, Any]]:
    """Atomically lease due jobs, including jobs abandoned by a crashed worker."""
    current = time.time() if now is None else now
    bounded_limit = max(1, min(int(limit), MAX_BATCH_SIZE))
    with closing(_connect(home)) as conn:
        conn.execute("BEGIN IMMEDIATE")
        rows = conn.execute(
            """SELECT id FROM mobile_push_deliveries
               WHERE ((state IN ('pending', 'retry') AND next_attempt_at <= ?)
                      OR (state = 'leased' AND lease_until <= ?))
               ORDER BY next_attempt_at, created_at
               LIMIT ?""",
            (current, current, bounded_limit),
        ).fetchall()
        ids = [row["id"] for row in rows]
        lease_until = current + lease_seconds
        for job_id in ids:
            conn.execute(
                """UPDATE mobile_push_deliveries
                   SET state='leased', lease_until=?, updated_at=? WHERE id=?""",
                (lease_until, current, job_id),
            )
        leased: list[dict[str, Any]] = []
        for job_id in ids:
            row = conn.execute(
                """SELECT d.*, s.endpoint, s.p256dh, s.auth, s.device_id, n.target
                   FROM mobile_push_deliveries d
                   JOIN mobile_push_devices s ON s.id=d.subscription_id
                   JOIN mobile_notifications n ON n.id=d.notification_id
                   WHERE d.id=?""",
                (job_id,),
            ).fetchone()
            if row is not None:
                leased.append(dict(row))
        conn.commit()
    return leased


def _status_code(exc: Exception) -> int | None:
    direct = getattr(exc, "status_code", None)
    if isinstance(direct, int):
        return direct
    response = getattr(exc, "response", None)
    nested = getattr(response, "status_code", None)
    return nested if isinstance(nested, int) else None


def _finish_job(
    home: Path,
    job: dict[str, Any],
    *,
    outcome: str,
    now: float,
) -> None:
    with closing(_connect(home)) as conn:
        if outcome == "sent":
            conn.execute(
                """UPDATE mobile_push_deliveries
                   SET state='sent', lease_until=NULL, updated_at=? WHERE id=? AND state='leased'""",
                (now, job["id"]),
            )
            conn.execute(
                """UPDATE mobile_push_devices
                   SET failure_count=0, last_seen_at=? WHERE id=?""",
                (now, job["subscription_id"]),
            )
        elif outcome == "gone":
            conn.execute("DELETE FROM mobile_push_devices WHERE id=?", (job["subscription_id"],))
        else:
            next_attempt = int(job["attempt_count"]) + 1
            retry = outcome == "retry" and next_attempt < MAX_ATTEMPTS
            if retry:
                delay = _RETRY_DELAYS[min(next_attempt - 1, len(_RETRY_DELAYS) - 1)]
                conn.execute(
                    """UPDATE mobile_push_deliveries
                       SET state='retry', attempt_count=?, next_attempt_at=?,
                           lease_until=NULL, updated_at=? WHERE id=? AND state='leased'""",
                    (next_attempt, now + delay, now, job["id"]),
                )
            else:
                conn.execute(
                    """UPDATE mobile_push_deliveries
                       SET state='failed', attempt_count=?, lease_until=NULL,
                           updated_at=? WHERE id=? AND state='leased'""",
                    (next_attempt, now, job["id"]),
                )
            conn.execute(
                """UPDATE mobile_push_devices
                   SET failure_count=MIN(failure_count + 1, ?), last_failure_at=? WHERE id=?""",
                (MAX_ATTEMPTS, now, job["subscription_id"]),
            )
        # Terminal receipts preserve notification+subscription dedupe while old
        # receipts are bounded so the database cannot grow forever.
        conn.execute(
            """DELETE FROM mobile_push_deliveries WHERE id IN (
                 SELECT id FROM mobile_push_deliveries
                 WHERE state IN ('sent', 'failed') AND updated_at < ?
                 ORDER BY updated_at LIMIT 250
               )""",
            (now - 30 * 24 * 60 * 60,),
        )
        conn.commit()


def process_delivery_batch(
    home: Path,
    *,
    send: Callable[..., None],
    now: float | None = None,
    limit: int = MAX_BATCH_SIZE,
) -> dict[str, int]:
    """Process a bounded batch while leasing only the job currently on the network."""
    stats = {"failed": 0, "gone": 0, "retried": 0, "sent": 0}
    bounded_limit = max(1, min(int(limit), MAX_BATCH_SIZE))
    for _ in range(bounded_limit):
        lease_time = time.time() if now is None else now
        jobs = lease_delivery_jobs(home, now=lease_time, limit=1)
        if not jobs:
            break
        job = jobs[0]
        payload = opaque_payload(
            job["notification_id"], job["category"], job["profile"], job.get("target")
        )
        try:
            send(
                job,
                payload,
                ttl=3600,
                urgency="high" if job["category"] == "error" else "normal",
            )
        except Exception as exc:
            status = _status_code(exc)
            if status in {404, 410}:
                outcome = "gone"
            elif status is None or status in {408, 425, 429} or status >= 500:
                outcome = "retry"
            else:
                outcome = "failed"
        else:
            outcome = "sent"
        finished_at = time.time() if now is None else now
        _finish_job(home, job, outcome=outcome, now=finished_at)
        stats[{"retry": "retried"}.get(outcome, outcome)] += 1
    return stats


def kick_delivery_worker(home: Path, *, send: Callable[..., None]) -> bool:
    """Start at most one non-blocking worker per profile home."""
    key = str(home.resolve())
    with _worker_guard:
        if key in _running_workers:
            return False
        _running_workers.add(key)

    def run() -> None:
        try:
            while True:
                stats = process_delivery_batch(home, send=send)
                if not any(stats.values()):
                    return
                # Continue draining work that is already due. Future retries are
                # picked up by the periodic/startup kick or a later notification.
        finally:
            with _worker_guard:
                _running_workers.discard(key)

    threading.Thread(target=run, name="mobile-push-delivery", daemon=True).start()
    return True
