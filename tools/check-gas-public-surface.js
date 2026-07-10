const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');

// GAS HTML Service exposes every top-level function that does not end in `_`
// through google.script.run. Keep this list deliberately small and review any
// addition as a public API change.
const ALLOWED_PUBLIC_GAS_FUNCTIONS = new Set([
  // Simple trigger. It is invoked by Sheets, not by the anonymous web UI.
  'onEdit',

  // Public read-only GAS HTML / JSONP APIs.
  'doGet',
  'getInitialSearchData',
  'getAdvancedSearchOptions',
  'getPreviewIndex',
  'countPreviewMatchesAuthoritative',
  'searchBooks',
  'searchBooksSimple',
  'getRandomBooks',
  'searchBooksAdvanced',
  'getSuggestData',
  'getAllBooks',
  'getBookshelfBooks',
  'getBookshelfBooksChunk',
  'getBookDetailByRowIndex',
  'getBookDetailsByRowIndexes',
  'getBooksBySeriesKey',

  // Shared pure/read helpers. They cannot modify Sheets or call external APIs.
  'normalizeKana',
  'hiraToKana',
  'toHiragana',
  'extractVolumeNumber',
  'getSheet',
  'getLastDataRow',
  'generateSeriesKeyAuto'
]);

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const sourceFiles = fs.readdirSync(root)
  .filter(name => name.endsWith('.js'));
const publicFunctions = [];

sourceFiles.forEach(fileName => {
  const source = fs.readFileSync(path.join(root, fileName), 'utf8');
  const functionPattern = /^function\s+([A-Za-z_$][\w$]*)\s*\(/gm;
  let match;

  while ((match = functionPattern.exec(source))) {
    const name = match[1];
    if (!name.endsWith('_')) {
      publicFunctions.push(`${fileName}:${name}`);
      assert(
        ALLOWED_PUBLIC_GAS_FUNCTIONS.has(name),
        `Unexpected public GAS function: ${fileName}:${name}. Add a trailing _ or explicitly review and allowlist it.`
      );
    }
  }
});

assert(publicFunctions.some(entry => entry.endsWith(':doGet')), 'doGet remains the web entrypoint');
assert(
  !publicFunctions.some(entry => /:(?:debug|dbg|batch|retry|clear|reset|set|fill|enrich|convert)/i.test(entry)),
  'Maintenance, write, and debug functions must not be public GAS functions'
);

console.log('GAS public-surface checks ok');
