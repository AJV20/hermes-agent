from pathlib import Path
import sqlite3
import threading

import pytest

from hermes_cli import mobile_notifications, mobile_push

_REAL_RESOLVER = mobile_push._resolve_host_addresses


@pytest.fixture(autouse=True)
def _public_push_dns(monkeypatch):
    monkeypatch.setattr(mobile_push, "_resolve_host_addresses", lambda _host: ["142.250.72.202"])


class PushResponseError(Exception):
    def __init__(self, status_code: int):
        self.status_code = status_code


def _subscription(home: Path, device_id: str = "device-opaque-123") -> None:
    mobile_push.upsert_subscription(
        home,
        device_id=device_id,
        endpoint=f"https://fcm.googleapis.com/{device_id}",
        p256dh="A" * 87,
        auth="B" * 22,
        categories=["error", "warning"],
    )


def _notification(home: Path, *, dedupe_key: str = "notice-key") -> dict:
    return mobile_notifications.upsert_notification(
        home,
        body="Private dashboard detail",
        dedupe_key=dedupe_key,
        level="error",
        profile="default",
        session_id=None,
        target="/mobile/notifications",
        title="Hermes update",
        type="notice",
    )


def test_notification_and_delivery_job_are_deduplicated_atomically(tmp_path):
    _subscription(tmp_path)

    first = _notification(tmp_path)
    second = _notification(tmp_path)

    assert second["id"] == first["id"]
    jobs = mobile_push.list_delivery_jobs(tmp_path)
    assert len(jobs) == 1
    assert jobs[0]["notification_id"] == first["id"]
    assert jobs[0]["state"] == "pending"
    assert "Private dashboard detail" not in repr(jobs)


def test_existing_notification_database_gains_push_tables_without_data_reset(tmp_path):
    database = tmp_path / mobile_notifications.DATABASE_NAME
    with sqlite3.connect(database) as connection:
        connection.execute(
            """CREATE TABLE mobile_notifications (
                id TEXT PRIMARY KEY, profile TEXT NOT NULL, session_id TEXT,
                type TEXT NOT NULL, level TEXT NOT NULL, title TEXT NOT NULL,
                body TEXT NOT NULL, created_at REAL NOT NULL, read_at REAL,
                dismissed_at REAL, dedupe_key TEXT UNIQUE, target TEXT
            )"""
        )
        connection.execute(
            """INSERT INTO mobile_notifications
               (id, profile, type, level, title, body, created_at)
               VALUES ('existing', 'default', 'notice', 'info', 'Existing', 'Preserved', 1)"""
        )

    _subscription(tmp_path)

    assert mobile_push.list_subscriptions(tmp_path)[0]["device_id"] == "device-opaque-123"
    with sqlite3.connect(database) as connection:
        assert connection.execute("SELECT body FROM mobile_notifications WHERE id = 'existing'").fetchone()[0] == "Preserved"


def test_delivery_jobs_respect_each_device_category_selection(tmp_path):
    _subscription(tmp_path)
    mobile_notifications.upsert_notification(
        tmp_path,
        body="Informational detail",
        dedupe_key="info-key",
        level="info",
        profile="default",
        session_id=None,
        target="/mobile/notifications",
        title="Info",
        type="notice",
    )

    assert mobile_push.list_delivery_jobs(tmp_path) == []


def test_notification_and_delivery_roll_back_together(monkeypatch, tmp_path):
    _subscription(tmp_path)
    calls = iter(["notification-id"])

    def fail_during_delivery(_size):
        try:
            return next(calls)
        except StopIteration as exc:
            raise RuntimeError("delivery insert failed") from exc

    monkeypatch.setattr(mobile_notifications.secrets, "token_urlsafe", fail_during_delivery)
    try:
        _notification(tmp_path)
    except RuntimeError as exc:
        assert str(exc) == "delivery insert failed"
    else:
        raise AssertionError("notification insert unexpectedly committed")

    items, total = mobile_notifications.list_notifications(tmp_path, include_dismissed=True, limit=10)
    assert items == []
    assert total == 0
    assert mobile_push.list_delivery_jobs(tmp_path) == []


def test_delivery_queue_has_a_hard_active_bound(monkeypatch, tmp_path):
    monkeypatch.setattr(mobile_notifications, "_MAX_ACTIVE_PUSH_DELIVERIES", 2)
    for device in ("device-bound-001", "device-bound-002", "device-bound-003"):
        _subscription(tmp_path, device)

    _notification(tmp_path)

    assert len(mobile_push.list_delivery_jobs(tmp_path)) == 2


