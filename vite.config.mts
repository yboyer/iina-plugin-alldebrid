import { defineConfig } from 'vite'

export default defineConfig(({ mode }) => ({
  build: {
    outDir: 'dist/plugin',
    emptyOutDir: mode === 'production',
    target: 'safari14',
    minify: false,
    rolldownOptions: { output: { chunkFileNames: '[name]-[hash].js' } },
    lib:
      mode === 'ui'
        ? {
            entry: 'src/library-ui.ts',
            name: 'AllDebridUI',
            formats: ['iife'],
            fileName: () => 'library-ui.js',
          }
        : {
            // Build each entry separately so IINA never loads shared CommonJS chunks.
            entry: mode === 'production' ? 'src/global.ts' : `src/${mode}.ts`,
            formats: ['cjs'],
            fileName: () => `${mode === 'production' ? 'global' : mode}.js`,
          },
  },
}))
