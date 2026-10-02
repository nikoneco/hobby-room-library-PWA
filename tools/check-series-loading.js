const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const read = name => fs.readFileSync(path.join(root, name), 'utf8');
const plain = value => JSON.parse(JSON.stringify(value));
const shim = read('docs/assets/js/gas-run-shim.js');

// Synthetic orders exercise the three named series without copying private catalog data.
const seriesFixtures = [
  ['fixture-zaregoto', '戯言シリーズ', ['クビキリサイクル', 'サイコロジカル 下', 'サイコロジカル 上', 'ヒトクイマジカル']],
  ['fixture-harry', 'ハリー・ポッター', ['賢者の石', '秘密の部屋', 'アズカバンの囚人', '炎のゴブレット']],
  ['fixture-shoshimin', '小市民シリーズ', ['春期限定いちごタルト事件', '夏期限定トロピカルパフェ事件', '秋期限定栗きんとん事件 上', '秋期限定栗きんとん事件 下']]
];
function payload() {
  return {
    version: 7, revision: 'revision-one', columns: [], metadata: {},
    records: seriesFixtures.flatMap(([key, seriesTitle, titles], group) => titles.map((title, index) => {
      const row = group * 4 + index;
      return [row, '00000000-0000-4000-8000-' + String(row).padStart(12, '0'), title,
        index === 2 ? '原作者 | 訳者A' : '原作者 | 訳者B', '', '', '', '', '', '', '', '', key, 4,
        seriesTitle, false, index + 1, 4, '', '', false, title, '', '原作者', title + ' 原作者', '', 0,
        [], [], [], [], ['小説'], [null, 1.5, 0, -2][index]].map((value, column) =>
          column === 23 ? (index === 2 ? '原作者|訳者a' : '原作者|訳者b')
            : column === 24 ? title + ' 原作者 ' + (index === 2 ? '訳者a' : '訳者b') : value);
    }))
  };
}

