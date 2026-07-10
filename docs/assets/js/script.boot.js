const STATIC_ACTION_HANDLERS = {
  'search': search,
  'focus-search': focusSearchEntry_,
  'random': showRandomBooks,
  'bookshelf': showAllBookshelf,
  'top': returnToTopPage_,
  'toggle-advanced': toggleAdvancedSearch,
  'clear-conditions': clearSearchConditions,
  'reset-search': resetSearch
};

window.addEventListener('DOMContentLoaded', function() {
  fetchInitialSearchData();
  bindSensitiveToggle_();
  bindStaticActionHandlers_();
  bindMobileAppDockInputState_();
  bindBookshelfScrollMemory_();

  const keywordInput = document.getElementById('keyword');
  keywordInput.addEventListener('input', function() {
    showSuggestList('keyword', 'keyword-suggest', 'keyword');
  });
  keywordInput.addEventListener('blur', function() {
    hideSuggestBox('keyword-suggest');
  });
  addSuggestKeyHandler('keyword', 'keyword-suggest', 'keyword');

    const detailTitleInput = document.getElementById('detailTitle');
  if (detailTitleInput) {
    detailTitleInput.addEventListener('input', function() {
      showSuggestList('detailTitle', 'detailTitle-suggest', 'detailTitle');
    });
    detailTitleInput.addEventListener('blur', function() {
      hideSuggestBox('detailTitle-suggest');
    });
    addSuggestKeyHandler('detailTitle', 'detailTitle-suggest', 'detailTitle');
  }

  const previewSyncTargets = [
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
  ];

  previewSyncTargets.forEach(id => {
    const input = document.getElementById(id);
    if (!input) return;

    const eventName = input.tagName === 'SELECT' ? 'change' : 'input';
    input.addEventListener(eventName, function() {
      syncSearchStatusPreviewFromForm_();
    });

    if (eventName !== 'change') {
      input.addEventListener('change', function() {
        syncSearchStatusPreviewFromForm_();
      });
    }
  });

  const detailReleasedFromYear = document.getElementById('detailReleasedFromYear');
  const detailReleasedFromMonth = document.getElementById('detailReleasedFromMonth');
  const detailReleasedToYear = document.getElementById('detailReleasedToYear');

  if (detailReleasedFromYear) {
    detailReleasedFromYear.addEventListener('change', function() {
      syncReleasedRangeOptions_();
      syncSearchStatusPreviewFromForm_();
    });
  }

  if (detailReleasedFromMonth) {
    detailReleasedFromMonth.addEventListener('change', function() {
      syncReleasedRangeOptions_();
      syncSearchStatusPreviewFromForm_();
    });
  }

  if (detailReleasedToYear) {
    detailReleasedToYear.addEventListener('change', function() {
      syncReleasedRangeOptions_();
      syncSearchStatusPreviewFromForm_();
    });
  }

  syncSearchStatusPreviewFromForm_();

  const enterTargets = [
    'keyword',
    'detailTitle',
    'detailYomi',
    'detailAuthor'
  ];

  enterTargets.forEach(id => {
    const input = document.getElementById(id);
    if (!input) return;

    input.addEventListener('keydown', function(event) {
      const keywordSuggestOpen =
        id === 'keyword' &&
        document.getElementById('keyword-suggest').style.display === 'block' &&
        currentSuggestIndex.keyword >= 0;

      const detailTitleSuggestOpen =
        id === 'detailTitle' &&
        document.getElementById('detailTitle-suggest').style.display === 'block' &&
        currentSuggestIndex.detailTitle >= 0;

      if (event.key === 'Enter' && !keywordSuggestOpen && !detailTitleSuggestOpen) {
        event.preventDefault();
        search();
      }
    });
  });

  const tileBtn = document.getElementById('tileViewBtn');
  const listBtn = document.getElementById('listViewBtn');
  const shelfBtn = document.getElementById('shelfViewBtn');

  if (tileBtn) {
    tileBtn.addEventListener('click', function() {
      setViewMode_('card');
    });
  }
  if (listBtn) {
    listBtn.addEventListener('click', function() {
      setViewMode_('list');
    });
  }
  if (shelfBtn) {
    shelfBtn.addEventListener('click', function() {
      setViewMode_('shelf');
    });
  }
  document.querySelectorAll('[data-view-mode]').forEach(btn => {
    btn.addEventListener('click', function(event) {
      event.preventDefault();
      event.stopPropagation();
      setViewMode_(btn.dataset.viewMode || 'card');
    });
  });
  currentViewMode = loadPreferredResultViewMode_();
  isCardView = currentViewMode === 'card';
  updateViewToggleButtons_();
  syncMobileAppDockState_();
  runLaunchActionFromUrl_();

  document.addEventListener('click', function(event) {
    const topShelfBtn = event.target && event.target.closest
      ? event.target.closest('.top-shelf-btn')
      : null;
    if (!topShelfBtn) return;

    event.preventDefault();
    event.stopPropagation();
    showAllBookshelf();
  });

  const searchStatusChips = document.getElementById('searchStatusChips');
  if (searchStatusChips) {
    searchStatusChips.addEventListener('click', function(event) {
      const rerollBtn = event.target.closest('.search-status-reroll');
      if (rerollBtn) {
        event.preventDefault();
        event.stopPropagation();
        showRandomBooks();
        return;
      }

      const removeBtn = event.target.closest('.search-status-chip-remove');
      if (!removeBtn) return;

      event.preventDefault();
      event.stopPropagation();

      const key = removeBtn.dataset.key || '';
      if (!key || key === 'random') return;

      removeSearchCondition_(key);
    });
  }

  const quickBrowseChips = document.getElementById('quickBrowseChips');
  if (quickBrowseChips) {
    quickBrowseChips.addEventListener('click', function(event) {
      const chip = event.target.closest('.quick-browse-chip');
      if (!chip) return;

      event.preventDefault();
      event.stopPropagation();
      applyQuickBrowseCondition_(chip.dataset.field || '', chip.dataset.value || '');
    });
  }

  const quickBrowseRefresh = document.getElementById('quickBrowseRefresh');
  if (quickBrowseRefresh) {
    quickBrowseRefresh.addEventListener('click', function(event) {
      event.preventDefault();
      event.stopPropagation();
      if (typeof shuffleQuickBrowseRail_ === 'function') {
        shuffleQuickBrowseRail_();
      }
    });
  }

  document.addEventListener('click', function(event) {
    const chip = event.target.closest('.genre-chip[data-genre-field]');
    if (!chip) return;

    event.preventDefault();
    event.stopPropagation();
    applyGenreChipSearch_(chip.dataset.genreField || '', chip.dataset.genreValue || '');
  });



});


