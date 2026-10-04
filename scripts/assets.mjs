import { copyFile, mkdir, writeFile } from 'node:fs/promises'

await mkdir('dist/plugin/licenses', { recursive: true })
for (const name of ['library.html', 'library.css']) {
  await copyFile(`src/${name}`, `dist/plugin/${name}`)
}
await copyFile('Info.json', 'dist/plugin/Info.json')
await copyFile(
  'node_modules/parse-torrent-title/LICENSE',
  'dist/plugin/licenses/parse-torrent-title.txt'
)

// IINA entries use CommonJS even though development sources use ES modules.
await writeFile('dist/plugin/package.json', `${JSON.stringify({ type: 'commonjs' })}\n`)
