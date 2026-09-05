const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
const files = ['state', 'images', 'search', 'render', 'shelf', 'modal', 'boot'];

function client() {
  const timers = [];
  const requests = [];
  const rendered = [];
  const alerts = [];
  const nodes = new Map();
  const storage = new Map();
  const classes = () => ({ add() {}, remove() {}, contains() { return false; }, toggle() {} });
  const c = vm.createContext({
    console, URLSearchParams, setTimeout() {}, clearTimeout() {},
    document: {
      body: { classList: classes(), style: {} },
      documentElement: { classList: classes() },
      addEventListener() {}, querySelector() { return null; }, querySelectorAll() { return []; },
      getElementById(id) {
        if (!nodes.has(id)) nodes.set(id, { value: '', style: {}, classList: classes(), focus() {} });
        return nodes.get(id);
      }
    },
    window: {
      location: { search: '' }, addEventListener() {}, scrollTo() {},
      setTimeout(fn, ms) { timers.push({ fn, ms }); return timers.length; }, clearTimeout() {},
      requestAnimationFrame(fn) { timers.push({ fn, ms: 16 }); },
      localStorage: { getItem: k => storage.get(k) || null, setItem: (k, v) => storage.set(k, v) }
    },
    google: { script: { run: {} } }, alert: text => alerts.push(text)
  });
  files.forEach(name => vm.runInContext(fs.readFileSync(path.join(root, `script.${name}.js.html`), 'utf8')
    .replace(/^\s*<script>\s*/, '').replace(/\s*<\/script>\s*$/, ''), c));
  ['hideAllSuggest', 'resetViewModeForNewResults_', 'resetViewModeToCardForNewSearch_',
    'showSpinner', 'hideSpinner', 'showSearchStatusResult_', 'setRandomRerollLoading_',
    'closeAdvancedSearchPanel_', 'clearSearchFormValuesForBrowse_', 'updateViewToggleButtons_',
    'scrollToBookshelfTop_', 'writeBookshelfCache_', 'clearAdvancedFields',
    'syncSearchStatusPreviewFromForm_', 'syncQuickBrowseRailVisibility_', 'syncMobileAppDockState_',
    'syncShelfViewUiState_'].forEach(name => { c[name] = () => {}; });
  c.isAdvancedOpen = () => false;
  c.isBookPopupOpen_ = () => false;
  c.showResult = books => rendered.push(books.map(b => b.title));
  c.renderSeriesInventoryStatus_ = data => rendered.push([data.title]);
  c.readBookshelfCache_ = () => ({ books: [{ title: 'Cached shelf' }] });
  c.google.script.run = new Proxy({}, {
    get(target, key) {
      if (key === 'withSuccessHandler') return fn => { target.ok = fn; return c.google.script.run; };
      if (key === 'withFailureHandler') return fn => { target.fail = fn; return c.google.script.run; };
      return (...args) => requests.push({ method: key, args, ok: target.ok, fail: target.fail });
    }
  });
  const read = expression => vm.runInContext(expression, c);
  return { c, read, timers, requests, rendered, alerts, nodes, storage };
}

// Stable IDs must never fall back to a row occupied by another book.
{
  const { c } = client();
  c.window.ShumiLibraryLocalIndex = {
    getBookById: () => null,
    getBookByRowIndex() { throw new Error('A missing UUID must not use row identity'); }
  };
  const book = { bookId: 'deleted', rowIndex: 5, title: 'Deleted book' };
  c.hydratePopupBookFromLocalIndex_(book);
  assert.equal(book.author, undefined);
  c.window.ShumiLibraryLocalIndex.getBookById = () => ({ bookId: 'different', author: 'Wrong' });
  c.hydratePopupBookFromLocalIndex_(book);
  assert.equal(book.author, undefined);
  c.window.ShumiLibraryLocalIndex.getBookByRowIndex = () => ({ author: 'Legacy author' });
  const legacy = { rowIndex: 5 };
  c.hydratePopupBookFromLocalIndex_(legacy);
  assert.equal(legacy.author, 'Legacy author');
}

