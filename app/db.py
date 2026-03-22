"""
db.py — SQLite persistence layer for MediaHunter v1.0 Beta
All search history is stored here instead of JSON.

Schema includes: service, item_type, item_id, title, release_year,
searched_at, result, search_count, last_changed_at
"""
import sqlite3
import threading
from datetime import datetime, timedelta
from pathlib import Path
from typing import Optional

_lock = threading.RLock()
_conn: Optional[sqlite3.Connection] = None
_db_path = None


def _require_init():
    if _conn is None:
        raise RuntimeError("Database is not initialized. Call init(db_path) first.")


def _get_conn() -> sqlite3.Connection:
    _require_init()
    assert _conn is not None
    return _conn


def init(db_path: Path):
    global _conn, _db_path
    with _lock:
        if _conn is not None:
            _conn.close()
        _db_path = db_path
        _conn = _connect()
        _migrate()


def _connect():
    conn = sqlite3.connect(str(_db_path), check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")   # safe concurrent reads
    conn.execute("PRAGMA foreign_keys=ON")
    return conn


def _migrate():
    """Create schema and run non-destructive migrations on existing DBs."""
    conn = _get_conn()
    with _lock:
        # Step 1: base table (release_year NOT included here so ALTER works on old DBs)
        conn.execute("""
            CREATE TABLE IF NOT EXISTS search_history (
                id              INTEGER PRIMARY KEY AUTOINCREMENT,
                service         TEXT    NOT NULL,
                item_type       TEXT    NOT NULL,
                item_id         INTEGER NOT NULL,
                title           TEXT    NOT NULL DEFAULT '',
                searched_at     TEXT    NOT NULL,
                result          TEXT    NOT NULL DEFAULT 'triggered',
                search_count    INTEGER NOT NULL DEFAULT 1,
                last_changed_at TEXT,
                UNIQUE(service, item_type, item_id)
            )
        """)
        conn.commit()

        # Step 2: add columns introduced in v4 (idempotent ALTER TABLE)
        existing_cols = {row[1] for row in
                         conn.execute("PRAGMA table_info(search_history)")}
        if "release_year" not in existing_cols:
            conn.execute(
                "ALTER TABLE search_history ADD COLUMN release_year INTEGER")
            conn.commit()

        # Step 3: indexes — individual execute() calls (not executescript) to avoid
        # the implicit COMMIT that executescript() performs, which can confuse
        # schema caches after an ALTER TABLE in the same connection.
        for stmt in [
            "CREATE INDEX IF NOT EXISTS idx_service     ON search_history(service)",
            "CREATE INDEX IF NOT EXISTS idx_searched_at ON search_history(searched_at)",
            "CREATE INDEX IF NOT EXISTS idx_item        ON search_history(service, item_type, item_id)",
            "CREATE INDEX IF NOT EXISTS idx_year        ON search_history(release_year)",
        ]:
            conn.execute(stmt)
        conn.commit()

        # Step 4: media_queue – persistent list of items awaiting dispatch (queue model)
        conn.execute("""
            CREATE TABLE IF NOT EXISTS media_queue (
                id            INTEGER PRIMARY KEY AUTOINCREMENT,
                service       TEXT    NOT NULL,
                arr_type      TEXT    NOT NULL,
                item_type     TEXT    NOT NULL,
                item_id       INTEGER NOT NULL,
                series_id     INTEGER,
                season_number INTEGER,
                title         TEXT    NOT NULL DEFAULT '',
                release_dt    TEXT,
                release_year  INTEGER,
                last_modified TEXT,
                added_at      TEXT    NOT NULL,
                UNIQUE(service, item_type, item_id)
            )
        """)
        for stmt in [
            "CREATE INDEX IF NOT EXISTS idx_queue_service ON media_queue(service, arr_type)",
            "CREATE INDEX IF NOT EXISTS idx_queue_release ON media_queue(release_dt)",
            "CREATE INDEX IF NOT EXISTS idx_queue_type    ON media_queue(service, item_type)",
        ]:
            conn.execute(stmt)
        conn.commit()


# ─── Write ────────────────────────────────────────────────────────────────────

def upsert_search(service: str, item_type: str, item_id: int,
                  title: str, result: str = "triggered",
                  last_changed_at: Optional[str] = None,
                  release_year: Optional[int] = None):
    """Insert or update a search record. Increments search_count on conflict."""
    conn = _get_conn()
    now = datetime.utcnow().isoformat()
    with _lock:
        conn.execute("""
            INSERT INTO search_history
                (service, item_type, item_id, title, release_year,
                 searched_at, result, search_count, last_changed_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?)
            ON CONFLICT(service, item_type, item_id) DO UPDATE SET
                searched_at     = excluded.searched_at,
                title           = excluded.title,
                release_year    = COALESCE(excluded.release_year, release_year),
                result          = excluded.result,
                search_count    = search_count + 1,
                last_changed_at = COALESCE(excluded.last_changed_at, last_changed_at)
        """, (service, item_type, item_id, title, release_year,
              now, result, last_changed_at))
        conn.commit()


# ─── Read ─────────────────────────────────────────────────────────────────────

def is_on_cooldown(service: str, item_type: str, item_id: int,
                   cooldown_days: int) -> bool:
    """True if this item was searched within the cooldown window."""
    conn = _get_conn()
    cutoff = (datetime.utcnow() - timedelta(days=cooldown_days)).isoformat()
    with _lock:
        row = conn.execute("""
            SELECT searched_at FROM search_history
            WHERE service=? AND item_type=? AND item_id=? AND searched_at > ?
        """, (service, item_type, item_id, cutoff)).fetchone()
    return row is not None


def get_history(limit: int = 300, service: str = "",
                only_cooldown: bool = False,
                cooldown_days: int = 7) -> list:
    """Return recent history rows as plain dicts, newest first."""
    conn = _get_conn()
    cutoff = (datetime.utcnow() - timedelta(days=cooldown_days)).isoformat()
    wheres, params = [], []

    if service:
        wheres.append("service = ?"); params.append(service)
    if only_cooldown:
        wheres.append("searched_at > ?"); params.append(cutoff)

    where_sql = ("WHERE " + " AND ".join(wheres)) if wheres else ""
    params.append(limit)

    with _lock:
        rows = conn.execute(f"""
            SELECT *,
                   (searched_at > ?) AS on_cooldown
            FROM search_history
            {where_sql}
            ORDER BY searched_at DESC
            LIMIT ?
        """, [cutoff, *params]).fetchall()
    return [dict(r) for r in rows]


def count_today() -> int:
    """Number of dispatched/downloaded searches today (UTC date)."""
    conn = _get_conn()
    today = datetime.utcnow().strftime("%Y-%m-%d")
    with _lock:
        row = conn.execute("""
            SELECT COUNT(*) AS n FROM search_history
            WHERE searched_at LIKE ? AND result IN ('dispatched', 'downloaded')
        """, (today + "%",)).fetchone()
    return row["n"] if row else 0


def total_count() -> int:
    conn = _get_conn()
    with _lock:
        row = conn.execute(
            "SELECT COUNT(*) AS n FROM search_history").fetchone()
    return row["n"] if row else 0


def stats_by_service() -> dict:
    """Per-service summary totals."""
    conn = _get_conn()
    with _lock:
        rows = conn.execute("""
            SELECT service,
                   COUNT(*)             AS total,
                   SUM(search_count)    AS total_attempts,
                   MAX(searched_at)     AS last_search
            FROM search_history
            GROUP BY service
        """).fetchall()
    return {r["service"]: dict(r) for r in rows}


def year_stats() -> list:
    """Count of searched items grouped by release_year (for charts)."""
    conn = _get_conn()
    with _lock:
        rows = conn.execute("""
            SELECT release_year, COUNT(*) AS count
            FROM search_history
            WHERE release_year IS NOT NULL
            GROUP BY release_year
            ORDER BY release_year DESC
        """).fetchall()
    return [dict(r) for r in rows]


# ─── Purge / Clear ────────────────────────────────────────────────────────────

def purge_expired(cooldown_days: int) -> int:
    """Remove rows older than cooldown so they can be re-searched next time."""
    conn = _get_conn()
    cutoff = (datetime.utcnow() - timedelta(days=cooldown_days)).isoformat()
    with _lock:
        cur = conn.execute(
            "DELETE FROM search_history WHERE searched_at < ?", (cutoff,))
        conn.commit()
    return cur.rowcount


def clear_service(service: str) -> int:
    conn = _get_conn()
    with _lock:
        cur = conn.execute(
            "DELETE FROM search_history WHERE service=?", (service,))
        conn.commit()
    return cur.rowcount


def clear_all() -> int:
    conn = _get_conn()
    with _lock:
        cur = conn.execute("DELETE FROM search_history")
        conn.commit()
    return cur.rowcount


# ─── Queue (media_queue table) ────────────────────────────────────────────────

def queue_upsert(service: str, arr_type: str, item_type: str, item_id: int,
                 title: str, series_id=None, season_number=None,
                 release_dt: Optional[str] = None,
                 release_year: Optional[int] = None,
                 last_modified: Optional[str] = None):
    """Insert or update a queue entry. Does not reset existing entries."""
    conn = _get_conn()
    now = datetime.utcnow().isoformat()
    with _lock:
        conn.execute("""
            INSERT INTO media_queue
                (service, arr_type, item_type, item_id, series_id, season_number,
                 title, release_dt, release_year, last_modified, added_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(service, item_type, item_id) DO UPDATE SET
                title         = excluded.title,
                series_id     = COALESCE(excluded.series_id,     series_id),
                season_number = COALESCE(excluded.season_number, season_number),
                release_dt    = COALESCE(excluded.release_dt,    release_dt),
                release_year  = COALESCE(excluded.release_year,  release_year),
                last_modified = COALESCE(excluded.last_modified, last_modified)
        """, (service, arr_type, item_type, item_id, series_id, season_number,
              title, release_dt, release_year, last_modified, now))
        conn.commit()


def queue_get_pending(service: str, arr_type: str, cooldown_days: int,
                      limit: int = 500) -> list:
    """Items that are released and not recently dispatched/downloaded."""
    conn = _get_conn()
    today  = datetime.utcnow().strftime("%Y-%m-%d")
    cutoff = (datetime.utcnow() - timedelta(days=cooldown_days)).isoformat()
    with _lock:
        rows = conn.execute("""
            SELECT q.* FROM media_queue q
            WHERE q.service  = ?
              AND q.arr_type = ?
              AND (q.release_dt IS NULL OR q.release_dt <= ?)
              AND NOT EXISTS (
                  SELECT 1 FROM search_history sh
                  WHERE sh.service   = q.service
                    AND sh.item_type = q.item_type
                    AND sh.item_id   = q.item_id
                    AND sh.searched_at > ?
              )
            ORDER BY q.release_dt ASC NULLS LAST
            LIMIT ?
        """, (service, arr_type, today, cutoff, limit)).fetchall()
    return [dict(r) for r in rows]


def queue_count(service: str = "", arr_type: str = "", item_type: str = "") -> int:
    """Count queue entries, optionally filtered."""
    conn = _get_conn()
    wheres, params = [], []
    if service:   wheres.append("service = ?");   params.append(service)
    if arr_type:  wheres.append("arr_type = ?");  params.append(arr_type)
    if item_type: wheres.append("item_type = ?"); params.append(item_type)
    where = ("WHERE " + " AND ".join(wheres)) if wheres else ""
    with _lock:
        return conn.execute(
            f"SELECT COUNT(*) FROM media_queue {where}", params).fetchone()[0]


def queue_remove_stale(service: str, item_type: str, current_ids: set) -> int:
    """Remove queue rows for a service+item_type no longer present in Arr."""
    if not current_ids:  # safety: never delete everything on empty scan result
        return 0
    conn = _get_conn()
    with _lock:
        rows = conn.execute(
            "SELECT item_id FROM media_queue WHERE service = ? AND item_type = ?",
            (service, item_type)).fetchall()
        stale = [r[0] for r in rows if r[0] not in current_ids]
        if not stale:
            return 0
        placeholders = ",".join("?" * len(stale))
        conn.execute(
            f"DELETE FROM media_queue WHERE service = ? AND item_type = ? "
            f"AND item_id IN ({placeholders})",
            [service, item_type, *stale])
        conn.commit()
    return len(stale)


def queue_clear(service: str = "") -> int:
    """Delete all queue entries, optionally for a single instance."""
    conn = _get_conn()
    with _lock:
        if service:
            cur = conn.execute("DELETE FROM media_queue WHERE service = ?", (service,))
        else:
            cur = conn.execute("DELETE FROM media_queue")
        conn.commit()
    return cur.rowcount



