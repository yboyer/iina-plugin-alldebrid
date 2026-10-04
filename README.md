# AllDebrid for IINA

A library with optional TMDB movie posters: all magnets in your account, videos in nested folders, search, a ready-only filter, file sizes, and playback in a new IINA window.

## Installation

Requires IINA 1.4.0 or later on macOS with plugins enabled.

1. Run `npm ci` then `npm run pack` from the repository directory (Node.js 24+ and Python 3 required). Open `dist/alldebrid.iinaplgz` to install it, or link `dist/plugin` with the IINA CLI below.
2. Open **Plugins → AllDebrid → AllDebrid Library…**.
3. Click **Sign in to AllDebrid**, then open the displayed link and confirm the PIN in your browser.
4. The library loads automatically. Videos are displayed directly; click **Play**.

**Refresh** loads a full status snapshot on first use, then merges incremental changes (including deletions) using AllDebrid’s session/counter protocol. A server-requested full sync replaces the snapshot. Each new sign-in starts a fresh sync session. Refresh caches file listings for unchanged ready magnets and loads new or changed listings in batches of 500. Transfer statistics do not invalidate cached files; other status changes do. Deleted or non-ready magnets lose their cached files. Full syncs preserve matching cached listings. The cache lasts only for the current sign-in session. Failed listings are retried on the next refresh. Magnets that are not ready remain visible but cannot be played. Search ignores case and accents and matches every entered word across magnet names, video paths, and extracted metadata. Video titles, year, season/episode, resolution, language, codec, and source are detected locally from filenames when recognizable; the original path stays visible. Optional movie posters are retrieved from TMDB using the extracted title and year; detected TV episodes are excluded. Videos are identified by their file extensions; archives and ISO images are not scanned. The plugin does not add or restart magnets. **Delete** removes one video from the library. Individual removals are saved locally in plugin preferences and survive refresh, sign-out, and restarts. AllDebrid does not support deleting individual files: the magnet stays on AllDebrid until its last remaining video is deleted, then the plugin deletes the entire magnet (including any non-video files). Search and filters do not affect which videos count toward this deletion. If AllDebrid deletion fails, the last video remains available for retry.

Your account must allow access to magnets and link unlocking. A direct link is generated for each playback request; delayed links are polled for up to ten minutes. Playback depends on file availability and the formats supported by IINA.

**Theme** offers **System**, **Light**, and **Dark**. System follows the macOS appearance. Your choice is saved in the plugin preferences and preserved when signing out.

## Movie posters

Enter your TMDB **API key (v3)** in the library and click **Save**. Get a key from your [TMDB account settings](https://www.themoviedb.org/settings/api). Saving an empty key disables posters. The key is stored in plugin preferences, not in a secure keychain, and survives sign-out and restarts.

A placeholder reserves the poster space while metadata and images load. The torrent name is shown below each video’s path and size. The first matching TMDB result with a poster is used, filtered by year when available. Filename parsing and matches may be imperfect. Results, including missing posters, are cached in memory; failed requests are retried on Refresh. TMDB errors do not block playback. Sign-out clears cached poster results.

## Data and privacy

The API key obtained through PIN authentication is kept **in memory for the current IINA session**. Sign in again after restarting IINA. **Sign out** clears the key and the displayed library and cancels pending operations; it does not revoke the key on AllDebrid. To revoke it, visit https://alldebrid.com/apikeys/.

No telemetry. When enabled, TMDB receives movie titles and years, and poster images load from its image host. File listings and AllDebrid file links are kept only in memory for the current session. AllDebrid API requests go only to AllDebrid; IINA then streams the video from the direct link's host. IINA may retain playback URLs in its normal history.

## Development

Sources live in `src/` and use TypeScript. Vite builds CommonJS entries for IINA and a standalone browser script for the library window, targeting Safari 14. HTML and CSS are copied into `dist/plugin`. TypeScript and Biome extend [@yboyer/config](https://github.com/yboyer/config), with module and DOM settings adapted to this plugin.

Filename parsing uses the npm dependency `parse-torrent-title` 3.0.1 (MIT). Vite bundles it into the plugin; no npm installation is needed by the end user. Its license is included in the archive. Local handlers also recognize VFQ, VFF, VF, VO, and AV1.

```sh
npm ci
npm run lint       # Biome checks and formatting
npm run typecheck  # TypeScript validation for sources and tests
npm test           # Build and run source and plugin regression tests
npm run pack       # Build dist/plugin and create dist/alldebrid.iinaplgz
```

On macOS, link the generated plugin directory for development. Rebuild after source changes:

```sh
/Applications/IINA.app/Contents/MacOS/iina-plugin link dist/plugin
/Applications/IINA.app/Contents/MacOS/iina-plugin pack dist/plugin
```

API documentation: https://docs.iina.io/ and https://docs.alldebrid.com/.

Unit tests in `tests/*.test.mts` run directly with Node.js 24 against the TypeScript sources. Regression tests in `tests/*.test.cjs` exercise the compiled plugin and browser script with simulated IINA APIs and DOM. `npm test` builds the plugin before running both suites. Actual authentication and playback must be validated on macOS with an AllDebrid account; they cannot run in this Linux environment.
