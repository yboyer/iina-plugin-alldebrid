const el = id => document.getElementById(id);
let state = { connected: false, busy: false, magnets: [] };
const expanded = new Set();
let renderedKey = null;
let playButtons = [];
let emptyMessage = null;
function text(tag, value, className) {
  const node = document.createElement(tag);
  node.textContent = value;
  if (className) node.className = className;
  return node;
}
function size(bytes) {
  if (!bytes) return 'Unknown size';
  const unit = bytes >= 1073741824 ? 1073741824 : 1048576;
  return (bytes / unit).toFixed(1) + (unit === 1073741824 ? ' GiB' : ' MiB');
}
function render() {
  el('auth').hidden = state.connected;
  el('tools').hidden = !state.connected;
  el('refresh').hidden = el('disconnect').hidden = !state.connected && !state.pin;
  el('refresh').disabled = state.busy || !state.connected;
  el('connect').disabled = state.busy || !!state.pin;
  el('message').textContent = state.message || '';
  el('pin').hidden = !state.pin;
  if (state.pin) { el('code').textContent = state.pin.code; el('pin-link').href = state.pin.url; }
  for (const button of playButtons) button.disabled = state.busy;
  if (emptyMessage) emptyMessage.hidden = state.busy;
  const query = el('search').value.toLocaleLowerCase();
  const renderKey = JSON.stringify([state.connected, state.libraryRevision, query, el('ready-only').checked]);
  if (renderKey === renderedKey) return;
  renderedKey = renderKey;
  const container = el('magnets');
  container.replaceChildren();
  playButtons = [];
  emptyMessage = null;
  let total = 0, shown = 0;
  for (const magnet of state.magnets) {
    total += magnet.files.length;
    if (el('ready-only').checked && !magnet.ready) continue;
    const matches = (magnet.name || '').toLocaleLowerCase().includes(query);
    const files = magnet.files.filter(file => matches || file.path.toLocaleLowerCase().includes(query));
    if (!matches && !files.length) continue;
    shown++;
    const details = document.createElement('details');
    details.open = !!query || expanded.has(magnet.id);
    const summary = text('summary', magnet.name || 'Untitled');
    summary.append(text('span', (magnet.ready ? 'Ready' : magnet.status || 'Unavailable') + ' · ' + magnet.files.length + ' video(s)', 'status'));
    details.append(summary);
    let loaded = false;
    function loadFiles() {
      if (loaded) return;
      loaded = true;
      if (magnet.error) details.append(text('p', magnet.error));
      else if (!files.length) details.append(text('p', magnet.ready ? 'No videos found in this magnet.' : 'Files will be available when the magnet is ready.'));
      for (const file of files) {
        const row = document.createElement('div'); row.className = 'file';
        const info = text('div', file.name);
        info.append(text('small', file.path + ' · ' + size(file.size)));
        const button = text('button', 'Play'); button.disabled = state.busy;
        playButtons.push(button);
        button.addEventListener('click', () => iina.postMessage('play', file.id));
        row.append(info, button); details.append(row);
      }
    }
    details.addEventListener('toggle', () => {
      if (!container.contains(details)) return;
      if (details.open) { expanded.add(magnet.id); loadFiles(); }
      else expanded.delete(magnet.id);
    });
    if (details.open) loadFiles();
    container.append(details);
  }
  el('count').textContent = state.connected ? shown + ' / ' + state.magnets.length + ' magnets · ' + total + ' video(s)' : '';
  if (state.connected && !shown) {
    emptyMessage = text('p', state.magnets.length ? 'No results.' : 'No magnets in this account.');
    emptyMessage.hidden = state.busy;
    container.append(emptyMessage);
  }
}
for (const action of ['refresh', 'connect', 'disconnect']) el(action).addEventListener('click', () => iina.postMessage(action, null));
el('pin-link').addEventListener('click', event => { event.preventDefault(); iina.postMessage('open-pin', null); });
el('search').addEventListener('input', render);
el('ready-only').addEventListener('change', render);
iina.onMessage('state', value => { state = value; render(); });
iina.postMessage('ready', null);