function focusSearchEntry_() {
  hideAllSuggest();

  const container = document.getElementById('searchContainer');
  const keywordInput = document.getElementById('keyword');

  if (container) {
    container.classList.remove('compact');
    compactLocked = false;
  }

  window.scrollTo({ top: 0, behavior: 'smooth' });

  window.setTimeout(function() {
    if (!keywordInput) return;
    try {
      keywordInput.focus({ preventScroll: true });
    } catch (e) {
      keywordInput.focus();
    }
  }, 180);

  syncMobileAppDockState_('focus-search');
}

function returnToTopPage_() {
  hideAllSuggest();
  resetSearch();
}

function getMobileAppDockActiveAction_() {
  if (searchStatusState && searchStatusState.mode === 'random') return 'random';
  if (currentViewMode === 'shelf') return '';
  return 'focus-search';
}

function getMobileDockViewLabel_(mode) {
  switch (mode) {
    case 'list':
      return 'リスト表示';
    case 'shelf':
      return '棚表示';
    case 'card':
    default:
      return 'タイル表示';
  }
}

function getMobileDockStatusText_(hasResults) {
  if (!hasResults) return '検索前';

  const count = Array.isArray(lastResult) ? lastResult.length : 0;
  if (searchStatusState && searchStatusState.mode === 'random') {
    return `${count}冊をランダム表示`;
  }
  if (searchStatusState && searchStatusState.mode === 'shelf') {
    return `全${count}冊 / 棚表示`;
  }
  const seriesCount = searchStatusState && searchStatusState.mode === 'result'
    ? Number(searchStatusState.seriesGroupCount || 0)
    : 0;
  const countLabel = seriesCount > 0 ? `${seriesCount}シリーズ・${count}冊` : `${count}冊`;
  return `${countLabel} / ${getMobileDockViewLabel_(getCurrentViewMode_())}`;
}

