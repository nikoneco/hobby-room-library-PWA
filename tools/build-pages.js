const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const root = path.resolve(__dirname, '..');
const docsDir = path.join(root, 'docs');
const cssDir = path.join(docsDir, 'assets', 'css');
const jsDir = path.join(docsDir, 'assets', 'js');
const iconDir = path.join(docsDir, 'assets', 'icons');

const gasEndpoint = 'https://script.google.com/macros/s/AKfycbzAfn1SJqfKCRExekRlBMsbo9w4ZwcLNH_W6OJ-1ekS9LUJudAISNhtaGt6kPzAwEWYeQ/exec';

const cssFiles = [
  'style.legacy-core.css.html',
  'style.legacy-modal.css.html',
  'style.shelf.css.html',
  'style.modern-core.css.html',
  'style.modern-modal.css.html',
  'style.modern-shelf.css.html',
  'style.responsive.css.html'
];

const jsFiles = [
  'script.state.js.html',
  'script.images.js.html',
  'script.search.js.html',
  'script.render.js.html',
  'script.shelf.js.html',
  'script.modal.js.html',
  'script.boot.js.html'
];

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function readUtf8(fileName) {
  return fs.readFileSync(path.join(root, fileName), 'utf8');
}

function stripWrapper(source, tagName) {
  const open = new RegExp(`^\\s*<${tagName}>\\s*`, 'i');
  const close = new RegExp(`\\s*</${tagName}>\\s*$`, 'i');
  return source.replace(open, '').replace(close, '');
}

function cssOutName(fileName) {
  return fileName.replace(/\.css\.html$/, '.css');
}

function jsOutName(fileName) {
  return fileName.replace(/\.js\.html$/, '.js');
}

function buildStaticIndex() {
  let source = readUtf8('index.html');

  source = source.replace('<html>', '<html lang="ja">');

  source = source.replace(
    /<title>[^<]*<\/title>/,
    [
      '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">',
      '<meta name="theme-color" content="#2f5f4a">',
      '<meta name="apple-mobile-web-app-capable" content="yes">',
      '<meta name="apple-mobile-web-app-title" content="趣味部屋図書館">',
      '<meta name="apple-mobile-web-app-status-bar-style" content="default">',
      '<link rel="manifest" href="./manifest.webmanifest">',
      '<link rel="apple-touch-icon" href="./assets/icons/icon-192.png">',
      '<title>趣味部屋図書館</title>'
    ].join('\n  ')
  );

  source = source.replace(
    'https://i.imgur.com/szIBHwj.png',
    './assets/logo.png'
  );

  source = source.replace(
    /\s*<\?!= HtmlService\.createHtmlOutputFromFile\('([^']+\.css\.html)'\)\.getContent\(\); \?>/g,
    (match, fileName) => `\n  <link rel="stylesheet" href="./assets/css/${cssOutName(fileName)}">`
  );

  source = source.replace(
    '</head>',
    '  <link rel="stylesheet" href="./assets/css/pwa.css">\n</head>'
  );

  source = source.replace(
    /\s*<\?!= HtmlService\.createHtmlOutputFromFile\('script\.state\.js\.html'\)\.getContent\(\); \?>/,
    [
      '\n  <script src="./assets/js/gas-run-shim.js"></script>',
      '  <script src="./assets/js/pwa-client.js"></script>',
      '  <script src="./assets/js/script.state.js"></script>'
    ].join('\n')
  );

  source = source.replace(
    /\s*<\?!= HtmlService\.createHtmlOutputFromFile\('([^']+\.js\.html)'\)\.getContent\(\); \?>/g,
    (match, fileName) => `\n  <script src="./assets/js/${jsOutName(fileName)}"></script>`
  );

  source = source.replace(
    /(<body>)/,
    `$1\n  <div id="pwaNetworkBanner" class="pwa-network-banner" role="status" aria-live="polite" hidden></div>`
  );

  return source;
}

function writeStaticAssets() {
  cssFiles.forEach(fileName => {
    fs.writeFileSync(
      path.join(cssDir, cssOutName(fileName)),
      stripWrapper(readUtf8(fileName), 'style'),
      'utf8'
    );
  });

  jsFiles.forEach(fileName => {
    fs.writeFileSync(
      path.join(jsDir, jsOutName(fileName)),
      stripWrapper(readUtf8(fileName), 'script'),
      'utf8'
    );
  });
}

