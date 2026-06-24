export interface Playlist {
  id: string;
  title: string;
  description: string;
  privacy: 'public' | 'private' | 'unlisted';
  itemCount: number;
  cachedAt: number;
}

export interface PlaylistItem {
  playlistItemId: string;
  playlistId: string;
  videoId: string;
  title: string;
  channel: string;
  durationSeconds: number;
  position: number;
  cachedAt: number;
}

export interface SearchResult {
  videoId: string;
  title: string;
  channel: string;
  durationSeconds: number;
}

export class QuotaExceededError extends Error {
  constructor() {
    super('YouTube API quota exceeded. Resets at midnight Pacific time. Cached playlist data is still available — use list_playlists or get_playlist_items to work from cache.');
    this.name = 'QuotaExceededError';
  }
}

export class YouTubeApiError extends Error {
  constructor(public statusCode: number, message: string) {
    super(message);
    this.name = 'YouTubeApiError';
  }
}
