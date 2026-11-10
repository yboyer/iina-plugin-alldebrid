# AllDebrid for IINA

Browse your AllDebrid videos and play them in IINA. Includes search, a ready-only filter, file details, and optional TMDB titles and posters.

![AllDebrid library in IINA](.github/alldebrid-library.png)

## Installation

Requires **IINA 1.4.0+** on macOS with plugins enabled.

```sh
npm ci
npm run pack
```

1. Open `dist/alldebrid.iinaplgz` to install the plugin.
2. Open **Plugins → AllDebrid → AllDebrid Library…**.
3. Click **Sign in to AllDebrid** and confirm the displayed PIN in your browser.
4. Click **Play** on a ready video to open it in a new IINA window.

Your AllDebrid account must allow access to magnets and link unlocking. Playback depends on file availability and IINA's supported formats.

## Usage

- **Refresh** updates your library. Videos in nested folders are included; archives and ISO images are not scanned.
- **Search** matches magnet names, video paths, and metadata, ignoring case and accents.
- **Ready only** hides videos that cannot yet be played.
- **Theme** offers System, Light, and Dark and remembers your choice.
- **Delete** hides a video locally, including after refresh or restart. Deleting a magnet's last remaining video **deletes the entire magnet from AllDebrid, including non-video files**. Search and filters do not affect this count. If deletion fails, the last video remains available for retry.

The plugin does not add or restart magnets.

### Optional TMDB metadata

Enter a TMDB **API key (v3)** and click **Save** to enable titles, episode names, and posters. Get a key from your [TMDB account settings](https://www.themoviedb.org/settings/api). Save an empty key to disable it.

Matches use information parsed from filenames and may be imperfect. Titles are requested in French. TMDB failures do not block playback.

## Data and privacy

- AllDebrid and TMDB API keys are stored in **plugin preferences, not a secure keychain**.
- **Sign out** clears the saved AllDebrid key, displayed library, and pending operations. It keeps your TMDB key, theme, and hidden videos. To revoke the AllDebrid key, use [AllDebrid API key settings](https://alldebrid.com/apikeys/).
- No telemetry. When enabled, TMDB receives titles, years, and season/episode numbers; posters load from its image host.
- File listings and AllDebrid file links stay in memory for the session. IINA streams from the direct link's host and may retain playback URLs in its history.

## Development

The toolchain uses standalone [tsdown](https://tsdown.dev/) for builds,
[Biome](https://biomejs.dev/) for formatting and linting, TypeScript for type checks,
and [Vitest](https://vitest.dev/) for tests. Use npm with the committed `package-lock.json`
and the Node.js version in `.node-version`.
TypeScript sources live in `src/`; build output goes to `dist/plugin`.
Tests build the plugin before running. The build keeps three independent CommonJS
bundles (`global.js`, `main.js`, `library.js`) and one IIFE bundle (`library-ui.js`,
configured global name `AllDebridUI`), targeting Safari 14. `parse-torrent-title` is bundled.
Asset copying and plugin archive creation use the existing scripts.

```sh
npm run lint       # Check Biome rules, formatting, and source/test types
npm test           # Build and run unit and regression tests
npm run pack       # Build and create the plugin archive
```

On macOS, link the built plugin for development and rebuild after changes:

```sh
/Applications/IINA.app/Contents/MacOS/iina-plugin link dist/plugin
```

`npm ci` does not install Git hooks. Run the checks explicitly before sharing changes.
The pull request and release workflows run `npm ci`, `npm run lint`, and `npm test`.

Biome extends the published `@yboyer/config/biome.json` from the pinned package version.
It does not depend on unpublished changes in the config repository. The local overrides
keep IINA globals, declaration-file imports, HTTP response objects thrown by tests,
built-bundle imports in tests, assertions inside the test harness, and the `[hidden]`
CSS rule. Biome sorts index signatures after named interface members and spaces YAML
flow lists differently from the previous formatter. CSS keeps single quotes.
Biome and Oxlint do not have identical rules or type analysis. TypeScript checks both
the source/build configuration and the tests, but does not replace every type-aware
lint rule. Biome does not check Python or shell scripts.

Each entry is built separately to avoid shared CommonJS chunks. `globalName` remains
`AllDebridUI`; tsdown emits an anonymous IIFE while the UI entry has no exports,
matching the previous build. The Safari 14 target transforms syntax, without adding
polyfills. Authentication, playback, and actual Safari/JavaScriptCore compatibility
require manual testing on macOS with an AllDebrid account.

API docs: [IINA](https://docs.iina.io/) · [AllDebrid](https://docs.alldebrid.com/)
