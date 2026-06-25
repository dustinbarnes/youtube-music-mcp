from typing import TypedDict, Literal, Optional


class Playlist(TypedDict):
    id: str
    title: str
    description: str
    privacy: Literal["public", "private", "unlisted"]
    item_count: int
    cached_at: int


class PlaylistItem(TypedDict):
    set_video_id: str       # ytmusicapi's identifier for removal operations
    playlist_id: str
    video_id: str
    title: str
    artist: str
    album: str
    duration_seconds: int
    position: int
    cached_at: int


class SearchResult(TypedDict):
    video_id: str
    title: str
    artist: str
    album: str
    duration_seconds: int


class MoodCategory(TypedDict):
    title: str
    params: str


class MoodPlaylist(TypedDict):
    title: str
    playlist_id: str
    description: str
