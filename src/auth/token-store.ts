import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import type { Credentials } from 'google-auth-library';

const CONFIG_DIR = path.join(os.homedir(), '.config', 'youtube-music-mcp');
const CREDENTIALS_FILE = path.join(CONFIG_DIR, 'credentials.json');

export function saveTokens(tokens: Credentials): void {
  fs.mkdirSync(CONFIG_DIR, { recursive: true });
  fs.writeFileSync(CREDENTIALS_FILE, JSON.stringify(tokens, null, 2), 'utf-8');
}

export function loadTokens(): Credentials | null {
  try {
    const raw = fs.readFileSync(CREDENTIALS_FILE, 'utf-8');
    return JSON.parse(raw) as Credentials;
  } catch {
    return null;
  }
}

export function clearTokens(): void {
  try {
    fs.unlinkSync(CREDENTIALS_FILE);
  } catch {
    // File already absent — nothing to do
  }
}