// Cancel every waiter, then reject late success/failure without touching a new request.
{
  const { c, requests } = client();
  const book = { bookId: 'one', title: 'Book', detailLoaded: false };
  let settled = 0;
  c.syncBookDetailCacheRevision_('old');
  c.fetchDeferredBookDetails_(book, 0, [book], null, { onDone() { settled++; } });
  c.fetchDeferredBookDetails_(book, 0, [book], null, { onDone() { settled++; } });
  assert.equal(requests.length, 1);
  c.syncBookDetailCacheRevision_('new');
  assert.equal(settled, 2);
  assert.equal(book.detailLoading, false);
  c.fetchDeferredBookDetails_(book, 0, [book], null, {});
  requests[0].ok({ bookId: 'one', summary: 'OLD' });
  requests[0].fail(new Error('Late failure'));
  assert.equal(book.detailLoading, true);
  assert.equal(c.getCachedBookDetail_(book), null);
  requests.at(-1).ok({ bookId: 'one', summary: 'NEW' });
  assert.equal(book.summary, 'NEW');
  assert.equal(book.detailLoading, false);
  assert.equal(c.getCachedBookDetail_(book).summary, 'NEW');
}

// Popup batches deduplicate forced requests and do not apply a previous revision.
{
  const { c, requests } = client();
  const books = [{ bookId: 'one', detailLoaded: false }, { bookId: 'two', detailLoaded: false }];
  c.syncBookDetailCacheRevision_('old');
  c.fetchPopupContextBookDetails_(books[0], 0, books, null, {});
  c.fetchPopupContextBookDetails_(books[0], 0, books, null, { forceCurrent: true });
  assert.equal(requests.length, 1);
  c.syncBookDetailCacheRevision_('new');
  assert(books.every(book => !book.detailLoading));
  requests[0].ok(books.map(book => ({ bookId: book.bookId, summary: 'OLD' })));
  assert(books.every(book => c.getCachedBookDetail_(book) === null));
  c.fetchPopupContextBookDetails_(books[0], 0, books, null, {});
  requests[1].ok(books.map(book => ({ bookId: book.bookId, summary: 'NEW' })));
  assert(books.every(book => book.summary === 'NEW' && !book.detailLoading));
}

// A response already queued for deferred rendering cannot clear a newer loading state.
{
  const { c, requests, timers } = client();
  const book = { bookId: 'one', detailLoaded: false };
  c.syncBookDetailCacheRevision_('old');
  c.fetchPopupContextBookDetails_(book, 0, [book], null, { mode: 'currentOnly', deferCurrentApplyMs: 300 });
  requests[0].ok([{ bookId: 'one', summary: 'OLD' }]);
  c.syncBookDetailCacheRevision_('new');
  c.fetchPopupContextBookDetails_(book, 0, [book], null, { mode: 'currentOnly', forceCurrent: true });
  timers.find(timer => timer.ms === 300).fn();
  assert.equal(book.detailLoading, true);
  assert.equal(book.summary, undefined);
  requests[1].ok([{ bookId: 'one', summary: 'NEW' }]);
  assert.equal(book.summary, 'NEW');
}

// Revision cancellation releases the background prefetch lane, even before network completion.
{
  const { c, read, requests, timers } = client();
  c.canRunBackgroundBookDetailPrefetch_ = () => true;
  const book = { bookId: 'one', detailLoaded: false };
  c.syncBookDetailCacheRevision_('old');
  c.fixtureBook = book;
  read('bookDetailPrefetchQueue = [fixtureBook]');
  c.processBookDetailPrefetchQueue_();
  assert.equal(read('bookDetailPrefetchActive'), 1);
  c.syncBookDetailCacheRevision_('new');
  timers.find(timer => timer.ms === 120).fn();
  assert.equal(read('bookDetailPrefetchActive'), 0);
  requests[0].ok([{ bookId: 'one', summary: 'OLD' }]);
  assert.equal(c.getCachedBookDetail_(book), null);
}

