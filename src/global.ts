import type {
  ApiData,
  FileResponse,
  LibraryFile,
  LibraryState,
  Magnet,
  Metadata,
  Status,
  Video,
} from './types'
import { metadata, videos } from './library'

const { http, menu, standaloneWindow: view, utils, preferences, global: players } = iina

const API = 'https://api.alldebrid.com/'
const FILE_BATCH_SIZE = 500
let statusSession = Math.floor(Math.random() * 2147483647) + 1
let statusCounter = 0
let statuses = new Map<string, Status>()
let fileCache = new Map<string, { signature: string; files: Video[] }>()
// Transfer statistics do not change the file tree. Unknown fields invalidate it.
const TRANSFER_FIELDS = new Set([
  'status',
  'downloaded',
  'uploaded',
  'downloadSpeed',
  'uploadSpeed',
  'seeders',
  'peers',
])
function fileSignature(magnet: Status) {
  return JSON.stringify(
    Object.keys(magnet)
      .filter(key => !TRANSFER_FIELDS.has(key))
      .sort((a, b) => {
        if (a < b) return -1
        if (a > b) return 1
        return 0
      })
      .map(key => [key, magnet[key]])
  )
}
let hiddenMedia = new Set<string>()
try {
  const saved = JSON.parse(String(preferences.get('hidden-media') || '[]'))
  if (Array.isArray(saved)) hiddenMedia = new Set(saved.filter(value => typeof value === 'string'))
} catch (_) {}
function mediaIdentity(magnetId: string, file: Video) {
  return JSON.stringify([magnetId, file.path, file.size])
}
function setFiles(magnet: Magnet, files: Video[]) {
  magnet.files = files
    .map((file, index) => {
      const id = `${magnet.id}:${index}`
      if (hiddenMedia.has(mediaIdentity(magnet.id, file))) return null
      filesById[id] = file
      return {
        id,
        name: file.name,
        path: file.path,
        size: file.size,
        metadata: metadata(file.name),
      }
    })
    .filter((file): file is NonNullable<typeof file> => file !== null)
}
let generation = 0
let busy = false
const deletions = new Map<string, string>()
let pinTimer: ReturnType<typeof setTimeout> | null = null
let filesById: Record<string, Video> = {}
// Authentication lasts only for this IINA session.
let apiKey = ''
let state: LibraryState = { connected: !!apiKey, busy: false, magnets: [], message: '' }
let tmdbKey = ''
let posterGeneration = 0
interface TmdbMatch {
  id?: number
  poster: string | null
  title?: string
}
let posterCache = new Map<string, TmdbMatch>()
let episodeCache = new Map<string, string | null>()
try {
  tmdbKey = String(preferences.get('tmdb-api-key') || '')
} catch (_) {}
let theme = 'system'
try {
  const savedTheme = preferences.get('library-theme')
  if (typeof savedTheme === 'string' && ['system', 'light', 'dark'].includes(savedTheme))
    theme = savedTheme
} catch (_) {}
function send() {
  view.postMessage('state', {
    ...state,
    theme,
    tmdbConfigured: !!tmdbKey,
    deleting: Array.from(deletions.keys()),
    deletingMagnets: Array.from(deletions.values()),
  })
}
function valid(token: number) {
  return token === generation
}
function saveKey(key: string) {
  apiKey = key
  state.connected = !!key
}
function fail(error: unknown) {
  state.message = error instanceof Error ? error.message : 'An error occurred.'
  send()
}
async function request<T = ApiData>(
  path: string,
  data?: Record<string, string | number | undefined>,
  key?: string | null,
  get = false
): Promise<T> {
  const headers: Record<string, string> = {}
  if (key) headers.Authorization = `Bearer ${key}`
  let response: IinaResponse
  try {
    if (get) response = await http.get(API + path, { headers })
    else {
      headers['Content-Type'] = 'application/x-www-form-urlencoded'
      response = await http.post(API + path, { headers, data: data || {} })
    }
  } catch (error) {
    if (
      error &&
      typeof error === 'object' &&
      'text' in error &&
      'statusCode' in error &&
      typeof error.text === 'string' &&
      typeof error.statusCode === 'number'
    )
      response = { text: error.text, statusCode: error.statusCode }
    else {
      const failure = Object.assign(new Error('Unable to connect to AllDebrid. Try again.'), {
        retryable: true,
      })
      throw failure
    }
  }
  if (response.statusCode === 429 || response.statusCode >= 500) {
    const failure = Object.assign(
      new Error(`AllDebrid temporarily unavailable (HTTP ${response.statusCode}).`),
      { retryable: true }
    )
    throw failure
  }
  let body: { status: string; error?: { code?: string }; data: T }
  try {
    body = JSON.parse(response.text)
  } catch (_) {
    throw new Error(`Invalid AllDebrid response (HTTP ${response.statusCode}).`)
  }
  if (body.status !== 'success') {
    const code = body.error?.code || 'UNKNOWN'
    throw new Error(`AllDebrid: ${code}`)
  }
  return body.data
}
function posterIdentity(meta: Metadata) {
  return JSON.stringify([meta.season === undefined ? 'movie' : 'tv', meta.title, meta.year || null])
}
function episodeIdentity(file: LibraryFile) {
  return JSON.stringify([
    posterIdentity(file.metadata!),
    file.metadata!.season,
    file.metadata!.episode,
  ])
}
function applyTmdb(file: LibraryFile) {
  const match = tmdbKey ? posterCache.get(posterIdentity(file.metadata!)) : undefined
  file.poster = match?.poster || null
  file.tmdbTitle = match?.title
  file.episodeTitle = tmdbKey ? episodeCache.get(episodeIdentity(file)) || undefined : undefined
}
async function loadPosters(token: number, revision: number) {
  const key = tmdbKey
  if (!key) return
  const current = () => valid(token) && revision === posterGeneration
  const files = state.magnets.flatMap(magnet => magnet.files).filter(file => file.metadata?.title)
  const auth = `api_key=${encodeURIComponent(key)}&language=fr-FR`
  async function get(path: string, missingAllowed = false) {
    await new Promise(resolve => setTimeout(resolve, 150))
    if (!current()) return undefined
    const response = await http.get(`https://api.themoviedb.org/3/${path}`, {})
    if (!current()) return undefined
    if (missingAllowed && response.statusCode === 404) return null
    if (response.statusCode !== 200) throw new Error('TMDB request failed')
    return JSON.parse(response.text)
  }
  let failed = false
  for (const file of files) {
    if (!current()) return
    const meta = file.metadata!
    const identity = posterIdentity(meta)
    const tv = meta.season !== undefined
    try {
      if (!posterCache.has(identity)) {
        let path = `search/${tv ? 'tv' : 'movie'}?${auth}&include_adult=false&query=${encodeURIComponent(meta.title)}`
        if (meta.year)
          path += `&${tv ? 'first_air_date_year' : 'primary_release_year'}=${meta.year}`
        const body = await get(path)
        if (!current()) return
        if (!Array.isArray(body?.results)) throw new Error('Invalid TMDB response')
        const match = body.results[0]
        const title = tv ? match?.name : match?.title
        const poster = match?.poster_path
        posterCache.set(identity, {
          id: Number.isInteger(match?.id) && match.id > 0 ? match.id : undefined,
          title: typeof title === 'string' && title.trim() ? title.trim() : undefined,
          poster:
            typeof poster === 'string' && /^\/[a-zA-Z0-9_-]+\.(jpg|png)$/.test(poster)
              ? `https://image.tmdb.org/t/p/w185${poster}`
              : null,
        })
      }
      applyTmdb(file)
      const match = posterCache.get(identity)!
      const episode = episodeIdentity(file)
      if (tv && match.id && meta.episode !== undefined && !episodeCache.has(episode)) {
        const body = await get(
          `tv/${match.id}/season/${meta.season}/episode/${meta.episode}?${auth}`,
          true
        )
        if (!current()) return
        if (body !== null && (!body || typeof body !== 'object' || Array.isArray(body)))
          throw new Error('Invalid TMDB response')
        episodeCache.set(
          episode,
          typeof body?.name === 'string' && body.name.trim() ? body.name.trim() : null
        )
        applyTmdb(file)
      }
    } catch (_) {
      if (!current()) return
      failed = true
      // Keep failures out of the cache so Refresh can retry them.
    }
    file.posterPending = false
    state.libraryRevision = (state.libraryRevision || 0) + 1
    send()
  }
  if (!current()) return
  state.tmdbMessage = failed
    ? 'Unable to load TMDB metadata. Check your API key and refresh to retry.'
    : ''
  send()
}
function updatePosters() {
  const revision = ++posterGeneration
  for (const magnet of state.magnets)
    for (const file of magnet.files) {
      applyTmdb(file)
      const match = posterCache.get(posterIdentity(file.metadata!))
      file.posterPending =
        !!tmdbKey &&
        !!file.metadata?.title &&
        (!match ||
          (file.metadata.season !== undefined &&
            !!match.id &&
            file.metadata.episode !== undefined &&
            !episodeCache.has(episodeIdentity(file))))
    }
  state.libraryRevision = (state.libraryRevision || 0) + 1
  send()
  void loadPosters(generation, revision)
}
async function refresh(token: number) {
  posterGeneration++
  const key = apiKey
  if (!key) throw new Error('Connect your AllDebrid account.')
  state.message = 'Loading magnets…'
  send()
  const data = await request(
    'v4.1/magnet/status',
    { session: statusSession, counter: statusCounter },
    key
  )
  if (!valid(token)) return
  let updates: Status[] = []
  if (Array.isArray(data.magnets)) updates = data.magnets
  else if (data.magnets) updates = [data.magnets]
  // Responses without a counter are ordinary full snapshots.
  const incremental =
    typeof data.counter === 'number' && Number.isInteger(data.counter) && data.counter >= 0
  const next = data.fullsync || !incremental || statusCounter === 0 ? new Map() : new Map(statuses)
  for (const update of updates) {
    const id = String(update.id)
    if (update.deleted) next.delete(id)
    else next.set(id, { ...next.get(id), ...update })
  }
  statuses = next
  statusCounter = incremental ? data.counter! : 0
  const magnets = Array.from(statuses.values())
  filesById = {}
  const pending: Magnet[] = []
  const retained = new Map<string, { signature: string; files: Video[] }>()
  state.magnets = magnets
    .slice()
    .sort((a, b) => (Number(b.uploadDate) || 0) - (Number(a.uploadDate) || 0))
    .map(m => {
      const magnet: Magnet = {
        id: String(m.id),
        name: m.filename,
        status: m.status,
        ready: Number(m.statusCode) === 4,
        files: [],
      }
      if (magnet.ready) {
        const signature = fileSignature(m)
        const cached = fileCache.get(magnet.id)
        if (cached && cached.signature === signature) {
          retained.set(magnet.id, cached)
          setFiles(magnet, cached.files)
        } else pending.push(magnet)
      }
      return magnet
    })
  fileCache = retained
  state.libraryRevision = (state.libraryRevision || 0) + 1
  send()
  let errors = 0
  for (let offset = 0; offset < pending.length; offset += FILE_BATCH_SIZE) {
    // At most one grouped call per 150 ms, below the API rate limit.
    await new Promise(resolve => setTimeout(resolve, 150))
    if (!valid(token)) return
    const batch = pending.slice(offset, offset + FILE_BATCH_SIZE)
    const ids: Record<string, string> = {}
    // Indexed form fields avoid relying on IINA's array serialization.
    batch.forEach((magnet, index) => {
      ids[`id[${index}]`] = magnet.id
    })
    let items: Map<string, NonNullable<FileResponse['magnets']>[number]>
    try {
      const tree = await request<FileResponse>('v4/magnet/files', ids, key)
      if (!valid(token)) return
      items = new Map((tree.magnets || []).map(item => [String(item.id), item]))
    } catch (_) {
      if (!valid(token)) return
      items = new Map()
    }
    for (const magnet of batch) {
      const item = items.get(magnet.id)
      if (!item || item.error || !Array.isArray(item.files)) {
        magnet.error = 'Unable to load files. Refresh to try again.'
        errors++
        continue
      }
      const files = videos(item.files)
      fileCache.set(magnet.id, { signature: fileSignature(statuses.get(magnet.id)!), files })
      setFiles(magnet, files)
    }
    state.libraryRevision = (state.libraryRevision || 0) + 1
    state.message = `Loading files: ${Math.min(offset + batch.length, pending.length)} / ${pending.length}`
    send()
  }
  state.message = errors ? `${errors} magnet(s) could not be loaded.` : 'Library up to date.'
  updatePosters()
}
async function play(id: string, token: number) {
  const file = filesById[id]
  if (!file) throw new Error('File not found. Refresh the library.')
  const key = apiKey
  state.message = `Preparing ${file.name}…`
  send()
  let data = await request('v4/link/unlock', { link: file.link }, key)
  if (!valid(token)) return
  if (data.delayed) {
    const delayed = data.delayed
    for (let attempt = 0; attempt < 120; attempt++) {
      await new Promise(resolve => setTimeout(resolve, 5000))
      if (!valid(token)) return
      data = await request('v4/link/delayed', { id: delayed }, key)
      if (!valid(token)) return
      if (Number(data.status) === 3) throw new Error('AllDebrid could not prepare this link.')
      if (Number(data.status) === 2) break
      state.message = 'Preparing the link…'
      send()
    }
  }
  if (!/^https?:\/\//i.test(data.link || ''))
    throw new Error('Playback link unavailable. Try again later.')
  // HTTP promises resume on NSURLSession's delegate queue. IINA timers run
  // on the main thread, where AppKit must create the playback window.
  await new Promise<void>((resolve, reject) =>
    setTimeout(() => {
      if (!valid(token)) {
        resolve()
        return
      }
      try {
        const player = players.createPlayerInstance({ url: data.link!, enablePlugins: true })
        if (player === false)
          throw new Error(
            'IINA could not open the playback link. Check the plugin network permissions.'
          )
        state.message = `Playing ${file.name}`
        resolve()
      } catch (error) {
        reject(error)
      }
    }, 0)
  )
}
async function deleteMedia(id: string, token: number) {
  const file = filesById[id]
  const magnet = state.magnets.find(item => item.files.some(media => media.id === id))
  if (!file || !magnet) throw new Error('File not found. Refresh the library.')
  if (Array.from(deletions.values()).includes(magnet.id)) return
  deletions.set(id, magnet.id)
  send()
  try {
    // Let the web view show the pending action before writing preferences.
    await new Promise(resolve => setTimeout(resolve, 0))
    if (!valid(token)) return
    if (magnet.files.length === 1) {
      state.message = `Deleting ${magnet.name}…`
      send()
      await request('v4/magnet/delete', { id: magnet.id }, apiKey)
      if (!valid(token)) return
      statuses.delete(magnet.id)
      fileCache.delete(magnet.id)
      state.magnets = state.magnets.filter(item => item !== magnet)
    } else {
      const next = new Set(hiddenMedia)
      next.add(mediaIdentity(magnet.id, file))
      try {
        preferences.set('hidden-media', JSON.stringify(Array.from(next)))
        preferences.sync()
      } catch (_) {
        throw new Error('Unable to save the media deletion. Try again.')
      }
      hiddenMedia = next
      magnet.files = magnet.files.filter(media => media.id !== id)
    }
    delete filesById[id]
    state.message = `Deleted ${file.name}`
    state.libraryRevision = (state.libraryRevision || 0) + 1
  } finally {
    if (valid(token)) {
      deletions.delete(id)
      send()
    }
  }
}
async function task(action: (token: number) => Promise<void>, duringDeletion = false) {
  if (busy || (!duringDeletion && deletions.size)) return
  busy = true
  state.busy = true
  send()
  const token = generation
  try {
    await action(token)
  } catch (error) {
    if (valid(token)) fail(error)
  } finally {
    if (valid(token)) {
      busy = false
      state.busy = false
      send()
    }
  }
}
function cancel() {
  generation++
  posterGeneration++
  deletions.clear()
  if (pinTimer !== null) clearTimeout(pinTimer)
  pinTimer = null
  busy = false
  state.busy = false
  delete state.pin
}
async function connect(token: number) {
  const pin = await request('v4.1/pin/get', {}, null, true)
  if (!valid(token)) return
  if (!/^https:\/\/alldebrid\.com\/pin\//.test(pin.user_url || ''))
    throw new Error('Invalid sign-in URL.')
  state.pin = { code: pin.pin!, url: pin.user_url! }
  state.message = 'Confirm the code in your browser.'
  send()
  const deadline = Date.now() + Number(pin.expires_in || 600) * 1000
  async function poll() {
    if (!valid(token)) return
    try {
      if (Date.now() >= deadline) throw new Error('Code expired. Start signing in again.')
      const result = await request('v4/pin/check', { pin: pin.pin, check: pin.check })
      if (!valid(token)) return
      if (result.activated && result.apikey) {
        saveKey(result.apikey)
        delete state.pin
        void task(refresh)
      } else pinTimer = setTimeout(poll, 5000)
    } catch (error) {
      if (!valid(token)) return
      if (
        error &&
        typeof error === 'object' &&
        'retryable' in error &&
        error.retryable &&
        Date.now() < deadline
      ) {
        state.message = 'Connection interrupted. Retrying sign-in…'
        send()
        pinTimer = setTimeout(poll, 5000)
      } else {
        delete state.pin
        fail(error)
      }
    }
  }
  pinTimer = setTimeout(poll, 5000)
}
view.setProperty({ title: 'AllDebrid Library', resizable: true })
view.setFrame(900, 650)
view.loadFile('library.html')
view.onMessage('ready', () => {
  send()
  if (state.connected && !state.magnets.length) void task(refresh)
})
view.onMessage('theme', value => {
  if (!['system', 'light', 'dark'].includes(value)) return
  theme = value
  try {
    preferences.set('library-theme', theme)
    preferences.sync()
  } catch (_) {
    state.message = 'Unable to save the theme preference.'
  }
  send()
})
view.onMessage('tmdb-key', value => {
  if (typeof value !== 'string') return
  const key = value.trim()
  try {
    preferences.set('tmdb-api-key', key)
    preferences.sync()
  } catch (_) {
    state.tmdbMessage = 'Unable to save the TMDB API key.'
    send()
    return
  }
  tmdbKey = key
  posterCache = new Map()
  episodeCache = new Map()
  state.tmdbMessage = key ? 'TMDB enabled.' : 'TMDB disabled.'
  updatePosters()
})
view.onMessage('refresh', () => task(refresh))
view.onMessage('connect', () => {
  if (busy) return
  cancel()
  void task(connect)
})
view.onMessage('play', id => task(token => play(id, token), true))
view.onMessage('delete-media', id => {
  if (busy) return
  const token = generation
  deleteMedia(id, token).catch(error => {
    if (valid(token)) fail(error)
  })
})

view.onMessage('open-pin', () => {
  if (state.pin) utils.open(state.pin.url)
})
view.onMessage('disconnect', () => {
  try {
    saveKey('')
  } catch (error) {
    fail(error)
    return
  }
  cancel()
  filesById = {}
  statuses = new Map()
  fileCache = new Map()
  posterCache = new Map()
  episodeCache = new Map()
  statusCounter = 0
  statusSession = Math.floor(Math.random() * 2147483647) + 1
  state = { connected: false, busy: false, magnets: [], message: 'Signed out.' }
  send()
})
menu.addItem(menu.item('AllDebrid Library…', () => view.open()))
