(function() {
  'use strict';

  const OFFLINE_MESSAGE = '端末がオフラインです。通信が戻ったら、もう一度検索してください。';
  const API_ERROR_MESSAGE = '蔵書データを取得できませんでした。通信状態を確認して再試行してください。';
  const UPDATE_MESSAGE = '新しい版があります。';

  let updateWaitingWorker = null;
  let reloadForUpdate = false;
  let currentBannerKind = '';

  function isStandalone_() {
    return Boolean(
      window.matchMedia &&
      window.matchMedia('(display-mode: standalone)').matches
    ) || window.navigator.standalone === true;
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

    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('./sw.js')
        .then(watchServiceWorkerUpdate_)
        .catch(function(error) {
          console.warn('service worker registration failed:', error);
        });
    }
  });
})();
