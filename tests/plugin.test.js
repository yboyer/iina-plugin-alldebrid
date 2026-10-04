const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { videos } = require('../library');
const tick = () => new Promise(resolve => setImmediate(resolve));
function harness(key = 'secret') {
  const handlers = {}, calls = [], opened = [], timers = [];
  let lastState;
  const prefs = { apiKey: key };
  let response = () => ({ magnets: [] });
  const request = async (url, options) => {
    calls.push({ url, options });
    const body = await response(url, options);
    return { text: JSON.stringify({ status: 'success', data: body }), statusCode: 200 };
  };
  const context = {
    require: name => require('../' + name),
    setTimeout: (callback, delay) => { if (delay === 150) { callback(); return 0; } timers.push(callback); return timers.length; },
    clearTimeout: id => { timers[id - 1] = null; },
    iina: {
      http: { get: request, post: request },
      menu: { item: (name, fn) => fn, addItem() {} },
      standaloneWindow: { setProperty() {}, setFrame() {}, loadFile() {}, open() {}, onMessage: (name, fn) => { handlers[name] = fn; }, postMessage: (_, state) => { lastState = JSON.parse(JSON.stringify(state)); } },
      utils: { keyChainRead: () => prefs.apiKey, keyChainWrite: (_, name, value) => { prefs[name] = value; return true; }, open() {} },
      global: { createPlayerInstance: options => opened.push(options) }
    }
  };
  vm.runInNewContext(fs.readFileSync(require.resolve('../global.js'), 'utf8'), context);
  return { handlers, calls, opened, prefs, timers, state: () => lastState, respond: fn => { response = fn; } };
}
test('recursive video discovery excludes archives, audio and files without links', () => {
  assert.deepEqual(videos([{ n: 'Season', e: [{ n: 'Episode.MKV', s: 42, l: 'https://alldebrid.com/f/a' }, { n: 'a.zip', l: 'x' }, { n: 'b.mp3', l: 'x' }, { n: 'c.mp4' }] }]), [{ name: 'Episode.MKV', path: 'Season/Episode.MKV', size: 42, link: 'https://alldebrid.com/f/a' }]);
});
test('loads all magnets, requests ready files and unlocks before playback', async () => {
  const h = harness();
  h.respond(url => {
    if (url.endsWith('magnet/status')) return { magnets: [{ id: 1, filename: 'Ready', statusCode: 4 }, { id: 2, filename: 'Downloading', statusCode: 1 }] };
    if (url.endsWith('magnet/files')) return { magnets: [{ id: '1', files: [{ n: 'film.mp4', l: 'https://alldebrid.com/f/a' }] }] };
    return { link: 'https://cdn.example/film.mp4' };
  });
  h.handlers.refresh(); await tick();
  assert.equal(h.state().magnets.length, 2);
  assert.equal(h.calls.length, 2);
  assert.equal(h.calls[1].options.data['id[]'], '1');
  assert.equal(h.calls[0].options.headers.Authorization, 'Bearer secret');
  assert.equal(h.state().magnets[0].files[0].link, undefined);
  h.handlers.play('1:0'); await tick();
  assert.equal(h.opened[0].url, 'https://cdn.example/film.mp4');
  assert.equal(h.calls[2].options.data.link, 'https://alldebrid.com/f/a');
});
test('PIN authentication stores the key and refreshes the account', async () => {
  const h = harness('');
  h.respond(url => url.endsWith('pin/get') ? { pin: 'ABCD', check: 'check', expires_in: 600, user_url: 'https://alldebrid.com/pin/?pin=ABCD' } : url.endsWith('pin/check') ? { activated: true, apikey: 'new-secret' } : { magnets: [] });
  h.handlers.connect(); await tick();
  assert.equal(h.state().pin.code, 'ABCD');
  await h.timers.shift()(); await tick();
  assert.equal(h.prefs.apiKey, 'new-secret');
  assert.equal(h.state().connected, true);
  assert.equal(h.state().pin, undefined);
});
test('disconnect prevents an in-flight response from restoring private library', async () => {
  const h = harness();
  let finish;
  h.respond(() => new Promise(resolve => { finish = resolve; }));
  h.handlers.refresh();
  h.handlers.disconnect();
  finish({ magnets: [{ id: 1, filename: 'private', statusCode: 4 }] });
  await tick();
  assert.equal(h.prefs.apiKey, '');
  assert.deepEqual(h.state().magnets, []);
  assert.equal(h.state().connected, false);
});
test('partial file failures preserve other magnets and report incomplete loading', async () => {
  const h = harness();
  h.respond(url => url.endsWith('magnet/status') ? { magnets: [{ id: 1, statusCode: 4 }, { id: 2, statusCode: 4 }] } : { magnets: [{ id: '1', error: { code: 'MAGNET_INVALID_ID' } }, { id: '2', files: [{ n: 'ok.mkv', l: 'x' }] }] });
  h.handlers.refresh(); await tick();
  assert.ok(h.state().magnets[0].error);
  assert.equal(h.state().magnets[1].files.length, 1);
  assert.match(h.state().message, /1 magnet/);
});
test('delayed links wait for readiness before opening', async () => {
  const h = harness();
  h.respond(url => {
    if (url.endsWith('magnet/status')) return { magnets: [{ id: 1, statusCode: 4 }] };
    if (url.endsWith('magnet/files')) return { magnets: [{ id: '1', files: [{ n: 'film.mp4', l: 'x' }] }] };
    if (url.endsWith('link/unlock')) return { delayed: 123 };
    return { status: 2, link: 'https://cdn.example/ready.mp4' };
  });
  h.handlers.refresh(); await tick(); h.handlers.play('1:0'); await tick();
  assert.equal(h.opened.length, 0);
  h.timers.shift()(); await tick();
  assert.equal(h.opened[0].url, 'https://cdn.example/ready.mp4');
});
