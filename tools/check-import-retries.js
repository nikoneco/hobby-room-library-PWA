const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// Exercise the real import, HTTP parsing, retry and sheet-write functions.
// Only Apps Script services and unrelated sheet setup are replaced; no live I/O.
const root = path.resolve(__dirname, '..');
const files = ['config.js', 'あらすじ取得_Main.js', 'あらすじ取得_kobo.js', 'NewBookImport.js'];
const source = files.map(file => fs.readFileSync(path.join(root, file), 'utf8')).join('\n');
const isbn = '9784098501809';
const ok = body => ({ status: 200, body: JSON.stringify(body) });
const empty = ok({ Items: [] });
const kana = ok({ Items: [{ Item: { isbn, titleKana: 'テスト ノ ホン' } }] });

function fixture(books, options = {}) {
  const state = { requests: [], writes: [], sleeps: [], toasts: [], logs: [], response: empty };
  const properties = options.properties || new Map();
  const context = vm.createContext({
    console: Object.fromEntries(['log', 'warn', 'error'].map(key => [key, (...args) => state.logs.push(args)])),
    PropertiesService: { getScriptProperties: () => ({
      getProperty: key => properties.get(key) ?? null,
      setProperty: (key, value) => properties.set(key, value)
    }) },
    Utilities: { sleep: ms => state.sleeps.push(ms) },
    SpreadsheetApp: { flush() {}, getActive: () => ({ toast: text => state.toasts.push(text) }) },
    UrlFetchApp: { fetch(url) {
      state.requests.push(url);
      const response = typeof state.response === 'function' ? state.response(url) : state.response;
      if (response instanceof Error) throw response;
      return { getResponseCode: () => response.status, getContentText: () => response.body };
    } }
  });
  vm.runInContext(source, context);
  const col = vm.runInContext('CONFIG.COL', context);
  const rows = books.map(book => {
    const row = Array(col.MAX).fill('');
    for (const [key, value] of Object.entries(book)) row[col[key] - 1] = value;
    return row;
  });
  const sheet = {
    getParent: () => ({ getId: () => options.spreadsheetId || 'fixture-spreadsheet' }),
    getSheetId: () => options.sheetId || 123,
    getRange(row, column, height = 1, width = 1) {
      return {
        getDisplayValues: () => rows.slice(row - 2, row - 2 + height).map(values => values.slice(column - 1, column - 1 + width)),
        setValue(value) { return this.setValues([[value]]); },
        setValues(values) {
          values.forEach((valuesRow, y) => valuesRow.forEach((value, x) => {
            rows[row - 2 + y][column - 1 + x] = value;
            state.writes.push({ row: row + y, column: column + x, value });
          }));
          return this;
        },
        clearNote() {}, setNote() {}
      };
    }
  };
  Object.assign(context, {
    getSheet: () => sheet,
    getLastDataRow: () => rows.length + 1,
    ensureSynopsisColumns_() {}, setSynopsisSourceValidation_() {}, clearLibrarySearchCache_() {},
    buildRakutenKoboKeywordCandidates_: () => ['fixture query']
  });
  if (options.credentials !== false) {
    const config = vm.runInContext('SYNOPSIS_FETCH_CONFIG', context);
    properties.set(config.RAKUTEN_APP_ID_PROPERTY, 'fixture-app');
    properties.set(config.RAKUTEN_APKEY_PROPERTY, 'fixture-access');
  }
  return {
    context, state, rows, col, properties,
    yomi: limit => context.fillMissingYomiganaForImport_(sheet, limit),
    kobo: limit => context.retryNotFoundSynopsisFromRakutenKoboByLimit_(limit),
    value: (index, column) => rows[index][col[column] - 1]
  };
}

let cases = 0;
function test(name, run) {
  try { run(); cases++; }
  catch (error) { error.message = `${name}: ${error.message}`; throw error; }
}

const pending = () => ({ TITLE: '検証用の本', ISBN: isbn, SUMMARY: '既存の説明', SUMMARY_SOURCE: 'NOT_FOUND' });
const failureCases = [
  ['HTTP 429', { status: 429, body: '{}' }, 4],
  ['HTTP 500', { status: 500, body: '{}' }, 1],
  ['HTTP 401', { status: 401, body: '{}' }, 1],
  ['network exception', new Error('simulated network interruption'), 3],
  ['invalid JSON', { status: 200, body: '<html>maintenance</html>' }, 1],
  ['empty body', { status: 200, body: '' }, 1],
  ['API error object', ok({ error: 'unavailable' }), 1],
  ['invalid Items', ok({ Items: {} }), 1]
];

