import config from '@yboyer/config/vite-plus'
import { defineConfig, mergeConfig } from 'vite-plus'

export default defineConfig(() =>
  mergeConfig(config, {
    staged: {
      '*': 'vp check --fix',
    },
    fmt: { printWidth: 100 },
    lint: {
      overrides: [
        { files: ['src/**/*.ts'], env: { browser: true } },
        {
          files: ['src/global.ts', 'src/library-ui.ts'],
          globals: { iina: 'readonly' },
        },
        {
          files: ['src/**/*.d.ts'],
          rules: { 'typescript/consistent-type-imports': 'off' },
        },
        {
          files: ['__tests__/**', 'scripts/**'],
          env: { node: true },
        },
        {
          files: ['__tests__/**/*.ts'],
          rules: {
            // IINA HTTP failures can be plain response objects.
            'typescript/only-throw-error': 'off',
          },
        },
      ],
    },
    // Separate entries keep IINA bundles autonomous, without shared CommonJS chunks.
    pack: ['global', 'main', 'library', 'library-ui'].map(name => ({
      entry: `src/${name}.ts`,
      outDir: 'dist/plugin',
      format: name === 'library-ui' ? 'iife' : 'cjs',
      globalName: name === 'library-ui' ? 'AllDebridUI' : undefined,
      platform: 'browser',
      target: 'safari14',
      minify: false,
      dts: false,
      deps:
        name === 'global' || name === 'library'
          ? { alwaysBundle: ['parse-torrent-title'], onlyBundle: ['parse-torrent-title'] }
          : undefined,
      outputOptions: { entryFileNames: `${name}.js` },
    })),
  })
)