// Shelf cache can be shown immediately, but its refresh cannot replace a newer search.
{
  const { c, read, requests, rendered, alerts } = client();
  c.showAllBookshelf();
  c.document.getElementById('keyword').value = 'New search';
  c.search();
  requests[1].ok([{ title: 'New search' }]);
  requests[0].ok([{ title: 'Late shelf' }]);
  requests[0].fail(new Error('Late shelf failure'));
  assert.deepEqual(rendered, [['Cached shelf'], ['New search']]);
  assert.equal(read('lastResultKind'), 'search');
  assert.equal(alerts.length, 0);
}

// Background refresh saves new data without interrupting an open book or map.
for (const modalClass of ['modal-open', 'shelf-room-map-modal-open']) {
  const { c, requests, rendered } = client();
  let cached = null;
  c.writeBookshelfCache_ = payload => { cached = payload; };
  c.showAllBookshelf();
  c.document.body.classList.contains = name => name === modalClass;
  requests[0].ok([{ title: 'Refreshed shelf' }]);
  assert.deepEqual(rendered, [['Cached shelf']], 'background refresh must not close an open map/book');
  assert.equal(cached[0].title, 'Refreshed shelf');
}

// Simple/advanced/rerun/status requests all share the same result-screen lifecycle.
for (const start of ['simple', 'advanced', 'rerun', 'status']) {
  const { c, requests, rendered, alerts } = client();
  c.document.getElementById('keyword').value = 'First';
  if (start === 'advanced') {
    c.isAdvancedOpen = () => true;
    c.getAdvancedSearchParams_ = () => ({ detailAuthor: 'First' });
    c.search();
  } else if (start === 'rerun') c.rerunSearchWithParams_({ keyword: 'First' });
  else if (start === 'status') c.showSeriesInventoryStatus();
  else c.search();
  c.resetSearch();
  requests[0].ok([{ title: 'Late first' }]);
  requests[0].fail(new Error('Late first failure'));
  assert.deepEqual(rendered, [], start);
  assert.equal(alerts.length, 0, start);
  c.isAdvancedOpen = () => false;
  c.document.getElementById('keyword').value = 'Second';
  c.search();
  requests[1].ok([{ title: 'Second' }]);
  assert.deepEqual(rendered, [['Second']], start);
}

