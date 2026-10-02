const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const source = fs.readFileSync(path.join(__dirname, '..', 'script.images.js.html'), 'utf8')
  .replace(/^\s*<script>\s*/, '').replace(/\s*<\/script>\s*$/, '');

function harness() {
  const context = vm.createContext({
    console: { log() {} }, URLSearchParams,
    NO_IMAGE_URL: 'https://example.test/no-image.jpg',
    SENSITIVE_THEME_NAME: '18禁', SENSITIVE_COVER_STORAGE_KEY: 'sensitive',
    localStorage: { getItem() { return null; } },
    window: { location: { search: '?debugImageStats=1' } }
  });
  vm.runInContext(source, context);
  const read = expression => vm.runInContext(expression, context);
  function image() {
    const classes = new Set();
    const assignments = [];
    return {
      classes, assignments, naturalWidth: 0, naturalHeight: 0,
      classList: { add: name => classes.add(name), remove: name => classes.delete(name) },
      setAttribute() {},
      set src(value) { this.currentSrc = value; assignments.push(value); },
      get src() { return this.currentSrc; },
      load(width = 300, height = 430) { this.naturalWidth = width; this.naturalHeight = height; this.onload(); }
    };
  }
  return { context, read, image };
}
const svg = url => decodeURIComponent(url.split(',').slice(1).join(','));

{
  const { context: c } = harness();
  const book = { title: '日本語の本', author: '木皿 泉', volume: 3, isbn: '9784757564510',
    fallbackImg: 'https://example.test/fallback.jpg', fallbackImageSource: 'Manual' };
  const manual = c.buildBookImageCandidates_(book);
  assert.equal(manual[0].label, 'Manual');
  assert.equal(manual[1].label, 'Hanmoto600');
  assert.equal(manual[2].detail, 'GeneratedCover');
  const automatic = c.buildBookImageCandidates_({ ...book, fallbackImageSource: 'RakutenBooks' });
  assert.equal(automatic[0].label, 'Hanmoto600');
  assert.equal(automatic[1].label, 'Fallback');
  assert.equal(automatic[2].label, 'NO_IMAGE');
  const noIsbn = c.buildBookImageCandidates_({ title: '書誌のみ', img: c.NO_IMAGE_URL });
  assert.equal(noIsbn[0].detail, 'GeneratedCover', 'legacy placeholder is not a real candidate');
  const hidden = c.buildBookImageCandidates_({ ...book, isSensitive: true });
  assert.equal(hidden.length, 1);
  assert.equal(hidden[0].detail, 'SensitiveHidden');
}

{
  const { context: c } = harness();
  const unsafe = '</text><script>alert("x")</script>&\' <image href="https://evil.test"/>';
  const markup = svg(c.buildGeneratedBookCoverUrl_({ title: unsafe, author: unsafe + '\ud800\u0000' }));
  assert(!markup.includes('<script>'));
  assert(!markup.includes('<image '));
  assert(markup.includes('&lt;'));
  assert(markup.includes('&amp;'));
  assert(markup.includes('&quot;'));
  assert(!/[\ud800\u0000]/.test(markup));
  const long = svg(c.buildGeneratedBookCoverUrl_({ title: '長い書名の日本語と ABCDE '.repeat(50), author: '多数の人名 '.repeat(40) }));
  assert(long.includes('…'));
  assert.equal((long.match(/<tspan /g) || []).length, 11, 'title and author have finite separate line budgets');
  const people = svg(c.buildGeneratedBookCoverUrl_({ title: '複数の人', author: '木皿 泉 / 山田 あかね', contributors: ['改変されない名前'] }));
  assert(people.includes('木皿 泉'));
  assert(people.includes('山田 あかね'));
  assert(!people.includes('改変されない名前'), 'original author remains authoritative');
  const onlyPeople = svg(c.buildGeneratedBookCoverUrl_({ title: '著者配列', contributors: ['木皿 泉', '山田 あかね'] }));
  assert(onlyPeople.includes('木皿 泉'));
  assert(onlyPeople.includes('山田 あかね'));
  assert(svg(c.buildGeneratedBookCoverUrl_({})).includes('書名未登録'));
  for (const volume of [undefined, null, 0, -1, '不明', 1.5]) {
    assert.equal(c.getGeneratedCoverVolumeLabel_({ volume }, '作品'), '');
  }
  assert.equal(c.getGeneratedCoverVolumeLabel_({ volume: 3 }, '作品'), '3巻');
  for (const title of ['作品 第3巻', '第３巻: 続きの話', '作品 3', '作品 (3)', '作品 Vol.3: 続き', '作品 (3) 続きの話', '作品 03 特装版']) {
    assert.equal(c.getGeneratedCoverVolumeLabel_({ volume: 3 }, title), '', title);
  }
  assert.equal(c.getGeneratedCoverVolumeLabel_({ volume: 1 }, '1984'), '1巻');
  for (const title of ['No.6 #1', '作品 Volume01', '作品〈1〉', '作品×01', '作品 1(旅立ちの聖職者)', '作品 ＃１']) {
    assert.equal(c.getGeneratedCoverVolumeLabel_({ volume: 1 }, title), '', title);
    assert(!svg(c.buildGeneratedBookCoverUrl_({ title, volume: 1 })).includes('>1巻<'), title);
  }
}

