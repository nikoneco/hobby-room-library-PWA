const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'Webアプリ.js'), 'utf8');
const configSource = fs.readFileSync(path.join(root, 'config.js'), 'utf8');
const mainSynopsisSource = fs.readFileSync(path.join(root, 'あらすじ取得_Main.js'), 'utf8');
const koboSynopsisSource = fs.readFileSync(path.join(root, 'あらすじ取得_kobo.js'), 'utf8');
const sheetCodeSource = fs.readFileSync(path.join(root, 'コード.js'), 'utf8');
const newBookImportSource = fs.readFileSync(path.join(root, 'NewBookImport.js'), 'utf8');
const claspignore = fs.readFileSync(path.join(root, '.claspignore'), 'utf8');

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

fs.readdirSync(root)
  .filter(fileName => fileName.endsWith('.js'))
  .forEach(fileName => {
    const fileSource = fs.readFileSync(path.join(root, fileName), 'utf8');
    const declarations = Array.from(fileSource.matchAll(/^function\s+([A-Za-z0-9_$]+)\s*\(/gm));
    const seen = new Set();
    declarations.forEach(match => {
      const functionName = match[1];
      assert(!seen.has(functionName), `${fileName} does not redeclare top-level function ${functionName}`);
      seen.add(functionName);
    });
  });

assert(/function\s+doGet\s*\(\s*e\s*\)/.test(source), 'doGet accepts event parameter');
assert(source.includes("String(params.api || '').trim()"), 'doGet routes by api parameter');
assert(source.includes('HtmlService.createTemplateFromFile'), 'doGet preserves HTML fallback');
assert(source.includes('ContentService.MimeType.JAVASCRIPT'), 'JSONP uses JavaScript mime type');
assert(source.includes('WEBAPP_JSONP_CALLBACK_PATTERN_'), 'JSONP validates callback names');
assert(source.includes('stringifyForJsonp_'), 'JSONP escapes script-sensitive separators');
assert(source.includes('decodeWebAppJsonpParams_'), 'JSONP decodes Base64URL parameters');
assert(source.includes('Utilities.base64DecodeWebSafe'), 'JSONP uses web-safe Base64 decoding');
assert(source.includes('PUBLIC_WEBAPP_JSONP_API_HANDLERS_'), 'JSONP uses an explicit public API whitelist');
const webAppApiRegistrySource = source.slice(
  source.indexOf('const WEB_APP_API_REGISTRY_'),
  source.indexOf('const WEBAPP_API_LIMITS_')
);
const webAppApiRegistryNames = Array.from(
  webAppApiRegistrySource.matchAll(/\{\s*name:\s*'([^']+)'/g),
  match => match[1]
);
assert(
  new Set(webAppApiRegistryNames).size === webAppApiRegistryNames.length,
  'documented public API registry does not contain duplicate names'
);
assert(source.includes('buildQuickBrowseCountsPayload_'), 'PWA initial data includes quick browse counts');
assert(configSource.includes("LIBRARY_DATASET_KEY: 'library_dataset_v24'"), 'library cache key invalidates datasets without UUID/revision stamps');
assert(source.includes('SHELF_DATASET_KEY'), 'server defines a separate bookshelf dataset cache key');
assert(configSource.includes("SHELF_DATASET_KEY: 'library_shelf_dataset_v4'"), 'bookshelf cache key invalidates datasets without stable book IDs');
assert(source.includes('getBookshelfLiteDataset_'), 'server has a lightweight bookshelf dataset path');
assert(source.includes('buildBookshelfLiteDataset_'), 'server can build bookshelf data without full search index');
assert(source.includes('fallbackImg: normalizeBookFallbackImageUrl_(row[CONFIG.IDX.FALLBACK_IMAGE_URL])'), 'lightweight bookshelf records preserve the fallback cover URL');
assert(source.includes("fallbackImageSource: row[CONFIG.IDX.FALLBACK_IMAGE_SOURCE] || ''"), 'lightweight bookshelf records preserve the fallback cover source');
assert(source.includes("typeof book.fallbackImg === 'string'"), 'bookshelf cache validation rejects records without fallback cover URLs');
assert(source.includes('WEBAPP_API_LIMITS_'), 'server centralizes public API limits');
assert(source.includes('normalizeWebAppApiInteger_'), 'server centralizes public API integer normalization');
assert(source.includes('SHELF_CHUNK_MAX_LIMIT'), 'server caps bookshelf chunk size');
assert(source.includes('RANDOM_MAX_COUNT'), 'server caps random result count');
assert(source.includes('BOOK_DETAIL_BATCH_MAX'), 'server caps detail batch size');
assert(configSource.includes('CHUNK_BYTE_LIMIT: 80 * 1024'), 'cache chunks use an 80KB byte limit');
assert(source.includes('function splitUtf8ByByteLimit_'), 'server splits cache payloads by UTF-8 byte length');
assert(source.includes('Utilities.newBlob'), 'server measures cache chunks as UTF-8 bytes');
assert(source.includes('Cache round-trip verification failed'), 'server verifies cache writes by reading them back');
assert(source.includes('LockService.getScriptLock'), 'server coordinates dataset rebuilds with ScriptLock');
assert(source.includes('getOrBuildCachedDataset_'), 'library and shelf datasets use the shared cache rebuild contract');
assert(source.includes('stampDatasetRevision_'), 'cached dataset snapshots carry their build revision');
assert(source.includes('isDatasetSnapshotValidForRevision_'), 'cache hits require the current dataset revision');
assert(source.includes('revisionAfterWrite'), 'cache writes recheck revision after the write');
assert(source.includes("addWebAppPerfDuration_(perf, 'cacheReadMs'"), 'server performance trace measures cache reads');
assert(source.includes("addWebAppPerfDuration_(perf, 'cacheMetaMs'"), 'server performance trace measures cache metadata fetches');
assert(source.includes("addWebAppPerfDuration_(perf, 'cacheChunksMs'"), 'server performance trace measures cache chunk fetches');
assert(source.includes("addWebAppPerfDuration_(perf, 'cacheAssembleMs'"), 'server performance trace measures cache assembly');
assert(source.includes("addWebAppPerfDuration_(perf, 'cacheIntegrityMs'"), 'server performance trace measures lightweight cache integrity validation');
assert(source.includes("addWebAppPerfDuration_(perf, 'cacheParseMs'"), 'server performance trace measures cache JSON parsing');
assert(source.includes('charLength: json.length'), 'cache metadata stores a cheap character-length integrity value');
assert(!source.includes("getUtf8ByteLength_(json) !== Number(meta.byteLength)"), 'cache hits avoid recalculating full UTF-8 byte length');
assert(source.includes("addWebAppPerfDuration_(perf, 'datasetMs'"), 'server performance trace measures dataset retrieval');
assert(source.includes("addWebAppPerfDuration_(perf, 'filterMs'"), 'server performance trace measures simple-search filtering');
assert(source.includes("addWebAppPerfDuration_(perf, 'pickMs'"), 'server performance trace measures random selection');
assert(source.includes("String(decodedParams.perf || '') === '1'"), 'JSONP performance trace is opt-in');
assert(source.includes('envelope.perf = perf'), 'JSONP returns performance trace metadata');
assert(source.includes('serverStartedAtEpochMs'), 'JSONP performance trace includes GAS handler start time');
assert(source.includes('serverResponseReadyAtEpochMs'), 'JSONP performance trace includes GAS response-ready time');
assert(source.includes('perf.jsonpResponseChars'), 'JSONP performance trace includes the final script character count');
assert(source.includes('datasetRevision: getDatasetSnapshotRevision_(dataset)'), 'initial API responses use the exact dataset snapshot revision');
assert(source.includes('function buildLocalLibraryIndexPayload_'), 'server builds a lightweight local-search index');
assert(source.includes('const LOCAL_LIBRARY_INDEX_VERSION_ = 4'), 'server publishes the UUID-aware local-index schema');
assert(source.includes('function buildLocalSearchMetadataPayload_'), 'server bundles search UI metadata into the local index');
assert(source.includes('metadata: buildLocalSearchMetadataPayload_(dataset)'), 'local index contains suggestions, filters, and quick-browse counts');
assert(source.includes('function getLibraryDatasetRevisionForPwa_'), 'server exposes a lightweight revision check');
assert(source.includes('function getLocalLibraryIndexForPwa_'), 'server exposes the local-search index payload');
assert(source.includes("'rowIndex', 'bookId', 'title', 'author', 'publisher'"), 'local index includes a stable book ID in its compact record layout');
assert(source.includes('getBookDetailById'), 'book detail is available by stable book ID');
assert(source.includes('getBookDetailsByIds'), 'book detail prefetch is available by stable book IDs');
assert(source.includes('getBookDetailByRowIndex'), 'book detail remains available separately');
assert(source.includes('bumpLibraryDatasetRevision_'), 'cache invalidation advances the dataset revision');
assert(configSource.includes('BOOK_UUID : 22'), 'V column is the stable book UUID column');
assert(sheetCodeSource.includes('ensureBookUuidsForEditedRange_'), 'sheet edits assign or repair book UUIDs');
assert(sheetCodeSource.includes('repairBookUuidsAll_'), 'existing books have a one-time UUID repair path');
assert(mainSynopsisSource.includes('if (result.processed > 0)') && mainSynopsisSource.includes('clearLibrarySearchCache_();'), 'synopsis batches invalidate cache once after updates');
assert(koboSynopsisSource.includes('if (result.processed > 0)') && koboSynopsisSource.includes('clearLibrarySearchCache_();'), 'Kobo retry batches invalidate cache once after updates');
assert(
  /function\s+clearAllSynopsisRawAndSource_\s*\([^)]*\)[\s\S]*?SpreadsheetApp\.flush\(\);[\s\S]*?clearLibrarySearchCache_\(\);/.test(mainSynopsisSource),
  'clearing every synopsis invalidates search and PWA detail caches'
);
assert(
  /function\s+resetKoboNotFoundDoneToNotFound_\s*\([^)]*\)[\s\S]*?if\s*\(resetRows\)[\s\S]*?clearLibrarySearchCache_\(\);/.test(koboSynopsisSource),
  'resetting Kobo retry rows invalidates search and PWA detail caches'
);
assert(sheetCodeSource.includes('const changed = output.some') && sheetCodeSource.includes('clearLibrarySearchCache_();'), 'series-key batch invalidates cache only after actual changes');

