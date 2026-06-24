import { google } from 'googleapis';
import { OAuth2Client } from 'google-auth-library';
import { Playlist, PlaylistItem, SearchResult, QuotaExceededError, YouTubeApiError } from '../types/index.js';

function parseDuration(iso: string): number {
  const match = iso.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!match) return 0;
  const hours = parseInt(match[1] ?? '0', 10);
  const minutes = parseInt(match[2] ?? '0', 10);
  const seconds = parseInt(match[3] ?? '0', 10);
  return hours * 3600 + minutes * 60 + seconds;
}

function handleApiError(err: unknown): never {
  const e = err as { code?: number; errors?: Array<{ reason?: string; message?: string }> };
  const statusCode = e.code ?? 0;
  if (statusCode === 403) {
    const reason = e.errors?.[0]?.reason ?? '';
    if (reason === 'quotaExceeded' || reason === 'dailyLimitExceeded') {
      throw new QuotaExceededError();
    }
  }
  const message = e.errors?.[0]?.message ?? String(err);
  throw new YouTubeApiError(statusCode, message);
}

export async function listPlaylists(auth: OAuth2Client): Promise<Playlist[]> {
  const yt = google.youtube({ version: 'v3', auth });
  const results: Playlist[] = [];
  const cachedAt = Math.floor(Date.now() / 1000);
  let pageToken: string | undefined;

  do {
    try {
      const res = await yt.playlists.list({
        part: ['snippet', 'contentDetails', 'status'],
        mine: true,
        maxResults: 50,
        pageToken,
      });
      const items = res.data.items ?? [];
      for (const item of items) {
        results.push({
          id: item.id ?? '',
          title: item.snippet?.title ?? '',
          description: item.snippet?.description ?? '',
          privacy: (item.status?.privacyStatus as Playlist['privacy']) ?? 'private',
          itemCount: item.contentDetails?.itemCount ?? 0,
          cachedAt,
        });
      }
      pageToken = res.data.nextPageToken ?? undefined;
    } catch (err) {
      handleApiError(err);
    }
  } while (pageToken);

  return results;
}

export async function getPlaylistItems(auth: OAuth2Client, playlistId: string): Promise<PlaylistItem[]> {
  const yt = google.youtube({ version: 'v3', auth });
  const results: PlaylistItem[] = [];
  const cachedAt = Math.floor(Date.now() / 1000);
  let pageToken: string | undefined;

  do {
    try {
      const res = await yt.playlistItems.list({
        part: ['snippet', 'contentDetails'],
        playlistId,
        maxResults: 50,
        pageToken,
      });
      const items = res.data.items ?? [];
      const videoIds = items
        .map((item) => item.snippet?.resourceId?.videoId ?? item.contentDetails?.videoId ?? '')
        .filter(Boolean);

      const durationMap = new Map<string, number>();
      if (videoIds.length > 0) {
        try {
          const videoRes = await yt.videos.list({ part: ['contentDetails'], id: videoIds });
          for (const video of videoRes.data.items ?? []) {
            if (video.id && video.contentDetails?.duration) {
              durationMap.set(video.id, parseDuration(video.contentDetails.duration));
            }
          }
        } catch (_) {
          // durations stay 0 if batch lookup fails
        }
      }

      for (const item of items) {
        const videoId = item.snippet?.resourceId?.videoId ?? item.contentDetails?.videoId ?? '';
        results.push({
          playlistItemId: item.id ?? '',
          playlistId,
          videoId,
          title: item.snippet?.title ?? '',
          channel: item.snippet?.videoOwnerChannelTitle ?? '',
          durationSeconds: durationMap.get(videoId) ?? 0,
          position: item.snippet?.position ?? 0,
          cachedAt,
        });
      }
      pageToken = res.data.nextPageToken ?? undefined;
    } catch (err) {
      if (err instanceof QuotaExceededError || err instanceof YouTubeApiError) throw err;
      handleApiError(err);
    }
  } while (pageToken);

  return results;
}