def test_server_disabled_notification_does_not_create_a_future_push_backlog(tmp_path):
    _subscription(tmp_path)
    mobile_notifications.upsert_notification(
        tmp_path,
        body="Persist this in the inbox only",
        dedupe_key="disabled-notice",
        level="warning",
        profile="default",
        session_id=None,
        target="/mobile/notifications",
        title="Inbox only",
        type="gateway",
        enqueue_push=False,
    )

    assert mobile_push.list_delivery_jobs(tmp_path) == []


def test_delivery_deadlines_fit_inside_the_durable_lease():
    assert mobile_push.DNS_RESOLUTION_TIMEOUT + sum(mobile_push.NETWORK_TIMEOUT) < mobile_push.LEASE_SECONDS


def test_dns_resolution_has_a_finite_deadline(monkeypatch):
    monkeypatch.setattr(mobile_push, "DNS_RESOLUTION_TIMEOUT", 0.01, raising=False)

    def stalled(*_args, **_kwargs):
        threading.Event().wait(0.05)
        return [(2, 1, 6, "", ("142.250.72.202", 443))]

    monkeypatch.setattr(mobile_push.socket, "getaddrinfo", stalled)
    with pytest.raises(OSError, match="timed out"):
        _REAL_RESOLVER("fcm.googleapis.com")


def test_service_rejects_push_host_when_any_resolved_address_is_not_public(monkeypatch):
    monkeypatch.setattr(
        mobile_push,
        "_resolve_host_addresses",
        lambda _host: ["142.250.72.202", "127.0.0.1", "::ffff:169.254.169.254"],
        raising=False,
    )

    with pytest.raises(ValueError, match="public"):
        mobile_push.validate_push_endpoint("https://fcm.googleapis.com/subscription")


def test_service_revalidates_device_and_key_shapes_before_persistence(tmp_path):
    with pytest.raises(ValueError, match="device"):
        mobile_push.upsert_subscription(
            tmp_path,
            device_id="short",
            endpoint="https://fcm.googleapis.com/subscription",
            p256dh="A" * 87,
            auth="B" * 22,
            categories=["error"],
        )
    with pytest.raises(ValueError, match="key"):
        mobile_push.upsert_subscription(
            tmp_path,
            device_id="device-opaque-123",
            endpoint="https://fcm.googleapis.com/subscription",
            p256dh="A" * 86,
            auth="B" * 22,
            categories=["error"],
        )


def test_device_id_loss_adopts_the_existing_profile_local_endpoint(monkeypatch, tmp_path):
    monkeypatch.setattr(mobile_push, "_resolve_host_addresses", lambda _host: ["142.250.72.202"], raising=False)
    _subscription(tmp_path, "device-opaque-old")

    mobile_push.upsert_subscription(
        tmp_path,
        device_id="device-opaque-new",
        endpoint="https://fcm.googleapis.com/device-opaque-old",
        p256dh="C" * 87,
        auth="D" * 22,
        categories=["success"],
    )

    subscriptions = mobile_push.list_subscriptions(tmp_path)
    assert len(subscriptions) == 1
    assert subscriptions[0]["device_id"] == "device-opaque-new"
    assert subscriptions[0]["categories"] == ["success"]
    assert subscriptions[0]["failure_count"] == 0


def test_foundation_database_migrates_idempotently_without_losing_metadata(monkeypatch, tmp_path):
    monkeypatch.setattr(mobile_push, "_resolve_host_addresses", lambda _host: ["142.250.72.202"], raising=False)
    legacy = tmp_path / "mobile_push.db"
    with sqlite3.connect(legacy) as connection:
        connection.execute("""CREATE TABLE subscriptions (
            id TEXT PRIMARY KEY, device_id TEXT NOT NULL UNIQUE, endpoint TEXT NOT NULL UNIQUE,
            p256dh TEXT NOT NULL, auth TEXT NOT NULL, categories TEXT NOT NULL,
            created_at REAL NOT NULL, last_seen_at REAL NOT NULL,
            failure_count INTEGER NOT NULL DEFAULT 0, last_failure_at REAL
        )""")
        connection.execute(
            """INSERT INTO subscriptions VALUES
               ('legacy-id', 'device-legacy-123', 'https://fcm.googleapis.com/legacy',
                ?, ?, 'error,warning', 11, 22, 2, 33)""",
            ("A" * 87, "B" * 22),
        )

    first = mobile_push.list_subscriptions(tmp_path)
    second = mobile_push.list_subscriptions(tmp_path)

    assert len(first) == len(second) == 1
    assert first[0]["device_id"] == "device-legacy-123"
    assert first[0]["categories"] == ["error", "warning"]
    assert first[0]["created_at"] == 11
    assert first[0]["last_seen_at"] == 22
    assert first[0]["failure_count"] == 2
    assert legacy.exists()
    with sqlite3.connect(tmp_path / mobile_notifications.DATABASE_NAME) as connection:
        assert connection.execute(
            "SELECT COUNT(*) FROM mobile_push_migrations WHERE name='foundation-subscriptions-v1'"
        ).fetchone()[0] == 1

