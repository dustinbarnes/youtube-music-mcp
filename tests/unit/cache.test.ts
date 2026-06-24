import Database from 'better-sqlite3';
import { beforeEach, describe, expect, it } from 'vitest';
import { SCHEMA_SQL } from '../../src/cache/db.js';
import {
  clearPlaylistItems,
  deleteCachedPlaylist,
  getMeta,
  getPlaylistItems,
  getPlaylists,
  getSearchCache,
  setMeta,
  setSearchCache,
  upsertPlaylistItems,
  upsertPlaylists,
} from '../../src/cache/queries.js';
import type { Playlist, PlaylistItem, SearchResult } from '../../src/types/index.js';

function makeDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  db.exec(SCHEMA_SQL);
  return db;
}

function source(db: Database.Database) {
  return () => db;
}

function playlist(overrides: Partial<Playlist> = {}): Playlist {
  return {
    id: 'pl1',
    title: 'My Playlist',
    description: 'desc',
    privacy: 'private',
    itemCount: 0,
    cachedAt: Math.floor(Date.now() / 1000),
    ...overrides,
  };
}

function playlistItem(overrides: Partial<PlaylistItem> = {}): PlaylistItem {
  return {
    playlistItemId: 'pi1',
    playlistId: 'pl1',
    videoId: 'vid1',
    title: 'Song',
    channel: 'Artist',
    durationSeconds: 180,
    position: 0,
    cachedAt: Math.floor(Date.now() / 1000),
    ...overrides,
  };
}

let db: Database.Database;
let src: () => Database.Database;

beforeEach(() => {
  db = makeDb();
  src = source(db);
});

describe('upsertPlaylists / getPlaylists', () => {
  it('inserts a playlist and retrieves it', () => {
    upsertPlaylists([playlist()], src);
    const results = getPlaylists(src);
    expect(results).toHaveLength(1);
    expect(results[0].id).toBe('pl1');
    expect(results[0].title).toBe('My Playlist');
  });

  it('upserts the same ID twice resulting in one updated row', () => {
    upsertPlaylists([playlist({ title: 'First' })], src);
    upsertPlaylists([playlist({ title: 'Second' })], src);
    const results = getPlaylists(src);
    expect(results).toHaveLength(1);
    expect(results[0].title).toBe('Second');
  });
});

describe('deleteCachedPlaylist', () => {
  it('removes the playlist and cascade-deletes its items', () => {
    upsertPlaylists([playlist()], src);
    upsertPlaylistItems([playlistItem()], src);

    deleteCachedPlaylist('pl1', src);

    expect(getPlaylists(src)).toHaveLength(0);
    expect(getPlaylistItems('pl1', src)).toHaveLength(0);
  });
});

describe('getPlaylistItems', () => {
  it('returns items for the correct playlist only', () => {
    upsertPlaylists([playlist({ id: 'pl1' }), playlist({ id: 'pl2', title: 'Other' })], src);
    upsertPlaylistItems(
      [
        playlistItem({ playlistItemId: 'pi1', playlistId: 'pl1' }),
        playlistItem({ playlistItemId: 'pi2', playlistId: 'pl2' }),
      ],
      src
    );

    const items = getPlaylistItems('pl1', src);
    expect(items).toHaveLength(1);
    expect(items[0].playlistItemId).toBe('pi1');
  });
});

describe('clearPlaylistItems', () => {
  it('removes all items for a playlist but not the playlist itself', () => {
    upsertPlaylists([playlist()], src);
    upsertPlaylistItems(
      [
        playlistItem({ playlistItemId: 'pi1', position: 0 }),
        playlistItem({ playlistItemId: 'pi2', position: 1 }),
      ],
      src
    );

    clearPlaylistItems('pl1', src);

    expect(getPlaylistItems('pl1', src)).toHaveLength(0);
    expect(getPlaylists(src)).toHaveLength(1);
  });
});

describe('getSearchCache / setSearchCache', () => {
  const results: SearchResult[] = [
    { videoId: 'v1', title: 'Song', channel: 'Artist', durationSeconds: 200 },
  ];

  it('returns null for a cache miss', () => {
    expect(getSearchCache('unknown query', src)).toBeNull();
  });

  it('returns null for a result cached more than 3600 seconds ago', () => {
    const staleTimestamp = Math.floor(Date.now() / 1000) - 3601;
    db.prepare(
      'INSERT INTO search_cache (query_key, results_json, cached_at) VALUES (?, ?, ?)'
    ).run('old query', JSON.stringify(results), staleTimestamp);

    expect(getSearchCache('old query', src)).toBeNull();
  });

  it('returns results for a fresh cache entry', () => {
    setSearchCache('fresh query', results, src);
    const cached = getSearchCache('fresh query', src);
    expect(cached).toEqual(results);
  });
});

describe('getMeta / setMeta', () => {
  it('round-trips a key-value pair', () => {
    setMeta('tokenExpiry', '1234567890', src);
    expect(getMeta('tokenExpiry', src)).toBe('1234567890');
  });

  it('returns null for a missing key', () => {
    expect(getMeta('nonexistent', src)).toBeNull();
  });

  it('overwrites an existing key', () => {
    setMeta('version', '1', src);
    setMeta('version', '2', src);
    expect(getMeta('version', src)).toBe('2');
  });
});
