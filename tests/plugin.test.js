const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { videos } = require('../library');
const tick = () => new Promise(resolve => setImmediate(resolve));
async function harness(key = 'secret', storage = {}, username = 'test-user', initialResponse = () => ({ magnets: [] })) {
  const handlers = {}, calls = [], opened = [], timers = [];
  let lastState;
  let onMainThread = false, deferPlayback = false;
  const playbackTimers = [];
  let bootCalls = [];
  let response = () => ({ magnets: [] });
  const request = async (url, options) => {
    calls.push({ url, options });
    const body = url.endsWith('/user') ? { user: { username } } : await response(url, options);
    return { text: JSON.stringify({ status: 'success', data: body }), statusCode: 200 };
  };
  const context = {
    require: name => require('../' + name),
    setTimeout: (callback, delay) => {
      if (delay === 0) {
        const run = () => {
          onMainThread = true;
          try { callback(); } finally { onMainThread = false; }
        };
        if (deferPlayback) playbackTimers.push(run);
        else queueMicrotask(run);
        return 0;
      }
      if (delay === 150) { callback(); return 0; } timers.push(callback); return timers.length; },
    clearTimeout: id => { timers[id - 1] = null; },
    iina: {
      http: { get: request, post: request },
      preferences: { get: name => storage[name], set: (name, value) => { storage[name] = value; }, sync() {} },
      menu: { item: (name, fn) => fn, addItem() {} },
      standaloneWindow: { setProperty() {}, setFrame() {}, loadFile() {}, open() {}, onMessage: (name, fn) => { handlers[name] = fn; }, postMessage: (_, state) => { lastState = JSON.parse(JSON.stringify(state)); } },
      utils: { open() {} },
      global: { createPlayerInstance: options => {
        assert.equal(onMainThread, true, 'player windows must be created from the main-thread timer');
        return opened.push(options);
      } }
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
  return { handlers, calls, bootCalls, opened, timers, playbackTimers, deferPlayback: () => { deferPlayback = true; }, refusePlayback: () => { context.iina.global.createPlayerInstance = () => false; }, state: () => lastState, respond: fn => { response = fn; } };
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
  assert.equal(h.calls[1].options.data['id[0]'], '1');
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

function libraryResponse(magnets) {
  return (url, options) => {
    if (url.endsWith('magnet/status')) return { magnets };
    if (url.endsWith('magnet/files')) return { magnets: Object.values(options.data).map(id => ({ id, files: [{ n: 'film.mp4', l: 'https://alldebrid.com/f/' + id }] })) };
    return { link: 'https://cdn.example/film.mp4' };
  };
}
test('817 ready magnets use nine file requests with indexed form fields', async () => {
  const h = await harness();
  h.respond(libraryResponse(Array.from({ length: 817 }, (_, index) => ({ id: index + 1, statusCode: 4 }))));
  h.handlers.refresh(); await tick();
  const requests = h.calls.filter(call => call.url.endsWith('magnet/files'));
  assert.equal(requests.length, 9);
  assert.equal(Object.keys(requests[0].options.data).length, 100);
  assert.equal(requests[0].options.data['id[99]'], '100');
  assert.equal(Object.keys(requests[8].options.data).length, 17);
  assert.equal(h.state().magnets.filter(magnet => magnet.files.length === 1).length, 817);
});
test('cache survives a new IINA session and a new API key, including playback', async () => {
  const storage = {};
  const first = await harness('first-secret', storage);
  first.respond(libraryResponse([{ id: 1, filename: 'Film', hash: 'a', statusCode: 4 }]));
  first.handlers.refresh(); await tick();
  assert.ok(storage['library-cache-v1']);
  assert.doesNotMatch(storage['library-cache-v1'], /first-secret|cdn\.example/);
  const second = await harness('second-secret', storage, 'test-user', libraryResponse([{ id: 1, filename: 'Film', hash: 'a', statusCode: 4 }]));
  assert.equal(second.bootCalls.filter(call => call.url.endsWith('magnet/files')).length, 0);
  second.respond(libraryResponse([{ id: 1, filename: 'Film', hash: 'a', statusCode: 4 }]));
  second.handlers.refresh(); await tick();
  assert.equal(second.calls.length, 1);
  assert.equal(second.state().magnets[0].files.length, 1);
  second.handlers.play('1:0'); await tick();
  assert.equal(second.calls.at(-1).options.data.link, 'https://alldebrid.com/f/1');
  assert.equal(second.opened[0].url, 'https://cdn.example/film.mp4');
});
test('cache reloads expired and changed files and removes missing or non-ready magnets', async () => {
  const storage = {};
  const h = await harness('secret', storage);
  h.respond(libraryResponse([1, 2, 3, 4].map(id => ({ id, hash: 'original', statusCode: 4 }))));
  h.handlers.refresh(); await tick();
  const cache = JSON.parse(storage['library-cache-v1']);
  cache.entries['1'].savedAt = Date.now() - 25 * 60 * 60 * 1000;
  storage['library-cache-v1'] = JSON.stringify(cache);
  const next = await harness('secret', storage, 'test-user', libraryResponse([{ id: 1, hash: 'original', statusCode: 4 }, { id: 2, hash: 'changed', statusCode: 4 }, { id: 3, statusCode: 1 }]));
  assert.deepEqual(JSON.parse(JSON.stringify(next.bootCalls.at(-1).options.data)), { 'id[0]': '1', 'id[1]': '2' });
  assert.deepEqual(Object.keys(JSON.parse(storage['library-cache-v1']).entries), ['1', '2']);
  assert.deepEqual(next.state().magnets[2].files, []);
});
test('cache is isolated by account and corrupt cache is ignored', async () => {
  const storage = {};
  const first = await harness('secret', storage, 'alice');
  first.respond(libraryResponse([{ id: 1, statusCode: 4 }]));
  first.handlers.refresh(); await tick();
  const second = await harness('other-secret', storage, 'bob', libraryResponse([{ id: 1, statusCode: 4 }]));
  assert.equal(second.bootCalls.filter(call => call.url.endsWith('magnet/files')).length, 1);
  second.respond(libraryResponse([{ id: 1, statusCode: 4 }]));
  second.handlers.refresh(); await tick();
  assert.equal(second.calls.length, 1);
  assert.equal(JSON.parse(storage['library-cache-v1']).account, 'bob');
  storage['library-cache-v1'] = '{invalid';
  const third = await harness('secret', storage, 'bob');
  third.respond(libraryResponse([{ id: 1, statusCode: 4 }]));
  third.handlers.refresh(); await tick();
  assert.equal(third.state().magnets[0].files.length, 1);
});
test('failed batches are retried while successful cached files are reused', async () => {
  const h = await harness();
  const magnets = Array.from({ length: 101 }, (_, index) => ({ id: index + 1, statusCode: 4 }));
  const respond = libraryResponse(magnets);
  h.respond((url, options) => {
    if (url.endsWith('magnet/files') && options.data['id[0]'] === '1') throw new Error('Network failure');
    return respond(url, options);
  });
  h.handlers.refresh(); await tick();
  assert.match(h.state().message, /100 magnet/);
  h.calls.length = 0;
  h.respond(respond);
  h.handlers.refresh(); await tick();
  assert.equal(h.calls.length, 2);
  assert.equal(Object.keys(h.calls[1].options.data).length, 100);
  assert.equal(h.state().magnets.every(magnet => magnet.files.length === 1 && !magnet.error), true);
});
test('sign-out clears persistent cache and ignores pending file responses', async () => {
  const storage = {};
  const h = await harness('secret', storage);
  let finish;
  h.respond(url => url.endsWith('magnet/status') ? { magnets: [{ id: 1, statusCode: 4 }] } : new Promise(resolve => { finish = resolve; }));
  h.handlers.refresh(); await tick();
  h.handlers.disconnect();
  finish({ magnets: [{ id: 1, files: [{ n: 'private.mp4', l: 'x' }] }] }); await tick();
  assert.deepEqual(h.state().magnets, []);
  assert.deepEqual(JSON.parse(storage['library-cache-v1']).entries, {});
  assert.equal(JSON.parse(storage['library-cache-v1']).account, '');
});

test('disconnect cancels playback queued for the main thread', async () => {
  const h = await harness();
  h.respond(libraryResponse([{ id: 1, statusCode: 4 }]));
  h.handlers.refresh(); await tick();
  h.deferPlayback();
  h.handlers.play('1:0'); await tick();
  assert.equal(h.playbackTimers.length, 1);
  assert.equal(h.opened.length, 0);
  assert.equal(h.state().busy, true);
  h.handlers.disconnect();
  h.playbackTimers.shift()(); await tick();
  assert.equal(h.opened.length, 0);
  assert.equal(h.state().connected, false);
  assert.equal(h.state().message, 'Signed out.');
  assert.equal(h.state().busy, false);
});

test('PIN polling retries transient failures and completes authentication', async () => {
  for (const failure of [new Error('Offline'), { statusCode: 503, text: 'Unavailable' }, { statusCode: 429, text: '{}' }]) {
    const h = await harness('');
    let checks = 0;
    h.respond(url => {
      if (url.endsWith('pin/get')) return { pin: 'ABCD', check: 'check', expires_in: 600, user_url: 'https://alldebrid.com/pin/?pin=ABCD' };
      if (url.endsWith('pin/check')) {
        if (++checks === 1) throw failure;
        return { activated: true, apikey: 'new-secret' };
      }
      return { magnets: [] };
    });
    h.handlers.connect(); await tick();
    await h.timers[0](); await tick();
    assert.equal(h.state().pin.code, 'ABCD');
    assert.match(h.state().message, /Retrying/);
    await h.timers[1](); await tick();
    assert.equal(h.state().connected, true);
    assert.equal(h.state().pin, undefined);
  }
});
test('PIN polling stops on definitive errors, expiry and sign-out', async () => {
  for (const scenario of ['invalid', 'expired', 'disconnect']) {
    const h = await harness('');
    h.respond(url => {
      if (url.endsWith('pin/get')) return { pin: 'ABCD', check: 'check', expires_in: scenario === 'expired' ? -1 : 600, user_url: 'https://alldebrid.com/pin/?pin=ABCD' };
      if (scenario === 'invalid') throw { statusCode: 400, text: JSON.stringify({ status: 'error', error: { code: 'PIN_INVALID' } }) };
      throw new Error('Offline');
    });
    h.handlers.connect(); await tick();
    await h.timers[0](); await tick();
    if (scenario === 'disconnect') {
      const retry = h.timers[1];
      h.handlers.disconnect();
      const calls = h.calls.length;
      await retry(); await tick();
      assert.equal(h.calls.length, calls);
    } else assert.equal(h.timers.length, 1);
    assert.equal(h.state().pin, undefined);
    assert.equal(h.state().connected, false);
  }
});

test('clear cache preserves sign-in and playback but reloads files on the next refresh', async () => {
  const storage = {};
  const h = await harness('secret', storage);
  h.respond(libraryResponse([{ id: 1, statusCode: 4 }]));
  h.handlers.refresh(); await tick();
  h.calls.length = 0;
  h.handlers['clear-cache']();
  assert.deepEqual(JSON.parse(storage['library-cache-v1']).entries, {});
  assert.equal(h.state().connected, true);
  assert.equal(h.state().magnets[0].files.length, 1);
  assert.equal(h.calls.length, 0);
  h.handlers.play('1:0'); await tick();
  assert.equal(h.opened.length, 1);
  h.calls.length = 0;
  h.handlers.refresh(); await tick();
  assert.equal(h.calls.filter(call => call.url.endsWith('magnet/files')).length, 1);
});

test('clear cache works before sign-in and ignores requests while busy', async () => {
  const storage = { 'library-cache-v1': JSON.stringify({ version: 1, account: 'old', entries: { private: {} } }) };
  const h = await harness('', storage);
  h.handlers['clear-cache']();
  assert.deepEqual(JSON.parse(storage['library-cache-v1']).entries, {});
  assert.equal(h.state().connected, false);
  const connected = await harness('secret', storage);
  let finish;
  connected.respond(() => new Promise(resolve => { finish = resolve; }));
  connected.handlers.refresh();
  const before = storage['library-cache-v1'];
  connected.handlers['clear-cache']();
  assert.equal(storage['library-cache-v1'], before);
  assert.equal(connected.state().busy, true);
  finish({ magnets: [] }); await tick();
});

test('theme preference persists across restart and sign-out, and rejects invalid values', async () => {
  const storage = {};
  const h = await harness('', storage);
  h.handlers.ready();
  assert.equal(h.state().theme, 'system');
  h.handlers.theme('dark');
  assert.equal(storage['library-theme'], 'dark');
  h.handlers.disconnect();
  assert.equal(h.state().theme, 'dark');
  h.handlers.theme('invalid');
  assert.equal(storage['library-theme'], 'dark');
  const reopened = await harness('', storage);
  reopened.handlers.ready();
  assert.equal(reopened.state().theme, 'dark');
  reopened.handlers.theme('light');
  assert.equal(reopened.state().theme, 'light');
  reopened.handlers.theme('system');
  assert.equal(storage['library-theme'], 'system');
});