function harness() {
  let now = 0, nextTimer = 1;
  const timers = new Map(), requests = [], activeScripts = new Set(), nodes = new Map();
  const perf = [], notifications = [];
  const classes = () => {
    const names = new Set();
    return { add: (...items) => items.forEach(item => names.add(item)), remove: (...items) => items.forEach(item => names.delete(item)),
      contains: item => names.has(item), toggle: item => names.has(item) ? names.delete(item) : names.add(item) };
  };
  const node = () => ({ style: { setProperty() {}, removeProperty() {} }, classList: classes(), children: [],
    setAttribute() {}, removeAttribute() {}, focus() {}, contains: () => false, querySelector: () => null, querySelectorAll: () => [],
    appendChild(child) { this.children.push(child); } });
  const window = {
    location: { search: '' }, scrollY: 0, addEventListener() {}, scrollTo() {},
    localStorage: { getItem: () => null, setItem() {} },
    setTimeout(fn, ms) { const id = nextTimer++; timers.set(id, { fn, due: now + ms, ms }); return id; },
    clearTimeout(id) { timers.delete(id); }, requestAnimationFrame(fn) { return this.setTimeout(fn, 16); },
    performance: { now: () => now },
    ShumiLibraryPwa: {
      perfStart(name, meta) { const item = { name, meta, ended: false }; perf.push(item); return item; },
      perfEnd(token, meta) { if (token) { assert(!token.ended, 'performance request settles once'); token.ended = true; token.result = meta; } },
      recordPerf() {}, handleApiFailure(error) { notifications.push({ code: error.code }); },
      clearApiFailure() { notifications.push({ success: true }); }
    }
  };
  const document = {
    body: node(), documentElement: node(), addEventListener() {}, removeEventListener() {}, dispatchEvent() {},
    querySelector: () => null, querySelectorAll: () => [],
    getElementById(id) { if (!nodes.has(id)) nodes.set(id, node()); return nodes.get(id); },
    createElement: node,
    head: { appendChild(script) {
      activeScripts.add(script);
      script.parentNode = { removeChild() { activeScripts.delete(script); script.parentNode = null; } };
      requests.push({ script, params: new URL(script.src).searchParams });
    } }
  };
  const c = vm.createContext({ window, document, navigator: { onLine: true }, console: { log() {}, warn() {} },
    URLSearchParams, CustomEvent: function(type, detail) { this.type = type; this.detail = detail; },
    btoa: text => Buffer.from(text, 'binary').toString('base64'), setTimeout: window.setTimeout, clearTimeout: window.clearTimeout });
  // Expose state setup only in the test VM; requests use the complete generated shim.
  vm.runInContext(shim.replace(/\}\)\(\);\s*$/, `
    window.seriesFixture = {
      activate: activateLocalIndex_, setFreshness: value => { localIndexFreshnessState = value; },
      search: searchLocalSimple_
    };
  })();`), c);
  c.google = window.google;
  ['state', 'images', 'search', 'render', 'shelf', 'modal'].forEach(name => vm.runInContext(read('script.' + name + '.js.html')
    .replace(/^\s*<script>\s*/, '').replace(/\s*<\/script>\s*$/, ''), c));
  ['prioritizeBookDetailPrefetch_', 'clearPopupTouchHandlers_', 'focusPopupIfNeeded_',
    'setShelfPopupPerformanceMode_', 'resumeBookDetailPrefetchQueue_'].forEach(name => { c[name] = () => {}; });
  c.escapeHtml = value => String(value || '').replace(/</g, '&lt;');
  const eval_ = expression => vm.runInContext(expression, c);
  c.syncBookDetailCacheRevision_('revision-one');
  function advance(ms) {
    const target = now + ms;
    for (;;) {
      const next = Array.from(timers.entries()).filter(([, timer]) => timer.due <= target)
        .sort((a, b) => a[1].due - b[1].due || a[0] - b[0])[0];
      if (!next) break;
      now = next[1].due; timers.delete(next[0]); next[1].fn();
    }
    now = target;
  }
  function reply(request, data, error) {
    const callback = request.params.get('callback').split('.').reduce((value, key) => value[key], window);
    callback(error ? { ok: false, error: { code: 'TEST_FAILURE', message: error } } : { ok: true, data });
  }
  function call(key = seriesFixtures[0][0], count = 4) {
    const outcomes = [];
    c.fetchSeriesBooks_(key, count, books => outcomes.push({ books: plain(books) }), error => outcomes.push({ code: error.code }));
    return outcomes;
  }
  return { c, window, document, nodes, timers, requests, activeScripts, eval_, advance, reply, call, perf, notifications,
    activate(data = payload(), fresh = true) { window.seriesFixture.activate(data, fresh); } };
}
const booksFor = (h, key = seriesFixtures[0][0]) => plain(h.window.ShumiLibraryLocalIndex.getCompleteSeriesBooks(key, 'revision-one'));

// Local title/contributor-filtered matches still open all owned books in catalog order.
for (const [key, , titles] of seriesFixtures) {
  const h = harness(); h.activate();
  const titleMatches = h.window.seriesFixture.search(titles[2]);
  const authorMatches = h.window.seriesFixture.search('訳者A').filter(book => book.seriesKeyAuto === key);
  assert.equal(titleMatches.length, 1); assert.equal(authorMatches.length, 1);
  for (const matched of [titleMatches, authorMatches]) {
    const group = h.c.buildSearchResultPresentation_(matched).entries[0];
    assert.equal(group.matchCount, 1); assert.equal(group.ownedCount, 4);
    const result = h.call(group.key, group.ownedCount); h.advance(0);
    assert.equal(result.length, 1); assert.equal(result[0].books.length, 4);
    assert.equal(h.requests.length, 0, 'complete latest local series skips network');
    const sorted = plain(h.c.sortSeriesBooksForDisplay_(result[0].books));
    assert.deepEqual(sorted.map(book => book.title), [titles[3], titles[2], titles[1], titles[0]], 'UUID metadata preserves negative, zero, fractional and missing manual orders');
    assert(result[0].books.every(book => book.detailLoaded === false && !('summary' in book) && !('price' in book) && !('memo' in book)), 'local list continues the existing lazy detail path');
    assert(result[0].books.some(book => book.contributors.includes('訳者A')), 'pipe contributor metadata remains split');
    result[0].books[0].title = 'Caller edit';
  }
  assert.equal(booksFor(h, key)[0].title, titles[0], 'caller mutations never corrupt the index/cache');
}

