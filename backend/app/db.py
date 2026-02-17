from __future__ import annotations

import json
import sqlite3
import threading
from pathlib import Path
from typing import Any

from .time_utils import utcnow_iso


class Database:
    def __init__(self, db_path: Path):
        self.db_path = db_path
        self._lock = threading.Lock()

    def _connect(self) -> sqlite3.Connection:
        conn = sqlite3.connect(self.db_path, check_same_thread=False)
        conn.row_factory = sqlite3.Row
        return conn

    def init_schema(self) -> None:
        schema_statements = [
            """
            CREATE TABLE IF NOT EXISTS lookup_jobs (
                id TEXT PRIMARY KEY,
                hackathon_url TEXT NOT NULL,
                status TEXT NOT NULL,
                created_at TEXT NOT NULL,
                started_at TEXT,
                finished_at TEXT,
                error_code TEXT,
                error_message TEXT
            )
            """,
            """
            CREATE TABLE IF NOT EXISTS lookup_progress_events (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                lookup_job_id TEXT NOT NULL,
                event_type TEXT NOT NULL,
                payload_json TEXT NOT NULL,
                created_at TEXT NOT NULL,
                FOREIGN KEY (lookup_job_id) REFERENCES lookup_jobs(id)
            )
            """,
            """
            CREATE INDEX IF NOT EXISTS idx_progress_lookup_job_id
            ON lookup_progress_events (lookup_job_id, id)
            """,
            """
            CREATE INDEX IF NOT EXISTS idx_lookup_jobs_url_status_created
            ON lookup_jobs (hackathon_url, status, created_at)
            """,
            """
            CREATE INDEX IF NOT EXISTS idx_lookup_jobs_url_status_finished
            ON lookup_jobs (hackathon_url, status, finished_at)
            """,
            """
            CREATE TABLE IF NOT EXISTS lookup_results (
                lookup_job_id TEXT PRIMARY KEY,
                result_json TEXT NOT NULL,
                created_at TEXT NOT NULL,
                FOREIGN KEY (lookup_job_id) REFERENCES lookup_jobs(id)
            )
            """,
            """
            CREATE TABLE IF NOT EXISTS rate_limit_events (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                ip_hash TEXT NOT NULL,
                endpoint TEXT NOT NULL,
                created_at TEXT NOT NULL
            )
            """,
            """
            CREATE INDEX IF NOT EXISTS idx_rate_limit_ip_endpoint_created
            ON rate_limit_events (ip_hash, endpoint, created_at)
            """,
        ]

        with self._lock:
            conn = self._connect()
            try:
                cursor = conn.cursor()
                for statement in schema_statements:
                    cursor.execute(statement)
                conn.commit()
            finally:
                conn.close()

    def create_lookup_job(self, lookup_id: str, hackathon_url: str) -> None:
        now = utcnow_iso()
        with self._lock:
            conn = self._connect()
            try:
                conn.execute(
                    """
                    INSERT INTO lookup_jobs (
                        id, hackathon_url, status, created_at
                    ) VALUES (?, ?, ?, ?)
                    """,
                    (lookup_id, hackathon_url, "queued", now),
                )
                conn.commit()
            finally:
                conn.close()

    def set_lookup_started(self, lookup_id: str) -> None:
        now = utcnow_iso()
        with self._lock:
            conn = self._connect()
            try:
                conn.execute(
                    """
                    UPDATE lookup_jobs
                    SET status = ?, started_at = ?
                    WHERE id = ?
                    """,
                    ("started", now, lookup_id),
                )
                conn.commit()
            finally:
                conn.close()

    def set_lookup_completed(self, lookup_id: str) -> None:
        now = utcnow_iso()
        with self._lock:
            conn = self._connect()
            try:
                conn.execute(
                    """
                    UPDATE lookup_jobs
                    SET status = ?, finished_at = ?, error_code = NULL, error_message = NULL
                    WHERE id = ?
                    """,
                    ("completed", now, lookup_id),
                )
                conn.commit()
            finally:
                conn.close()

    def set_lookup_failed(self, lookup_id: str, error_code: str, error_message: str) -> None:
        now = utcnow_iso()
        with self._lock:
            conn = self._connect()
            try:
                conn.execute(
                    """
                    UPDATE lookup_jobs
                    SET status = ?, finished_at = ?, error_code = ?, error_message = ?
                    WHERE id = ?
                    """,
                    ("failed", now, error_code, error_message, lookup_id),
                )
                conn.commit()
            finally:
                conn.close()

    def save_lookup_result(self, lookup_id: str, result: dict[str, Any]) -> None:
        now = utcnow_iso()
        with self._lock:
            conn = self._connect()
            try:
                conn.execute(
                    """
                    INSERT INTO lookup_results (lookup_job_id, result_json, created_at)
                    VALUES (?, ?, ?)
                    ON CONFLICT(lookup_job_id)
                    DO UPDATE SET result_json = excluded.result_json, created_at = excluded.created_at
                    """,
                    (lookup_id, json.dumps(result), now),
                )
                conn.commit()
            finally:
                conn.close()

    def insert_progress_event(self, lookup_id: str, event_type: str, payload: dict[str, Any]) -> dict[str, Any]:
        now = utcnow_iso()
        event = {
            "event_type": event_type,
            "timestamp": now,
            "payload": payload,
        }
        with self._lock:
            conn = self._connect()
            try:
                conn.execute(
                    """
                    INSERT INTO lookup_progress_events (
                        lookup_job_id, event_type, payload_json, created_at
                    ) VALUES (?, ?, ?, ?)
                    """,
                    (lookup_id, event_type, json.dumps(payload), now),
                )
                conn.commit()
            finally:
                conn.close()
        return event

    def get_lookup_job(self, lookup_id: str) -> dict[str, Any] | None:
        with self._lock:
            conn = self._connect()
            try:
                row = conn.execute(
                    """
                    SELECT *
                    FROM lookup_jobs
                    WHERE id = ?
                    """,
                    (lookup_id,),
                ).fetchone()
            finally:
                conn.close()

        if row is None:
            return None
        return dict(row)

    def list_pending_lookup_ids(self) -> list[str]:
        with self._lock:
            conn = self._connect()
            try:
                rows = conn.execute(
                    """
                    SELECT id
                    FROM lookup_jobs
                    WHERE status IN ('queued', 'started')
                    ORDER BY created_at ASC
                    """
                ).fetchall()
            finally:
                conn.close()

        return [str(row["id"]) for row in rows]

    def get_latest_active_lookup_for_url(self, hackathon_url: str) -> dict[str, Any] | None:
        with self._lock:
            conn = self._connect()
            try:
                row = conn.execute(
                    """
                    SELECT *
                    FROM lookup_jobs
                    WHERE hackathon_url = ?
                      AND status IN ('queued', 'started')
                    ORDER BY created_at ASC
                    LIMIT 1
                    """,
                    (hackathon_url,),
                ).fetchone()
            finally:
                conn.close()

        if row is None:
            return None
        return dict(row)

    def get_recent_completed_lookup_for_url(self, hackathon_url: str, finished_since: str) -> dict[str, Any] | None:
        with self._lock:
            conn = self._connect()
            try:
                row = conn.execute(
                    """
                    SELECT jobs.*
                    FROM lookup_jobs AS jobs
                    INNER JOIN lookup_results AS results
                      ON results.lookup_job_id = jobs.id
                    WHERE jobs.hackathon_url = ?
                      AND jobs.status = 'completed'
                      AND jobs.finished_at IS NOT NULL
                      AND jobs.finished_at >= ?
                    ORDER BY jobs.finished_at DESC
                    LIMIT 1
                    """,
                    (hackathon_url, finished_since),
                ).fetchone()
            finally:
                conn.close()

        if row is None:
            return None
        return dict(row)

    def get_lookup_result(self, lookup_id: str) -> dict[str, Any] | None:
        with self._lock:
            conn = self._connect()
            try:
                row = conn.execute(
                    """
                    SELECT result_json
                    FROM lookup_results
                    WHERE lookup_job_id = ?
                    """,
                    (lookup_id,),
                ).fetchone()
            finally:
                conn.close()

        if row is None:
            return None
        return json.loads(row["result_json"])

    def list_progress_events(self, lookup_id: str) -> list[dict[str, Any]]:
        with self._lock:
            conn = self._connect()
            try:
                rows = conn.execute(
                    """
                    SELECT event_type, payload_json, created_at
                    FROM lookup_progress_events
                    WHERE lookup_job_id = ?
                    ORDER BY id ASC
                    """,
                    (lookup_id,),
                ).fetchall()
            finally:
                conn.close()

        events: list[dict[str, Any]] = []
        for row in rows:
            events.append(
                {
                    "event_type": row["event_type"],
                    "timestamp": row["created_at"],
                    "payload": json.loads(row["payload_json"]),
                }
            )
        return events

    def insert_rate_limit_event(self, ip_hash: str, endpoint: str) -> None:
        with self._lock:
            conn = self._connect()
            try:
                conn.execute(
                    """
                    INSERT INTO rate_limit_events (ip_hash, endpoint, created_at)
                    VALUES (?, ?, ?)
                    """,
                    (ip_hash, endpoint, utcnow_iso()),
                )
                conn.commit()
            finally:
                conn.close()

    def count_rate_limit_events(self, ip_hash: str, endpoint: str, since_timestamp: str) -> int:
        with self._lock:
            conn = self._connect()
            try:
                row = conn.execute(
                    """
                    SELECT COUNT(*) AS count
                    FROM rate_limit_events
                    WHERE ip_hash = ?
                      AND endpoint = ?
                      AND created_at >= ?
                    """,
                    (ip_hash, endpoint, since_timestamp),
                ).fetchone()
            finally:
                conn.close()

        return int(row["count"]) if row is not None else 0
