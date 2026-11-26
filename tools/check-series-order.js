const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const plain = value => JSON.parse(JSON.stringify(value));
const server = vm.createContext({ console, URL, encodeURIComponent });
vm.runInContext(['config.js', 'Webアプリ.js', 'SeriesRegistry.js', 'コード.js'].map(read).join('\n'), server);
const modalSource = read('script.modal.js.html');
const shimSource = read('docs/assets/js/gas-run-shim.js');
function functionSource(source, name) {
  const start = source.indexOf('function ' + name + '(');
  assert(start >= 0, name + ' exists');
  const indent = source.slice(source.lastIndexOf('\n', start) + 1, start);
  const following = source.slice(start + 1).match(new RegExp('\n' + indent + 'function '));
  const next = following ? start + 1 + following.index : -1;
  return source.slice(start, next < 0 ? source.length : next).replace(/\s*<\/script>\s*$/, '');
}
const client = vm.createContext({ console });
vm.runInContext(functionSource(modalSource, 'getSeriesPartLabel_') + '\n' + functionSource(modalSource, 'sortSeriesBooksForDisplay_'), client);
const sort = books => plain(client.sortSeriesBooksForDisplay_(books));
const uuid = i => '00000000-0000-4000-8000-' + String(i).padStart(12, '0');
const row = (i, series, title = 'Book ' + i) => {
  const values = Array(20).fill('');
  values[0] = title; values[13] = uuid(i); values[15] = series;
  return values;
};
function apply(rows, values, ids = ['series-a', 'series-b']) {
  const index = rows.map(item => ({ seriesKeyAuto: item[15] }));
  server.applySeriesOrdersToIndex_(rows, index, values, { masterById: new Map(ids.map(id => [id, {}])) });
  return index;
}
function block(values, number, id, entries) {
  const column = 1 + number * 3;
  values[1] ||= [];
  values[1][column] = 'Displayed title'; values[1][column + 1] = id;
  values[1][column + 2] = 'Warning only';
  entries.forEach((entry, index) => {
    const rowIndex = entry.row == null ? index + 2 : entry.row;
    values[rowIndex] ||= [];
    values[rowIndex][column] = entry.title || 'Unrelated title';
    values[rowIndex][column + 1] = entry.uuid;
    values[rowIndex][column + 2] = entry.order;
  });
}
const rows = Array.from({ length: 12 }, (_, i) => row(i, i < 9 ? 'series-a' : 'series-b'));
const values = [[], []];
block(values, 0, 'series-a', [{ uuid: uuid(0), order: 0 }, { uuid: uuid(1), order: -2 },
  { uuid: uuid(2), order: 1.5 }, { uuid: uuid(3), order: ' 1.5 ' },
  { uuid: uuid(4), order: '' }, { uuid: uuid(5), order: 'NaN' },
  { uuid: uuid(6), order: Infinity }, { uuid: uuid(7), order: 10, row: 12 }]);
block(values, 1, 'series-b', [{ uuid: uuid(9), order: 4 }]);
block(values, 8, 'series-b', [{ uuid: uuid(10), order: -0.5 }]);
let index = apply(rows, values);
assert.deepEqual(index.map(item => item.seriesOrder), [0, -2, 1.5, 1.5, null, null, null, 10, null, 4, -0.5, null],
  'B, second, and ninth blocks work past empty blocks/rows; blank is never zero');
const renamed = rows.map(item => item.slice()).reverse();
renamed.forEach(item => { item[0] = 'Renamed title'; });
assert.deepEqual(apply(renamed, values).map(item => item.seriesOrder), index.map(item => item.seriesOrder).reverse(),
  'renamed titles and reordered catalog rows preserve UUID orders');
assert.deepEqual(apply(rows, [[], ['', 'series-a', 'displayed title', 'warning']]).map(item => item.seriesOrder), rows.map(() => null),
  'only immutable series_id may select a block');
