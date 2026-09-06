const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');

// GAS HTML Service exposes every top-level function that does not end in `_`
// through google.script.run. Keep this list deliberately small and review any
// addition as a public API change.
const ALLOWED_PUBLIC_GAS_FUNCTIONS = new Set([
  // Simple trigger. It is invoked by Sheets, not by the anonymous web UI.
  'onEdit',
  // Menu registration only; SpreadsheetApp.getUi() requires the bound Sheets UI.
  'onOpen',

  // Spreadsheet drawing callback. A Sheets UI confirmation is required before
  // it delegates to the private write function, so anonymous web calls stop.
  'enrichNewBooksAfterImport',

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
  'getBookDetailById',
  'getBookDetailsByIds',
  'getSeriesInventoryStatus',
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

const ALLOWED_SPREADSHEET_UI_WRITE_FUNCTIONS = new Set([
  'enrichNewBooksAfterImport'
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
  !publicFunctions.some(entry => {
    const name = entry.slice(entry.lastIndexOf(':') + 1);
    return /^(?:debug|dbg|batch|retry|clear|reset|set|fill|enrich|convert)/i.test(name) &&
      !ALLOWED_SPREADSHEET_UI_WRITE_FUNCTIONS.has(name);
  }),
  'Maintenance, write, and debug functions must not be public GAS functions'
);

console.log('GAS public-surface checks ok');