const onEditSource = sheetCodeSource.slice(
  sheetCodeSource.indexOf('function onEdit(e)'),
  sheetCodeSource.indexOf('function shouldClearLibrarySearchCacheOnEdit_')
);
assert(
  onEditSource.lastIndexOf('clearLibrarySearchCache_();') > onEditSource.indexOf('updateSeriesKeyAutoForEditedRange_'),
  'onEdit invalidates cache after derived series-key updates'
);
assert(
  onEditSource.lastIndexOf('clearLibrarySearchCache_();') > onEditSource.indexOf('ensureBookUuidsForEditedRange_'),
  'onEdit invalidates cache after stable UUID assignment'
);
assert(
  onEditSource.includes('(col <= CONFIG.COL.SERIES_KEY_AUTO && colEnd >= CONFIG.COL.SERIES_KEY_AUTO)'),
  'editing the generated series-key column also repairs the row UUID'
);
assert(
  /function\s+enrichNewBooksAfterImportByLimit_\s*\([^)]*\)[\s\S]*?SpreadsheetApp\.flush\(\);[\s\S]*?clearLibrarySearchCache_\(\);/.test(newBookImportSource),
  'new-book enrichment flushes sheet writes before invalidating caches'
);
assert(newBookImportSource.includes('const bookUuids = repairBookUuidsAll_(sheet);'), 'new-book enrichment assigns UUIDs with series keys');

