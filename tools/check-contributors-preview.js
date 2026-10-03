const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const read = name => fs.readFileSync(path.join(root, name), 'utf8');
const plain = value => JSON.parse(JSON.stringify(value));
const server = vm.createContext({ console: { error() {} }, URL, encodeURIComponent });
vm.runInContext(['config.js', 'Webアプリ.js', 'SeriesRegistry.js', 'コード.js'].map(read).join('\n'), server);

// Compile the current generator in memory: this test does not depend on a previous Pages build.
const builder = read('tools/build-pages.js');
let shimSource;
vm.runInNewContext(builder.slice(builder.indexOf('function writeGasRunShim()'), builder.indexOf('function writePwaClient()')) + '\nwriteGasRunShim();', {
  gasEndpoint: 'https://example.invalid/api', path, jsDir: '',
  fs: { writeFileSync(file, source) { shimSource = source; } }
});

function clientFixture() {
  const timers = new Map();
  let nextTimer = 1;
  const requests = [];
  const storage = new Map();
  const context = vm.createContext({
    console: { warn() {}, error() {} }, URLSearchParams,
    setTimeout(fn, delay) { const id = nextTimer++; timers.set(id, { fn, delay }); return id; },
    clearTimeout(id) { timers.delete(id); },
    window: { location: { search: '' }, addEventListener() {}, localStorage: {
      getItem: key => storage.get(key) || null, setItem: (key, value) => storage.set(key, value), removeItem: key => storage.delete(key)
    } },
    document: { addEventListener() {}, getElementById() { return null; } },
    google: { script: { run: {} } }
  });
  for (const name of ['state', 'search', 'render', 'modal']) {
    vm.runInContext(read(`script.${name}.js.html`).replace(/^\s*<script>\s*/, '').replace(/\s*<\/script>\s*$/, ''), context);
  }
  context.isPwaShell_ = () => true;
  context.renderSearchStatus_ = () => {};
  context.syncExtraFilterLabel_ = () => {};
  context.isAdvancedOpen = () => false;
  let params = {};
  context.getEffectiveSearchParams_ = () => params;
  context.google.script.run = new Proxy({}, {
    get(target, key) {
      if (key === 'withSuccessHandler') return fn => { target.ok = fn; return context.google.script.run; };
      if (key === 'withFailureHandler') return fn => { target.fail = fn; return context.google.script.run; };
      return (...args) => requests.push({ method: key, args, ok: target.ok, fail: target.fail });
    }
  });
  return {
    c: context, requests, timers, storage,
    setParams(value) { params = value; context.syncSearchStatusPreviewFromForm_(); },
    state() { return plain(vm.runInContext('searchStatusState', context)); },
    runTimer() {
      const entry = Array.from(timers.entries()).find(([, timer]) => timer.delay === 250);
      assert(entry, 'preview has one 250ms debounce');
      timers.delete(entry[0]); entry[1].fn();
    }
  };
}

async function localFixture(payload) {
  const network = [];
  const navigator = { onLine: true };
  const db = {
    objectStoreNames: { contains: () => true }, close() {},
    transaction() { return { objectStore() { return { get() {
      const request = {};
      queueMicrotask(() => { request.result = { schemaVersion: 7, payload, savedAt: 'fixture-time' }; request.onsuccess(); });
      return request;
    } }; } }; }
  };
  const window = {
    indexedDB: { open() {
      const request = {};
      queueMicrotask(() => { request.result = db; request.onsuccess(); });
      return request;
    } },
    setTimeout, clearTimeout, addEventListener() {}
  };
  const document = {
    addEventListener() {}, dispatchEvent() {},
    createElement() { return {}; }, head: { appendChild(script) { network.push(script); } }
  };
  require('./frame-test-fixture').installFrameFixture(window, document);
  vm.runInNewContext(shimSource, {
    window, document, navigator, URLSearchParams, Promise, Date, CustomEvent: function(type, init) { this.type = type; this.detail = init.detail; },
    btoa: value => Buffer.from(value, 'binary').toString('base64'), console: { warn() {}, error() {} }
  });
  await window.ShumiLibraryLocalIndex.whenLoaded();
  return { window, navigator, network, manager: window.ShumiLibraryLocalIndex };
}