{
  const { context: c, read, image } = harness();
  const book = { title: '候補のある本', author: '著者', isbn: '9784757564510',
    fallbackImg: 'https://example.test/real.jpg', fallbackImageSource: 'RakutenBooks' };
  c.resetImageLoadStats_([book]);
  const img = image();
  let settled = 0;
  c.setupBookImageElement_(img, book, { track: true, trackKey: 'real', onSettled() { settled += 1; } });
  const primary = img.src;
  assert.equal(img.assignments.length, 1, 'no generated preview while a real image is pending');
  assert(!img.classes.has('book-image-generated-cover'));
  img.load(50, 71);
  assert.equal(img.src, book.fallbackImg, 'small server dummy continues to fallback');
  img.load(400, 600);
  assert.equal(settled, 1);
  assert.equal(read('IMAGE_LOAD_STATS.loaded'), 1);
  const detail = image();
  c.setupBookImageElement_(detail, book);
  assert.equal(detail.src, book.fallbackImg, 'known good image is reused across surfaces');
  detail.onerror();
  assert.equal(detail.src, primary, 'failure evicts the known good cache');
  const retry = image();
  c.setupBookImageElement_(retry, book);
  assert.equal(retry.src, primary);
  retry.onerror();
  retry.onerror();
  assert(retry.src.startsWith('data:image/svg+xml'));
  retry.load();
  const reopen = image();
  c.setupBookImageElement_(reopen, book);
  assert.equal(reopen.src, primary, 'generated cover never suppresses later real-image recovery');
}

{
  const { context: c, read, image } = harness();
  const book = { title: '画像なし', author: '著者' };
  c.resetImageLoadStats_([book]);
  const img = image();
  let settled = 0;
  c.setupBookImageElement_(img, book, { track: true, trackKey: 'missing', onSettled() { settled += 1; } });
  assert(img.src.startsWith('data:image/svg+xml'));
  assert(img.classes.has('book-image-generated-cover'));
  img.load();
  assert.equal(read('IMAGE_LOAD_STATS.noImage'), 1, 'generated covers still mean no real cover in diagnostics');
  assert.equal(read('IMAGE_LOAD_STATS.loaded'), 0);
  assert.equal(settled, 1);
  const failed = image();
  let failuresSettled = 0;
  c.setupBookImageElement_(failed, book, { onSettled() { failuresSettled += 1; } });
  failed.onerror();
  assert.equal(failed.src, c.NO_IMAGE_URL);
  assert(!failed.classes.has('book-image-generated-cover'));
  failed.onerror(); failed.onerror(); failed.onload();
  assert.equal(failed.assignments.length, 2, 'generated and legacy failures cannot loop');
  assert.equal(failuresSettled, 1);
  c.buildGeneratedBookCoverUrl_ = () => c.NO_IMAGE_URL;
  const generatorFailure = image();
  c.setupBookImageElement_(generatorFailure, book);
  assert.equal(generatorFailure.src, c.NO_IMAGE_URL);
  assert.equal(c.buildBookImageCandidates_(book).length, 1);
}

console.log('Fallback cover checks passed.');
