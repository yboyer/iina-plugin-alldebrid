# AllDebrid for IINA

A library without posters: all magnets in your account, videos in nested folders, search, a ready-only filter, file sizes, and playback in a new IINA window.

## Installation

Requires IINA 1.4.0 or later on macOS with plugins enabled.

1. Run `/Applications/IINA.app/Contents/MacOS/iina-plugin link .` from the repository directory.
2. Open **Plugins → AllDebrid → AllDebrid Library…**.
3. Click **Sign in to AllDebrid**, then open the displayed link and confirm the PIN in your browser.
4. The library loads automatically. Expand a magnet and click **Play**.

**Refresh** loads a full status snapshot on first use, then merges incremental changes (including deletions) using AllDebrid’s session/counter protocol. A server-requested full sync replaces the snapshot. Each new sign-in starts a fresh sync session. Refresh caches file listings for unchanged ready magnets and loads new or changed listings in batches of 200. Transfer statistics do not invalidate cached files; other status changes do. Deleted or non-ready magnets lose their cached files. Full syncs preserve matching cached listings. The cache lasts only for the current sign-in session. Failed listings are retried on the next refresh. Magnets that are not ready remain visible but cannot be played. Search ignores case and accents and matches every entered word across magnet names, video paths, and extracted metadata. Video titles, year, season/episode, resolution, language, codec, and source are detected locally from filenames when recognizable; the original path stays visible. No external metadata service is used. Videos are identified by their file extensions; archives and ISO images are not scanned. The plugin does not add, delete, or restart magnets.

Your account must allow access to magnets and link unlocking. A direct link is generated for each playback request; delayed links are polled for up to ten minutes. Playback depends on file availability and the formats supported by IINA.

**Theme** offers **System**, **Light**, and **Dark**. System follows the macOS appearance. Your choice is saved in the plugin preferences and preserved when signing out.

## Data and privacy

The API key obtained through PIN authentication is kept **in memory for the current IINA session**. Sign in again after restarting IINA. **Sign out** clears the key and the displayed library and cancels pending operations; it does not revoke the key on AllDebrid. To revoke it, visit https://alldebrid.com/apikeys/.

No third-party services or telemetry. File listings and AllDebrid file links are kept only in memory for the current session. API requests go only to AllDebrid; IINA then streams the video from the direct link's host. IINA may retain playback URLs in its normal history.

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