for (const invalid of [null, undefined, '', ' ', true, false, NaN, Infinity, -Infinity, '1st', '0x10', [], {}]) {
  assert.equal(server.normalizeSeriesOrderNumber_(invalid), null, 'invalid order ignored: ' + String(invalid));
}
for (const valid of [0, -5, 0.25, '0', '-2.5', '1e2']) assert.equal(server.normalizeSeriesOrderNumber_(valid), Number(valid));
const malformed = [[], []];
block(malformed, 0, 'series-a', [{ uuid: uuid(0), order: 1 }, { uuid: uuid(0), order: 1 },
  { uuid: uuid(9), order: -100 }, { uuid: 'bogus', order: 0 }, { uuid: uuid(999), order: 0 }]);
block(malformed, 1, 'series-b', [{ uuid: uuid(9), order: 3 }]);
assert.deepEqual(apply(rows, malformed).map(item => item.seriesOrder), [null, null, null, null, null, null, null, null, null, 3, null, null],
  'duplicate, unknown, invalid and foreign-series UUIDs fail safe; blocks remain independent');
const duplicateCatalog = rows.concat([row(9, 'series-a')]);
assert(apply(duplicateCatalog, malformed).every(item => item.seriesOrder === null), 'catalog UUID collision cannot attach an order to either book');
const baseline = [{ title: 'Part 下', seriesKeyAuto: 'series-a', bookId: uuid(1) },
  { title: 'Part 上', seriesKeyAuto: 'series-a', bookId: uuid(0) },
  { title: 'Part 中', seriesKeyAuto: 'series-a', bookId: uuid(2) }];
assert.deepEqual(sort(baseline).map(book => book.title), ['Part 上', 'Part 中', 'Part 下'], 'old part ordering remains when no overrides exist');
const tied = baseline.map(book => ({ ...book, seriesOrder: 0 }));
assert.deepEqual(sort(tied).map(book => book.title), ['Part 上', 'Part 中', 'Part 下'], 'numeric ties preserve old display baseline');
const books = rows.map((item, i) => ({ bookId: item[13], title: item[0], seriesKeyAuto: item[15], seriesOrder: index[i].seriesOrder }));
assert.deepEqual(sort(books.slice(0, 9)).map(book => book.bookId), [1, 0, 2, 3, 7, 4, 5, 6, 8].map(uuid),
  'registered numeric order ascending; missing and new books remain after registered in baseline order');
const interleaved = [books[0], books[9], books[1], books[10], books[4]];
assert.deepEqual(sort(interleaved).map(book => book.bookId), [uuid(1), uuid(10), uuid(0), uuid(9), uuid(4)],
  'overrides do not move books across other-series positions');
