const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const source = fs.readFileSync(path.join(__dirname, '..', 'script.search.js.html'), 'utf8').replace(/^\s*<script>\s*/, '').replace(/\s*<\/script>\s*$/, '');
const c = vm.createContext({ window: {}, document: { addEventListener() {} }, console });
vm.runInContext(source, c);
const read = expression => vm.runInContext(expression, c);
const plain = value => JSON.parse(JSON.stringify(value));
// Frozen pre-C05 algorithm: different execution path checks ordering, grouping,
// deduplication, digit handling, and candidate normalization against the old UI.
function legacy(input, type, data, grouped) {
  if (!input || input.length < 1) return [];
  const n = c.normalizeKana, query = n(input);
  const series = grouped.filter(value => n(value).includes(query));
  const titles = (data.titles || []).filter(title => !series.some(s => n(title).startsWith(n(s))));
  let values = [];
  if (type === 'keyword') values = [...new Set([...series, ...titles, ...(data.authors || []),
    ...(data.yomis || []).filter(y => !series.some(s => n(y).startsWith(n(s))))
      .map(y => /[0-9０-９]/.test(input) ? y : String(y).replace(/[\s.・]+(?:第)?[0-9０-９]+(?:巻)?\s*$/, ''))])];
  if (type === 'detailTitle') values = [...new Set([...series, ...titles])];
  return values.filter(value => n(value).includes(query)).slice(0, 6);
}
const data = {
  titles: ['【推しの子】 01', '【推しの子】 02', '夏の本', '夏の本', '夏目の本', 'ＡＢＣ １', 'がくえん', 'ｶﾞｸｴﾝ', 'ほし 第２巻'],
  authors: ['夏目 漱石', '夏目 漱石', 'Spinelli, Jerry', 'ABC'],
  yomis: ['おしのこ 01', 'おしのこ 02', 'なつのほん.1', 'なつのほん・第２巻', 'なつのほん 3', 'ABC', 'ほし １'],
  seriesTitles: ['【推しの子】', '夏のシリーズ', '夏のシリーズ']
};
let series = data.seriesTitles.slice(), revision = 'one';
c.window.ShumiLibraryLocalIndex = { getRevision: () => revision, getSuggestionTitles: () => series.slice() };
c.data = data; read('SUGGEST_DATA = data');
assert.equal(read('normalizedSuggestionCache_'), null, 'startup does not eagerly normalize the pool');
const queries = ['', null, ' ', '　', '夏', '夏目', 'の', '推しの子', 'おしの子', 'おしのこ', '推しのこ', 'ｵｼﾉｺ', '１', '1', '01', '第２巻', 'ABC', 'ａｂｃ', 'が', 'ｶﾞ', 'なつのほん', 'Spinelli,', 'no-hit'];
function compare() { for (const q of queries) for (const type of ['keyword', 'detailTitle', 'unknown']) assert.deepEqual(plain(c.suggest(q, type)), legacy(q, type, data, series), String(q) + '/' + type); }
compare();
const first = read('normalizedSuggestionCache_');
c.suggest('夏', 'keyword'); assert.equal(read('normalizedSuggestionCache_'), first, 'same revision and values reuse the pool');
// New arrays/objects containing the same metadata do not rebuild the cache.
c.dataCopy = plain(data); read('SUGGEST_DATA = dataCopy'); c.suggest('夏', 'keyword'); assert.equal(read('normalizedSuggestionCache_'), first);
read('SUGGEST_DATA = data');
revision = 'two'; c.suggest('夏', 'keyword'); assert.notEqual(read('normalizedSuggestionCache_'), first, 'new revision invalidates the old pool');
let previous = read('normalizedSuggestionCache_');
data.titles[0] = '変更した書名'; series[0] = '変更したシリーズ'; compare(); assert.notEqual(read('normalizedSuggestionCache_'), previous, 'same-length in-place changes are detected');
previous = read('normalizedSuggestionCache_'); data.authors.push('の作者'); data.yomis.push('のよみ 4'); compare(); assert.notEqual(read('normalizedSuggestionCache_'), previous);
// Unprepared/absent local index and later activation use exactly the old source.
series = []; compare();
delete c.window.ShumiLibraryLocalIndex;
for (const q of queries) for (const type of ['keyword', 'detailTitle']) assert.deepEqual(plain(c.suggest(q,type)), legacy(q,type,data,data.seriesTitles));
c.window.ShumiLibraryLocalIndex = { getRevision: () => revision, getSuggestionTitles: () => series.slice() }; series = ['新しいシリーズ']; compare();
// Failed reads/builds cannot commit a partial pool, and a subsequent retry works.
previous = read('normalizedSuggestionCache_');
c.window.ShumiLibraryLocalIndex.getSuggestionTitles = () => { throw Error('fixture index error'); };
assert.throws(() => c.suggest('夏','keyword'), /fixture index error/); assert.equal(read('normalizedSuggestionCache_'), previous);
c.window.ShumiLibraryLocalIndex.getSuggestionTitles = () => series.slice();
const authors = data.authors; data.authors = { map() { throw Error('fixture metadata error'); } };
assert.throws(() => c.suggest('夏','keyword'), /fixture metadata error|every is not a function/); assert.equal(read('normalizedSuggestionCache_'), previous);
data.authors = authors; compare();
// A large pool is normalized once; subsequent input does not re-normalize it.
data.titles = Array.from({length:2500}, (_,i) => 'の書名 ' + i);
data.yomis = Array.from({length:1100}, (_,i) => 'のよみ ' + i);
data.authors = ['の作者']; series = Array.from({length:270}, (_,i) => 'のシリーズ ' + i);
assert.deepEqual(plain(c.suggest('の','keyword')), legacy('の','keyword',data,series));
const original = c.normalizeKana; let calls = 0;
c.normalizeKana = value => { calls++; return original(value); };
assert.equal(c.suggest('の','keyword').length, 6); assert.equal(calls,1,'warm input normalizes only the query');
c.normalizeKana = original;
console.log('suggestion cache compatibility, invalidation, recovery and bounded normalization checks ok');