def test_malformed_foundation_database_does_not_block_notification_storage(tmp_path):
    legacy = tmp_path / "mobile_push.db"
    with sqlite3.connect(legacy) as connection:
        connection.execute(
            """CREATE TABLE subscriptions (
                id TEXT, endpoint TEXT, p256dh TEXT, auth TEXT,
                categories TEXT, created_at REAL
            )"""
        )
        connection.execute(
            "INSERT INTO subscriptions VALUES ('bad', 'https://fcm.googleapis.com/x', ?, ?, 'error', 1)",
            ("A" * 87, "B" * 22),
        )

    notification = _notification(tmp_path)

    assert notification["body"] == "Private dashboard detail"
    with sqlite3.connect(tmp_path / mobile_notifications.DATABASE_NAME) as connection:
        assert connection.execute("SELECT COUNT(*) FROM mobile_push_migrations").fetchone()[0] == 0


def test_delivery_batch_leases_only_the_job_currently_being_sent(tmp_path):
    _subscription(tmp_path, "device-opaque-123")
    _subscription(tmp_path, "device-opaque-456")
    _notification(tmp_path)
    observed_states = []

    def inspect_leases(*_args, **_kwargs):
        observed_states.append(sorted(job["state"] for job in mobile_push.list_delivery_jobs(tmp_path)))

    stats = mobile_push.process_delivery_batch(tmp_path, send=inspect_leases, limit=2)

    assert stats["sent"] == 2
    assert observed_states[0] == ["leased", "pending"]


def test_delivery_worker_retries_transient_failure_without_blocking_notification_write(tmp_path):
    _subscription(tmp_path)
    notice = _notification(tmp_path)
    attempts = []

    def fail_once(subscription, payload, **kwargs):
        attempts.append((subscription, payload, kwargs))
        raise PushResponseError(503)

    due = mobile_push.list_delivery_jobs(tmp_path)[0]["next_attempt_at"]
    stats = mobile_push.process_delivery_batch(tmp_path, send=fail_once, now=due)

    assert stats == {"failed": 0, "gone": 0, "retried": 1, "sent": 0}
    assert len(attempts) == 1
    assert attempts[0][1] == {"v": 1}
    assert attempts[0][2] == {"ttl": 3600, "urgency": "high"}
    job = mobile_push.list_delivery_jobs(tmp_path)[0]
    assert job["attempt_count"] == 1
    assert job["state"] == "retry"
    assert job["next_attempt_at"] > due

    mobile_push.process_delivery_batch(tmp_path, send=lambda *_args, **_kwargs: attempts.append("sent"), now=due)
    assert attempts[-1] != "sent"

    stats = mobile_push.process_delivery_batch(tmp_path, send=lambda *_args, **_kwargs: attempts.append("sent"), now=job["next_attempt_at"])
    assert stats == {"failed": 0, "gone": 0, "retried": 0, "sent": 1}
    assert attempts[-1] == "sent"
    assert mobile_push.list_delivery_jobs(tmp_path)[0]["state"] == "sent"


def test_delivery_worker_removes_gone_subscription_and_its_jobs(tmp_path):
    _subscription(tmp_path, "device-gone-123")
    _notification(tmp_path)

    def gone(*_args, **_kwargs):
        raise PushResponseError(410)

    due = mobile_push.list_delivery_jobs(tmp_path)[0]["next_attempt_at"]
    stats = mobile_push.process_delivery_batch(tmp_path, send=gone, now=due)

    assert stats == {"failed": 0, "gone": 1, "retried": 0, "sent": 0}
    assert mobile_push.list_subscriptions(tmp_path) == []
    assert mobile_push.list_delivery_jobs(tmp_path) == []


