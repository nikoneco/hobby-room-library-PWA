const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

// Evaluate the actual generator without writing generated docs or using a network.
const build = read('tools/build-pages.js');
const start = build.indexOf('function writeGasRunShim() {');
const end = build.indexOf('function writePwaClient()', start);
assert(start >= 0 && end > start, 'JSONP generator boundary exists');
let fixtureShim;
vm.runInNewContext(build.slice(start, end) + '\nwriteGasRunShim();', {
  fs: { writeFileSync(file, content) { fixtureShim = content; } }, path,
  jsDir: '/fixture', gasEndpoint: 'https://example.invalid/exec'
});
assert(fixtureShim.includes('ShumiLibraryBookDetailApi'));

// Reuse the existing simulated DOM/timers; production modal and shim remain intact.
const existing = read('tools/check-series-loading.js');
let prelude = existing.slice(0, existing.indexOf('const booksFor ='));
prelude = prelude.replace("const shim = read('docs/assets/js/gas-run-shim.js');", 'const shim = fixtureShim;');
const injectionStart = prelude.indexOf('  vm.runInContext(shim.replace(');
const injectionEnd = prelude.indexOf('  c.google = window.google;', injectionStart);
assert(injectionStart >= 0 && injectionEnd > injectionStart);
prelude = prelude.slice(0, injectionStart) + '  vm.runInContext(shim, c);\n' + prelude.slice(injectionEnd);
const host = { require, URL, URLSearchParams, Buffer, fixtureShim, __dirname, module: { exports: {} } };
vm.runInNewContext(prelude + '\nmodule.exports = harness;', host);
const harness = host.module.exports;
const callback = (h, request) => request.params.get('callback').split('.').reduce((obj, key) => obj[key], h.window);

function queue() {
  const h = harness();
  const books = Array.from({ length: 13 }, (_, i) => ({
    bookId: `fixture-${i}`, rowIndex: i, title: `Fixture ${i}`, detailLoaded: false
  }));
  h.c.fixtureBooks = books;
  h.eval_('bookDetailPrefetchQueue = fixtureBooks.slice();');
  h.c.processBookDetailPrefetchQueue_();
  return { h, books };
}

// One logical deadline cleans the transport and releases the serial lane.
{
  const { h, books } = queue();
  const first = h.requests[0], lateError = first.script.onerror, lateSuccess = callback(h, first);
  h.advance(25000);
  assert.equal(h.activeScripts.size, 0, 'modal deadline cancels its JSONP transport');
  assert(books.slice(0, 12).every(book => !book.detailLoading));
  assert.equal(h.eval_('bookDetailInFlightCallbacks.size'), 0);
  assert.equal(h.perf[0].result.code, 'CANCELLED');
  h.advance(1000);
  assert.equal(h.requests.length, 2, 'next batch starts after timeout');
  assert.equal(h.activeScripts.size, 1, 'only the next batch remains');
  h.advance(8459);
  lateError();
  lateSuccess({ ok: true, data: [{ bookId: books[0].bookId, summary: 'Late' }] });
  h.reply(first, [], 'Late failure');
  assert.equal(h.notifications.length, 0, 'late transport cannot display a global error');
  assert.equal(h.requests.length, 2, 'late failure cannot start row fallback');
  assert(books[12].detailLoading, 'new batch remains active');
  assert.equal(h.c.getCachedBookDetail_(books[0]), null, 'late detail is not cached');
}

// UUID failure at 10s must not give its row fallback another 25s.
{
  const { h, books } = queue();
  h.advance(10000);
  h.requests[0].script.onerror();
  assert.equal(h.requests[1].params.get('api'), 'bookDetails');
  const row = h.requests[1], lateError = row.script.onerror;
  h.advance(14999);
  assert.equal(h.activeScripts.size, 1);
  h.advance(1);
  assert.equal(h.activeScripts.size, 0, 'fallback shares original logical deadline');
  assert(books.slice(0, 12).every(book => !book.detailLoading));
  lateError();
  h.reply(row, [], 'Late row error');
  assert.equal(h.notifications.length, 0);
  h.advance(1000);
  assert.equal(h.requests.length, 3, 'deadline releases the fallback batch');
}

// Active background failure still tries the compatibility API and releases its lane.
{
  const { h, books } = queue();
  h.requests[0].script.onerror();
  assert.equal(h.requests[1].params.get('api'), 'bookDetails');
  h.requests[1].script.onerror();
  assert.equal(h.activeScripts.size, 0);
  assert.equal(h.notifications.length, 0, 'background errors are quiet');
  assert(books.slice(0, 12).every(book => !book.detailLoading && !book.detailError));
  h.advance(1000);
  assert.equal(h.requests.length, 3);
}

