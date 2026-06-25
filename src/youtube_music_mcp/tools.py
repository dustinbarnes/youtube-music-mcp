import json
import time

from mcp.server.fastmcp import FastMCP

from .auth import get_ytmusic
from .cache import (
    clear_playlist_items,
    delete_cached_playlist,
    get_meta,
    get_playlist_items,
    get_playlists,
    get_search_cache,
    remove_playlist_item,
    set_search_cache,
    upsert_playlist_items,
    upsert_playlists,
)
from .types import Playlist, PlaylistItem, SearchResult

mcp = FastMCP("youtube-music-mcp")


def _now() -> int:
    return int(time.time())


def _map_playlist(raw: dict) -> Playlist:
    return Playlist(
        id=raw["playlistId"],
        title=raw.get("title", ""),
        description=raw.get("description") or "",
        privacy=raw.get("privacy", "private") or "private",
        item_count=raw.get("count", 0) or 0,
        cached_at=_now(),
    )


def _map_track(raw: dict, playlist_id: str, position: int) -> PlaylistItem:
    artists = raw.get("artists") or []
    artist = artists[0]["name"] if artists else ""
    album_obj = raw.get("album")
    album = album_obj["name"] if album_obj else ""
    return PlaylistItem(
        set_video_id=raw.get("setVideoId") or raw.get("videoId", ""),
        playlist_id=playlist_id,
        video_id=raw.get("videoId", ""),
        title=raw.get("title", ""),
        artist=artist,
        album=album,
        duration_seconds=raw.get("duration_seconds") or 0,
        position=position,
        cached_at=_now(),
    )


def _map_search_result(raw: dict) -> SearchResult:
    artists = raw.get("artists") or []
    artist = artists[0]["name"] if artists else ""
    album_obj = raw.get("album")
    album = album_obj["name"] if album_obj else ""
    return SearchResult(
        video_id=raw.get("videoId", ""),
        title=raw.get("title", ""),
        artist=artist,
        album=album,
        duration_seconds=raw.get("duration_seconds") or 0,
    )


@mcp.tool()
def list_playlists() -> str:
    """List all playlists from cache or YouTube Music library."""
    try:
        cached = get_playlists()
        if cached:
            return json.dumps(cached)
        ytmusic = get_ytmusic()
        raw = ytmusic.get_library_playlists(limit=None)
        playlists = [_map_playlist(p) for p in raw]
        upsert_playlists(playlists)
        return json.dumps(playlists)
    except Exception as e:
        return f"Error: {e}"


@mcp.tool()
def get_playlist_items_tool(playlist_id: str) -> str:
    """Get items in a playlist. Use 'liked' for Liked Music."""
    try:
        resolved_id = playlist_id
        if playlist_id == "liked":
            resolved_id = get_meta("liked_music_playlist_id")
            if not resolved_id:
                raise ValueError(
                    "Liked Music playlist ID not found in cache. "
                    "Run refresh_playlists first to populate it."
                )
        cached = get_playlist_items(resolved_id)
        if cached:
            return json.dumps(cached)
        ytmusic = get_ytmusic()
        data = ytmusic.get_playlist(resolved_id, limit=None)
        tracks = data.get("tracks") or []
        items = [_map_track(t, resolved_id, i) for i, t in enumerate(tracks)]
        existing_playlists = get_playlists()
        ids = {p["id"] for p in existing_playlists}
        if resolved_id not in ids:
            placeholder = Playlist(
                id=resolved_id,
                title=data.get("title", ""),
                description=data.get("description") or "",
                privacy="private",
                item_count=len(items),
                cached_at=_now(),
            )
            upsert_playlists([placeholder])
        upsert_playlist_items(items)
        return json.dumps(items)
    except Exception as e:
        return f"Error: {e}"


@mcp.tool()
def create_playlist(
    title: str, description: str = "", visibility: str = "private"
) -> str:
    """Create a new YouTube Music playlist."""
    try:
        ytmusic = get_ytmusic()
        result = ytmusic.create_playlist(
            title, description, privacy_status=visibility
        )
        playlist_id: str = result if isinstance(result, str) else result.get("playlistId", "")
        playlist = Playlist(
            id=playlist_id,
            title=title,
            description=description,
            privacy=visibility,  # type: ignore[arg-type]
            item_count=0,
            cached_at=_now(),
        )
        upsert_playlists([playlist])
        return json.dumps({"playlist_id": playlist_id, "title": title})
    except Exception as e:
        return f"Error: {e}"


@mcp.tool()
def update_playlist(playlist_id: str, title: str, description: str) -> str:
    """Update the title and description of a playlist."""
    try:
        ytmusic = get_ytmusic()
        ytmusic.edit_playlist(playlist_id, title=title, description=description)
        existing = get_playlists()
        for p in existing:
            if p["id"] == playlist_id:
                p["title"] = title
                p["description"] = description
                p["cached_at"] = _now()
                upsert_playlists([p])
                break
        return json.dumps({"status": "ok", "playlist_id": playlist_id})
    except Exception as e:
        return f"Error: {e}"


