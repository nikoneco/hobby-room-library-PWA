const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const context = vm.createContext({ console, URL, encodeURIComponent });
vm.runInContext(fs.readFileSync(path.join(root, 'config.js'), 'utf8') + '\n' +
  fs.readFileSync(path.join(root, 'Webアプリ.js'), 'utf8'), context);
const results = vm.runInContext(`(() => {
  const dataset = { rows: [['a'], ['other'], ['b']], index: [
    { seriesKeyAuto: 'target' }, { seriesKeyAuto: 'other' }, { seriesKeyAuto: 'target' }
  ] };
  getLibraryDataset_ = perf => {
    if (perf) Object.assign(perf, { cacheStatus: 'hit-after-lock', lockWaitMs: 75,
      cacheReadMs: 5, buildMs: 100, datasetMs: 180 });
    return dataset;
  };
  mapRowsToBooks_ = (rows, index, options) => rows.map((row, i) => ({
    title: row[0], seriesKeyAuto: index[i].seriesKeyAuto, rowIndex: options.rowIndexes[i]
  }));
  const perf = {};
  const measured = PUBLIC_WEBAPP_JSONP_API_HANDLERS_.series({ seriesKeyAuto: 'target' }, perf);
  const normal = PUBLIC_WEBAPP_JSONP_API_HANDLERS_.series({ seriesKey: 'target' });
  const emptyPerf = {};
  const empty = PUBLIC_WEBAPP_JSONP_API_HANDLERS_.series({ seriesKey: 'missing' }, emptyPerf);
  return { perf, measured, normal, empty, emptyPerf };
})()`, context);
const plain = value => JSON.parse(JSON.stringify(value));
assert.deepEqual(plain(results.measured), plain(results.normal), 'opt-in timing preserves the normal series payload');
assert.deepEqual(plain(results.measured).map(book => book.rowIndex), [0, 2], 'only full matching series records are returned');
assert.equal(results.perf.cacheStatus, 'hit-after-lock');
assert.equal(results.perf.lockWaitMs, 75, 'dataset lock timing reaches series API performance metadata');
assert.equal(results.perf.buildMs, 100);
assert.equal(results.perf.sourceCount, 3);
assert.equal(results.perf.resultCount, 2);
assert(results.perf.filterMs >= 0 && results.perf.mapMs >= 0);
assert.deepEqual(plain(results.empty), []);
assert.equal(results.emptyPerf.resultCount, 0);
console.log('series API performance checks ok');
