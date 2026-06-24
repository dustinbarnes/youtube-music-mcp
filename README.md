# youtube-music-mcp

An MCP server for managing YouTube Music playlists via Claude. Add and remove songs, create playlists, and ask Claude to suggest music — all through conversation. Changes sync to YouTube Music and show up on your phone, CarPlay, or wherever you listen.

## What it does

Exposes 9 tools to Claude:

| Tool | Description |
|---|---|
| `list_playlists` | List all your YouTube Music playlists |
| `get_playlist_items` | Get all songs in a playlist |
| `create_playlist` | Create a new playlist |
| `update_playlist` | Rename or update a playlist's description |
| `delete_playlist` | Delete a playlist |
| `search_songs` | Search YouTube for songs — returns up to 5 results to confirm before adding |
| `add_song_to_playlist` | Add a confirmed song by video ID |
| `remove_song_from_playlist` | Remove a song from a playlist |
| `refresh_playlists` | Force a full sync from YouTube (useful after changes made on another device) |

All playlist operations accept `"liked"` as a shorthand for your Liked Music playlist.

## Prerequisites

- Node.js 20+
- A Google Cloud project with the **YouTube Data API v3** enabled
- OAuth 2.0 credentials (Desktop app type)

### Setting up Google credentials

1. Go to the [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project (or select an existing one)
3. Enable the **YouTube Data API v3** under *APIs & Services > Library*
4. Go to *APIs & Services > Credentials* and click **Create Credentials > OAuth client ID**
5. Choose **Desktop app** as the application type
6. Note the **Client ID** and **Client Secret**

## Setup

```bash
git clone https://github.com/dustinbarnes/youtube-music-mcp
cd youtube-music-mcp
npm install
npm run build
```

### Claude Desktop

Add this to your `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "youtube-music": {
      "command": "node",
      "args": ["/path/to/youtube-music-mcp/dist/main.js"],
      "env": {
        "GOOGLE_CLIENT_ID": "your-client-id",
        "GOOGLE_CLIENT_SECRET": "your-client-secret"
      }
    }
  }
}
```

### Claude Code

```bash
claude mcp add youtube-music \
  --env GOOGLE_CLIENT_ID=your-client-id \
  --env GOOGLE_CLIENT_SECRET=your-client-secret \
  -- node /path/to/youtube-music-mcp/dist/main.js
```

## First run

The first time the server starts, it will open your browser to complete Google sign-in. After you approve access, tokens are saved to `~/.config/youtube-music-mcp/credentials.json` and reused automatically.

> **Never commit `credentials.json` or `cache.db` to version control.** Both are in `.gitignore` but worth knowing about.

## Usage examples

Once connected, talk to Claude naturally:

- *"What playlists do I have?"*
- *"Add something chill and acoustic to my Evening playlist"*
- *"Search for Phoebe Bridgers Garden Song"*
- *"Create a new playlist called Road Trip and make it private"*
- *"Remove the second song from my Workout playlist"*
- *"Sync my playlists — I added some songs on my phone"*

Claude uses `search_songs` to find candidates and presents them to you before adding anything. You confirm the right version before it goes into the playlist.

## Local data

The server keeps a SQLite cache at `~/.config/youtube-music-mcp/cache.db` to reduce YouTube API quota usage (default: 10,000 units/day). Playlist contents update automatically when you make changes through Claude. Search results are cached for one hour. Use `refresh_playlists` to pull in changes made from other devices or apps.

## Development

```bash
npm test          # run unit tests
npm run typecheck # type check without building
npm run build     # compile to dist/
```

## Contributing

Pull requests welcome. All contributions require review. Please include tests for new behavior and clear commit messages.

## License

MIT
