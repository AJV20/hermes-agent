"""Profile-local Web Push subscription persistence and opaque delivery helpers.

This module deliberately stores no notification text and never reads VAPID private
material.  The caller obtains secrets through Hermes' existing scoped secret path.
"""
from __future__ import annotations

from contextlib import closing
from pathlib import Path
import secrets
import sqlite3
import time
from typing import Any

DATABASE_NAME = "mobile_push.db"
CATEGORIES = frozenset({"info", "success", "warning", "error"})


def _connect(home: Path) -> sqlite3.Connection:
    home.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(home / DATABASE_NAME, timeout=10)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("""CREATE TABLE IF NOT EXISTS subscriptions (
        id TEXT PRIMARY KEY, device_id TEXT NOT NULL UNIQUE, endpoint TEXT NOT NULL UNIQUE,
        p256dh TEXT NOT NULL, auth TEXT NOT NULL, categories TEXT NOT NULL,
        created_at REAL NOT NULL, last_seen_at REAL NOT NULL, failure_count INTEGER NOT NULL DEFAULT 0,
        last_failure_at REAL
    )""")
    return conn


def list_subscriptions(home: Path) -> list[dict[str, Any]]:
    with closing(_connect(home)) as conn:
        rows = conn.execute("SELECT device_id, categories, created_at, last_seen_at, failure_count FROM subscriptions ORDER BY created_at").fetchall()
    return [{**dict(row), "categories": dict(row)["categories"].split(",")} for row in rows]


def upsert_subscription(home: Path, *, device_id: str, endpoint: str, p256dh: str, auth: str, categories: list[str]) -> None:
    now = time.time()
    with closing(_connect(home)) as conn:
        conn.execute("""INSERT INTO subscriptions (id,device_id,endpoint,p256dh,auth,categories,created_at,last_seen_at)
        VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(device_id) DO UPDATE SET endpoint=excluded.endpoint,
        p256dh=excluded.p256dh,auth=excluded.auth,categories=excluded.categories,last_seen_at=excluded.last_seen_at""",
        (secrets.token_urlsafe(18), device_id, endpoint, p256dh, auth, ",".join(sorted(categories)), now, now))
        conn.commit()


def remove_subscription(home: Path, *, device_id: str) -> bool:
    with closing(_connect(home)) as conn:
        removed = conn.execute("DELETE FROM subscriptions WHERE device_id=?", (device_id,)).rowcount
        conn.commit()
    return bool(removed)


def opaque_payload(notification_id: str, category: str, profile_hint: str) -> dict[str, str]:
    """Only fields safe to show before foreground authenticated retrieval."""
    if category not in CATEGORIES:
        raise ValueError("unsupported push category")
    return {"id": notification_id, "category": category, "profile": profile_hint}


def deliver_opaque(home: Path, *, notification_id: str, category: str, profile_hint: str, send) -> None:
    """Deliver after the durable notification commit via an injected transport.

    ``send`` receives the subscription plus opaque payload and Web Push delivery
    policy (TTL/urgency). Only transient failures are retried once; 404/410
    subscriptions are removed. This stays transport-neutral so importing this
    module cannot expose or retain a VAPID private key.
    """
    payload = opaque_payload(notification_id, category, profile_hint)
    with closing(_connect(home)) as conn:
        rows = conn.execute("SELECT * FROM subscriptions WHERE instr(categories, ?) > 0", (category,)).fetchall()
        for row in rows:
            subscription = dict(row)
            for attempt in range(2):
                try:
                    send(subscription, payload, ttl=3600, urgency="high" if category == "error" else "normal")
                    conn.execute("UPDATE subscriptions SET last_seen_at=?, failure_count=0 WHERE id=?", (time.time(), row["id"]))
                    break
                except Exception as exc:
                    status = getattr(exc, "status_code", None)
                    if status in {404, 410}:
                        conn.execute("DELETE FROM subscriptions WHERE id=?", (row["id"],))
                        break
                    transient = status is None or status >= 500
                    if not transient or attempt:
                        conn.execute("UPDATE subscriptions SET failure_count=MIN(failure_count + 1, 3), last_failure_at=? WHERE id=?", (time.time(), row["id"]))
                        break
        conn.commit()
