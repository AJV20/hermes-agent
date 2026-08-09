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
    # Subscription persistence is an intentionally sender-agnostic seam.  The
    # VAPID sender is enabled only once deployment configuration is supplied.
    conn.execute(
        """CREATE TABLE IF NOT EXISTS mobile_push_subscriptions (
            id TEXT PRIMARY KEY,
            endpoint TEXT NOT NULL UNIQUE,
            p256dh TEXT NOT NULL,
            auth TEXT NOT NULL,
            created_at REAL NOT NULL,
            updated_at REAL NOT NULL
        )"""
    )
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
        conn.commit()
    assert row is not None
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
