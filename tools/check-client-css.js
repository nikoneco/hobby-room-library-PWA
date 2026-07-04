const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const indexPath = path.join(root, 'index.html');
const cssFiles = [
  'style.legacy-core.css.html',
  'style.legacy-modal.css.html',
  'style.shelf.css.html',
  'style.modern-core.css.html',
  'style.modern-modal.css.html',
  'style.modern-shelf.css.html',
  'style.responsive.css.html'
];

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function stripStyleWrapper(source, fileName) {
  assert(/^\s*<style>\s*/.test(source), `${fileName} starts with <style>`);
  assert(/\s*<\/style>\s*$/.test(source), `${fileName} ends with </style>`);
  return source
    .replace(/^\s*<style>\s*/, '')
    .replace(/\s*<\/style>\s*$/, '');
}

function stripCommentsAndStrings(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/"(?:\\.|[^"\\])*"/g, '""')
    .replace(/'(?:\\.|[^'\\])*'/g, "''");
}

function assertBalancedBraces(source) {
  let depth = 0;
  for (const char of stripCommentsAndStrings(source)) {
    if (char === '{') depth += 1;
    if (char === '}') depth -= 1;
    assert(depth >= 0, 'combined CSS has no premature closing brace');
  }
  assert(depth === 0, 'combined CSS braces are balanced');
}

const indexSource = fs.readFileSync(indexPath, 'utf8');

assert(!indexSource.includes("HtmlService.createHtmlOutputFromFile('style.css.html')"), 'index.html does not load style.css.html directly');
assert(indexSource.includes('id="spinner-detail"'), 'index.html includes spinner detail element');
assert(indexSource.includes('class="spinner-shelf"'), 'index.html includes spinner shelf motif');

let previousIndex = -1;
const cssSources = cssFiles.map(fileName => {
  const includeNeedle = `HtmlService.createHtmlOutputFromFile('${fileName}')`;
  const includeIndex = indexSource.indexOf(includeNeedle);
  assert(includeIndex !== -1, `index.html includes ${fileName}`);
  assert(includeIndex > previousIndex, `index.html includes ${fileName} in cascade order`);
  previousIndex = includeIndex;

  const source = fs.readFileSync(path.join(root, fileName), 'utf8');
  return stripStyleWrapper(source, fileName);
});

const combinedCss = cssSources.join('\n');
assertBalancedBraces(combinedCss);

[
  /\.spinner-panel\b/,
  /\.spinner-shelf\b/,
  /@keyframes\s+shelf-wait\b/,
  /\.spinner-detail\b/,
  /\.shelf-book\s*\{[\s\S]*?touch-action:\s*manipulation/
].forEach(pattern => {
  assert(pattern.test(combinedCss), `required interactive style is present: ${pattern}`);
});

[
  /\.book-summary\b/,
  /\.popup-meta-grid\b/,
  /\.shelf-view-summary\b/,
  /#backToTop\b/
].forEach(pattern => {
  assert(!pattern.test(combinedCss), `removed selector is absent: ${pattern}`);
});

console.log('client css checks ok');
