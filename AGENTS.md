# Development toolchain

Use npm and keep `package-lock.json`. Use the Node.js version in `.node-version`.
Run `npm ci` after dependency changes, then `npm run lint` and `npm test`.
`npm run lint` checks Biome rules and both TypeScript projects without changing files.
`npm test` builds the plugin before running the existing Vitest tests.
Run `npm run pack` to validate the plugin archive when changing the build or packaging.

Keep the four independent IINA bundles in `dist/plugin`: `global.js`, `main.js`,
`library.js` (CommonJS), and `library-ui.js` (IIFE with configured global name `AllDebridUI`).
Keep the Safari 14 target, bundle `parse-torrent-title`, and avoid shared CommonJS chunks.
Preserve the asset copying and plugin packaging scripts.
