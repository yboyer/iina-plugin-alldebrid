import { readFile, writeFile } from 'node:fs/promises'

const info = JSON.parse(await readFile('Info.json', 'utf8'))
info.version = process.argv[2]
await writeFile('Info.json', `${JSON.stringify(info, null, 2)}\n`)