const fallbackCases = [
  ['unready', h => {}],
  ['loaded but unchecked', h => h.activate(payload(), false)],
  ['checking', h => { h.activate(); h.window.seriesFixture.setFreshness('checking'); }],
  ['failed freshness', h => { h.activate(); h.window.seriesFixture.setFreshness('failed'); }],
  ['stale revision', h => { const p = payload(); p.revision = 'old'; h.activate(p); }],
  ['truncated series', h => { const p = payload(); p.records.splice(0, 1); h.activate(p); }],
  ['conflicting counts', h => { const p = payload(); p.records[0][13] = 3; h.activate(p); }],
  ['duplicate UUID', h => { const p = payload(); p.records[1][1] = p.records[0][1]; h.activate(p); }],
  ['duplicate row', h => { const p = payload(); p.records[1][0] = p.records[0][0]; h.activate(p); }],
  ['missing title', h => { const p = payload(); p.records[0][2] = ''; h.activate(p); }]
];
for (const [name, setup] of fallbackCases) {
  const h = harness(); setup(h); h.call();
  assert.equal(h.requests.length, 1, name + ' uses remote rather than partial/stale local results');
  assert.equal(h.requests[0].params.get('api'), 'series');
}
{
  const h = harness(); h.activate(); h.call(seriesFixtures[0][0], 5);
  assert.equal(h.requests.length, 1, 'search count inconsistent with local metadata falls back');
  const old = payload(); old.version = 6;
  assert.throws(() => h.activate(old), /形式が未対応/);
}

// A locally cached list cannot bypass a later failed/checking freshness state.
for (const state of ['checking', 'failed', 'offline']) {
  const h = harness(); h.activate(); h.call(); h.advance(0);
  h.window.seriesFixture.setFreshness(state); h.call();
  assert.equal(h.requests.length, 1, 'local cache rechecks ' + state + ' freshness');
}

// Shared remote requests survive rebuilt groups, while failures/incomplete data retry.
{
  const h = harness(); h.activate(); const books = booksFor(h); h.window.seriesFixture.setFreshness('failed');
  const first = h.call(), second = h.call();
  assert.equal(h.requests.length, 1, 'same revision/key joins in-flight request');
  h.reply(h.requests[0], null, '通信の検証エラー');
  assert.deepEqual(first, [{ code: 'API_ERROR' }]); assert.deepEqual(second, first);
  const partial = h.call(); h.reply(h.requests[1], books.slice(0, 1));
  assert.deepEqual(partial, [{ code: 'SERIES_BOOKS_INCOMPLETE' }]);
  const retry = h.call(); h.reply(h.requests[2], books);
  assert.equal(retry[0].books.length, 4);
  const rebuilt = h.call(); assert.equal(rebuilt[0].books.length, 4);
  assert.equal(h.requests.length, 3, 'failed calls are retryable and successful remote cache is shared');
  assert.equal(h.notifications.length, 0, 'transport/cache cannot change banners without an active panel');
  assert.equal(h.activeScripts.size, 0); assert.equal(Object.keys(h.window.__shumiLibraryJsonpCallbacks_).length, 0);
}

// Revision changes cancel every waiter/transport; late old replies cannot fill a new cache.
{
  const h = harness(); h.activate(); const books = booksFor(h); h.window.seriesFixture.setFreshness('failed');
  const first = h.call(), second = h.call(); const oldRequest = h.requests[0];
  h.c.syncBookDetailCacheRevision_('revision-two');
  assert.deepEqual(first, [{ code: 'SERIES_BOOKS_STALE' }]); assert.deepEqual(second, first);
  assert.equal(h.activeScripts.size, 0); assert.equal(h.timers.size, 0);
  const next = h.call(); h.reply(oldRequest, books); h.reply(oldRequest, null, 'late error');
  assert.equal(next.length, 0);
  h.reply(h.requests[1], books.map(book => ({ ...book, seriesOrder: 99 })));
  assert(next[0].books.every(book => book.seriesOrder === 99));
  const cached = h.call(); assert(cached[0].books.every(book => book.seriesOrder === 99));
  assert.equal(h.requests.length, 2); assert(h.perf.every(token => token.ended), 'cancelled timing tokens finish');
}

