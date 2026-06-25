import json
from unittest.mock import MagicMock, patch

import pytest

from youtube_music_mcp.tools import (
    add_song_to_playlist,
    get_playlist_items_tool,
    list_playlists,
    search_songs,
)


FAKE_PLAYLISTS = [
    {
        "id": "PLabc123",
        "title": "My Mix",
        "description": "A mix",
        "privacy": "private",
        "item_count": 2,
        "cached_at": 1700000000,
    }
]

FAKE_ITEMS = [
    {
        "set_video_id": "svid1",
        "playlist_id": "PLabc123",
        "video_id": "vid1",
        "title": "Song One",
        "artist": "Artist A",
        "album": "Album X",
        "duration_seconds": 200,
        "position": 0,
        "cached_at": 1700000000,
    }
]

FAKE_SEARCH_RESULTS = [
    {
        "video_id": "vid42",
        "title": "Search Hit",
        "artist": "Band",
        "album": "Record",
        "duration_seconds": 180,
    }
]

RAW_PLAYLISTS = [
    {
        "playlistId": "PLabc123",
        "title": "My Mix",
        "description": "A mix",
        "privacy": "PRIVATE",
        "count": 2,
    }
]

RAW_TRACKS = [
    {
        "setVideoId": "svid1",
        "videoId": "vid1",
        "title": "Song One",
        "artists": [{"name": "Artist A"}],
        "album": {"name": "Album X"},
        "duration_seconds": 200,
    }
]

RAW_SEARCH = [
    {
        "videoId": "vid42",
        "title": "Search Hit",
        "artists": [{"name": "Band"}],
        "album": {"name": "Record"},
        "duration_seconds": 180,
    }
]


class TestListPlaylists:
    def test_returns_cached_when_populated(self) -> None:
        with (
            patch("youtube_music_mcp.tools.get_playlists", return_value=FAKE_PLAYLISTS),
            patch("youtube_music_mcp.tools.get_ytmusic") as mock_yt,
        ):
            result = list_playlists()
            mock_yt.assert_not_called()
            assert json.loads(result) == FAKE_PLAYLISTS

    def test_fetches_and_caches_when_empty(self) -> None:
        mock_ytmusic = MagicMock()
        mock_ytmusic.get_library_playlists.return_value = RAW_PLAYLISTS
        with (
            patch("youtube_music_mcp.tools.get_playlists", return_value=[]),
            patch("youtube_music_mcp.tools.get_ytmusic", return_value=mock_ytmusic),
            patch("youtube_music_mcp.tools.upsert_playlists") as mock_upsert,
        ):
            result = list_playlists()
            mock_ytmusic.get_library_playlists.assert_called_once_with(limit=None)
            mock_upsert.assert_called_once()
            data = json.loads(result)
            assert len(data) == 1
            assert data[0]["id"] == "PLabc123"
            assert data[0]["title"] == "My Mix"


class TestSearchSongs:
    def test_returns_cache_hit(self) -> None:
        with (
            patch(
                "youtube_music_mcp.tools.get_search_cache",
                return_value=FAKE_SEARCH_RESULTS,
            ),
            patch("youtube_music_mcp.tools.get_ytmusic") as mock_yt,
        ):
            result = search_songs("some query")
            mock_yt.assert_not_called()
            assert json.loads(result) == FAKE_SEARCH_RESULTS

    def test_fetches_and_caches_on_miss(self) -> None:
        mock_ytmusic = MagicMock()
        mock_ytmusic.search.return_value = RAW_SEARCH
        with (
            patch("youtube_music_mcp.tools.get_search_cache", return_value=None),
            patch("youtube_music_mcp.tools.get_ytmusic", return_value=mock_ytmusic),
            patch("youtube_music_mcp.tools.set_search_cache") as mock_set,
        ):
            result = search_songs("search hit")
            mock_ytmusic.search.assert_called_once_with(
                "search hit", filter="songs", limit=5
            )
            mock_set.assert_called_once()
            data = json.loads(result)
            assert len(data) == 1
            assert data[0]["video_id"] == "vid42"
            assert data[0]["artist"] == "Band"


