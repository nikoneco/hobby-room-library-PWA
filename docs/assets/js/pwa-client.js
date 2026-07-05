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
  const THEME_STORAGE_KEY = 'shumiLibrary.pwaTheme.v1';
  const LIBRARIAN_PRESENCE_STORAGE_KEY = 'shumiLibrary.librarianPresence.v1';
  const QUIET_MOTION_STORAGE_KEY = 'shumiLibrary.quietMotion.v1';
  const DEFAULT_LOGO_SRC = './assets/logo.png';
  const LIBRARIAN_LOGO_SRC = './assets/librarian-presence.jpg';
  const THEME_DEFAULT = 'shinhaku';
  const THEME_OPTIONS = ['shinhaku', 'kohi', 'shikon', 'kohaku'];
  const LEGACY_THEME_ALIASES = {
    default: 'shinhaku',
    calm: 'shinhaku',
    warm: 'kohaku'
  };
  const THEME_COLORS = {
    shinhaku: '#0a1217',
    kohi: '#120c0f',
    shikon: '#0f0e18',
    kohaku: '#120f0b'
  };
  const LIBRARIAN_TEXTS = {
    'empty.title': 'この条件の本は、今は棚の奥に隠れているようです',
    'empty.text': '言葉を少しゆるめるか、条件を外してもう一度だけ棚を覗いてみましょう。',
    'empty.action.search': '検索語を整える',
    'empty.action.clear': '条件をほどく',
    'empty.action.random': '別の棚を眺める',
    'status.random': data => data && Number.isFinite(data.count) ? data.count + '冊をそっと選びました' : '棚から本を選びました',
    'status.shelf': data => data && Number.isFinite(data.count) ? '全' + data.count + '冊の棚を開いています' : '本棚を開いています',
    'status.result': data => data && Number.isFinite(data.count) ? data.count + '冊が灯りの下に出てきました' : '本が見つかりました',
    'status.beforeSearch': '棚を探す前',
    'status.previewPending': '棚札を確かめています',
    'status.conditions': '探す手がかり',
    'status.previewReady': data => data && Number.isFinite(data.count) ? 'この手がかりなら' + data.count + '冊' : '候補が見えています',
    'spinner.label.search': '棚を探しています',
    'spinner.label.advanced': '手がかりを照らしています',
    'spinner.label.random': '棚から10冊抜き出しています',
    'spinner.label.shelf': '棚の灯りをともしています',
    'spinner.label.browse': '選んだ入口を辿っています',
    'spinner.label.refine': '棚を並べ直しています',
    'spinner.detail.search': 'タイトル・作者・読みを静かに照合しています',
    'spinner.detail.advanced': 'ジャンルや発売日の札を一枚ずつ確かめています',
    'spinner.detail.random': '今夜目が合う本を少しだけ選んでいます',
    'spinner.detail.shelf': '蔵書全体と棚マップをゆっくり広げています',
    'spinner.detail.browse': '選んだ気分に近い棚を覗いています',
    'spinner.detail.refine': '外した条件を反映して、棚を整えています',
    'shelfOverview.heading.immersive': '蔵書全体の棚を開いています',
    'shelfOverview.heading.result': '見つかった本を棚順に並べています',
    'shelfOverview.note.immersive': 'マップと棚ジャンプで、趣味部屋の奥へ移動できます。',
    'shelfOverview.note.result': '検索結果だけを棚順に並べています。全体を眺めるときはトップの「本棚を見る」からどうぞ。',
    'popup.detailLoading': '詳細の頁を開いています',
    'series.loading': 'シリーズ棚を確かめています...'
  };

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

  function normalizeTheme_(theme) {
    const value = String(theme || '').trim();
    const migrated = LEGACY_THEME_ALIASES[value] || value;
    return THEME_OPTIONS.includes(migrated) ? migrated : THEME_DEFAULT;
  }

  function getStoredTheme_() {
    try {
      const value = window.localStorage ? window.localStorage.getItem(THEME_STORAGE_KEY) : '';
      const nextTheme = normalizeTheme_(value);
      if (window.localStorage && value && value !== nextTheme) {
        window.localStorage.setItem(THEME_STORAGE_KEY, nextTheme);
      }
      return nextTheme;
    } catch (e) {
      return THEME_DEFAULT;
    }
  }

  function applyTheme_(theme) {
    const nextTheme = normalizeTheme_(theme);
    if (document.body) {
      THEME_OPTIONS.forEach(option => {
        document.body.classList.toggle('pwa-theme-' + option, nextTheme === option);
      });
    }

    const themeColor = document.querySelector('meta[name="theme-color"]');
    if (themeColor) {
      themeColor.setAttribute('content', THEME_COLORS[nextTheme] || THEME_COLORS.default);
    }

    document.querySelectorAll('input[name="pwaTheme"]').forEach(input => {
      input.checked = input.value === nextTheme;
    });
  }

  function setTheme_(theme) {
    const nextTheme = normalizeTheme_(theme);
    try {
      if (window.localStorage) {
        window.localStorage.setItem(THEME_STORAGE_KEY, nextTheme);
      }
    } catch (e) {
      // localStorageが使えない環境でも、その場のテーマ切替は反映する。
    }
    applyTheme_(nextTheme);
  }

  function getStoredBoolean_(key, defaultValue) {
    try {
      if (!window.localStorage) return Boolean(defaultValue);
      const value = window.localStorage.getItem(key);
      if (value === null || value === '') return Boolean(defaultValue);
      return value === '1';
    } catch (e) {
      return Boolean(defaultValue);
    }
  }

  function setStoredBoolean_(key, value) {
    try {
      if (window.localStorage) {
        window.localStorage.setItem(key, value ? '1' : '0');
      }
    } catch (e) {
      // localStorageが使えない環境でも、その場の設定は反映する。
    }
  }

  function isLibrarianPresenceEnabled_() {
    return getStoredBoolean_(LIBRARIAN_PRESENCE_STORAGE_KEY, false);
  }

  function isQuietMotionEnabled_() {
    return getStoredBoolean_(QUIET_MOTION_STORAGE_KEY, false);
  }

  function syncLogoForLibrarianPresence_(enabled) {
    const logo = document.getElementById('logoResetBtn');
    if (!logo) return;

    const nextSrc = enabled ? LIBRARIAN_LOGO_SRC : DEFAULT_LOGO_SRC;
    const currentSrc = logo.getAttribute('src') || '';
    if (currentSrc !== nextSrc) {
      logo.setAttribute('src', nextSrc);
    }
    logo.setAttribute('alt', enabled ? '司書のいる趣味部屋図書館' : 'ロゴ');
  }

  function applyPlaySettings_() {
    const librarianPresence = isLibrarianPresenceEnabled_();
    const quietMotion = isQuietMotionEnabled_();
    if (document.body) {
      document.body.classList.toggle('pwa-librarian-presence', librarianPresence);
      document.body.classList.toggle('pwa-quiet-motion', quietMotion);
    }
    syncLogoForLibrarianPresence_(librarianPresence);

    const librarianInput = document.getElementById('pwaLibrarianPresence');
    if (librarianInput) librarianInput.checked = librarianPresence;
    const quietMotionInput = document.getElementById('pwaQuietMotion');
    if (quietMotionInput) quietMotionInput.checked = quietMotion;
  }

  function setLibrarianPresence_(enabled) {
    setStoredBoolean_(LIBRARIAN_PRESENCE_STORAGE_KEY, Boolean(enabled));
    applyPlaySettings_();
    if (typeof renderSearchStatus_ === 'function') {
      renderSearchStatus_();
    }
  }

  function setQuietMotion_(enabled) {
    setStoredBoolean_(QUIET_MOTION_STORAGE_KEY, Boolean(enabled));
    applyPlaySettings_();
  }

  function getLibrarianText_(key, fallback, data) {
    if (!isLibrarianPresenceEnabled_()) return fallback;
    const entry = LIBRARIAN_TEXTS[key];
    if (typeof entry === 'function') {
      return entry(data || {});
    }
    return entry || fallback;
  }

  function moveSensitiveToggleToSettings_() {
    const target = document.getElementById('pwaSensitiveSetting');
    const toggle = document.querySelector('.sensitive-toggle');
    if (!target || !toggle) return;

    const row = document.createElement('div');
    row.className = 'pwa-settings-row';

    const text = document.createElement('div');
    const title = document.createElement('p');
    const note = document.createElement('p');
    title.className = 'pwa-settings-row-title';
    note.className = 'pwa-settings-row-note';
    title.textContent = 'センシティブ';
    note.textContent = '検索結果への表示を切り替えます';
    text.appendChild(title);
    text.appendChild(note);

    row.appendChild(text);
    row.appendChild(toggle);
    target.appendChild(row);
  }

  function setSettingsOpen_(open) {
    const panel = document.getElementById('pwaSettingsPanel');
    const backdrop = document.getElementById('pwaSettingsBackdrop');
    const button = document.getElementById('pwaSettingsButton');
    if (!panel || !backdrop || !button || !document.body) return;

    const isOpen = Boolean(open);
    panel.hidden = !isOpen;
    backdrop.hidden = !isOpen;
    document.body.classList.toggle('pwa-settings-open', isOpen);
    button.setAttribute('aria-expanded', isOpen ? 'true' : 'false');

    if (isOpen) {
      const checkedTheme = panel.querySelector('input[name="pwaTheme"]:checked');
      (checkedTheme || panel).focus({ preventScroll: true });
    } else {
      button.focus({ preventScroll: true });
    }
  }

  function bindSettingsPanel_() {
    const panel = document.getElementById('pwaSettingsPanel');
    const backdrop = document.getElementById('pwaSettingsBackdrop');
    const button = document.getElementById('pwaSettingsButton');
    const closeButton = document.getElementById('pwaSettingsClose');
    if (!panel || !backdrop || !button || !closeButton) return;

    moveSensitiveToggleToSettings_();
    applyTheme_(getStoredTheme_());
    applyPlaySettings_();

    button.addEventListener('click', function() {
      setSettingsOpen_(button.getAttribute('aria-expanded') !== 'true');
    });
    closeButton.addEventListener('click', function() {
      setSettingsOpen_(false);
    });
    backdrop.addEventListener('click', function() {
      setSettingsOpen_(false);
    });
    panel.querySelectorAll('input[name="pwaTheme"]').forEach(input => {
      input.addEventListener('change', function() {
        if (input.checked) setTheme_(input.value);
      });
    });
    const librarianInput = document.getElementById('pwaLibrarianPresence');
    if (librarianInput) {
      librarianInput.addEventListener('change', function() {
        setLibrarianPresence_(librarianInput.checked);
      });
    }
    const quietMotionInput = document.getElementById('pwaQuietMotion');
    if (quietMotionInput) {
      quietMotionInput.addEventListener('change', function() {
        setQuietMotion_(quietMotionInput.checked);
      });
    }
    document.addEventListener('keydown', function(event) {
      if (event.key === 'Escape' && button.getAttribute('aria-expanded') === 'true') {
        setSettingsOpen_(false);
      }
    });
  }

  window.ShumiLibraryPwa = {
    isPwaShell: true,
    isLibrarianPresenceEnabled: isLibrarianPresenceEnabled_,
    isQuietMotionEnabled: isQuietMotionEnabled_,
    getLibrarianText: getLibrarianText_,
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
    bindSettingsPanel_();
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