for (const [name, response, calls] of failureCases) {
  test(`Kobo ${name} remains retryable and stops the batch`, () => {
    const f = fixture([pending(), pending()]);
    f.state.response = response;
    const result = f.kobo(50);
    assert.equal(result.processed, 1);
    assert.equal(result.error, 1);
    assert.equal(result.notFoundDone, 0);
    assert.equal(f.state.requests.length, calls);
    assert.equal(f.state.writes.length, 0);
    assert.equal(f.value(0, 'SUMMARY_SOURCE'), 'NOT_FOUND');
    assert.equal(f.value(0, 'SUMMARY'), '既存の説明');
    // The same row must be eligible again after the service recovers.
    f.state.response = empty;
    const retry = f.kobo(1);
    assert.equal(retry.notFoundDone, 1);
    assert.equal(retry.error, 0);
    assert.equal(f.value(0, 'SUMMARY_SOURCE'), 'NOT_FOUND.');
    assert.equal(f.value(1, 'SUMMARY_SOURCE'), 'NOT_FOUND');
  });

  test(`yomi ${name} is an error, advances, and preserves existing values`, () => {
    const f = fixture([{ TITLE: '取得済み', ISBN: isbn, YOMIGANA: 'てにゅうりょく' }, pending(), pending()]);
    f.state.response = response;
    const result = f.yomi(20);
    assert.equal(result.error, 1);
    assert.equal(result.notFound, 0);
    assert.equal(result.processed, 1);
    assert.equal(f.state.writes.length, 0);
    f.state.response = kana;
    assert.equal(f.yomi(1).changed, 1);
    assert.equal(f.value(2, 'YOMIGANA'), 'てすと の ほん');
    assert.equal(f.value(1, 'YOMIGANA'), '');
    assert.equal(f.value(0, 'YOMIGANA'), 'てにゅうりょく');
    assert.equal(f.yomi(1).changed, 1); // Wrap and retry the previously failed row.
    assert.equal(f.value(1, 'YOMIGANA'), 'てすと の ほん');
  });
}

test('missing credentials never finalize Kobo or count yomi as no result', () => {
  const f = fixture([pending()], { credentials: false });
  assert.equal(f.kobo(20).error, 1);
  const result = f.yomi(20);
  assert.equal(result.error, 1);
  assert.equal(result.notFound, 0);
  assert.equal(f.state.requests.length, 0);
  assert.equal(f.state.writes.length, 0);
});

test('Kobo partial keyword search cannot finalize absence', () => {
  const f = fixture([pending()]);
  f.context.buildRakutenKoboKeywordCandidates_ = () => ['first', 'second'];
  f.state.response = () => f.state.requests.length === 1 ? empty : { status: 500, body: '{}' };
  assert.equal(f.kobo(1).error, 1);
  assert.equal(f.state.writes.length, 0);
});

test('Kobo recovers within the rate limit retries', () => {
  const f = fixture([pending()]);
  f.state.response = () => f.state.requests.length < 3 ? { status: 429, body: '{}' } : empty;
  const result = f.kobo(1);
  assert.equal(result.error, 0);
  assert.equal(result.notFoundDone, 1);
  assert.equal(f.state.requests.length, 3);
});

test('Kobo skips untitled and finalized books without spending the request quota', () => {
  const f = fixture([
    { ...pending(), TITLE: '' },
    { ...pending(), SUMMARY_SOURCE: 'NOT_FOUND.' },
    { ...pending(), SUMMARY_SOURCE: 'Manual' },
    pending()
  ]);
  const result = f.kobo(1);
  assert.equal(result.skipped, 1);
  assert.equal(result.notFoundDone, 1);
  assert.deepEqual(f.state.writes.map(write => write.row), [5, 5]);
  assert.equal(f.value(0, 'SUMMARY_SOURCE'), 'NOT_FOUND');
  assert.equal(f.value(2, 'SUMMARY'), '既存の説明');
});