[
  'initial',
  'libraryRevision',
  'localIndex',
  'suggest',
  'advancedOptions',
  'previewIndex',
  'countPreview',
  'searchSimple',
  'searchAdvanced',
  'random',
  'shelf',
  'shelfChunk',
  'bookDetailById',
  'bookDetailsByIds',
  'bookDetail',
  'bookDetails',
  'seriesStatus',
  'series'
].forEach(apiName => {
  assert(new RegExp(`\\b${apiName}\\s*:`).test(source), `JSONP API whitelist includes ${apiName}`);
});

[
  'setup',
  'initialize',
  'save',
  'update',
  'delete',
  'clear',
  'sync',
  'admin',
  'import',
  'write'
].forEach(apiName => {
  assert(!new RegExp(`\\b${apiName}\\s*:`).test(source), `JSONP API whitelist excludes ${apiName}`);
});

[
  'getInitialSearchDataForPwa_()',
  'getLibraryDatasetRevisionForPwa_()',
  'getLocalLibraryIndexForPwa_()',
  'getSuggestData()',
  'getAdvancedSearchOptions()',
  'countPreviewMatchesAuthoritative(',
  'searchBooksSimple(',
  'searchBooksAdvanced(',
  'getRandomBooks(',
  'getBookshelfBooks()',
  'getBookshelfBooksChunk(',
  'getBookDetailById(',
  'getBookDetailsByIds(',
  'getBookDetailByRowIndex(',
  'getBookDetailsByRowIndexes(',
  'getSeriesInventoryStatus()',
  'getBooksBySeriesKey('
].forEach(call => {
  assert(source.includes(call), `JSONP dispatch calls ${call}`);
});

