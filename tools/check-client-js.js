const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const clientScriptFiles = [
  'script.state.js.html',
  'script.images.js.html',
  'script.search.js.html',
  'script.render.js.html',
  'script.shelf.js.html',
  'script.modal.js.html',
  'script.boot.js.html'
];
const indexPath = path.join(root, 'index.html');
const serverPath = path.join(root, 'Webアプリ.js');
const indexSource = fs.readFileSync(indexPath, 'utf8');
const serverSource = fs.readFileSync(serverPath, 'utf8');
const modernModalStyleSource = fs.readFileSync(path.join(root, 'style.modern-modal.css.html'), 'utf8');
const clientScriptSources = clientScriptFiles
  .map(fileName => fs
    .readFileSync(path.join(root, fileName), 'utf8')
    .replace(/^\s*<script>\s*/, '')
    .replace(/\s*<\/script>\s*$/, ''));
const searchScriptSource = clientScriptSources[clientScriptFiles.indexOf('script.search.js.html')];

clientScriptFiles.forEach((fileName, index) => {
  assert(
    !/`https?:\/\//.test(clientScriptSources[index]),
    `${fileName} avoids URL literals inside template strings because GAS HtmlService truncates them`
  );
});

function createStorage() {
  const values = new Map();
  return {
    getItem(key) {
      return values.has(key) ? values.get(key) : null;
    },
    setItem(key, value) {
      values.set(key, String(value));
    },
    removeItem(key) {
      values.delete(key);
    }
  };
}

const sandbox = {
  console,
  Math,
  Number,
  String,
  Boolean,
  Array,
  Object,
  JSON,
  RegExp,
  Date,
  URLSearchParams,
  setTimeout,
  clearTimeout,
  localStorage: createStorage(),
  document: {
    body: {
      classList: {
        add() {},
        remove() {},
        toggle() {},
        contains() {
          return false;
        }
      },
      appendChild() {}
    },
    getElementById() {
      return null;
    },
    querySelector() {
      return null;
    },
    querySelectorAll() {
      return [];
    },
    addEventListener() {}
  },
  window: {
    scrollY: 0,
    location: { search: '' },
    localStorage: null,
    addEventListener() {},
    setTimeout,
    clearTimeout
  },
  google: {
    script: {
      run: {}
    }
  }
};

sandbox.globalThis = sandbox;
sandbox.window.localStorage = sandbox.localStorage;
vm.createContext(sandbox);
clientScriptSources.forEach((source, index) => {
  vm.runInContext(source, sandbox, { filename: clientScriptFiles[index] });
});

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function assertEqual(actual, expected, message) {
  if (actual !== expected) {
    throw new Error(`${message}: expected ${expected}, got ${actual}`);
  }
}

assert(!/\son(?:click|change|input|submit|keydown)=/i.test(indexSource), 'index.html has no inline event handlers');
['search', 'focus-search', 'random', 'top', 'toggle-advanced', 'clear-conditions', 'reset-search'].forEach(action => {
  assert(indexSource.includes(`data-action="${action}"`), `index.html exposes data-action="${action}"`);
});
assert(
  indexSource.includes('data-action="top"') &&
    indexSource.includes('>トップページへ<') &&
    clientScriptSources[clientScriptFiles.indexOf('script.boot.js.html')].includes('function returnToTopPage_()') &&
    clientScriptSources[clientScriptFiles.indexOf('script.boot.js.html')].includes('resetSearch();') &&
    !indexSource.includes('data-action="bookshelf" aria-label="本棚を開く"'),
  'mobile dock replaces the shelf shortcut with a same-weight return-to-top-page action'
);
['card', 'list', 'shelf'].forEach(mode => {
  assert(indexSource.includes(`data-view-mode="${mode}"`), `mobile dock exposes data-view-mode="${mode}"`);
});
clientScriptFiles.forEach(fileName => {
  assert(indexSource.includes(`'${fileName}'`), `index.html includes ${fileName}`);
});
assert(serverSource.includes('WEB_APP_API_REGISTRY_'), 'Webアプリ.js has API registry');
assert(serverSource.includes('currentWebApp'), 'Webアプリ.js registry classifies current Web App API');
assert(serverSource.includes('compatibility'), 'Webアプリ.js registry classifies compatibility API');

const actionKeys = vm.runInContext('Object.keys(STATIC_ACTION_HANDLERS).sort().join(",")', sandbox);
assertEqual(
  actionKeys,
  'bookshelf,clear-conditions,focus-search,random,reset-search,search,toggle-advanced,top',
  'STATIC_ACTION_HANDLERS maps static data-actions'
);

assertEqual(sandbox.normalizeKana('ＡＢＣ カタカナ'), 'abcかたかな', 'normalizeKana normalizes width and kana');

{
  const revisionBook = { rowIndex: 12, isbn: '9780000000000', title: 'キャッシュ確認本' };
  const revisionDetail = { isbn: '9780000000000', title: 'キャッシュ確認本', summary: '新版' };
  sandbox.syncBookDetailCacheRevision_('revision-a');
  const revisionKey = sandbox.getBookDetailCacheKey_(revisionBook);
  assert(revisionKey.includes('revision:revision-a'), 'detail cache key includes the dataset revision');
  assert(revisionKey.includes('isbn:9780000000000'), 'detail cache key includes the ISBN');
  assert(revisionKey.includes(encodeURIComponent('キャッシュ確認本')), 'detail cache key includes the title');
  sandbox.rememberBookDetail_(revisionBook, revisionDetail);
  assert(sandbox.getCachedBookDetail_(revisionBook), 'detail cache returns an entry for the current dataset revision');
  sandbox.syncBookDetailCacheRevision_('revision-b');
  assertEqual(sandbox.getCachedBookDetail_(revisionBook), null, 'dataset revision change clears stale detail cache entries');
}

{
  const originalPopulateAdvancedOptions = sandbox.populateAdvancedOptions;
  const originalRenderQuickBrowseRail = sandbox.renderQuickBrowseRail_;
  const originalSyncSearchStatus = sandbox.syncSearchStatusPreviewFromForm_;
  const originalUpdateViewToggleButtons = sandbox.updateViewToggleButtons_;
  let populateCount = 0;
  let quickBrowseCount = 0;
  let searchStatusCount = 0;
  let viewToggleCount = 0;

  sandbox.populateAdvancedOptions = () => { populateCount++; };
  sandbox.renderQuickBrowseRail_ = () => { quickBrowseCount++; };
  sandbox.syncSearchStatusPreviewFromForm_ = () => { searchStatusCount++; };
  sandbox.updateViewToggleButtons_ = () => { viewToggleCount++; };

  sandbox.localStorage.removeItem('shumiLibrary.resultViewMode');
  vm.runInContext(`
    preferredResultViewMode = '';
    resultViewModeChangedLocally = false;
    currentViewMode = 'card';
    isCardView = true;
    lastResult = null;
  `, sandbox);
  sandbox.applyInitialSearchData_({
    suggest: { titles: ['初期化テスト'] },
    advancedOptions: { publishers: ['テスト出版社'] },
    previewIndex: [],
    userPreferences: { resultViewMode: 'list' }
  });

  assertEqual(vm.runInContext('currentViewMode', sandbox), 'list', 'initial data uses server view mode when storage is unset');
  assertEqual(vm.runInContext('isCardView', sandbox), false, 'initial data synchronizes card view state');
  assertEqual(populateCount, 1, 'initial data completes advanced-option initialization');
  assertEqual(quickBrowseCount, 1, 'initial data completes quick-browse initialization');
  assertEqual(searchStatusCount, 1, 'initial data completes search-status initialization');
  assertEqual(viewToggleCount, 1, 'initial data completes view-toggle initialization');

  sandbox.localStorage.setItem('shumiLibrary.resultViewMode', 'card');
  vm.runInContext(`
    preferredResultViewMode = '';
    resultViewModeChangedLocally = false;
  `, sandbox);
  sandbox.applyInitialSearchData_({ userPreferences: { resultViewMode: 'shelf' } });
  assertEqual(vm.runInContext('currentViewMode', sandbox), 'card', 'explicitly stored card mode takes priority over server preferences');

  sandbox.populateAdvancedOptions = originalPopulateAdvancedOptions;
  sandbox.renderQuickBrowseRail_ = originalRenderQuickBrowseRail;
  sandbox.syncSearchStatusPreviewFromForm_ = originalSyncSearchStatus;
  sandbox.updateViewToggleButtons_ = originalUpdateViewToggleButtons;
}

{
  const hostileSuggest = '<img src=x onerror="alert(1)">&"日本語';
  const expectedPlainText = '&lt;img src=x onerror=&quot;alert(1)&quot;&gt;&amp;&quot;日本語';
  const highlighted = sandbox.highlightMatch(hostileSuggest, 'img');

  assertEqual(sandbox.highlightMatch(hostileSuggest, ''), expectedPlainText, 'suggestion text escapes HTML without a query');
  assertEqual(sandbox.highlightMatch(hostileSuggest, '一致しない'), expectedPlainText, 'suggestion text escapes HTML without a match');
  assert(!highlighted.includes('<img'), 'suggestion text never emits an HTML image element');
  assert(!highlighted.includes('onerror="alert(1)"'), 'suggestion text never emits an event attribute');
  assert(highlighted.includes('&lt;'), 'suggestion text escapes angle brackets around a highlighted match');
  assert(highlighted.includes('<span class="highlight-match">img</span>'), 'suggestion text preserves safe match highlighting');
}

const mixedIndex = {
  title: sandbox.normalizeKana('葬送のフリーレン'),
  yomi: sandbox.normalizeKana('そうそうのふりーれん'),
  author: sandbox.normalizeKana('山田鐘人'),
  searchKey: sandbox.normalizeKana('葬送のフリーレン そうそうのふりーれん 山田鐘人'),
  publisher: '小学館',
  releasedYm: 202405,
  genres: {
    story: ['冒険'],
    theme: ['魔法'],
    mood: ['静か'],
    status: ['完結']
  }
};

assert(sandbox.keywordMixedMatch_('葬送', mixedIndex), 'keywordMixedMatch_ matches title text');
assert(sandbox.keywordMixedMatch_('そうそう', mixedIndex), 'keywordMixedMatch_ matches yomi text');

const criteria = sandbox.buildClientSearchCriteria_({
  keyword: 'フリーレン',
  detailPublisher: '小学館',
  detailStory: '冒険',
  detailTheme: '魔法',
  detailReleasedFromYear: '2024',
  detailReleasedFromMonth: '01',
  detailReleasedToYear: '2024',
  detailReleasedToMonth: '12'
});
assert(sandbox.matchesSearchCriteria_(mixedIndex, criteria), 'matchesSearchCriteria_ accepts matching criteria');

const missCriteria = sandbox.buildClientSearchCriteria_({
  keyword: 'フリーレン',
  detailPublisher: '講談社'
});
assert(!sandbox.matchesSearchCriteria_(mixedIndex, missCriteria), 'matchesSearchCriteria_ rejects nonmatching publisher');

vm.runInContext(`
PREVIEW_INDEX = [
  ${JSON.stringify(mixedIndex)},
  {
    title: normalizeKana('違う本'),
    yomi: normalizeKana('ちがうほん'),
    author: normalizeKana('別作者'),
    searchKey: normalizeKana('違う本 ちがうほん 別作者'),
    publisher: '講談社',
    releasedYm: 202301,
    genres: { story: ['日常'], theme: ['学園'], mood: ['明るい'], status: ['連載中'] }
  }
];
PREVIEW_INDEX_READY = true;
ADVANCED_OPTIONS = {
  publishers: ['小学館', '講談社'],
  storyGenres: ['冒険', '日常'],
  themeGenres: ['18禁', '魔法', '学園'],
  moodGenres: ['静か', '明るい'],
  statusGenres: ['完結', '連載中'],
  releaseYears: ['2023', '2024']
};
`, sandbox);

assertEqual(
  sandbox.countPreviewMatches_({ detailPublisher: '小学館', detailTheme: '魔法' }),
  1,
  'countPreviewMatches_ uses shared criteria'
);

const quickBrowseVariants = new Set();
for (let i = 0; i < 12; i++) {
  const items = sandbox.buildQuickBrowseItems_();
  assert(items.every(item => item.value !== '18禁'), 'quick browse excludes sensitive theme');
  quickBrowseVariants.add(items.map(item => `${item.config.field}:${item.value}`).join('|'));
}
assert(quickBrowseVariants.size >= 1, 'quick browse renders at least one valid variant');

assert(
  sandbox.buildPopupBookLeadHtml_({ author: '<著者>', publisher: '出版社' }).includes('&lt;著者&gt;'),
  'popup lead escapes author text'
);
assert(
  clientScriptSources[clientScriptFiles.indexOf('script.modal.js.html')].includes('function isBookPopupOpen_()') &&
    clientScriptSources[clientScriptFiles.indexOf('script.modal.js.html')].includes('if (isBookPopupOpen_() && Array.isArray(popupData)'),
  'deferred detail refresh only rerenders an open popup'
);
assert(
  clientScriptSources[clientScriptFiles.indexOf('script.state.js.html')].includes('bookDetailInFlightCallbacks') &&
    clientScriptSources[clientScriptFiles.indexOf('script.modal.js.html')].includes('settleBookDetailInFlight_') &&
    clientScriptSources[clientScriptFiles.indexOf('script.modal.js.html')].includes('bookDetailInFlightCallbacks.has(key)'),
  'deferred detail requests share in-flight row fetches'
);
assert(
  clientScriptSources[clientScriptFiles.indexOf('script.state.js.html')].includes('bookDetailPersistentCachePayload') &&
    clientScriptSources[clientScriptFiles.indexOf('script.modal.js.html')].includes('if (bookDetailPersistentCachePayload !== undefined)') &&
    clientScriptSources[clientScriptFiles.indexOf('script.modal.js.html')].includes('bookDetailPersistentCachePayload = payload'),
  'persistent detail cache is memoized for the current app session'
);
assert(
  !clientScriptSources[clientScriptFiles.indexOf('script.modal.js.html')].includes('shumi-library:book-opened'),
  'book popup omits removed recent-book event'
);
assert(
  clientScriptSources[clientScriptFiles.indexOf('script.boot.js.html')].includes("document.querySelectorAll('[data-view-mode]')") &&
    clientScriptSources[clientScriptFiles.indexOf('script.boot.js.html')].includes('setViewMode_(btn.dataset.viewMode') &&
    clientScriptSources[clientScriptFiles.indexOf('script.boot.js.html')].includes('mobile-dock-has-results') &&
    clientScriptSources[clientScriptFiles.indexOf('script.render.js.html')].includes("document.querySelectorAll('[data-view-mode]") &&
    clientScriptSources[clientScriptFiles.indexOf('script.render.js.html')].includes("btn.setAttribute('aria-pressed'"),
  'mobile dock view-mode controls are wired and synced'
);
assert(
  clientScriptSources[clientScriptFiles.indexOf('script.modal.js.html')].includes('function fetchPopupContextBookDetails_') &&
    clientScriptSources[clientScriptFiles.indexOf('script.modal.js.html')].includes('function collectPopupContextDetailTargets_') &&
    clientScriptSources[clientScriptFiles.indexOf('script.modal.js.html')].includes('function createPopupDeferredRenderBook_') &&
    clientScriptSources[clientScriptFiles.indexOf('script.modal.js.html')].includes('function schedulePopupCurrentDetailRender_') &&
    clientScriptSources[clientScriptFiles.indexOf('script.modal.js.html')].includes('function handlePopupContextBookDetailResult_') &&
    clientScriptSources[clientScriptFiles.indexOf('script.state.js.html')].includes('POPUP_CURRENT_DETAIL_RENDER_DELAY_MS') &&
    clientScriptSources[clientScriptFiles.indexOf('script.modal.js.html')].includes('getBookDetailsByRowIndexes(rowIndexes)') &&
    clientScriptSources[clientScriptFiles.indexOf('script.modal.js.html')].includes("mode: 'currentOnly'") &&
    clientScriptSources[clientScriptFiles.indexOf('script.modal.js.html')].includes('forceCurrent: Boolean(popupOptions.forceCurrentDetailFetch)') &&
    clientScriptSources[clientScriptFiles.indexOf('script.modal.js.html')].includes('deferCurrentApplyMs: deferCurrentDetailRender ? POPUP_CURRENT_DETAIL_RENDER_DELAY_MS : 0') &&
    clientScriptSources[clientScriptFiles.indexOf('script.modal.js.html')].includes('bookDetailInFlightCallbacks.delete(key)') &&
    clientScriptSources[clientScriptFiles.indexOf('script.modal.js.html')].includes('function schedulePopupNeighborBookDetails_') &&
    clientScriptSources[clientScriptFiles.indexOf('script.modal.js.html')].includes("mode: 'neighborsOnly'"),
  'book popup fetches current details immediately, can defer heavy detail rendering, and delays nearby detail prefetch'
);
assert(
    clientScriptSources[clientScriptFiles.indexOf('script.images.js.html')].includes('function prefetchPopupNeighborCoverImages_') &&
      clientScriptSources[clientScriptFiles.indexOf('script.images.js.html')].includes('function prefetchBookCoverImage_') &&
      clientScriptSources[clientScriptFiles.indexOf('script.modal.js.html')].includes('function schedulePopupNeighborCoverPrefetch_') &&
      clientScriptSources[clientScriptFiles.indexOf('script.state.js.html')].includes('POPUP_NEIGHBOR_IMAGE_DELAY_MS') &&
      clientScriptSources[clientScriptFiles.indexOf('script.state.js.html')].includes('popupImagePrefetchObjects'),
    'book popup preloads nearby cover images separately from detail prefetch'
  );
assert(
  clientScriptSources[clientScriptFiles.indexOf('script.modal.js.html')].includes('function setShelfPopupPerformanceMode_') &&
    clientScriptSources[clientScriptFiles.indexOf('script.modal.js.html')].includes('shelf-popup-open') &&
    clientScriptSources[clientScriptFiles.indexOf('script.modal.js.html')].includes('function canRunBackgroundBookDetailPrefetch_') &&
    clientScriptSources[clientScriptFiles.indexOf('script.search.js.html')].includes('setShelfPopupPerformanceMode_(false)'),
  'bookshelf popup hides heavy background painting and pauses generic prefetch work'
);
{
  const modalSource = clientScriptSources[clientScriptFiles.indexOf('script.modal.js.html')];
  const popupMoveStart = modalSource.indexOf('function popupMove(diff, options)');
  const popupMoveSource = popupMoveStart >= 0 ? modalSource.slice(popupMoveStart) : '';
  const renderNextIndex = popupMoveSource.indexOf('const renderNextPopup_ = function()');
  const showPopupIndex = popupMoveSource.indexOf('showPopup(popupData[popupIndex], popupIndex, popupData, popupSeriesContext');
  assert(
    popupMoveStart >= 0 &&
      modalSource.includes('function createPopupTransitionClone_') &&
      modalSource.includes('popup-transition-clone') &&
      modalSource.includes("popupContent.style.visibility = 'hidden';") &&
      modalSource.includes("popupContent.style.visibility = '';") &&
      popupMoveSource.includes('useTransitionClone') &&
      popupMoveSource.includes('renderNextPopup_();') &&
      !popupMoveSource.includes('window.requestAnimationFrame(renderNextPopup_)') &&
      renderNextIndex >= 0 &&
      showPopupIndex >= 0 &&
      renderNextIndex < showPopupIndex &&
      !popupMoveSource.includes('void popupContent.offsetWidth'),
    'popup navigation uses a transition clone and avoids forced reflow during swipe transition'
  );
  assert(
    popupMoveSource.includes('clearPopupNeighborDetailTimer_();') &&
      !popupMoveSource.includes('warmPopupNeighborDetails_(popupIndex, popupData);'),
    'popup navigation does not run nearby detail prefetch during swipe transition'
  );
}
assert(
  clientScriptSources[clientScriptFiles.indexOf('script.shelf.js.html')].includes("button.addEventListener('pointerup'") &&
    clientScriptSources[clientScriptFiles.indexOf('script.shelf.js.html')].includes('function openShelfBook_') &&
    clientScriptSources[clientScriptFiles.indexOf('script.shelf.js.html')].includes('showPopup(book, originalIndex, data)'),
  'bookshelf book tiles have resilient tap-to-open detail handling'
);
assert(
  clientScriptSources[clientScriptFiles.indexOf('script.state.js.html')].includes('SHELF_RENDER_INITIAL_BOOK_LIMIT') &&
    clientScriptSources[clientScriptFiles.indexOf('script.state.js.html')].includes('SHELF_RENDER_CHUNK_SIZE') &&
    clientScriptSources[clientScriptFiles.indexOf('script.state.js.html')].includes('const SHELF_RENDER_CHUNK_SIZE = 30') &&
    clientScriptSources[clientScriptFiles.indexOf('script.state.js.html')].includes('SHELF_RENDER_PAUSE_RETRY_MS') &&
    clientScriptSources[clientScriptFiles.indexOf('script.shelf.js.html')].includes('function scheduleShelfRenderQueue_') &&
    clientScriptSources[clientScriptFiles.indexOf('script.shelf.js.html')].includes('appendShelfBookItems_') &&
    clientScriptSources[clientScriptFiles.indexOf('script.shelf.js.html')].includes('function isShelfRenderPaused_') &&
    clientScriptSources[clientScriptFiles.indexOf('script.shelf.js.html')].includes('renderQueue.push'),
  'bookshelf view renders book tiles incrementally instead of blocking on every tile'
);
assert(
  clientScriptSources[clientScriptFiles.indexOf('script.state.js.html')].includes('RESULT_RENDER_INITIAL_BOOK_LIMIT') &&
    clientScriptSources[clientScriptFiles.indexOf('script.state.js.html')].includes('const RESULT_RENDER_INITIAL_BOOK_LIMIT = 12') &&
    clientScriptSources[clientScriptFiles.indexOf('script.shelf.js.html')].includes('function scheduleIncrementalResultRender_') &&
    clientScriptSources[clientScriptFiles.indexOf('script.shelf.js.html')].includes('new window.IntersectionObserver') &&
    clientScriptSources[clientScriptFiles.indexOf('script.shelf.js.html')].includes('resetResultRenderQueue_();') &&
    clientScriptSources[clientScriptFiles.indexOf('script.shelf.js.html')].includes('deferred: Math.max(0, data.length - nextIndex)') &&
    !clientScriptSources[clientScriptFiles.indexOf('script.shelf.js.html')].includes('data.forEach((book, idx) => {'),
  'card and list search results render incrementally without a result-count limit'
);
vm.runInContext(`
  var __previousCreateRenderElement = document.createElement;
  var __previousRenderRaf = window.requestAnimationFrame;
  var __previousRenderObserver = window.IntersectionObserver;
  var __renderRanges = [];
  var __renderObservers = [];
  function __createRenderNode() {
    return {
      children: [],
      parentNode: null,
      className: '',
      setAttribute() {},
      appendChild(child) {
        this.children.push(child);
        child.parentNode = this;
        return child;
      },
      removeChild(child) {
        this.children = this.children.filter(item => item !== child);
        child.parentNode = null;
      }
    };
  }
  document.createElement = function() { return __createRenderNode(); };
  window.requestAnimationFrame = function(callback) { callback(); };
  window.IntersectionObserver = function(callback) {
    this.callback = callback;
    __renderObservers.push(this);
  };
  window.IntersectionObserver.prototype.observe = function() {};
  window.IntersectionObserver.prototype.disconnect = function() {};

  var __incrementalResult = __createRenderNode();
  scheduleIncrementalResultRender_(
    __incrementalResult,
    Array.from({ length: 40 }, (_, index) => index),
    'card',
    function(start, end) { __renderRanges.push([start, end]); },
    null
  );
  __renderObservers[0].callback([{ isIntersecting: true }]);
  __renderObservers[1].callback([{ isIntersecting: true }]);
  __renderObservers[2].callback([{ isIntersecting: true }]);

  document.createElement = __previousCreateRenderElement;
  window.requestAnimationFrame = __previousRenderRaf;
  window.IntersectionObserver = __previousRenderObserver;
`, sandbox);
assertEqual(
  vm.runInContext('JSON.stringify(__renderRanges)', sandbox),
  JSON.stringify([[0, 12], [12, 24], [24, 36], [36, 40]]),
  'incremental result renderer keeps every result available in bounded chunks'
);
assert(
  clientScriptSources[clientScriptFiles.indexOf('script.state.js.html')].includes('BOOK_DETAIL_PREFETCH_WARM_DELAY_MS') &&
    clientScriptSources[clientScriptFiles.indexOf('script.modal.js.html')].includes('function scheduleBookDetailPrefetchQueue_') &&
    clientScriptSources[clientScriptFiles.indexOf('script.modal.js.html')].includes('window.requestIdleCallback(run') &&
    clientScriptSources[clientScriptFiles.indexOf('script.shelf.js.html')].includes('priorityCount: 0'),
  'bookshelf detail prefetch is delayed and scheduled through idle-friendly background work'
);
assert(
  clientScriptSources[clientScriptFiles.indexOf('script.state.js.html')].includes('bookshelfPendingRestoreScroll') &&
    clientScriptSources[clientScriptFiles.indexOf('script.shelf.js.html')].includes('restoreBookshelfScrollAfterRender_') &&
    clientScriptSources[clientScriptFiles.indexOf('script.search.js.html')].includes('bookshelfPendingRestoreScroll = Boolean(opt.restoreScroll)'),
  'bookshelf scroll restore waits for asynchronous shelf tile rendering'
);
assert(
  clientScriptSources[clientScriptFiles.indexOf('script.modal.js.html')].includes("--popup-drag-x', `${dragX}px`") &&
    modernModalStyleSource.includes('translate(var(--popup-drag-x, 0), var(--popup-drag-y, 0))'),
  'book popup provides horizontal drag feedback while swiping'
);
assert(
  clientScriptSources[clientScriptFiles.indexOf('script.modal.js.html')].includes("'popup-commit-next'") &&
    clientScriptSources[clientScriptFiles.indexOf('script.modal.js.html')].includes("'popup-no-rise'") &&
    clientScriptSources[clientScriptFiles.indexOf('script.modal.js.html')].includes('renderNextPopup_();') &&
    !clientScriptSources[clientScriptFiles.indexOf('script.modal.js.html')].includes('window.requestAnimationFrame(renderNextPopup_)') &&
    clientScriptSources[clientScriptFiles.indexOf('script.modal.js.html')].includes('deferCurrentDetailRender: Boolean(transitionClone)') &&
    modernModalStyleSource.includes('#image-popup-content.is-dragging') &&
    fs.readFileSync(path.join(root, 'style.legacy-modal.css.html'), 'utf8').includes('@keyframes popup-commit-next'),
  'book popup commits swipe direction before changing books without restarting the entry animation'
);

const cachedShelfBook = sandbox.sanitizeBookshelfCacheBook_({
  rowIndex: 12,
  detailLoaded: true,
  title: '棚の本',
  isbn: '9780000000000',
  shelf: '①-上',
  location: '1',
  isSensitive: true,
  summary: '保存しない',
  author: '保存しない'
});
assertEqual(cachedShelfBook.detailLoaded, false, 'bookshelf cache keeps details deferred');
assertEqual(cachedShelfBook.title, '棚の本', 'bookshelf cache keeps title');
assert(!('summary' in cachedShelfBook), 'bookshelf cache excludes summaries');
assert(!('author' in cachedShelfBook), 'bookshelf cache excludes detail fields');

sandbox.writeBookshelfCache_([cachedShelfBook]);
const shelfCache = sandbox.readBookshelfCache_();
assert(shelfCache && Array.isArray(shelfCache.books), 'bookshelf cache can be read back');
assertEqual(shelfCache.books.length, 1, 'bookshelf cache preserves book count');
assertEqual(shelfCache.books[0].detailLoaded, false, 'bookshelf cache read keeps detail deferred');

const shelfCacheChips = sandbox.buildSearchStatusChips_('shelf', { source: 'cache', refreshing: true });
assert(
  shelfCacheChips.some(chip => chip.key === 'bookshelfCache' && chip.className === 'cache'),
  'shelf status shows cache source'
);
assert(
  shelfCacheChips.some(chip => chip.key === 'bookshelfRefreshing' && chip.className === 'sync'),
  'shelf status shows background refresh'
);
const shelfNetworkChips = sandbox.buildSearchStatusChips_('shelf', { source: 'network' });
assert(
  shelfNetworkChips.some(chip => chip.key === 'bookshelfNetwork' && chip.label === '更新済み'),
  'shelf status shows network refresh complete'
);
assert(
  searchScriptSource.includes('if (!hasCachedBookshelf)') &&
    searchScriptSource.includes("showSpinner('本棚を広げています'"),
  'bookshelf cache path avoids blocking spinner'
);

vm.runInContext(`
currentViewMode = 'shelf';
isShelfImmersiveMode = true;
lastResult = [{ title: '棚の本' }];
window.scrollY = 480;
saveCurrentBookshelfScroll_();
`, sandbox);
const shelfScrollState = sandbox.readBookshelfScrollState_();
assert(shelfScrollState && shelfScrollState.scrollY === 480, 'bookshelf scroll state can be restored');

vm.runInContext(`
hydratePreferredResultViewMode_('shelf');
currentViewMode = 'shelf';
resetViewModeForNewResults_();
`, sandbox);
assertEqual(
  vm.runInContext('currentViewMode', sandbox),
  'card',
  'new results fall back to card when previous/preferred mode is shelf'
);

vm.runInContext(`
hydratePreferredResultViewMode_('list');
currentViewMode = 'list';
resetViewModeForNewResults_();
`, sandbox);
assertEqual(
  vm.runInContext('currentViewMode', sandbox),
  'list',
  'new results preserve non-shelf preferred mode'
);

function createClassList() {
  const values = new Set();
  return {
    add(value) {
      values.add(value);
    },
    remove(value) {
      values.delete(value);
    },
    contains(value) {
      return values.has(value);
    }
  };
}

function createElement() {
  const attributes = {};
  return {
    style: {},
    classList: createClassList(),
    hidden: false,
    textContent: '',
    setAttribute(name, value) {
      attributes[name] = String(value);
    },
    getAttribute(name) {
      return attributes[name];
    }
  };
}

const spinnerElements = {
  'spinner-overlay': createElement(),
  'spinner-label': createElement(),
  'spinner-detail': createElement()
};

sandbox.document.getElementById = function getElementById(id) {
  return spinnerElements[id] || null;
};
sandbox.document.querySelector = function querySelector(selector) {
  return selector === '.spinner-label' ? spinnerElements['spinner-label'] : null;
};

vm.runInContext("showSpinner('本棚を探しています', { kind: 'search' });", sandbox);
assertEqual(spinnerElements['spinner-overlay'].style.display, 'flex', 'showSpinner displays overlay');
assertEqual(spinnerElements['spinner-label'].textContent, '本棚を探しています', 'showSpinner sets label');
assertEqual(
  spinnerElements['spinner-detail'].textContent,
  'タイトル・作者・読みから候補を集めています',
  'showSpinner sets default detail for kind'
);
assert(spinnerElements['spinner-overlay'].classList.contains('spinner-kind-search'), 'showSpinner sets kind class');
assertEqual(spinnerElements['spinner-overlay'].getAttribute('aria-busy'), 'true', 'showSpinner marks overlay busy');

vm.runInContext('hideSpinner();', sandbox);
assertEqual(spinnerElements['spinner-overlay'].style.display, 'none', 'hideSpinner hides overlay');
assertEqual(spinnerElements['spinner-detail'].textContent, '', 'hideSpinner clears detail');
assert(spinnerElements['spinner-detail'].hidden, 'hideSpinner hides detail');
assert(
  !spinnerElements['spinner-overlay'].classList.contains('spinner-kind-search'),
  'hideSpinner clears kind class'
);
assertEqual(spinnerElements['spinner-overlay'].getAttribute('aria-busy'), 'false', 'hideSpinner clears busy state');

vm.runInContext("showSpinner('この入口の棚を開いています', getSearchSpinnerOptions_({ detailStory: 'ファンタジー' }, 'この入口の棚を開いています'));", sandbox);
assertEqual(
  spinnerElements['spinner-detail'].textContent,
  '選んだ入口に合う本を集めています',
  'quick browse uses browse spinner detail'
);

console.log('client js checks ok');