function writePwaCss() {
  const css = `
.pwa-network-banner {
  position: fixed;
  left: max(12px, env(safe-area-inset-left));
  right: max(12px, env(safe-area-inset-right));
  bottom: max(12px, env(safe-area-inset-bottom));
  z-index: 12000;
  padding: 12px 14px;
  border: 1px solid rgba(47, 95, 74, 0.22);
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.96);
  color: #1d352b;
  box-shadow: 0 10px 26px rgba(26, 37, 32, 0.16);
  font-size: 0.92rem;
  line-height: 1.55;
}

.pwa-network-banner.is-error {
  border-color: rgba(166, 73, 58, 0.28);
  color: #5f2f26;
}

@media (max-width: 640px) {
  .pwa-network-banner {
    font-size: 0.86rem;
    padding: 10px 12px;
  }
}
`.trim();

  fs.writeFileSync(path.join(cssDir, 'pwa.css'), `${css}\n`, 'utf8');
}

function writeGasRunShim() {
  const js = `
(function() {
  'use strict';

  const GAS_JSONP_ENDPOINT = ${JSON.stringify(gasEndpoint)};
  const JSONP_TIMEOUT_MS = 60000;

  const METHOD_CONFIG = {
    getInitialSearchData: { api: 'initial', argNames: [] },
    getSuggestData: { api: 'suggest', argNames: [] },
    getAdvancedSearchOptions: { api: 'advancedOptions', argNames: [] },
    getPreviewIndex: { api: 'previewIndex', argNames: [] },
    countPreviewMatchesAuthoritative: {
      api: 'countPreview',
      argNames: [
        'keyword',
        'detailTitle',
        'detailYomi',
        'detailAuthor',
        'detailPublisher',
        'detailStory',
        'detailTheme',
        'detailMood',
        'detailStatus',
        'detailReleasedFromYear',
        'detailReleasedFromMonth',
        'detailReleasedToYear',
        'detailReleasedToMonth'
      ]
    },
    searchBooksSimple: { api: 'searchSimple', argNames: ['keyword'] },
    searchBooksAdvanced: {
      api: 'searchAdvanced',
      argNames: [
        'keyword',
        'detailTitle',
        'detailYomi',
        'detailAuthor',
        'detailPublisher',
        'detailStory',
        'detailTheme',
        'detailMood',
        'detailStatus',
        'detailReleasedFromYear',
        'detailReleasedFromMonth',
        'detailReleasedToYear',
        'detailReleasedToMonth'
      ]
    },
    getRandomBooks: { api: 'random', argNames: ['count'] },
    getAllBooks: { api: 'shelf', argNames: [] },
    getBookshelfBooks: { api: 'shelf', argNames: [] },
    getBookshelfBooksChunk: { api: 'shelfChunk', argNames: ['offset', 'limit'] },
    getBooksBySeriesKey: { api: 'series', argNames: ['seriesKeyAuto'] }
  };

  let requestSeq = 0;
  const runnerState = {
    successHandler: null,
    failureHandler: null
  };

  function resetRunnerState_() {
    runnerState.successHandler = null;
    runnerState.failureHandler = null;
  }

  function createError_(message, code, details) {
    const error = new Error(message || '通信に失敗しました');
    error.code = code || 'JSONP_ERROR';
    if (details) error.details = details;
    return error;
  }

  function notifyFailure_(error) {
    if (window.ShumiLibraryPwa && typeof window.ShumiLibraryPwa.handleApiFailure === 'function') {
      window.ShumiLibraryPwa.handleApiFailure(error);
    }
  }

  function notifySuccess_() {
    if (window.ShumiLibraryPwa && typeof window.ShumiLibraryPwa.clearApiFailure === 'function') {
      window.ShumiLibraryPwa.clearApiFailure();
    }
  }

  function invokeFailure_(handler, error) {
    notifyFailure_(error);
    if (typeof handler === 'function') {
      handler(error);
    }
  }

  function encodeParamValue_(value) {
    const utf8Binary = encodeURIComponent(String(value)).replace(/%([0-9A-F]{2})/g, function(match, hex) {
      return String.fromCharCode(parseInt(hex, 16));
    });

    return btoa(utf8Binary)
      .replace(/\\+/g, '-')
      .replace(/\\//g, '_')
      .replace(/=+$/g, '');
  }

  function appendArgs_(params, argNames, args) {
    (argNames || []).forEach(function(name, index) {
      const value = args[index];
      if (value === undefined || value === null) return;
      params.set(name + 'B64', encodeParamValue_(value));
    });
  }

  function invokeJsonp_(methodName, args, successHandler, failureHandler) {
    let config = METHOD_CONFIG[methodName];
    if (methodName === 'searchBooksSimple' && !String(args[0] || '').trim()) {
      config = METHOD_CONFIG.getAllBooks;
      args = [];
    }
    if (!config) {
      if (methodName === 'saveWebAppUserPreferences') {
        if (typeof successHandler === 'function') {
          window.setTimeout(function() {
            successHandler(args[0] || {});
          }, 0);
        }
        return;
      }

      invokeFailure_(
        failureHandler,
        createError_('未対応のAPIです: ' + methodName, 'UNSUPPORTED_API')
      );
      return;
    }

    if (navigator && navigator.onLine === false) {
      invokeFailure_(
        failureHandler,
        createError_('端末がオフラインです。通信が戻ってから再試行してください。', 'OFFLINE')
      );
      return;
    }

    const callbackName = '__shumiLibraryJsonp_' + Date.now() + '_' + (++requestSeq);
    const params = new URLSearchParams();
    const script = document.createElement('script');
    let finished = false;
    let timeoutId = 0;

    params.set('api', config.api);
    params.set('callback', callbackName);
    params.set('rq', String(Date.now()));
    appendArgs_(params, config.argNames, args);

    function cleanup_() {
      if (timeoutId) window.clearTimeout(timeoutId);
      try {
        delete window[callbackName];
      } catch (e) {
        window[callbackName] = undefined;
      }
      if (script.parentNode) {
        script.parentNode.removeChild(script);
      }
    }

    window[callbackName] = function(envelope) {
      if (finished) return;
      finished = true;
      cleanup_();

      if (!envelope || envelope.ok === false) {
        const errorInfo = envelope && envelope.error ? envelope.error : {};
        invokeFailure_(
          failureHandler,
          createError_(errorInfo.message || 'APIからエラーが返りました。', 'API_ERROR', errorInfo)
        );
        return;
      }

      notifySuccess_();
      if (typeof successHandler === 'function') {
        successHandler(envelope.data);
      }
    };

    timeoutId = window.setTimeout(function() {
      if (finished) return;
      finished = true;
      cleanup_();
      invokeFailure_(
        failureHandler,
        createError_('通信がタイムアウトしました。時間を置いて再度お試しください。', 'TIMEOUT')
      );
    }, JSONP_TIMEOUT_MS);

    script.async = true;
    script.src = GAS_JSONP_ENDPOINT + '?' + params.toString();
    script.onerror = function() {
      if (finished) return;
      finished = true;
      cleanup_();
      invokeFailure_(
        failureHandler,
        createError_('APIを読み込めませんでした。通信状態を確認してください。', 'SCRIPT_ERROR')
      );
    };

    document.head.appendChild(script);
  }

  const runnerProxy = new Proxy({}, {
    get: function(target, property) {
      if (property === 'withSuccessHandler') {
        return function(handler) {
          runnerState.successHandler = handler;
          return runnerProxy;
        };
      }

      if (property === 'withFailureHandler') {
        return function(handler) {
          runnerState.failureHandler = handler;
          return runnerProxy;
        };
      }

      return function() {
        const args = Array.prototype.slice.call(arguments);
        const successHandler = runnerState.successHandler;
        const failureHandler = runnerState.failureHandler;
        resetRunnerState_();
        invokeJsonp_(String(property), args, successHandler, failureHandler);
        return runnerProxy;
      };
    }
  });

  window.google = window.google || {};
  window.google.script = window.google.script || {};
  window.google.script.run = runnerProxy;
})();
`.trim();

  fs.writeFileSync(path.join(jsDir, 'gas-run-shim.js'), `${js}\n`, 'utf8');
}

