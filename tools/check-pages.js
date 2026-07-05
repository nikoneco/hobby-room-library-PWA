const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const docs = path.join(root, 'docs');

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function read(filePath) {
  return fs.readFileSync(filePath, 'utf8');
}

const index = read(path.join(docs, 'index.html'));
const manifest = JSON.parse(read(path.join(docs, 'manifest.webmanifest')));
const sw = read(path.join(docs, 'sw.js'));

[
  'manifest.webmanifest',
  'offline.html',
  'sw.js',
  'assets/css/pwa.css',
  'assets/js/gas-run-shim.js',
  'assets/js/pwa-client.js',
  'assets/logo.png',
  'assets/icons/icon-192.png',
  'assets/icons/icon-512.png'
].forEach(relativePath => {
  assert(fs.existsSync(path.join(docs, relativePath)), `${relativePath} exists`);
});

[
  path.join('assets', 'logo.png'),
  path.join('assets', 'icons', 'icon-192.png'),
  path.join('assets', 'icons', 'icon-512.png')
].forEach(relativePath => {
  const signature = fs.readFileSync(path.join(docs, relativePath)).subarray(0, 8);
  assert(signature.equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])), `${relativePath} is a PNG`);
});

assert(!index.includes('HtmlService.createHtmlOutputFromFile'), 'static index has no GAS template includes');
assert(index.includes('rel="manifest" href="./manifest.webmanifest"'), 'static index references manifest');
assert(index.includes('name="theme-color" content="#0b111a"'), 'static index uses dark PWA theme color');
assert(index.includes('apple-mobile-web-app-status-bar-style" content="black-translucent"'), 'static index uses translucent iOS standalone status bar');
assert(index.includes('id="pwaNetworkBanner"'), 'static index includes offline/network banner');
assert(index.includes('./assets/js/gas-run-shim.js'), 'static index loads GAS JSONP shim');
assert(index.includes('./assets/js/pwa-client.js'), 'static index loads PWA client');
assert(index.includes('./assets/css/pwa.css'), 'static index loads PWA CSS');
assert(index.includes('src="./assets/logo.png"'), 'static index uses local logo asset');

[
  'style.legacy-core.css',
  'style.legacy-modal.css',
  'style.shelf.css',
  'style.modern-core.css',
  'style.modern-modal.css',
  'style.modern-shelf.css',
  'style.responsive.css'
].forEach(fileName => {
  assert(index.includes(`./assets/css/${fileName}`), `static index references ${fileName}`);
  const source = read(path.join(docs, 'assets', 'css', fileName));
  assert(!/^\s*<style>/i.test(source), `${fileName} has no <style> wrapper`);
});

[
  'script.state.js',
  'script.images.js',
  'script.search.js',
  'script.render.js',
  'script.shelf.js',
  'script.modal.js',
  'script.boot.js'
].forEach(fileName => {
  assert(index.includes(`./assets/js/${fileName}`), `static index references ${fileName}`);
  const source = read(path.join(docs, 'assets', 'js', fileName));
  assert(!/^\s*<script>/i.test(source), `${fileName} has no <script> wrapper`);
});

assert(manifest.name === '趣味部屋図書館', 'manifest name is set');
assert(manifest.display === 'standalone', 'manifest display is standalone');
assert(manifest.theme_color === '#0b111a', 'manifest theme color matches dark app shell');
assert(manifest.background_color === '#0b111a', 'manifest splash background matches dark app shell');
assert(manifest.start_url === './', 'manifest start_url stays within docs scope');
assert(Array.isArray(manifest.icons) && manifest.icons.length >= 2, 'manifest has install icons');
assert(Array.isArray(manifest.shortcuts) && manifest.shortcuts.length >= 2, 'manifest has app shortcuts');
assert(!manifest.shortcuts.some(item => item.url === './?launch=recent'), 'manifest omits recent-book shortcut');
assert(manifest.shortcuts.some(item => item.url === './?launch=bookshelf'), 'manifest has bookshelf shortcut');
assert(manifest.shortcuts.some(item => item.url === './?launch=random'), 'manifest has random shortcut');

