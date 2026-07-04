const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'Webアプリ.js'), 'utf8');
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
  'series'
].forEach(apiName => {
  assert(source.includes(`case '${apiName}':`), `JSONP API includes ${apiName}`);
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
  'getBooksBySeriesKey('
].forEach(call => {
  assert(source.includes(call), `JSONP dispatch calls ${call}`);
});

assert(source.includes("case 'previewIndex':\n      return [];"), 'PWA previewIndex avoids full-index JSONP transfer');
assert(!/params\.c\b/.test(source), 'JSONP route does not use reserved c parameter');
assert(!/params\.sid\b/.test(source), 'JSONP route does not use reserved sid parameter');
assert(/^docs\/\*\*/m.test(claspignore), 'docs are excluded from clasp push');

console.log('server api checks ok');