function writePwaClient() {
  const js = `
(function() {
  'use strict';

  const OFFLINE_MESSAGE = '端末がオフラインです。通信が戻ったら、もう一度検索してください。';
  const API_ERROR_MESSAGE = '蔵書データを取得できませんでした。通信状態を確認して再試行してください。';

  function getBanner_() {
    return document.getElementById('pwaNetworkBanner');
  }

  function setBanner_(message, kind) {
    const banner = getBanner_();
    if (!banner) return;

    const text = String(message || '').trim();
    banner.textContent = text;
    banner.hidden = !text;
    banner.classList.toggle('is-error', kind === 'error');
  }

  function clearBanner_() {
    setBanner_('', '');
  }

  function syncOnlineState_() {
    if (navigator && navigator.onLine === false) {
      setBanner_(OFFLINE_MESSAGE, 'error');
      return;
    }

    clearBanner_();
  }

  window.ShumiLibraryPwa = {
    isPwaShell: true,
    handleApiFailure: function(error) {
      if (error && error.code === 'OFFLINE') {
        setBanner_(OFFLINE_MESSAGE, 'error');
        return;
      }
      setBanner_(API_ERROR_MESSAGE, 'error');
    },
    clearApiFailure: function() {
      if (!navigator || navigator.onLine !== false) {
        clearBanner_();
      }
    }
  };

  window.addEventListener('online', syncOnlineState_);
  window.addEventListener('offline', syncOnlineState_);

  window.addEventListener('DOMContentLoaded', function() {
    syncOnlineState_();

    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('./sw.js').catch(function(error) {
        console.warn('service worker registration failed:', error);
      });
    }
  });
})();
`.trim();

  fs.writeFileSync(path.join(jsDir, 'pwa-client.js'), `${js}\n`, 'utf8');
}

