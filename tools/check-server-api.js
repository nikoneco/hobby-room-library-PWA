const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'Webアプリ.js'), 'utf8');
const configSource = fs.readFileSync(path.join(root, 'config.js'), 'utf8');
const mainSynopsisSource = fs.readFileSync(path.join(root, 'あらすじ取得_Main.js'), 'utf8');
const koboSynopsisSource = fs.readFileSync(path.join(root, 'あらすじ取得_kobo.js'), 'utf8');
const sheetCodeSource = fs.readFileSync(path.join(root, 'コード.js'), 'utf8');
const seriesRegistrySource = fs.readFileSync(path.join(root, 'SeriesRegistry.js'), 'utf8');
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
assert(configSource.includes("LIBRARY_DATASET_KEY: 'library_dataset_v27'"), 'library cache key invalidates pre-media datasets');
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
assert(source.includes('const LOCAL_LIBRARY_INDEX_VERSION_ = 6'), 'server publishes the media-aware local-index schema');
assert(source.includes("'releasedYm', 'story', 'theme', 'mood', 'status', 'media'"), 'local index appends media without shifting existing columns');
assert((source.match(/params\.detailMedia/g) || []).length >= 2, 'JSONP preview and advanced search forward detailMedia');
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
assert(configSource.includes("DIRTY_PROPERTY: 'series_key_auto_dirty_v1'"), 'series-key repair records an interrupted derived refresh');
assert(
  sheetCodeSource.includes('function loadSeriesRegistryExtraLookup_') &&
    sheetCodeSource.includes('return buildSeriesRegistryExtraLookup_(registry);'),
  'series-key repair reads classifications exclusively from the v2 registry'
);
assert(!configSource.includes("SERIES_MASTER: 'series_master'"), 'legacy series_master is retired from sheet configuration');
assert(
  /function\s+writeSeriesKeyAutoRepairPlan_\s*\([^)]*\)[\s\S]*?if\s*\(!changedIndices\.length\)\s*return updatedRanges;/.test(sheetCodeSource),
  'series-key repair performs no sheet write when every key is already current'
);
assert(
  /function\s+fillSeriesKeyAutoAll_\s*\([^)]*\)[\s\S]*?if\s*\(series\.changed\s*>\s*0\s*\|\|[\s\S]*?clearLibrarySearchCache_\(\);/.test(sheetCodeSource),
  'manual series-key repair invalidates caches only after an actual series or UUID change'
);
assert(
  newBookImportSource.includes('syncSeriesRegistryFromCatalog_()') &&
    newBookImportSource.includes('refreshSeriesKeyAutoAfterDerivedChange_(targetSheet)'),
  'new-book enrichment converges series keys and the stable registry together'
);
assert(seriesRegistrySource.includes("MASTER_SHEET: 'series_master_v2'"), 'series registry uses a separate migration-safe master sheet');
assert(seriesRegistrySource.includes("ALIAS_SHEET: 'series_alias_v2'"), 'series registry stores title variants independently from genres');
assert(seriesRegistrySource.includes('function linkSeriesKeyAfterTitleEdit_'), 'title corrections preserve the prior stable series identity');
assert(
  seriesRegistrySource.includes("reason || 'TITLE_EDIT_CONFLICT'") &&
    seriesRegistrySource.includes('setValue(oldKey)'),
  'title-edit conflicts are reviewed and keep the prior stable series key'
);
assert(
  seriesRegistrySource.includes("source: 'TITLE_EDIT_SIGNATURE'"),
  'unique normalized title variants are persisted as exact aliases'
);