// One 25-second series deadline settles exactly once and frees scripts, timers, registry.
{
  const h = harness(); const result = h.call(); const request = h.requests[0], lateError = request.script.onerror;
  assert.deepEqual(Array.from(h.timers.values()).map(timer => timer.ms), [25000]);
  h.advance(24999); assert.equal(result.length, 0);
  h.advance(1); assert.deepEqual(result, [{ code: 'TIMEOUT' }]);
  assert.equal(h.activeScripts.size, 0); assert.equal(h.timers.size, 0);
  assert.equal(Object.keys(h.window.__shumiLibraryJsonpCallbacks_).length, 0);
  h.reply(request, []); lateError(); h.advance(60000);
  assert.equal(result.length, 1, 'late JSONP success/error is harmless and never re-settles');
  assert.equal(h.notifications.length, 0, 'background timeout/late response cannot change a banner');
  h.call(); assert.equal(h.requests.length, 2, 'timeout permits a real retry');
}

// Counts from an old open panel cannot reject a complete smaller new revision.
for (const entry of ['search', 'detail']) {
  const h = harness(); h.activate(); const books = booksFor(h); h.window.seriesFixture.setFreshness('failed');
  const rendered = [];
  h.c.renderSearchResultSeriesPanel_ = (_, result) => rendered.push(plain(result));
  h.c.showSeriesPanel = (_, result) => rendered.push(plain(result));
  const source = books[0];
  const group = { key: source.seriesKeyAuto, books: [source], ownedCount: 4, seriesCountRevision: 'revision-one' };
  if (entry === 'search') h.c.showSearchResultSeriesPanel_(group); else h.c.openSeriesPanel(source);
  const newer = payload(); newer.revision = 'revision-two'; newer.records.splice(0, 1);
  newer.records.forEach(record => { if (record[12] === source.seriesKeyAuto) record[13] = 3; });
  h.activate(newer); h.c.syncBookDetailCacheRevision_('revision-two'); h.advance(0);
  assert.equal(rendered.length, 1); assert.equal(rendered[0].length, 3, entry + ' accepts authoritative smaller series after deletion');
  assert.equal(h.requests.length, 1, 'new complete revision remains local');
  h.reply(h.requests[0], books); assert.equal(rendered.length, 1, 'late larger old revision remains ignored');
}

// Freshness can change between local scheduling and execution; its fallback is cancellable.
{
  const h = harness(); h.activate(); const result = h.call();
  h.window.seriesFixture.setFreshness('failed'); h.advance(0);
  assert.equal(h.requests.length, 1, 'queued local query rechecks freshness and falls back');
  h.c.syncBookDetailCacheRevision_('revision-two');
  assert.deepEqual(result, [{ code: 'SERIES_BOOKS_STALE' }]);
  assert.equal(h.activeScripts.size, 0); assert.equal(h.timers.size, 0);
  assert(h.perf.every(token => token.ended), 'local/fallback cancellation ends every performance token');
}

// A result created before the edit carries its old count revision even on its first open.
for (const entry of ['search', 'detail']) {
  const h = harness(); h.activate(); const books = booksFor(h);
  const oldGroup = h.c.buildSearchResultPresentation_([books[0]]).entries[0];
  const newer = payload(); newer.revision = 'revision-two'; newer.records.splice(0, 1);
  newer.records.forEach(record => { if (record[12] === books[0].seriesKeyAuto) record[13] = 3; });
  h.activate(newer); h.c.syncBookDetailCacheRevision_('revision-two');
  const rendered = [];
  h.c.renderSearchResultSeriesPanel_ = (_, result) => rendered.push(plain(result));
  h.c.showSeriesPanel = (_, result) => rendered.push(plain(result));
  if (entry === 'search') h.c.showSearchResultSeriesPanel_(oldGroup); else h.c.openSeriesPanel(books[0]);
  h.advance(0);
  assert.equal(rendered.length, 1); assert.equal(rendered[0].length, 3, entry + ' first-open-after-edit accepts complete new count');
  assert.equal(h.requests.length, 0);
}

