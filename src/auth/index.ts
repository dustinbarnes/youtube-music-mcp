import { OAuth2Client } from 'google-auth-library';
import { loadTokens, saveTokens } from './token-store';
import { runBrowserFlow } from './oauth';

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export async function getAuthClient(): Promise<OAuth2Client> {
  const clientId = requireEnv('GOOGLE_CLIENT_ID');
  const clientSecret = requireEnv('GOOGLE_CLIENT_SECRET');

  const existing = loadTokens();

  if (existing) {
    const client = new OAuth2Client({ clientId, clientSecret });
    client.setCredentials(existing);
    client.on('tokens', (refreshed) => saveTokens(refreshed));
    return client;
  }

  const tokens = await runBrowserFlow();
  saveTokens(tokens);

  const client = new OAuth2Client({ clientId, clientSecret });
  client.setCredentials(tokens);
  client.on('tokens', (refreshed) => saveTokens(refreshed));
  return client;
}
