const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function fixture() {
  const frames = [];
  const events = new Map();
  const elements = new Map();
  const scrolls = [];
  const timers = new Map();
  let nextTimer = 0;
  let strips = [];
  const context = vm.createContext({
    console: { error() {} },
    navigator: { onLine: true },
    document: {
      addEventListener(type, listener) { events.set(type, listener); },
      getElementById(id) { return elements.get(id) || null; },
      querySelector(selector) {
        return selector === '.bookshelf-group.is-active' ? elements.get('shelf-active') : null;
      },
      querySelectorAll(selector) { return selector === '#result .bookshelf-strip' ? strips : []; },
      createElement() { return { setAttribute() {} }; },
      body: { classList: { contains: () => false } },
      documentElement: { scrollHeight: 1900 }
    },
    window: {
      innerHeight: 400,
      addEventListener() {},
      requestAnimationFrame(callback) { frames.push(callback); },
      setTimeout(callback, delay) {
        timers.set(++nextTimer, { callback, delay });
        return nextTimer;
      },
      clearTimeout(id) { timers.delete(id); },
      scrollTo(options) { scrolls.push(options.top); }
    },
    alert(message) { throw new Error(message); }
  });
  const run = source => vm.runInContext(source, context);
  for (const name of ['script.state.js.html', 'script.search.js.html', 'script.shelf.js.html', 'script.modal.js.html']) {
    const html = fs.readFileSync(path.join(__dirname, '..', name), 'utf8');
    run(html.replace(/^\s*<script>\s*/, '').replace(/\s*<\/script>\s*$/, ''));
  }
  Object.assign(context, {
    pwaSearchPerf_() {},
    pwaPerfStart_() {},
    pwaPerfEnd_() {},
    cancelPreviewCountRequest_() {},
    cancelShelfJump_() { run('shelfJumpGeneration += 1'); },
    setRandomRerollLoading_() {},
    syncSearchInputClearButtons_() {},
    closeAdvancedSearchPanel_() {},
    updateViewToggleButtons_() {},
    showSpinner() {},
    showSearchStatusResult_() {}
  });
  return {
    context, run, events, elements, scrolls,
    setStrips(value) { strips = value; },
    nextFrame() { frames.shift()?.(); },
    flushFrames() { while (frames.length) frames.shift()(); },
    runTimedWait() {
      const [id, timer] = timers.entries().next().value;
      timers.delete(id);
      timer.callback();
      return timer.delay;
    }
  };
}

{
  const { context, run, elements } = fixture();
  const classes = new Set(['result-fade']);
  const result = {
    classList: { add: name => classes.add(name), remove: name => classes.delete(name) },
    appendChild() {}
  };
  elements.set('result', result);
  let initialCards = false;
  let ready = false;
  Object.assign(context, {
    hideSpinner() {},
    resetResultRenderQueue_() {},
    syncSearchResultBookDetailPrefetch_() {},
    getCurrentViewMode_: () => 'card',
    syncSearchResultPresentationStats_() {},
    syncShelfViewUiState_() {},
    resetBookDetailPrefetchObserver_() {},
    resetImageLoadStats_() {},
    unmountShelfRoomMapPortal_() {},
    buildSearchResultPresentation_: books => ({ entries: books.map(book => ({ kind: 'book', book })) }),
    scheduleIncrementalResultRender_() { initialCards = true; },
    setTimeout() { assert.fail('search result reveal must not schedule a timer'); },
    pwaSearchPerf_(event) {
      if (event !== 'renderSearch') return;
      assert(initialCards && classes.has('show') && !classes.has('result-fade'));
      ready = true;
    }
  });
  run("lastResultKind = 'search'");
  context.showResult([{ title: 'Matching book' }], { id: 'search' });
  assert(ready, 'first cards can be displayed as soon as they are mounted');
}

