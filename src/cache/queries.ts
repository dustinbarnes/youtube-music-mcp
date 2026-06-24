import type Database from 'better-sqlite3';
import type { Playlist, PlaylistItem, SearchResult } from '../types/index.js';
import { getDb } from './db.js';

type DbSource = () => Database.Database;

function db(source?: DbSource): Database.Database {
  return source ? source() : getDb();
}

export function getPlaylists(source?: DbSource): Playlist[] {
  const rows = db(source).prepare('SELECT * FROM playlists').all() as {
    id: string;
    title: string;
    description: string;
    privacy: string;
    item_count: number;
    cached_at: number;
  }[];

  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    description: r.description,
    privacy: r.privacy as Playlist['privacy'],
    itemCount: r.item_count,
    cachedAt: r.cached_at,
  }));
}

export function upsertPlaylists(playlists: Playlist[], source?: DbSource): void {
  const insert = db(source).prepare(`
    INSERT OR REPLACE INTO playlists (id, title, description, privacy, item_count, cached_at)
    VALUES (@id, @title, @description, @privacy, @itemCount, @cachedAt)
  `);

  const run = db(source).transaction((items: Playlist[]) => {
    for (const p of items) {
      insert.run(p);
    }
  });

  run(playlists);
}

export function deleteCachedPlaylist(playlistId: string, source?: DbSource): void {
  db(source).prepare('DELETE FROM playlists WHERE id = ?').run(playlistId);
}

export function getPlaylistItems(playlistId: string, source?: DbSource): PlaylistItem[] {
  const rows = db(source)
    .prepare('SELECT * FROM playlist_items WHERE playlist_id = ? ORDER BY position')
    .all(playlistId) as {
    playlist_item_id: string;
    playlist_id: string;
    video_id: string;
    title: string;
    channel: string;
    duration_seconds: number;
    position: number;
    cached_at: number;
  }[];

  return rows.map((r) => ({
    playlistItemId: r.playlist_item_id,
    playlistId: r.playlist_id,
    videoId: r.video_id,
    title: r.title,
    channel: r.channel,
    durationSeconds: r.duration_seconds,
    position: r.position,
    cachedAt: r.cached_at,
  }));
}

export function upsertPlaylistItems(items: PlaylistItem[], source?: DbSource): void {
  const insert = db(source).prepare(`
    INSERT OR REPLACE INTO playlist_items
      (playlist_item_id, playlist_id, video_id, title, channel, duration_seconds, position, cached_at)
    VALUES
      (@playlistItemId, @playlistId, @videoId, @title, @channel, @durationSeconds, @position, @cachedAt)
  `);

  const run = db(source).transaction((rows: PlaylistItem[]) => {
    for (const item of rows) {
      insert.run(item);
    }
  });

  run(items);
}

export function removePlaylistItem(playlistItemId: string, source?: DbSource): void {
  db(source)
    .prepare('DELETE FROM playlist_items WHERE playlist_item_id = ?')
    .run(playlistItemId);
}

export function clearPlaylistItems(playlistId: string, source?: DbSource): void {
  db(source)
    .prepare('DELETE FROM playlist_items WHERE playlist_id = ?')
    .run(playlistId);
}

const SEARCH_TTL_SECONDS = 3600;

export function getSearchCache(query: string, source?: DbSource): SearchResult[] | null {
  const row = db(source)
    .prepare('SELECT results_json, cached_at FROM search_cache WHERE query_key = ?')
    .get(query) as { results_json: string; cached_at: number } | undefined;

  if (!row) return null;

  const now = Math.floor(Date.now() / 1000);
  if (now - row.cached_at > SEARCH_TTL_SECONDS) return null;

  return JSON.parse(row.results_json) as SearchResult[];
}

export function setSearchCache(query: string, results: SearchResult[], source?: DbSource): void {
  const cachedAt = Math.floor(Date.now() / 1000);
  db(source)
    .prepare(
      'INSERT OR REPLACE INTO search_cache (query_key, results_json, cached_at) VALUES (?, ?, ?)'
    )
    .run(query, JSON.stringify(results), cachedAt);
}

export function getMeta(key: string, source?: DbSource): string | null {
  const row = db(source)
    .prepare('SELECT value FROM meta WHERE key = ?')
    .get(key) as { value: string } | undefined;

  return row ? row.value : null;
}

export function setMeta(key: string, value: string, source?: DbSource): void {
  db(source)
    .prepare('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)')
    .run(key, value);
}