@mcp.tool()
def delete_playlist(playlist_id: str) -> str:
    """Delete a YouTube Music playlist."""
    try:
        ytmusic = get_ytmusic()
        ytmusic.delete_playlist(playlist_id)
        delete_cached_playlist(playlist_id)
        return f"Playlist {playlist_id} deleted."
    except Exception as e:
        return f"Error: {e}"


@mcp.tool()
def search_songs(query: str) -> str:
    """Search YouTube Music for songs."""
    try:
        cached = get_search_cache(query)
        if cached is not None:
            return json.dumps(cached)
        ytmusic = get_ytmusic()
        raw = ytmusic.search(query, filter="songs", limit=5)
        results = [_map_search_result(r) for r in raw]
        set_search_cache(query, results)
        return json.dumps(results)
    except Exception as e:
        return f"Error: {e}"


@mcp.tool()
def add_song_to_playlist(playlist_id: str, video_id: str) -> str:
    """Add a song to a playlist. Use 'liked' to like a song."""
    try:
        ytmusic = get_ytmusic()
        if playlist_id == "liked":
            ytmusic.rate_song(video_id, "LIKE")
            return json.dumps({"status": "ok", "action": "liked", "video_id": video_id})
        result = ytmusic.add_playlist_items(playlist_id, [video_id])
        set_video_id = video_id
        title = ""
        if isinstance(result, dict):
            tracks = result.get("playlistEditResults") or []
            if tracks:
                set_video_id = tracks[0].get("setVideoId", video_id)
        item = PlaylistItem(
            set_video_id=set_video_id,
            playlist_id=playlist_id,
            video_id=video_id,
            title=title,
            artist="",
            album="",
            duration_seconds=0,
            position=0,
            cached_at=_now(),
        )
        upsert_playlist_items([item])
        return json.dumps({"status": "ok", "video_id": video_id, "set_video_id": set_video_id})
    except Exception as e:
        return f"Error: {e}"


@mcp.tool()
def remove_song_from_playlist(playlist_id: str, set_video_id: str) -> str:
    """Remove a song from a playlist by its set_video_id."""
    try:
        ytmusic = get_ytmusic()
        cached_items = get_playlist_items(playlist_id) if playlist_id != "liked" else []
        video_id = set_video_id
        for item in cached_items:
            if item["set_video_id"] == set_video_id:
                video_id = item["video_id"]
                break
        if playlist_id == "liked":
            liked_id = get_meta("liked_music_playlist_id") or ""
            all_items = get_playlist_items(liked_id) if liked_id else []
            for item in all_items:
                if item["set_video_id"] == set_video_id:
                    video_id = item["video_id"]
                    break
            ytmusic.rate_song(video_id, "INDIFFERENT")
        else:
            ytmusic.remove_playlist_items(
                playlist_id,
                [{"videoId": video_id, "setVideoId": set_video_id}],
            )
        remove_playlist_item(set_video_id)
        return f"Removed {set_video_id} from playlist {playlist_id}."
    except Exception as e:
        return f"Error: {e}"


@mcp.tool()
def refresh_playlists() -> str:
    """Force-refresh all playlists and their items from YouTube Music."""
    try:
        ytmusic = get_ytmusic()
        raw = ytmusic.get_library_playlists(limit=None)
        playlists = [_map_playlist(p) for p in raw]
        upsert_playlists(playlists)
        item_counts: dict[str, int] = {}
        for playlist in playlists:
            pid = playlist["id"]
            data = ytmusic.get_playlist(pid, limit=None)
            tracks = data.get("tracks") or []
            items = [_map_track(t, pid, i) for i, t in enumerate(tracks)]
            clear_playlist_items(pid)
            if items:
                upsert_playlist_items(items)
            item_counts[pid] = len(items)
        return json.dumps({"playlists": len(playlists), "item_counts": item_counts})
    except Exception as e:
        return f"Error: {e}"


@mcp.tool()
def get_mood_categories() -> str:
    """Get available mood categories from YouTube Music."""
    try:
        ytmusic = get_ytmusic()
        result = ytmusic.get_mood_categories()
        return json.dumps(result)
    except Exception as e:
        return f"Error: {e}"


@mcp.tool()
def get_mood_playlists(params: str) -> str:
    """Get playlists for a mood category using its params string."""
    try:
        ytmusic = get_ytmusic()
        result = ytmusic.get_mood_playlists(params)
        return json.dumps(result)
    except Exception as e:
        return f"Error: {e}"


@mcp.tool()
def get_liked_songs() -> str:
    """Get all liked songs from YouTube Music."""
    try:
        ytmusic = get_ytmusic()
        data = ytmusic.get_liked_songs(limit=None)
        tracks = data.get("tracks") or []
        playlist_id = data.get("playlistId", "")
        items = [_map_track(t, playlist_id, i) for i, t in enumerate(tracks)]
        return json.dumps(items)
    except Exception as e:
        return f"Error: {e}"


@mcp.tool()
def get_song_related(video_id: str) -> str:
    """Get related content for a song by video ID."""
    try:
        ytmusic = get_ytmusic()
        result = ytmusic.get_song_related(video_id)
        return json.dumps(result)
    except Exception as e:
        return f"Error: {e}"
