const STATIC_ACTION_HANDLERS = {
  'search': search,
  'random': showRandomBooks,
  'toggle-advanced': toggleAdvancedSearch,
  'clear-conditions': clearSearchConditions,
  'reset-search': resetSearch
};

window.addEventListener('DOMContentLoaded', function() {
  fetchInitialSearchData();
  bindSensitiveToggle_();
  bindStaticActionHandlers_();

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
  currentViewMode = loadPreferredResultViewMode_();
  isCardView = currentViewMode === 'card';
  updateViewToggleButtons_();

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

  document.addEventListener('click', function(event) {
    const chip = event.target.closest('.genre-chip[data-genre-field]');
    if (!chip) return;

    event.preventDefault();
    event.stopPropagation();
    applyGenreChipSearch_(chip.dataset.genreField || '', chip.dataset.genreValue || '');
  });



});


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