assert(source.includes('previewIndex: () => []'), 'PWA previewIndex avoids full-index JSONP transfer');
assert(!source.includes('function saveWebAppUserPreferences('), 'server does not expose preference writes to google.script.run');
assert(source.includes('const dataset = getBookshelfLiteDataset_();'), 'bookshelf API uses lightweight dataset cache');
assert(source.includes('max: WEBAPP_API_LIMITS_.SHELF_CHUNK_MAX_LIMIT'), 'bookshelf chunk API applies max limit');
assert(source.includes('max: Math.min(WEBAPP_API_LIMITS_.RANDOM_MAX_COUNT, rows.length)'), 'random API applies max limit');
assert(source.includes('WEBAPP_API_LIMITS_.BOOK_DETAIL_BATCH_MAX'), 'detail batch API applies max limit');
assert(!/params\.c\b/.test(source), 'JSONP route does not use reserved c parameter');
assert(!/params\.sid\b/.test(source), 'JSONP route does not use reserved sid parameter');
assert(/^docs\/\*\*/m.test(claspignore), 'docs are excluded from clasp push');

const serverSandbox = vm.createContext({ console, URL, encodeURIComponent, decodeURIComponent });
vm.runInContext(`${configSource}\n${source}`, serverSandbox, { filename: 'Webアプリ.js' });

const invalidationOrder = vm.runInContext(`(() => {
  const originalBump = bumpLibraryDatasetRevision_;
  const originalClear = clearCachedJson_;
  const events = [];
  bumpLibraryDatasetRevision_ = function() { events.push('bump'); return 'next'; };
  clearCachedJson_ = function(key) { events.push('clear:' + key); };
  try {
    clearLibrarySearchCache_();
    return events;
  } finally {
    bumpLibraryDatasetRevision_ = originalBump;
    clearCachedJson_ = originalClear;
  }
})()`, serverSandbox);
assert(invalidationOrder[0] === 'bump', 'cache invalidation advances revision before removing old cache chunks');

