import type { UserConfig } from 'tsdown'
import { defineConfig } from 'tsdown'

// Separate builds keep IINA bundles autonomous, without shared CommonJS chunks.
export default defineConfig(
  ['global', 'main', 'library', 'library-ui'].map<UserConfig>(name => ({
    entry: `src/${name}.ts`,
    outDir: 'dist/plugin',
    format: name === 'library-ui' ? 'iife' : 'cjs',
    globalName: name === 'library-ui' ? 'AllDebridUI' : undefined,
    platform: 'browser',
    // CJS otherwise overrides the platform to Node.js. IINA uses JavaScriptCore.
    inputOptions: { platform: 'browser' },
    target: 'safari14',
    minify: false,
    dts: false,
    deps:
      name === 'global' || name === 'library'
        ? { alwaysBundle: ['parse-torrent-title'], onlyBundle: ['parse-torrent-title'] }
        : undefined,
    outputOptions: { entryFileNames: `${name}.js` },
  }))
)
