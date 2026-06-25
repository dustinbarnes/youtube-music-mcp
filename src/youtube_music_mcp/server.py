import argparse
import sys

from youtube_music_mcp.auth import is_authenticated, setup_oauth
from youtube_music_mcp.cache import init_db
from youtube_music_mcp.tools import mcp


def main() -> None:
    parser = argparse.ArgumentParser(description="YouTube Music MCP server")
    parser.add_argument("--setup", action="store_true", help="Run OAuth setup")
    args = parser.parse_args()

    if args.setup:
        setup_oauth()
        return

    if not is_authenticated():
        print("Not authenticated. Run: youtube-music-mcp --setup", file=sys.stderr)
        sys.exit(1)

    init_db()
    mcp.run()