{
  const { context, run } = fixture();
  context.hasDisplayValue_ = value => Boolean(String(value || '').trim());
  run(`
    ADVANCED_OPTIONS = { storyGenres: ['冒険'], themeGenres: ['魔法', '18禁'], mediaGenres: ['小説', '漫画'] };
    QUICK_BROWSE_COUNTS = { story: { '冒険': 5 }, theme: { '魔法': 3, '18禁': 4 }, media: { '小説': 2 }, mood: {}, status: {} };
    PREVIEW_INDEX = [{ genres: { media: ['漫画'], theme: ['学園'] } }];
    PREVIEW_INDEX.forEach = () => { throw Error('counts already belong to this snapshot'); };
  `);
  assert.deepEqual(Object.fromEntries(context.buildQuickBrowseItems_().map(item => [item.value, item.count])),
    { 冒険: 5, 魔法: 3, 小説: 2 });
  const candidates = context.getQuickBrowseCandidates_();
  context.buildQuickBrowseItems_();
  assert.equal(context.getQuickBrowseCandidates_(), candidates, 'shuffling reuses the candidates');

  run(`
    QUICK_BROWSE_COUNTS = null;
    let browseScans = 0;
    PREVIEW_INDEX = [
      { genres: { media: ['漫画'], theme: ['魔法', '魔法'] } },
      { genres: { media: ['漫画'], theme: ['魔法', '18禁'] } },
      { isSensitive: true, genres: { media: ['漫画'] } }
    ];
    PREVIEW_INDEX.forEach = function(callback) { browseScans++; Array.prototype.forEach.call(this, callback); };
  `);
  assert.deepEqual(Object.fromEntries(context.buildQuickBrowseItems_().map(item => [item.value, item.count])),
    { 魔法: 1, 漫画: 1 });
  assert.equal(run('browseScans'), 1);
  context.buildQuickBrowseItems_();
  assert.equal(run('browseScans'), 1, 'legacy metadata is counted once per snapshot');

  let revision = 'r1';
  let metadata = { advancedOptions: { mediaGenres: ['漫画'] }, quickBrowseCounts: { media: { 漫画: 7 } } };
  let previewReads = 0;
  context.window.ShumiLibraryLocalIndex = {
    isReady: () => true,
    getRevision: () => revision,
    getMetadata: () => metadata,
    getPreviewIndex() { previewReads++; return []; }
  };
  Object.assign(context, {
    requestBookDetailCacheRevisionSync_() {},
    populateAdvancedOptions() {},
    renderQuickBrowseRail_() {},
    syncSearchStatusPreviewFromForm_() {}
  });
  context.syncSearchDataFromLocalIndex_();
  context.syncSearchDataFromLocalIndex_();
  assert.equal(previewReads, 1, 'a repeated ready event does not clone the preview array');
  assert.equal(context.buildQuickBrowseItems_()[0].count, 7);
  revision = 'r2';
  metadata = { advancedOptions: { mediaGenres: ['漫画'] }, quickBrowseCounts: { media: { 漫画: 9 } } };
  context.syncSearchDataFromLocalIndex_();
  assert.equal(previewReads, 2);
  assert.equal(context.buildQuickBrowseItems_()[0].count, 9);
}