function getMobileDockStatusParts_(hasResults) {
  if (!hasResults) {
    return { count: '検索前', mode: '' };
  }

  const count = Array.isArray(lastResult) ? lastResult.length : 0;
  if (searchStatusState && searchStatusState.mode === 'random') {
    return { count: `${count}冊`, mode: 'ランダム' };
  }
  if (searchStatusState && searchStatusState.mode === 'shelf') {
    return { count: `全${count}冊`, mode: '棚表示' };
  }
  const seriesCount = searchStatusState && searchStatusState.mode === 'result'
    ? Number(searchStatusState.seriesGroupCount || 0)
    : 0;
  return {
    count: seriesCount > 0 ? `${seriesCount}シリーズ・${count}冊` : `${count}冊`,
    mode: getMobileDockViewLabel_(getCurrentViewMode_())
  };
}

function renderMobileDockStatus_(status, hasResults) {
  if (!status) return;
  const parts = getMobileDockStatusParts_(hasResults);

  status.textContent = '';
  if (!hasResults) {
    status.textContent = parts.count;
    return;
  }

  const countSpan = document.createElement('span');
  countSpan.className = 'mobile-app-dock-status-count';
  countSpan.textContent = parts.count;

  const modeSpan = document.createElement('span');
  modeSpan.className = 'mobile-app-dock-status-mode';
  modeSpan.textContent = parts.mode;

  status.appendChild(countSpan);
  status.appendChild(modeSpan);
}

function syncMobileAppDockState_(activeAction) {
  const dock = document.getElementById('mobileAppDock');
  if (!dock) return;

  const hasResults = Array.isArray(lastResult) && lastResult.length > 0;
  dock.classList.toggle('has-results', hasResults);
  dock.setAttribute('aria-label', hasResults ? `主要操作と表示切替。${getMobileDockStatusText_(hasResults)}` : '主要操作');
  const status = document.getElementById('mobileDockStatus');
  renderMobileDockStatus_(status, hasResults);
  if (document.body) {
    document.body.classList.toggle('mobile-dock-has-results', hasResults);
  }

  const active = activeAction || getMobileAppDockActiveAction_();
  dock.querySelectorAll('.mobile-app-dock-btn').forEach(btn => {
    const isActive = (btn.dataset.action || '') === active;
    btn.classList.toggle('active', isActive);
    btn.setAttribute('aria-current', isActive ? 'true' : 'false');
  });
}

function setMobileAppDockInputActive_(active) {
  if (!document.body) return;
  document.body.classList.toggle('mobile-input-active', Boolean(active));
}

function isMobileAppDockInputTarget_(element) {
  if (!element || !element.matches) return false;
  return element.matches('.search-form input, .search-form select, .search-form textarea');
}

