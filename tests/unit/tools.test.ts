import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Playlist, PlaylistItem, SearchResult } from '../../src/types/index.js';
import { QuotaExceededError } from '../../src/types/index.js';

vi.mock('../../src/cache/index.js', () => ({
  getPlaylists: vi.fn(),
  upsertPlaylists: vi.fn(),
  deleteCachedPlaylist: vi.fn(),
  getPlaylistItems: vi.fn(),
  upsertPlaylistItems: vi.fn(),
  removePlaylistItem: vi.fn(),
  clearPlaylistItems: vi.fn(),
  getSearchCache: vi.fn(),
  setSearchCache: vi.fn(),
  getMeta: vi.fn(),
  setMeta: vi.fn(),
  initDatabase: vi.fn(),
}));

vi.mock('../../src/youtube/index.js', () => ({
  listPlaylists: vi.fn(),
  getPlaylistItems: vi.fn(),
  createPlaylist: vi.fn(),
  updatePlaylist: vi.fn(),
  deletePlaylist: vi.fn(),
  searchVideos: vi.fn(),
  addVideoToPlaylist: vi.fn(),
  removeVideoFromPlaylist: vi.fn(),
}));

import * as cache from '../../src/cache/index.js';
import * as youtube from '../../src/youtube/index.js';
import { registerTools } from '../../src/tools/index.js';

type ToolResult = { content: [{ type: string; text: string }] };
type ToolHandler = (args: Record<string, unknown>) => Promise<ToolResult>;

function buildServer(): { call: (name: string, args?: Record<string, unknown>) => Promise<ToolResult> } {
  const handlers = new Map<string, ToolHandler>();
  const mockServer = {
    registerTool: (name: string, _config: unknown, handler: ToolHandler) => {
      handlers.set(name, handler);
    },
  };

  const mockAuth = {} as import('google-auth-library').OAuth2Client;
  registerTools(mockServer as unknown as import('@modelcontextprotocol/sdk/server/mcp.js').McpServer, mockAuth);

  return {
    call: (name: string, args: Record<string, unknown> = {}) => {
      const handler = handlers.get(name);
      if (!handler) throw new Error(`Tool not registered: ${name}`);
      return handler(args);
    },
  };
}

const PLAYLIST: Playlist = {
  id: 'pl-1',
  title: 'My Playlist',
  description: '',
  privacy: 'private',
  itemCount: 2,
  cachedAt: Date.now(),
};

const LIKED_PLAYLIST: Playlist = {
  id: 'liked-id',
  title: 'Liked Music',
  description: '',
  privacy: 'private',
  itemCount: 10,
  cachedAt: Date.now(),
};

const ITEM: PlaylistItem = {
  playlistItemId: 'pli-1',
  playlistId: 'pl-1',
  videoId: 'vid-1',
  title: 'Song One',
  channel: 'Artist',
  durationSeconds: 200,
  position: 0,
  cachedAt: Date.now(),
};

const SEARCH_RESULT: SearchResult = {
  videoId: 'vid-1',
  title: 'Song One',
  channel: 'Artist',
  durationSeconds: 200,
};

beforeEach(() => {
  vi.resetAllMocks();
});

describe('list_playlists', () => {
  it('returns cached data without calling the YouTube client when cache is populated', async () => {
    vi.mocked(cache.getPlaylists).mockReturnValue([PLAYLIST]);
    const server = buildServer();
    const result = await server.call('list_playlists');
    expect(JSON.parse(result.content[0].text)).toEqual([PLAYLIST]);
    expect(youtube.listPlaylists).not.toHaveBeenCalled();
  });

  it('fetches from API and populates cache when cache is empty', async () => {
    vi.mocked(cache.getPlaylists).mockReturnValue([]);
    vi.mocked(youtube.listPlaylists).mockResolvedValue([PLAYLIST]);
    const server = buildServer();
    await server.call('list_playlists');
    expect(youtube.listPlaylists).toHaveBeenCalled();
    expect(cache.upsertPlaylists).toHaveBeenCalledWith([PLAYLIST]);
  });

  it('stores Liked Music playlist ID in meta when found', async () => {
    vi.mocked(cache.getPlaylists).mockReturnValue([]);
    vi.mocked(youtube.listPlaylists).mockResolvedValue([PLAYLIST, LIKED_PLAYLIST]);
    const server = buildServer();
    await server.call('list_playlists');
    expect(cache.setMeta).toHaveBeenCalledWith('liked_music_playlist_id', 'liked-id');
  });
});

