const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const crypto = require('crypto');

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
      '<meta name="theme-color" content="#0b111a">',
      '<meta name="color-scheme" content="dark light">',
      '<meta name="apple-mobile-web-app-capable" content="yes">',
      '<meta name="apple-mobile-web-app-title" content="趣味部屋図書館">',
      '<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">',
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

body.pwa-shell .mobile-app-dock {
  touch-action: manipulation;
}

body.pwa-standalone {
  --pwa-safe-top: env(safe-area-inset-top, 0px);
  -webkit-user-select: none;
  user-select: none;
  min-height: 100svh;
  padding-top: var(--pwa-safe-top);
  background-color: #0b111a;
}

body.pwa-standalone input,
body.pwa-standalone textarea,
body.pwa-standalone select,
body.pwa-standalone #result,
body.pwa-standalone #image-popup-info {
  -webkit-user-select: text;
  user-select: text;
}

body.pwa-standalone .search-container.centered {
  min-height: calc(100svh - 96px - var(--pwa-safe-top) - env(safe-area-inset-bottom));
}

body.pwa-standalone .search-container:not(.centered) {
  top: var(--pwa-safe-top);
}

body.pwa-standalone .mobile-app-dock {
  border-radius: 22px;
  background: rgba(9, 13, 19, 0.90);
}

body.pwa-network-visible {
  --pwa-network-banner-offset: 118px;
}

body.pwa-network-visible:not(.mobile-dock-has-results) {
  --pwa-network-banner-offset: 78px;
}

body.pwa-network-visible .mobile-app-dock {
  transform: translateY(calc(-1 * var(--pwa-network-banner-offset)));
}

body.pwa-network-visible.mobile-input-active .mobile-app-dock {
  transform: translateY(calc(100% + 16px));
}

body.pwa-update-visible .mobile-app-dock {
  transform: none;
}

.pwa-network-banner.is-error {
  border-color: rgba(166, 73, 58, 0.28);
  color: #5f2f26;
}

.pwa-network-banner.is-update {
  border-color: rgba(104, 191, 215, 0.34);
  color: #dff8ff;
  background: rgba(13, 22, 31, 0.94);
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  left: auto;
  right: max(12px, env(safe-area-inset-right));
  bottom: auto;
  top: max(12px, env(safe-area-inset-top));
  max-width: min(360px, calc(100vw - 24px - env(safe-area-inset-left) - env(safe-area-inset-right)));
  padding: 9px 10px 9px 12px;
  box-shadow: 0 12px 28px rgba(0, 0, 0, 0.26);
}

.pwa-network-banner.is-notice {
  border-color: rgba(214, 164, 95, 0.34);
  color: #4c3820;
}

.pwa-network-banner-action {
  margin-left: 0.75em;
  padding: 0.34em 0.78em;
  border: 1px solid rgba(47, 95, 74, 0.28);
  border-radius: 999px;
  background: #2f5f4a;
  color: #fff;
  font: inherit;
  font-weight: 800;
  cursor: pointer;
}

.pwa-network-banner-action-muted {
  margin-left: 0.45em;
  border-color: rgba(47, 95, 74, 0.20);
  background: rgba(255, 255, 255, 0.60);
  color: #2f453d;
}

@media (max-width: 640px) {
  body.pwa-network-visible {
    padding-bottom: calc(196px + env(safe-area-inset-bottom));
  }

  body.pwa-network-visible:not(.mobile-dock-has-results) {
    padding-bottom: calc(154px + env(safe-area-inset-bottom));
  }

  .pwa-network-banner {
    font-size: 0.86rem;
    padding: 10px 12px;
  }

  .pwa-network-banner.is-update {
    left: max(12px, env(safe-area-inset-left));
    right: max(12px, env(safe-area-inset-right));
    width: auto;
    max-width: none;
    padding: 8px 9px 8px 11px;
    font-size: 0.82rem;
  }
}

