import { defineConfig } from 'vite'

export default defineConfig(({ mode }) => ({
  build: {
    outDir: 'dist/plugin',
    emptyOutDir: mode !== 'ui',
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
            entry: { main: 'src/main.ts', global: 'src/global.ts', library: 'src/library.ts' },
            formats: ['cjs'],
            fileName: (_format, name) => `${name}.js`,
          },
  },
}))