// Cancelling a random request permits a new draw; the old draw cannot unlock it.
{
  const { c, read, requests, rendered } = client();
  c.showRandomBooks();
  c.resetSearch();
  c.showRandomBooks();
  requests[0].ok([{ title: 'Old random' }]);
  assert.equal(read('isRandomBooksLoading'), true);
  requests[1].ok([{ title: 'New random' }]);
  assert.equal(read('isRandomBooksLoading'), false);
  assert.deepEqual(rendered, [['New random']]);
}
// A new shelf jump, navigation, or user scroll cancels old position corrections.
{
  const { c, timers, read } = client();
  const calls = { first: 0, second: 0 };
  const first = { isConnected: true, scrollIntoView() { calls.first++; } };
  const second = { isConnected: true, scrollIntoView() { calls.second++; } };
  const flushFrames = () => { while (timers.length) timers.shift().fn(); };
  c.scrollToShelfGroup_(first);
  c.scrollToShelfGroup_(second);
  flushFrames();
  assert.equal(calls.first, 1);
  assert(calls.second > 1);
  const beforeCancel = calls.second;
  c.scrollToShelfGroup_(second);
  c.cancelShelfJump_();
  flushFrames();
  assert.equal(calls.second, beforeCancel + 1);

  read('shelfRenderInProgress = true; bookshelfPendingRestoreScroll = true;');
  c.scrollToShelfGroup_(first);
  assert.equal(read('bookshelfPendingRestoreScroll'), false);
  flushFrames();
  const beforeFinish = calls.first;
  c.pwaPerfEnd_ = () => {};
  c.finishShelfRenderQueue_({ runId: read('shelfRenderRunId') });
  flushFrames();
  assert(calls.first > beforeFinish, 'finish rendering aligns an early jump once shelves have their final height');
  assert.equal(read('pendingShelfJump'), null);

  c.scrollToShelfGroup_(first);
  const beforeNavigation = calls.first;
  c.resetSearch();
  flushFrames();
  assert.equal(calls.first, beforeNavigation);
}
// Details remain available immediately while a burst produces only one disk write.
{
  const { c, read, storage } = client();
  c.syncBookDetailCacheRevision_('cache-burst');
  let writes = 0;
  c.window.localStorage.setItem = (key, value) => { writes++; storage.set(key, value); };
  for (let i = 0; i < 12; i++) {
    const book = { bookId: `burst-${i}` };
    c.rememberBookDetail_(book, { bookId: book.bookId, summary: `Summary ${i}` });
    assert.equal(c.getCachedBookDetail_(book).summary, `Summary ${i}`);
  }
  assert.equal(writes, 0, 'display and memory cache do not wait for persistent storage');
  c.flushPersistentBookDetailSave_();
  assert.equal(writes, 1, 'twelve details produce one serialization/write');
  assert.equal(Object.keys(JSON.parse(storage.get(read('BOOK_DETAIL_PERSISTENT_CACHE_KEY'))).items).length, 12);
  c.rememberBookDetail_({ bookId: 'obsolete' }, { bookId: 'obsolete', summary: 'Old revision' });
  c.syncBookDetailCacheRevision_('new-revision');
  c.flushPersistentBookDetailSave_();
  assert.equal(c.getCachedBookDetail_({ bookId: 'obsolete' }), null);
  assert.equal(Object.keys(JSON.parse(storage.get(read('BOOK_DETAIL_PERSISTENT_CACHE_KEY'))).items).length, 0);
  c.window.localStorage.setItem = () => { throw new Error('Quota exceeded'); };
  c.rememberBookDetail_({ bookId: 'memory-only' }, { bookId: 'memory-only', summary: 'Still readable' });
  c.flushPersistentBookDetailSave_();
  assert.equal(c.getCachedBookDetail_({ bookId: 'memory-only' }).summary, 'Still readable');
}

// A silent transport must release foreground and prefetch waiters, and reject late replies.
for (const batch of [false, true]) {
  const { c, read, requests, timers } = client();
  const book = { bookId: 'timeout', rowIndex: 2, detailLoaded: false };
  const load = () => batch
    ? c.fetchPopupContextBookDetails_(book, 0, [book], null, { mode: 'currentOnly' })
    : c.fetchDeferredBookDetails_(book, 0, [book], null, {});
  c.syncBookDetailCacheRevision_('timeouts');
  load();
  const firstRequest = requests[0];
  timers.find(t => t.ms === read('BOOK_DETAIL_REQUEST_TIMEOUT_MS')).fn();
  assert.equal(book.detailLoading, false);
  assert.match(book.detailError, /時間がかかっています/);
  assert.equal(read('bookDetailInFlightCallbacks.size'), 0);
  load();
  const detail = { bookId: 'timeout', rowIndex: 2, summary: 'Recovered' };
  firstRequest.ok(batch ? [detail] : detail);
  firstRequest.fail(new Error('Late failure'));
  assert.equal(requests.length, 2, 'expired request cannot start a legacy fallback');
  assert.equal(book.detailLoading, true, 'late reply cannot settle the retry');
  requests[1].ok(batch ? [detail] : detail);
  assert.equal(book.summary, 'Recovered');
  assert.equal(book.detailLoading, false);
  assert.equal(book.detailError, '');
}

