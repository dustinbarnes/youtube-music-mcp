import { describe, it, expect, vi, beforeEach } from 'vitest';
import { OAuth2Client } from 'google-auth-library';
import { QuotaExceededError, YouTubeApiError } from '../../src/types/index.js';

const mockPlaylistsList = vi.fn();
const mockVideosListForSearch = vi.fn();
const mockSearchList = vi.fn();

vi.mock('googleapis', () => {
  const youtube = vi.fn(() => ({
    playlists: { list: mockPlaylistsList },
    search: { list: mockSearchList },
    videos: { list: mockVideosListForSearch },
    playlistItems: { list: vi.fn(), insert: vi.fn(), delete: vi.fn() },
  }));
  return {
    google: {
      youtube,
    },
  };
});

const fakeAuth = {} as OAuth2Client;

describe('listPlaylists', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns a single page of playlists correctly', async () => {
    mockPlaylistsList.mockResolvedValueOnce({
      data: {
        items: [
          {
            id: 'pl1',
            snippet: { title: 'My Playlist', description: 'Desc' },
            status: { privacyStatus: 'public' },
            contentDetails: { itemCount: 3 },
          },
        ],
        nextPageToken: null,
      },
    });

    const { listPlaylists } = await import('../../src/youtube/client.js');
    const result = await listPlaylists(fakeAuth);

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      id: 'pl1',
      title: 'My Playlist',
      description: 'Desc',
      privacy: 'public',
      itemCount: 3,
    });
    expect(result[0].cachedAt).toBeGreaterThan(0);
  });

  it('fetches multiple pages when nextPageToken is present', async () => {
    mockPlaylistsList
      .mockResolvedValueOnce({
        data: {
          items: [
            {
              id: 'pl1',
              snippet: { title: 'Playlist 1', description: '' },
              status: { privacyStatus: 'private' },
              contentDetails: { itemCount: 1 },
            },
          ],
          nextPageToken: 'token123',
        },
      })
      .mockResolvedValueOnce({
        data: {
          items: [
            {
              id: 'pl2',
              snippet: { title: 'Playlist 2', description: '' },
              status: { privacyStatus: 'unlisted' },
              contentDetails: { itemCount: 5 },
            },
          ],
          nextPageToken: null,
        },
      });

    const { listPlaylists } = await import('../../src/youtube/client.js');
    const result = await listPlaylists(fakeAuth);

    expect(result).toHaveLength(2);
    expect(result[0].id).toBe('pl1');
    expect(result[1].id).toBe('pl2');
    expect(mockPlaylistsList).toHaveBeenCalledTimes(2);
    expect(mockPlaylistsList).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ pageToken: 'token123' })
    );
  });

  it('throws QuotaExceededError on 403 with quotaExceeded reason', async () => {
    mockPlaylistsList.mockRejectedValueOnce({
      code: 403,
      errors: [{ reason: 'quotaExceeded', message: 'Quota exceeded' }],
    });

    const { listPlaylists } = await import('../../src/youtube/client.js');
    await expect(listPlaylists(fakeAuth)).rejects.toThrow(QuotaExceededError);
  });

  it('throws QuotaExceededError on 403 with dailyLimitExceeded reason', async () => {
    mockPlaylistsList.mockRejectedValueOnce({
      code: 403,
      errors: [{ reason: 'dailyLimitExceeded', message: 'Daily limit exceeded' }],
    });

    const { listPlaylists } = await import('../../src/youtube/client.js');
    await expect(listPlaylists(fakeAuth)).rejects.toThrow(QuotaExceededError);
  });

  it('throws YouTubeApiError on 403 with a different reason', async () => {
    mockPlaylistsList.mockRejectedValueOnce({
      code: 403,
      errors: [{ reason: 'forbidden', message: 'Forbidden' }],
    });

    const { listPlaylists } = await import('../../src/youtube/client.js');
    await expect(listPlaylists(fakeAuth)).rejects.toThrow(YouTubeApiError);
  });

  it('throws YouTubeApiError with correct statusCode on non-403 error', async () => {
    mockPlaylistsList.mockRejectedValueOnce({
      code: 404,
      errors: [{ reason: 'notFound', message: 'Not found' }],
    });

    const { listPlaylists } = await import('../../src/youtube/client.js');
    const error = await listPlaylists(fakeAuth).catch((e) => e);
    expect(error).toBeInstanceOf(YouTubeApiError);
    expect(error.statusCode).toBe(404);
  });
});

describe('searchVideos', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns up to 5 results with the correct shape', async () => {
    const searchItems = Array.from({ length: 5 }, (_, i) => ({
      id: { videoId: `vid${i}` },
      snippet: { title: `Title ${i}`, channelTitle: `Channel ${i}` },
    }));

    mockSearchList.mockResolvedValueOnce({
      data: { items: searchItems },
    });

    mockVideosListForSearch.mockResolvedValueOnce({
      data: {
        items: searchItems.map((item, i) => ({
          id: item.id.videoId,
          contentDetails: { duration: `PT${(i + 1) * 60}S` },
        })),
      },
    });

    const { searchVideos } = await import('../../src/youtube/client.js');
    const results = await searchVideos(fakeAuth, 'rock music');

    expect(results).toHaveLength(5);
    expect(results[0]).toMatchObject({
      videoId: 'vid0',
      title: 'Title 0',
      channel: 'Channel 0',
      durationSeconds: 60,
    });
    expect(results[4]).toMatchObject({
      videoId: 'vid4',
      title: 'Title 4',
      channel: 'Channel 4',
      durationSeconds: 300,
    });
  });

  it('calls search.list with videoCategoryId 10 and maxResults 5', async () => {
    mockSearchList.mockResolvedValueOnce({ data: { items: [] } });
    mockVideosListForSearch.mockResolvedValueOnce({ data: { items: [] } });

    const { searchVideos } = await import('../../src/youtube/client.js');
    await searchVideos(fakeAuth, 'jazz');

    expect(mockSearchList).toHaveBeenCalledWith(
      expect.objectContaining({
        videoCategoryId: '10',
        maxResults: 5,
        type: ['video'],
      })
    );
  });
});

describe('parseDuration (tested indirectly via searchVideos)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const cases: [string, number][] = [
    ['PT3M45S', 225],
    ['PT1H2M3S', 3723],
    ['PT30S', 30],
  ];

  for (const [iso, expected] of cases) {
    it(`parses ${iso} → ${expected}`, async () => {
      mockSearchList.mockResolvedValueOnce({
        data: {
          items: [{ id: { videoId: 'v1' }, snippet: { title: 'T', channelTitle: 'C' } }],
        },
      });
      mockVideosListForSearch.mockResolvedValueOnce({
        data: { items: [{ id: 'v1', contentDetails: { duration: iso } }] },
      });

      const { searchVideos } = await import('../../src/youtube/client.js');
      const results = await searchVideos(fakeAuth, 'test');
      expect(results[0].durationSeconds).toBe(expected);
    });
  }
});
