const { http, menu, standaloneWindow: view, utils, preferences, global: players } = iina;
const { videos } = require('./library.js');
const API = 'https://api.alldebrid.com/';
const CACHE_KEY = 'library-cache-v1';
const CACHE_TTL = 24 * 60 * 60 * 1000;
const FILE_BATCH_SIZE = 100;
let account = '';
let cache = { version: 1, account: '', entries: {} };
let cacheWarning = '';
function loadCache() {
  try {
    const stored = JSON.parse(preferences.get(CACHE_KEY) || 'null');
    if (stored && stored.version === 1 && stored.account === account && stored.entries && typeof stored.entries === 'object') cache = stored;
    else cache = { version: 1, account, entries: {} };
  } catch (_) { cache = { version: 1, account, entries: {} }; }
}
function persistCache() {
  try {
    preferences.set(CACHE_KEY, JSON.stringify(cache));
    preferences.sync();
  } catch (_) { cacheWarning = ' Unable to save the library cache.'; }
}
function fingerprint(magnet) {
  return JSON.stringify([magnet.hash, magnet.filename, magnet.size, magnet.uploadDate]);
}
function cachedFiles(entry, signature) {
  return entry && entry.signature === signature && Number.isFinite(entry.savedAt) &&
    Date.now() >= entry.savedAt && Date.now() - entry.savedAt < CACHE_TTL &&
    Array.isArray(entry.files) && entry.files.every(file => file && typeof file.name === 'string' &&
      typeof file.path === 'string' && typeof file.link === 'string');
}
function setFiles(magnet, files) {
  magnet.files = files.map((file, index) => {
    const id = magnet.id + ':' + index;
    filesById[id] = file;
    return { id, name: file.name, path: file.path, size: file.size };
  });
}
let generation = 0;
let busy = false;
let pinTimer = null;
let filesById = {};
// Authentication lasts only for this IINA session.
let apiKey = '';
let state = { connected: !!apiKey, busy: false, magnets: [], message: '' };
function send() { view.postMessage('state', state); }
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
  cacheWarning = '';
  if (!account) {
    const user = await request('v4/user', {}, key, true);
    if (!valid(token)) return;
    if (!user.user || typeof user.user.username !== 'string' || !user.user.username) throw new Error('Unable to identify the AllDebrid account.');
    account = user.user.username;
    loadCache();
  }
  state.message = 'Loading magnets…'; send();
  const data = await request('v4.1/magnet/status', {}, key);
  if (!valid(token)) return;
  const magnets = Array.isArray(data.magnets) ? data.magnets : data.magnets ? [data.magnets] : [];
  filesById = {};
  const pending = [], entries = {};
  state.magnets = magnets.slice().sort((a, b) => (Number(b.uploadDate) || 0) - (Number(a.uploadDate) || 0)).map(m => {
    const magnet = { id: String(m.id), name: m.filename, status: m.status, ready: Number(m.statusCode) === 4, files: [] };
    if (magnet.ready) {
      const signature = fingerprint(m);
      const entry = cache.entries[magnet.id];
      if (cachedFiles(entry, signature)) {
        entries[magnet.id] = entry;
        setFiles(magnet, entry.files);
      } else pending.push({ magnet, signature });
    }
    return magnet;
  });
  cache.entries = entries;
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
    batch.forEach(({ magnet }, index) => { ids['id[' + index + ']'] = magnet.id; });
    let items;
    try {
      const tree = await request('v4/magnet/files', ids, key);
      if (!valid(token)) return;
      items = new Map((tree.magnets || []).map(item => [String(item.id), item]));
    } catch (_) {
      if (!valid(token)) return;
      items = new Map();
    }
    for (const { magnet, signature } of batch) {
      const item = items.get(magnet.id);
      if (!item || item.error || !Array.isArray(item.files)) {
        magnet.error = 'Unable to load files. Refresh to try again.';
        errors++;
        continue;
      }
      const files = videos(item.files);
      setFiles(magnet, files);
      cache.entries[magnet.id] = { signature, savedAt: Date.now(), files };
    }
    persistCache();
    state.libraryRevision++;
    state.message = 'Loading files: ' + Math.min(offset + batch.length, pending.length) + ' / ' + pending.length;
    send();
  }
  if (!pending.length) persistCache();
  state.message = (errors ? errors + ' magnet(s) could not be loaded.' : 'Library up to date.') + cacheWarning;
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
view.onMessage('refresh', () => task(refresh));
view.onMessage('clear-cache', () => {
  if (busy) return;
  cacheWarning = '';
  cache = { version: 1, account, entries: {} };
  persistCache();
  state.message = cacheWarning ? 'Unable to clear the library cache.' : 'Cache cleared. Refresh to reload files.';
  send();
});
view.onMessage('connect', () => { if (busy) return; cancel(); task(connect); });
view.onMessage('play', id => task(token => play(id, token)));
view.onMessage('open-pin', () => { if (state.pin) utils.open(state.pin.url); });
view.onMessage('disconnect', () => {
  try { saveKey(''); } catch (error) { fail(error); return; }
  cancel(); filesById = {}; account = '';
  cache = { version: 1, account: '', entries: {} };
  persistCache();
  state = { connected: false, busy: false, magnets: [], message: 'Signed out.' }; send();
});
menu.addItem(menu.item('AllDebrid Library…', () => view.open()));
