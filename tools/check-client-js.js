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
const clientScriptSources = clientScriptFiles
  .map(fileName => fs
    .readFileSync(path.join(root, fileName), 'utf8')
    .replace(/^\s*<script>\s*/, '')
    .replace(/\s*<\/script>\s*$/, ''));
const searchScriptSource = clientScriptSources[clientScriptFiles.indexOf('script.search.js.html')];

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
['search', 'focus-search', 'random', 'bookshelf', 'toggle-advanced', 'clear-conditions', 'reset-search'].forEach(action => {
  assert(indexSource.includes(`data-action="${action}"`), `index.html exposes data-action="${action}"`);
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
  'bookshelf,clear-conditions,focus-search,random,reset-search,search,toggle-advanced',
  'STATIC_ACTION_HANDLERS maps static data-actions'
);

assertEqual(sandbox.normalizeKana('ＡＢＣ カタカナ'), 'abcかたかな', 'normalizeKana normalizes width and kana');

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
  clientScriptSources[clientScriptFiles.indexOf('script.modal.js.html')].includes('function notifyBookOpened_') &&
    clientScriptSources[clientScriptFiles.indexOf('script.modal.js.html')].includes('shumi-library:book-opened') &&
    clientScriptSources[clientScriptFiles.indexOf('script.modal.js.html')].includes('notifyBookOpened_(book)'),
  'book popup emits opened-book event for PWA affordances'
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
