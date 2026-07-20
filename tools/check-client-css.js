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
  'style.responsive.css.html',
  'style.night-library.css.html'
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
  /\.shelf-book\s*\{[\s\S]*?touch-action:\s*manipulation/,
  /\.mobile-dock-view-switch\s*\{/,
  /\.mobile-dock-view-btn\.active\b/,
  /body:not\(\.mobile-dock-has-results\)\s+\.mobile-dock-view-switch\s*\{[\s\S]*?display:\s*none/,
  /\.view-toggle\s*\{[\s\S]*?display:\s*none/,
  /body\.shelf-popup-open\s+#result\s*\{[\s\S]*?visibility:\s*hidden/,
  /body\.shelf-popup-open\s+#image-popup-overlay\s*\{[\s\S]*?backdrop-filter:\s*none/,
  /body\.sandbox-redesign\s+\.preview-brand\b/,
  /body\.sandbox-redesign\.pwa-librarian-presence\s+\.app-brand-librarian-image\s*\{[\s\S]*?display:\s*block/,
  /body\.sandbox-redesign\s+\.pwa-settings-panel\s*\{[\s\S]*?calc\(env\(safe-area-inset-top\)\s*\+\s*0\.75rem\)/,
  /body\.sandbox-redesign\s+\.search-container\.shrink[\s\S]*?grid-template-areas:[\s\S]*?"brand status view"[\s\S]*?"brand form view"/,
  /body\.sandbox-redesign\s+\.search-container\.shrink[\s\S]*?padding-right:\s*max\(5\.5rem,\s*calc\(\(100vw\s*-\s*var\(--night-max\)\)\s*\/\s*2\)\)/,
  /body\.sandbox-redesign\s+\.view-toggle\s*\{[\s\S]*?position:\s*static[\s\S]*?grid-area:\s*view/,
  /body\.sandbox-redesign\s+\.search-container\.centered\s+\.search-status-area[\s\S]*?body\.sandbox-redesign\s+\.search-container\.shrink\.shelf-view-active\s+\.search-status-area\s*\{[^}]*min-width:\s*0[^}]*overflow:\s*visible/,
  /body\.sandbox-redesign\s+\.search-status-librarian-note\s*\{[^}]*min-width:\s*0[^}]*max-width:\s*100%[^}]*white-space:\s*normal[^}]*overflow-wrap:\s*anywhere/,
  /@media\s*\(max-width:\s*700px\)[\s\S]*?#image-popup-content\s*\{[^}]*overflow-y:\s*auto\s*!important[^}]*-webkit-overflow-scrolling:\s*touch[^}]*overscroll-behavior-y:\s*contain/,
  /html\.modal-open\s*\{[^}]*overflow:\s*hidden\s*!important[^}]*overscroll-behavior:\s*none/,
  /body\.modal-open\s*\{[^}]*position:\s*fixed[^}]*top:\s*var\(--modal-scroll-lock-y,[^}]*height:\s*100dvh[^}]*overscroll-behavior:\s*none/,
  /@media\s*\(max-width:\s*700px\)[\s\S]*?#image-popup-content\s*\{[^}]*touch-action:\s*pan-y/,
  /\.popup-summary-text\s*\{[^}]*touch-action:\s*pan-y/,
  /\.search-series-card\s*\{/,
  /\.search-result-series-list\s*\{[\s\S]*?scroll-snap-type:\s*x\s+mandatory/,
  /\.search-result-series-book-cover\s*\{[\s\S]*?aspect-ratio:\s*2\s*\/\s*3/,
  /@media\s*\(max-width:\s*760px\)[\s\S]*?\.search-container\.shrink[\s\S]*?flex-direction:\s*column/
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