const onEditSource = sheetCodeSource.slice(
  sheetCodeSource.indexOf('function onEdit(e)'),
  sheetCodeSource.indexOf('function createUniqueBookUuid_')
);
assert(
  onEditSource.lastIndexOf('clearLibrarySearchCache_();') > onEditSource.indexOf('updateSeriesKeyAutoForEditedRange_'),
  'onEdit invalidates cache after derived series-key updates'
);
assert(
  onEditSource.lastIndexOf('clearLibrarySearchCache_();') > onEditSource.indexOf('refreshSeriesKeyAutoAfterDerivedChange_'),
  'series-master and W-column edits repair every derived series key before cache invalidation'
);
assert(!onEditSource.includes('SERIES_MASTER'), 'onEdit no longer depends on the retired series_master sheet');
assert(
  onEditSource.indexOf('if (seriesKeyRefreshError) throw seriesKeyRefreshError;') >
    onEditSource.lastIndexOf('clearLibrarySearchCache_();'),
  'a failed series-key repair still invalidates the stale search cache before surfacing the error'
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
  onEditSource.includes('seriesRegistryActive && touchesMainSeriesKey') &&
    onEditSource.includes('syncSeriesRegistryAfterManualKeyEdit_('),
  'manual series-key edits synchronize the stable V2 registry'
);
assert(
  seriesRegistrySource.includes('function refreshSeriesRegistryUsageCountsFromCatalog_') &&
    seriesRegistrySource.includes('masterCountsChanged') &&
    seriesRegistrySource.includes('aliasCountsChanged'),
  'series registry synchronization refreshes master and alias usage counts from catalog X'
);
assert(
  seriesRegistrySource.includes('function syncSeriesRegistryAfterManualKeyEdit_') &&
    seriesRegistrySource.includes("'MANUAL_X_MERGE'") &&
    seriesRegistrySource.includes("setValue('MERGED')"),
  'manual series-key overrides persist the generated key as an alias and retain merged master history'
);
assert(
  /function\s+enrichNewBooksAfterImportByLimit_\s*\([^)]*\)[\s\S]*?SpreadsheetApp\.flush\(\);[\s\S]*?clearLibrarySearchCache_\(\);/.test(newBookImportSource),
  'new-book enrichment flushes sheet writes before invalidating caches'
);
assert(
  /function\s+enrichNewBooksAfterImport\s*\(\)\s*{[\s\S]*?SpreadsheetApp\.getUi\(\)[\s\S]*?ui\.ButtonSet\.OK_CANCEL[\s\S]*?response\s*!==\s*ui\.Button\.OK[\s\S]*?return enrichNewBooksAfterImport_\(\);/.test(newBookImportSource),
  'the spreadsheet drawing entrypoint requires explicit Sheets UI confirmation before enrichment'
);
assert(
  newBookImportSource.includes('const synopsisKobo = retryNotFoundSynopsisFromRakutenKobo_();'),
  'new-book enrichment runs the standard Kobo rescue batch for all pending NOT_FOUND synopsis rows'
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
vm.runInContext(`${configSource}\n${seriesRegistrySource}\n${source}`, serverSandbox, { filename: 'Webアプリ.js' });

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
  genres: { story: [], theme: ['18禁', '恋愛'], mood: [], status: ['単巻'], media: ['漫画'] },
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
    "matchesSearchCriteria_(__sensitiveSearchIndex, buildServerSearchCriteria_('', '', '', '', '', '', '', '', '', '', '', '', '', '漫画'))",
    serverSandbox
  ),
  'media-only search excludes 18禁 books unless 題材=18禁 is selected'
);
assert(
  vm.runInContext(
    "matchesSearchCriteria_(__sensitiveSearchIndex, buildServerSearchCriteria_('', '', '', '', '', '', '18禁', '', '', '', '', '', '', '漫画'))",
    serverSandbox
  ),
  'media search includes 18禁 books when 題材=18禁 is explicit'
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

serverSandbox.__seriesMediaIndex = {
  title: '混在シリーズ', yomi: '', author: '', searchKey: '混在シリーズ', publisher: '', releasedYm: 0,
  genres: { story: [], theme: [], mood: [], status: [], media: ['漫画', '小説'] }
};
assert(
  vm.runInContext(
    "matchesSearchCriteria_(__seriesMediaIndex, buildServerSearchCriteria_('', '', '', '', '', '', '', '', '', '', '', '', '', '漫画')) && " +
    "matchesSearchCriteria_(__seriesMediaIndex, buildServerSearchCriteria_('', '', '', '', '', '', '', '', '', '', '', '', '', '小説'))",
    serverSandbox
  ),
  'server media search matches either series-level media slot'
);
assert(
  !vm.runInContext(
    "matchesSearchCriteria_(__seriesMediaIndex, buildServerSearchCriteria_('', '', '', '', '', '', '', '', '', '', '', '', '', '絵本'))",
    serverSandbox
  ),
  'server media search rejects a nonmatching medium'
);

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
vm.runInContext(`${configSource}\n${seriesRegistrySource}\n${sheetCodeSource}`, uuidSandbox, { filename: 'コード.js' });
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

uuidSandbox.__registryCatalogRows = [
  { title: '作品名 1', author: '作者', publisher: '出版社', genreText: '日常, 学園, 連載中, 漫画, 小説', rawKey: '作品名' },
  { title: '作品名 2', author: '作者', publisher: '出版社', genreText: '日常, 学園, 連載中, 漫画, 小説', rawKey: '作品名' },
  { title: '資料作品', author: '作者', publisher: '出版社', genreText: '写真集/画集/資料集, 単巻', rawKey: '__extra__資料作品' }
];
uuidSandbox.__registryGenreRows = [
  ['日常', 'ストーリー'],
  ['学園', '題材'],
  ['連載中', '状況'],
  ['単巻', '状況'],
  ['漫画', '媒体'],
  ['小説', '媒体']
];
uuidSandbox.__registryIds = ['series-a', 'series-b'];
const registryPlan = vm.runInContext(`buildSeriesRegistryMigrationPlan_(
  __registryCatalogRows,
  __registryGenreRows,
  () => __registryIds.shift(),
  '2026-08-20T00:00:00.000Z'
)`, uuidSandbox);
assert(registryPlan.seriesCount === 2, 'series registry migration groups books by the X-column key');
assert(registryPlan.aliasCount === 3, 'extra series retain both prefixed and base aliases');
assert(registryPlan.conflicts.length === 0, 'compatible catalog genres migrate without conflicts');
assert(
  registryPlan.masterRows.some(row => row[1] === '作品名' && row[10] === '作品名'),
  'series registry keeps a readable display name separate from the machine key'
);
assert(
  registryPlan.masterRows.some(row => row[2] === '日常' && row[3] === '学園' && row[6] === '連載中'),
  'series registry migration reconstructs genre slots from genre_master categories'
);
assert(
  registryPlan.masterRows.some(row => row[11] === '写真集/画集/資料集'),
  'legacy extra-book classification migrates to the appended media slots'
);
assert(
  registryPlan.masterRows.some(row => row[11] === '漫画' && row[12] === '小説'),
  'series registry migration keeps up to two series-level media values'
);
assert(
  registryPlan.masterRows.every(row => row[10]) && registryPlan.masterRows.every(row => row.length === 13),
  'media columns are appended after the stable A:K master schema'
);
const mediaCompatibility = vm.runInContext(`({
  asciiLegacy: isSeriesRegistryExtraClassification_([], ['写真集/画集/資料集']),
  fullwidthLegacy: isSeriesRegistryExtraClassification_([], ['写真集／画集／資料集']),
  photo: isSeriesRegistryExtraClassification_([], ['写真集']),
  art: isSeriesRegistryExtraClassification_([], ['画集']),
  reference: isSeriesRegistryExtraClassification_([], ['資料集']),
  novel: isSeriesRegistryExtraClassification_([], ['小説']),
  mixed: isSeriesRegistryExtraClassification_([], ['漫画', '画集']),
  prefixedMixed: isSeriesRegistryExtraClassification_([], ['漫画', '画集'], '__extra__作品'),
  legacyGenre: isSeriesRegistryExtraClassification_(['写真集／画集／資料集'], ['漫画']),
  legacyRowLength: buildSeriesRegistryMasterRow_(
    'legacy', '旧行', ['', '', '', '', ''], 1, 'ACTIVE', 'now', 'legacy', ['漫画', ''], 11
  ).length
})`, uuidSandbox);
assert(
  mediaCompatibility.asciiLegacy && mediaCompatibility.fullwidthLegacy &&
    mediaCompatibility.photo && mediaCompatibility.art && mediaCompatibility.reference,
  'extra classification accepts individual media and both legacy slash spellings'
);
assert(!mediaCompatibility.novel, 'ordinary media does not become an extra series');
assert(!mediaCompatibility.mixed, 'a manga and art-book mixed series does not become an extra series');
assert(
  mediaCompatibility.prefixedMixed && mediaCompatibility.legacyGenre,
  'an explicit extra prefix or legacy extra genre keeps priority during migration'
);
assert(mediaCompatibility.legacyRowLength === 11, 'legacy A:K master writes remain backward compatible'
);
const masterHeaderCompatibility = vm.runInContext(`(() => {
  const makeSheet = headers => ({
    getMaxColumns: () => headers.length,
    getRange: (_row, _column, _rows, columns) => ({
      getDisplayValues: () => [headers.slice(0, columns)]
    })
  });
  const legacy = SERIES_REGISTRY_CONFIG_.LEGACY_MASTER_HEADERS.slice();
  const current = SERIES_REGISTRY_CONFIG_.MASTER_HEADERS.slice();
  let partialRejected = false;
  try {
    getSeriesRegistryMasterColumnCount_(makeSheet(legacy.concat(['J-媒体1', '誤り'])));
  } catch (_error) {
    partialRejected = true;
  }
  const prefixedResolution = resolveSeriesRegistryKey_('__extra__混在', {
    masterById: new Map([['mixed', {
      seriesId: 'mixed', canonicalKey: '混在', displayName: '混在',
      genres: ['', '', '', '', ''], media: ['漫画', '画集'], isExtra: false
    }]]),
    aliasByKey: new Map([['__extra__混在', { seriesId: 'mixed' }]]),
    uniqueSeriesIdBySignature: new Map()
  });
  return {
    legacyColumns: getSeriesRegistryMasterColumnCount_(makeSheet(legacy)),
    currentColumns: getSeriesRegistryMasterColumnCount_(makeSheet(current)),
    partialRejected,
    prefixedIsExtra: prefixedResolution.isExtra
  };
})()`, uuidSandbox);
assert(
  masterHeaderCompatibility.legacyColumns === 11 && masterHeaderCompatibility.currentColumns === 13,
  'series master accepts both pre-media and media-aware complete headers'
);
assert(masterHeaderCompatibility.partialRejected, 'series master rejects a partial or misspelled media header');
assert(masterHeaderCompatibility.prefixedIsExtra, 'an explicit alias prefix wins during resolution');
const signaturePair = vm.runInContext(`[
  buildSeriesAliasSignature_('【作品名】'),
  buildSeriesAliasSignature_('作品名')
]`, uuidSandbox);
assert(signaturePair[0] === signaturePair[1], 'punctuation-only series-name variants share one safe signature');
const readableSeriesName = vm.runInContext(
  "buildSeriesRegistryDisplayName_('キノの旅 : the Beautiful World 2', 'きのの旅 : the beautiful world')",
  uuidSandbox
);
assert(
  readableSeriesName === 'キノの旅 : the Beautiful World',
  'series display names preserve katakana and title casing while removing volume numbers'
);
const titleCorrectionPlan = vm.runInContext(`buildSeriesTitleEditLinkPlan_(
  '誤字しりーず',
  '誤字シリーズ',
  { seriesId: 'stable-series' },
  null
)`, uuidSandbox);
assert(
  titleCorrectionPlan.action === 'LINK_TO_OLD' && titleCorrectionPlan.seriesId === 'stable-series',
  'correcting a title keeps the old stable series identity through a new alias'
);
const titleConflictPlan = vm.runInContext(`buildSeriesTitleEditLinkPlan_(
  '旧シリーズ',
  '別シリーズ',
  { seriesId: 'series-old' },
  { seriesId: 'series-other' }
)`, uuidSandbox);
assert(titleConflictPlan.action === 'CONFLICT', 'title edits never silently merge two established series identities');

const seriesKeyFixture = vm.runInContext(`(() => {
  const registry = {
    masterById: new Map([
      ['normal', { isExtra: false }],
      ['extra', { isExtra: true }]
    ]),
    aliasByKey: new Map([
      ['通常作品', { seriesId: 'normal' }],
      ['資料作品', { seriesId: 'extra' }]
    ])
  };
  const titles = [
    ['通常作品 1'],
    ['資料作品 1'],
    ['資料作品 2'],
    ['通常作品 2']
  ];
  const staleGenres = [['青春'], ['青春'], ['青春'], ['写真集/画集/資料集']];
  const lookup = buildSeriesRegistryExtraLookup_(registry);
  const expected = titles.map(row => [
    lookup.get(extractSeriesLookupKeyFromTitle_(row[0])) === true
      ? generateExtraSeriesKey_(row[0])
      : generateSeriesKeyAuto(row[0])
  ]);
  const current = expected.map(row => row.slice());
  current[1][0] = generateSeriesKeyAuto(titles[1][0]);
  const plan = buildSeriesKeyAutoRepairPlan_(titles, staleGenres, current, lookup);

  registry.masterById.get('normal').isExtra = true;
  registry.masterById.get('extra').isExtra = false;
  const flippedLookup = buildSeriesRegistryExtraLookup_(registry);
  const flippedPlan = buildSeriesKeyAutoRepairPlan_(titles, staleGenres, plan.values, flippedLookup);
  const idempotentPlan = buildSeriesKeyAutoRepairPlan_(titles, staleGenres, flippedPlan.values, flippedLookup);
  const genreFallbackPlan = buildSeriesKeyAutoRepairPlan_(
    [['資料単巻 1'], ['通常単巻 1']],
    [['写真集/画集/資料集'], ['青春']],
    [[''], ['']]
  );
  const normalizedRegistry = {
    masterById: new Map([['extra', { isExtra: true }]]),
    aliasByKey: new Map([[normalizeSeriesAliasKey_('  資料作品　'), { seriesId: 'extra' }]])
  };
  const normalizedLookup = buildSeriesRegistryExtraLookup_(normalizedRegistry);

  return {
    plan,
    flippedPlan,
    idempotentPlan,
    genreFallbackPlan,
    normalizedLookupMatches:
      normalizedLookup.get(extractSeriesLookupKeyFromTitle_('\t資料作品　 10')) === true
  };
})()`, uuidSandbox);
assert(seriesKeyFixture.plan.changed === 1, 'series-key repair changes only a stale row');
assert(seriesKeyFixture.plan.changedIndices[0] === 1, 'v2 registry classification wins over a temporarily stale W value');
assert(
  /^__extra__/.test(seriesKeyFixture.plan.values[1][0]) &&
    /^__extra__/.test(seriesKeyFixture.plan.values[2][0]),
  'photo, art, and reference books remain separated from their normal series'
);
assert(!/^__extra__/.test(seriesKeyFixture.plan.values[3][0]), 'v2 registry classification overrides a stale row genre');
assert(
  /^__extra__/.test(seriesKeyFixture.flippedPlan.values[0][0]) &&
    !/^__extra__/.test(seriesKeyFixture.flippedPlan.values[1][0]),
  'v2 registry changes converge in both normal-to-extra and extra-to-normal directions'
);
assert(seriesKeyFixture.idempotentPlan.changed === 0, 'series-key repair is idempotent after convergence');
assert(
  /^__extra__/.test(seriesKeyFixture.genreFallbackPlan.values[0][0]) &&
    !/^__extra__/.test(seriesKeyFixture.genreFallbackPlan.values[1][0]),
  'the pure repair plan retains W-column genre fallback behavior when no master lookup is supplied'
);
assert(seriesKeyFixture.normalizedLookupMatches, 'v2 registry lookup normalizes fullwidth and repeated whitespace like the W formula');

const seriesKeyWrites = [];
uuidSandbox.__seriesKeyWriteSheet = {
  getRange(row, column, rowCount, columnCount) {
    return {
      setValues(values) {
        seriesKeyWrites.push({ row, column, rowCount, columnCount, values });
      }
    };
  }
};
uuidSandbox.__seriesKeyWritePlan = {
  changedIndices: [1, 2, 4],
  values: [['a'], ['b'], ['c'], ['d'], ['e']]
};
vm.runInContext(
  'writeSeriesKeyAutoRepairPlan_(__seriesKeyWriteSheet, 2, __seriesKeyWritePlan)',
  uuidSandbox
);
assert(seriesKeyWrites.length === 2, 'series-key writes coalesce adjacent changed rows without rewriting the full column');
assert(
  seriesKeyWrites[0].row === 3 && seriesKeyWrites[0].rowCount === 2 &&
    seriesKeyWrites[1].row === 6 && seriesKeyWrites[1].rowCount === 1,
  'series-key changed-row ranges preserve their original sheet positions'
);
uuidSandbox.__seriesKeyNoChangePlan = { changedIndices: [], values: [['a']] };
vm.runInContext(
  'writeSeriesKeyAutoRepairPlan_(__seriesKeyWriteSheet, 2, __seriesKeyNoChangePlan)',
  uuidSandbox
);
assert(seriesKeyWrites.length === 2, 'an unchanged series-key audit performs zero writes');

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

// An unavailable catalogue is an error, never a successful zero-book search.
const uiServer = vm.createContext({ console: { error() {}, warn() {}, log() {} } });
vm.runInContext(configSource + '\n' + seriesRegistrySource + '\n' + source, uiServer);
vm.runInContext(`getLibraryDataset_ = function(){ throw new Error('catalogue unavailable'); }; getBookshelfLiteDataset_ = getLibraryDataset_;`, uiServer);
['searchBooksSimple', 'searchBooksAdvanced', 'getRandomBooks', 'getBookshelfBooks'].forEach(name => {
  let failed = false;
  try { uiServer[name]('book'); } catch (error) { failed = error.message === 'catalogue unavailable'; }
  assert(failed, name + ' propagates acquisition errors');
});
const hintSheet = raw => ({
  getParent: () => ({ getSheetByName: () => ({ getRange: () => ({ getDisplayValue: () => raw }) }) }),
  getMaxRows: () => 1000, getLastRow: () => 20,
  getRange: row => ({ getDisplayValue: () => row === 20 ? 'Last real book' : '' })
});
['', ' ', 'not a number', '0', '1'].forEach(raw => assert(uiServer.getMainLastDataRowHintForWebApp_(hintSheet(raw)) === null, 'invalid or empty hint falls back: ' + raw));
assert(uiServer.getMainLastDataRowHintForWebApp_(hintSheet('20')) === 20, 'validated last-row hint remains usable');
const uiBrowseCounts = uiServer.buildQuickBrowseCountsPayload_({ index: [{ genres: { media: ['漫画'] }, isSensitive: false }, { genres: { media: ['漫画'] }, isSensitive: true }] });
assert(uiBrowseCounts.media['漫画'] === 1, 'browse count uses the same sensitive exclusion as genre search');

console.log('server api checks ok');
