# AllDebrid for IINA

A library without posters: all magnets in your account, videos in nested folders, search, a ready-only filter, file sizes, and playback in a new IINA window.

## Installation

Requires IINA 1.4.0 or later on macOS with plugins enabled.

1. Run `python3 scripts/pack.py` to generate `dist/alldebrid.iinaplgz` (requires Python 3). Open the package with IINA and grant network access to `api.alldebrid.com` and `*.debrid.it` (video streaming servers).
2. Open **Plugins → AllDebrid → AllDebrid Library…**.
3. Click **Sign in to AllDebrid**, then open the displayed link and confirm the PIN in your browser.
4. The library loads automatically. Expand a magnet and click **Play**.

**Refresh** checks all magnet statuses and reuses cached files for unchanged, ready magnets. Missing or expired files are loaded in batches of 100. File listings are cached for 24 hours, including between IINA launches; failed listings are retried on the next refresh. Magnets that are not ready remain visible but cannot be played. Search matches magnet names and video paths. Videos are identified by their file extensions; archives and ISO images are not scanned. The plugin does not add, delete, or restart magnets.

Your account must allow access to magnets and link unlocking. A direct link is generated for each playback request; delayed links are polled for up to ten minutes. Playback depends on file availability and the formats supported by IINA.

## Data and privacy

The API key obtained through PIN authentication is kept **in memory for the current IINA session**. Sign in again after restarting IINA. **Sign out** clears the key and the library cache and cancels pending operations; it does not revoke the key on AllDebrid. To revoke it, visit https://alldebrid.com/apikeys/.

No third-party services or telemetry. The library cache (file names, paths, sizes, and AllDebrid file links) is saved locally in the plugin's IINA preferences. It is reused only after signing in to the same account. API keys and unlocked playback URLs are not cached. API requests go only to AllDebrid; IINA then streams the video from the direct link's host. IINA may retain playback URLs in its normal history.

## Development

No npm dependencies or bundler required.

```sh
node --test tests/*.test.js
python3 scripts/pack.py
```

On macOS, you can also use the official CLI:

```sh
/Applications/IINA.app/Contents/MacOS/iina-plugin link .
/Applications/IINA.app/Contents/MacOS/iina-plugin pack .
```

API documentation: https://docs.iina.io/ and https://docs.alldebrid.com/.

Tests use a simulated IINA environment. Actual authentication and playback must be validated on macOS with an AllDebrid account; they cannot run in this Linux environment.