// The currently open popup replaces its spinner and offers a working retry.
{
  const { c, read, requests, nodes } = client();
  const book = { bookId: 'visible', detailLoaded: false };
  c.visibleFixtureBook = book;
  read('popupData = [visibleFixtureBook]; popupIndex = 0;');
  c.isBookPopupOpen_ = () => true;
  const state = { outerHTML: '' };
  const retry = {};
  nodes.set('image-popup-info', { querySelector: selector => selector === '.popup-detail-loading' ? state : retry });
  c.handleDeferredBookDetailResult_(book, 0, [book], null, {}, null, new Error('Offline'));
  assert.match(state.outerHTML, /もう一度読み込む/);
  assert(!state.outerHTML.includes('skeleton'));
  retry.onclick({ preventDefault() {}, stopPropagation() {} });
  assert.match(state.outerHTML, /skeleton/);
  assert.equal(requests.length, 1);
  assert.equal(book.detailLoading, true);
  c.replaceDeferredBookReference_ = () => {};
  requests[0].ok([{ bookId: 'visible', summary: 'Back online' }]);
  assert.equal(book.summary, 'Back online');
  assert.equal(book.detailError, '');
}

// Identical shelf refreshes preserve the rendered shelf and do not write it again.
{
  const { c, requests, rendered } = client();
  const book = { bookId: 'shelf', title: 'Same shelf book', shelf: '7', location: '2' };
  let writes = 0;
  c.readBookshelfCache_ = () => ({ books: [book] });
  c.writeBookshelfCache_ = () => { writes++; };
  c.showAllBookshelf();
  requests[0].ok([{ ...book }]);
  assert.equal(rendered.length, 1);
  assert.equal(writes, 0);
  assert(!c.areBookshelfSnapshotsEqual_([book], [{ ...book, location: '3' }]));
  assert(!c.areBookshelfSnapshotsEqual_([book], [{ ...book, bookId: 'replacement' }]));
}

// Closing or replacing a series view invalidates its outstanding response.
{
  const { c, requests, rendered } = client();
  c.showSeriesPanel = (book, books) => rendered.push(books.map(b => b.title));
  c.clearPopupTouchHandlers_ = () => {};
  const book = { title: 'Series', seriesKeyAuto: 'series' };
  c.openSeriesPanel(book);
  c.setPopupModalOpen_(false);
  requests[0].ok([{ title: 'Closed response' }]);
  assert.equal(rendered.length, 0);
  c.openSeriesPanel(book);
  c.openSeriesPanel(book);
  requests[1].ok([{ title: 'Replaced response' }]);
  requests[2].ok([{ title: 'Current response' }]);
  assert.equal(rendered.length, 1);
  assert.equal(rendered[0][0], 'Current response');
}

// A failed search is visibly distinct from an empty result and preserves the query for retry.
{
  const { c, requests } = client();
  c.document.getElementById('detailAuthor').value = 'Selected author';
  c.document.getElementById('detailMedia').value = '漫画';
  c.document.getElementById('keyword').value = 'New keyword';
  assert.equal(c.getEffectiveSearchParams_().detailAuthor, 'Selected author');
  c.search();
  assert.equal(requests[0].method, 'searchBooksAdvanced');
  assert.equal(requests[0].args[0], 'New keyword');
  assert.equal(requests[0].args[3], 'Selected author');
}

// A failed search is visibly distinct from an empty result and preserves the query for retry.
{
  const { c, requests, nodes } = client();
  const retryButton = {};
  c.renderSearchStatus_ = () => {};
  c.resetResultRenderQueue_ = () => {};
  const input = c.document.getElementById('keyword');
  input.value = 'Saved query';
  const result = c.document.getElementById('result');
  result.querySelector = () => retryButton;
  c.search();
  requests[0].fail(new Error('Simulated offline'));
  assert(result.innerHTML.includes('検索結果を取得できませんでした'));
  assert.equal(input.value, 'Saved query');
  retryButton.onclick();
  assert.equal(requests.length, 2);
  assert.equal(requests[1].args[0], 'Saved query');
}

console.log('client race, cache and detail recovery checks ok');