function bindMobileAppDockInputState_() {
  const fields = document.querySelectorAll('.search-form input, .search-form select, .search-form textarea');
  if (!fields.length) return;

  fields.forEach(field => {
    field.addEventListener('pointerdown', function() {
      setMobileAppDockInputActive_(true);
    }, { passive: true });
    field.addEventListener('focus', function() {
      setMobileAppDockInputActive_(true);
    });
    field.addEventListener('input', function() {
      setMobileAppDockInputActive_(true);
    });
  });

  document.addEventListener('pointerdown', function(event) {
    if (isMobileAppDockInputTarget_(event.target)) return;
    setMobileAppDockInputActive_(false);
  }, { passive: true });

  document.addEventListener('keydown', function(event) {
    if (event.key === 'Escape') setMobileAppDockInputActive_(false);
  });
}

function getLaunchActionFromUrl_() {
  try {
    const params = new URLSearchParams(window.location.search || '');
    const launch = String(params.get('launch') || '').trim().toLowerCase();
    return ['bookshelf', 'random', 'search'].includes(launch) ? launch : '';
  } catch (e) {
    return '';
  }
}

function clearLaunchActionFromUrl_() {
  if (!window.history || typeof window.history.replaceState !== 'function') return;

  try {
    const url = new URL(window.location.href);
    if (!url.searchParams.has('launch')) return;

    url.searchParams.delete('launch');
    const nextUrl =
      url.pathname +
      (url.searchParams.toString() ? '?' + url.searchParams.toString() : '') +
      url.hash;

    window.history.replaceState(window.history.state, document.title, nextUrl);
  } catch (e) {
    // URL整理に失敗しても、起動アクション自体は続ける。
  }
}

function runLaunchActionFromUrl_() {
  const launch = getLaunchActionFromUrl_();
  if (!launch) return;

  clearLaunchActionFromUrl_();

  window.setTimeout(function() {
    if (launch === 'bookshelf') {
      showAllBookshelf();
      return;
    }
    if (launch === 'random') {
      showRandomBooks();
      return;
    }
    focusSearchEntry_();
  }, 180);
}

let lastScrollY = window.scrollY || 0;
let compactLocked = false;
let compactRafId = 0;
let compactLastToggleAt = 0;

const COMPACT_ON_Y = 260;
const COMPACT_OFF_Y = 32;
const COMPACT_TOGGLE_COOLDOWN_MS = 220;

/**
 * 検索ヘッダーのcompact状態を同期する。
 *
 * 方針:
 * - スクロール方向ではなく絶対位置で判定
 * - compact化と解除の境界を大きく離す
 * - 切替直後のscroll揺れを一定時間無視する
 * - 上端付近以外ではcompact解除しない
 */
function syncSearchContainerCompact_() {
  const container = document.getElementById('searchContainer');
  if (!container) return;

  const currentY = window.scrollY || 0;
  const now = Date.now();

  // 初期表示・リセット後・検索前はcompactを使わない
  if (!container.classList.contains('shrink')) {
    container.classList.remove('compact');
    compactLocked = false;
    lastScrollY = currentY;
    return;
  }

  // 切替直後は、stickyや高さ変化によるscroll揺れを無視する
  if (now - compactLastToggleAt < COMPACT_TOGGLE_COOLDOWN_MS) {
    lastScrollY = currentY;
    return;
  }

  // 上端付近まで戻った時だけcompact解除
  if (compactLocked && currentY <= COMPACT_OFF_Y) {
    container.classList.remove('compact');
    compactLocked = false;
    compactLastToggleAt = now;
    lastScrollY = currentY;
    return;
  }

  // 十分下までスクロールした時だけcompact化
  if (!compactLocked && currentY >= COMPACT_ON_Y) {
    container.classList.add('compact');
    compactLocked = true;
    compactLastToggleAt = now;
    lastScrollY = currentY;
    return;
  }

  lastScrollY = currentY;
}

window.addEventListener('scroll', function() {
  if (compactRafId) return;

  compactRafId = requestAnimationFrame(function() {
    compactRafId = 0;
    syncSearchContainerCompact_();
  });
}, { passive: true });