function writePwaFiles() {
  const manifest = {
    name: '趣味部屋図書館',
    short_name: '図書館',
    description: '蔵書目録を検索し、本棚から読みたい本を見つけるPWA。',
    start_url: './',
    scope: './',
    display: 'standalone',
    background_color: '#f7f4ed',
    theme_color: '#2f5f4a',
    orientation: 'portrait',
    icons: [
      {
        src: './assets/icons/icon-192.png',
        sizes: '192x192',
        type: 'image/png',
        purpose: 'any maskable'
      },
      {
        src: './assets/icons/icon-512.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'any maskable'
      }
    ]
  };

  fs.writeFileSync(
    path.join(docsDir, 'manifest.webmanifest'),
    `${JSON.stringify(manifest, null, 2)}\n`,
    'utf8'
  );

  const offlineHtml = `<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="theme-color" content="#2f5f4a">
  <title>オフライン | 趣味部屋図書館</title>
  <link rel="stylesheet" href="./assets/css/pwa.css">
  <style>
    body {
      min-height: 100vh;
      margin: 0;
      display: grid;
      place-items: center;
      padding: 24px;
      background: #f7f4ed;
      color: #1d352b;
      font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }
    main {
      width: min(520px, 100%);
    }
    h1 {
      margin: 0 0 12px;
      font-size: clamp(1.5rem, 8vw, 2.25rem);
      letter-spacing: 0;
    }
    p {
      margin: 0 0 18px;
      line-height: 1.75;
    }
    button {
      min-height: 44px;
      padding: 10px 16px;
      border: 0;
      border-radius: 8px;
      background: #2f5f4a;
      color: #fff;
      font-weight: 700;
    }
  </style>
</head>
<body>
  <main>
    <h1>通信が切れています</h1>
    <p>趣味部屋図書館の検索と本棚データ取得には通信が必要です。回線が戻ったら、もう一度開いてください。</p>
    <button type="button" onclick="location.reload()">再読み込み</button>
  </main>
</body>
</html>
`;

  fs.writeFileSync(path.join(docsDir, 'offline.html'), offlineHtml, 'utf8');

  const sw = `
const CACHE_NAME = 'shumi-library-pwa-v8';
const APP_SHELL = [
  './',
  './index.html',
  './offline.html',
  './manifest.webmanifest',
  './assets/css/style.legacy-core.css',
  './assets/css/style.legacy-modal.css',
  './assets/css/style.shelf.css',
  './assets/css/style.modern-core.css',
  './assets/css/style.modern-modal.css',
  './assets/css/style.modern-shelf.css',
  './assets/css/style.responsive.css',
  './assets/css/pwa.css',
  './assets/logo.png',
  './assets/js/gas-run-shim.js',
  './assets/js/pwa-client.js',
  './assets/js/script.state.js',
  './assets/js/script.images.js',
  './assets/js/script.search.js',
  './assets/js/script.render.js',
  './assets/js/script.shelf.js',
  './assets/js/script.modal.js',
  './assets/js/script.boot.js',
  './assets/icons/icon-192.png',
  './assets/icons/icon-512.png'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys
        .filter(key => key !== CACHE_NAME)
        .map(key => caches.delete(key))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const request = event.request;
  const url = new URL(request.url);

  if (request.method !== 'GET' || url.origin !== self.location.origin) {
    return;
  }

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then(response => {
          const copy = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put('./index.html', copy));
          return response;
        })
        .catch(() => caches.match('./offline.html'))
    );
    return;
  }

  event.respondWith(
    fetch(request)
      .then(response => {
        const copy = response.clone();
        caches.open(CACHE_NAME).then(cache => cache.put(request, copy));
        return response;
      })
      .catch(() => caches.match(request).then(cached => cached || caches.match('./offline.html')))
  );
});
`.trim();

  fs.writeFileSync(path.join(docsDir, 'sw.js'), `${sw}\n`, 'utf8');
}

