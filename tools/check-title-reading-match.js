const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
const build = fs.readFileSync(path.join(root, 'tools/build-pages.js'), 'utf8');
let shim;
vm.runInNewContext(build.slice(build.indexOf('function writeGasRunShim()'), build.indexOf('function writePwaClient()')) + '\nwriteGasRunShim();', {
  fs: { writeFileSync(_, content) { shim = content; } }, path, jsDir: '/fixture', gasEndpoint: 'https://example.invalid/exec'
});
const c = vm.createContext({ window: {}, document: { addEventListener() {} }, console });
vm.runInContext(shim.slice(shim.indexOf('function normalizeKanaLocal_('), shim.indexOf('function normalizeReleasedYmLocal_(')), c);
const search = fs.readFileSync(path.join(root, 'script.search.js.html'), 'utf8').replace(/^\s*<script>\s*/, '').replace(/\s*<\/script>\s*$/, '');
vm.runInContext(search, c);
const read = text => vm.runInContext(text, c);
const plain = value => JSON.parse(JSON.stringify(value));
const normalize = c.normalizeKana;
const matcher = c.window.ShumiLibraryTitleReading;
const serverSource = fs.readFileSync(path.join(root, 'Webアプリ.js'), 'utf8').replace(/\r\n/g, '\n');
const localHelper = shim.slice(shim.indexOf('  const alignedTitleReadingCache_'), shim.indexOf('  window.ShumiLibraryTitleReading')).replace(/Local_/g, '_').replace(/^  /gm, '').trim();
const serverHelper = serverSource.slice(serverSource.indexOf('const alignedTitleReadingCache_'), serverSource.indexOf('function keywordMixedMatch_(')).trim();
assert.equal(localHelper, serverHelper, 'GAS and local anchored matchers must not drift');
const config = fs.readFileSync(path.join(root, 'config.js'), 'utf8');
const normalizeStart = config.indexOf('function normalizeKana(');
const server = vm.createContext({ console });
vm.runInContext(config.slice(normalizeStart, config.indexOf('\nfunction ', normalizeStart + 1)) + '\n' + serverSource, server);
const item = (title, yomi) => ({ title: normalize(title), yomi: normalize(yomi) });
const main = item('【推しの子】 01', 'おしのこ 01');
const illustration = item('Glare×Sparkle : 〈推しの子〉1stイラスト集', 'ぐれあすぱーくる〈おしのこ〉ふぁーすといらすとしゅう');
const four = ['推しの子', 'おしの子', 'おしのこ', '推しのこ'];
for (const target of [main, illustration]) {
  for (const q of four) {
    assert(c.keywordMixedMatchLocal_(q, target), q + '/' + target.title);
    assert(server.keywordMixedMatch_(q, target), 'GAS/' + q);
    const criteria = server.buildServerSearchCriteria_('', q);
    assert(server.matchesSearchCriteria_(Object.assign({ genres: {}, isSensitive: false }, target), criteria), 'GAS advanced/' + q);
  }
  for (const q of ['おの子', 'こしの推', '推のこ', 'おしの猫', '推しぬこ', 'こ推し', 'おしの子犬']) assert(!matcher.matches(q, target), 'reject missing/reordered/changed characters: ' + q);
}
// Additional works use their own paired readings; pure kana/kanji, missing or
// repeated anchors, and excessively long input never invoke the new supplement.
const generic = item('青い鳥の旅', 'あおいとりのたび');
for (const q of ['あおい鳥の旅', '青いとりの旅', '青い鳥のたび']) assert(matcher.matches(q, generic), q);
for (const q of ['青の鳥', '鳥い青の旅', '赤い鳥の旅', '青い犬の旅']) assert(!matcher.matches(q, generic), q);
assert(!matcher.matches('あおいとりのたび', generic));
assert(!matcher.matches('青鳥旅', generic));
assert(!matcher.matches('あい子', item('愛い子', 'あいいこい')));
assert(!matcher.matches('青いとり', item('青い鳥', 'よみなし')));
assert(!matcher.matches('青い' + '鳥'.repeat(129), generic));
// Compare the streaming automaton with complete enumeration only in tiny test
// fixtures, including overlap at alternative boundaries and internal substrings.
for (const pair of [generic, item('赤かな青かな緑', 'あかかなあおかなみどり'), illustration]) {
  const parts = c.compileAlignedTitleReadingLocal_(pair.title, pair.yomi);
  if (!parts) continue;
  let variants = [''];
  for (const choices of parts) variants = variants.flatMap(prefix => Array.from(choices, choice => prefix + choice));
  const queries = new Set(['青い犬の旅', '推しぬこ', '鳥い青の旅']);
  for (const v of variants) for (let start = 0; start < v.length; start++) for (let len = 1; len <= 7; len++) queries.add(v.slice(start, start + len));
  for (const q of queries) if (matcher.isMixed(q)) assert.equal(matcher.matches(q, pair), variants.some(v => v.includes(q)), q);
}
// Mutable index objects do not retain an obsolete title/reading alignment.
const mutable = item('青い鳥', 'あおいとり');
assert(matcher.matches('青いとり', mutable));
mutable.yomi = normalize('あおいねこ');
assert(!matcher.matches('青いとり', mutable));
assert(matcher.matches('青いねこ', mutable));

