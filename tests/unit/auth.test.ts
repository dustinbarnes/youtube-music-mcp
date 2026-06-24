import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

vi.mock('fs');

vi.mock('google-auth-library', () => {
  const mockInstance = {
    setCredentials: vi.fn(),
    on: vi.fn(),
    generateAuthUrl: vi.fn(() => 'https://accounts.google.com/mock-auth'),
    getToken: vi.fn(),
  };
  const OAuth2Client = vi.fn(() => mockInstance);
  (OAuth2Client as unknown as { _mockInstance: typeof mockInstance })._mockInstance = mockInstance;
  return { OAuth2Client };
});

vi.mock('../../src/auth/oauth', () => ({
  runBrowserFlow: vi.fn(),
}));

const CREDENTIALS_PATH = path.join(
  os.homedir(),
  '.config',
  'youtube-music-mcp',
  'credentials.json',
);
const CONFIG_DIR = path.dirname(CREDENTIALS_PATH);

describe('token-store', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('loadTokens returns null when the credentials file does not exist', async () => {
    const { loadTokens } = await import('../../src/auth/token-store');
    vi.mocked(fs.readFileSync).mockImplementation(() => {
      throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
    });

    expect(loadTokens()).toBeNull();
  });

  it('saveTokens writes correct JSON to the expected path', async () => {
    const { saveTokens } = await import('../../src/auth/token-store');
    vi.mocked(fs.mkdirSync).mockReturnValue(undefined);
    vi.mocked(fs.writeFileSync).mockReturnValue(undefined);

    const tokens = { access_token: 'abc', refresh_token: 'xyz' };
    saveTokens(tokens);

    expect(fs.mkdirSync).toHaveBeenCalledWith(CONFIG_DIR, { recursive: true });
    expect(fs.writeFileSync).toHaveBeenCalledWith(
      CREDENTIALS_PATH,
      JSON.stringify(tokens, null, 2),
      'utf-8',
    );
  });
});

describe('getAuthClient', () => {
  const savedEnv = { ...process.env };

  beforeEach(() => {
    vi.resetAllMocks();
    process.env['GOOGLE_CLIENT_ID'] = 'test-client-id';
    process.env['GOOGLE_CLIENT_SECRET'] = 'test-client-secret';
  });

  afterEach(() => {
    process.env = { ...savedEnv };
  });

  it('returns a client with credentials set when valid tokens are on disk', async () => {
    const tokenStoreMod = await import('../../src/auth/token-store');
    vi.spyOn(tokenStoreMod, 'loadTokens').mockReturnValue({
      access_token: 'tok',
      refresh_token: 'ref',
    });
    vi.spyOn(tokenStoreMod, 'saveTokens').mockReturnValue(undefined);

    const { OAuth2Client } = await import('google-auth-library');
    const mockInstance = (OAuth2Client as unknown as { _mockInstance: { setCredentials: ReturnType<typeof vi.fn>; on: ReturnType<typeof vi.fn> } })._mockInstance;

    const { getAuthClient } = await import('../../src/auth/index');
    const client = await getAuthClient();

    expect(client).toBeDefined();
    expect(mockInstance.setCredentials).toHaveBeenCalledWith({
      access_token: 'tok',
      refresh_token: 'ref',
    });
    expect(mockInstance.on).toHaveBeenCalledWith('tokens', expect.any(Function));
  });

  it('calls the browser flow when no tokens exist on disk', async () => {
    const tokenStoreMod = await import('../../src/auth/token-store');
    vi.spyOn(tokenStoreMod, 'loadTokens').mockReturnValue(null);
    vi.spyOn(tokenStoreMod, 'saveTokens').mockReturnValue(undefined);

    const oauthMod = await import('../../src/auth/oauth');
    vi.mocked(oauthMod.runBrowserFlow).mockResolvedValue({
      access_token: 'new-tok',
      refresh_token: 'new-ref',
    });

    const { getAuthClient } = await import('../../src/auth/index');
    await getAuthClient();

    expect(oauthMod.runBrowserFlow).toHaveBeenCalled();
  });

  it('throws a clear error when GOOGLE_CLIENT_ID is missing', async () => {
    delete process.env['GOOGLE_CLIENT_ID'];

    const tokenStoreMod = await import('../../src/auth/token-store');
    vi.spyOn(tokenStoreMod, 'loadTokens').mockReturnValue(null);

    const { getAuthClient } = await import('../../src/auth/index');
    await expect(getAuthClient()).rejects.toThrow(
      'Missing required environment variable: GOOGLE_CLIENT_ID',
    );
  });
});
