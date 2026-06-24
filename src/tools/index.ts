import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

type RawShape = Record<string, z.ZodTypeAny>;
type ToolResult = { content: Array<{ type: 'text'; text: string }> };

function registerTool<S extends RawShape>(
  server: McpServer,
  name: string,
  description: string,
  inputSchema: S,
  handler: (args: z.infer<z.ZodObject<S>>) => Promise<ToolResult>,
): void {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  server.registerTool(name, { description, inputSchema } as any, handler as any);
}

function registerToolNoArgs(
  server: McpServer,
  name: string,
  description: string,
  handler: () => Promise<ToolResult>,
): void {
  server.registerTool(name, { description }, handler);
}
import { OAuth2Client } from 'google-auth-library';
import {
  getPlaylists,
  upsertPlaylists,
  deleteCachedPlaylist,
  getPlaylistItems,
  upsertPlaylistItems,
  removePlaylistItem,
  clearPlaylistItems,
  getSearchCache,
  setSearchCache,
  getMeta,
  setMeta,
} from '../cache/index.js';
import {
  listPlaylists,
  getPlaylistItems as fetchPlaylistItems,
  createPlaylist,
  updatePlaylist,
  deletePlaylist,
  searchVideos,
  addVideoToPlaylist,
  removeVideoFromPlaylist,
} from '../youtube/index.js';
import { QuotaExceededError } from '../types/index.js';

function resolvePlaylistId(playlistId: string): string {
  if (playlistId !== 'liked') return playlistId;
  const id = getMeta('liked_music_playlist_id');
  if (!id) throw new Error('Liked Music playlist ID not found in cache. Run list_playlists first.');
  return id;
}

function quotaResult(err: unknown) {
  return { content: [{ type: 'text' as const, text: (err as Error).message }] };
}

function textResult(data: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(data) }] };
}

