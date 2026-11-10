export interface Metadata {
  codec?: string
  episode?: number
  language?: string
  resolution?: string
  season?: number
  source?: string
  title: string
  year?: number
}
export interface FileNode {
  e?: FileNode[]
  l?: string
  n: string
  s?: number | string
}
export interface Video {
  link: string
  name: string
  path: string
  size: number
}
export interface LibraryFile extends Omit<Video, 'link'> {
  episodeTitle?: string
  id: string
  metadata?: Metadata
  poster?: string | null
  posterPending?: boolean
  tmdbTitle?: string
}
export interface Magnet {
  error?: string
  files: LibraryFile[]
  id: string
  name: string
  ready: boolean
  status?: string
}
export interface LibraryState {
  busy: boolean
  connected: boolean
  deleting?: string[]
  deletingMagnets?: string[]
  libraryRevision?: number
  magnets: Magnet[]
  message?: string
  pin?: { code: string; url: string }
  theme?: string
  tmdbConfigured?: boolean
  tmdbMessage?: string
}
export interface Status {
  deleted?: boolean
  filename: string
  id: string | number
  status?: string
  statusCode?: number | string
  uploadDate?: number | string
  [key: string]: unknown
}
export interface ApiData {
  activated?: boolean
  apikey?: string
  check?: string
  counter?: number
  delayed?: string | number
  expires_in?: number
  fullsync?: boolean
  link?: string
  magnets?: Status[] | Status
  pin?: string
  status?: number | string
  user_url?: string
}
export interface FileResponse {
  magnets?: { id: string | number; error?: unknown; files?: FileNode[] }[]
}
