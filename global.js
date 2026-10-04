const { http, menu, standaloneWindow: view, utils, preferences, global: players } = iina;
const { videos, metadata } = require('./library.js');
const API = 'https://api.alldebrid.com/';
const FILE_BATCH_SIZE = 500;
let statusSession = Math.floor(Math.random() * 2147483647) + 1;
let statusCounter = 0;
let statuses = new Map();
let fileCache = new Map();
// Transfer statistics do not change the file tree. Unknown fields invalidate it.
const TRANSFER_FIELDS = new Set(['status', 'downloaded', 'uploaded', 'downloadSpeed', 'uploadSpeed', 'seeders', 'peers']);
function fileSignature(magnet) {
  return JSON.stringify(Object.keys(magnet).filter(key => !TRANSFER_FIELDS.has(key)).sort().map(key => [key, magnet[key]]));
}
function setFiles(magnet, files) {
  magnet.files = files.map((file, index) => {
    const id = magnet.id + ':' + index;
    filesById[id] = file;
    return { id, name: file.name, path: file.path, size: file.size, metadata: metadata(file.name) };
  });
}
let generation = 0;
let busy = false;
let pinTimer = null;
let filesById = {};
// Authentication lasts only for this IINA session.
let apiKey = '';
let state = { connected: !!apiKey, busy: false, magnets: [], message: '' };
let theme = 'system';
try {
  const savedTheme = preferences.get('library-theme');
  if (['system', 'light', 'dark'].includes(savedTheme)) theme = savedTheme;
} catch (_) {}
function send() { view.postMessage('state', { ...state, theme }); }
function valid(token) { return token === generation; }
function saveKey(key) {
  apiKey = key;
  state.connected = !!key;
}
function fail(error) {
  state.message = error.message || 'An error occurred.';
  send();
}
async function request(path, data, key, get) {
  const headers = {};
  if (key) headers.Authorization = 'Bearer ' + key;
  let response;
  try {
    if (get) response = await http.get(API + path, { headers });
    else {
      headers['Content-Type'] = 'application/x-www-form-urlencoded';
      response = await http.post(API + path, { headers, data: data || {} });
    }
  } catch (error) {
    if (error && typeof error.text === 'string') response = error;
    else {
      const failure = new Error('Unable to connect to AllDebrid. Try again.');
      failure.retryable = true;
      throw failure;
    }
  }
  if (response.statusCode === 429 || response.statusCode >= 500) {
    const failure = new Error('AllDebrid temporarily unavailable (HTTP ' + response.statusCode + ').');
    failure.retryable = true;
    throw failure;
  }
  let body;
  try { body = JSON.parse(response.text); }
  catch (_) { throw new Error('Invalid AllDebrid response (HTTP ' + response.statusCode + ').'); }
  if (body.status !== 'success') {
    const code = body.error && body.error.code || 'UNKNOWN';
    throw new Error('AllDebrid: ' + code);
  }
  return body.data;
}
async function refresh(token) {
  const key = apiKey;
  if (!key) throw new Error('Connect your AllDebrid account.');
  state.message = 'Loading magnets…'; send();
  const data = await request('v4.1/magnet/status', { session: statusSession, counter: statusCounter }, key);
  if (!valid(token)) return;
  const updates = Array.isArray(data.magnets) ? data.magnets : data.magnets ? [data.magnets] : [];
  // Responses without a counter are ordinary full snapshots.
  const incremental = Number.isInteger(data.counter) && data.counter >= 0;
  const next = data.fullsync || !incremental || statusCounter === 0 ? new Map() : new Map(statuses);
  for (const update of updates) {
    const id = String(update.id);
    if (update.deleted) next.delete(id);
    else next.set(id, Object.assign({}, next.get(id), update));
  }
  statuses = next;
  statusCounter = incremental ? data.counter : 0;
  const magnets = Array.from(statuses.values());
  filesById = {};
  const pending = [];
  const retained = new Map();
  state.magnets = magnets.slice().sort((a, b) => (Number(b.uploadDate) || 0) - (Number(a.uploadDate) || 0)).map(m => {
    const magnet = { id: String(m.id), name: m.filename, status: m.status, ready: Number(m.statusCode) === 4, files: [] };
    if (magnet.ready) {
      const signature = fileSignature(m);
      const cached = fileCache.get(magnet.id);
      if (cached && cached.signature === signature) {
        retained.set(magnet.id, cached);
        setFiles(magnet, cached.files);
      } else pending.push(magnet);
    }
    return magnet;
  });
  fileCache = retained;
  state.libraryRevision = (state.libraryRevision || 0) + 1;
  send();
  let errors = 0;
  for (let offset = 0; offset < pending.length; offset += FILE_BATCH_SIZE) {
    // At most one grouped call per 150 ms, below the API rate limit.
    await new Promise(resolve => setTimeout(resolve, 150));
    if (!valid(token)) return;
    const batch = pending.slice(offset, offset + FILE_BATCH_SIZE);
    const ids = {};
    // Indexed form fields avoid relying on IINA's array serialization.
    batch.forEach((magnet, index) => { ids['id[' + index + ']'] = magnet.id; });
    let items;
    try {
      const tree = await request('v4/magnet/files', ids, key);
      if (!valid(token)) return;
      items = new Map((tree.magnets || []).map(item => [String(item.id), item]));
    } catch (_) {
      if (!valid(token)) return;
      items = new Map();
    }
    for (const magnet of batch) {
      const item = items.get(magnet.id);
      if (!item || item.error || !Array.isArray(item.files)) {
        magnet.error = 'Unable to load files. Refresh to try again.';
        errors++;
        continue;
      }
      const files = videos(item.files);
      fileCache.set(magnet.id, { signature: fileSignature(statuses.get(magnet.id)), files });
      setFiles(magnet, files);
    }
    state.libraryRevision++;
    state.message = 'Loading files: ' + Math.min(offset + batch.length, pending.length) + ' / ' + pending.length;
    send();
  }
  state.message = errors ? errors + ' magnet(s) could not be loaded.' : 'Library up to date.';
}
async function play(id, token) {
  const file = filesById[id];
  if (!file) throw new Error('File not found. Refresh the library.');
  const key = apiKey;
  state.message = 'Preparing ' + file.name + '…'; send();
  let data = await request('v4/link/unlock', { link: file.link }, key);
  if (!valid(token)) return;
  if (data.delayed) {
    const delayed = data.delayed;
    for (let attempt = 0; attempt < 120; attempt++) {
      await new Promise(resolve => setTimeout(resolve, 5000));
      if (!valid(token)) return;
      data = await request('v4/link/delayed', { id: delayed }, key);
      if (!valid(token)) return;
      if (Number(data.status) === 3) throw new Error('AllDebrid could not prepare this link.');
      if (Number(data.status) === 2) break;
      state.message = 'Preparing the link…'; send();
    }
  }
  if (!/^https?:\/\//i.test(data.link || '')) throw new Error('Playback link unavailable. Try again later.');
  // HTTP promises resume on NSURLSession's delegate queue. IINA timers run
  // on the main thread, where AppKit must create the playback window.
  await new Promise((resolve, reject) => setTimeout(() => {
    if (!valid(token)) { resolve(); return; }
    try {
      const player = players.createPlayerInstance({ url: data.link, enablePlugins: true });
      if (player === false) throw new Error('IINA could not open the playback link. Check the plugin network permissions.');
      state.message = 'Playing ' + file.name;
      resolve();
    } catch (error) { reject(error); }
  }, 0));
}
async function task(action) {
  if (busy) return;
  busy = true; state.busy = true; send();
  const token = generation;
  try { await action(token); }
  catch (error) { if (valid(token)) fail(error); }
  finally { if (valid(token)) { busy = false; state.busy = false; send(); } }
}
function cancel() {
  generation++;
  if (pinTimer !== null) clearTimeout(pinTimer);
  pinTimer = null; busy = false;
  state.busy = false; delete state.pin;
}
async function connect(token) {
  const pin = await request('v4.1/pin/get', {}, null, true);
  if (!valid(token)) return;
  if (!/^https:\/\/alldebrid\.com\/pin\//.test(pin.user_url || '')) throw new Error('Invalid sign-in URL.');
  state.pin = { code: pin.pin, url: pin.user_url };
  state.message = 'Confirm the code in your browser.'; send();
  const deadline = Date.now() + Number(pin.expires_in || 600) * 1000;
  async function poll() {
    if (!valid(token)) return;
    try {
      if (Date.now() >= deadline) throw new Error('Code expired. Start signing in again.');
      const result = await request('v4/pin/check', { pin: pin.pin, check: pin.check });
      if (!valid(token)) return;
      if (result.activated && result.apikey) {
        saveKey(result.apikey); delete state.pin;
        task(refresh);
      } else pinTimer = setTimeout(poll, 5000);
    } catch (error) {
      if (!valid(token)) return;
      if (error.retryable && Date.now() < deadline) {
        state.message = 'Connection interrupted. Retrying sign-in…'; send();
        pinTimer = setTimeout(poll, 5000);
      } else { delete state.pin; fail(error); }
    }
  }
  pinTimer = setTimeout(poll, 5000);
}
view.setProperty({ title: 'AllDebrid Library', resizable: true });
view.setFrame(900, 650);
view.loadFile('library.html');
view.onMessage('ready', () => { send(); if (state.connected && !state.magnets.length) task(refresh); });
view.onMessage('theme', value => {
  if (!['system', 'light', 'dark'].includes(value)) return;
  theme = value;
  try {
    preferences.set('library-theme', theme);
    preferences.sync();
  } catch (_) { state.message = 'Unable to save the theme preference.'; }
  send();
});
view.onMessage('refresh', () => task(refresh));
view.onMessage('connect', () => { if (busy) return; cancel(); task(connect); });
view.onMessage('play', id => task(token => play(id, token)));
view.onMessage('open-pin', () => { if (state.pin) utils.open(state.pin.url); });
view.onMessage('disconnect', () => {
  try { saveKey(''); } catch (error) { fail(error); return; }
  cancel(); filesById = {};
  statuses = new Map(); fileCache = new Map(); statusCounter = 0;
  statusSession = Math.floor(Math.random() * 2147483647) + 1;
  state = { connected: false, busy: false, magnets: [], message: 'Signed out.' }; send();
});
menu.addItem(menu.item('AllDebrid Library…', () => view.open()));