const client = clientFixture().c;
const parserCases = [
  [' 木皿 泉 | 山田 あかね || 木皿 泉 | ', ['木皿 泉', '山田 あかね']],
  ['Spinelli, Jerry', ['Spinelli, Jerry']],
  ['deco 他', ['deco 他']],
  ['空知 英秋 大崎 知仁 1976-', ['空知 英秋 大崎 知仁 1976-']],
  ['甲／著・乙 / 丙, 丁', ['甲／著・乙 / 丙, 丁']],
  ['ＡＢＣ | abc | ABC', ['ＡＢＣ']],
  ['', []], [null, []]
];
for (const [raw, names] of parserCases) {
  assert.deepEqual(plain(server.parseBookContributors_(raw)), names, 'GAS pipe-only contributor parsing');
  assert.deepEqual(plain(client.parseBookContributors_(raw)), names, 'client pipe-only contributor parsing');
}
assert.deepEqual(plain(client.normalizeContributorSuggestions_({ authors: ['甲 | 乙', '乙', 'Spinelli, Jerry'] }).authors),
  ['甲', '乙', 'Spinelli, Jerry'], 'legacy joined native/PWA metadata suggestions become individual people');
const lead = client.buildPopupBookLeadHtml_({ author: '甲 | 乙', contributors: ['甲', '乙'], publisher: '出版社' });
assert.equal((lead.match(/data-detail-search-field="detailAuthor"/g) || []).length, 2, 'detail renders one control per person');
assert(lead.includes('data-detail-search-value="甲"') && lead.includes('data-detail-search-value="乙"'), 'each person searches its own name');
assert(!lead.includes('data-detail-search-value="甲 | 乙"'), 'detail does not join two people into one search control');
assert(client.buildPopupBookLeadHtml_({ author: 'Spinelli, Jerry' }).includes('data-detail-search-value="Spinelli, Jerry"'), 'ambiguous old punctuation stays one person');
assert(client.buildPopupBookLeadHtml_({ author: '<script> | "Name"' }).includes('&lt;script&gt;'), 'person controls escape markup');

const uuid = i => '00000000-0000-4000-8000-' + String(i + 1).padStart(12, '0');
const fixtures = [
  ['河童 1', 'かっぱ', ' 木皿 泉 | 山田 あかね || 木皿 泉 ', '漫画,小説,日常,静か,連載中', '2024-05'],
  ['河童 2', 'かっぱ', '木皿 泉 | 山田 あかね', '漫画,小説,日常,静か,連載中', '2024-06'],
  ['スターガール', 'すたーがーる', 'Spinelli, Jerry', '小説,日常,完結', '2020-01'],
  ['曖昧な関係者', 'あいまいなかんけいしゃ', 'deco 他／著・乙 / 丙, 丁', '絵本,日常,完結', ''],
  ['秘密の本', 'ひみつのほん', '甲 | 乙', '漫画,18禁,恋愛,単巻', '2024-01'],
  ['無記名', 'むきめい', '', '写真集,単巻', '2021-01']
];
server.fixtureRows = fixtures.map(([title, yomi, author, genre, released], i) => {
  const row = Array(20).fill('');
  row[0] = title; row[2] = author; row[3] = '出版社'; row[6] = released; row[12] = yomi;
  row[13] = uuid(i); row[14] = genre; row[15] = i < 2 ? 'series-one' : 'series-' + i;
  return row;
});
vm.runInContext(`
  loadMainBookData_ = () => fixtureRows;
  getGenreMasterData_ = () => ({ genreToCategory: { 漫画:'媒体', 小説:'媒体', 絵本:'媒体', 写真集:'媒体', 日常:'ストーリー', 静か:'雰囲気', 連載中:'状況', 完結:'状況', 単巻:'状況', '18禁':'題材', 恋愛:'題材' },
    options: { story:['日常'], theme:['18禁','恋愛'], mood:['静か'], status:['連載中','完結','単巻'], media:['漫画','小説','絵本','写真集'] } });
  getPublisherOptions_ = () => ['出版社'];
  loadSeriesRegistryLookup_ = () => ({ masterById: new Map() });
  resolveSeriesRegistryKey_ = key => ({ seriesId:key, displayName:key === 'series-one' ? '別名 河童' : key, media:[] });
  loadSeriesOrderValues_ = () => [];
`, server);
const dataset = server.buildLibraryDataset_();
dataset.datasetRevision = 'fixture-contributors-revision';
server.getLibraryDataset_ = () => dataset;
const payload = plain(server.buildLocalLibraryIndexPayload_(dataset));
// Keep the old schema and positions, including seriesOrder at 32.
assert.equal(payload.version, 7); assert.equal(payload.columns[32], 'seriesOrder');
assert(payload.records.every(record => record.length === 33), 'contributors do not shift the compact schema');
payload.metadata.suggest.authors = ['木皿 泉 | 山田 あかね', 'Spinelli, Jerry'];

