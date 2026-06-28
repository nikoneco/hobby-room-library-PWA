const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const scriptPath = path.join(root, 'script.js.html');
const indexPath = path.join(root, 'index.html');
const serverPath = path.join(root, 'Webアプリ.js');
const indexSource = fs.readFileSync(indexPath, 'utf8');
const serverSource = fs.readFileSync(serverPath, 'utf8');
const source = fs
  .readFileSync(scriptPath, 'utf8')
  .replace(/^\s*<script>\s*/, '')
  .replace(/\s*<\/script>\s*$/, '');

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
vm.createContext(sandbox);
vm.runInContext(source, sandbox, { filename: 'script.js.html' });

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
['search', 'random', 'toggle-advanced', 'clear-conditions', 'reset-search'].forEach(action => {
  assert(indexSource.includes(`data-action="${action}"`), `index.html exposes data-action="${action}"`);
});
assert(serverSource.includes('WEB_APP_API_REGISTRY_'), 'Webアプリ.js has API registry');
assert(serverSource.includes('currentWebApp'), 'Webアプリ.js registry classifies current Web App API');
assert(serverSource.includes('compatibility'), 'Webアプリ.js registry classifies compatibility API');

const actionKeys = vm.runInContext('Object.keys(STATIC_ACTION_HANDLERS).sort().join(",")', sandbox);
assertEqual(
  actionKeys,
  'clear-conditions,random,reset-search,search,toggle-advanced',
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

console.log('client js checks ok');
