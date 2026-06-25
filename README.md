# youtube-music-mcp

A Python MCP server for managing YouTube Music playlists via Claude. Add and remove songs, create playlists, browse by mood, and ask Claude to suggest music — all through conversation. Changes sync to YouTube Music and show up on your phone, CarPlay, or wherever you listen.

Uses [ytmusicapi](https://github.com/sigma67/ytmusicapi) as its backend, which talks directly to the YouTube Music internal API. This gives music-specific search (no music videos or compilations), mood/genre browsing, related song discovery, and direct access to your Liked Music.

## What it does

Exposes 13 tools to Claude:

| Tool | Description |
|---|---|
| `list_playlists` | List all your YouTube Music playlists |
| `get_playlist_items` | Get all songs in a playlist |
| `create_playlist` | Create a new playlist |
| `update_playlist` | Rename or update a playlist's description |
| `delete_playlist` | Delete a playlist |
| `search_songs` | Search for songs — music tracks only, no videos or compilations |
| `add_song_to_playlist` | Add a confirmed song by video ID |
| `remove_song_from_playlist` | Remove a song from a playlist |
| `refresh_playlists` | Force a full sync from YouTube Music |
| `get_liked_songs` | Get your Liked Music directly |
| `get_mood_categories` | Browse available mood/genre categories |
| `get_mood_playlists` | Get curated playlists for a mood category |
| `get_song_related` | Find songs related to a given track |

All playlist tools accept `"liked"` as a shorthand for your Liked Music playlist.

## Prerequisites

- Python 3.10+
- A Google account with YouTube Music

## Setup

```bash
git clone https://github.com/dustinbarnes/youtube-music-mcp
cd youtube-music-mcp
pip install -e .
```

### Authenticate

Run the one-time OAuth setup:

```bash
youtube-music-mcp --setup
```

This opens your browser to a Google sign-in page. After approving access, a token is saved to `~/.config/youtube-music-mcp/oauth.json` and reused automatically. You won't need to do this again unless you revoke access or delete the file.

> **Never commit `oauth.json` or `cache.db` to version control.** Both are in `.gitignore`.

### Claude Desktop

Add this to your `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "youtube-music": {
      "command": "/path/to/youtube-music-mcp/.venv/bin/youtube-music-mcp"
    }
  }
}
```

Or if you installed globally with `pip install -e .`:

```json
{
  "mcpServers": {
    "youtube-music": {
      "command": "youtube-music-mcp"
    }
  }
}
```

### Claude Code

```bash
claude mcp add youtube-music -- youtube-music-mcp
```

Or with a venv:

```bash
claude mcp add youtube-music -- /path/to/youtube-music-mcp/.venv/bin/youtube-music-mcp
```

## Usage examples

Once connected, talk to Claude naturally:

- *"What playlists do I have?"*
- *"Search for Phoebe Bridgers Garden Song"*
- *"Add something upbeat and driving to my CarPlay playlist"*
- *"What are the mood categories available?"*
- *"Show me chill playlists"*
- *"What songs are related to Fleetwood Mac - The Chain?"*
- *"Create a new playlist called Road Trip"*
- *"Remove the second song from my Workout playlist"*
- *"Sync my playlists — I made changes on my phone"*

Claude uses `search_songs` to find music-specific results (no music videos or hour-long compilations) and presents them to you before adding anything.

## Local data

The server keeps a SQLite cache at `~/.config/youtube-music-mcp/cache.db` to reduce API calls. Playlist contents update automatically when you make changes through Claude. Search results are cached for one hour. Use `refresh_playlists` to pull in changes made from other devices or apps.

## Development

```bash
pip install -e ".[dev]"
pytest                 # run tests
pytest -v              # verbose
```

## Contributing

Pull requests welcome. All contributions require review. Please include tests for new behavior and clear commit messages.

## License

MIT