describe('get_playlist_items', () => {
  it('returns cached items when available', async () => {
    vi.mocked(cache.getMeta).mockReturnValue(null);
    vi.mocked(cache.getPlaylistItems).mockReturnValue([ITEM]);
    const server = buildServer();
    const result = await server.call('get_playlist_items', { playlistId: 'pl-1' });
    expect(JSON.parse(result.content[0].text)).toEqual([ITEM]);
    expect(youtube.getPlaylistItems).not.toHaveBeenCalled();
  });

  it('fetches from API when cache is empty', async () => {
    vi.mocked(cache.getMeta).mockReturnValue(null);
    vi.mocked(cache.getPlaylistItems).mockReturnValue([]);
    vi.mocked(youtube.getPlaylistItems).mockResolvedValue([ITEM]);
    const server = buildServer();
    await server.call('get_playlist_items', { playlistId: 'pl-1' });
    expect(youtube.getPlaylistItems).toHaveBeenCalled();
    expect(cache.upsertPlaylistItems).toHaveBeenCalledWith([ITEM]);
  });
});

describe('search_songs', () => {
  it('returns cached results on a cache hit', async () => {
    vi.mocked(cache.getSearchCache).mockReturnValue([SEARCH_RESULT]);
    const server = buildServer();
    const result = await server.call('search_songs', { query: 'lo-fi beats' });
    expect(JSON.parse(result.content[0].text)).toEqual([SEARCH_RESULT]);
    expect(youtube.searchVideos).not.toHaveBeenCalled();
  });

  it('calls API and caches results on a cache miss', async () => {
    vi.mocked(cache.getSearchCache).mockReturnValue(null);
    vi.mocked(youtube.searchVideos).mockResolvedValue([SEARCH_RESULT]);
    const server = buildServer();
    await server.call('search_songs', { query: 'lo-fi beats' });
    expect(youtube.searchVideos).toHaveBeenCalled();
    expect(cache.setSearchCache).toHaveBeenCalledWith('lo-fi beats', [SEARCH_RESULT]);
  });
});

describe('add_song_to_playlist', () => {
  it('calls the API and upserts the result to cache', async () => {
    vi.mocked(cache.getMeta).mockReturnValue(null);
    vi.mocked(youtube.addVideoToPlaylist).mockResolvedValue(ITEM);
    const server = buildServer();
    await server.call('add_song_to_playlist', { playlistId: 'pl-1', videoId: 'vid-1' });
    expect(youtube.addVideoToPlaylist).toHaveBeenCalledWith({}, 'pl-1', 'vid-1');
    expect(cache.upsertPlaylistItems).toHaveBeenCalledWith([ITEM]);
  });
});

describe('QuotaExceededError handling', () => {
  it('returns quota error message as a readable tool result instead of throwing', async () => {
    vi.mocked(cache.getPlaylists).mockReturnValue([]);
    vi.mocked(youtube.listPlaylists).mockRejectedValue(new QuotaExceededError());
    const server = buildServer();
    const result = await server.call('list_playlists');
    expect(result.content[0].text).toContain('quota exceeded');
    expect(result).toHaveProperty('content');
  });
});

describe('"liked" playlist ID resolution', () => {
  it('resolves "liked" to the stored playlist ID via getMeta', async () => {
    vi.mocked(cache.getMeta).mockReturnValue('liked-id');
    vi.mocked(cache.getPlaylistItems).mockReturnValue([]);
    vi.mocked(youtube.getPlaylistItems).mockResolvedValue([ITEM]);
    const server = buildServer();
    await server.call('get_playlist_items', { playlistId: 'liked' });
    expect(cache.getMeta).toHaveBeenCalledWith('liked_music_playlist_id');
    expect(youtube.getPlaylistItems).toHaveBeenCalledWith({}, 'liked-id');
  });
});
