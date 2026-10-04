const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')

function harness() {
  class Node {
    constructor(tag) {
      this.tag = tag
      this.children = []
      this.listeners = {}
      this.value = ''
      this.checked = false
    }
    append(...children) {
      for (const node of children) {
        node.parent = this
        this.children.push(node)
      }
    }
    remove() {
      if (this.parent) {
        this.parent.children = this.parent.children.filter(node => node !== this)
        this.parent = null
      }
    }
    insertBefore(node, reference) {
      node.remove()
      const index = reference ? this.children.indexOf(reference) : this.children.length
      this.children.splice(index, 0, node)
      node.parent = this
    }
    replaceChildren(...children) {
      this.children = children
    }
    addEventListener(name, callback) {
      this.listeners[name] = callback
    }
    contains(node) {
      return this === node || this.children.some(child => child.contains(node))
    }
    toggle(open) {
      this.open = open
      this.listeners.toggle()
    }
  }
  const nodes = new Map()
  const messages = []
  let receive
  vm.runInNewContext(fs.readFileSync(require.resolve('../dist/plugin/library-ui.js'), 'utf8'), {
    document: {
      documentElement: { dataset: {} },
      getElementById(id) {
        if (!nodes.has(id)) nodes.set(id, new Node(id))
        return nodes.get(id)
      },
      createElement: tag => new Node(tag),
    },
    iina: {
      onMessage: (_, callback) => {
        receive = callback
      },
      postMessage: (...args) => messages.push(args),
    },
  })
  return { nodes, messages, receive }
}
const library = {
  connected: true,
  busy: false,
  libraryRevision: 1,
  magnets: [
    {
      id: '1',
      name: 'Series',
      ready: true,
      files: [{ id: '1:0', name: 'Episode', path: 'Season/Episode.mkv', size: 42 }],
    },
  ],
}

test('videos render directly without torrent name below path and preserve rows across busy changes', () => {
  const h = harness()
  h.receive(library)
  const row = h.nodes.get('magnets').children[0]
  const button = row.children[1]
  assert.equal(row.tag, 'article')
  assert.equal(row.children[0].children[0].textContent, 'Season/Episode.mkv · 0.0 MiB')
  assert.equal(row.children[0].children.length, 1)
  button.listeners.click()
  assert.deepEqual(h.messages.at(-1), ['play', '1:0'])
  h.receive({ ...library, busy: true })
  assert.equal(h.nodes.get('magnets').children[0], row)
  assert.equal(button.disabled, true)
  h.receive(library)
  assert.equal(button.disabled, false)
})
test('search shows matching paths directly and empty states follow busy', () => {
  const h = harness()
  h.receive(library)
  h.nodes.get('search').value = 'season'
  h.nodes.get('search').listeners.input()
  assert.equal(h.nodes.get('magnets').children.length, 1)
  assert.equal(h.nodes.get('magnets').children[0].children[0].textContent, 'Episode')
  h.receive({ connected: true, busy: true, libraryRevision: 3, magnets: [] })
  const empty = h.nodes.get('magnets').children[0]
  assert.equal(empty.hidden, true)
  h.receive({ connected: true, busy: false, libraryRevision: 3, magnets: [] })
  assert.equal(h.nodes.get('magnets').children[0], empty)
  assert.equal(empty.hidden, false)
})

test('theme follows plugin state and switches immediately', () => {
  const h = harness()
  h.receive({ ...library, theme: 'dark' })
  assert.equal(h.nodes.get('theme').value, 'dark')
  h.nodes.get('theme').value = 'light'
  h.nodes.get('theme').listeners.change()
  assert.deepEqual(h.messages.at(-1), ['theme', 'light'])
  h.receive({ ...library, theme: 'system' })
  assert.equal(h.nodes.get('theme').value, 'system')
})

test('search ignores accents and combines words across magnet names and file metadata', () => {
  const h = harness()
  h.receive({
    ...library,
    magnets: [
      {
        ...library.magnets[0],
        name: 'Cinéma',
        files: [
          {
            id: '1:0',
            name: 'Amélie.2001.mkv',
            path: 'Films/Amélie.2001.mkv',
            metadata: { title: 'Amélie', year: 2001, resolution: '1080P' },
          },
          { id: '1:1', name: 'Autre.mkv', path: 'Films/Autre.mkv' },
        ],
      },
    ],
  })
  h.nodes.get('search').value = '  CINEMA amelie 1080p '
  h.nodes.get('search').listeners.input()
  assert.equal(h.nodes.get('magnets').children.length, 1)
  const row = h.nodes.get('magnets').children[0]
  assert.equal(row.children[0].textContent, 'Amélie')
  assert.equal(row.children[0].children[0].textContent, '2001 · 1080P')
})

test('TMDB settings clear submitted key and posters load lazily with failure fallback', () => {
  const h = harness()
  h.nodes.set('tmdb-key', { value: 'key' })
  h.nodes.get('tmdb-save').listeners.click()
  assert.deepEqual(h.messages.at(-1), ['tmdb-key', 'key'])
  assert.equal(h.nodes.get('tmdb-key').value, '')
  h.receive({
    ...library,
    tmdbConfigured: true,
    magnets: [
      {
        ...library.magnets[0],
        files: [
          { ...library.magnets[0].files[0], poster: 'https://image.tmdb.org/t/p/w185/poster.jpg' },
        ],
      },
    ],
  })
  const slot = h.nodes.get('magnets').children[0].children[2]
  const placeholder = slot.children[0]
  const poster = slot.children[1]
  assert.equal(placeholder.textContent, 'Loading poster…')
  poster.listeners.load()
  assert.equal(placeholder.hidden, true)
  assert.equal(poster.tag, 'img')
  assert.equal(poster.loading, 'lazy')
  poster.listeners.error()
  assert.equal(poster.hidden, true)
  assert.equal(placeholder.hidden, false)
  assert.equal(placeholder.textContent, 'No poster')
})

