const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const shimSource = fs.readFileSync(path.join(root, 'docs', 'assets', 'js', 'gas-run-shim.js'), 'utf8');

function jsonpCallback(window, name) {
  return name.split('.').reduce((value, part) => value[part], window);
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function createPayload() {
  return {
    version: 7,
    revision: 'fixture-revision',
    metadata: {
      suggest: {
        titles: ['【推しの子】', '葬送のフリーレン'],
        yomis: ['おしのこ', 'そうそうのふりーれん'],
        authors: ['赤坂アカ×横槍メンゴ', '山田鐘人'],
        genres: ['芸能', 'ファンタジー', '連載中']
      },
      advancedOptions: {
        publishers: ['集英社', '小学館'],
        storyGenres: ['ファンタジー'],
        themeGenres: ['芸能', '18禁'],
        moodGenres: [],
        statusGenres: ['連載中'],
        mediaGenres: ['漫画', '小説'],
        releaseYears: ['2020']
      },
      quickBrowseCounts: {
        story: { 'ファンタジー': 1 },
        theme: { '芸能': 2 },
        mood: {},
        status: { '連載中': 3 },
        media: { '漫画': 4, '小説': 1 }
      }
    },
    columns: [],
    records: [
      [
        0, '11111111-1111-4111-8111-111111111111', '【推しの子】 1', '赤坂アカ×横槍メンゴ', '集英社', 'A', '1-1', '2020/07', 'ヤングジャンプ',
        '9784088916507', 'おしのこ', '芸能,連載中', '推しの子', 2, '【推しの子】', false, 1, 2,
        '', '', false,
        '推しの子1', 'おしのこ', '赤坂あか×横槍めんご', '推しの子1おしのこ赤坂あか×横槍めんご', '集英社', 202007,
        [], ['芸能'], [], ['連載中'], ['漫画']
      ],
      [
        1, '22222222-2222-4222-8222-222222222222', '【推しの子】 2', '赤坂アカ×横槍メンゴ', '集英社', 'A', '1-2', '2020/10', 'ヤングジャンプ',
        '9784088917177', 'おしのこ', '芸能,連載中', '推しの子', 2, '【推しの子】', false, 2, 2,
        '', '', false,
        '推しの子2', 'おしのこ', '赤坂あか×横槍めんご', '推しの子2おしのこ赤坂あか×横槍めんご', '集英社', 202010,
        [], ['芸能'], [], ['連載中'], ['漫画']
      ],
      [
        2, '33333333-3333-4333-8333-333333333333', '葬送のフリーレン 1', '山田鐘人', '小学館', 'B', '2-1', '2020/08', '少年サンデー',
        '9784098501809', 'そうそうのふりーれん', 'ファンタジー,連載中', '葬送のフリーレン', 1, '別名シリーズ', false, 1, 1,
        '', '', false,
        '葬送のふりーれん1', 'そうそうのふりーれん', '山田鐘人', '葬送のふりーれん1 そうそうのふりーれん 山田鐘人', '小学館', 202008,
        ['ファンタジー'], [], [], ['連載中'], ['漫画', '小説']
      ],
      [
        3, '44444444-4444-4444-8444-444444444444', 'センシティブ本 1', 'テスト作者', '同人出版社', 'C', '3-1', '2024/01', '自主制作',
        '', 'せんしてぃぶほん', '18禁,恋愛', 'センシティブ本', 1, 'センシティブ本', false, 1, 1,
        '', '', true,
        'せんしてぃぶ本1', 'せんしてぃぶほん', 'てすとさくしゃ', 'せんしてぃぶ本1 せんしてぃぶほん てすとさくしゃ', '同人出版社', 202401,
        [], ['18禁', '恋愛'], [], ['単巻'], ['漫画']
      ]
    ].map(record => record.concat(null))
  };
}

function createIndexedDb(stored) {
  const db = {
    objectStoreNames: { contains: () => true },
    close() {},
    transaction() {
      return {
        objectStore() {
          return {
            get() {
              const request = {};
              queueMicrotask(() => {
                request.result = stored;
                if (request.onsuccess) request.onsuccess();
              });
              return request;
            }
          };
        }
      };
    }
  };

  return {
    open() {
      const request = {};
      queueMicrotask(() => {
        request.result = db;
        if (request.onsuccess) request.onsuccess();
      });
      return request;
    }
  };
}

function invoke(runner, method, args) {
  return new Promise((resolve, reject) => {
    runner
      .withSuccessHandler(resolve)
      .withFailureHandler(reject)[method](...(args || []));
  });
}

async function checkDownloadedIndex(writeMode, invalid) {
  const payload = createPayload();
  if (invalid) payload.records[0] = [];
  let conversions = 0;
  payload.records.map = function(callback) {
    conversions++;
    return Array.prototype.map.call(this, callback);
  };
  const scripts = [];
  const warnings = [];
  const readyStates = [];
  let writeTransaction;
  let win;
  const db = {
    objectStoreNames: { contains: () => true }, close() {},
    transaction(store, mode) {
      const tx = { objectStore() { return {
        get() {
          const request = {};
          queueMicrotask(() => { request.result = null; request.onsuccess(); });
          return request;
        },
        put() {
          writeTransaction = tx;
          if (writeMode === 'pending') return;
          queueMicrotask(() => {
            if (writeMode === 'success') tx.oncomplete();
            else {
              tx.error = new Error('simulated storage failure');
              if (writeMode === 'abort') tx.onabort();
              else tx.onerror();
            }
          });
        }
      }; } };
      return tx;
    }
  };
  win = {
    indexedDB: { open() {
      const request = {};
      queueMicrotask(() => { request.result = db; request.onsuccess(); });
      return request;
    } },
    CustomEvent: function(type) { this.type = type; },
    addEventListener() {}, setInterval() {}, clearTimeout() {},
    setTimeout(callback, delay) { if (!delay) queueMicrotask(callback); return 1; }
  };
  const doc = {
    addEventListener() {}, visibilityState: 'visible',
    dispatchEvent(event) {
      if (event.type === 'shumi-library-local-index-ready') {
        readyStates.push(win.ShumiLibraryLocalIndex.getFreshnessState());
      }
    },
    createElement() { return { parentNode: { removeChild() {} } }; },
    head: { appendChild(script) {
      scripts.push(script);
      const params = new URL(script.src).searchParams;
      queueMicrotask(() => jsonpCallback(win, params.get('callback'))({
        ok: true,
        data: params.get('api') === 'libraryRevision' ? { revision: payload.revision } : payload
      }));
    } }
  };
  vm.runInNewContext(shimSource, {
    window: win, document: doc, navigator: { onLine: true }, URLSearchParams,
    console: { warn: (...args) => warnings.push(args), error() {} }
  });
  const manager = win.ShumiLibraryLocalIndex;
  await manager.whenLoaded();
  const refresh = manager.checkForUpdates();
  await new Promise(resolve => setImmediate(resolve));
  if (invalid) {
    assert(await refresh === false, 'invalid downloaded index is rejected');
    assert(!manager.isReady() && readyStates.length === 0, 'invalid records never become active');
    assert(!writeTransaction, 'invalid downloaded index is not persisted');
    return;
  }
  assert(manager.isReady() && manager.getFreshnessState() === 'fresh',
    `valid download is usable despite ${writeMode} persistence`);
  assert(readyStates.length === 1 && readyStates[0] === 'fresh', 'ready listeners see a fresh index');
  assert(conversions === 1, 'downloaded records are converted once');
  const requestCount = scripts.length;
  const books = await invoke(win.google.script.run, 'searchBooksSimple', ['推しの子']);
  assert(books.length === 2 && scripts.length === requestCount, 'fresh download serves local search without another request');
  if (writeMode === 'pending') {
    const settled = await Promise.race([
      refresh,
      new Promise(resolve => setTimeout(() => resolve('storage-pending-timeout'), 100))
    ]);
    assert(settled === true, 'manual refresh resolves while IndexedDB persistence is pending');
    assert(manager.getPersistenceState() === 'saving', 'pending storage is exposed separately from acquisition success');
    writeTransaction.oncomplete();
    await flushMicrotasks();
  } else {
    assert(await refresh === true, 'successful activation is not reported as a refresh failure');
    await flushMicrotasks();
  }
  if (writeMode === 'error' || writeMode === 'abort') {
    assert(manager.getPersistenceState() === 'failed', 'persistence failure is exposed after acquisition succeeds');
  }
  if (writeMode === 'error' || writeMode === 'abort') assert(warnings.length === 1, 'persistence failure is reported separately');
}

function createVirtualClock() {
  let now = 0;
  let nextId = 1;
  const timers = new Map();
  return {
    now: () => now,
    setTimeout(callback, delay) {
      const id = nextId++;
      timers.set(id, { id, at: now + Math.max(0, Number(delay) || 0), callback });
      return id;
    },
    clearTimeout(id) { timers.delete(id); },
    async advance(milliseconds) {
      const end = now + milliseconds;
      let steps = 0;
      while (true) {
        const due = Array.from(timers.values())
          .filter(timer => timer.at <= end)
          .sort((a, b) => a.at - b.at || a.id - b.id)[0];
        if (!due) break;
        timers.delete(due.id);
        now = due.at;
        due.callback();
        await flushMicrotasks();
        if (++steps > 1000) throw new Error('virtual timer loop did not settle');
      }
      now = end;
      await flushMicrotasks();
    }
  };
}

async function flushMicrotasks() {
  for (let i = 0; i < 8; i += 1) await Promise.resolve();
  await new Promise(resolve => setImmediate(resolve));
}

function appendFixtureBook(payload, title) {
  const record = payload.records[0].slice();
  record[0] = payload.records.length;
  record[1] = `55555555-5555-4555-8555-${String(payload.records.length + 1).padStart(12, '0')}`;
  record[2] = title;
  payload.records.push(record);
  return payload;
}

function createSearchRaceHarness(options) {
  const opts = options || {};
  const clock = createVirtualClock();
  const payload = opts.payload || createPayload();
  const stored = opts.stored || null;
  const routes = opts.routes || {};
  const requests = [];
  const apiFailures = [];
  const apiSuccesses = [];
  const warnings = [];
  const windowListeners = new Map();
  const documentListeners = new Map();
  let pendingWriteTransaction = null;
  let databaseOpenCount = 0;
  const writes = [];

  const db = {
    objectStoreNames: { contains: () => true },
    close() {},
    transaction(store, mode) {
      const tx = {
        objectStore() {
          return {
            get() {
              const request = {};
              if (opts.readError) {
                queueMicrotask(() => {
                  request.error = new Error('simulated IndexedDB read failure');
                  if (request.onerror) request.onerror();
                });
              } else if (opts.readDelay) {
                clock.setTimeout(() => {
                  request.result = stored;
                  if (request.onsuccess) request.onsuccess();
                }, opts.readDelay);
              } else {
                queueMicrotask(() => {
                  request.result = stored;
                  if (request.onsuccess) request.onsuccess();
                });
              }
              return request;
            },
            put(value) {
              writes.push(value);
              pendingWriteTransaction = tx;
              if (opts.writeMode === 'pending') return;
              queueMicrotask(() => {
                if (opts.writeMode === 'error') {
                  tx.error = new Error('simulated IndexedDB write failure');
                  if (tx.onerror) tx.onerror();
                } else if (tx.oncomplete) {
                  tx.oncomplete();
                }
              });
            }
          };
        }
      };
      return tx;
    }
  };

  const win = {
    indexedDB: opts.noIndexedDb ? null : {
      open() {
        const openNumber = ++databaseOpenCount;
        const request = {};
        const finishOpen = () => {
          if (opts.readError) {
            request.error = new Error('simulated IndexedDB open failure');
            if (request.onerror) request.onerror();
          } else {
            request.result = db;
            if (request.onsuccess) request.onsuccess();
          }
        };
        const delay = opts.openDelays && Number(opts.openDelays[openNumber] || 0);
        if (delay > 0) clock.setTimeout(finishOpen, delay);
        else queueMicrotask(finishOpen);
        return request;
      }
    },
    CustomEvent: function(type, init) { this.type = type; this.detail = init && init.detail; },
    addEventListener(type, handler) {
      if (!windowListeners.has(type)) windowListeners.set(type, []);
      windowListeners.get(type).push(handler);
    },
    setTimeout: clock.setTimeout,
    clearTimeout: clock.clearTimeout,
    setInterval() { return 1; },
    ShumiLibraryPwa: {
      perfStart(name, meta) { return { name, meta }; },
      perfEnd() {},
      handleApiFailure(error) { apiFailures.push(error); },
      clearApiFailure() { apiSuccesses.push(true); }
    }
  };
  const doc = {
    visibilityState: 'visible',
    addEventListener(type, handler) {
      if (!documentListeners.has(type)) documentListeners.set(type, []);
      documentListeners.get(type).push(handler);
    },
    removeEventListener(type, handler) {
      documentListeners.set(type, (documentListeners.get(type) || []).filter(item => item !== handler));
    },
    dispatchEvent(event) {
      (documentListeners.get(event.type) || []).slice().forEach(handler => handler(event));
    },
    createElement() {
      return { parentNode: { removeChild() {} } };
    },
    head: {
      appendChild(script) {
        const params = new URL(script.src).searchParams;
        const api = params.get('api');
        const route = routes[api] || {};
        requests.push({ api, at: clock.now() });
        clock.setTimeout(() => {
          if (route.error) {
            // Removing a cancelled script also removes its event handler.
            if (typeof script.onerror === 'function') script.onerror();
            return;
          }
          const routeData = typeof route.data === 'function'
            ? route.data(requests.filter(request => request.api === api).length, payload)
            : route.data;
          const data = routeData !== undefined
            ? routeData
            : api === 'libraryRevision'
              ? { version: 7, revision: payload.revision }
              : api === 'localIndex'
                ? payload
                : api === 'searchSimple'
                  ? [{ title: 'server search result' }]
                  : [];
          jsonpCallback(win, params.get('callback'))({ ok: true, data, error: null });
        }, route.delay || 0);
      }
    }
  };
  const nav = { onLine: true };
  const VirtualDate = class extends Date {
    static now() { return 1700000000000 + clock.now(); }
  };

  vm.runInNewContext(shimSource, {
    window: win,
    document: doc,
    navigator: nav,
    URLSearchParams,
    btoa: value => Buffer.from(String(value), 'binary').toString('base64'),
    Promise,
    Date: VirtualDate,
    console: { warn: (...args) => warnings.push(args), error() {} }
  });

  return {
    window: win,
    document: doc,
    clock,
    requests,
    apiFailures,
    apiSuccesses,
    warnings,
    getPendingWriteTransaction: () => pendingWriteTransaction,
    getWrites: () => writes.slice(),
    getDatabaseOpenCount: () => databaseOpenCount,
    setOnline(online) { nav.onLine = Boolean(online); },
    fireLoad() { (windowListeners.get('load') || []).forEach(handler => handler()); },
    fireFocus() { (windowListeners.get('focus') || []).forEach(handler => handler()); },
    invokeCounted(method, args) {
      let callbacks = 0;
      const promise = new Promise((resolve, reject) => {
        win.google.script.run
          .withSuccessHandler(value => { callbacks += 1; resolve(value); })
          .withFailureHandler(error => { callbacks += 1; reject(error); })[method](...(args || []));
      });
      return { promise, callbackCount: () => callbacks };
    }
  };
}

async function checkManualForceDownloadsSameRevision() {
  const storedPayload = createPayload();
  const responsePayload = appendFixtureBook(createPayload(), '同じrevisionの追加蔵書');
  const harness = createSearchRaceHarness({
    payload: responsePayload,
    stored: {
      key: 'active', schemaVersion: 7, revision: storedPayload.revision,
      savedAt: '2026-09-20T12:00:00.000Z', payload: storedPayload
    },
    routes: { localIndex: { delay: 40, data: responsePayload } }
  });
  const manager = harness.window.ShumiLibraryLocalIndex;
  await manager.whenLoaded();
  const update = manager.forceRefresh();
  await flushMicrotasks();
  assert(harness.requests.some(request => request.api === 'localIndex'),
    'manual refresh requests the full index without a revision check');
  assert(!harness.requests.some(request => request.api === 'libraryRevision'),
    'manual refresh bypasses the revision-only endpoint');
  await harness.clock.advance(40);
  const result = await update;
  assert(result.success, 'manual refresh reports a valid same-revision acquisition as success');
  assert(manager.getRevision() === storedPayload.revision, 'forced acquisition accepts the unchanged revision');
  assert(manager.getRecordCount() === storedPayload.records.length + 1,
    'same-revision acquisition replaces the active index with the downloaded records');
  assert(manager.getBookByRowIndex(storedPayload.records.length).title === '同じrevisionの追加蔵書',
    'same-revision acquisition exposes the downloaded record immediately');
  assert(manager.getLastSuccessfulUpdateAt(), 'successful acquisition records its update time');
}

async function checkManualForceFailureAndOfflineKeepPrevious() {
  const previous = createPayload();
  previous.records[0][2] = '保持される旧データ';
  const stored = {
    key: 'active', schemaVersion: 7, revision: previous.revision,
    savedAt: '2026-09-20T12:00:00.000Z', payload: previous
  };
  const failed = createSearchRaceHarness({
    payload: createPayload(),
    stored,
    routes: { localIndex: { error: true } }
  });
  const failedManager = failed.window.ShumiLibraryLocalIndex;
  await failedManager.whenLoaded();
  const failedUpdate = failedManager.forceRefresh();
  await flushMicrotasks();
  await failed.clock.advance(0);
  const failedResult = await failedUpdate;
  assert(!failedResult.success && failedResult.reason === 'failed', 'download failure is reported to the manual action');
  assert(failedManager.getBookByRowIndex(0).title === '保持される旧データ',
    'failed acquisition keeps the previous in-memory index');
  assert(failedManager.getLastSuccessfulUpdateAt() === stored.savedAt,
    'failed acquisition does not advance the last update time');

  const offline = createSearchRaceHarness({ payload: createPayload(), stored });
  const offlineManager = offline.window.ShumiLibraryLocalIndex;
  await offlineManager.whenLoaded();
  offline.setOnline(false);
  const offlineResult = await offlineManager.forceRefresh();
  assert(!offlineResult.success && offlineResult.reason === 'offline', 'offline refresh is reported accurately');
  assert(offline.requests.length === 0, 'offline refresh does not start network requests');
  assert(offlineManager.getBookByRowIndex(0).title === '保持される旧データ',
    'offline refresh keeps the previous in-memory index');
}

async function checkManualForceJoinsAutoRefresh() {
  const storedPayload = createPayload();
  const downloaded = appendFixtureBook(createPayload(), '自動確認中の強制更新');
  const harness = createSearchRaceHarness({
    payload: downloaded,
    stored: { key: 'active', schemaVersion: 7, revision: storedPayload.revision, payload: storedPayload },
    routes: {
      libraryRevision: { delay: 60, data: { version: 7, revision: storedPayload.revision } },
      localIndex: { delay: 25, data: downloaded }
    }
  });
  harness.fireLoad();
  await flushMicrotasks();
  assert(harness.requests.filter(request => request.api === 'libraryRevision').length === 1,
    'page load has one automatic revision check in flight');
  const first = harness.window.ShumiLibraryLocalIndex.forceRefresh();
  const duplicate = harness.window.ShumiLibraryLocalIndex.forceRefresh();
  await flushMicrotasks();
  await harness.clock.advance(60);
  assert(harness.requests.filter(request => request.api === 'localIndex').length === 1,
    'manual force joined to the auto check bypasses the matching revision result');
  await harness.clock.advance(25);
  const results = await Promise.all([first, duplicate]);
  assert(results.every(result => result.success), 'both callers observe the shared forced acquisition');
  assert(harness.requests.filter(request => request.api === 'libraryRevision').length === 1,
    'coalesced force requests do not start another revision check');
  assert(harness.requests.filter(request => request.api === 'localIndex').length === 1,
    'duplicate force requests start exactly one index acquisition');
  assert(harness.window.ShumiLibraryLocalIndex.getRecordCount() === downloaded.records.length,
    'the shared acquisition activates the downloaded index');
}

async function checkForceRequestSurvivesRevisionFailure() {
  const storedPayload = createPayload();
  const downloaded = appendFixtureBook(createPayload(), 'revision失敗後の更新');
  const harness = createSearchRaceHarness({
    payload: downloaded,
    stored: { key: 'active', schemaVersion: 7, revision: storedPayload.revision, payload: storedPayload },
    routes: {
      libraryRevision: { delay: 30, error: true },
      localIndex: { delay: 15, data: downloaded }
    }
  });
  harness.fireLoad();
  await flushMicrotasks();
  const update = harness.window.ShumiLibraryLocalIndex.forceRefresh();
  await flushMicrotasks();
  await harness.clock.advance(30);
  assert(harness.requests.filter(request => request.api === 'localIndex').length === 1,
    'manual force supersedes the in-flight revision with one full acquisition');
  await harness.clock.advance(15);
  const result = await update;
  assert(result.success, 'successful full acquisition satisfies force request despite revision failure');
  assert(harness.window.ShumiLibraryLocalIndex.getRecordCount() === downloaded.records.length,
    'revision failure does not leave the prior index active after successful forced download');
}

async function checkOutOfOrderIndexPersistenceKeepsLatest() {
  const storedPayload = createPayload();
  const firstPayload = appendFixtureBook(createPayload(), '遅れて保存される古い取得');
  const latestPayload = appendFixtureBook(createPayload(), '後の最新取得');
  const harness = createSearchRaceHarness({
    payload: latestPayload,
    stored: { key: 'active', schemaVersion: 7, revision: storedPayload.revision, payload: storedPayload },
    openDelays: { 2: 100 },
    routes: {
      localIndex: { delay: 5, data: requestNumber => requestNumber === 1 ? firstPayload : latestPayload }
    }
  });
  const manager = harness.window.ShumiLibraryLocalIndex;
  await manager.whenLoaded();
  const first = manager.forceRefresh();
  await flushMicrotasks();
  await harness.clock.advance(5);
  assert((await first).success, 'first index acquisition succeeds while its storage open is delayed');
  await flushMicrotasks();
  assert(harness.getDatabaseOpenCount() === 2, 'first persistence open is still pending');

  const second = manager.forceRefresh();
  await flushMicrotasks();
  await harness.clock.advance(5);
  assert((await second).success, 'newer index acquisition succeeds before the older storage open');
  await flushMicrotasks();
  assert(harness.getWrites().length === 1, 'newer index writes while stale persistence is delayed');
  const writtenRecords = harness.getWrites()[0].payload.records;
  assert(writtenRecords[writtenRecords.length - 1][2] === '後の最新取得',
    'the first completed persistence write contains the latest acquisition');

  await harness.clock.advance(95);
  await flushMicrotasks();
  assert(harness.getWrites().length === 1, 'delayed stale persistence is skipped after the newer acquisition');
  assert(manager.getBookByRowIndex(latestPayload.records.length - 1).title === '後の最新取得',
    'newer index remains active after stale storage work completes');
}

async function checkFreshRevisionWinsBeforeRemoteSearch() {
  const payload = createPayload();
  const stored = { key: 'active', schemaVersion: 7, revision: payload.revision, payload };
  const harness = createSearchRaceHarness({
    payload,
    stored,
    routes: {
      libraryRevision: { delay: 100 },
      searchSimple: { delay: 2000, data: [{ title: 'server search result' }] }
    }
  });
  harness.fireLoad();
  await flushMicrotasks();
  const search = harness.invokeCounted('searchBooksSimple', ['推しの子']);
  await harness.clock.advance(100);
  const result = await search.promise;
  assert(harness.clock.now() === 100, 'matching revision returns local search at the 100ms revision callback');
  assert(result.length === 2 && result.every(book => book.bookId), 'matching revision search preserves UUID identity');
  assert(!harness.requests.some(request => request.api === 'searchSimple'),
    'fresh index beats a 2000ms remote search before its grace timer expires');
  assert(search.callbackCount() === 1, 'matching-revision local search calls its handler once');
}

async function checkDownloadedIndexWinsLateRemote(remoteFails) {
  const payload = createPayload();
  const harness = createSearchRaceHarness({
    payload,
    writeMode: 'pending',
    routes: {
      localIndex: { delay: 500 },
      searchSimple: remoteFails
        ? { delay: 2000, error: true }
        : { delay: 2000, data: [{ title: 'late server search result' }] }
    }
  });
  harness.fireLoad();
  await flushMicrotasks();
  const search = harness.invokeCounted('searchBooksSimple', ['推しの子']);
  await harness.clock.advance(500);
  const result = await search.promise;
  assert(harness.clock.now() === 500, 'downloaded fresh index returns search before IDB persistence finishes');
  assert(result.length === 2 && result.every(book => book.bookId), 'downloaded local result keeps stable book IDs');
  assert(harness.requests.filter(request => request.api === 'localIndex').length === 1,
    'empty storage downloads one local index directly');
  assert(!harness.requests.some(request => request.api === 'libraryRevision' || request.api === 'initial'),
    'empty-storage success skips revision and initial-data requests');
  assert(search.callbackCount() === 1, 'local result wins exactly once while the remote search is pending');
  assert(harness.window.ShumiLibraryLocalIndex.getFreshnessState() === 'fresh', 'downloaded index is fresh in memory');
  assert(harness.getPendingWriteTransaction(), 'fixture keeps the index write pending after activation');

  await harness.clock.advance(1750);
  assert(search.callbackCount() === 1, 'late remote callback cannot invoke the search handler twice');
  assert(harness.apiFailures.length === 0, 'losing remote failure cannot show an API-error banner');
  assert(harness.apiSuccesses.length === 0, 'losing remote success has no visible success side effect');
  const writeTransaction = harness.getPendingWriteTransaction();
  if (writeTransaction && writeTransaction.oncomplete) writeTransaction.oncomplete();
  await flushMicrotasks();
  const requestCount = harness.requests.length;
  harness.fireFocus();
  await flushMicrotasks();
  assert(harness.requests.length === requestCount,
    'focusing after a fresh cold download does not immediately repeat its revision check');
}

async function checkIndexFailureFallsBackToRemote() {
  const freshPayload = createPayload();
  const stalePayload = createPayload();
  stalePayload.revision = 'old-revision';
  stalePayload.records = stalePayload.records.map(record => {
    const copy = record.slice();
    copy[2] = 'STALE ' + copy[2];
    return copy;
  });
  const harness = createSearchRaceHarness({
    payload: freshPayload,
    stored: { key: 'active', schemaVersion: 7, revision: stalePayload.revision, payload: stalePayload },
    routes: {
      libraryRevision: { delay: 100, data: { version: 7, revision: freshPayload.revision } },
      localIndex: { delay: 200, error: true },
      searchSimple: { delay: 800, data: [{ title: 'server latest result' }] }
    }
  });
  harness.fireLoad();
  await flushMicrotasks();
  const search = harness.invokeCounted('searchBooksSimple', ['推しの子']);
  await harness.clock.advance(1050);
  const result = await search.promise;
  assert(harness.clock.now() === 1050, 'index failure falls back to the remote search result');
  assert(result.length === 1 && result[0].title === 'server latest result', 'failed refresh never serves stale online records');
  assert(search.callbackCount() === 1, 'failed refresh and remote fallback still callback once');
  assert(harness.apiFailures.length === 0, 'quiet index-refresh failure does not raise a visible API error');
}

async function checkSlowAndUnavailableIndexedDb() {
  const payload = createPayload();
  const slowRead = createSearchRaceHarness({
    payload,
    readDelay: 600,
    routes: {
      localIndex: { delay: 500 },
      searchSimple: { delay: 2000 }
    }
  });
  slowRead.fireLoad();
  await flushMicrotasks();
  const slowSearch = slowRead.invokeCounted('searchBooksSimple', ['推しの子']);
  await slowRead.clock.advance(1100);
  const slowResult = await slowSearch.promise;
  assert(slowResult.length === 2 && slowRead.clock.now() === 1100,
    'foreground fallback starts while a slow IndexedDB read is pending and later fresh index wins');
  assert(slowSearch.callbackCount() === 1, 'slow IndexedDB race delivers one result');

  const unavailable = createSearchRaceHarness({
    payload,
    readError: true,
    routes: {
      localIndex: { delay: 100 },
      searchSimple: { delay: 1000 }
    }
  });
  unavailable.fireLoad();
  await flushMicrotasks();
  const unavailableSearch = unavailable.invokeCounted('searchBooksSimple', ['推しの子']);
  await unavailable.clock.advance(100);
  const unavailableResult = await unavailableSearch.promise;
  assert(unavailableResult.length === 2 && unavailable.clock.now() === 100,
    'memory index remains usable when IndexedDB cannot open or persist');
  assert(unavailableSearch.callbackCount() === 1, 'IndexedDB failure does not strand the search callback');

  const unsupported = createSearchRaceHarness({ noIndexedDb: true, payload });
  const immediateSearch = unsupported.invokeCounted('searchBooksSimple', ['推しの子']);
  await unsupported.clock.advance(0);
  const immediateResult = await immediateSearch.promise;
  assert(immediateResult[0].title === 'server search result', 'unsupported IndexedDB uses immediate remote search fallback');
  assert(unsupported.requests[0].api === 'searchSimple' && unsupported.requests[0].at === 0,
    'unsupported local-index API does not wait for a freshness grace period');
}

async function checkSeriesOrderSchemaUpgrade() {
  const payload = createPayload();
  payload.records[0][32] = 0; payload.records[1][32] = -2.5;
  const old = JSON.parse(JSON.stringify(payload));
  old.version = 6; old.records = old.records.map(record => record.slice(0, 32));
  const harness = createSearchRaceHarness({ payload,
    stored: { key: 'active', schemaVersion: 6, revision: old.revision, payload: old },
    routes: { localIndex: { delay: 100 } }
  });
  harness.fireLoad(); await flushMicrotasks();
  const manager = harness.window.ShumiLibraryLocalIndex;
  assert(!manager.isReady(), 'schema6 cached index cannot become active or fresh after upgrade');
  assert(harness.requests.some(request => request.api === 'localIndex'), 'upgrade downloads the full schema7 index even when revision matches');
  assert(!harness.requests.some(request => request.api === 'libraryRevision'), 'upgrade cannot accept old order-less data through matching revision');
  await harness.clock.advance(100);
  assert(manager.isReady() && manager.getFreshnessState() === 'fresh', 'schema7 acquisition restores usable local index');
  const search = harness.invokeCounted('searchBooksSimple', ['推しの子']);
  await harness.clock.advance(0);
  const result = await search.promise;
  assert(result[0].seriesOrder === 0 && result[1].seriesOrder === -2.5, 'local searches preserve zero, negative decimal orders');
  assert(result[0].bookId === payload.records[0][1], 'local search order remains catalog order');
}

(async function main() {
  await checkSeriesOrderSchemaUpgrade();
  for (const mode of ['success', 'error', 'abort', 'pending']) await checkDownloadedIndex(mode, false);
  await checkDownloadedIndex('success', true);
  await checkManualForceDownloadsSameRevision();
  await checkManualForceFailureAndOfflineKeepPrevious();
  await checkManualForceJoinsAutoRefresh();
  await checkForceRequestSurvivesRevisionFailure();
  await checkOutOfOrderIndexPersistenceKeepsLatest();
  await checkFreshRevisionWinsBeforeRemoteSearch();
  await checkDownloadedIndexWinsLateRemote(false);
  await checkDownloadedIndexWinsLateRemote(true);
  await checkIndexFailureFallsBackToRemote();
  await checkSlowAndUnavailableIndexedDb();
  const appendedScripts = [];
  const payload = createPayload();
  const stored = {
    key: 'active',
    schemaVersion: 7,
    revision: payload.revision,
    payload
  };
  const perfEntries = [];
  const documentEvents = [];

  const sandboxWindow = {
    indexedDB: createIndexedDb(stored),
    CustomEvent: function(type, init) { this.type = type; this.detail = init && init.detail; },
    addEventListener() {},
    setTimeout(callback, delay) {
      if (!delay) queueMicrotask(callback);
      return 1;
    },
    clearTimeout() {},
    setInterval() { return 1; },
    ShumiLibraryPwa: {
      perfStart(name, meta) { return { name, meta }; },
      perfEnd(token, meta) { perfEntries.push({ token, meta }); },
      handleApiFailure() {},
      clearApiFailure() {}
    }
  };
  const sandboxDocument = {
    visibilityState: 'visible',
    addEventListener() {},
    dispatchEvent(event) { documentEvents.push(event); },
    createElement() {
      return { parentNode: { removeChild() {} } };
    },
    head: { appendChild(script) { appendedScripts.push(script); } }
  };

  vm.runInNewContext(shimSource, {
    window: sandboxWindow,
    document: sandboxDocument,
    navigator: { onLine: false },
    URLSearchParams,
    btoa: value => Buffer.from(String(value), 'binary').toString('base64'),
    Proxy,
    Promise,
    Error,
    Date,
    String,
    Array,
    Object,
    Math,
    Number,
    Boolean,
    console
  });

  await new Promise(resolve => setImmediate(resolve));
  assert(sandboxWindow.ShumiLibraryLocalIndex.isSupported(), 'IndexedDB support is exposed');
  assert(await sandboxWindow.ShumiLibraryLocalIndex.whenLoaded(), 'stored index load can be awaited');
  assert(sandboxWindow.ShumiLibraryLocalIndex.isReady(), 'stored index becomes ready');
  await sandboxWindow.ShumiLibraryLocalIndex.checkForUpdates();
  assert(
    sandboxWindow.ShumiLibraryLocalIndex.getFreshnessState() === 'offline',
    'offline clients keep the stored index available without a revision check'
  );
  assert(sandboxWindow.ShumiLibraryLocalIndex.getRecordCount() === 4, 'stored index exposes its record count');
  const metadata = sandboxWindow.ShumiLibraryLocalIndex.getMetadata();
  assert(metadata.suggest.titles.includes('【推しの子】'), 'stored index exposes search suggestions');
  assert(metadata.advancedOptions.publishers.includes('小学館'), 'stored index exposes advanced search options');
  assert(metadata.quickBrowseCounts.status['連載中'] === 3, 'stored index exposes quick-browse counts');
  assert(metadata.quickBrowseCounts.media['漫画'] === 4, 'stored index exposes media quick-browse counts');
  const indexedBook = sandboxWindow.ShumiLibraryLocalIndex.getBookByRowIndex(1);
  assert(indexedBook && indexedBook.title === '【推しの子】 2', 'stored index exposes a book by row index');
  const indexedBookById = sandboxWindow.ShumiLibraryLocalIndex.getBookById('22222222-2222-4222-8222-222222222222');
  assert(indexedBookById && indexedBookById.title === '【推しの子】 2', 'stored index exposes a book by stable ID');
  assert(indexedBook.genreMeta.some(item => item.name === '芸能'), 'row lookup preserves locally stored genres');
  assert(indexedBook.genreMeta.some(item => item.name === '漫画' && item.category === 'media'), 'row lookup preserves series media');
  assert(documentEvents.some(event => event.type === 'shumi-library-local-index-ready'), 'stored index emits a ready event');

  const runner = sandboxWindow.google.script.run;
  const simple = await invoke(runner, 'searchBooksSimple', ['推しの子']);
  assert(simple.length === 2, 'simple search runs against the local index');
  assert(simple.every(book => book.detailLoaded === false), 'local search defers full book details');
  const punctuatedSimple = await invoke(runner, 'searchBooksSimple', ['【推しの子】']);
  assert(punctuatedSimple.length === 2, 'local search shares the server punctuation-normalization contract');
  const namedSeries = await invoke(runner, 'searchBooksSimple', ['別名シリーズ']);
  assert(namedSeries.length === 1 && namedSeries[0].title === '葬送のフリーレン 1',
    'local keyword search finds a curated series name absent from individual book titles');
  const namedSeriesAdvanced = await invoke(runner, 'searchBooksAdvanced', ['別名シリーズ']);
  assert(namedSeriesAdvanced.length === 1, 'advanced keyword search also matches curated series names');

  const advancedArgs = ['', '', '', '', '小学館', '', '', '', '', '', '', '', ''];
  const advanced = await invoke(runner, 'searchBooksAdvanced', advancedArgs);
  assert(advanced.length === 1 && advanced[0].title.includes('フリーレン'), 'advanced search runs against the local index');

  const otherGenreArgs = ['', '', '', '', '', '', '恋愛', '', '', '', '', '', ''];
  const otherGenre = await invoke(runner, 'searchBooksAdvanced', otherGenreArgs);
  assert(otherGenre.length === 0, 'local genre search excludes 18禁 books from other genre searches');

  const otherStatusArgs = ['', '', '', '', '', '', '', '', '単巻', '', '', '', ''];
  const otherStatus = await invoke(runner, 'searchBooksAdvanced', otherStatusArgs);
  assert(otherStatus.length === 0, 'local genre search with another category excludes 18禁 books unless theme=18禁');

  const storySensitiveArgs = ['', '', '', '', '', '18禁', '', '', '', '', '', '', ''];
  const storySensitive = await invoke(runner, 'searchBooksAdvanced', storySensitiveArgs);
  assert(storySensitive.length === 0, 'local story field cannot opt into 18禁 books');

  const sensitiveGenreArgs = ['', '', '', '', '', '', '18禁', '', '', '', '', '', ''];
  const sensitiveGenre = await invoke(runner, 'searchBooksAdvanced', sensitiveGenreArgs);
  assert(
    sensitiveGenre.length === 1 && sensitiveGenre[0].title.includes('センシティブ本'),
    'local genre search includes 18禁 books when 18禁 is explicitly selected'
  );

  const novelMediaArgs = ['', '', '', '', '', '', '', '', '', '', '', '', '', '小説'];
  const novelMedia = await invoke(runner, 'searchBooksAdvanced', novelMediaArgs);
  assert(
    novelMedia.length === 1 && novelMedia[0].title.includes('フリーレン'),
    'local media search matches either series-level media slot'
  );

  const mangaMediaArgs = ['', '', '', '', '', '', '', '', '', '', '', '', '', '漫画'];
  const mangaMedia = await invoke(runner, 'searchBooksAdvanced', mangaMediaArgs);
  assert(mangaMedia.length === 3, 'local media-only search excludes 18禁 books');

  const sensitiveMediaArgs = ['', '', '', '', '', '', '18禁', '', '', '', '', '', '', '漫画'];
  const sensitiveMedia = await invoke(runner, 'searchBooksAdvanced', sensitiveMediaArgs);
  assert(
    sensitiveMedia.length === 1 && sensitiveMedia[0].title.includes('センシティブ本'),
    'local media search includes 18禁 books when 題材=18禁 is explicit'
  );

  const keywordSensitive = await invoke(runner, 'searchBooksSimple', ['センシティブ本']);
  assert(
    keywordSensitive.length === 1 && keywordSensitive[0].title.includes('センシティブ本'),
    'local keyword search keeps 18禁 books eligible because genres are not keyword-search fields'
  );

  const random = await invoke(runner, 'getRandomBooks', [2]);
  assert(random.length === 2, 'random search returns the requested local count');
  assert(new Set(random.map(book => book.rowIndex)).size === 2, 'random search does not duplicate books');
  assert(appendedScripts.length === 0, 'local queries do not inject JSONP scripts even while offline');
  assert(perfEntries.filter(entry => entry.meta && entry.meta.local).length === 14, 'local queries record local performance entries');

  const onlineScripts = [];
  const onlineLoadHandlers = [];
  const onlineDocumentListeners = new Map();
  const onlineWindow = {
    indexedDB: createIndexedDb(stored),
    CustomEvent: function(type, init) { this.type = type; this.detail = init && init.detail; },
    addEventListener(type, handler) {
      if (type === 'load') onlineLoadHandlers.push(handler);
    },
    setTimeout(callback, delay) {
      if (!delay) queueMicrotask(callback);
      return 1;
    },
    clearTimeout() {},
    setInterval() { return 1; },
    ShumiLibraryPwa: {
      perfStart(name, meta) { return { name, meta }; },
      perfEnd() {},
      handleApiFailure() {},
      clearApiFailure() {}
    }
  };
  const onlineDocument = {
    visibilityState: 'visible',
    addEventListener(type, handler) {
      if (!onlineDocumentListeners.has(type)) onlineDocumentListeners.set(type, []);
      onlineDocumentListeners.get(type).push(handler);
    },
    removeEventListener(type, handler) {
      onlineDocumentListeners.set(type, (onlineDocumentListeners.get(type) || []).filter(item => item !== handler));
    },
    dispatchEvent(event) {
      (onlineDocumentListeners.get(event.type) || []).slice().forEach(handler => handler(event));
    },
    createElement() {
      return { parentNode: { removeChild() {} } };
    },
    head: { appendChild(script) { onlineScripts.push(script); } }
  };

  vm.runInNewContext(shimSource, {
    window: onlineWindow,
    document: onlineDocument,
    navigator: { onLine: true },
    URLSearchParams,
    btoa: value => Buffer.from(String(value), 'binary').toString('base64'),
    Proxy,
    Promise,
    Error,
    Date,
    String,
    Array,
    Object,
    Math,
    Number,
    Boolean,
    console
  });

  await new Promise(resolve => setImmediate(resolve));
  onlineLoadHandlers.forEach(handler => handler());
  await new Promise(resolve => setImmediate(resolve));

  const onlineManager = onlineWindow.ShumiLibraryLocalIndex;
  assert(onlineManager.isReady(), 'online client can load the stored index before freshness confirmation');
  assert(onlineManager.getFreshnessState() === 'checking', 'page load starts the freshness check immediately');

  const onlineRunner = onlineWindow.google.script.run;
  const freshnessRacePromise = invoke(onlineRunner, 'searchBooksSimple', ['推しの子']);
  await new Promise(resolve => setImmediate(resolve));

  const getScriptApi = script => new URL(script.src).searchParams.get('api');
  const invokeScriptCallback = (targetWindow, script, data) => {
    const callback = new URL(script.src).searchParams.get('callback');
    jsonpCallback(targetWindow, callback)({ ok: true, data, error: null });
  };
  const revisionScript = onlineScripts.find(script => getScriptApi(script) === 'libraryRevision');
  const searchScript = onlineScripts.find(script => getScriptApi(script) === 'searchSimple');
  assert(revisionScript, 'page load requests the lightweight server revision');
  assert(!searchScript, 'foreground search waits briefly before starting its remote fallback');

  invokeScriptCallback(onlineWindow, revisionScript, {
    version: 7,
    revision: payload.revision
  });
  const freshSearch = await freshnessRacePromise;
  assert(
    freshSearch.length === 2 && freshSearch.every(book => book.bookId),
    'matching revision returns the fresh local result before remote search starts'
  );
  await new Promise(resolve => setImmediate(resolve));
  assert(onlineManager.getFreshnessState() === 'fresh', 'matching revision enables local queries');
  assert(!onlineScripts.some(script => getScriptApi(script) === 'searchSimple'), 'freshness race avoids the GAS search API');

  const scriptCountBeforeLocalSearch = onlineScripts.length;
  const confirmedLocalSearch = await invoke(onlineRunner, 'searchBooksSimple', ['推しの子']);
  assert(confirmedLocalSearch.length === 2, 'confirmed-fresh index serves subsequent searches locally');
  assert(
    onlineScripts.length === scriptCountBeforeLocalSearch,
    'confirmed-fresh local search does not add another JSONP request'
  );

  console.log('local index checks ok');
  const scriptCountBeforeShelf = onlineScripts.length;
  const shelf = await invoke(onlineRunner, 'getBookshelfBooks', []);
  assert(shelf.length === payload.records.length, 'the shelf reuses all local books, including sensitive books');
  assert(shelf.every(book => book.bookId && book.detailLoaded === false), 'local shelf keeps stable IDs and deferred detail state');
  assert(onlineScripts.length === scriptCountBeforeShelf, 'fresh local shelf needs no additional catalog request');
  shelf[0].detailLoading = true;
  const shelfAgain = await invoke(onlineRunner, 'getBookshelfBooks', []);
  assert(!shelfAgain[0].detailLoading, 'shelf calls clone their records without leaking loading flags');
  onlineWindow.ShumiLibraryTestMode = { enabled: true, searchFailure: true, calls: 0, render() {} };
  const beforeFailureScripts = onlineScripts.length;
  let testFailure;
  try { await invoke(onlineRunner, 'searchBooksSimple', ['推しの子']); } catch (error) { testFailure = error; }
  assert(testFailure && testFailure.code === 'TEST_SEARCH_FAILURE', 'test mode fails even a cached local search');
  assert(onlineWindow.ShumiLibraryTestMode.calls === 1, 'test panel counts the failed request');
  assert(onlineScripts.length === beforeFailureScripts, 'simulated failure does not call GAS');
  onlineWindow.ShumiLibraryTestMode.enabled = false;
  const normalAfterTest = await invoke(onlineRunner, 'searchBooksSimple', ['推しの子']);
  assert(normalAfterTest.length === 2, 'turning test mode off restores normal search even with a stale failure flag');
  assert(onlineWindow.ShumiLibraryTestMode.calls === 1, 'disabled test mode does not count normal searches');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