test('Kobo successful candidate still uses the normal write path', () => {
  const f = fixture([pending()]);
  f.state.response = ok({ Items: [{ Item: { itemNumber: 'fixture-item' } }] });
  // Candidate ranking is covered elsewhere; retain the real transport/selection/write pipeline.
  f.context.buildRakutenKoboCandidateRecord_ = () => ({ raw: '新しい説明', score: 100 });
  const result = f.kobo(1);
  assert.equal(result.success, 1);
  assert.equal(result.error, 0);
  assert.equal(f.value(0, 'SUMMARY'), '新しい説明');
  assert.equal(f.value(0, 'SUMMARY_SOURCE'), 'RakutenKobo');
});

test('twenty ISBN-less books cannot block the next book', () => {
  const f = fixture([...Array.from({ length: 20 }, () => ({ TITLE: 'ISBNなし' })), pending()]);
  f.state.response = kana;
  const result = f.yomi(20);
  assert.equal(result.skippedNoIsbn, 20);
  assert.equal(result.processed, 1);
  assert.equal(result.changed, 1);
  assert.equal(f.state.requests.length, 1);
  assert.equal(f.state.writes[0].row, 22);
});

test('twenty unresolved books yield to the next book on a fresh execution', () => {
  const books = Array.from({ length: 21 }, pending);
  const first = fixture(books);
  assert.equal(first.yomi(20).notFound, 20);
  // A fresh VM ensures the progress really persisted in Script Properties.
  const second = fixture(books, { properties: first.properties });
  second.state.response = kana;
  assert.equal(second.yomi(1).changed, 1);
  assert.equal(second.state.writes[0].row, 22);
  assert.equal(second.state.requests.length, 1);
});

test('cursor is isolated per spreadsheet and sheet', () => {
  const books = [pending(), pending()];
  const first = fixture(books);
  first.yomi(1);
  for (const identity of [{ sheetId: 456 }, { spreadsheetId: 'another-fixture' }]) {
    const second = fixture(books, { ...identity, properties: first.properties });
    second.state.response = kana;
    second.yomi(1);
    assert.equal(second.state.writes[0].row, 2);
  }
});

test('invalid cursor resets safely after deleted rows or invalid state', () => {
  for (const value of ['999', 'NaN', '-1', '2.5']) {
    const properties = new Map([['newBookImport.yomiganaNextRow.fixture-spreadsheet.123', value]]);
    const f = fixture([pending()], { properties });
    f.state.response = kana;
    assert.equal(f.yomi(1).changed, 1);
    assert.equal(f.state.writes[0].row, 2);
  }
});

test('empty and already completed sheets do not call APIs', () => {
  for (const books of [[], [{ TITLE: '登録済み', ISBN: isbn, YOMIGANA: 'とうろくずみ' }]]) {
    const f = fixture(books);
    assert.equal(f.yomi(20).processed, 0);
    assert.equal(f.state.requests.length, 0);
    assert.equal(f.state.writes.length, 0);
  }
});

test('Rakuten failure does not discard candidates from other synopsis providers', () => {
  const f = fixture([]);
  const records = [];
  f.state.response = { status: 500, body: '{}' };
  f.context.appendSynopsisCandidateRecords_(records, 'RakutenBooks', () => f.context.fetchSynopsisCandidateListFromRakutenBooks_(isbn));
  assert.equal(records.length, 0);
  f.context.appendSynopsisCandidateRecords_(records, 'OpenBD', () => ['ほかの取得元からの説明']);
  assert.equal(records.length, 1);
  assert.equal(records[0].source, 'OpenBD');
});

test('the final import toast retains failure counts after subsequent stages', () => {
  const f = fixture([pending()]);
  let released = false;
  Object.assign(f.context, {
    LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock: () => { released = true; } }) },
    ensureFallbackImageColumns_() {},
    refreshSeriesKeyAutoForImport_: () => ({ changed: 0 }),
    repairBookUuidsAll_: () => ({ changed: 0 }),
    batchFetchSynopsisRawByLimit_: () => ({ processed: 0 }),
    batchFillFallbackImageUrlsByLimit_: () => ({ processed: 0 })
  });
  f.state.response = { status: 500, body: '{}' };
  const result = f.context.enrichNewBooksAfterImportByLimit_(20);
  assert.equal(result.yomigana.error, 1);
  assert.equal(result.synopsisKobo.error, 1);
  assert.match(f.state.toasts.at(-1), /再試行待ち 2/);
  assert.equal(released, true);
});

console.log(`Import retry checks passed (${cases} cases).`);
