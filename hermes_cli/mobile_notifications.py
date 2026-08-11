"""Durable, profile-local notification storage for Hermes Mobile.

This deliberately uses a separate SQLite file in each profile home. Notification
content is dashboard data, not conversation history, so it must not be added to
or exposed through transcript search/export tables.
"""

from __future__ import annotations

from contextlib import closing
from pathlib import Path
import secrets
import sqlite3
import time
from typing import Any, Optional


DATABASE_NAME = "mobile_notifications.db"
_LEVELS = frozenset({"error", "info", "success", "warning"})
_MAX_ACTIVE_PUSH_DELIVERIES = 1000


def _migrate_foundation_push_subscriptions(conn: sqlite3.Connection, home: Path) -> None:
    """Idempotently import the foundation mobile_push.db without deleting it."""
    migration_name = "foundation-subscriptions-v1"
    if conn.execute(
        "SELECT 1 FROM mobile_push_migrations WHERE name = ?", (migration_name,)
    ).fetchone():
        return
    legacy_path = home / "mobile_push.db"
    if not legacy_path.is_file():
        return
    try:
        legacy = sqlite3.connect(f"file:{legacy_path}?mode=ro", uri=True)
        legacy.row_factory = sqlite3.Row
        try:
            table = legacy.execute(
                "SELECT 1 FROM sqlite_master WHERE type='table' AND name='subscriptions'"
            ).fetchone()
            if not table:
                return
            columns = {row[1] for row in legacy.execute("PRAGMA table_info(subscriptions)").fetchall()}
            required = {
                "id", "device_id", "endpoint", "p256dh", "auth", "categories",
                "created_at", "last_seen_at", "failure_count", "last_failure_at",
            }
            if not required.issubset(columns):
                return
            rows = legacy.execute("SELECT * FROM subscriptions ORDER BY created_at, id").fetchall()
        finally:
            legacy.close()
    except sqlite3.Error:
        return
    from hermes_cli.mobile_push import validate_push_endpoint

    for row in rows:
        categories = sorted({item for item in str(row["categories"]).split(",") if item in _LEVELS})
        if (
            not categories or len(str(row["p256dh"])) != 87 or len(str(row["auth"])) != 22
        ):
            continue
        try:
            validate_push_endpoint(str(row["endpoint"]))
        except ValueError:
            continue
        # Current records win on either unique identity; the retained legacy DB
        # makes every skipped collision auditable and permits a later manual repair.
        conn.execute(
            """INSERT OR IGNORE INTO mobile_push_devices
               (id, device_id, endpoint, p256dh, auth, categories, created_at,
                last_seen_at, failure_count, last_failure_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (
                row["id"], row["device_id"], row["endpoint"], row["p256dh"], row["auth"],
                ",".join(categories), row["created_at"], row["last_seen_at"],
                row["failure_count"], row["last_failure_at"],
            ),
        )
    conn.execute(
        "INSERT INTO mobile_push_migrations (name, completed_at) VALUES (?, ?)",
        (migration_name, time.time()),
    )


def _connect(home: Path) -> sqlite3.Connection:
    home.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(home / DATABASE_NAME, timeout=10)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=ON")
    conn.execute(
        """CREATE TABLE IF NOT EXISTS mobile_notifications (
            id TEXT PRIMARY KEY,
            profile TEXT NOT NULL,
            session_id TEXT,
            type TEXT NOT NULL,
            level TEXT NOT NULL,
            title TEXT NOT NULL,
            body TEXT NOT NULL,
            created_at REAL NOT NULL,
            read_at REAL,
            dismissed_at REAL,
            dedupe_key TEXT UNIQUE,
            target TEXT
        )"""
    )
    conn.execute(
        "CREATE INDEX IF NOT EXISTS mobile_notifications_active_idx "
        "ON mobile_notifications(dismissed_at, created_at DESC)"
    )
    conn.execute(
        """CREATE TABLE IF NOT EXISTS mobile_push_devices (
            id TEXT PRIMARY KEY,
            device_id TEXT NOT NULL UNIQUE,
            endpoint TEXT NOT NULL UNIQUE,
            p256dh TEXT NOT NULL,
            auth TEXT NOT NULL,
            categories TEXT NOT NULL,
            created_at REAL NOT NULL,
            last_seen_at REAL NOT NULL,
            failure_count INTEGER NOT NULL DEFAULT 0,
            last_failure_at REAL
        )"""
    )
    conn.execute(
        """CREATE TABLE IF NOT EXISTS mobile_push_deliveries (
            id TEXT PRIMARY KEY,
            notification_id TEXT NOT NULL,
            subscription_id TEXT NOT NULL,
            category TEXT NOT NULL,
            profile TEXT NOT NULL,
            state TEXT NOT NULL DEFAULT 'pending',
            attempt_count INTEGER NOT NULL DEFAULT 0,
            next_attempt_at REAL NOT NULL,
            lease_until REAL,
            created_at REAL NOT NULL,
            updated_at REAL NOT NULL,
            UNIQUE(notification_id, subscription_id),
            FOREIGN KEY(notification_id) REFERENCES mobile_notifications(id) ON DELETE CASCADE,
            FOREIGN KEY(subscription_id) REFERENCES mobile_push_devices(id) ON DELETE CASCADE
        )"""
    )
    conn.execute(
        "CREATE INDEX IF NOT EXISTS mobile_push_deliveries_due_idx "
        "ON mobile_push_deliveries(state, next_attempt_at, lease_until)"
    )
    conn.execute(
        """CREATE TABLE IF NOT EXISTS mobile_push_migrations (
            name TEXT PRIMARY KEY,
            completed_at REAL NOT NULL
        )"""
    )
    _migrate_foundation_push_subscriptions(conn, home)
    conn.commit()
    return conn


def _row(row: sqlite3.Row) -> dict[str, Any]:
    return dict(row)


def upsert_notification(
    home: Path,
    *,
    body: str,
    dedupe_key: Optional[str],
    level: str,
    profile: str,
    session_id: Optional[str],
    target: Optional[str],
    title: str,
    type: str,
    enqueue_push: bool = True,
) -> dict[str, Any]:
    if level not in _LEVELS:
        raise ValueError("unsupported notification level")
    now = time.time()
    with closing(_connect(home)) as conn:
        notification_id = secrets.token_urlsafe(18)
        if dedupe_key:
            conn.execute(
                """INSERT INTO mobile_notifications
                    (id, profile, session_id, type, level, title, body, created_at, dedupe_key, target)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    ON CONFLICT(dedupe_key) DO UPDATE SET
                        profile=excluded.profile,
                        session_id=excluded.session_id,
                        type=excluded.type,
                        level=excluded.level,
                        title=excluded.title,
                        body=excluded.body,
                        read_at=NULL,
                        dismissed_at=NULL,
                        target=excluded.target""",
                (notification_id, profile, session_id, type, level, title, body, now, dedupe_key, target),
            )
            row = conn.execute(
                "SELECT * FROM mobile_notifications WHERE dedupe_key = ?", (dedupe_key,)
            ).fetchone()
        else:
            conn.execute(
                """INSERT INTO mobile_notifications
                    (id, profile, session_id, type, level, title, body, created_at, target)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                (notification_id, profile, session_id, type, level, title, body, now, target),
            )
            row = conn.execute("SELECT * FROM mobile_notifications WHERE id = ?", (notification_id,)).fetchone()
        assert row is not None
        if enqueue_push:
            active = conn.execute(
                "SELECT COUNT(*) FROM mobile_push_deliveries WHERE state IN ('pending', 'retry', 'leased')"
            ).fetchone()[0]
            available = max(0, _MAX_ACTIVE_PUSH_DELIVERIES - int(active))
        else:
            available = 0
        if available:
            subscriptions = conn.execute(
                """SELECT id FROM mobile_push_devices
                   WHERE instr(',' || categories || ',', ',' || ? || ',') > 0
                   ORDER BY created_at LIMIT ?""",
                (level, available),
            ).fetchall()
            for subscription in subscriptions:
                conn.execute(
                    """INSERT OR IGNORE INTO mobile_push_deliveries
                       (id, notification_id, subscription_id, category, profile, state,
                        attempt_count, next_attempt_at, created_at, updated_at)
                       VALUES (?, ?, ?, ?, ?, 'pending', 0, ?, ?, ?)""",
                    (
                        secrets.token_urlsafe(18), row["id"], subscription["id"],
                        level, profile, now, now, now,
                    ),
                )
        conn.commit()
    return _row(row)