const cacheRaceResult = vm.runInContext(`(() => {
  const originalRevision = getLibraryDatasetRevision_;
  const originalRead = getCachedJson_;
  const originalWrite = putCachedJson_;
  const originalClear = clearCachedJson_;
  const originalLockService = globalThis.LockService;
  let revision = 'revision-1';
  let stored = null;
  let builds = 0;
  let writes = 0;
  let clears = 0;

  getLibraryDatasetRevision_ = function() { return revision; };
  getCachedJson_ = function() { return stored; };
  putCachedJson_ = function(key, value) {
    stored = JSON.parse(JSON.stringify(value));
    writes++;
    if (writes === 1) revision = 'revision-2';
    return true;
  };
  clearCachedJson_ = function() { stored = null; clears++; };
  globalThis.LockService = {
    getScriptLock: function() {
      return { tryLock: function() { return true; }, releaseLock: function() {} };
    }
  };

  try {
    const result = getOrBuildCachedDataset_(
      'race-test',
      function(dataset) { return Boolean(dataset && Array.isArray(dataset.rows)); },
      function() { builds++; return { rows: ['build-' + builds] }; }
    );
    return { result, stored, builds, writes, clears, revision };
  } finally {
    getLibraryDatasetRevision_ = originalRevision;
    getCachedJson_ = originalRead;
    putCachedJson_ = originalWrite;
    clearCachedJson_ = originalClear;
    if (originalLockService === undefined) delete globalThis.LockService;
    else globalThis.LockService = originalLockService;
  }
})()`, serverSandbox);
assert(cacheRaceResult.builds === 2, 'dataset rebuild retries when revision changes during cache write');
assert(cacheRaceResult.clears >= 1, 'a stale post-write cache is removed');
assert(cacheRaceResult.result.datasetRevision === 'revision-2', 'returned dataset is stamped with the stable revision');
assert(cacheRaceResult.stored.datasetRevision === 'revision-2', 'only the stable revision remains cached');
assert(cacheRaceResult.stored.rows[0] === 'build-2', 'stale pre-edit content cannot win the cache race');

const lockTimeoutResult = vm.runInContext(`(() => {
  const originalRevision = getLibraryDatasetRevision_;
  const originalRead = getCachedJson_;
  const originalWrite = putCachedJson_;
  const originalLockService = globalThis.LockService;
  let revisionNumber = 1;
  let writes = 0;
  let builds = 0;

  getLibraryDatasetRevision_ = function() { return 'timeout-' + revisionNumber; };
  getCachedJson_ = function() { return null; };
  putCachedJson_ = function() { writes++; return true; };
  globalThis.LockService = {
    getScriptLock: function() {
      return { tryLock: function() { return false; }, releaseLock: function() {} };
    }
  };

  try {
    const result = getOrBuildCachedDataset_(
      'timeout-test',
      function(dataset) { return Boolean(dataset && Array.isArray(dataset.rows)); },
      function() { builds++; revisionNumber++; return { rows: ['unstable-' + builds] }; }
    );
    return { result, writes, builds, currentRevision: getLibraryDatasetRevision_() };
  } finally {
    getLibraryDatasetRevision_ = originalRevision;
    getCachedJson_ = originalRead;
    putCachedJson_ = originalWrite;
    if (originalLockService === undefined) delete globalThis.LockService;
    else globalThis.LockService = originalLockService;
  }
})()`, serverSandbox);
assert(lockTimeoutResult.builds === 2, 'lock-timeout fallback retries one unstable build');
assert(lockTimeoutResult.writes === 0, 'lock-timeout fallback never writes an unstable snapshot to cache');
assert(
  lockTimeoutResult.result.datasetRevision !== lockTimeoutResult.currentRevision,
  'an unstable lock-timeout response is not mislabeled as the newest revision'
);

assert(
  vm.runInContext("escapeSheetFormulaText_('=IMPORTXML(\"https://example.invalid\")')", serverSandbox) ===
    "'=IMPORTXML(\"https://example.invalid\")",
  'external metadata cannot become a spreadsheet formula'
);
assert(
  vm.runInContext("escapeSheetFormulaText_('通常のあらすじ')", serverSandbox) === '通常のあらすじ',
  'ordinary external metadata remains unchanged'
);
assert(
  mainSynopsisSource.includes('escapeSheetFormulaText_(raw ||'),
  'synopsis writes use the spreadsheet-formula guard'
);
assert(
  fs.readFileSync(path.join(root, 'NewBookImport.js'), 'utf8').includes('escapeSheetFormulaText_(yomi)'),
  'imported yomigana writes use the spreadsheet-formula guard'
);

