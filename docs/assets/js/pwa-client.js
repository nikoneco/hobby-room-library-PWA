(function() {
  'use strict';

  const OFFLINE_MESSAGE = '端末がオフラインです。通信が戻ったら、もう一度検索してください。';
  const API_ERROR_MESSAGE = '蔵書データを取得できませんでした。通信状態を確認して再試行してください。';
  const UPDATE_MESSAGE = '新しい版があります。';
  const INSTALL_PROMPT_MESSAGE = 'ホーム画面に追加できます。';
  const INSTALL_PROMPT_STORAGE_KEY = 'shumiLibrary.pwaInstallPromptDismissed.v1';
  const IOS_INSTALL_MESSAGE = '共有からホーム画面に追加できます。';
  const IOS_INSTALL_STORAGE_KEY = 'shumiLibrary.pwaIosInstallHintDismissed.v1';

  const UPDATE_CHECK_INTERVAL_MS = 60 * 60 * 1000;

  let updateWaitingWorker = null;
  let installPromptEvent = null;
  let reloadForUpdate = false;
  let currentBannerKind = '';
  let activeRegistration = null;
  let lastUpdateCheckAt = 0;

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
  }

  function showUpdateBanner_(worker) {
    if (!worker) return;
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