// Foreground single/batch success, row compatibility, timeout UI, and retry remain valid.
for (const batch of [false, true]) {
  const h = harness();
  const book = { bookId: 'normal', rowIndex: 4, detailLoaded: false };
  if (batch) h.c.fetchPopupContextBookDetails_(book, 0, [book], null, { mode: 'currentOnly' });
  else h.c.fetchDeferredBookDetails_(book, 0, [book], null, {});
  const detail = { bookId: book.bookId, rowIndex: book.rowIndex, summary: 'Normal success' };
  h.reply(h.requests[0], batch ? [detail] : detail);
  assert.equal(book.summary, 'Normal success');
  assert.equal(book.detailLoading, false);
  assert.equal(h.activeScripts.size, 0);
  assert.equal(h.perf[0].result.ok, true, 'normal completion stays a successful API measurement');
  h.advance(60000);
  assert.equal(h.requests.length, 1);
  assert.equal(h.notifications.length, 0);
}

for (const batch of [false, true]) {
  const h = harness();
  const book = { bookId: 'visible', rowIndex: 2, detailLoaded: false };
  const load = () => batch
    ? h.c.fetchPopupContextBookDetails_(book, 0, [book], null, { mode: 'currentOnly' })
    : h.c.fetchDeferredBookDetails_(book, 0, [book], null, {});
  load();
  const first = h.requests[0], lateSuccess = callback(h, first);
  h.advance(25000);
  assert.equal(h.activeScripts.size, 0);
  assert.match(book.detailError, /時間がかかっています/);
  assert.match(h.c.buildPopupDetailLoadingHtml_(book), /もう一度読み込む/);
  load();
  lateSuccess({ ok: true, data: batch ? [{ bookId: book.bookId, summary: 'Old' }] : { bookId: book.bookId, summary: 'Old' } });
  assert(book.detailLoading, 'late response cannot settle retry');
  h.requests[1].script.onerror();
  assert.equal(h.requests[2].params.get('api'), batch ? 'bookDetails' : 'bookDetail');
  const detail = { bookId: book.bookId, rowIndex: book.rowIndex, summary: 'Recovered' };
  h.reply(h.requests[2], batch ? [detail] : detail);
  assert.equal(book.summary, 'Recovered');
  assert.equal(book.detailError, '');
  assert.equal(h.activeScripts.size, 0);
  assert.equal(h.notifications.length, 0);
}

// Native google.script.run has no adapter/cancellation; preserve its deadline/guard.
for (const batch of [false, true]) {
  const h = harness(), requests = [];
  h.window.ShumiLibraryBookDetailApi = null;
  const runner = {};
  runner.withSuccessHandler = fn => { runner.ok = fn; return runner; };
  runner.withFailureHandler = fn => { runner.fail = fn; return runner; };
  for (const method of ['getBookDetailById', 'getBookDetailsByIds', 'getBookDetailByRowIndex', 'getBookDetailsByRowIndexes']) {
    runner[method] = (...args) => requests.push({ method, args, ok: runner.ok, fail: runner.fail });
  }
  h.c.google.script.run = runner;
  const book = { bookId: 'native', rowIndex: 3, detailLoaded: false };
  const load = () => batch
    ? h.c.fetchPopupContextBookDetails_(book, 0, [book], null, { mode: 'currentOnly' })
    : h.c.fetchDeferredBookDetails_(book, 0, [book], null, {});
  load();
  h.advance(25000);
  assert.match(book.detailError, /時間がかかっています/);
  load();
  requests[0].fail(new Error('Late native failure'));
  assert.equal(requests.length, 2, 'native late failure cannot start fallback');
  const detail = { bookId: book.bookId, rowIndex: book.rowIndex, summary: 'Native success' };
  requests[1].ok(batch ? [detail] : detail);
  assert.equal(book.summary, 'Native success');
  assert.equal(book.detailError, '');
}

// Unknown methods cannot extend the book-detail transport surface.
{
  const h = harness();
  let error;
  h.window.ShumiLibraryBookDetailApi.request('getInitialSearchData', [], () => {}, value => { error = value; });
  assert.equal(error.code, 'UNSUPPORTED_API');
  assert.equal(h.requests.length, 0);
}
console.log('book detail transport checks ok: cancellation, shared fallback deadline, late callbacks, quiet prefetch, retry, native compatibility');