let revision = 'one';
let series = ['【推しの子】'];
const titles = ['【推しの子】 01', '【推しの子】 02', 'Glare×Sparkle : 〈推しの子〉1stイラスト集'];
c.fixture = { titles, yomis: ['おしのこ 01', 'おしのこ 02'], authors: ['テスト作者'] };
c.preview = [main, item(titles[1], 'おしのこ 02'), illustration];
read('SUGGEST_DATA = fixture; PREVIEW_INDEX = preview');
c.window.ShumiLibraryLocalIndex = { getRevision: () => revision, getSuggestionTitles: () => series.slice() };
for (const type of ['keyword', 'detailTitle']) for (const q of four) {
  const result = plain(c.suggest(q, type));
  assert(result.length > 0 && result.length <= 6, q + '/' + type);
  if (q === 'おしの子' || q === '推しのこ') assert.deepEqual(result, [series[0], titles[2]]);
}
const initial = read('normalizedSuggestionCache_');
c.preview = [item('青い鳥', 'あおいとり')]; read('PREVIEW_INDEX = preview');
assert.deepEqual(plain(c.suggest('おしの子', 'keyword')), []);
assert.notEqual(read('normalizedSuggestionCache_'), initial);
revision = 'two'; series = ['青い鳥']; c.fixture = { titles: series, yomis: ['あおいとり'], authors: [] }; read('SUGGEST_DATA = fixture');
assert.deepEqual(plain(c.suggest('青いとり', 'keyword')), ['青い鳥']);
assert.deepEqual(plain(c.suggest('おしの子', 'keyword')), []);
assert.deepEqual(plain(c.suggest('', 'keyword')), []);
// Existing nonempty candidate content/ranking remains exact, with six at most.
c.fixture = { titles: Array.from({ length: 8 }, (_, i) => '青いとりの本' + i), yomis: [], authors: [] }; read('SUGGEST_DATA = fixture'); series = [];
assert.deepEqual(plain(c.suggest('青いとり', 'keyword')), c.fixture.titles.slice(0, 6));
// Initial metadata can carry compact references to its existing title/yomi lists
// while the persistent index is absent. Old metadata stays compatible.
c.fixture = { titles: ['青い鳥'], yomis: ['あおいとり', 'あおいねこ'], authors: [], titleYomiPairs: [[0, 0], [-1, 0], [0, 9], null] };
read('SUGGEST_DATA = fixture; PREVIEW_INDEX = []');
assert.deepEqual(plain(c.suggest('青いとり', 'keyword')), ['青い鳥']);
const pairedPool = read('normalizedSuggestionCache_');
c.suggest('青いとり', 'keyword'); assert.equal(read('normalizedSuggestionCache_'), pairedPool);
c.fixture.titleYomiPairs[0][1] = 1;
assert.deepEqual(plain(c.suggest('青いとり', 'keyword')), []);
assert.notEqual(read('normalizedSuggestionCache_'), pairedPool);
assert.deepEqual(plain(c.suggest('青いねこ', 'detailTitle')), ['青い鳥']);
delete c.fixture.titleYomiPairs;
assert.deepEqual(plain(c.suggest('青いねこ', 'detailTitle')), []);
const data = { titles: ['青い鳥', '【推しの子】 01'], yomis: ['おしのこ 01', 'あおいとり'] };
assert.deepEqual(plain(server.buildTitleYomiPairsForPwa_([item('青い鳥','あおいとり'), main, main, item('読みなし','')], data)), [[0, 1], [1, 0]]);
assert.deepEqual(plain(server.buildTitleYomiPairsForPwa_([], undefined)), []);
console.log('anchored title/reading matching, negative cases, automaton equivalence, suggestions and revision checks ok');