export async function createPlaylist(
  auth: OAuth2Client,
  title: string,
  description: string,
  privacy: 'public' | 'private' | 'unlisted'
): Promise<Playlist> {
  const yt = google.youtube({ version: 'v3', auth });
  try {
    const res = await yt.playlists.insert({
      part: ['snippet', 'status'],
      requestBody: {
        snippet: { title, description },
        status: { privacyStatus: privacy },
      },
    });
    const item = res.data;
    return {
      id: item.id ?? '',
      title: item.snippet?.title ?? '',
      description: item.snippet?.description ?? '',
      privacy: (item.status?.privacyStatus as Playlist['privacy']) ?? 'private',
      itemCount: 0,
      cachedAt: Math.floor(Date.now() / 1000),
    };
  } catch (err) {
    handleApiError(err);
  }
}

export async function updatePlaylist(
  auth: OAuth2Client,
  playlistId: string,
  title: string,
  description: string
): Promise<Playlist> {
  const yt = google.youtube({ version: 'v3', auth });
  try {
    const res = await yt.playlists.update({
      part: ['snippet'],
      requestBody: {
        id: playlistId,
        snippet: { title, description },
      },
    });
    const item = res.data;
    return {
      id: item.id ?? '',
      title: item.snippet?.title ?? '',
      description: item.snippet?.description ?? '',
      privacy: (item.status?.privacyStatus as Playlist['privacy']) ?? 'private',
      itemCount: item.contentDetails?.itemCount ?? 0,
      cachedAt: Math.floor(Date.now() / 1000),
    };
  } catch (err) {
    handleApiError(err);
  }
}

export async function deletePlaylist(auth: OAuth2Client, playlistId: string): Promise<void> {
  const yt = google.youtube({ version: 'v3', auth });
  try {
    await yt.playlists.delete({ id: playlistId });
  } catch (err) {
    handleApiError(err);
  }
}

export async function searchVideos(auth: OAuth2Client, query: string): Promise<SearchResult[]> {
  const yt = google.youtube({ version: 'v3', auth });
  try {
    const searchRes = await yt.search.list({
      part: ['snippet'],
      q: query,
      type: ['video'],
      videoCategoryId: '10',
      maxResults: 5,
    });

    const items = searchRes.data.items ?? [];
    const videoIds = items
      .map((item) => item.id?.videoId)
      .filter((id): id is string => !!id);

    const videosRes = await yt.videos.list({
      part: ['contentDetails'],
      id: videoIds,
    });

    const durationMap = new Map<string, number>();
    for (const video of videosRes.data.items ?? []) {
      if (video.id && video.contentDetails?.duration) {
        durationMap.set(video.id, parseDuration(video.contentDetails.duration));
      }
    }

    const results: SearchResult[] = [];
    for (const item of items) {
      const videoId = item.id?.videoId;
      if (!videoId) continue;
      results.push({
        videoId,
        title: item.snippet?.title ?? '',
        channel: item.snippet?.channelTitle ?? '',
        durationSeconds: durationMap.get(videoId) ?? 0,
      });
    }
    return results.slice(0, 5);
  } catch (err) {
    handleApiError(err);
  }
}

export async function addVideoToPlaylist(
  auth: OAuth2Client,
  playlistId: string,
  videoId: string,
  position?: number
): Promise<PlaylistItem> {
  const yt = google.youtube({ version: 'v3', auth });
  try {
    const requestBody: Record<string, unknown> = {
      snippet: {
        playlistId,
        resourceId: { kind: 'youtube#video', videoId },
      },
    };
    if (position !== undefined) {
      (requestBody['snippet'] as Record<string, unknown>)['position'] = position;
    }

    const res = await yt.playlistItems.insert({
      part: ['snippet'],
      requestBody,
    });

    const item = res.data;
    return {
      playlistItemId: item.id ?? '',
      playlistId,
      videoId,
      title: item.snippet?.title ?? '',
      channel: item.snippet?.videoOwnerChannelTitle ?? '',
      durationSeconds: 0,
      position: item.snippet?.position ?? 0,
      cachedAt: Math.floor(Date.now() / 1000),
    };
  } catch (err) {
    handleApiError(err);
  }
}

export async function removeVideoFromPlaylist(auth: OAuth2Client, playlistItemId: string): Promise<void> {
  const yt = google.youtube({ version: 'v3', auth });
  try {
    await yt.playlistItems.delete({ id: playlistItemId });
  } catch (err) {
    handleApiError(err);
  }
}