function crc32(buffer) {
  const table = crc32.table || (crc32.table = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    return c >>> 0;
  }));

  let crc = 0xffffffff;
  for (let i = 0; i < buffer.length; i++) {
    crc = table[(crc ^ buffer[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const typeBuffer = Buffer.from(type, 'ascii');
  const length = Buffer.alloc(4);
  const crc = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), 0);
  return Buffer.concat([length, typeBuffer, data, crc]);
}

function writePng(filePath, size) {
  const bytesPerPixel = 4;
  const raw = Buffer.alloc((size * bytesPerPixel + 1) * size);

  for (let y = 0; y < size; y++) {
    const rowStart = y * (size * bytesPerPixel + 1);
    raw[rowStart] = 0;

    for (let x = 0; x < size; x++) {
      const offset = rowStart + 1 + x * bytesPerPixel;
      const edge = Math.min(x, y, size - 1 - x, size - 1 - y);
      const inBook = x > size * 0.22 && x < size * 0.78 && y > size * 0.18 && y < size * 0.82;
      const spine = x > size * 0.30 && x < size * 0.40 && y > size * 0.25 && y < size * 0.75;
      const page = x > size * 0.43 && x < size * 0.68 && y > size * 0.28 && y < size * 0.72;
      let r = 47;
      let g = 95;
      let b = 74;

      if (edge < size * 0.08) {
        r = 36; g = 72; b = 58;
      }
      if (inBook) {
        r = 246; g = 238; b = 218;
      }
      if (spine) {
        r = 122; g = 67; b = 52;
      }
      if (page) {
        r = 255; g = 252; b = 241;
      }
      if (page && y > size * 0.46 && y < size * 0.50) {
        r = 47; g = 95; b = 74;
      }

      raw[offset] = r;
      raw[offset + 1] = g;
      raw[offset + 2] = b;
      raw[offset + 3] = 255;
    }
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', zlib.deflateSync(raw)),
    pngChunk('IEND', Buffer.alloc(0))
  ]);

  fs.writeFileSync(filePath, png);
}

function writeIcons() {
  writePng(path.join(iconDir, 'icon-192.png'), 192);
  writePng(path.join(iconDir, 'icon-512.png'), 512);
}

function main() {
  [docsDir, cssDir, jsDir, iconDir].forEach(ensureDir);
  writeStaticAssets();
  writePwaCss();
  writeGasRunShim();
  writePwaClient();
  writePwaFiles();
  writeIcons();
  fs.writeFileSync(path.join(docsDir, 'index.html'), buildStaticIndex(), 'utf8');
  fs.writeFileSync(path.join(docsDir, '.nojekyll'), '', 'utf8');
  console.log('GitHub Pages PWA files generated in docs/');
}

main();
