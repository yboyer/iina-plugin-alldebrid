const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { videos } = require('../library');
const tick = () => new Promise(resolve => setImmediate(resolve));
async function harness(key = 'secret', storage = {}, username = 'test-user', initialResponse = () => ({ magnets: [] })) {
  const handlers = {}, calls = [], opened = [], timers = [];
  let lastState;
  let bootCalls = [];
  let response = () => ({ magnets: [] });
  const request = async (url, options) => {
    calls.push({ url, options });
    const body = url.endsWith('/user') ? { user: { username } } : await response(url, options);
    return { text: JSON.stringify({ status: 'success', data: body }), statusCode: 200 };
  };
  const context = {
    require: name => require('../' + name),
    setTimeout: (callback, delay) => { if (delay === 150) { callback(); return 0; } timers.push(callback); return timers.length; },
    clearTimeout: id => { timers[id - 1] = null; },
    iina: {
      http: { get: request, post: request },
      preferences: { get: name => storage[name], set: (name, value) => { storage[name] = value; }, sync() {} },
      menu: { item: (name, fn) => fn, addItem() {} },
      standaloneWindow: { setProperty() {}, setFrame() {}, loadFile() {}, open() {}, onMessage: (name, fn) => { handlers[name] = fn; }, postMessage: (_, state) => { lastState = JSON.parse(JSON.stringify(state)); } },
      utils: { open() {} },
      global: { createPlayerInstance: options => opened.push(options) }
    }
  };
  vm.runInNewContext(fs.readFileSync(require.resolve('../global.js'), 'utf8'), context);
  if (key) {
    response = (url, options) => url.endsWith('pin/get') ? { pin: 'ABCD', check: 'check', user_url: 'https://alldebrid.com/pin/?pin=ABCD' } : url.endsWith('pin/check') ? { activated: true, apikey: key } : initialResponse(url, options);
    handlers.connect(); await tick();
    await timers.shift()(); await tick();
    bootCalls = calls.slice();
    calls.length = 0;
  }
  return { handlers, calls, bootCalls, opened, timers, refusePlayback: () => { context.iina.global.createPlayerInstance = () => false; }, state: () => lastState, respond: fn => { response = fn; } };
}
test('recursive video discovery excludes archives, audio and files without links', () => {
  assert.deepEqual(videos([{ n: 'Season', e: [{ n: 'Episode.MKV', s: 42, l: 'https://alldebrid.com/f/a' }, { n: 'a.zip', l: 'x' }, { n: 'b.mp3', l: 'x' }, { n: 'c.mp4' }] }]), [{ name: 'Episode.MKV', path: 'Season/Episode.MKV', size: 42, link: 'https://alldebrid.com/f/a' }]);
});
test('loads all magnets, requests ready files and unlocks before playback', async () => {
  const h = await harness();
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
test('PIN authentication keeps the session key and refreshes the account', async () => {
  const h = await harness('');
  h.respond(url => url.endsWith('pin/get') ? { pin: 'ABCD', check: 'check', expires_in: 600, user_url: 'https://alldebrid.com/pin/?pin=ABCD' } : url.endsWith('pin/check') ? { activated: true, apikey: 'new-secret' } : { magnets: [] });
  h.handlers.connect(); await tick();
  assert.equal(h.state().pin.code, 'ABCD');
  await h.timers.shift()(); await tick();
  assert.equal(h.calls.at(-1).options.headers.Authorization, 'Bearer new-secret');
  assert.equal(h.state().connected, true);
  assert.equal(h.state().pin, undefined);
});
test('disconnect prevents an in-flight response from restoring private library', async () => {
  const h = await harness();
  let finish;
  h.respond(() => new Promise(resolve => { finish = resolve; }));
  h.handlers.refresh();
  h.handlers.disconnect();
  finish({ magnets: [{ id: 1, filename: 'private', statusCode: 4 }] });
  await tick();
  assert.deepEqual(h.state().magnets, []);
  assert.equal(h.state().connected, false);
});
test('partial file failures preserve other magnets and report incomplete loading', async () => {
  const h = await harness();
  h.respond(url => url.endsWith('magnet/status') ? { magnets: [{ id: 1, statusCode: 4 }, { id: 2, statusCode: 4 }] } : { magnets: [{ id: '1', error: { code: 'MAGNET_INVALID_ID' } }, { id: '2', files: [{ n: 'ok.mkv', l: 'x' }] }] });
  h.handlers.refresh(); await tick();
  assert.ok(h.state().magnets[0].error);
  assert.equal(h.state().magnets[1].files.length, 1);
  assert.match(h.state().message, /1 magnet/);
});
test('delayed links wait for readiness before opening', async () => {
  const h = await harness();
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

test('starts without Keychain APIs and requires sign-in for each session', async () => {
  const h = await harness('');
  h.handlers.ready();
  assert.equal(h.state().connected, false);
  assert.equal(h.calls.length, 0);
});

test('a refused player creation reports failure and releases the controls', async () => {
  const h = await harness();
  h.respond(url => {
    if (url.endsWith('magnet/status')) return { magnets: [{ id: 1, statusCode: 4 }] };
    if (url.endsWith('magnet/files')) return { magnets: [{ id: '1', files: [{ n: 'film.mp4', l: 'x' }] }] };
    return { link: 'https://cdn.debrid.it/film.mp4' };
  });
  h.handlers.refresh(); await tick();
  h.refusePlayback();
  h.handlers.play('1:0'); await tick();
  assert.match(h.state().message, /could not open the playback link/);
  assert.equal(h.state().busy, false);
});