assert(sw.includes('offline.html'), 'service worker caches offline fallback');
assert(sw.includes('shumi-library-pwa-v44'), 'service worker has versioned cache');
assert(sw.includes('./assets/logo.png'), 'service worker caches local logo');
assert(sw.includes('SKIP_WAITING'), 'service worker supports update activation');
assert(sw.includes("const NAVIGATION_FALLBACK = './index.html'"), 'service worker uses cached app shell for offline navigation');
assert(sw.includes('isAppShellUrl_'), 'service worker recognizes app shell assets');
assert(sw.includes('return cached || refresh.then'), 'service worker serves app shell cache before network refresh');

const pwaCss = read(path.join(docs, 'assets', 'css', 'pwa.css'));
const pwaClient = read(path.join(docs, 'assets', 'js', 'pwa-client.js'));
const bootClient = read(path.join(docs, 'assets', 'js', 'script.boot.js'));
assert(pwaCss.includes('body.pwa-standalone .mobile-app-dock'), 'PWA CSS styles standalone dock');
assert(pwaCss.includes('--pwa-safe-top: env(safe-area-inset-top'), 'PWA CSS defines standalone top safe-area');
assert(pwaCss.includes('top: var(--pwa-safe-top)'), 'PWA CSS keeps sticky header below standalone status bar');
assert(pwaCss.includes('body.pwa-network-visible .mobile-app-dock'), 'PWA CSS offsets dock while network banner is visible');
assert(pwaCss.includes('body.pwa-update-visible .mobile-app-dock'), 'PWA CSS keeps dock stable while update toast is visible');
assert(pwaClient.includes("currentBannerKind && currentBannerKind !== 'update'"), 'PWA client separates update toast from network banner state');
assert(!pwaCss.includes('.pwa-recent-rail'), 'PWA CSS omits recent book rail');
assert(!pwaCss.includes('.pwa-recent-book'), 'PWA CSS omits recent book cards');
assert(pwaClient.includes("document.body.classList.add('pwa-shell')"), 'PWA client marks shell body');
assert(pwaClient.includes("window.matchMedia('(display-mode: standalone)')"), 'PWA client detects standalone display mode');
assert(bootClient.includes('clearLaunchActionFromUrl_'), 'boot client clears consumed PWA launch shortcut');
assert(bootClient.includes('window.history.replaceState'), 'boot client rewrites launch shortcut URL after use');
assert(!pwaClient.includes('shumiLibrary.pwaRecentBooks.v1'), 'PWA client does not persist recent books');
assert(!pwaClient.includes('pwaRecentRail'), 'PWA client does not render recent book rail');
assert(!pwaClient.includes('launch=recent'), 'PWA client omits recent launch flow');
assert(pwaCss.includes('.pwa-network-banner.is-notice'), 'PWA CSS styles notice banner');

const appendedScripts = [];
const timeouts = [];
const sandboxWindow = {
  addEventListener() {},
  setTimeout(callback) {
    timeouts.push(callback);
    return timeouts.length;
  },
  clearTimeout() {},
  ShumiLibraryPwa: {
    failures: [],
    cleared: 0,
    handleApiFailure(error) {
      this.failures.push(error && error.code);
    },
    clearApiFailure() {
      this.cleared += 1;
    }
  }
};
const sandboxDocument = {
  createElement(tagName) {
    return {
      tagName,
      async: false,
      src: '',
      parentNode: {
        removeChild() {}
      }
    };
  },
  head: {
    appendChild(script) {
      appendedScripts.push(script);
    }
  }
};
const sandboxNavigator = { onLine: true };

vm.runInNewContext(read(path.join(docs, 'assets', 'js', 'gas-run-shim.js')), {
  window: sandboxWindow,
  document: sandboxDocument,
  navigator: sandboxNavigator,
  URLSearchParams,
  btoa: value => Buffer.from(String(value), 'binary').toString('base64'),
  Proxy,
  Error,
  Date,
  String,
  Array,
  console
});

let successPayload = null;
let failureCode = '';
sandboxWindow.google.script.run
  .withSuccessHandler(data => {
    successPayload = data;
  })
  .withFailureHandler(error => {
    failureCode = error && error.code;
  })
  .searchBooksSimple('葬送');