export function registerTools(server: McpServer, auth: OAuth2Client): void {
  registerToolNoArgs(server, 'list_playlists', 'List all YouTube Music playlists', async () => {
    try {
      const cached = getPlaylists();
      if (cached.length > 0) return textResult(cached);

      const playlists = await listPlaylists(auth);
      upsertPlaylists(playlists);

      const liked = playlists.find((p) => p.title === 'Liked Music');
      if (liked) setMeta('liked_music_playlist_id', liked.id);

      return textResult(playlists);
    } catch (err) {
      if (err instanceof QuotaExceededError) return quotaResult(err);
      throw err;
    }
  });

  registerTool(
    server,
    'get_playlist_items',
    'Get all songs in a playlist',
    { playlistId: z.string().describe('Playlist ID, or "liked" for Liked Music') },
    async ({ playlistId }) => {
      try {
        const resolvedId = resolvePlaylistId(playlistId);
        const cached = getPlaylistItems(resolvedId);
        if (cached.length > 0) return textResult(cached);

        const items = await fetchPlaylistItems(auth, resolvedId);
        // Ensure a parent playlist row exists before inserting items (FK constraint).
        // Needed for special playlists like LL (Liked Music) not returned by listPlaylists.
        const existing = getPlaylists().find((p) => p.id === resolvedId);
        if (!existing) {
          upsertPlaylists([{
            id: resolvedId,
            title: playlistId === 'liked' || resolvedId === 'LL' ? 'Liked Music' : resolvedId,
            description: '',
            privacy: 'private',
            itemCount: items.length,
            cachedAt: Math.floor(Date.now() / 1000),
          }]);
        }
        upsertPlaylistItems(items);
        return textResult(items);
      } catch (err) {
        if (err instanceof QuotaExceededError) return quotaResult(err);
        throw err;
      }
    },
  );

  registerTool(
    server,
    'create_playlist',
    'Create a new YouTube Music playlist',
    {
      title: z.string().describe('Playlist title'),
      description: z.string().optional().describe('Playlist description'),
      visibility: z.enum(['public', 'private', 'unlisted']).optional().describe('Playlist visibility'),
    },
    async ({ title, description, visibility }) => {
      try {
        const playlist = await createPlaylist(auth, title, description ?? '', visibility ?? 'private');
        upsertPlaylists([playlist]);
        return textResult(playlist);
      } catch (err) {
        if (err instanceof QuotaExceededError) return quotaResult(err);
        throw err;
      }
    },
  );

  registerTool(
    server,
    'update_playlist',
    'Update a playlist title and description',
    {
      playlistId: z.string().describe('Playlist ID, or "liked" for Liked Music'),
      title: z.string().describe('New title'),
      description: z.string().describe('New description'),
    },
    async ({ playlistId, title, description }) => {
      try {
        if (playlistId === 'liked') {
          return { content: [{ type: 'text' as const, text: 'The Liked Music playlist cannot be renamed via the YouTube API.' }] };
        }
        const resolvedId = resolvePlaylistId(playlistId);
        const playlist = await updatePlaylist(auth, resolvedId, title, description);
        upsertPlaylists([playlist]);
        return textResult(playlist);
      } catch (err) {
        if (err instanceof QuotaExceededError) return quotaResult(err);
        throw err;
      }
    },
  );

  registerTool(
    server,
    'delete_playlist',
    'Delete a playlist',
    { playlistId: z.string().describe('Playlist ID, or "liked" for Liked Music') },
    async ({ playlistId }) => {
      try {
        const resolvedId = resolvePlaylistId(playlistId);
        await deletePlaylist(auth, resolvedId);
        deleteCachedPlaylist(resolvedId);
        return { content: [{ type: 'text' as const, text: `Playlist ${resolvedId} deleted.` }] };
      } catch (err) {
        if (err instanceof QuotaExceededError) return quotaResult(err);
        throw err;
      }
    },
  );

  registerTool(
    server,
    'search_songs',
    'Search for songs on YouTube Music. Returns up to 5 results for user confirmation before adding.',
    { query: z.string().describe('Search query, e.g. "Fleetwood Mac The Chain"') },
    async ({ query }) => {
      try {
        const cached = getSearchCache(query);
        if (cached !== null) return textResult(cached);

        const results = await searchVideos(auth, query);
        setSearchCache(query, results);
        return textResult(results);
      } catch (err) {
        if (err instanceof QuotaExceededError) return quotaResult(err);
        throw err;
      }
    },
  );

  registerTool(
    server,
    'add_song_to_playlist',
    'Add a song to a playlist by its YouTube video ID. Use search_songs first to confirm the correct video.',
    {
      playlistId: z.string().describe('Playlist ID, or "liked" for Liked Music'),
      videoId: z.string().describe('YouTube video ID to add'),
    },
    async ({ playlistId, videoId }) => {
      try {
        const resolvedId = resolvePlaylistId(playlistId);
        const item = await addVideoToPlaylist(auth, resolvedId, videoId);
        upsertPlaylistItems([item]);
        return textResult(item);
      } catch (err) {
        if (err instanceof QuotaExceededError) return quotaResult(err);
        throw err;
      }
    },
  );

  registerTool(
    server,
    'remove_song_from_playlist',
    'Remove a song from a playlist',
    {
      playlistId: z.string().describe('Playlist ID, or "liked" for Liked Music'),
      playlistItemId: z.string().describe('The playlistItemId of the item to remove (from get_playlist_items)'),
    },
    async ({ playlistItemId }) => {
      try {
        await removeVideoFromPlaylist(auth, playlistItemId);
        removePlaylistItem(playlistItemId);
        return { content: [{ type: 'text' as const, text: `Item ${playlistItemId} removed.` }] };
      } catch (err) {
        if (err instanceof QuotaExceededError) return quotaResult(err);
        throw err;
      }
    },
  );

  registerToolNoArgs(server, 'refresh_playlists', 'Force a full sync of all playlists and their songs from YouTube', async () => {
    try {
      const playlists = await listPlaylists(auth);
      upsertPlaylists(playlists);

      const liked = playlists.find((p) => p.title === 'Liked Music');
      if (liked) setMeta('liked_music_playlist_id', liked.id);

      const counts: Record<string, number> = {};
      for (const playlist of playlists) {
        const items = await fetchPlaylistItems(auth, playlist.id);
        clearPlaylistItems(playlist.id);
        upsertPlaylistItems(items);
        counts[playlist.title] = items.length;
      }

      return textResult({ playlists: playlists.length, itemCounts: counts });
    } catch (err) {
      if (err instanceof QuotaExceededError) return quotaResult(err);
      throw err;
    }
  });
}