test('missing posters retain a placeholder for movies and episodes with or without TMDB', () => {
  for (const tmdbConfigured of [false, true]) {
    for (const metadata of [{ title: 'Movie' }, { title: 'Series', season: 3, episode: 1 }]) {
      const h = harness()
      h.receive({
        ...library,
        tmdbConfigured,
        magnets: [{ ...library.magnets[0], files: [{ ...library.magnets[0].files[0], metadata }] }],
      })
      const slot = h.nodes.get('magnets').children[0].children[2]
      assert.equal(slot.className, 'poster-slot')
      assert.equal(slot.children.length, 1)
      assert.equal(slot.children[0].textContent, 'No poster')
    }
  }
})

test('poster lookup has a placeholder and unavailable magnets retain status without collapse', () => {
  const h = harness()
  h.receive({
    ...library,
    tmdbConfigured: true,
    magnets: [
      { ...library.magnets[0], files: [{ ...library.magnets[0].files[0], posterPending: true }] },
    ],
  })
  const slot = h.nodes.get('magnets').children[0].children[2]
  assert.equal(slot.children[0].textContent, 'Loading poster…')
  h.receive({
    ...library,
    libraryRevision: 2,
    magnets: [{ id: '2', name: 'Pending torrent', ready: false, status: 'Downloading', files: [] }],
  })
  const notice = h.nodes.get('magnets').children[0]
  assert.equal(notice.tag, 'section')
  assert.equal(notice.children[0].textContent, 'Pending torrent')
  assert.equal(notice.children[1].textContent, 'Downloading')
})

test('delete targets the individual video and follows busy state', () => {
  const h = harness()
  h.receive(library)
  const row = h.nodes.get('magnets').children[0]
  const button = row.children.at(-1)
  assert.equal(button.textContent, 'Delete')
  button.listeners.click()
  assert.deepEqual(h.messages.at(-1), ['delete-media', '1:0'])
  h.receive({ ...library, busy: true })
  assert.equal(button.disabled, true)
  h.receive(library)
  assert.equal(button.disabled, false)
})

test('pending deletion leaves other magnets usable and removal preserves their rows and posters', () => {
  const h = harness()
  const first = library.magnets[0]
  const second = {
    id: '2',
    name: 'Movie',
    ready: true,
    files: [
      {
        id: '2:0',
        name: 'Movie',
        path: 'Movie.mkv',
        poster: 'https://image.tmdb.org/t/p/w185/movie.jpg',
      },
    ],
  }
  h.receive({ ...library, magnets: [first, second] })
  const container = h.nodes.get('magnets')
  const original = container.children[1]
  const poster = original.children[2].children[1]
  h.receive({ ...library, magnets: [first, second], deleting: ['1:0'], deletingMagnets: ['1'] })
  assert.equal(container.children[0].children.at(-1).textContent, 'Deleting…')
  assert.equal(original.children[1].disabled, false)
  assert.equal(original.children.at(-1).disabled, false)
  h.receive({ ...library, libraryRevision: 2, magnets: [second] })
  assert.equal(container.children.length, 1)
  assert.equal(container.children[0], original)
  assert.equal(original.children[2].children[1], poster)
  assert.equal(h.nodes.get('count').textContent, '1 / 1 magnets · 1 video(s)')
})
test('deleting the only search result updates the empty state without losing other files', () => {
  const h = harness()
  const magnet = {
    ...library.magnets[0],
    files: [library.magnets[0].files[0], { id: '1:1', name: 'Movie', path: 'Movie.mkv' }],
  }
  h.nodes.get('search').value = 'episode'
  h.receive({ ...library, magnets: [magnet] })
  h.receive({ ...library, libraryRevision: 2, magnets: [{ ...magnet, files: [magnet.files[1]] }] })
  assert.equal(h.nodes.get('magnets').children[0].textContent, 'No results.')
  assert.equal(h.nodes.get('count').textContent, '0 / 1 magnets · 1 video(s)')
})

test('TMDB titles and episode names render and are searchable', () => {
  const h = harness()
  const state = {
    ...library,
    magnets: [
      {
        ...library.magnets[0],
        files: [
          {
            ...library.magnets[0].files[0],
            metadata: { title: 'show', season: 3, episode: 7 },
            tmdbTitle: 'La Série',
            episodeTitle: 'Le retour',
          },
        ],
      },
    ],
  }
  h.receive(state)
  const info = h.nodes.get('magnets').children[0].children[0]
  assert.equal(info.textContent, 'La Série — Le retour')
  assert.equal(info.children[0].textContent, 'S03E07')
  h.nodes.get('search').value = 'série retour'
  h.nodes.get('search').listeners.input()
  assert.equal(h.nodes.get('magnets').children.length, 1)
})