class TestAddSongToPlaylist:
    def test_adds_to_regular_playlist_and_upserts_cache(self) -> None:
        mock_ytmusic = MagicMock()
        mock_ytmusic.add_playlist_items.return_value = {
            "playlistEditResults": [{"setVideoId": "svid_new"}]
        }
        with (
            patch("youtube_music_mcp.tools.get_ytmusic", return_value=mock_ytmusic),
            patch("youtube_music_mcp.tools.upsert_playlist_items") as mock_upsert,
        ):
            result = add_song_to_playlist("PLabc123", "vid99")
            mock_ytmusic.add_playlist_items.assert_called_once_with("PLabc123", ["vid99"])
            mock_upsert.assert_called_once()
            data = json.loads(result)
            assert data["video_id"] == "vid99"
            assert data["set_video_id"] == "svid_new"

    def test_likes_song_for_liked_playlist(self) -> None:
        mock_ytmusic = MagicMock()
        with patch("youtube_music_mcp.tools.get_ytmusic", return_value=mock_ytmusic):
            result = add_song_to_playlist("liked", "vid99")
            mock_ytmusic.rate_song.assert_called_once_with("vid99", "LIKE")
            mock_ytmusic.add_playlist_items.assert_not_called()
            data = json.loads(result)
            assert data["action"] == "liked"


class TestExceptionHandling:
    def test_ytmusicapi_exception_returned_as_error_string(self) -> None:
        with (
            patch("youtube_music_mcp.tools.get_playlists", return_value=[]),
            patch(
                "youtube_music_mcp.tools.get_ytmusic",
                side_effect=RuntimeError("Not authenticated"),
            ),
        ):
            result = list_playlists()
            assert result.startswith("Error: ")
            assert "Not authenticated" in result

    def test_search_exception_returned_as_error_string(self) -> None:
        with (
            patch("youtube_music_mcp.tools.get_search_cache", return_value=None),
            patch(
                "youtube_music_mcp.tools.get_ytmusic",
                side_effect=Exception("network failure"),
            ),
        ):
            result = search_songs("anything")
            assert result.startswith("Error: ")
            assert "network failure" in result


class TestGetPlaylistItems:
    def test_resolves_liked_via_get_meta(self) -> None:
        mock_ytmusic = MagicMock()
        mock_ytmusic.get_playlist.return_value = {"tracks": RAW_TRACKS, "title": "Liked"}
        with (
            patch(
                "youtube_music_mcp.tools.get_meta", return_value="PLliked99"
            ),
            patch(
                "youtube_music_mcp.tools.get_playlist_items", return_value=[]
            ),
            patch("youtube_music_mcp.tools.get_playlists", return_value=FAKE_PLAYLISTS),
            patch("youtube_music_mcp.tools.get_ytmusic", return_value=mock_ytmusic),
            patch("youtube_music_mcp.tools.upsert_playlist_items"),
            patch("youtube_music_mcp.tools.upsert_playlists"),
        ):
            result = get_playlist_items_tool("liked")
            mock_ytmusic.get_playlist.assert_called_once_with("PLliked99", limit=None)
            data = json.loads(result)
            assert data[0]["video_id"] == "vid1"

    def test_raises_error_when_liked_id_missing(self) -> None:
        with patch("youtube_music_mcp.tools.get_meta", return_value=None):
            result = get_playlist_items_tool("liked")
            assert result.startswith("Error: ")
            assert "liked_music_playlist_id" in result or "Liked Music" in result

    def test_returns_cached_items(self) -> None:
        with (
            patch("youtube_music_mcp.tools.get_meta", return_value="PLabc123"),
            patch(
                "youtube_music_mcp.tools.get_playlist_items", return_value=FAKE_ITEMS
            ),
            patch("youtube_music_mcp.tools.get_ytmusic") as mock_yt,
        ):
            result = get_playlist_items_tool("PLabc123")
            mock_yt.assert_not_called()
            assert json.loads(result) == FAKE_ITEMS
