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
  const LAUNCH_SPLASH_DURATION_MS = 1850;
  const LAUNCH_SPLASH_DEBUG_DURATION_MS = 6000;
  const THEME_STORAGE_KEY = 'shumiLibrary.pwaTheme.v1';
  const LIBRARIAN_PRESENCE_STORAGE_KEY = 'shumiLibrary.librarianPresence.v1';
  const QUIET_MOTION_STORAGE_KEY = 'shumiLibrary.quietMotion.v1';
  const PERF_HUD_STORAGE_KEY = 'shumiLibrary.perfHudEnabled.v1';
  const PERF_LOG_STORAGE_KEY = 'shumiLibrary.perfLog.v1';
  const PERF_LOG_LIMIT = 20;
  const PERF_SLOW_THRESHOLD_MS = 250;
  const PERF_LONG_TASK_THRESHOLD_MS = 50;
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
    'status.note.random': data => data && Number.isFinite(data.count) ? '今夜の気配で、この' + data.count + '冊を手前に出しました。' : '今夜目が合う本を手前に出しました。',
    'status.note.shelf': data => data && Number.isFinite(data.count) ? '棚位置を確かめたい時は、この' + data.count + '冊の眺めが近道です。' : '棚位置を確かめるなら、この眺めが近道です。',
    'status.note.result': data => data && data.sourceMode === 'advanced' ? '細かい手がかりに合う本だけ、棚の前へ寄せています。' : '見つかった本だけ、棚の前へ寄せています。',
    'notice.keywordRequired': '探す手がかりをひとつください',
    'notice.conditionsRequired': '棚を探す手がかりをひとつください',
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
  let launchSplashTimer = 0;
  let launchSplashReady = false;
  let perfHudEnabled = false;
  let perfHudElement = null;
  let perfLog = null;
  let perfLongTaskObserver = null;

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
      applyServiceWorkerUpdate_(updateWaitingWorker);
    });
    banner.appendChild(button);

    window.setTimeout(function() {
      if (updateWaitingWorker === worker) {
        applyServiceWorkerUpdate_(worker);
      }
    }, 900);
  }

  function applyServiceWorkerUpdate_(worker) {
    if (!worker || reloadForUpdate) return;
    reloadForUpdate = true;
    worker.postMessage({ type: 'SKIP_WAITING' });
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

  function now_() {
    return window.performance && typeof window.performance.now === 'function'
      ? window.performance.now()
      : Date.now();
  }

  function isPerfHudRequested_() {
    try {
      const params = new URLSearchParams(window.location.search || '');
      return params.has('debugPerf');
    } catch (e) {
      return false;
    }
  }

  function isPerfHudEnabled_() {
    return Boolean(perfHudEnabled || isPerfHudRequested_() || getStoredBoolean_(PERF_HUD_STORAGE_KEY, false));
  }

  function getPerfLog_() {
    if (Array.isArray(perfLog)) return perfLog;
    try {
      const raw = window.localStorage ? window.localStorage.getItem(PERF_LOG_STORAGE_KEY) : '';
      const parsed = raw ? JSON.parse(raw) : [];
      perfLog = Array.isArray(parsed) ? parsed.slice(-PERF_LOG_LIMIT) : [];
    } catch (e) {
      perfLog = [];
    }
    return perfLog;
  }

  function savePerfLog_() {
    try {
      if (window.localStorage) {
        window.localStorage.setItem(PERF_LOG_STORAGE_KEY, JSON.stringify(getPerfLog_().slice(-PERF_LOG_LIMIT)));
      }
    } catch (e) {
      // 計測ログが保存できなくてもHUD表示だけ継続する。
    }
  }

  function formatDuration_(durationMs) {
    const value = Math.max(0, Number(durationMs || 0));
    if (value >= 1000) return (value / 1000).toFixed(2) + 's';
    return Math.round(value) + 'ms';
  }

  function summarizePerfMeta_(entry) {
    const meta = entry && entry.meta && typeof entry.meta === 'object' ? entry.meta : {};
    const parts = [];
    if (meta.api) parts.push('api=' + meta.api);
    if (meta.method) parts.push('method=' + meta.method);
    if (meta.count !== undefined) parts.push('count=' + meta.count);
    if (meta.ok === false) parts.push('fail');
    if (meta.code) parts.push('code=' + meta.code);
    return parts.join(' / ');
  }

  function ensurePerfHud_() {
    if (perfHudElement) return perfHudElement;

    const hud = document.createElement('section');
    hud.id = 'pwaPerfHud';
    hud.className = 'pwa-perf-hud';
    hud.setAttribute('aria-label', '性能HUD');
    hud.hidden = true;

    const header = document.createElement('div');
    header.className = 'pwa-perf-hud-header';

    const title = document.createElement('p');
    title.className = 'pwa-perf-hud-title';
    title.textContent = 'Perf HUD';
    header.appendChild(title);

    const actions = document.createElement('div');
    actions.className = 'pwa-perf-hud-actions';

    const copyButton = document.createElement('button');
    copyButton.id = 'pwaPerfHudCopy';
    copyButton.type = 'button';
    copyButton.textContent = 'コピー';
    actions.appendChild(copyButton);

    const clearButton = document.createElement('button');
    clearButton.id = 'pwaPerfHudClear';
    clearButton.type = 'button';
    clearButton.textContent = '消す';
    actions.appendChild(clearButton);

    header.appendChild(actions);
    hud.appendChild(header);

    const summary = document.createElement('div');
    summary.id = 'pwaPerfHudSummary';
    summary.className = 'pwa-perf-hud-summary';
    hud.appendChild(summary);

    const rows = document.createElement('div');
    rows.id = 'pwaPerfHudRows';
    rows.className = 'pwa-perf-hud-rows';
    hud.appendChild(rows);

    const note = document.createElement('p');
    note.id = 'pwaPerfHudNote';
    note.className = 'pwa-perf-hud-note';
    note.textContent = '直近20件を保存します';
    hud.appendChild(note);

    copyButton.addEventListener('click', copyPerfLog_);
    clearButton.addEventListener('click', function() {
      perfLog = [];
      savePerfLog_();
      renderPerfHud_();
    });

    document.body.appendChild(hud);
    perfHudElement = hud;
    return hud;
  }

  function renderPerfHud_() {
    const enabled = isPerfHudEnabled_();
    if (document.body) {
      document.body.classList.toggle('pwa-perf-hud-visible', enabled);
    }

    const input = document.getElementById('pwaPerfHudEnabled');
    if (input) input.checked = enabled;

    if (!enabled) {
      if (perfHudElement) perfHudElement.hidden = true;
      return;
    }

    const hud = ensurePerfHud_();
    const rowsEl = document.getElementById('pwaPerfHudRows');
    const summaryEl = document.getElementById('pwaPerfHudSummary');
    const entries = getPerfLog_();
    hud.hidden = false;

    if (summaryEl) {
      const latestApi = entries.slice().reverse().find(entry => String(entry.name || '').indexOf('api:') === 0);
      const latestRender = entries.slice().reverse().find(entry => String(entry.name || '').indexOf('render:') === 0 || String(entry.name || '').indexOf('shelf:') === 0);
      const latestPopup = entries.slice().reverse().find(entry => String(entry.name || '').indexOf('popup:') === 0);
      const longTasks = entries.filter(entry => String(entry.name || '') === 'longtask').length;
      const stats = [
        { label: 'API', value: latestApi ? formatDuration_(latestApi.durationMs) : '-' },
        { label: '描画', value: latestRender ? formatDuration_(latestRender.durationMs) : '-' },
        { label: 'モーダル', value: latestPopup ? formatDuration_(latestPopup.durationMs) : '-' },
        { label: 'Long task', value: String(longTasks) }
      ];
      summaryEl.innerHTML = '';
      stats.forEach(function(stat) {
        const item = document.createElement('div');
        item.className = 'pwa-perf-hud-stat';
        item.innerHTML = '<span class="pwa-perf-hud-stat-label"></span><span class="pwa-perf-hud-stat-value"></span>';
        item.querySelector('.pwa-perf-hud-stat-label').textContent = stat.label;
        item.querySelector('.pwa-perf-hud-stat-value').textContent = stat.value;
        summaryEl.appendChild(item);
      });
    }

    if (!rowsEl) return;
    rowsEl.innerHTML = '';
    entries.slice(-8).reverse().forEach(function(entry) {
      const row = document.createElement('div');
      row.className = 'pwa-perf-hud-row';
      if (Number(entry.durationMs || 0) >= PERF_SLOW_THRESHOLD_MS || entry.name === 'longtask') {
        row.classList.add('is-slow');
      }
      const name = document.createElement('div');
      name.className = 'pwa-perf-hud-name';
      const metaText = summarizePerfMeta_(entry);
      name.textContent = metaText ? entry.name + ' / ' + metaText : entry.name;
      const time = document.createElement('div');
      time.className = 'pwa-perf-hud-time';
      time.textContent = formatDuration_(entry.durationMs);
      row.appendChild(name);
      row.appendChild(time);
      rowsEl.appendChild(row);
    });
  }

  function copyPerfLog_() {
    const payload = {
      generatedAt: new Date().toISOString(),
      url: window.location.href,
      userAgent: navigator.userAgent,
      entries: getPerfLog_()
    };
    const text = JSON.stringify(payload, null, 2);
    const done = function(ok) {
      const note = document.getElementById('pwaPerfHudNote');
      if (note) note.textContent = ok ? 'コピーしました' : 'コピーできませんでした';
    };

    if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
      navigator.clipboard.writeText(text).then(function() {
        done(true);
      }).catch(function() {
        done(false);
      });
      return;
    }

    try {
      const textarea = document.createElement('textarea');
      textarea.value = text;
      textarea.setAttribute('readonly', 'readonly');
      textarea.style.position = 'fixed';
      textarea.style.opacity = '0';
      document.body.appendChild(textarea);
      textarea.select();
      const ok = document.execCommand('copy');
      textarea.remove();
      done(ok);
    } catch (e) {
      done(false);
    }
  }

  function recordPerf_(name, durationMs, meta) {
    if (!isPerfHudEnabled_()) return null;
    const entry = {
      name: String(name || 'measure'),
      durationMs: Math.max(0, Math.round(Number(durationMs || 0))),
      at: new Date().toISOString(),
      meta: meta && typeof meta === 'object' ? meta : {}
    };
    const log = getPerfLog_();
    log.push(entry);
    while (log.length > PERF_LOG_LIMIT) log.shift();
    savePerfLog_();
    renderPerfHud_();
    if (window.console && typeof window.console.debug === 'function') {
      window.console.debug('[perf]', entry);
    }
    return entry;
  }

  function startPerf_(name, meta) {
    if (!isPerfHudEnabled_()) return null;
    return {
      name: String(name || 'measure'),
      startedAt: now_(),
      meta: meta && typeof meta === 'object' ? meta : {}
    };
  }

  function endPerf_(token, meta) {
    if (!token) return null;
    const mergedMeta = Object.assign({}, token.meta || {}, meta || {});
    return recordPerf_(token.name, now_() - Number(token.startedAt || now_()), mergedMeta);
  }

  function observeLongTasks_() {
    if (perfLongTaskObserver || !isPerfHudEnabled_()) return;
    if (!('PerformanceObserver' in window)) return;
    try {
      perfLongTaskObserver = new PerformanceObserver(function(list) {
        list.getEntries().forEach(function(entry) {
          if (Number(entry.duration || 0) >= PERF_LONG_TASK_THRESHOLD_MS) {
            recordPerf_('longtask', entry.duration, {});
          }
        });
      });
      perfLongTaskObserver.observe({ entryTypes: ['longtask'] });
    } catch (e) {
      perfLongTaskObserver = null;
    }
  }

  function setPerfHudEnabled_(enabled) {
    perfHudEnabled = Boolean(enabled);
    setStoredBoolean_(PERF_HUD_STORAGE_KEY, perfHudEnabled);
    if (perfHudEnabled) observeLongTasks_();
    renderPerfHud_();
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
    const perfInput = document.getElementById('pwaPerfHudEnabled');
    if (perfInput) {
      perfInput.addEventListener('change', function() {
        setPerfHudEnabled_(perfInput.checked);
      });
    }
    perfHudEnabled = isPerfHudEnabled_();
    if (perfHudEnabled) observeLongTasks_();
    renderPerfHud_();
    document.addEventListener('keydown', function(event) {
      if (event.key === 'Escape' && button.getAttribute('aria-expanded') === 'true') {
        setSettingsOpen_(false);
      }
    });
  }

  function finishLaunchSplash_() {
    const splash = document.getElementById('pwaLaunchSplash');
    if (!splash) return;

    splash.classList.add('is-leaving');
    if (document.body) {
      document.body.classList.remove('pwa-launch-splash-visible');
    }
    window.setTimeout(function() {
      if (splash.parentNode) {
        splash.parentNode.removeChild(splash);
      }
    }, 560);
  }

  function getLaunchSplashDuration_() {
    try {
      const params = new URLSearchParams(window.location.search || '');
      return params.has('debugLaunchSplash') ? LAUNCH_SPLASH_DEBUG_DURATION_MS : LAUNCH_SPLASH_DURATION_MS;
    } catch (e) {
      return LAUNCH_SPLASH_DURATION_MS;
    }
  }

  function isLaunchSplashDebug_() {
    try {
      const params = new URLSearchParams(window.location.search || '');
      return params.has('debugLaunchSplash');
    } catch (e) {
      return false;
    }
  }

  function shouldShowLaunchSplash_() {
    return isStandalone_() || isLaunchSplashDebug_();
  }

  function removeLaunchSplashImmediately_() {
    const splash = document.getElementById('pwaLaunchSplash');
    if (!splash) return;
    if (document.body) {
      document.body.classList.remove('pwa-launch-splash-visible');
    }
    if (splash.parentNode) {
      splash.parentNode.removeChild(splash);
    }
  }

  function startLaunchSplash_() {
    const splash = document.getElementById('pwaLaunchSplash');
    if (!splash || !document.body) return;

    if (!shouldShowLaunchSplash_()) {
      removeLaunchSplashImmediately_();
      return;
    }

    document.body.classList.add('pwa-launch-splash-visible');

    function markReady() {
      if (launchSplashReady) return;
      launchSplashReady = true;
      splash.classList.add('is-ready');
      launchSplashTimer = window.setTimeout(function() {
        launchSplashTimer = 0;
        finishLaunchSplash_();
      }, getLaunchSplashDuration_());
    }

    const image = splash.querySelector('img');
    if (!image || image.complete) {
      window.setTimeout(markReady, 40);
      return;
    }

    image.addEventListener('load', markReady, { once: true });
    image.addEventListener('error', markReady, { once: true });
    window.setTimeout(markReady, 1200);
  }

  window.ShumiLibraryPwa = {
    isPwaShell: true,
    isLibrarianPresenceEnabled: isLibrarianPresenceEnabled_,
    isQuietMotionEnabled: isQuietMotionEnabled_,
    getLibrarianText: getLibrarianText_,
    perfStart: startPerf_,
    perfEnd: endPerf_,
    recordPerf: recordPerf_,
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
    startLaunchSplash_();
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