assert.equal(sort(books.concat({ ...books[0], title: 'Duplicate' })).length, 13, 'sort never drops duplicate or invalid book entries');
// Build the actual dataset path with resolved IDs, then compare remote/full, compact and local conversion.
server.fixtureRows = rows.map(item => item.slice());
server.fixtureOrders = values;
vm.runInContext(`
  loadMainBookData_ = () => fixtureRows;
  getGenreMasterData_ = () => ({ genreToCategory: {}, options: { story: [], theme: [], mood: [], status: [], media: [] } });
  getPublisherOptions_ = () => [];
  loadSeriesRegistryLookup_ = () => ({ masterById: new Map([['series-a', {}], ['series-b', {}]]) });
  resolveSeriesRegistryKey_ = key => ({ seriesId: key, displayName: key, media: [] });
  getLibrarySpreadsheet_ = () => ({ getSheetByName: () => ({ getLastRow: () => fixtureOrders.length,
    getLastColumn: () => 28, getRange: (r, c, h, w) => { if (r !== 1 || c !== 1 || h !== fixtureOrders.length || w !== 28) throw Error('range'); return { getValues: () => fixtureOrders }; } }) });
`, server);
function datasetChecks(expectedRows) {
  const dataset = server.buildLibraryDataset_();
  dataset.datasetRevision = 'series-order-test';
  assert.deepEqual(plain(dataset.rows), expectedRows, 'dataset catalog order is untouched');
  assert(server.isLibraryDatasetValid_(dataset));
  const old = plain(dataset); old.index.forEach(item => { delete item.seriesOrder; });
  assert(!server.isLibraryDatasetValid_(old), 'cache validation rejects old datasets without order metadata');
  const full = plain(server.mapRowsToBooks_(dataset.rows, dataset.index, { rowOffset: 0 }));
  const compact = plain(server.mapRowsToBooks_(dataset.rows, dataset.index, { compact: true, rowOffset: 0 }));
  const payload = plain(server.buildLocalLibraryIndexPayload_(dataset));
  assert.equal(payload.version, 7); assert.equal(payload.columns[32], 'seriesOrder');
  assert(payload.records.every(record => record.length === 33));
  const shim = vm.createContext({ LOCAL_INDEX_SCHEMA_VERSION: 7, createError_: (message, code) => Object.assign(new Error(message), { code }) });
  vm.runInContext(functionSource(shimSource, 'normalizeKanaLocal_') + '\n' + functionSource(shimSource, 'parseBookContributorsLocal_') + '\n' + functionSource(shimSource, 'buildGenreMetaLocal_') + '\n' + functionSource(shimSource, 'convertLocalIndexPayload_'), shim);
  const converted = plain(shim.convertLocalIndexPayload_(payload));
  for (const [i, record] of converted.entries()) {
    const common = Object.fromEntries(Object.keys(record.book).map(key => [key, typeof record.book[key] === 'string' ? String(compact[i][key] || '') : compact[i][key]]));
    assert.deepEqual(record.book, common, 'server compact and local common fields agree');
    assert.equal(full[i].seriesOrder, record.book.seriesOrder, 'full detail and local metadata agree');
  }
  server.getLibraryDataset_ = () => dataset;
  assert.deepEqual(plain(server.searchBooksSimple('')).map(book => book.bookId), compact.map(book => book.bookId), 'remote search keeps catalog order');
  assert.deepEqual(sort(full).map(book => book.bookId), sort(converted.map(record => record.book)).map(book => book.bookId), 'server and local render order agree');
  // Execute the actual local search function using converted records.
  shim.localIndexRecords = converted; shim.cloneLocalBook_ = record => ({ ...record.book });
  shim.searchMatcher = vm.runInContext('librarySearchMatcher_', server);
  vm.runInContext(functionSource(shimSource, 'searchLocalSimple_'), shim);
  assert.deepEqual(plain(shim.searchLocalSimple_('')).map(book => book.bookId), compact.map(book => book.bookId), 'local search keeps catalog order');
  return { dataset, full, payload };
}
const result = datasetChecks(server.fixtureRows);
assert.deepEqual(plain(result.dataset.index.map(item => item.seriesOrder)), index.map(item => item.seriesOrder));
server.getLibrarySpreadsheet_ = () => ({ getSheetByName: () => null });
assert.deepEqual(plain(server.loadSeriesOrderValues_()), [], 'absent optional sheet retains legacy order');
server.getLibrarySpreadsheet_ = () => ({ getSheetByName() { throw new Error('read failed'); } });
assert.throws(() => server.buildLibraryDataset_(), /read failed/, 'data service failure aborts dataset/payload creation');
// Invalidation applies to either edit-capture path through the shared predicate.
const range = { getRow: () => 3, getColumn: () => 28, getNumRows: () => 1, getNumColumns: () => 1 };
assert(server.shouldClearLibrarySearchCacheOnEdit_('series_order', range));
assert(!server.shouldClearLibrarySearchCacheOnEdit_('other-sheet', range));
// Optional ignored live snapshots: no production writes, no private data in CI fixtures.
if (process.argv.includes('--live-copy')) {
  const snapshots = [0, 1, 2, 3].map(i => JSON.parse(read('tmp/series-order-live-' + i + '.json')));
  const catalog = snapshots[1].values.slice(1).filter(item => String(item[0] || '').trim()).map(item => Array.from({ length: 20 }, (_, i) => item[i] == null ? '' : item[i]));
  const masterById = new Map(snapshots[2].values.slice(1).filter(item => String(item[8] || '').toUpperCase() === 'ACTIVE').map(item => [item[0], { seriesId: item[0], displayName: item[1], media: item.slice(11, 13) }]));
  const aliases = new Map(snapshots[3].values.slice(1).map(item => [item[0], item[1]]));
  server.fixtureRows = catalog; server.fixtureOrders = snapshots[0].values;
  server.loadSeriesRegistryLookup_ = () => ({ masterById });
  server.resolveSeriesRegistryKey_ = key => masterById.get(aliases.get(key)) || null;
  server.getLibrarySpreadsheet_ = () => ({ getSheetByName: () => ({ getLastRow: () => server.fixtureOrders.length,
    getLastColumn: () => 28, getRange: () => ({ getValues: () => server.fixtureOrders }) }) });
  const live = datasetChecks(catalog);
  const targeted = live.full.filter(book => book.seriesOrder !== null);
  assert.equal(targeted.length, 9, 'live copy has exactly nine curated orders');
  assert.deepEqual(sort(targeted).map(book => book.seriesOrder), [10,20,30,40,50,60,70,80,90]);
  assert.deepEqual(sort(targeted).map(book => book.bookId), snapshots[0].values.slice(2).sort((a,b) => a[3]-b[3]).map(item => item[2]));
  assert(live.full.filter(book => book.seriesKeyAuto !== targeted[0].seriesKeyAuto).every(book => book.seriesOrder === null));
  console.log('live-copy series order checks ok: ' + catalog.length + ' books, ' + targeted.length + ' ordered');
}

