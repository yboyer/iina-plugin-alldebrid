const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { videos } = require('../library');
const tick = () => new Promise(resolve => setImmediate(resolve));
async function harness(key = 'secret', initialResponse = () => ({ magnets: [] }), storage = {}) {
  const handlers = {}, calls = [], opened = [], timers = [];
  let lastState;
  let onMainThread = false, deferPlayback = false;
  const playbackTimers = [];
  let bootCalls = [];
  let response = () => ({ magnets: [] });
  const request = async (url, options) => {
    calls.push({ url, options });
    const body = await response(url, options);
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
test('each refresh reloads unchanged magnets and replaces their playback links', async () => {
  const h = await harness();
  h.respond(libraryResponse([{ id: 1, statusCode: 4 }]));
  h.handlers.refresh(); await tick();
  h.calls.length = 0;
  h.respond(url => {
    if (url.endsWith('magnet/status')) return { magnets: [{ id: 1, statusCode: 4 }] };
    if (url.endsWith('magnet/files')) return { magnets: [{ id: 1, files: [{ n: 'updated.mp4', l: 'new-link' }] }] };
    return { link: 'https://cdn.example/updated.mp4' };
  });
  h.handlers.refresh(); await tick();
  assert.equal(h.calls.length, 2);
  assert.equal(h.state().magnets[0].files[0].name, 'updated.mp4');
  h.handlers.play('1:0'); await tick();
  assert.equal(h.calls.at(-1).options.data.link, 'new-link');
  assert.equal(h.opened[0].url, 'https://cdn.example/updated.mp4');
});
test('each refresh reloads all batches after a partial failure', async () => {
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
  assert.equal(h.calls.length, 3);
  assert.equal(Object.keys(h.calls[1].options.data).length, 100);
  assert.equal(Object.keys(h.calls[2].options.data).length, 1);
  assert.equal(h.state().magnets.every(magnet => magnet.files.length === 1 && !magnet.error), true);
});
test('sign-out ignores pending file responses', async () => {
  const h = await harness();
  let finish;
  h.respond(url => url.endsWith('magnet/status') ? { magnets: [{ id: 1, statusCode: 4 }] } : new Promise(resolve => { finish = resolve; }));
  h.handlers.refresh(); await tick();
  h.handlers.disconnect();
  finish({ magnets: [{ id: 1, files: [{ n: 'private.mp4', l: 'x' }] }] }); await tick();
  assert.deepEqual(h.state().magnets, []);
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


test('theme preference persists across restart and sign-out, and rejects invalid values', async () => {
  const storage = {};
  const h = await harness('', undefined, storage);
  h.handlers.ready();
  assert.equal(h.state().theme, 'system');
  h.handlers.theme('dark');
  assert.equal(storage['library-theme'], 'dark');
  h.handlers.disconnect();
  assert.equal(h.state().theme, 'dark');
  h.handlers.theme('invalid');
  assert.equal(storage['library-theme'], 'dark');
  const reopened = await harness('', undefined, storage);
  reopened.handlers.ready();
  assert.equal(reopened.state().theme, 'dark');
  reopened.handlers.theme('light');
  assert.equal(reopened.state().theme, 'light');
  reopened.handlers.theme('system');
  assert.equal(storage['library-theme'], 'system');
});