assert(appendedScripts.length === 1, 'JSONP shim appends one script for search');
const searchUrl = new URL(appendedScripts[0].src);
assert(searchUrl.searchParams.get('api') === 'searchSimple', 'JSONP shim maps searchBooksSimple');
assert(!searchUrl.searchParams.has('keyword'), 'JSONP shim avoids direct keyword transfer');
assert(searchUrl.searchParams.get('keywordB64') === '6JGs6YCB', 'JSONP shim serializes keyword as Base64URL');
const callbackName = searchUrl.searchParams.get('callback');
assert(callbackName && typeof sandboxWindow[callbackName] === 'function', 'JSONP callback is registered');
sandboxWindow[callbackName]({ ok: true, data: [{ title: '葬送のフリーレン' }], error: null });
assert(Array.isArray(successPayload) && successPayload[0].title === '葬送のフリーレン', 'JSONP shim delivers success payload');
assert(failureCode === '', 'JSONP shim does not call failure on success');
assert(sandboxWindow.ShumiLibraryPwa.cleared === 1, 'JSONP shim clears network warning on success');

sandboxWindow.google.script.run
  .withSuccessHandler(() => {})
  .getAllBooks();
assert(appendedScripts.length === 2, 'JSONP shim appends one script for shelf');
const shelfUrl = new URL(appendedScripts[1].src);
assert(shelfUrl.searchParams.get('api') === 'shelf', 'JSONP shim maps getAllBooks to shelf');

sandboxWindow.google.script.run
  .withSuccessHandler(() => {})
  .getBookshelfBooks();
assert(appendedScripts.length === 3, 'JSONP shim appends one script for bookshelf');
const bookshelfUrl = new URL(appendedScripts[2].src);
assert(bookshelfUrl.searchParams.get('api') === 'shelf', 'JSONP shim maps getBookshelfBooks to shelf');

sandboxWindow.google.script.run
  .withSuccessHandler(() => {})
  .getBookshelfBooksChunk(300, 300);
assert(appendedScripts.length === 4, 'JSONP shim appends one script for shelf chunk');
const shelfChunkUrl = new URL(appendedScripts[3].src);
assert(shelfChunkUrl.searchParams.get('api') === 'shelfChunk', 'JSONP shim maps getBookshelfBooksChunk');
assert(shelfChunkUrl.searchParams.has('offsetB64'), 'JSONP shim serializes shelf chunk offset');
assert(shelfChunkUrl.searchParams.has('limitB64'), 'JSONP shim serializes shelf chunk limit');

sandboxWindow.google.script.run
  .withSuccessHandler(() => {})
  .getBookDetailByRowIndex(12);
assert(appendedScripts.length === 5, 'JSONP shim appends one script for book detail');
const bookDetailUrl = new URL(appendedScripts[4].src);
assert(bookDetailUrl.searchParams.get('api') === 'bookDetail', 'JSONP shim maps getBookDetailByRowIndex');
assert(bookDetailUrl.searchParams.has('rowIndexB64'), 'JSONP shim serializes book detail row index');

sandboxWindow.google.script.run
  .withSuccessHandler(() => {})
  .searchBooksSimple('');
assert(appendedScripts.length === 6, 'JSONP shim appends one script for blank search');
const blankSearchUrl = new URL(appendedScripts[5].src);
assert(blankSearchUrl.searchParams.get('api') === 'shelf', 'JSONP shim maps blank search to shelf');
assert(!blankSearchUrl.searchParams.has('keyword'), 'JSONP shim omits blank keyword');

sandboxNavigator.onLine = false;
sandboxWindow.google.script.run
  .withFailureHandler(error => {
    failureCode = error && error.code;
  })
  .getRandomBooks(10);
assert(failureCode === 'OFFLINE', 'JSONP shim reports offline before script injection');
assert(sandboxWindow.ShumiLibraryPwa.failures.includes('OFFLINE'), 'JSONP shim notifies PWA offline handler');

console.log('pages checks ok');