// The full-bookshelf path must keep the same cover bibliography even without localIndex.
const liteDataset = plain(server.buildBookshelfLiteDataset_());
assert(server.isBookshelfLiteDatasetValid_(liteDataset), 'new lite payload validates cover bibliography');
assert.equal(vm.runInContext('CACHE_CONFIG.SHELF_DATASET_KEY', server), 'library_shelf_dataset_v5');
for (const [i, book] of liteDataset.books.entries()) {
  assert.equal(book.author, fixtures[i][2], 'lite payload preserves the raw K-column string');
  assert.deepEqual(book.contributors, plain(server.parseBookContributors_(fixtures[i][2])), 'lite payload preserves individual people');
  assert.equal(book.volume, dataset.index[i].volume, 'lite volume uses the existing full-index extraction rule');
}
for (const field of ['author', 'contributors', 'volume']) {
  const old = plain(liteDataset); delete old.books[0][field];
  assert(!server.isBookshelfLiteDatasetValid_(old), 'old lite cache without ' + field + ' must rebuild');
}
for (const title of ['デュラララ!! ×03', 'Pandora hearts 08.5 official guide', 'BEASTARS 1～10巻BOXセット']) {
  const row = Array(20).fill(''); row[0] = title;
  assert.equal(server.mapRowsToShelfBooks_([row], null, 0)[0].volume, server.extractVolumeNumber(title), 'lite does not introduce a new volume inference rule');
}
assert.equal(server.mapRowsToShelfBooks_(server.fixtureRows.slice(0, 1), [{ volume: 7 }], 0)[0].volume, 7, 'existing known index volume takes priority');

const shelfUi = clientFixture();
const freshShelfBook = liteDataset.books[0];
const oldShelfBook = Object.assign({}, freshShelfBook);
delete oldShelfBook.author; delete oldShelfBook.contributors; delete oldShelfBook.volume;
shelfUi.storage.set('shumiLibrary.bookshelfLiteCache.v2', JSON.stringify({ savedAt: Date.now(), books: [oldShelfBook] }));
assert.equal(shelfUi.c.readBookshelfCache_(), null, 'old cache key cannot revive authorless fallback covers');
assert.equal(vm.runInContext('BOOKSHELF_CACHE_KEY', shelfUi.c), 'shumiLibrary.bookshelfLiteCache.v3');
assert(!shelfUi.c.areBookshelfSnapshotsEqual_([oldShelfBook], [freshShelfBook]), 'fresh author/volume changes force old bookshelf snapshot replacement');
shelfUi.c.writeBookshelfCache_([freshShelfBook]);
const savedShelfBook = plain(shelfUi.c.readBookshelfCache_().books[0]);
assert.equal(savedShelfBook.author, freshShelfBook.author);
assert.deepEqual(savedShelfBook.contributors, freshShelfBook.contributors);
assert.equal(savedShelfBook.volume, freshShelfBook.volume);
assert(shelfUi.c.areBookshelfSnapshotsEqual_([savedShelfBook], [freshShelfBook]), 'equivalent fresh cover bibliography avoids unnecessary rerender');
for (const changes of [{ author:'更新された著者' }, { contributors:['別の関係者'] }, { volume:2 }]) {
  assert(!shelfUi.c.areBookshelfSnapshotsEqual_([savedShelfBook], [Object.assign({}, freshShelfBook, changes)]), 'changed cover bibliography triggers a refresh');
}
const deferredSource = Object.assign({}, freshShelfBook, { detailLoaded:true, publisher:'出版社', released:'2024-05', brand:'レーベル', price:'500', yomi:'かっぱ', seriesOrder:0, ownedMaxVolume:2, summary:'重い詳細本文' });
const deferred = shelfUi.c.createPopupDeferredRenderBook_(deferredSource);
for (const field of ['author', 'volume', 'publisher', 'released', 'brand', 'price', 'yomi', 'seriesOrder', 'ownedMaxVolume']) {
  assert.equal(deferred[field], deferredSource[field], 'deferred popup retains known bibliography: ' + field);
}
assert.deepEqual(plain(deferred.contributors), freshShelfBook.contributors);
deferred.contributors.push('mutated');
assert.deepEqual(deferredSource.contributors, freshShelfBook.contributors, 'deferred popup does not mutate source people');
assert.equal(deferred.detailLoaded, false); assert.equal(deferred.summary, undefined, 'heavy synopsis remains deferred');

