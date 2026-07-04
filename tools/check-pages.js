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
  'assets/icons/icon-192.png',
  'assets/icons/icon-512.png'
].forEach(relativePath => {
  assert(fs.existsSync(path.join(docs, relativePath)), `${relativePath} exists`);
});

['icon-192.png', 'icon-512.png'].forEach(fileName => {
  const signature = fs.readFileSync(path.join(docs, 'assets', 'icons', fileName)).subarray(0, 8);
  assert(signature.equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])), `${fileName} is a PNG`);
});

assert(!index.includes('HtmlService.createHtmlOutputFromFile'), 'static index has no GAS template includes');
assert(index.includes('rel="manifest" href="./manifest.webmanifest"'), 'static index references manifest');
assert(index.includes('id="pwaNetworkBanner"'), 'static index includes offline/network banner');
assert(index.includes('./assets/js/gas-run-shim.js'), 'static index loads GAS JSONP shim');
assert(index.includes('./assets/js/pwa-client.js'), 'static index loads PWA client');
assert(index.includes('./assets/css/pwa.css'), 'static index loads PWA CSS');

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
assert(manifest.start_url === './', 'manifest start_url stays within docs scope');
assert(Array.isArray(manifest.icons) && manifest.icons.length >= 2, 'manifest has install icons');

assert(sw.includes('offline.html'), 'service worker caches offline fallback');
assert(sw.includes('shumi-library-pwa-v1'), 'service worker has versioned cache');

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
assert(searchUrl.searchParams.get('keyword') === '葬送', 'JSONP shim serializes keyword');
const callbackName = searchUrl.searchParams.get('callback');
assert(callbackName && typeof sandboxWindow[callbackName] === 'function', 'JSONP callback is registered');
sandboxWindow[callbackName]({ ok: true, data: [{ title: '葬送のフリーレン' }], error: null });
assert(Array.isArray(successPayload) && successPayload[0].title === '葬送のフリーレン', 'JSONP shim delivers success payload');
assert(failureCode === '', 'JSONP shim does not call failure on success');
assert(sandboxWindow.ShumiLibraryPwa.cleared === 1, 'JSONP shim clears network warning on success');

sandboxNavigator.onLine = false;
sandboxWindow.google.script.run
  .withFailureHandler(error => {
    failureCode = error && error.code;
  })
  .getRandomBooks(10);
assert(failureCode === 'OFFLINE', 'JSONP shim reports offline before script injection');
assert(sandboxWindow.ShumiLibraryPwa.failures.includes('OFFLINE'), 'JSONP shim notifies PWA offline handler');

console.log('pages checks ok');