def list_notifications(home: Path, *, include_dismissed: bool, limit: int) -> tuple[list[dict[str, Any]], int]:
    with closing(_connect(home)) as conn:
        where = "" if include_dismissed else "WHERE dismissed_at IS NULL"
        count = conn.execute(f"SELECT COUNT(*) FROM mobile_notifications {where}").fetchone()[0]
        rows = conn.execute(
            f"SELECT * FROM mobile_notifications {where} ORDER BY created_at DESC LIMIT ?", (limit,)
        ).fetchall()
    return [_row(row) for row in rows], int(count)


def set_notification_state(home: Path, notification_id: str, *, field: str) -> Optional[dict[str, Any]]:
    if field not in {"read_at", "dismissed_at"}:
        raise ValueError("unsupported notification state")
    with closing(_connect(home)) as conn:
        cursor = conn.execute(
            f"UPDATE mobile_notifications SET {field} = COALESCE({field}, ?) WHERE id = ?",
            (time.time(), notification_id),
        )
        if not cursor.rowcount:
            return None
        row = conn.execute("SELECT * FROM mobile_notifications WHERE id = ?", (notification_id,)).fetchone()
        conn.commit()
    assert row is not None
    return _row(row)


def dismiss_notification_by_dedupe_key(home: Path, dedupe_key: str) -> bool:
    """Dismiss a keyed gateway notice when its recovery event arrives."""
    with closing(_connect(home)) as conn:
        changed = conn.execute(
            "UPDATE mobile_notifications SET dismissed_at = COALESCE(dismissed_at, ?) WHERE dedupe_key = ?",
            (time.time(), dedupe_key),
        ).rowcount
        conn.commit()
    return bool(changed)


def upsert_push_subscription(home: Path, *, endpoint: str, p256dh: str, auth: str) -> None:
    """Persist an authenticated browser subscription; delivery is configured separately."""
    now = time.time()
    with closing(_connect(home)) as conn:
        conn.execute(
            """INSERT INTO mobile_push_subscriptions (id, endpoint, p256dh, auth, created_at, updated_at)
               VALUES (?, ?, ?, ?, ?, ?)
               ON CONFLICT(endpoint) DO UPDATE SET p256dh=excluded.p256dh, auth=excluded.auth, updated_at=excluded.updated_at""",
            (secrets.token_urlsafe(18), endpoint, p256dh, auth, now, now),
        )
        conn.commit()


def remove_push_subscription(home: Path, *, endpoint: str) -> bool:
    with closing(_connect(home)) as conn:
        removed = conn.execute("DELETE FROM mobile_push_subscriptions WHERE endpoint = ?", (endpoint,)).rowcount
        conn.commit()
    return bool(removed)
