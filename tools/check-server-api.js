const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'Webアプリ.js'), 'utf8');
const configSource = fs.readFileSync(path.join(root, 'config.js'), 'utf8');
const mainSynopsisSource = fs.readFileSync(path.join(root, 'あらすじ取得_Main.js'), 'utf8');
const koboSynopsisSource = fs.readFileSync(path.join(root, 'あらすじ取得_kobo.js'), 'utf8');
const sheetCodeSource = fs.readFileSync(path.join(root, 'コード.js'), 'utf8');
const claspignore = fs.readFileSync(path.join(root, '.claspignore'), 'utf8');

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

assert(/function\s+doGet\s*\(\s*e\s*\)/.test(source), 'doGet accepts event parameter');
assert(source.includes("String(params.api || '').trim()"), 'doGet routes by api parameter');
assert(source.includes('HtmlService.createTemplateFromFile'), 'doGet preserves HTML fallback');
assert(source.includes('ContentService.MimeType.JAVASCRIPT'), 'JSONP uses JavaScript mime type');
assert(source.includes('WEBAPP_JSONP_CALLBACK_PATTERN_'), 'JSONP validates callback names');
assert(source.includes('stringifyForJsonp_'), 'JSONP escapes script-sensitive separators');
assert(source.includes('decodeWebAppJsonpParams_'), 'JSONP decodes Base64URL parameters');
assert(source.includes('Utilities.base64DecodeWebSafe'), 'JSONP uses web-safe Base64 decoding');
assert(source.includes('PUBLIC_WEBAPP_JSONP_API_HANDLERS_'), 'JSONP uses an explicit public API whitelist');
assert(source.includes('buildQuickBrowseCountsPayload_'), 'PWA initial data includes quick browse counts');
assert(source.includes('SHELF_DATASET_KEY'), 'server defines a separate bookshelf dataset cache key');
assert(source.includes('getBookshelfLiteDataset_'), 'server has a lightweight bookshelf dataset path');
assert(source.includes('buildBookshelfLiteDataset_'), 'server can build bookshelf data without full search index');
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
assert(source.includes('datasetRevision: getLibraryDatasetRevision_()'), 'initial API responses include the dataset revision');
assert(source.includes('bumpLibraryDatasetRevision_'), 'cache invalidation advances the dataset revision');
assert(mainSynopsisSource.includes('if (result.processed > 0)') && mainSynopsisSource.includes('clearLibrarySearchCache_();'), 'synopsis batches invalidate cache once after updates');
assert(koboSynopsisSource.includes('if (result.processed > 0)') && koboSynopsisSource.includes('clearLibrarySearchCache_();'), 'Kobo retry batches invalidate cache once after updates');
assert(sheetCodeSource.includes('const changed = output.some') && sheetCodeSource.includes('clearLibrarySearchCache_();'), 'series-key batch invalidates cache only after actual changes');

[
  'initial',
  'suggest',
  'advancedOptions',
  'previewIndex',
  'countPreview',
  'searchSimple',
  'searchAdvanced',
  'random',
  'shelf',
  'shelfChunk',
  'bookDetail',
  'bookDetails',
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
  'getSuggestData()',
  'getAdvancedSearchOptions()',
  'countPreviewMatchesAuthoritative(',
  'searchBooksSimple(',
  'searchBooksAdvanced(',
  'getRandomBooks(',
  'getBookshelfBooks()',
  'getBookshelfBooksChunk(',
  'getBookDetailByRowIndex(',
  'getBookDetailsByRowIndexes(',
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

console.log('server api checks ok');
