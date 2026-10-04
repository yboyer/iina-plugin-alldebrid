const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function harness() {
  class Node {
    constructor(tag) { this.tag = tag; this.children = []; this.listeners = {}; this.value = ''; this.checked = false; }
    append(...nodes) { this.children.push(...nodes); }
    replaceChildren(...nodes) { this.children = nodes; }
    addEventListener(name, callback) { this.listeners[name] = callback; }
    contains(node) { return this === node || this.children.some(child => child.contains(node)); }
    toggle(open) { this.open = open; this.listeners.toggle(); }
  }
  const nodes = new Map(), messages = [];
  let receive;
  vm.runInNewContext(fs.readFileSync(require.resolve('../library-ui.js'), 'utf8'), {
    document: {
      documentElement: { dataset: {} },
      getElementById(id) { if (!nodes.has(id)) nodes.set(id, new Node(id)); return nodes.get(id); },
      createElement: tag => new Node(tag)
    },
    iina: { onMessage: (_, callback) => { receive = callback; }, postMessage: (...args) => messages.push(args) }
  });
  return { nodes, messages, receive };
}
const library = { connected: true, busy: false, libraryRevision: 1, magnets: [{ id: '1', name: 'Series', ready: true, files: [{ id: '1:0', name: 'Episode', path: 'Season/Episode.mkv', size: 42 }] }] };

test('videos render directly with torrent name below path and preserve rows across busy changes', () => {
  const h = harness();
  h.receive(library);
  const row = h.nodes.get('magnets').children[0], button = row.children[1];
  assert.equal(row.tag, 'article');
  assert.equal(row.children[0].children[0].textContent, 'Season/Episode.mkv · 0.0 MiB');
  assert.equal(row.children[0].children[1].textContent, 'Series');
  button.listeners.click();
  assert.deepEqual(h.messages.at(-1), ['play', '1:0']);
  h.receive({ ...library, busy: true });
  assert.equal(h.nodes.get('magnets').children[0], row);
  assert.equal(button.disabled, true);
  h.receive(library);
  assert.equal(button.disabled, false);
});
test('search shows matching paths directly and empty states follow busy', () => {
  const h = harness();
  h.receive(library);
  h.nodes.get('search').value = 'season';
  h.nodes.get('search').listeners.input();
  assert.equal(h.nodes.get('magnets').children.length, 1);
  assert.equal(h.nodes.get('magnets').children[0].children[0].textContent, 'Episode');
  h.receive({ connected: true, busy: true, libraryRevision: 3, magnets: [] });
  const empty = h.nodes.get('magnets').children[0];
  assert.equal(empty.hidden, true);
  h.receive({ connected: true, busy: false, libraryRevision: 3, magnets: [] });
  assert.equal(h.nodes.get('magnets').children[0], empty);
  assert.equal(empty.hidden, false);
});

test('theme follows plugin state and switches immediately', () => {
  const h = harness();
  h.receive({ ...library, theme: 'dark' });
  assert.equal(h.nodes.get('theme').value, 'dark');
  h.nodes.get('theme').value = 'light';
  h.nodes.get('theme').listeners.change();
  assert.deepEqual(h.messages.at(-1), ['theme', 'light']);
  h.receive({ ...library, theme: 'system' });
  assert.equal(h.nodes.get('theme').value, 'system');
});

test('search ignores accents and combines words across magnet names and file metadata', () => {
  const h = harness();
  h.receive({ ...library, magnets: [{ ...library.magnets[0], name: 'Cinéma', files: [
    { id: '1:0', name: 'Amélie.2001.mkv', path: 'Films/Amélie.2001.mkv', metadata: { title: 'Amélie', year: 2001, resolution: '1080P' } },
    { id: '1:1', name: 'Autre.mkv', path: 'Films/Autre.mkv' }
  ] }] });
  h.nodes.get('search').value = '  CINEMA amelie 1080p ';
  h.nodes.get('search').listeners.input();
  assert.equal(h.nodes.get('magnets').children.length, 1);
  const row = h.nodes.get('magnets').children[0];
  assert.equal(row.children[0].textContent, 'Amélie');
  assert.equal(row.children[0].children[0].textContent, '2001 · 1080P');
});

test('TMDB settings clear submitted key and posters load lazily with failure fallback', () => {
  const h = harness();
  h.nodes.set('tmdb-key', { value: 'key' });
  h.nodes.get('tmdb-save').listeners.click();
  assert.deepEqual(h.messages.at(-1), ['tmdb-key', 'key']);
  assert.equal(h.nodes.get('tmdb-key').value, '');
  h.receive({ ...library, tmdbConfigured: true, magnets: [{ ...library.magnets[0], files: [{ ...library.magnets[0].files[0], poster: 'https://image.tmdb.org/t/p/w185/poster.jpg' }] }] });
  const slot = h.nodes.get('magnets').children[0].children[2];
  const placeholder = slot.children[0], poster = slot.children[1];
  assert.equal(placeholder.textContent, 'Loading poster…');
  poster.listeners.load();
  assert.equal(placeholder.hidden, true);
  assert.equal(poster.tag, 'img');
  assert.equal(poster.loading, 'lazy');
  poster.listeners.error();
  assert.equal(poster.hidden, true);
  assert.equal(placeholder.hidden, false);
  assert.equal(placeholder.textContent, 'No poster');
});

test('poster lookup has a placeholder and unavailable magnets retain status without collapse', () => {
  const h = harness();
  h.receive({ ...library, tmdbConfigured: true, magnets: [{ ...library.magnets[0], files: [{ ...library.magnets[0].files[0], posterPending: true }] }] });
  const slot = h.nodes.get('magnets').children[0].children[2];
  assert.equal(slot.children[0].textContent, 'Loading poster…');
  h.receive({ ...library, libraryRevision: 2, magnets: [{ id: '2', name: 'Pending torrent', ready: false, status: 'Downloading', files: [] }] });
  const notice = h.nodes.get('magnets').children[0];
  assert.equal(notice.tag, 'section');
  assert.equal(notice.children[0].textContent, 'Pending torrent');
  assert.equal(notice.children[1].textContent, 'Downloading');
});
