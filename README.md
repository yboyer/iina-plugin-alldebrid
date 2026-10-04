# AllDebrid for IINA

A library without posters: all magnets in your account, videos in nested folders, search, a ready-only filter, file sizes, and playback in a new IINA window.

## Installation

Requires IINA 1.4.0 or later on macOS with plugins enabled.

1. Open `dist/alldebrid.iinaplgz` with IINA and grant network access to `api.alldebrid.com`.
2. Open **Plugins → AllDebrid → AllDebrid Library…**.
3. Click **Sign in to AllDebrid**, then open the displayed link and confirm the PIN in your browser.
4. The library loads automatically. Expand a magnet and click **Play**.

**Refresh** reloads all magnets and their files. Magnets that are not ready remain visible but cannot be played. Search matches magnet names and video paths. Videos are identified by their file extensions; archives and ISO images are not scanned. The plugin does not add, delete, or restart magnets.

Your account must allow access to magnets and link unlocking. A direct link is generated for each playback request; delayed links are polled for up to ten minutes. Playback depends on file availability and the formats supported by IINA.

## Data and privacy

The API key obtained through PIN authentication is stored in the **macOS Keychain**. **Sign out** replaces the stored key with an empty value and cancels pending operations; it does not revoke the key on AllDebrid. To revoke it, visit https://alldebrid.com/apikeys/.

No third-party services or telemetry. The library stays in memory. API requests go only to AllDebrid; IINA then streams the video from the direct link's host. IINA may retain playback URLs in its normal history.

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