[
  ['Sket dance 03 (友達がいっぱい)', 3],
  ['都会のトム＆ソーヤ 05-下', 5],
  ['聖☆おにいさん 22 限定版', 22],
  ['デュラララ!! ×03', 3],
  ['月曜日のたわわ その4', 4],
  ['オーバーロード = OVERLOAD. 2(漆黒の戦士)', 2],
  ['Pandora hearts 08.5 official guide', 0],
  ['BEASTARS 1～10巻BOXセット', 0]
].forEach(([title, expected]) => {
  serverSandbox.__volumeTitle = title;
  assert(
    vm.runInContext('extractVolumeNumber(__volumeTitle)', serverSandbox) === expected,
    `volume parser handles ${title}`
  );
});

function makeSeriesFixtureRow(title, isbn) {
  const row = Array(20).fill('');
  row[0] = title;
  row[10] = isbn || '';
  return row;
}

const fixtureRows = [
  makeSeriesFixtureRow('抜けテスト 1'),
  makeSeriesFixtureRow('抜けテスト 2'),
  makeSeriesFixtureRow('抜けテスト 4'),
  makeSeriesFixtureRow('重複テスト 1'),
  makeSeriesFixtureRow('重複テスト 2'),
  makeSeriesFixtureRow('重複テスト 2'),
  makeSeriesFixtureRow('分冊テスト 1'),
  makeSeriesFixtureRow('分冊テスト 2-上'),
  makeSeriesFixtureRow('分冊テスト 2-下'),
  makeSeriesFixtureRow('分冊テスト 3'),
  makeSeriesFixtureRow('派生テスト 1'),
  makeSeriesFixtureRow('派生テスト 2', '9780000000001'),
  makeSeriesFixtureRow('派生テスト ×02', '9780000000001'),
  makeSeriesFixtureRow('派生テスト 3')
];
const fixtureIndex = [
  ['missing', 1, 3, '抜けテスト'],
  ['missing', 2, 3, '抜けテスト'],
  ['missing', 4, 3, '抜けテスト'],
  ['duplicate', 1, 3, '重複テスト'],
  ['duplicate', 2, 3, '重複テスト'],
  ['duplicate', 2, 3, '重複テスト'],
  ['split', 1, 4, '分冊テスト'],
  ['split', 2, 4, '分冊テスト'],
  ['split', 2, 4, '分冊テスト'],
  ['split', 3, 4, '分冊テスト'],
  ['derivative', 1, 4, '派生テスト'],
  ['derivative', 2, 4, '派生テスト'],
  ['derivative', 2, 4, '派生テスト'],
  ['derivative', 3, 4, '派生テスト']
].map(([seriesKeyAuto, volume, seriesCount, seriesSearchTitle]) => ({
  seriesKeyAuto,
  volume,
  seriesCount,
  seriesSearchTitle,
  genreMeta: []
}));

serverSandbox.__seriesFixture = { rows: fixtureRows, index: fixtureIndex };
const fixtureStatus = vm.runInContext('buildSeriesInventoryStatus_(__seriesFixture)', serverSandbox);
assert(fixtureStatus.issueSeriesCount === 2, 'series status reports only actionable missing and duplicate groups');
assert(
  fixtureStatus.issues.some(issue => issue.seriesKeyAuto === 'missing' && issue.missingVolumes.join(',') === '3'),
  'series status reports an internal missing volume'
);
assert(
  fixtureStatus.issues.some(issue =>
    issue.seriesKeyAuto === 'duplicate' &&
    issue.duplicateVolumes.length === 1 &&
    issue.duplicateVolumes[0].volume === 2
  ),
  'series status reports a same-volume duplicate candidate'
);
assert(
  !fixtureStatus.issues.some(issue => issue.seriesKeyAuto === 'split'),
  'series status does not treat upper and lower split volumes as duplicates'
);
assert(
  !fixtureStatus.issues.some(issue => issue.seriesKeyAuto === 'derivative'),
  'series status does not treat a differently titled same-number derivative as a duplicate'
);

