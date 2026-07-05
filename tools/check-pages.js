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
const pagesWorkflowPath = path.join(root, '.github', 'workflows', 'deploy-pages.yml');
const pagesWorkflow = read(pagesWorkflowPath);

[
  'manifest.webmanifest',
  'offline.html',
  'sw.js',
  'assets/css/pwa.css',
  'assets/js/gas-run-shim.js',
  'assets/js/pwa-client.js',
  'assets/logo.png',
  'assets/librarian-presence.jpg',
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

{
  const signature = fs.readFileSync(path.join(docs, 'assets', 'librarian-presence.jpg')).subarray(0, 3);
  assert(signature.equals(Buffer.from([0xff, 0xd8, 0xff])), 'assets/librarian-presence.jpg is a JPEG');
}

assert(!index.includes('HtmlService.createHtmlOutputFromFile'), 'static index has no GAS template includes');
assert(index.includes('rel="manifest" href="./manifest.webmanifest"'), 'static index references manifest');
assert(index.includes('interactive-widget=resizes-content'), 'static index requests keyboard viewport resizing');
assert(index.includes('name="theme-color" content="#0a1217"'), 'static index uses shinhaku PWA theme color');
assert(index.includes('rel="preconnect" href="https://script.google.com"'), 'static index preconnects to GAS endpoint host');
assert(index.includes('rel="preconnect" href="https://script.googleusercontent.com"'), 'static index preconnects to GAS response host');
assert(index.includes('id="pwa-critical-style"'), 'static index includes critical shell paint style');
assert(index.includes('html{background:#0a1217'), 'critical style paints shinhaku shell before CSS loads');
assert(index.includes('apple-mobile-web-app-status-bar-style" content="black-translucent"'), 'static index uses translucent iOS standalone status bar');
assert(index.includes('id="pwaNetworkBanner"'), 'static index includes offline/network banner');
assert(index.includes('./assets/js/gas-run-shim.js'), 'static index loads GAS JSONP shim');
assert(index.includes('./assets/js/pwa-client.js'), 'static index loads PWA client');
assert(index.includes('./assets/css/pwa.css'), 'static index loads PWA CSS');
assert(index.includes('src="./assets/logo.png"'), 'static index uses local logo asset');
assert(index.includes('id="pwaSettingsButton"'), 'static index includes PWA settings button');
assert(index.includes('id="pwaSettingsPanel"'), 'static index includes PWA settings panel');
assert(index.includes('id="pwaLibrarianPresence"'), 'static index includes librarian presence setting');
assert(index.includes('id="pwaQuietMotion"'), 'static index includes quiet motion setting');
['shinhaku', 'kohi', 'shikon', 'kohaku'].forEach(value => {
  assert(index.includes(`name="pwaTheme" value="${value}"`), `static index includes ${value} theme option`);
});
['深碧', '紅緋', '紫紺', '琥珀'].forEach(label => {
  assert(index.includes(`<span>${label}</span>`), `static index labels ${label} theme`);
});
assert(pagesWorkflow.includes('actions/setup-node@v5'), 'Pages workflow sets up Node.js');
assert(pagesWorkflow.includes('node tools/build-pages.js'), 'Pages workflow builds docs artifact before checks');
assert(pagesWorkflow.includes('node tools/check-client-js.js'), 'Pages workflow checks client JavaScript before deploy');
assert(pagesWorkflow.includes('node tools/check-client-css.js'), 'Pages workflow checks client CSS before deploy');
assert(pagesWorkflow.includes('node tools/check-pages.js'), 'Pages workflow checks static Pages artifact before deploy');
assert(pagesWorkflow.includes('node tools/check-server-api.js'), 'Pages workflow checks GAS API surface before deploy');
assert(pagesWorkflow.includes('actions/upload-pages-artifact@v4'), 'Pages workflow uploads docs artifact');
assert(pagesWorkflow.includes('path: docs'), 'Pages workflow deploys docs directory');
assert(pagesWorkflow.includes('pages: write'), 'Pages workflow has pages write permission');
assert(pagesWorkflow.includes('id-token: write'), 'Pages workflow has OIDC permission');
assert(pagesWorkflow.includes('actions/deploy-pages@v4'), 'Pages workflow deploys to GitHub Pages');

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
assert(manifest.id === './', 'manifest has stable app id');
assert(manifest.lang === 'ja', 'manifest language is Japanese');
assert(manifest.display === 'standalone', 'manifest display is standalone');
assert(Array.isArray(manifest.display_override) && manifest.display_override.includes('standalone'), 'manifest has display override fallback');
assert(manifest.theme_color === '#0a1217', 'manifest theme color matches shinhaku app shell');
assert(manifest.background_color === '#0a1217', 'manifest splash background matches shinhaku app shell');
assert(manifest.start_url === './', 'manifest start_url stays within docs scope');
assert(Array.isArray(manifest.categories) && manifest.categories.includes('books'), 'manifest declares library category');
assert(manifest.prefer_related_applications === false, 'manifest keeps web app as preferred app');
assert(Array.isArray(manifest.icons) && manifest.icons.length >= 2, 'manifest has install icons');
assert(Array.isArray(manifest.shortcuts) && manifest.shortcuts.length >= 3, 'manifest has app shortcuts');
assert(!manifest.shortcuts.some(item => item.url === './?launch=recent'), 'manifest omits recent-book shortcut');
assert(manifest.shortcuts.some(item => item.url === './?launch=search'), 'manifest has search shortcut');
assert(manifest.shortcuts.some(item => item.url === './?launch=bookshelf'), 'manifest has bookshelf shortcut');
assert(manifest.shortcuts.some(item => item.url === './?launch=random'), 'manifest has random shortcut');

assert(sw.includes('offline.html'), 'service worker caches offline fallback');
assert(/shumi-library-pwa-[a-f0-9]{12}/.test(sw), 'service worker cache name is content hashed');
assert(sw.includes('./assets/logo.png'), 'service worker caches local logo');
assert(sw.includes('./assets/librarian-presence.jpg'), 'service worker caches librarian presence logo');
assert(sw.includes('SKIP_WAITING'), 'service worker supports update activation');
assert(sw.includes("const NAVIGATION_FALLBACK = './index.html'"), 'service worker uses cached app shell for offline navigation');
assert(sw.includes('isAppShellUrl_'), 'service worker recognizes app shell assets');
assert(sw.includes("if (request.mode === 'navigate')"), 'service worker handles app navigation requests');
assert(sw.includes('caches.match(cacheKey).then(cached => {'), 'service worker serves cached app shell for navigation');
assert(sw.includes('return cached || refresh.then'), 'service worker serves app shell cache before network refresh');
const buildScript = read(path.join(root, 'tools', 'build-pages.js'));
assert(buildScript.includes("crypto.createHash('sha256')"), 'build script hashes app shell for service worker cache');
assert(buildScript.includes('buildAppShellCacheName_'), 'build script derives service worker cache name from app shell');

const pwaCss = read(path.join(docs, 'assets', 'css', 'pwa.css'));
const pwaClient = read(path.join(docs, 'assets', 'js', 'pwa-client.js'));
const bootClient = read(path.join(docs, 'assets', 'js', 'script.boot.js'));
assert(pwaCss.includes('body.pwa-standalone .mobile-app-dock'), 'PWA CSS styles standalone dock');
assert(pwaCss.includes('.pwa-settings-button'), 'PWA CSS styles settings button');
assert(pwaCss.includes('.pwa-settings-panel'), 'PWA CSS styles settings panel');
assert(pwaCss.includes('.pwa-settings-button ~ .view-toggle'), 'PWA CSS keeps mobile view toggle away from settings button');
assert(pwaCss.includes('left: max(8px, env(safe-area-inset-left))'), 'PWA CSS moves mobile view toggle to the left edge');
assert(pwaCss.includes('body.pwa-theme-shinhaku'), 'PWA CSS includes shinhaku theme');
assert(pwaCss.includes('body.pwa-theme-kohi'), 'PWA CSS includes kohi theme');
assert(pwaCss.includes('body.pwa-theme-shikon'), 'PWA CSS includes shikon theme');
assert(pwaCss.includes('body.pwa-theme-kohaku'), 'PWA CSS includes kohaku theme');
assert(pwaCss.includes('body.pwa-librarian-presence #logoResetBtn.logo'), 'PWA CSS styles librarian presence logo');
assert(pwaCss.includes('body.pwa-quiet-motion .result-fade.show'), 'PWA CSS adds quiet motion option');
assert(pwaCss.includes('--pwa-accent-rgb'), 'PWA CSS uses theme color variables for detailed accents');
assert(pwaCss.includes('--pwa-safe-top: env(safe-area-inset-top'), 'PWA CSS defines standalone top safe-area');
assert(pwaCss.includes('top: var(--pwa-safe-top)'), 'PWA CSS keeps sticky header below standalone status bar');
assert(pwaCss.includes('body.pwa-network-visible .mobile-app-dock'), 'PWA CSS offsets dock while network banner is visible');
assert(pwaCss.includes('body.pwa-update-visible .mobile-app-dock'), 'PWA CSS keeps dock stable while update toast is visible');
assert(pwaClient.includes("currentBannerKind && currentBannerKind !== 'update'"), 'PWA client separates update toast from network banner state');
assert(!pwaCss.includes('.pwa-recent-rail'), 'PWA CSS omits recent book rail');
assert(!pwaCss.includes('.pwa-recent-book'), 'PWA CSS omits recent book cards');
assert(pwaClient.includes("document.body.classList.add('pwa-shell')"), 'PWA client marks shell body');
assert(pwaClient.includes("window.matchMedia('(display-mode: standalone)')"), 'PWA client detects standalone display mode');
assert(pwaClient.includes('requestServiceWorkerUpdate_'), 'PWA client can request service worker update checks');
assert(pwaClient.includes("document.addEventListener('visibilitychange'"), 'PWA client checks updates when returning to foreground');
assert(pwaClient.includes("window.addEventListener('focus'"), 'PWA client checks updates on app focus');
assert(pwaClient.includes("window.addEventListener('beforeinstallprompt'"), 'PWA client handles install prompt availability');
assert(pwaClient.includes('INSTALL_PROMPT_STORAGE_KEY'), 'PWA client remembers dismissed install prompt');
assert(pwaClient.includes("window.addEventListener('appinstalled'"), 'PWA client handles completed installation');
assert(pwaClient.includes('IOS_INSTALL_STORAGE_KEY'), 'PWA client remembers dismissed iOS install hint');
assert(pwaClient.includes('THEME_STORAGE_KEY'), 'PWA client persists selected color theme');
assert(pwaClient.includes('LIBRARIAN_PRESENCE_STORAGE_KEY'), 'PWA client persists librarian presence setting');
assert(pwaClient.includes('QUIET_MOTION_STORAGE_KEY'), 'PWA client persists quiet motion setting');
assert(pwaClient.includes('LIBRARIAN_LOGO_SRC'), 'PWA client can switch to librarian logo');
assert(pwaClient.includes('getLibrarianText'), 'PWA client exposes librarian text hook');
assert(pwaClient.includes('THEME_COLORS'), 'PWA client maps themes to shell colors');
assert(pwaClient.includes("THEME_OPTIONS = ['shinhaku', 'kohi', 'shikon', 'kohaku']"), 'PWA client exposes the four named themes');
assert(pwaClient.includes('LEGACY_THEME_ALIASES'), 'PWA client migrates old stored theme values');
assert(pwaClient.includes('meta[name="theme-color"]'), 'PWA client updates browser theme color');
assert(pwaClient.includes('moveSensitiveToggleToSettings_'), 'PWA client moves sensitive toggle into settings');
assert(pwaClient.includes('bindSettingsPanel_'), 'PWA client binds settings panel controls');
assert(pwaClient.includes('function isIosLike_'), 'PWA client detects iOS-like browsers');
assert(pwaClient.includes('showIosInstallHint_'), 'PWA client can show iOS install hint');
assert(pwaClient.includes('INSTALL_HINT_AUTO_HIDE_MS'), 'PWA client auto-hides install hints');
assert(pwaClient.includes('autoHideInstallHint_'), 'PWA client schedules install hint auto-hide');
assert(pwaCss.includes('.pwa-network-banner-action-muted'), 'PWA CSS styles secondary banner action');
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
