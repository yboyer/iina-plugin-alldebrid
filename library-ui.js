const el = id => document.getElementById(id);
let state = { connected: false, busy: false, magnets: [] };
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
function normalize(value) {
  return String(value || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}
function render() {
  const theme = ['light', 'dark'].includes(state.theme) ? state.theme : 'system';
  document.documentElement.dataset.theme = theme;
  el('theme').value = theme;
  el('auth').hidden = state.connected;
  el('tools').hidden = !state.connected;
  el('refresh').hidden = el('disconnect').hidden = !state.connected && !state.pin;
  el('refresh').disabled = state.busy || !state.connected;
  el('connect').disabled = state.busy || !!state.pin;
  el('message').textContent = state.message || '';
  el('tmdb-status').textContent = state.tmdbMessage || (state.tmdbConfigured ? 'TMDB enabled. Save an empty key to disable.' : 'Add your TMDB API key to enable movie posters.');
  el('pin').hidden = !state.pin;
  if (state.pin) { el('code').textContent = state.pin.code; el('pin-link').href = state.pin.url; }
  for (const button of playButtons) button.disabled = state.busy;
  if (emptyMessage) emptyMessage.hidden = state.busy;
  const query = normalize(el('search').value).trim();
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
    const words = query.split(/\s+/).filter(Boolean);
    const matches = words.every(word => normalize(magnet.name).includes(word));
    const files = magnet.files.filter(file => {
      const searchable = normalize([magnet.name, file.path, ...Object.values(file.metadata || {})].join(' '));
      return words.every(word => searchable.includes(word));
    });
    if (!matches && !files.length) continue;
    shown++;
    if (magnet.error || !files.length) {
      const notice = text('section', '', 'magnet-notice');
      notice.append(text('div', magnet.name || 'Untitled'));
      notice.append(text('small', magnet.error || (magnet.ready ? 'No videos found in this magnet.' : magnet.status || 'Files will be available when the magnet is ready.')));
      container.append(notice);
    }
    for (const file of files) {
      const row = document.createElement('article'); row.className = 'file';
      const meta = file.metadata || {};
      const episode = meta.season !== undefined ? 'S' + String(meta.season).padStart(2, '0') + 'E' + String(meta.episode).padStart(2, '0') : '';
      const labels = [episode, meta.year, meta.resolution, meta.language, meta.codec, meta.source].filter(Boolean);
      const info = text('div', meta.title || file.name, 'file-info');
      if (labels.length) info.append(text('small', labels.join(' · ')));
      info.append(text('small', file.path + ' · ' + size(file.size)));
      info.append(text('small', magnet.name || 'Untitled', 'torrent-name'));
      const button = text('button', 'Play'); button.disabled = state.busy;
      playButtons.push(button);
      button.addEventListener('click', () => iina.postMessage('play', file.id));
      row.append(info, button);
      const hasPoster = /^https:\/\/image\.tmdb\.org\/t\/p\/w185\/[a-zA-Z0-9_-]+\.(jpg|png)$/.test(file.poster || '');
      if (hasPoster || (state.tmdbConfigured && meta.season === undefined)) {
        const slot = text('div', '', 'poster-slot');
        const placeholder = text('span', file.posterPending || hasPoster ? 'Loading poster…' : 'No poster', 'poster-placeholder');
        slot.append(placeholder);
        if (hasPoster) {
          const poster = document.createElement('img');
          poster.className = 'poster';
          poster.alt = 'Poster: ' + (meta.title || file.name);
          poster.loading = 'lazy'; poster.referrerPolicy = 'no-referrer';
          poster.addEventListener('load', () => { placeholder.hidden = true; });
          poster.addEventListener('error', () => { poster.hidden = true; placeholder.hidden = false; placeholder.textContent = 'No poster'; });
          poster.src = file.poster;
          slot.append(poster);
        }
        row.append(slot);
      }
      container.append(row);
    }
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
el('theme').addEventListener('change', () => {
  state.theme = el('theme').value;
  render();
  iina.postMessage('theme', state.theme);
});
el('search').addEventListener('input', render);
el('ready-only').addEventListener('change', render);
el('tmdb-save').addEventListener('click', () => {
  iina.postMessage('tmdb-key', el('tmdb-key').value);
  el('tmdb-key').value = '';
});
iina.onMessage('state', value => { state = value; render(); });
iina.postMessage('ready', null);