const sensitiveSearchIndex = {
  title: 'センシティブ本',
  yomi: 'せんしてぃぶほん',
  author: 'テスト作者',
  searchKey: 'せんしてぃぶほん せんしてぃぶほん てすとさくしゃ',
  publisher: 'テスト出版社',
  releasedYm: 202401,
  genresRaw: ['18禁', '恋愛'],
  genres: { story: [], theme: ['18禁', '恋愛'], mood: [], status: ['単巻'] },
  genreMeta: [
    { name: '18禁', category: 'theme' },
    { name: '恋愛', category: 'theme' }
  ]
};
serverSandbox.__sensitiveSearchIndex = sensitiveSearchIndex;
assert(
  !vm.runInContext(
    "matchesSearchCriteria_(__sensitiveSearchIndex, buildServerSearchCriteria_('', '', '', '', '', '', '恋愛', '', '', '', '', '', ''))",
    serverSandbox
  ),
  'genre search excludes 18禁 books when 18禁 is not explicitly selected'
);
assert(
  !vm.runInContext(
    "matchesSearchCriteria_(__sensitiveSearchIndex, buildServerSearchCriteria_('', '', '', '', '', '', '', '', '単巻', '', '', '', ''))",
    serverSandbox
  ),
  'genre search with another category excludes 18禁 books when 題材=18禁 is not selected'
);
assert(
  !vm.runInContext(
    "matchesSearchCriteria_(__sensitiveSearchIndex, buildServerSearchCriteria_('', '', '', '', '', '18禁', '', '', '', '', '', '', ''))",
    serverSandbox
  ),
  'story field cannot opt into 18禁 books because 18禁 belongs to the theme field'
);
assert(
  vm.runInContext(
    "matchesSearchCriteria_(__sensitiveSearchIndex, buildServerSearchCriteria_('', '', '', '', '', '', '18禁', '', '', '', '', '', ''))",
    serverSandbox
  ),
  'genre search includes 18禁 books when 18禁 is explicitly selected'
);
assert(
  vm.runInContext(
    "matchesSearchCriteria_(__sensitiveSearchIndex, buildServerSearchCriteria_('センシティブ', '', '', '', '', '', '', '', '', '', '', '', ''))",
    serverSandbox
  ),
  'keyword search keeps 18禁 books eligible because genres are not keyword-search fields'
);
const sensitivePreview = vm.runInContext(
  'buildPreviewIndexPayload_({ index: [__sensitiveSearchIndex] })',
  serverSandbox
);
assert(sensitivePreview[0].isSensitive === true, 'preview index carries the sensitive flag');

const stableIdLookup = vm.runInContext(`(() => {
  const idA = '11111111-1111-4111-8111-111111111111';
  const idB = '22222222-2222-4222-8222-222222222222';
  const makeRow = function(title, bookId) {
    const row = Array(20).fill('');
    row[CONFIG.IDX.TITLE] = title;
    row[CONFIG.IDX.BOOK_UUID] = bookId;
    return row;
  };
  const rows = [makeRow('並べ替え後の本B', idB), makeRow('並べ替え後の本A', idA)];
  const index = [{ genreMeta: [] }, { genreMeta: [] }];
  const originalGetLibraryDataset = getLibraryDataset_;
  getLibraryDataset_ = function() { return { rows, index, datasetRevision: 'stable-id-test' }; };
  try {
    return {
      single: getBookDetailById(idA),
      batch: getBookDetailsByIds(idA + ',' + idB),
      legacy: getBookDetailByRowIndex(0)
    };
  } finally {
    getLibraryDataset_ = originalGetLibraryDataset;
  }
})()`, serverSandbox);
assert(stableIdLookup.single.title === '並べ替え後の本A', 'stable ID lookup survives row reordering');
assert(stableIdLookup.single.rowIndex === 1, 'stable ID detail still reports the current compatibility row index');
assert(stableIdLookup.single.bookId === '11111111-1111-4111-8111-111111111111', 'detail payload preserves stable book ID');
assert(
  stableIdLookup.batch.map(book => book.bookId).join(',') ===
    '11111111-1111-4111-8111-111111111111,22222222-2222-4222-8222-222222222222',
  'stable ID batch lookup preserves requested identity order'
);
assert(stableIdLookup.legacy.title === '並べ替え後の本B', 'legacy row-index detail API remains compatible');