// Exercise both real rendering entry points with a minimal DOM.
const nodes = new Map();
const imageCalls = [];
const prefetchCalls = [];
const element = tagName => ({ tagName, style: {}, children: [], attributes: {}, classList: { add() {}, remove() {}, contains() { return false; } },
  setAttribute(name, value) { this.attributes[name] = value; }, appendChild(child) { if (child.fragment) this.children.push(...child.children); else this.children.push(child); },
  querySelector() { return seriesList; }, querySelectorAll() { return []; } });
const seriesList = element();
Object.assign(client, { currentDatasetRevision: 'render-revision', popupSeriesRequestGeneration_: 0, popupReturnScrollY: 0,
  document: { body: element(), getElementById: id => { if (!nodes.has(id)) nodes.set(id, element()); return nodes.get(id); },
    createElement: element, createDocumentFragment: () => ({ fragment: true, children: [], appendChild(child) { this.children.push(child); } }) },
  window: { scrollY: 0 }, setPopupModalOpen_() {},
  prioritizeBookDetailPrefetch_(books, options) { prefetchCalls.push({ books, options }); }, clearPopupTouchHandlers_() {},
  escapeHtml: text => String(text), setupBookImageElement_(image, book, options) { imageCalls.push({ image, book, options }); },
  buildExternalLinksHtml: () => '', isCurrentSeriesBook_: () => false, uiIcon_: () => '' });
vm.runInContext(['getSeriesVolumeLabel_', 'getSeriesListBadgeLabel_', 'renderSearchResultSeriesPanel_', 'showSeriesPanel']
  .map(name => functionSource(modalSource, name)).join('\n'), client);
function renderBooks(input, group = { key: input[0].seriesKeyAuto, books: [input[0]], representativeBook: input[0] }) {
  seriesList.children = [];
  imageCalls.length = 0;
  prefetchCalls.length = 0;
  client.renderSearchResultSeriesPanel_(group, input);
  return seriesList.children;
}
const renderedLabels = buttons => buttons.map(button => button.children[1].textContent);
const group = { key: 'series-a', books: [books[7]], representativeBook: books[7] };
const input = books.slice(0, 9);
renderBooks(input, group);
const expectedTitles = sort(input).map(book => book.title);
assert.deepEqual(seriesList.children.map(button => button.title), expectedTitles, 'search-group series renders numeric order');
assert.deepEqual(group.seriesBooks.map(book => book.bookId), input.map(book => book.bookId), 'cached series retains original baseline rather than sorted output');
assert.equal(group.seriesBooksRevision, 'render-revision');
client.showSeriesPanel(input[0], input, { index: 0, data: input });
const html = nodes.get('image-popup-info').innerHTML;
let previous = -1;
for (const title of expectedTitles) {
  const position = html.indexOf('>' + title + '</span>', previous + 1);
  assert(position > previous, 'detail series renders the same numeric order'); previous = position;
}
console.log('both series rendering paths ok');