{
  const { context, run, events, elements, setStrips, flushFrames, nextFrame, scrolls } = fixture();
  const button = {
    hidden: true,
    querySelector: () => null,
    addEventListener(_, listener) { this.click = listener; },
    focus() { this.focused = true; },
    scrollIntoView() { this.visibleInViewport = true; }
  };
  elements.set('backToDiscoverySourceBtn', button);
  events.get('DOMContentLoaded')();
  elements.set('keyword', { value: '元の条件' });
  elements.set('detailAuthor', { value: '' });
  elements.set('searchContainer', { classList: { add() {}, remove() {} } });
  elements.set('viewToggle', { style: { display: 'flex' } });
  elements.set('shelf-active', { id: 'shelf-active' });
  const summary = { open: false };
  const bibliography = { open: true };
  const similarDisclosure = { open: true };
  const similarMethod = { open: true };
  const similarBack = {};
  const popupElements = new Map([
    ['.popup-summary', summary],
    ['.popup-book-bibliography', bibliography],
    ['.popup-discovery', similarDisclosure],
    ['.popup-discovery-method', similarMethod],
    ['.popup-discovery-back', similarBack]
  ]);
  elements.set('image-popup-info', {
    querySelector: selector => popupElements.get(selector) || null
  });
  const originalStrip = { scrollLeft: 240 };
  const newOpener = { dataset: { shelfBookIndex: '4' } };
  const mounted = [];
  const replacementStrip = { scrollLeft: 0, querySelectorAll: () => mounted };
  context.mountRestoredRow = () => {
    assert.equal(replacementStrip.scrollLeft, 240);
    assert.equal(scrolls.at(-1), 670);
    mounted.push(newOpener);
  };
  run('refreshShelfWindow_ = mountRestoredRow');
  setStrips([originalStrip]);
  context.firstOpener = { dataset: { shelfBookIndex: '4' }, closest: () => originalStrip };
  run(`
    currentViewMode = 'shelf';
    isShelfImmersiveMode = true;
    lastResultKind = 'shelf';
    lastResult = [{ title: '出発点' }];
    popupData = [{ title: '似てる本 B' }];
    popupSeriesContext = { kind: 'search-result' };
    popupReturnScrollY = 670;
    popupFocusReturn_ = firstOpener;
    popupSimilarSession_ = { states: new Map(), trail: [{
      title: '出発点', data: lastResult, index: 0, childData: popupData, scroll: [13]
    }] };
    getSimilarBooksState_(popupData[0]).open = true;
  `);
  const priorSession = run('popupSimilarSession_');
  const priorBook = run('popupData[0]');
  const reopened = [];
  const popupScrolls = [];
  let popupOpen = true;
  let onSuccess;
  const api = {
    withSuccessHandler(handler) { onSuccess = handler; return this; },
    withFailureHandler() { return this; },
    searchBooksAdvanced() {}
  };
  Object.assign(context, {
    google: { script: { run: api } },
    getCurrentViewMode_: () => run('currentViewMode'),
    isBookPopupOpen_: () => popupOpen,
    isSeriesPopupOpen_: () => false,
    closeActiveBookPopup_() {
      if (!popupOpen) return;
      popupOpen = false;
      run('popupFocusReturn_ = null; popupSimilarSession_ = null; popupSeriesRequestGeneration_ += 1');
    },
    similarPopupScroll_: () => [45],
    getAdvancedSearchParams_: () => ({ detailAuthor: elements.get('detailAuthor').value }),
    getSearchSpinnerOptions_: () => ({}),
    resetViewModeForNewResults_() { run("currentViewMode = 'card'; isShelfImmersiveMode = false"); },
    clearSearchFormValuesForBrowse_() { elements.get('keyword').value = ''; },
    syncSearchStatusPreviewFromForm_() {},
    hideAllSuggest() {},
    syncReleasedRangeOptions_() {},
    setAdvancedToggleButtonState_() {},
    syncExtraFilterLabel_() {},
    syncBookshelfCtaVisibility_() {},
    applyResultViewMode_(mode) { context.nextMode = mode; run('currentViewMode = nextMode;'); },
    renderSearchStatus_() {},
    syncActiveShelfNavigation_(id) { assert.equal(id, 'shelf-active'); },
    restoreSimilarPopupScroll_(positions) { popupScrolls.push(Array.from(positions)); },
    showResult() {
      setStrips([replacementStrip]);
      run('resultRenderRunId += 1');
    },
    renderSimilarBooks_() {},
    showPopup(book, index, data, seriesContext) {
      popupOpen = true;
      reopened.push({ book, index, data, context: seriesContext });
      assert.equal(run('popupSimilarSession_'), priorSession, 'restore the session before rendering');
      summary.open = true;
      bibliography.open = false;
      similarDisclosure.open = context.getSimilarBooksState_(book).open;
      similarMethod.open = false;
      context.bindSimilarBooks_(book);
    }
  });
  context.applyBookMetadataSearch_('detailAuthor', '別の著者');
  assert.equal(button.hidden, false);
  assert.equal(button.textContent, '元の棚に戻る');
  assert.equal(button.focused && button.visibleInViewport, true);
  assert.equal(elements.get('keyword').value, '');
  const source = run('discoverySource');
  button.click();
  onSuccess([{ title: '遅れて到着した探索結果' }]);
  flushFrames();
  assert.equal(button.hidden, true);
  assert.equal(elements.get('keyword').value, '元の条件');
  assert.equal(elements.get('detailAuthor').value, '');
  assert.equal(run('lastResult[0].title'), '出発点');
  assert.equal(run('lastResultKind'), 'shelf');
  assert.equal(run('isShelfImmersiveMode'), true);
  assert.equal(replacementStrip.scrollLeft, 240);
  assert.deepEqual(scrolls, [670]);
  assert.equal(reopened.length, 1, 'the shelf restores exactly once');
  assert.equal(reopened[0].book, priorBook);
  assert.equal(reopened[0].context.kind, 'search-result');
  assert.equal(summary.open, false);
  assert.equal(bibliography.open, true);
  assert.equal(similarDisclosure.open, true);
  assert.equal(similarMethod.open, true);
  assert.equal(run('popupFocusReturn_'), newOpener);
  similarBack.onclick();
  assert.equal(reopened[1].book.title, '出発点', 'the similar-book trail still leads from B back to A');
  assert.deepEqual(popupScrolls, [[45], [13]]);

  popupOpen = false;
  context.setDiscoverySource_(source);
  button.click();
  run('resultRenderRunId += 1');
  flushFrames();
  assert.equal(reopened.length, 2, 'an intervening view toggle cancels the restoration');
  assert.deepEqual(scrolls, [670]);

  context.setDiscoverySource_(source);
  button.click();
  nextFrame();
  const newerSession = { states: new Map(), trail: [] };
  context.newerSession = newerSession;
  run('popupSeriesRequestGeneration_ += 1; popupSimilarSession_ = newerSession');
  flushFrames();
  assert.equal(reopened.length, 2, 'a later book wins even if already closed before restoration');
  assert.equal(run('popupSimilarSession_'), newerSession);
}