// Close, reopen and switch use the modal generation even though request/cache are shared.
for (const entry of ['search', 'detail']) {
  const h = harness(); h.activate(); const a = booksFor(h), b = booksFor(h, seriesFixtures[1][0]);
  h.window.seriesFixture.setFreshness('failed');
  const rendered = [];
  h.c.renderSearchResultSeriesPanel_ = (_, books) => rendered.push(plain(books));
  h.c.showSeriesPanel = (_, books) => rendered.push(plain(books));
  const group = books => ({ key: books[0].seriesKeyAuto, title: books[0].seriesSearchTitle, books: [books[0]], ownedCount: 4 });
  const open = books => entry === 'search' ? h.c.showSearchResultSeriesPanel_(group(books)) : h.c.openSeriesPanel(books[0]);
  open(a); h.c.setPopupModalOpen_(false); h.reply(h.requests[0], a);
  assert.equal(rendered.length, 0, entry + ' response cannot reopen closed modal');
  assert.equal(h.notifications.length, 0, 'closed-panel response cannot update banners');
  open(a); assert.equal(rendered.length, 1); assert.equal(h.requests.length, 1, 'reopen uses completed cache');
  h.c.invalidateSeriesBooksRequests_(); open(a); open(b);
  h.reply(h.requests[1], a); assert.equal(rendered.length, 1, 'previous series never replaces switched modal');
  h.reply(h.requests[2], b); assert.equal(rendered.length, 2); assert.equal(rendered[1][0].seriesKeyAuto, b[0].seriesKeyAuto);
  h.c.invalidateSeriesBooksRequests_(); open(a); open(a);
  assert.equal(h.requests.length, 4, 'rapid opens share one request');
  h.reply(h.requests[3], a); assert.equal(rendered.length, 3, 'only latest generation renders shared result');
  h.c.invalidateSeriesBooksRequests_(); open(a); h.advance(25000);
  const html = h.nodes.get('image-popup-info').innerHTML;
  assert(html.includes('タイムアウト') && html.includes('series-panel-retry'), entry + ' shows concrete timeout with retry');
  const bannerCount = h.notifications.filter(item => item.code === 'TIMEOUT').length;
  assert.equal(bannerCount, 1, entry + ' timeout banner fires exactly once');
  h.reply(h.requests.at(-1), a);
  assert.equal(h.notifications.filter(item => item.code === 'TIMEOUT').length, bannerCount, 'late timeout response cannot repeat/clear the error');
}

// A previous series success/failure never changes the active different series banner.
for (const previousFails of [true, false]) {
  const h = harness(); h.activate(); const a = booksFor(h), b = booksFor(h, seriesFixtures[1][0]);
  h.window.seriesFixture.setFreshness('failed');
  h.c.renderSearchResultSeriesPanel_ = () => {};
  const group = books => ({ key: books[0].seriesKeyAuto, books: [books[0]], ownedCount: 4 });
  h.c.showSearchResultSeriesPanel_(group(a)); h.c.showSearchResultSeriesPanel_(group(b));
  h.reply(h.requests[1], null, 'current failure');
  assert.deepEqual(h.notifications, [{ code: 'API_ERROR' }]);
  h.reply(h.requests[0], a, previousFails ? 'previous failure' : null);
  assert.deepEqual(h.notifications, [{ code: 'API_ERROR' }], 'previous response preserves current failure banner');
  h.nodes.get('series-panel-retry').onclick(); h.reply(h.requests[2], b);
  assert.deepEqual(h.notifications, [{ code: 'API_ERROR' }, { success: true }], 'active retry clears banner exactly once');
}

// Native GAS has the same deadline/error and late-response guard, without the shim.
{
  const h = harness(); h.window.ShumiLibrarySeriesApi = null;
  let success;
  const runner = { withSuccessHandler(fn) { success = fn; return runner; }, withFailureHandler() { return runner; }, getBooksBySeriesKey() {} };
  h.c.google = { script: { run: runner } };
  const result = h.call(); h.advance(25000);
  assert.deepEqual(result, [{ code: 'TIMEOUT' }]); success([]); assert.equal(result.length, 1);
  assert.equal(h.timers.size, 0);
}

console.log('series loading checks ok: local completeness/freshness, filtered full series, synthetic 戯言/ハリー/小市民 orders, shared retry/cache, revisions, modal generations, JSONP cleanup and native timeout');
