import * as http from 'http';
import * as url from 'url';
import { execFile } from 'child_process';
import { OAuth2Client } from 'google-auth-library';
import type { Credentials } from 'google-auth-library';

const YOUTUBE_SCOPE = 'https://www.googleapis.com/auth/youtube.force-ssl';

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function openBrowser(targetUrl: string): void {
  const cmd = process.platform === 'darwin' ? 'open' : 'xdg-open';
  execFile(cmd, [targetUrl]);
}

export async function runBrowserFlow(): Promise<Credentials> {
  const clientId = requireEnv('GOOGLE_CLIENT_ID');
  const clientSecret = requireEnv('GOOGLE_CLIENT_SECRET');

  return new Promise((resolve, reject) => {
    let redirectUri = '';

    const server = http.createServer((req, res) => {
      const parsed = url.parse(req.url ?? '', true);
      const code = parsed.query['code'];

      if (typeof code !== 'string') {
        res.writeHead(400);
        res.end('Missing code parameter');
        return;
      }

      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end('Authentication successful. You may close this tab.');

      server.close();

      const client = new OAuth2Client({ clientId, clientSecret, redirectUri });

      client
        .getToken(code)
        .then(({ tokens }) => resolve(tokens))
        .catch(reject);
    });

    server.listen(0, '127.0.0.1', () => {
      const port = (server.address() as { port: number }).port;
      redirectUri = `http://localhost:${port}`;
      const client = new OAuth2Client({ clientId, clientSecret, redirectUri });

      const authUrl = client.generateAuthUrl({
        access_type: 'offline',
        scope: YOUTUBE_SCOPE,
      });

      openBrowser(authUrl);
    });

    server.on('error', reject);
  });
}
