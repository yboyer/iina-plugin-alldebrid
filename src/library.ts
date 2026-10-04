import { addDefaults, Parser } from 'parse-torrent-title'

import type { FileNode, Metadata, Video } from './types'

const VIDEO = /\.(mkv|mp4|m4v|avi|mov|webm|flv|wmv|mpg|mpeg|m2ts|mts|ts|vob|ogv|3gp)$/i
export function videos(files: FileNode[] = [], parent?: string): Video[] {
  const result: Video[] = []
  for (const file of files || []) {
    const path = parent ? `${parent}/${file.n}` : file.n
    if (Array.isArray(file.e)) result.push(...videos(file.e, path))
    else if (VIDEO.test(file.n || '') && typeof file.l === 'string') {
      result.push({ name: file.n, path, size: Number(file.s) || 0, link: file.l })
    }
  }
  return result
}

// A dedicated parser keeps plugin-specific handlers isolated from library defaults.
const parser = new Parser()
addDefaults(parser)
parser.addHandler('language', /\b(?:VFQ|VFF|VF|VO)\b/i, { skipIfAlreadyFound: true })
parser.addHandler('codec', /\bAV1\b/i, { skipIfAlreadyFound: true })
export function metadata(name: string): Metadata {
  const stem = String(name || '').replace(VIDEO, '')
  const parsed = parser.parse(stem)
  const result: Metadata = { title: stem }
  for (const key of [
    'year',
    'season',
    'episode',
    'resolution',
    'language',
    'codec',
    'source',
  ] as const) {
    if (parsed[key] !== undefined) {
      const value = parsed[key]
      Object.assign(result, { [key]: typeof value === 'string' ? value.toUpperCase() : value })
    }
  }
  result.title = parsed.title || stem
  return result
}
