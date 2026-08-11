"""Durable, profile-local idempotency reservations for mobile first chats."""

from __future__ import annotations

import sqlite3
import time
from pathlib import Path

_DB_NAME = "mobile_session_operations.db"


def reserve_mobile_session(
    home: Path,
    operation_id: str,
    *,
    session_id: str,
    stored_session_id: str,
) -> tuple[str, str]:
    """Atomically reserve or retrieve the session identity for one operation."""
    home = Path(home)
    home.mkdir(parents=True, exist_ok=True)
    path = home / _DB_NAME
    with sqlite3.connect(path, timeout=10.0) as conn:
        conn.execute("PRAGMA busy_timeout=10000")
        conn.execute(
            """CREATE TABLE IF NOT EXISTS mobile_session_operations (
                   operation_id TEXT PRIMARY KEY,
                   session_id TEXT NOT NULL,
                   stored_session_id TEXT NOT NULL,
                   created_at REAL NOT NULL
               )"""
        )
        conn.execute("BEGIN IMMEDIATE")
        conn.execute(
            """INSERT OR IGNORE INTO mobile_session_operations
                   (operation_id, session_id, stored_session_id, created_at)
               VALUES (?, ?, ?, ?)""",
            (operation_id, session_id, stored_session_id, time.time()),
        )
        row = conn.execute(
            """SELECT session_id, stored_session_id
               FROM mobile_session_operations WHERE operation_id = ?""",
            (operation_id,),
        ).fetchone()
        conn.commit()
    if row is None:  # pragma: no cover - guarded by the transaction above
        raise RuntimeError("mobile session reservation was not persisted")
    return str(row[0]), str(row[1])
