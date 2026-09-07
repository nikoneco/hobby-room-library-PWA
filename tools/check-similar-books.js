const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const source = fs.readFileSync(path.join(__dirname, '..', 'script.modal.js.html'), 'utf8')
  .replace(/^\s*<script>\s*/, '').split('function shouldIgnoreBookOpenSurfaceClick_')[0];
const context = vm.createContext({ isSensitiveBook_: book => Boolean(book.isSensitive), console });
vm.runInContext(source, context);
const book = (id, story = ['Fantasy'], theme = ['Travel', 'Magic'], mood = ['Calm'], extra = {}) => ({
  bookId: id, title: id, seriesKeyAuto: id, volume: 1,
  genreMeta: [['story', story], ['theme', theme], ['mood', mood], ['media', ['漫画']]]
    .flatMap(([category, names]) => names.map(name => ({ category, name }))), ...extra
});
const seed = book('seed');
const rank = (books, sourceBook = seed) => context.rankSimilarBooks_(sourceBook, books, 6);
const exact = book('exact');
assert.equal(rank([exact])[0].score, 100);
assert.equal(rank([book('partial', ['Fantasy'], ['Travel'], ['Calm'])])[0].score, 80);
assert.equal(rank([book('sparse', ['Fantasy'], [], [])])[0].score, 35);
assert.equal(rank([book('one-theme', [], ['Travel'], [])])[0].score, 20);
assert.equal(rank([book('both-themes', [], ['Travel', 'Magic'], [])])[0].score, 40);
assert.equal(rank([book('extra-theme', [], ['Travel', 'School'], [])])[0].score, 20);
assert.equal(rank([book('both-plus-extra', [], ['Travel', 'Magic', 'School'], [])])[0].score, 40);
assert.equal(rank([book('no-common-theme', [], ['School'], [])]).length, 0);
assert.equal(rank([book('one-source-theme', [], ['Travel', 'Magic'], [])],
  book('single-theme-source', [], ['Travel'], []))[0].score, 40);
assert.equal(rank([book('two-of-three', [], ['Travel', 'Magic'], [])],
  book('three-theme-source', [], ['Travel', 'Magic', 'School'], []))[0].score, 27);
assert.equal(rank([book('duplicate-theme', [], ['Travel', 'Travel'], [])],
  book('duplicate-source', [], ['Travel', 'Travel', 'Magic'], []))[0].score, 20);
assert.equal(rank([book('mood-only', [], [], ['Calm'])])[0].score, 25);
assert.equal(rank([book('story-union', ['Fantasy', 'Drama'], [], ['Calm'])])[0].score, 43);
assert.equal(rank([book('story-match', ['Fantasy'], [], []),
  book('theme-match', [], ['Travel', 'Magic'], [])])[0].book.bookId, 'theme-match');
assert.equal(rank([book('only-status', [], [], [], { genreMeta: [
  { category: 'status', name: '完結' }, { category: 'media', name: '漫画' }
] })]).length, 0);
assert.equal(rank([seed, book('next-volume', undefined, undefined, undefined, { seriesKeyAuto: 'seed', volume: 2 })]).length, 0);
const volumes = [book('v3', undefined, undefined, undefined, { seriesKeyAuto: 'other', volume: 3 }),
  book('v1', undefined, undefined, undefined, { seriesKeyAuto: 'other', volume: 1 })];
assert.equal(rank(volumes).length, 1);
assert.equal(rank(volumes)[0].book.bookId, 'v1');
assert.equal(rank(volumes.slice().reverse())[0].book.bookId, 'v1');
assert.equal(rank([book('adult', undefined, undefined, undefined, { isSensitive: true })]).length, 0);
assert.equal(rank([book('adult', undefined, undefined, undefined, { isSensitive: true })],
  book('adult-seed', undefined, undefined, undefined, { isSensitive: true })).length, 1);
assert.equal(rank([book('novel', undefined, undefined, undefined, { genreMeta: [
  { category: 'story', name: 'Fantasy' }, { category: 'media', name: '小説' }
] })]).length, 0);
assert.equal(rank([exact], book('empty', [], [], [])).length, 0);
const duplicateTags = book('duplicate');
duplicateTags.genreMeta.push(...duplicateTags.genreMeta);
assert.equal(rank([duplicateTags])[0].score, 100);
assert.equal(rank(Array.from({ length: 12 }, (_, i) => book('candidate' + i))).length, 6);
assert.equal(rank([book('<script>test</script>')]).length, 1);
console.log('similar books: scoring, missing tags, series deduplication, media, sensitive policy and limits ok');
