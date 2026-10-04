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
      getElementById(id) { if (!nodes.has(id)) nodes.set(id, new Node(id)); return nodes.get(id); },
      createElement: tag => new Node(tag)
    },
    iina: { onMessage: (_, callback) => { receive = callback; }, postMessage: (...args) => messages.push(args) }
  });
  return { nodes, messages, receive };
}
const library = { connected: true, busy: false, libraryRevision: 1, magnets: [{ id: '1', name: 'Series', ready: true, files: [{ id: '1:0', name: 'Episode', path: 'Season/Episode.mkv', size: 42 }] }] };

test('collapsed magnets load rows once on expansion and preserve rows across busy changes', () => {
  const h = harness();
  h.receive(library);
  const details = h.nodes.get('magnets').children[0];
  assert.equal(details.children.length, 1);
  details.toggle(true);
  const row = details.children[1], button = row.children[1];
  button.listeners.click();
  assert.deepEqual(h.messages.at(-1), ['play', '1:0']);
  h.receive({ ...library, busy: true });
  assert.equal(h.nodes.get('magnets').children[0], details);
  assert.equal(details.children[1], row);
  assert.equal(button.disabled, true);
  h.receive(library);
  assert.equal(button.disabled, false);
  details.toggle(false); details.toggle(true);
  assert.equal(details.children.length, 2);
});
test('search loads matching paths, revisions preserve expansion, and empty states follow busy', () => {
  const h = harness();
  h.receive(library);
  h.nodes.get('search').value = 'season';
  h.nodes.get('search').listeners.input();
  assert.equal(h.nodes.get('magnets').children[0].open, true);
  assert.equal(h.nodes.get('magnets').children[0].children.length, 2);
  h.nodes.get('magnets').children[0].toggle(true);
  h.nodes.get('search').value = '';
  h.receive({ ...library, libraryRevision: 2 });
  assert.equal(h.nodes.get('magnets').children[0].open, true);
  h.receive({ connected: true, busy: true, libraryRevision: 3, magnets: [] });
  const empty = h.nodes.get('magnets').children[0];
  assert.equal(empty.hidden, true);
  h.receive({ connected: true, busy: false, libraryRevision: 3, magnets: [] });
  assert.equal(h.nodes.get('magnets').children[0], empty);
  assert.equal(empty.hidden, false);
});