const uuidSequence = [
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
];
const uuidSandbox = vm.createContext({
  console,
  Utilities: { getUuid: () => uuidSequence.shift() }
});
vm.runInContext(`${configSource}\n${sheetCodeSource}`, uuidSandbox, { filename: 'コード.js' });
uuidSandbox.__uuidTitles = [['既存'], ['複製'], ['不正'], ['新規']];
uuidSandbox.__uuidValues = [
  ['11111111-1111-4111-8111-111111111111'],
  ['11111111-1111-4111-8111-111111111111'],
  ['not-a-uuid'],
  ['']
];
const uuidRepair = vm.runInContext(
  'buildBookUuidRepairPlan_(__uuidTitles, __uuidValues)',
  uuidSandbox
);
assert(uuidRepair.changed === 3, 'UUID backfill creates missing IDs and repairs invalid or duplicated IDs');
assert(uuidRepair.repairedDuplicates === 1, 'UUID backfill keeps the first duplicate and repairs later copies');
assert(uuidRepair.repairedInvalid === 1, 'UUID backfill repairs malformed IDs');
assert(uuidRepair.created === 1, 'UUID backfill creates IDs only for blank titled rows');
assert(new Set(uuidRepair.values.map(row => row[0])).size === 4, 'UUID backfill produces unique IDs');
uuidSandbox.__uuidRepairedValues = uuidRepair.values;
const uuidIdempotent = vm.runInContext(
  'buildBookUuidRepairPlan_(__uuidTitles, __uuidRepairedValues)',
  uuidSandbox
);
assert(uuidIdempotent.changed === 0, 'UUID backfill is idempotent once every record is valid and unique');
uuidSandbox.__copiedUuidTitles = [['元の本'], ['コピーした本']];
uuidSandbox.__copiedUuidValues = [
  ['22222222-2222-4222-8222-222222222222'],
  ['22222222-2222-4222-8222-222222222222']
];
const copiedUuidRepair = vm.runInContext(
  'buildBookUuidRepairPlan_(__copiedUuidTitles, __copiedUuidValues, [1])',
  uuidSandbox
);
assert(
  copiedUuidRepair.values[0][0] === '22222222-2222-4222-8222-222222222222' &&
  copiedUuidRepair.values[1][0] !== copiedUuidRepair.values[0][0],
  'editing a copied row preserves the original ID and allocates a new ID to the copy'
);

const compactSearchResult = vm.runInContext(`(() => {
  const rows = [];
  const index = [];
  for (let i = 0; i < 81; i++) {
    const row = Array(40).fill('');
    row[CONFIG.IDX.TITLE] = '大量検索テスト ' + i;
    row[CONFIG.IDX.SUMMARY] = '遅延取得するあらすじ ' + i;
    rows.push(row);
    index.push({
      title: normalizeKana(row[CONFIG.IDX.TITLE]),
      yomi: '',
      author: '',
      searchKey: normalizeKana(row[CONFIG.IDX.TITLE]),
      genres: {},
      genreMeta: []
    });
  }
  const originalGetLibraryDataset = getLibraryDataset_;
  getLibraryDataset_ = function() { return { rows, index }; };
  try {
    return searchBooksSimple('大量検索テスト');
  } finally {
    getLibraryDataset_ = originalGetLibraryDataset;
  }
})()`, serverSandbox);
assert(compactSearchResult.length === 81, 'large simple search preserves every match');
assert(
  compactSearchResult.every((book, rowIndex) =>
    book.detailLoaded === false &&
    book.rowIndex === rowIndex &&
    !Object.prototype.hasOwnProperty.call(book, 'summary')
  ),
  'large simple search keeps source row indexes and marks omitted details as deferred'
);

console.log('server api checks ok');