async function main() {
  const local = await localFixture(payload);
  assert.equal(local.manager.countMatches([]), null, 'unchecked stored index is not reported as a confirmed count online');
  assert.deepEqual(plain(local.manager.getMetadata().suggest.authors),
    ['木皿 泉', '山田 あかね', 'Spinelli, Jerry', 'deco 他／著・乙 / 丙, 丁', '甲', '乙'],
    'saved schema7 metadata is rebuilt from all raw person fields');
  await local.manager.noteServerRevision(payload.revision);
  assert.equal(local.network.length, 0, 'matching server revision makes stored index fresh without a catalog download');
  assert.equal(local.manager.getFreshnessState(), 'fresh');
  const rawAuthor = fixtures[0][2];
  const book = local.manager.getBookById(uuid(0));
  assert.equal(book.author, rawAuthor, 'raw author string is preserved');
  assert.deepEqual(plain(book.contributors), ['木皿 泉', '山田 あかね']);
  client.window.ShumiLibraryLocalIndex = local.manager;
  const lite = { bookId: uuid(0), rowIndex: 0 };
  client.hydratePopupBookFromLocalIndex_(lite);
  assert.equal(lite.author, rawAuthor);
  assert.deepEqual(plain(lite.contributors), ['木皿 泉', '山田 あかね'], 'popup hydration copies people from the matching immutable book ID');
  const missing = { bookId: 'deleted-book', rowIndex: 0 };
  client.hydratePopupBookFromLocalIndex_(missing);
  assert.equal(missing.contributors, undefined, 'missing UUID never hydrates from a different book at the old row');
  assert.equal(client.getBookDetailPrefetchIdentity_({}), '', 'identityless detail prefetch stays safely empty');
  book.contributors.push('mutated');
  assert.deepEqual(plain(local.manager.getBookById(uuid(0)).contributors), ['木皿 泉', '山田 あかね'], 'book clones do not mutate stored contributors');
  for (const [i, fixture] of fixtures.entries()) {
    assert.deepEqual(plain(local.manager.getBookById(uuid(i)).contributors), plain(server.parseBookContributors_(fixture[2])), 'GAS/client/local person rules agree');
  }
  const invoke = args => new Promise((resolve, reject) => local.window.google.script.run.withSuccessHandler(resolve).withFailureHandler(reject).searchBooksAdvanced(...args));
  const criteriaCases = [
    {}, { keyword:'河童', detailMedia:'小説' }, { keyword:'かっぱ', detailMedia:'漫画' },
    { keyword:'別名 河童', detailMedia:'小説' }, { keyword:'山田 あかね', detailStory:'日常' },
    { detailAuthor:'山田' }, { detailAuthor:'木皿 泉 | 山田 あかね' }, { keyword:'Spinelli, Jerry' },
    { detailAuthor:'deco 他／著・乙 / 丙, 丁' }, { detailAuthor:'乙', detailMedia:'漫画' },
    { detailTheme:'18禁', detailMedia:'漫画' }, { detailPublisher:'出版社', detailReleasedFromYear:'2024', detailReleasedToYear:'2024' },
    { detailReleasedFromYear:'2024', detailReleasedFromMonth:'13' }, { detailMedia:'小説', detailStatus:'完結' },
    { keyword:'不存在', detailMedia:'小説' }, { keyword:'カッパ', detailMood:'静か' }
  ];
  const previewIndex = server.buildPreviewIndexPayload_(dataset);
  for (const params of criteriaCases) {
    const args = client.buildPreviewCountArgs_(params);
    const remote = plain(server.searchBooksAdvanced(...args));
    const count = server.countPreviewMatchesAuthoritative(...args);
    const localBooks = plain(await invoke(args));
    const nativeCount = previewIndex.filter(item => client.matchesSearchCriteria_(item, client.buildClientSearchCriteria_(params))).length;
    assert.equal(count, remote.length, 'server preview and actual search count agree');
    assert.equal(local.manager.countMatches(args), count, 'actual local matcher and server preview agree: ' + JSON.stringify(params));
    assert.equal(nativeCount, count, 'native client matcher and server preview agree: ' + JSON.stringify(params));
    assert.deepEqual(localBooks.map(book => book.bookId), remote.map(book => book.bookId), 'local and remote search keep same matching UUID order');
  }
  assert.equal(local.manager.countMatches(client.buildPreviewCountArgs_({ keyword:'河童', detailMedia:'小説' })), 2, 'media2 matches once per book');
  assert.equal(local.network.length, 0, 'local search and preview never issue per-keystroke GAS requests with usable data');

  // Pending, absent, failed, legitimate zero and out-of-order responses stay distinguishable.
  const ui = clientFixture();
  ui.c.window.ShumiLibraryLocalIndex = local.manager;
  ui.setParams({ keyword:'河童', detailMedia:'小説' });
  ui.setParams({ keyword:'不存在', detailMedia:'小説' });
  assert.equal(ui.timers.size, 1, 'typing cancels previous debounce');
  assert(ui.state().previewPending && ui.state().previewCount === null);
  ui.runTimer();
  assert.equal(ui.state().previewCount, 0);
  assert.equal(ui.c.getSearchStatusCountText_(), 'この条件に合う本はありません');
  assert.equal(ui.requests.length, 0);
  ui.setParams({ keyword:'河童', detailMedia:'小説' }); ui.runTimer();
  assert.equal(ui.c.getSearchStatusCountText_(), 'この条件で2冊を見る');
  ui.setParams({});
  assert.equal(ui.timers.size, 0); assert.equal(ui.state().previewCount, null);

  const pending = clientFixture();
  let releaseIndex;
  let readyCount = null;
  pending.c.window.ShumiLibraryLocalIndex = { countMatches: () => readyCount, whenReadyForSearch: () => new Promise(resolve => { releaseIndex = resolve; }) };
  pending.setParams({ keyword:'old' }); pending.runTimer();
  assert(pending.state().previewPending && pending.state().previewCount === null, 'missing/loading data does not appear as zero');
  pending.setParams({}); readyCount = 99; releaseIndex(); await Promise.resolve();
  assert.equal(pending.state().previewCount, null, 'late loaded data cannot revive cleared conditions');
  assert.equal(pending.requests.length, 0, 'cleared pending probe does not fall back to GAS');

  const race = clientFixture();
  race.setParams({ keyword:'old' }); race.runTimer();
  race.setParams({ keyword:'new', detailMedia:'小説' }); race.runTimer();
  race.requests[0].ok(99); race.requests[0].fail(new Error('late'));
  assert(race.state().previewPending && race.state().previewCount === null, 'old success/failure cannot replace current pending preview');
  race.requests[1].ok(17);
  assert.equal(race.c.getSearchStatusCountText_(), 'この条件で17冊を見る');
  race.setParams({ keyword:'new' }); race.runTimer(); race.requests[2].fail(new Error('offline'));
  assert(race.state().previewUnavailable && race.state().previewCount === null, 'failure is unavailable rather than zero');
  for (const value of [null, undefined, '', '0', NaN, Infinity, -1, 0.5, [], {}]) {
    race.setParams({ keyword:'invalid' }); race.runTimer(); race.requests.at(-1).ok(value);
    assert(race.state().previewUnavailable && !race.state().previewReady, 'invalid API count is never silently coerced to zero');
  }
  race.setParams({ keyword:'same' }); race.runTimer(); const obsolete = race.requests.at(-1);
  race.c.showSearchStatusResult_('normal', 8, { keyword:'same' }); obsolete.ok(55);
  assert.equal(race.state().mode, 'result'); assert.equal(race.state().resultCount, 8, 'late preview cannot replace submitted results');
  race.setParams({ keyword:'first' }); race.runTimer(); const first = race.requests.at(-1);
  race.setParams({ keyword:'second' }); race.setParams({ keyword:'first' }); race.runTimer(); first.ok(90);
  assert(race.state().previewPending, 'A-B-A form race still rejects the first A request');
  race.requests.at(-1).ok(0); assert.equal(race.c.getSearchStatusCountText_(), 'この条件に合う本はありません');

  const native = clientFixture(); native.c.isPwaShell_ = () => false;
  vm.runInContext('PREVIEW_INDEX = []; PREVIEW_INDEX_READY = false;', native.c);
  assert.equal(native.c.countPreviewMatches_({ keyword:'x' }), null, 'unavailable native index is not zero');
  vm.runInContext('PREVIEW_INDEX_READY = true;', native.c);
  assert.equal(native.c.countPreviewMatches_({ keyword:'x' }), 0, 'known valid empty native dataset can report zero');
  server.getLibraryDataset_ = () => { throw new Error('catalog unavailable'); };
  assert.throws(() => server.countPreviewMatchesAuthoritative('x'), /catalog unavailable/, 'server failures must not return zero');
  assert.throws(() => server.getPreviewIndex(), /catalog unavailable/, 'native index failures remain failures');
  console.log('contributor parsing, legacy schema7 metadata, local/server/native preview equality and preview race checks ok');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
