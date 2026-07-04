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
