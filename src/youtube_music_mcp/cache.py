import json
import sqlite3
import time
from pathlib import Path
from typing import Optional

from .types import Playlist, PlaylistItem, SearchResult

_SCHEMA_PATH = Path(__file__).parent.parent.parent / "schema.sql"
_DEFAULT_DB_PATH = Path.home() / ".config" / "youtube-music-mcp" / "cache.db"
_SEARCH_TTL = 3600

_conn: Optional[sqlite3.Connection] = None


def init_db(db_path: str | None = None) -> None:
    global _conn
    path = Path(db_path) if db_path else _DEFAULT_DB_PATH
    path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(path))
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=ON")
    conn.executescript(_SCHEMA_PATH.read_text())
    conn.commit()
    _conn = conn


def get_db() -> sqlite3.Connection:
    if _conn is None:
        raise RuntimeError("Database not initialized. Call init_db() first.")
    return _conn


def _resolve(conn: Optional[sqlite3.Connection]) -> sqlite3.Connection:
    return conn if conn is not None else get_db()


def get_playlists(conn: Optional[sqlite3.Connection] = None) -> list[Playlist]:
    c = _resolve(conn)
    rows = c.execute("SELECT * FROM playlists").fetchall()
    return [dict(row) for row in rows]  # type: ignore[return-value]


def upsert_playlists(
    playlists: list[Playlist], conn: Optional[sqlite3.Connection] = None
) -> None:
    c = _resolve(conn)
    c.executemany(
        """
        INSERT OR REPLACE INTO playlists
            (id, title, description, privacy, item_count, cached_at)
        VALUES
            (:id, :title, :description, :privacy, :item_count, :cached_at)
        """,
        playlists,
    )
    c.commit()


def delete_cached_playlist(
    playlist_id: str, conn: Optional[sqlite3.Connection] = None
) -> None:
    c = _resolve(conn)
    c.execute("DELETE FROM playlists WHERE id = ?", (playlist_id,))
    c.commit()


def get_playlist_items(
    playlist_id: str, conn: Optional[sqlite3.Connection] = None
) -> list[PlaylistItem]:
    c = _resolve(conn)
    rows = c.execute(
        "SELECT * FROM playlist_items WHERE playlist_id = ? ORDER BY position",
        (playlist_id,),
    ).fetchall()
    return [dict(row) for row in rows]  # type: ignore[return-value]


def upsert_playlist_items(
    items: list[PlaylistItem], conn: Optional[sqlite3.Connection] = None
) -> None:
    c = _resolve(conn)
    c.executemany(
        """
        INSERT OR REPLACE INTO playlist_items
            (set_video_id, playlist_id, video_id, title, artist, album,
             duration_seconds, position, cached_at)
        VALUES
            (:set_video_id, :playlist_id, :video_id, :title, :artist, :album,
             :duration_seconds, :position, :cached_at)
        """,
        items,
    )
    c.commit()


def remove_playlist_item(
    set_video_id: str, conn: Optional[sqlite3.Connection] = None
) -> None:
    c = _resolve(conn)
    c.execute("DELETE FROM playlist_items WHERE set_video_id = ?", (set_video_id,))
    c.commit()


def clear_playlist_items(
    playlist_id: str, conn: Optional[sqlite3.Connection] = None
) -> None:
    c = _resolve(conn)
    c.execute("DELETE FROM playlist_items WHERE playlist_id = ?", (playlist_id,))
    c.commit()


def get_search_cache(
    query: str, conn: Optional[sqlite3.Connection] = None
) -> list[SearchResult] | None:
    c = _resolve(conn)
    row = c.execute(
        "SELECT results_json, cached_at FROM search_cache WHERE query_key = ?",
        (query,),
    ).fetchone()
    if row is None:
        return None
    if time.time() - row["cached_at"] > _SEARCH_TTL:
        return None
    return json.loads(row["results_json"])  # type: ignore[return-value]


def set_search_cache(
    query: str,
    results: list[SearchResult],
    conn: Optional[sqlite3.Connection] = None,
) -> None:
    c = _resolve(conn)
    c.execute(
        """
        INSERT OR REPLACE INTO search_cache (query_key, results_json, cached_at)
        VALUES (?, ?, ?)
        """,
        (query, json.dumps(results), int(time.time())),
    )
    c.commit()


def get_meta(key: str, conn: Optional[sqlite3.Connection] = None) -> str | None:
    c = _resolve(conn)
    row = c.execute("SELECT value FROM meta WHERE key = ?", (key,)).fetchone()
    return row["value"] if row else None


def set_meta(
    key: str, value: str, conn: Optional[sqlite3.Connection] = None
) -> None:
    c = _resolve(conn)
    c.execute(
        "INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)",
        (key, value),
    )
    c.commit()