{
  const { context, flushFrames } = fixture();
  const chunks = [];
  const shelfResults = {
    appendChild(child) { child.parentNode = this; },
    removeChild(child) { child.parentNode = null; }
  };
  context.window.IntersectionObserver = class {
    observe() {}
    disconnect() {}
  };
  const result = Array.from({ length: 140 });
  let restoreAt = 0;
  const scrolls = [];
  const source = {
    viewMode: 'list',
    scrollY: 3700,
    openerStripIndex: -1,
    resultOpenerIndex: -1,
    popup: { index: 0, data: [{ title: '深い位置の本' }], disclosures: [] }
  };
  let reopened;
  context.showPopup = book => { reopened = book; };
  context.window.scrollTo = ({ top }) => scrolls.push(Math.min(top, restoreAt * 50 - 400));
  context.scheduleIncrementalResultRender_(shelfResults, result, 'list',
    (start, end) => chunks.push([start, end]), {}, {
      minimumRendered: 83,
      isCurrent: () => true,
      onMinimumRendered() {
        restoreAt = chunks.at(-1)[1];
        context.restoreDiscoveryPosition_(source, () => true);
      }
    });
  assert.deepEqual(chunks, [[0, 12]], 'deep restoration keeps initial rendering bounded');
  assert.equal(restoreAt, 0);
  flushFrames();
  assert.deepEqual(chunks, [[0, 12], [12, 32], [32, 52], [52, 72], [72, 83]]);
  assert.equal(restoreAt, 83, 'restore only when all previously visited rows are materialized');
  assert.deepEqual(scrolls, [3700]);
  assert.equal(reopened, source.popup.data[0]);

  let stillCurrent = true;
  chunks.length = 0;
  context.scheduleIncrementalResultRender_(shelfResults, result, 'card',
    (start, end) => chunks.push([start, end]), {}, {
      minimumRendered: 40,
      isCurrent: () => stillCurrent,
      onMinimumRendered() { assert.fail('a superseded restoration reopened'); }
    });
  stillCurrent = false;
  flushFrames();
  assert.deepEqual(chunks, [[0, 12]], 'superseded restoration skips extra chunks');
}

