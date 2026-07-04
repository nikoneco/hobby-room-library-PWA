(function() {
  'use strict';

  const OFFLINE_MESSAGE = '端末がオフラインです。通信が戻ったら、もう一度検索してください。';
  const API_ERROR_MESSAGE = '蔵書データを取得できませんでした。通信状態を確認して再試行してください。';
  const UPDATE_MESSAGE = '新しい版があります。';
  const RECENT_BOOKS_STORAGE_KEY = 'shumiLibrary.pwaRecentBooks.v1';
  const RECENT_BOOKS_LIMIT = 8;

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

  function getRecentRail_() {
    return document.getElementById('pwaRecentRail');
  }

  function syncBodyState_() {
    if (!document.body) return;
    document.body.classList.add('pwa-shell');
    document.body.classList.toggle('pwa-standalone', isStandalone_());
    document.body.classList.toggle('pwa-network-visible', Boolean(currentBannerKind));
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
    syncBodyState_();
  }

  function clearBanner_() {
    setBanner_('', '');
  }

  function getRecentBookKey_(book) {
    if (!book || typeof book !== 'object') return '';
    if (book.rowIndex !== undefined && book.rowIndex !== null) return 'row:' + book.rowIndex;
    if (book.isbn) return 'isbn:' + String(book.isbn).trim();
    return book.title ? 'title:' + String(book.title).trim() : '';
  }

  function sanitizeRecentBook_(book) {
    try {
      const copy = JSON.parse(JSON.stringify(book || {}));
      delete copy.detailLoading;
      delete copy.detailPrefetching;
      delete copy.detailQueued;
      delete copy.detailError;
      return copy && copy.title ? copy : null;
    } catch (e) {
      return null;
    }
  }

  function readRecentBooks_() {
    try {
      const raw = window.localStorage && window.localStorage.getItem(RECENT_BOOKS_STORAGE_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed.filter(item => item && item.book && item.key) : [];
    } catch (e) {
      return [];
    }
  }

  function writeRecentBooks_(items) {
    try {
      if (!window.localStorage) return;
      window.localStorage.setItem(RECENT_BOOKS_STORAGE_KEY, JSON.stringify(items.slice(0, RECENT_BOOKS_LIMIT)));
    } catch (e) {
      // 最近開いた本は補助UIなので、保存できない時は表示だけ諦める。
    }
  }

  function getRecentBookMetaText_(book, index) {
    if (index === 0 && book && book.detailLoaded === true) return '端末に保存済み';
    return book.author || book.publisher || book.shelf || '詳細をすぐ開く';
  }

  function rememberRecentBook_(book) {
    const sanitized = sanitizeRecentBook_(book);
    const key = getRecentBookKey_(sanitized);
    if (!sanitized || !key) return;

    const items = readRecentBooks_().filter(item => item.key !== key);
    items.unshift({
      key,
      savedAt: Date.now(),
      book: sanitized
    });
    writeRecentBooks_(items);
    renderRecentBooks_();
  }

  function createRecentRail_() {
    if (getRecentRail_()) return getRecentRail_();

    const quickRail = document.getElementById('quickBrowseRail');
    if (!quickRail || !quickRail.parentNode) return null;

    const rail = document.createElement('section');
    rail.id = 'pwaRecentRail';
    rail.className = 'pwa-recent-rail';
    rail.setAttribute('aria-label', '最近開いた本');
    rail.hidden = true;

    const title = document.createElement('div');
    title.className = 'pwa-recent-title';
    title.textContent = '最近開いた本';
    rail.appendChild(title);

    const list = document.createElement('div');
    list.className = 'pwa-recent-list';
    rail.appendChild(list);

    list.addEventListener('click', function(event) {
      const button = event.target && event.target.closest
        ? event.target.closest('.pwa-recent-book')
        : null;
      if (!button) return;
      const index = Number(button.getAttribute('data-index'));
      const items = readRecentBooks_();
      const item = items[index];
      if (!item || !item.book || typeof window.showPopup !== 'function') return;
      window.showPopup(item.book, index, items.map(entry => entry.book));
    });

    quickRail.insertAdjacentElement('afterend', rail);
    return rail;
  }

  function renderRecentBooks_() {
    const rail = createRecentRail_();
    if (!rail) return;

    const list = rail.querySelector('.pwa-recent-list');
    const items = readRecentBooks_().slice(0, RECENT_BOOKS_LIMIT);
    rail.hidden = items.length === 0;
    if (!list) return;

    list.innerHTML = '';
    items.forEach((item, index) => {
      const book = item.book || {};
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'pwa-recent-book';
      if (index === 0) button.classList.add('continue');
      button.setAttribute('data-index', String(index));
      button.setAttribute('aria-label', (book.title || 'タイトルなし') + ' を開く');

      if (index === 0) {
        const kicker = document.createElement('span');
        kicker.className = 'pwa-recent-book-kicker';
        kicker.textContent = '続きから';
        button.appendChild(kicker);
      }

      const title = document.createElement('span');
      title.className = 'pwa-recent-book-title';
      title.textContent = book.title || '(タイトルなし)';
      button.appendChild(title);

      const meta = document.createElement('span');
      meta.className = 'pwa-recent-book-meta';
      meta.textContent = getRecentBookMetaText_(book, index);
      button.appendChild(meta);

      list.appendChild(button);
    });
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
  window.addEventListener('shumi-library:book-opened', function(event) {
    rememberRecentBook_(event && event.detail ? event.detail.book : null);
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
    renderRecentBooks_();

    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('./sw.js')
        .then(watchServiceWorkerUpdate_)
        .catch(function(error) {
          console.warn('service worker registration failed:', error);
        });
    }
  });
})();
