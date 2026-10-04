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
    return { text: JSON.stringify(url.startsWith('https://api.themoviedb.org/') ? body : { status: 'success', data: body }), statusCode: 200 };
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
test('817 ready magnets use two file requests with indexed form fields', async () => {
  const h = await harness();
  h.respond(libraryResponse(Array.from({ length: 817 }, (_, index) => ({ id: index + 1, statusCode: 4 }))));
  h.handlers.refresh(); await tick();
  const requests = h.calls.filter(call => call.url.endsWith('magnet/files'));
  assert.equal(requests.length, 2);
  assert.equal(Object.keys(requests[0].options.data).length, 500);
  assert.equal(requests[0].options.data['id[499]'], '500');
  assert.equal(Object.keys(requests[1].options.data).length, 317);
  assert.equal(h.state().magnets.filter(magnet => magnet.files.length === 1).length, 817);
});
test('unchanged magnets retain files and playback source links', async () => {
  const h = await harness();
  h.respond(libraryResponse([{ id: 1, statusCode: 4 }]));
  h.handlers.refresh(); await tick();
  h.calls.length = 0;
  h.handlers.refresh(); await tick();
  assert.equal(h.calls.length, 1);
  assert.equal(h.state().magnets[0].files[0].name, 'film.mp4');
  h.handlers.play('1:0'); await tick();
  assert.equal(h.calls.at(-1).options.data.link, 'https://alldebrid.com/f/1');
});
test('refresh retries only failed batches', async () => {
  const h = await harness();
  const magnets = Array.from({ length: 501 }, (_, index) => ({ id: index + 1, statusCode: 4 }));
  const respond = libraryResponse(magnets);
  h.respond((url, options) => {
    if (url.endsWith('magnet/files') && options.data['id[0]'] === '1') throw new Error('Network failure');
    return respond(url, options);
  });
  h.handlers.refresh(); await tick();
  assert.match(h.state().message, /500 magnet/);
  h.calls.length = 0;
  h.respond(respond);
  h.handlers.refresh(); await tick();
  assert.equal(h.calls.length, 2);
  assert.equal(Object.keys(h.calls[1].options.data).length, 500);
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

test('incremental status merges partial changes, preserves files, deletes and replaces on fullsync', async () => {
  const h = await harness('secret', (url, options) => url.endsWith('magnet/status')
    ? { fullsync: true, counter: 1, magnets: [{ id: 1, filename: 'Film', statusCode: 4 }, { id: 2, filename: 'Pending', statusCode: 1 }] }
    : libraryResponse([])(url, options));
  const session = h.bootCalls.find(call => call.url.endsWith('magnet/status')).options.data.session;
  h.respond((url, options) => url.endsWith('magnet/status')
    ? { counter: 2, magnets: [{ id: 2, downloaded: 42 }] }
    : libraryResponse([])(url, options));
  h.handlers.refresh(); await tick();
  assert.equal(h.calls.length, 1);
  assert.equal(h.calls[0].options.data.session, session);
  assert.equal(h.calls[0].options.data.counter, 1);
  assert.equal(h.state().magnets[0].files.length, 1);
  assert.equal(h.state().magnets[1].name, 'Pending');
  h.respond((url, options) => url.endsWith('magnet/status')
    ? { counter: 3, magnets: [{ id: 2, deleted: true }] }
    : libraryResponse([])(url, options));
  h.handlers.refresh(); await tick();
  assert.equal(h.state().magnets.length, 1);
  h.respond(() => ({ fullsync: true, counter: 1, magnets: [] }));
  h.handlers.refresh(); await tick();
  assert.deepEqual(h.state().magnets, []);
});

test('filename metadata identifies movies and episodes while preserving unknown titles', () => {
  const { metadata } = require('../library');
  assert.deepEqual(metadata('Amélie.2001.1080p.MULTI.x265.BluRay.mkv'), {
    year: 2001, resolution: '1080P', language: 'MULTI', codec: 'X265', source: 'BLURAY', title: 'Amélie'
  });
  assert.deepEqual(metadata('Série.S02E03.720p.VOSTFR.WEB-DL.mp4'), {
    season: 2, episode: 3, resolution: '720P', language: 'VOSTFR', source: 'WEB-DL', title: 'Série'
  });
  assert.equal(metadata('Show.2x12.mkv').episode, 12);
  assert.equal(metadata('Un titre inconnu.mkv').title, 'Un titre inconnu');
});

test('cache follows file changes, readiness, deletion and full snapshots', async () => {
  const h = await harness();
  let magnets = [{ id: 1, filename: 'Film', statusCode: 4, size: 10 }];
  h.respond((url, options) => libraryResponse(magnets)(url, options));
  const refresh = async expected => {
    h.calls.length = 0;
    h.handlers.refresh(); await tick();
    assert.equal(h.calls.filter(call => call.url.endsWith('magnet/files')).length, expected);
  };
  await refresh(1);
  magnets = [{ ...magnets[0], downloaded: 10, downloadSpeed: 0 }];
  await refresh(0);
  magnets = [{ ...magnets[0], size: 20 }];
  await refresh(1);
  magnets = [{ ...magnets[0], statusCode: 1 }];
  await refresh(0);
  assert.equal(h.state().magnets[0].files.length, 0);
  h.handlers.play('1:0'); await tick();
  assert.match(h.state().message, /File not found/);
  magnets = [{ ...magnets[0], statusCode: 4 }];
  await refresh(1);
  await refresh(0);
  magnets = [];
  await refresh(0);
  magnets = [{ id: 1, statusCode: 4 }];
  await refresh(1);
  h.handlers.disconnect();
  assert.equal(h.state().magnets.length, 0);
});

const tmdbLibrary = url => url.endsWith('magnet/status')
  ? { magnets: [{ id: 1, filename: 'Movies', statusCode: 4 }] }
  : { magnets: [{ id: 1, files: [
    { n: 'Amélie.2001.mkv', l: 'a' },
    { n: 'Amélie.2001.1080p.mkv', l: 'b' },
    { n: 'Show.S01E01.mkv', l: 'c' }
  ] }] };
test('TMDB stores key, searches title/year, caches duplicates, and excludes episodes', async () => {
  const storage = {};
  const h = await harness('secret', tmdbLibrary, storage);
  h.respond(url => url.startsWith('https://api.themoviedb.org/') ? { results: [{ poster_path: '/poster.jpg' }] } : tmdbLibrary(url));
  h.handlers['tmdb-key'](' tmdb-secret '); await tick();
  assert.equal(storage['tmdb-api-key'], 'tmdb-secret');
  assert.equal(h.state().tmdbConfigured, true);
  const calls = h.calls.filter(call => call.url.includes('/search/movie'));
  assert.equal(calls.length, 1);
  assert.match(calls[0].url, /query=Am%C3%A9lie/);
  assert.match(calls[0].url, /primary_release_year=2001/);
  assert.equal(calls[0].options.headers, undefined);
  assert.equal(h.state().magnets[0].files[0].poster, 'https://image.tmdb.org/t/p/w185/poster.jpg');
  assert.equal(h.state().magnets[0].files[1].poster, h.state().magnets[0].files[0].poster);
  assert.equal(h.state().magnets[0].files[2].poster, null);
  assert.equal(JSON.stringify(h.state()).includes('tmdb-secret'), false);
  h.handlers.refresh(); await tick();
  assert.equal(h.calls.filter(call => call.url.includes('/search/movie')).length, 1);
  h.handlers['tmdb-key'](''); await tick();
  assert.equal(h.state().tmdbConfigured, false);
  assert.equal(h.state().magnets[0].files[0].poster, null);
});
test('TMDB failures retry on refresh, missing posters are cached, and playback remains available', async () => {
  const h = await harness('secret', tmdbLibrary);
  h.respond(url => {
    if (url.includes('/search/movie')) throw new Error('Offline');
    return url.endsWith('link/unlock') ? { link: 'https://cdn.example/movie.mkv' } : tmdbLibrary(url);
  });
  h.handlers['tmdb-key']('key'); await tick();
  assert.match(h.state().tmdbMessage, /Unable to load TMDB/);
  assert.equal(h.state().magnets[0].files[0].posterPending, false);
  h.handlers.play('1:0'); await tick();
  assert.equal(h.opened.length, 1);
  h.respond(url => url.includes('/search/movie') ? { results: [] } : tmdbLibrary(url));
  h.handlers.refresh(); await tick();
  assert.equal(h.state().tmdbMessage, '');
  assert.equal(h.state().magnets[0].files[0].poster, null);
  const count = h.calls.length;
  h.handlers.refresh(); await tick();
  assert.equal(h.calls.slice(count).filter(call => call.url.includes('/search/movie')).length, 0);
});
test('pending TMDB responses are ignored after sign-out and key replacement', async () => {
  for (const action of ['disconnect', 'replace']) {
    const h = await harness('secret', tmdbLibrary);
    let resolve;
    h.respond(() => new Promise(done => { resolve = done; }));
    h.handlers['tmdb-key']('old-key'); await tick();
    assert.equal(h.state().magnets[0].files[0].posterPending, true);
    if (action === 'disconnect') h.handlers.disconnect();
    else h.handlers['tmdb-key']('');
    resolve({ results: [{ poster_path: '/stale.jpg' }] }); await tick();
    assert.equal(JSON.stringify(h.state()).includes('stale.jpg'), false);
    if (action === 'disconnect') assert.deepEqual(h.state().magnets, []);
  }
});

const deletionLibrary = url => url.endsWith('magnet/status')
  ? { magnets: [{ id: 1, filename: 'Two videos', statusCode: 4 }] }
  : { magnets: [{ id: 1, files: [{ n: 'one.mkv', l: 'a' }, { n: 'two.mkv', l: 'b' }] }] };
test('media deletion persists across refresh and restart and deletes the magnet only for the last video', async () => {
  const storage = {};
  const h = await harness('secret', deletionLibrary, storage);
  h.respond(deletionLibrary);
  h.handlers['delete-media']('1:0'); await tick();
  assert.equal(h.calls.length, 0);
  assert.deepEqual(h.state().magnets[0].files.map(file => file.id), ['1:1']);
  h.handlers.refresh(); await tick();
  assert.deepEqual(h.state().magnets[0].files.map(file => file.id), ['1:1']);
  const restarted = await harness('secret', deletionLibrary, storage);
  assert.deepEqual(restarted.state().magnets[0].files.map(file => file.id), ['1:1']);
  restarted.respond(() => ({}));
  restarted.handlers['delete-media']('1:1'); await tick();
  assert.equal(restarted.calls.length, 1);
  assert.match(restarted.calls[0].url, /v4\/magnet\/delete$/);
  assert.equal(restarted.calls[0].options.data.id, '1');
  assert.deepEqual(restarted.state().magnets, []);
  restarted.respond(() => ({ magnets: [], counter: 1 }));
  restarted.handlers.refresh(); await tick();
  assert.deepEqual(restarted.state().magnets, []);
});
test('failed last-media deletion preserves the video and disconnect ignores a pending deletion', async () => {
  const h = await harness('secret', deletionLibrary);
  h.handlers['delete-media']('1:0'); await tick();
  h.respond(() => { throw new Error('Offline'); });
  h.handlers['delete-media']('1:1'); await tick();
  assert.equal(h.state().magnets[0].files[0].id, '1:1');
  assert.equal(h.state().busy, false);
  assert.match(h.state().message, /Unable to connect/);
  let finish;
  h.respond(() => new Promise(resolve => { finish = resolve; }));
  h.handlers['delete-media']('1:1'); await tick();
  h.handlers.disconnect();
  finish({}); await tick();
  assert.deepEqual(h.state().magnets, []);
  assert.equal(h.state().message, 'Signed out.');
});

test('pending deletion is scoped to a magnet, rejects duplicates and allows other playback', async () => {
  const listing = url => url.endsWith('magnet/status')
    ? { magnets: [{ id: 1, statusCode: 4 }, { id: 2, statusCode: 4 }] }
    : { magnets: [{ id: 1, files: [{ n: 'one.mkv', l: 'a' }] }, { id: 2, files: [{ n: 'two.mkv', l: 'b' }] }] };
  const h = await harness('secret', listing);
  let finish;
  h.respond(url => url.endsWith('magnet/delete') ? new Promise(resolve => { finish = resolve; }) : { link: 'https://cdn.example/two.mkv' });
  h.handlers['delete-media']('1:0'); await tick();
  assert.equal(h.state().busy, false);
  assert.deepEqual(h.state().deleting, ['1:0']);
  h.handlers['delete-media']('1:0');
  h.handlers.refresh(); await tick();
  assert.equal(h.calls.length, 1);
  h.handlers.play('2:0'); await tick();
  assert.equal(h.opened.length, 1);
  finish({}); await tick();
  assert.deepEqual(h.state().deleting, []);
  assert.deepEqual(h.state().magnets.map(magnet => magnet.id), ['2']);
});
test('deletion keeps remaining poster results and does not restart TMDB lookups', async () => {
  const h = await harness('secret', tmdbLibrary);
  h.respond(url => url.includes('/search/movie') ? { results: [{ poster_path: '/movie.jpg' }] } : tmdbLibrary(url));
  h.handlers['tmdb-key']('key'); await tick();
  const poster = h.state().magnets[0].files[1].poster;
  const before = h.calls.length;
  h.handlers['delete-media']('1:0'); await tick();
  assert.equal(h.calls.length, before);
  assert.equal(h.state().magnets[0].files[0].poster, poster);
});