{
  const { context, run } = fixture();
  let revision = 'r1';
  let freshness = 'fresh';
  let persistence = 'saved';
  const requests = [];
  const renders = [];
  let savedReads = 0;
  let savedWrites = 0;
  let success, failure;
  const fallback = [{ title: '以前の端末保存' }];
  const api = {
    withSuccessHandler(handler) { success = handler; return this; },
    withFailureHandler(handler) { failure = handler; return this; },
    getBookshelfBooks() { requests.push({ success, failure }); }
  };
  context.window.ShumiLibraryLocalIndex = {
    isReady: () => true,
    getFreshnessState: () => freshness,
    getRevision: () => revision,
    getPersistenceState: () => persistence
  };
  Object.assign(context, {
    google: { script: { run: api } },
    clearSearchFormValuesForBrowse_() {},
    readBookshelfCache_() { savedReads++; return { books: fallback }; },
    writeBookshelfCache_() { savedWrites++; },
    showResult(books) { renders.push(books); }
  });
  context.showAllBookshelf();
  const first = [{ title: '第1版', summary: '補完済みの詳細' }];
  requests[0].success(first, { source: 'local' });
  context.showAllBookshelf();
  assert.equal(requests.length, 1);
  assert.equal(renders.length, 1);
  assert.equal(run('lastResult'), first);
  assert.equal(savedReads, 0);
  assert.equal(savedWrites, 0);

  revision = 'r2';
  context.showAllBookshelf();
  revision = 'r3';
  requests[1].success([{ title: '途中で旧版になった応答' }], { source: 'local' });
  assert.equal(requests.length, 3);
  assert.equal(renders.length, 1, 'changed revision did not replace the shelf');
  persistence = 'failed';
  const current = [{ title: '第3版' }];
  requests[2].success(current, { source: 'local' });
  assert.equal(run('lastResult'), current);
  assert.equal(savedWrites, 1, 'keeps a legacy fallback if the index could not be persisted');
  context.navigator.onLine = false;
  freshness = 'offline';
  context.showAllBookshelf();
  assert.equal(requests.length, 3, 'offline startup can reuse the current in-memory snapshot');
  context.navigator.onLine = true;
  freshness = 'stale';
  context.showAllBookshelf();
  requests[3].failure(new Error('fixture network error'));
  assert.equal(savedReads, 1);
  assert.equal(run('lastResult'), fallback);
}

async function checkDelayedBookshelfLoad_() {
  const { context, run, runTimedWait } = fixture();
  context.navigator.onLine = false;
  let ready = false;
  let revision = 'r1';
  let activateIndex;
  let indexLoad;
  function prepareIndexLoad_() {
    ready = false;
    indexLoad = new Promise(resolve => { activateIndex = () => { ready = true; resolve(true); }; });
  }
  const requests = [];
  let success, failure;
  const api = {
    withSuccessHandler(handler) { success = handler; return this; },
    withFailureHandler(handler) { failure = handler; return this; },
    getBookshelfBooks() { requests.push({ success, failure, ready }); }
  };
  context.window.ShumiLibraryLocalIndex = {
    isReady: () => ready,
    getFreshnessState: () => 'offline',
    getRevision: () => revision,
    getPersistenceState: () => 'saved',
    whenLoaded: () => indexLoad
  };
  Object.assign(context, {
    google: { script: { run: api } },
    clearSearchFormValuesForBrowse_() {},
    readBookshelfCache_: () => null,
    showResult() {}
  });
  const flush = () => new Promise(resolve => setImmediate(resolve));

  prepareIndexLoad_();
  context.showAllBookshelf();
  await flush();
  assert.equal(requests.length, 0, 'no GAS attempt while the offline device opens IndexedDB');
  activateIndex();
  await flush();
  assert.equal(requests.length, 1);
  assert.equal(requests[0].ready, true);
  const first = [{ title: 'オフラインで読み込んだ本' }];
  requests[0].success(first, { source: 'local' });
  assert.equal(run('lastResult'), first);

  prepareIndexLoad_();
  context.showAllBookshelf();
  await flush();
  context.beginResultRequest_('search');
  activateIndex();
  await flush();
  assert.equal(requests.length, 1, 'superseded startup does not fetch the shelf');

  revision = 'r2';
  prepareIndexLoad_();
  context.showAllBookshelf();
  await flush();
  assert.equal(runTimedWait(), 1500, 'startup cannot wait indefinitely for IndexedDB');
  assert.equal(requests.length, 2);
  assert.equal(requests[1].ready, false);
  activateIndex();
  await flush();
  requests[1].failure(new Error('fixture network error'));
  assert.equal(requests.length, 3, 'failed request gives newly available local data one chance');
  assert.equal(requests[2].ready, true);
  const recovered = [{ title: '間に合った端末索引' }];
  requests[2].success(recovered, { source: 'local' });
  assert.equal(run('lastResult'), recovered);
}

checkDelayedBookshelfLoad_().then(() => {
  console.log('quick browse counts, discovery return, and bookshelf snapshot checks passed');
}).catch(error => {
  console.error(error);
  process.exitCode = 1;
});
