from pathlib import Path

from ytmusicapi import YTMusic


def get_config_dir() -> Path:
    """Returns the config directory path, creating it if needed."""
    config_dir = Path.home() / ".config" / "youtube-music-mcp"
    config_dir.mkdir(parents=True, exist_ok=True)
    return config_dir


def get_oauth_path() -> Path:
    """Returns the path to the OAuth token file."""
    return get_config_dir() / "oauth.json"


def is_authenticated() -> bool:
    """Returns True if a valid oauth.json exists at the expected path."""
    return get_oauth_path().exists()


def setup_oauth() -> None:
    """
    Runs the one-time OAuth setup flow via ytmusicapi.
    Calls YTMusic.setup_oauth(filepath=str(get_oauth_path()), open_browser=True).
    Prints a clear success message on completion.
    """
    YTMusic.setup_oauth(filepath=str(get_oauth_path()), open_browser=True)
    print(f"Authentication successful. Credentials saved to {get_oauth_path()}")


def get_ytmusic() -> YTMusic:
    """
    Returns an authenticated YTMusic instance.
    Raises RuntimeError with a clear setup instruction if oauth.json doesn't exist.
    The error message should tell the user to run: youtube-music-mcp --setup
    """
    if not is_authenticated():
        raise RuntimeError(
            "Not authenticated. Run `youtube-music-mcp --setup` to complete OAuth setup."
        )
    return YTMusic(str(get_oauth_path()))