def test_expired_lease_is_recovered_but_active_lease_is_not_duplicated(tmp_path):
    _subscription(tmp_path)
    _notification(tmp_path)

    due = mobile_push.list_delivery_jobs(tmp_path)[0]["next_attempt_at"]
    leased = mobile_push.lease_delivery_jobs(tmp_path, now=due, lease_seconds=30.0)
    assert len(leased) == 1
    assert mobile_push.lease_delivery_jobs(tmp_path, now=due + 29.0, lease_seconds=30.0) == []
    assert len(mobile_push.lease_delivery_jobs(tmp_path, now=due + 30.0, lease_seconds=30.0)) == 1


def test_retry_count_is_bounded_and_then_terminal(tmp_path):
    _subscription(tmp_path)
    _notification(tmp_path)
    attempts = []

    def unavailable(*_args, **_kwargs):
        attempts.append("attempt")
        raise PushResponseError(503)

    for _ in range(mobile_push.MAX_ATTEMPTS):
        job = mobile_push.list_delivery_jobs(tmp_path)[0]
        mobile_push.process_delivery_batch(tmp_path, send=unavailable, now=job["next_attempt_at"])

    job = mobile_push.list_delivery_jobs(tmp_path)[0]
    assert len(attempts) == mobile_push.MAX_ATTEMPTS
    assert job["attempt_count"] == mobile_push.MAX_ATTEMPTS
    assert job["state"] == "failed"
    assert mobile_push.lease_delivery_jobs(tmp_path, now=job["next_attempt_at"] + 99999) == []


def test_kick_returns_before_a_slow_endpoint_finishes(tmp_path):
    from threading import Event

    _subscription(tmp_path)
    _notification(tmp_path)
    started = Event()
    release = Event()

    def blocked(*_args, **_kwargs):
        started.set()
        release.wait(2)

    try:
        assert mobile_push.kick_delivery_worker(tmp_path, send=blocked) is True
        assert started.wait(1)
        assert mobile_push.list_delivery_jobs(tmp_path)[0]["state"] == "leased"
    finally:
        release.set()


def test_vapid_keypair_is_profile_local_private_0600_and_public_only(monkeypatch, tmp_path):
    monkeypatch.setattr(mobile_push, "webpush", lambda **_kwargs: None)

    public_key = mobile_push.ensure_vapid_keypair(tmp_path)
    private_path = tmp_path / "secrets" / "mobile-web-push-vapid-private.pem"
    public_path = tmp_path / "mobile-web-push-vapid-public.txt"

    assert len(public_key) == 87
    assert public_path.read_text().strip() == public_key
    assert private_path.stat().st_mode & 0o777 == 0o600
    assert public_key not in private_path.read_text()
    assert mobile_push.ensure_vapid_keypair(tmp_path) == public_key

    sent = {}
    monkeypatch.setattr(mobile_push, "webpush", lambda **kwargs: sent.update(kwargs))
    sender = mobile_push.make_pywebpush_sender(lambda _name, default=None: default, home=tmp_path)
    sender(
        {"endpoint": "https://fcm.googleapis.com/a", "p256dh": "A", "auth": "B"},
        {"id": "n", "category": "info", "profile": "default"},
        ttl=1,
        urgency="normal",
    )
    assert sent["vapid_private_key"].startswith("-----BEGIN PRIVATE KEY-----")


def test_pywebpush_sender_reads_private_key_only_from_injected_secret_lookup(monkeypatch):
    sent = {}
    monkeypatch.setattr(mobile_push, "webpush", lambda **kwargs: sent.update(kwargs))

    sender = mobile_push.make_pywebpush_sender(lambda name, default=None: "private-secret" if name.endswith("PRIVATE_KEY") else default)
    sender({"endpoint": "https://fcm.googleapis.com/a", "p256dh": "A", "auth": "B"}, {"id": "n", "category": "info", "profile": "default"}, ttl=1, urgency="normal")

    assert sent["subscription_info"] == {"endpoint": "https://fcm.googleapis.com/a", "keys": {"p256dh": "A", "auth": "B"}}
    assert sent["vapid_private_key"] == "private-secret"
    assert sent["requests_session"].max_redirects == 0
    assert sent["requests_session"].trust_env is False
    assert sent["timeout"] == (3.05, 10.0)
    assert "private-secret" not in repr(sender)
