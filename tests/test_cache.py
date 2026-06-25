import sqlite3
import time
from pathlib import Path

import pytest

from youtube_music_mcp import cache
from youtube_music_mcp.types import Playlist, PlaylistItem, SearchResult

_SCHEMA_PATH = Path(__file__).parent.parent / "schema.sql"


@pytest.fixture
def conn() -> sqlite3.Connection:
    c = sqlite3.connect(":memory:")
    c.row_factory = sqlite3.Row
    c.execute("PRAGMA foreign_keys=ON")
    c.executescript(_SCHEMA_PATH.read_text())
    c.commit()
    return c


def _playlist(id: str = "pl1", title: str = "My List") -> Playlist:
    return Playlist(
        id=id,
        title=title,
        description="desc",
        privacy="private",
        item_count=0,
        cached_at=int(time.time()),
    )


def _item(set_video_id: str, playlist_id: str, position: int = 0) -> PlaylistItem:
    return PlaylistItem(
        set_video_id=set_video_id,
        playlist_id=playlist_id,
        video_id="vid1",
        title="Song",
        artist="Artist",
        album="Album",
        duration_seconds=180,
        position=position,
        cached_at=int(time.time()),
    )


def test_upsert_and_get_playlists(conn: sqlite3.Connection) -> None:
    cache.upsert_playlists([_playlist()], conn=conn)
    result = cache.get_playlists(conn=conn)
    assert len(result) == 1
    assert result[0]["id"] == "pl1"
    assert result[0]["title"] == "My List"


def test_upsert_playlist_twice_results_in_one_updated_row(
    conn: sqlite3.Connection,
) -> None:
    cache.upsert_playlists([_playlist(title="Original")], conn=conn)
    cache.upsert_playlists([_playlist(title="Updated")], conn=conn)
    result = cache.get_playlists(conn=conn)
    assert len(result) == 1
    assert result[0]["title"] == "Updated"


def test_delete_cached_playlist_removes_playlist_and_cascades_items(
    conn: sqlite3.Connection,
) -> None:
    cache.upsert_playlists([_playlist()], conn=conn)
    cache.upsert_playlist_items([_item("sv1", "pl1")], conn=conn)

    cache.delete_cached_playlist("pl1", conn=conn)

    assert cache.get_playlists(conn=conn) == []
    assert cache.get_playlist_items("pl1", conn=conn) == []


def test_get_playlist_items_returns_correct_playlist_only(
    conn: sqlite3.Connection,
) -> None:
    cache.upsert_playlists([_playlist("pl1"), _playlist("pl2")], conn=conn)
    cache.upsert_playlist_items(
        [_item("sv1", "pl1"), _item("sv2", "pl2")], conn=conn
    )

    items = cache.get_playlist_items("pl1", conn=conn)
    assert len(items) == 1
    assert items[0]["set_video_id"] == "sv1"


def test_get_playlist_items_ordered_by_position(conn: sqlite3.Connection) -> None:
    cache.upsert_playlists([_playlist()], conn=conn)
    cache.upsert_playlist_items(
        [_item("sv3", "pl1", position=2), _item("sv1", "pl1", position=0), _item("sv2", "pl1", position=1)],
        conn=conn,
    )

    items = cache.get_playlist_items("pl1", conn=conn)
    assert [i["set_video_id"] for i in items] == ["sv1", "sv2", "sv3"]


def test_clear_playlist_items_removes_items_but_not_playlist(
    conn: sqlite3.Connection,
) -> None:
    cache.upsert_playlists([_playlist()], conn=conn)
    cache.upsert_playlist_items([_item("sv1", "pl1"), _item("sv2", "pl1", 1)], conn=conn)

    cache.clear_playlist_items("pl1", conn=conn)

    assert cache.get_playlist_items("pl1", conn=conn) == []
    assert len(cache.get_playlists(conn=conn)) == 1


def test_get_search_cache_returns_none_on_miss(conn: sqlite3.Connection) -> None:
    assert cache.get_search_cache("some query", conn=conn) is None


def test_get_search_cache_returns_none_for_stale_entry(
    conn: sqlite3.Connection,
) -> None:
    results: list[SearchResult] = [
        SearchResult(
            video_id="v1", title="T", artist="A", album="B", duration_seconds=100
        )
    ]
    import json

    stale_time = int(time.time()) - 3601
    conn.execute(
        "INSERT INTO search_cache (query_key, results_json, cached_at) VALUES (?, ?, ?)",
        ("stale query", json.dumps(results), stale_time),
    )
    conn.commit()

    assert cache.get_search_cache("stale query", conn=conn) is None


def test_get_search_cache_returns_results_for_fresh_entry(
    conn: sqlite3.Connection,
) -> None:
    results: list[SearchResult] = [
        SearchResult(
            video_id="v1", title="Track", artist="Band", album="Record", duration_seconds=200
        )
    ]
    cache.set_search_cache("fresh query", results, conn=conn)

    cached = cache.get_search_cache("fresh query", conn=conn)
    assert cached is not None
    assert len(cached) == 1
    assert cached[0]["video_id"] == "v1"
    assert cached[0]["title"] == "Track"


def test_get_meta_and_set_meta_round_trip(conn: sqlite3.Connection) -> None:
    assert cache.get_meta("missing_key", conn=conn) is None

    cache.set_meta("my_key", "my_value", conn=conn)
    assert cache.get_meta("my_key", conn=conn) == "my_value"

    cache.set_meta("my_key", "updated_value", conn=conn)
    assert cache.get_meta("my_key", conn=conn) == "updated_value"