const curatedInput = [
  { title: '偽物語 下', seriesOrder: 40 },
  { title: '化物語 上', seriesOrder: 10 },
  { title: '化物語 下', seriesOrder: 20 },
  { title: '傷物語', seriesOrder: 30 },
  { title: '猫物語 黒', seriesOrder: 50 },
  { title: '新刊 上', seriesOrder: null },
  { title: '<img src=x onerror=alert(1)> 新刊 下', seriesOrder: null }
].map((book, i) => ({ ...book, bookId: uuid(i), seriesKeyAuto: 'curated' }));
const curatedBefore = plain(curatedInput);
const curatedButtons = renderBooks(curatedInput);
const curatedSorted = sort(curatedInput);
assert.deepEqual(renderedLabels(curatedButtons), curatedSorted.map(book => book.title),
  'curated series uses exact full titles for every card, including null-order new members');
assert.deepEqual(plain(curatedInput), curatedBefore, 'rendering does not modify the input order or books');
assert.deepEqual(prefetchCalls[0].books.map(book => book.bookId), curatedSorted.map(book => book.bookId),
  'detail prefetch retains display order');
assert.deepEqual(plain(prefetchCalls[0].options), { priority: true, allowModal: true });
assert.equal(prefetchCalls.length, 1, 'full titles do not add detail prefetch work');
assert.deepEqual(imageCalls.map(call => call.book.bookId), curatedSorted.map(book => book.bookId));
assert.deepEqual(imageCalls.map(call => plain(call.options)), curatedSorted.map((_, i) => ({
  track: false, loading: i < 4 ? 'eager' : 'lazy', fetchPriority: i < 4 ? 'high' : 'low'
})), 'first four covers remain eager and all remaining covers stay lazy');
curatedButtons.forEach((button, i) => {
  const book = curatedSorted[i];
  assert.equal(button.attributes['aria-label'], book.title + 'の詳細を開く', 'accessible name keeps full title');
  assert.equal(button.title, book.title, 'tooltip keeps full title');
  assert.equal(button.children[0].alt, book.title, 'cover alt keeps full title');
});
const unsafeLabel = curatedButtons.find(button => button.title.startsWith('<img')).children[1];
assert.equal(unsafeLabel.textContent, '<img src=x onerror=alert(1)> 新刊 下', 'title markup remains literal text');
assert.equal(unsafeLabel.innerHTML, undefined, 'full title is not assigned as HTML');
assert.equal(unsafeLabel.children.length, 0, 'title markup creates no child elements');

for (const order of [0, -2, 0.5]) {
  const ordered = [{ title: '例外 上', seriesOrder: order }, { title: '新刊 下', seriesOrder: null }]
    .map(book => ({ ...book, seriesKeyAuto: 'curated' }));
  assert.deepEqual(renderedLabels(renderBooks(ordered)), ['例外 上', '新刊 下'],
    'zero, negative and fractional numeric orders all activate full series titles: ' + order);
}
for (const order of [null, undefined, '', ' ', '0', true, NaN, Infinity, -Infinity]) {
  const ordinary = [{ title: '通常 上', seriesOrder: order }, { title: '通常 下', seriesOrder: order },
    { title: '通常 10', volume: 10, seriesOrder: order }, { title: '番外編', seriesOrder: order }]
    .map(book => ({ ...book, seriesKeyAuto: 'ordinary' }));
  assert.deepEqual(renderedLabels(renderBooks(ordinary)), ['上巻', '下巻', '10巻', '番外編'],
    'missing or invalid transport metadata keeps ordinary compact labels: ' + String(order));
}
client.showSeriesPanel(curatedInput[0], curatedInput, { index: 0, data: curatedInput });
assert(nodes.get('image-popup-info').innerHTML.includes('<span class="series-volume-label">上巻</span>'),
  'separate detail series panel keeps its compact part label even for curated series');
assert(nodes.get('image-popup-info').innerHTML.includes('>化物語 上</span>'),
  'separate detail series panel retains its existing full-title column');
console.log('curated series full-title rendering checks ok');

console.log('series order checks ok');