@media (min-width: 641px) {
  body.pwa-network-visible .mobile-app-dock {
    transform: none;
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
    getBookDetailByRowIndex: { api: 'bookDetail', argNames: ['rowIndex'] },
    getBookDetailsByRowIndexes: { api: 'bookDetails', argNames: ['rowIndexes'] },
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
  const UPDATE_MESSAGE = '新しい版があります。';
  const INSTALL_PROMPT_MESSAGE = 'ホーム画面に追加できます。';
  const INSTALL_PROMPT_STORAGE_KEY = 'shumiLibrary.pwaInstallPromptDismissed.v1';
  const IOS_INSTALL_MESSAGE = '共有からホーム画面に追加できます。';
  const IOS_INSTALL_STORAGE_KEY = 'shumiLibrary.pwaIosInstallHintDismissed.v1';
  const INSTALL_HINT_AUTO_HIDE_MS = 12000;

  const UPDATE_CHECK_INTERVAL_MS = 60 * 60 * 1000;

  let updateWaitingWorker = null;
  let installPromptEvent = null;
  let reloadForUpdate = false;
  let currentBannerKind = '';
  let activeRegistration = null;
  let lastUpdateCheckAt = 0;
  let installHintTimer = 0;

  function isStandalone_() {
    return Boolean(
      window.matchMedia &&
      window.matchMedia('(display-mode: standalone)').matches
    ) || window.navigator.standalone === true;
  }

  function isIosLike_() {
    const ua = navigator && navigator.userAgent ? navigator.userAgent : '';
    const platform = navigator && navigator.platform ? navigator.platform : '';
    const touchPoints = navigator && navigator.maxTouchPoints ? navigator.maxTouchPoints : 0;

    return /iPad|iPhone|iPod/.test(ua) ||
      (platform === 'MacIntel' && touchPoints > 1);
  }

  function getBanner_() {
    return document.getElementById('pwaNetworkBanner');
  }

  function syncBodyState_() {
    if (!document.body) return;
    document.body.classList.add('pwa-shell');
    document.body.classList.toggle('pwa-standalone', isStandalone_());
    document.body.classList.toggle('pwa-network-visible', Boolean(currentBannerKind && currentBannerKind !== 'update'));
    document.body.classList.toggle('pwa-update-visible', currentBannerKind === 'update');
  }

  function setBanner_(message, kind) {
    const banner = getBanner_();
    if (!banner) return;

    const text = String(message || '').trim();
    banner.textContent = text;
    banner.hidden = !text;
    currentBannerKind = text ? (kind || '') : '';
    banner.classList.toggle('is-error', kind === 'error');
    banner.classList.toggle('is-update', kind === 'update');
    banner.classList.toggle('is-notice', kind === 'notice');
    syncBodyState_();
  }

  function clearBanner_() {
    setBanner_('', '');
  }

  function clearInstallHintTimer_() {
    if (!installHintTimer) return;
    window.clearTimeout(installHintTimer);
    installHintTimer = 0;
  }

  function autoHideInstallHint_(kind) {
    clearInstallHintTimer_();
    installHintTimer = window.setTimeout(function() {
      installHintTimer = 0;
      if (currentBannerKind === kind) {
        clearBanner_();
      }
    }, INSTALL_HINT_AUTO_HIDE_MS);
  }

  function isInstallPromptDismissed_() {
    try {
      return window.localStorage &&
        window.localStorage.getItem(INSTALL_PROMPT_STORAGE_KEY) === '1';
    } catch (e) {
      return false;
    }
  }

  function dismissInstallPrompt_() {
    installPromptEvent = null;
    clearInstallHintTimer_();
    try {
      if (window.localStorage) {
        window.localStorage.setItem(INSTALL_PROMPT_STORAGE_KEY, '1');
      }
    } catch (e) {
      // localStorageが使えない環境では、その場の表示だけ閉じる。
    }

    if (currentBannerKind === 'install') {
      clearBanner_();
    }
  }

  function isIosInstallHintDismissed_() {
    try {
      return window.localStorage &&
        window.localStorage.getItem(IOS_INSTALL_STORAGE_KEY) === '1';
    } catch (e) {
      return false;
    }
  }

  function dismissIosInstallHint_() {
    try {
      if (window.localStorage) {
        window.localStorage.setItem(IOS_INSTALL_STORAGE_KEY, '1');
      }
    } catch (e) {
      // localStorageが使えない環境では、その場の表示だけ閉じる。
    }

    if (currentBannerKind === 'ios-install') {
      clearInstallHintTimer_();
      clearBanner_();
    }
  }

  function showIosInstallHint_() {
    if (!isIosLike_() || isStandalone_() || isIosInstallHintDismissed_()) return;
    if (currentBannerKind) return;

    const banner = getBanner_();
    if (!banner) return;

    banner.innerHTML = '';
    banner.hidden = false;
    currentBannerKind = 'ios-install';
    banner.classList.remove('is-error');
    banner.classList.remove('is-update');
    banner.classList.add('is-notice');
    syncBodyState_();

    const text = document.createElement('span');
    text.textContent = IOS_INSTALL_MESSAGE;
    banner.appendChild(text);

    const closeButton = document.createElement('button');
    closeButton.type = 'button';
    closeButton.className = 'pwa-network-banner-action pwa-network-banner-action-muted';
    closeButton.textContent = '閉じる';
    closeButton.addEventListener('click', dismissIosInstallHint_);
    banner.appendChild(closeButton);
    autoHideInstallHint_('ios-install');
  }

  function showInstallBanner_() {
    if (!installPromptEvent || isStandalone_() || isInstallPromptDismissed_()) return;
    if (currentBannerKind === 'update' || currentBannerKind === 'error') return;

    const banner = getBanner_();
    if (!banner) return;

    banner.innerHTML = '';
    banner.hidden = false;
    currentBannerKind = 'install';
    banner.classList.remove('is-error');
    banner.classList.remove('is-update');
    banner.classList.add('is-notice');
    syncBodyState_();

    const text = document.createElement('span');
    text.textContent = INSTALL_PROMPT_MESSAGE;
    banner.appendChild(text);

    const installButton = document.createElement('button');
    installButton.type = 'button';
    installButton.className = 'pwa-network-banner-action';
    installButton.textContent = '追加';
    installButton.addEventListener('click', function() {
      if (!installPromptEvent) {
        dismissInstallPrompt_();
        return;
      }

      const promptEvent = installPromptEvent;
      installPromptEvent = null;
      promptEvent.prompt();
      Promise.resolve(promptEvent.userChoice)
        .then(dismissInstallPrompt_)
        .catch(dismissInstallPrompt_);
    });
    banner.appendChild(installButton);

    const closeButton = document.createElement('button');
    closeButton.type = 'button';
    closeButton.className = 'pwa-network-banner-action pwa-network-banner-action-muted';
    closeButton.textContent = '閉じる';
    closeButton.addEventListener('click', dismissInstallPrompt_);
    banner.appendChild(closeButton);
    autoHideInstallHint_('install');
  }

  function showUpdateBanner_(worker) {
    if (!worker) return;
    clearInstallHintTimer_();
    updateWaitingWorker = worker;

    const banner = getBanner_();
    if (!banner) return;

    banner.innerHTML = '';
    banner.hidden = false;
    currentBannerKind = 'update';
    banner.classList.remove('is-error');
    banner.classList.remove('is-notice');
    banner.classList.add('is-update');
    syncBodyState_();

    const text = document.createElement('span');
    text.textContent = UPDATE_MESSAGE;
    banner.appendChild(text);

    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'pwa-network-banner-action';
    button.textContent = '更新';
    button.addEventListener('click', function() {
      if (!updateWaitingWorker) return;
      reloadForUpdate = true;
      updateWaitingWorker.postMessage({ type: 'SKIP_WAITING' });
    });
    banner.appendChild(button);
  }

  function syncOnlineState_() {
    if (navigator && navigator.onLine === false) {
      setBanner_(OFFLINE_MESSAGE, 'error');
      return;
    }

    if (currentBannerKind !== 'update') {
      clearBanner_();
    }
  }

  function watchServiceWorkerUpdate_(registration) {
    if (!registration) return;
    activeRegistration = registration;

    if (registration.waiting && navigator.serviceWorker.controller) {
      showUpdateBanner_(registration.waiting);
    }

    registration.addEventListener('updatefound', function() {
      const worker = registration.installing;
      if (!worker) return;

      worker.addEventListener('statechange', function() {
        if (worker.state === 'installed' && navigator.serviceWorker.controller) {
          showUpdateBanner_(worker);
        }
      });
    });
  }

  function requestServiceWorkerUpdate_(force) {
    if (!activeRegistration || typeof activeRegistration.update !== 'function') return;
    if (navigator && navigator.onLine === false) return;

    const now = Date.now();
    if (!force && now - lastUpdateCheckAt < UPDATE_CHECK_INTERVAL_MS) return;
    lastUpdateCheckAt = now;

    activeRegistration.update().catch(function(error) {
      console.warn('service worker update check failed:', error);
    });
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
      if (currentBannerKind !== 'update' && (!navigator || navigator.onLine !== false)) {
        clearBanner_();
      }
    }
  };

  window.addEventListener('online', syncOnlineState_);
  window.addEventListener('offline', syncOnlineState_);
  window.addEventListener('beforeinstallprompt', function(event) {
    event.preventDefault();
    installPromptEvent = event;
    window.setTimeout(showInstallBanner_, 1800);
  });
  window.addEventListener('appinstalled', dismissInstallPrompt_);
  window.addEventListener('focus', function() {
    requestServiceWorkerUpdate_(false);
  });
  document.addEventListener('visibilitychange', function() {
    if (document.visibilityState === 'visible') {
      requestServiceWorkerUpdate_(false);
    }
  });
  if (window.matchMedia) {
    const standaloneMedia = window.matchMedia('(display-mode: standalone)');
    if (standaloneMedia && typeof standaloneMedia.addEventListener === 'function') {
      standaloneMedia.addEventListener('change', syncBodyState_);
    }
  }
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.addEventListener('controllerchange', function() {
      if (reloadForUpdate) {
        window.location.reload();
      }
    });
  }

  window.addEventListener('DOMContentLoaded', function() {
    syncBodyState_();
    syncOnlineState_();
    window.setTimeout(showIosInstallHint_, 3500);

    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('./sw.js')
        .then(function(registration) {
          watchServiceWorkerUpdate_(registration);
          requestServiceWorkerUpdate_(true);
        })
        .catch(function(error) {
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
    id: './',
    name: '趣味部屋図書館',
    short_name: '図書館',
    description: '蔵書目録を検索し、本棚から読みたい本を見つけるPWA。',
    lang: 'ja',
    dir: 'ltr',
    start_url: './',
    scope: './',
    display: 'standalone',
    display_override: ['standalone', 'browser'],
    background_color: '#0b111a',
    theme_color: '#0b111a',
    orientation: 'portrait',
    categories: ['books', 'education', 'productivity'],
    prefer_related_applications: false,
    shortcuts: [
      {
        name: '検索を開く',
        short_name: '検索',
        description: 'タイトル、読み仮名、作者から蔵書を検索する',
        url: './?launch=search',
        icons: [
          {
            src: './assets/icons/icon-192.png',
            sizes: '192x192',
            type: 'image/png'
          }
        ]
      },
      {
        name: '本棚を見る',
        short_name: '本棚',
        description: '棚マップから所蔵本を眺める',
        url: './?launch=bookshelf',
        icons: [
          {
            src: './assets/icons/icon-192.png',
            sizes: '192x192',
            type: 'image/png'
          }
        ]
      },
      {
        name: 'ランダムに選ぶ',
        short_name: 'ランダム',
        description: '棚から10冊をランダムに表示する',
        url: './?launch=random',
        icons: [
          {
            src: './assets/icons/icon-192.png',
            sizes: '192x192',
            type: 'image/png'
          }
        ]
      }
    ],
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
  <meta name="theme-color" content="#0b111a">
  <meta name="color-scheme" content="dark light">
  <title>オフライン | 趣味部屋図書館</title>
  <link rel="stylesheet" href="./assets/css/pwa.css">
  <style>
    body {
      min-height: 100vh;
      margin: 0;
      display: grid;
      place-items: center;
      padding: 24px;
      background: #0b111a;
      color: #edf5f7;
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
      background: #68bfd7;
      color: #0b111a;
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

  const appShell = [
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
  const cacheName = buildAppShellCacheName_(appShell);
  const appShellSource = appShell.map(entry => `  ${JSON.stringify(entry)}`).join(',\n');

  const sw = `
const CACHE_NAME = ${JSON.stringify(cacheName)};
const APP_SHELL = [
${appShellSource}
];
const NAVIGATION_FALLBACK = './index.html';
const OFFLINE_FALLBACK = './offline.html';
const APP_SHELL_URLS = new Set(APP_SHELL.map(path => new URL(path, self.location.href).href));

function getCacheKey_(url) {
  const copy = new URL(url.href);
  copy.search = '';
  copy.hash = '';
  return copy.href;
}

function isAppShellUrl_(url) {
  return APP_SHELL_URLS.has(getCacheKey_(url));
}

function putCache_(cacheKey, response) {
  if (!response || !response.ok) return response;
  const copy = response.clone();
  caches.open(CACHE_NAME).then(cache => cache.put(cacheKey, copy));
  return response;
}

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(APP_SHELL))
  );
});

self.addEventListener('message', event => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
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
    const cacheKey = new URL(NAVIGATION_FALLBACK, self.location.href).href;
    event.respondWith(
      fetch(request)
        .then(response => putCache_(cacheKey, response))
        .catch(() => caches.match(cacheKey).then(cached => cached || caches.match(OFFLINE_FALLBACK)))
    );
    return;
  }

  if (isAppShellUrl_(url)) {
    const cacheKey = getCacheKey_(url);
    event.respondWith(
      caches.match(cacheKey).then(cached => {
        const refresh = fetch(request)
          .then(response => putCache_(cacheKey, response))
          .catch(() => null);
        return cached || refresh.then(response => response || caches.match(OFFLINE_FALLBACK));
      })
    );
    return;
  }

  event.respondWith(
    fetch(request)
      .then(response => putCache_(getCacheKey_(url), response))
      .catch(() => caches.match(getCacheKey_(url)).then(cached => cached || caches.match(OFFLINE_FALLBACK)))
  );
});
`.trim();

  fs.writeFileSync(path.join(docsDir, 'sw.js'), `${sw}\n`, 'utf8');
}

function getAppShellFilePath_(entry) {
  const relativePath = entry === './' ? 'index.html' : entry.replace(/^\.\//, '');
  return path.join(docsDir, relativePath);
}

function buildAppShellCacheName_(appShell) {
  const hash = crypto.createHash('sha256');

  appShell.forEach(entry => {
    const filePath = getAppShellFilePath_(entry);
    hash.update(entry);
    hash.update('\0');
    hash.update(fs.readFileSync(filePath));
    hash.update('\0');
  });

  return `shumi-library-pwa-${hash.digest('hex').slice(0, 12)}`;
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
  writeIcons();
  fs.writeFileSync(path.join(docsDir, 'index.html'), buildStaticIndex(), 'utf8');
  writePwaFiles();
  fs.writeFileSync(path.join(docsDir, '.nojekyll'), '', 'utf8');
  console.log('GitHub Pages PWA files generated in docs/');
}

main();
