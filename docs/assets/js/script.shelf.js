function getShelfGroupBookCount_(group) {
  return (group && group.sections ? group.sections : []).reduce((groupTotal, section) => {
    return groupTotal + (section.levels || []).reduce((sectionTotal, level) => {
      return sectionTotal + ((level.books || []).length);
    }, 0);
  }, 0);
}

function getShelfNavTargetId_(index) {
  return `bookshelf-group-${index + 1}`;
}

function getShelfViewStats_(groups, totalCount) {
  const stats = {
    total: Number(totalCount) || 0,
    groups: Array.isArray(groups) ? groups.length : 0,
    sections: 0,
    levels: 0,
    unresolved: 0
  };

  (groups || []).forEach(group => {
    if (group && group.key === '__unknown__') {
      stats.unresolved += Number(group.count || getShelfGroupBookCount_(group) || 0);
    }

    (group.sections || []).forEach(section => {
      stats.sections += 1;
      stats.levels += (section.levels || []).length;
    });
  });

  return stats;
}

function renderShelfViewOverview_(groups, totalCount, immersive) {
  const stats = getShelfViewStats_(groups, totalCount);
  const overview = document.createElement('section');
  overview.className = immersive ? 'shelf-view-overview immersive' : 'shelf-view-overview';
  overview.setAttribute('aria-label', '本棚表示の概要');

  const heading = document.createElement('div');
  heading.className = 'shelf-view-mode';
  heading.textContent = immersive
    ? '蔵書全体を本棚順で表示中'
    : '検索結果を本棚順で表示中';
  overview.appendChild(heading);

  const statGrid = document.createElement('div');
  statGrid.className = 'shelf-view-stat-grid';

  [
    { label: '表示冊数', value: `${stats.total}冊` },
    { label: '棚グループ', value: `${stats.groups}件` },
    { label: '棚段', value: `${stats.levels}段` },
    { label: '整理待ち', value: `${stats.unresolved}冊` }
  ].forEach(item => {
    const stat = document.createElement('div');
    stat.className = 'shelf-view-stat';
    stat.innerHTML = `
      <span class="shelf-view-stat-label">${escapeHtml(item.label)}</span>
      <span class="shelf-view-stat-value">${escapeHtml(item.value)}</span>
    `;
    statGrid.appendChild(stat);
  });

  overview.appendChild(statGrid);

  const note = document.createElement('div');
  note.className = 'shelf-view-note';
  note.textContent = immersive
    ? 'マップと棚ジャンプで、部屋の配置から本棚へ移動できます。'
    : '検索結果だけを棚順に並べています。全体を眺めるときはトップの「本棚を見る」を使います。';
  overview.appendChild(note);

  return overview;
}

function syncActiveShelfNavigation_(targetId) {
  if (!targetId) return;

  document.querySelectorAll('.shelf-jump-chip[data-shelf-target]').forEach(chip => {
    const active = chip.dataset.shelfTarget === targetId;
    chip.classList.toggle('is-active', active);
    chip.setAttribute('aria-current', active ? 'true' : 'false');
  });

  document.querySelectorAll('.room-map-shelf[data-shelf-target]').forEach(shelf => {
    shelf.classList.toggle('is-active', shelf.dataset.shelfTarget === targetId);
  });

  document.querySelectorAll('.bookshelf-group').forEach(group => {
    group.classList.toggle('is-active', group.id === targetId);
  });
}

function disconnectShelfScrollSpy_() {
  if (shelfScrollSpyObserver && typeof shelfScrollSpyObserver.disconnect === 'function') {
    shelfScrollSpyObserver.disconnect();
  }
  shelfScrollSpyObserver = null;
}

function bindShelfScrollSpy_(container) {
  disconnectShelfScrollSpy_();

  if (!container) return;
  const sections = Array.from(container.querySelectorAll('.bookshelf-group[id]'));
  if (!sections.length) return;

  syncActiveShelfNavigation_(sections[0].id);

  if (!('IntersectionObserver' in window)) return;

  shelfScrollSpyObserver = new IntersectionObserver(entries => {
    const visible = entries
      .filter(entry => entry.isIntersecting)
      .sort((a, b) => b.intersectionRatio - a.intersectionRatio);

    if (!visible.length) return;
    syncActiveShelfNavigation_(visible[0].target.id);
  }, {
    root: null,
    rootMargin: '-22% 0px -58% 0px',
    threshold: [0.02, 0.12, 0.28, 0.5]
  });

  sections.forEach(section => shelfScrollSpyObserver.observe(section));
}

function renderShelfJumpNav_(groups, totalCount, immersive) {
  const isImmersive = Boolean(immersive);
  const nav = document.createElement('nav');
  nav.className = isImmersive ? 'shelf-jump-nav immersive' : 'shelf-jump-nav';
  nav.setAttribute('aria-label', '本棚ジャンプ');

  if (isImmersive) {
    const header = document.createElement('div');
    header.className = 'shelf-jump-nav-header';

    const label = document.createElement('div');
    label.className = 'shelf-jump-nav-label';
    label.textContent = Number.isFinite(totalCount)
      ? `棚ジャンプ / ${totalCount}冊`
      : '棚ジャンプ';
    header.appendChild(label);

    const topButton = document.createElement('button');
    topButton.type = 'button';
    topButton.className = 'shelf-jump-top-btn';
    topButton.textContent = 'トップに戻る';
    topButton.onclick = function() {
      resetSearch();
      window.scrollTo({ top: 0, behavior: 'smooth' });
    };
    header.appendChild(topButton);

    nav.appendChild(header);
  } else {
    const label = document.createElement('div');
    label.className = 'shelf-jump-nav-label';
    label.textContent = Number.isFinite(totalCount)
      ? `棚ジャンプ / ${totalCount}冊`
      : '棚ジャンプ';
    nav.appendChild(label);
  }

  const chips = document.createElement('div');
  chips.className = 'shelf-jump-chip-row';

  if (isImmersive) {
    const mapButton = document.createElement('button');
    mapButton.type = 'button';
    mapButton.className = 'shelf-jump-chip shelf-jump-map-chip';
    mapButton.innerHTML = `${uiIcon_('map', 'ui-icon-inline')}<span>マップ</span>`;
    mapButton.onclick = function() {
      openShelfRoomMapOverlay_();
    };
    chips.appendChild(mapButton);
  }

  groups.forEach((group, index) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'shelf-jump-chip';
    button.dataset.shelfTarget = getShelfNavTargetId_(index);
    button.textContent = `${group.label} ${group.count || getShelfGroupBookCount_(group)}冊`;
    button.onclick = function() {
      const target = document.getElementById(button.dataset.shelfTarget);
      if (!target) return;
      syncActiveShelfNavigation_(button.dataset.shelfTarget);
      target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    };
    chips.appendChild(button);
  });

  nav.appendChild(chips);
  return nav;
}


function getRoomMapShelfConfigs_() {
  return [
    // きみの実配置に合わせた固定レイアウト。
    // v2.0.8: 棚配置はv2.0.6系を維持し、PC近傍は
    // 同人本棚・L字デスク・PC・PC横が壁/家具同士に接する構造へ調整。
    { key: '8', label: '⑧', x: 3.5,  y: 6,  w: 13, h: 9,  tone: 'wall' },
    { key: '7', label: '⑦', x: 16.5, y: 6,  w: 13, h: 9,  tone: 'wall' },
    { key: '1', label: '①', x: 83.5, y: 6,  w: 13, h: 9,  tone: 'wall' },

    { key: '6', label: '⑥', x: 39, y: 6,  w: 7,  h: 18, tone: 'island vertical' },
    { key: '2', label: '②', x: 46, y: 6,  w: 7,  h: 18, tone: 'island vertical' },
    { key: '5', label: '⑤', x: 39, y: 24, w: 7,  h: 18, tone: 'island vertical' },
    { key: '3', label: '③', x: 46, y: 24, w: 7,  h: 18, tone: 'island vertical' },
    { key: '4', label: '④', x: 39, y: 42, w: 14, h: 8,  tone: 'island' },

    // PC近傍：PC横はPC縦辺と同幅・同右端で、PCの真上に接する配置。
    { key: 'PC横', label: 'PC横', x: 84, y: 47, w: 9, h: 7, tone: 'wall' }
  ];
}

function getRoomMapGroupIndex_(groups, mapKey) {
  const circledByKey = {
    '1': '①', '2': '②', '3': '③', '4': '④',
    '5': '⑤', '6': '⑥', '7': '⑦', '8': '⑧'
  };

  const groupKey = mapKey === 'PC横'
    ? '__pcside__'
    : `normal:${circledByKey[String(mapKey)] || mapKey}`;

  return (groups || []).findIndex(group => group && group.key === groupKey);
}

function getRoomMapGroupCount_(groups, mapKey) {
  const index = getRoomMapGroupIndex_(groups, mapKey);
  if (index < 0) return 0;
  const group = groups[index];
  return Number(group && (group.count || getShelfGroupBookCount_(group)) || 0);
}

function scrollToRoomMapShelf_(groups, mapKey) {
  const index = getRoomMapGroupIndex_(groups, mapKey);
  if (index < 0) return;

  const target = document.getElementById(getShelfNavTargetId_(index));
  if (!target) return;
  target.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function setRoomMapBoxStyle_(el, config) {
  el.style.left = `${config.x}%`;
  el.style.top = `${config.y}%`;
  el.style.width = `${config.w}%`;
  el.style.height = `${config.h}%`;
}

function createShelfRoomMapViewport_(groups, options) {
  const opt = options || {};
  const viewport = document.createElement('div');
  viewport.className = opt.modal ? 'shelf-room-map-viewport modal' : 'shelf-room-map-viewport';

  const canvas = document.createElement('div');
  canvas.className = 'shelf-room-map-canvas';
  canvas.setAttribute('aria-label', '趣味部屋の本棚配置マップ');

  const room = document.createElement('div');
  room.className = 'room-map-outline';
  canvas.appendChild(room);

  const entrance = document.createElement('div');
  entrance.className = 'room-map-entrance';
  entrance.textContent = '入口';
  canvas.appendChild(entrance);

  const deskMain = document.createElement('div');
  deskMain.className = 'room-map-fixture room-map-desk room-map-desk-main';
  deskMain.textContent = 'L字デスク';
  canvas.appendChild(deskMain);

  const deskSide = document.createElement('div');
  deskSide.className = 'room-map-fixture room-map-desk room-map-desk-side';
  deskSide.textContent = 'PC';
  canvas.appendChild(deskSide);

  const doujin = document.createElement('div');
  doujin.className = 'room-map-fixture room-map-doujin';
  doujin.innerHTML = '<span>同人本棚</span><small>未登録</small>';
  canvas.appendChild(doujin);

  getRoomMapShelfConfigs_().forEach(config => {
    const count = getRoomMapGroupCount_(groups, config.key);
    const targetIndex = getRoomMapGroupIndex_(groups, config.key);
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `room-map-shelf ${config.tone || ''}`;
    if (targetIndex >= 0) {
      button.dataset.shelfTarget = getShelfNavTargetId_(targetIndex);
    }
    button.disabled = targetIndex < 0;
    button.setAttribute('aria-label', `${config.label} 本棚へ移動`);
    button.innerHTML = `
      <span class="room-map-shelf-label">${escapeHtml(config.label)}</span>
      <span class="room-map-shelf-count">${count ? `${count}冊` : '0冊'}</span>
    `;
    setRoomMapBoxStyle_(button, config);
    button.onclick = function() {
      if (opt.closeOnShelfClick) {
        closeShelfRoomMapOverlay_();
      }
      scrollToRoomMapShelf_(groups, config.key);
    };
    canvas.appendChild(button);
  });

  viewport.appendChild(canvas);
  return viewport;
}

function renderShelfRoomMap_(groups) {
  const details = document.createElement('details');
  details.className = 'shelf-room-map';

  const summary = document.createElement('summary');
  summary.className = 'shelf-room-map-summary';

  const summaryLabel = document.createElement('span');
  summaryLabel.className = 'shelf-room-map-summary-label';
  summaryLabel.textContent = '趣味部屋マップを開く';
  summary.appendChild(summaryLabel);
  details.appendChild(summary);

  details.addEventListener('toggle', function() {
    summaryLabel.textContent = details.open
      ? '趣味部屋マップを閉じる'
      : '趣味部屋マップを開く';
  });

  details.appendChild(createShelfRoomMapViewport_(groups));
  return details;
}

function renderShelfRoomMapFloatingLauncher_() {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'shelf-room-map-fab';
  button.setAttribute('aria-label', '趣味部屋マップを開く');
  button.innerHTML = `${uiIcon_('map', 'shelf-room-map-fab-icon')}<span class="shelf-room-map-fab-label">マップ</span>`;
  button.onclick = function() {
    openShelfRoomMapOverlay_();
  };
  return button;
}

function unmountShelfRoomMapPortal_() {
  document.querySelectorAll('.shelf-room-map-fab, .shelf-room-map-overlay').forEach(el => {
    if (el && el.parentNode) {
      el.parentNode.removeChild(el);
    }
  });
  document.body.classList.remove('shelf-room-map-modal-open');
}

function mountShelfRoomMapPortal_(groups) {
  unmountShelfRoomMapPortal_();

  if (!isShelfImmersiveMode || !Array.isArray(groups) || !groups.length) {
    return;
  }

  document.body.appendChild(renderShelfRoomMapFloatingLauncher_());
  document.body.appendChild(renderShelfRoomMapOverlay_(groups));
}

function renderShelfRoomMapOverlay_(groups) {
  const overlay = document.createElement('div');
  overlay.className = 'shelf-room-map-overlay';
  overlay.hidden = true;
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.setAttribute('aria-label', '趣味部屋マップ');
  overlay.tabIndex = -1;

  const panel = document.createElement('div');
  panel.className = 'shelf-room-map-modal-panel';
  panel.onclick = function(e) {
    e.stopPropagation();
  };

  const header = document.createElement('div');
  header.className = 'shelf-room-map-modal-header';

  const title = document.createElement('div');
  title.className = 'shelf-room-map-modal-title';
  title.textContent = '趣味部屋マップ';
  header.appendChild(title);

  const closeButton = document.createElement('button');
  closeButton.type = 'button';
  closeButton.className = 'shelf-room-map-modal-close';
  closeButton.setAttribute('aria-label', '趣味部屋マップを閉じる');
  closeButton.innerHTML = uiIcon_('close');
  closeButton.onclick = function() {
    closeShelfRoomMapOverlay_();
  };
  header.appendChild(closeButton);
  panel.appendChild(header);

  const hint = document.createElement('div');
  hint.className = 'shelf-room-map-modal-hint';
  hint.textContent = '棚を選ぶと、その本棚へ移動します。';
  panel.appendChild(hint);

  panel.appendChild(createShelfRoomMapViewport_(groups, {
    modal: true,
    closeOnShelfClick: true
  }));

  overlay.onclick = function() {
    closeShelfRoomMapOverlay_();
  };
  overlay.onkeydown = function(e) {
    if (e.key === 'Escape') {
      closeShelfRoomMapOverlay_();
    }
  };

  overlay.appendChild(panel);
  return overlay;
}

function openShelfRoomMapOverlay_() {
  const overlay = document.querySelector('.shelf-room-map-overlay');
  if (!overlay) return;
  overlay.hidden = false;
  overlay.classList.add('open');
  document.body.classList.add('shelf-room-map-modal-open');

  const closeButton = overlay.querySelector('.shelf-room-map-modal-close');
  if (closeButton && typeof closeButton.focus === 'function') {
    closeButton.focus({ preventScroll: true });
  } else if (typeof overlay.focus === 'function') {
    overlay.focus({ preventScroll: true });
  }
}

function closeShelfRoomMapOverlay_() {
  const overlay = document.querySelector('.shelf-room-map-overlay');
  if (!overlay) return;
  overlay.classList.remove('open');
  overlay.hidden = true;
  document.body.classList.remove('shelf-room-map-modal-open');
}

function normalizeBookshelfText_(value) {
  // ①〜⑳は本棚ラベルとして表示に残したいため、ここではNFKC正規化しない。
  return String(value || '')
    .replace(/\u00A0/g, ' ')
    .replace(/\u200B/g, '')
    .replace(/\uFEFF/g, '')
    .trim();
}

function getBookshelfNumber_(label) {
  const value = normalizeBookshelfText_(label);
  const circled = {
    '①': 1, '②': 2, '③': 3, '④': 4, '⑤': 5,
    '⑥': 6, '⑦': 7, '⑧': 8, '⑨': 9, '⑩': 10,
    '⑪': 11, '⑫': 12, '⑬': 13, '⑭': 14, '⑮': 15,
    '⑯': 16, '⑰': 17, '⑱': 18, '⑲': 19, '⑳': 20
  };

  if (Object.prototype.hasOwnProperty.call(circled, value)) {
    return circled[value];
  }

  const numeric = value.match(/[0-9０-９]+/);
  return numeric ? Number(numeric[0].normalize('NFKC')) : 999;
}

function getBookshelfLevelNumber_(value) {
  const normalized = normalizeBookshelfText_(value);
  if (!normalized || normalized === '-') return 999;

  const numeric = normalized.match(/[0-9０-９]+/);
  return numeric ? Number(numeric[0].normalize('NFKC')) : 999;
}

function parseBookshelfPosition_(book) {
  const shelf = normalizeBookshelfText_(book && book.shelf);
  const location = normalizeBookshelfText_(book && book.location);
  const unresolvedValues = ['', '-', '未定', '不明', '未分類'];

  if (unresolvedValues.includes(shelf)) {
    return {
      type: 'unknown',
      groupKey: '__unknown__',
      groupLabel: '未分類・未定',
      sectionKey: '__unknown__',
      sectionLabel: '配置未定',
      levelKey: '__unknown__',
      levelLabel: '段未定',
      groupSort: 9999,
      sectionSort: 0,
      levelSort: 999
    };
  }

  if (shelf === 'PC横') {
    return {
      type: 'pcside',
      groupKey: '__pcside__',
      groupLabel: 'PC横',
      sectionKey: '__pcside__',
      sectionLabel: 'PC横',
      levelKey: location && location !== '-' ? location : '__unknown__',
      levelLabel: location && location !== '-' ? `${location}段` : '段未定',
      groupSort: 8500,
      sectionSort: 0,
      levelSort: getBookshelfLevelNumber_(location)
    };
  }

  if (shelf === '茨城') {
    return {
      type: 'ibaraki',
      groupKey: '__ibaraki__',
      groupLabel: '茨城 本棚',
      sectionKey: '__ibaraki__',
      sectionLabel: '茨城',
      levelKey: location && location !== '-' ? location : '__unknown__',
      levelLabel: location && location !== '-' ? `${location}段` : '段未定',
      groupSort: 9000,
      sectionSort: 0,
      levelSort: getBookshelfLevelNumber_(location)
    };
  }

  const match = shelf.match(/^([①-⑳0-9０-９]+)\s*[-－ー―]\s*(上|下)$/);
  if (match) {
    const bookcaseLabel = match[1];
    const sectionLabel = match[2];
    const bookcaseNumber = getBookshelfNumber_(bookcaseLabel);
    const sectionSort = sectionLabel === '上' ? 1 : 2;
    const levelKnown = Boolean(location && location !== '-');

    return {
      type: 'normal',
      groupKey: `normal:${bookcaseLabel}`,
      groupLabel: `${bookcaseLabel} 本棚`,
      sectionKey: `normal:${bookcaseLabel}:${sectionLabel}`,
      sectionLabel: `${bookcaseLabel}-${sectionLabel}`,
      levelKey: levelKnown ? location : '__unknown__',
      levelLabel: levelKnown ? `${location}段` : '段未定',
      groupSort: bookcaseNumber,
      sectionSort,
      levelSort: getBookshelfLevelNumber_(location)
    };
  }

  return {
    type: 'unknown',
    groupKey: '__unknown__',
    groupLabel: '未分類・未定',
    sectionKey: `unknown:${shelf || '-'}`,
    sectionLabel: shelf ? `解析不能：${shelf}` : '配置未定',
    levelKey: location && location !== '-' ? location : '__unknown__',
    levelLabel: location && location !== '-' ? `${location}段` : '段未定',
    groupSort: 9999,
    sectionSort: 0,
    levelSort: getBookshelfLevelNumber_(location)
  };
}

function groupBooksByShelf_(data) {
  const groupMap = new Map();

  (data || []).forEach((book, originalIndex) => {
    const pos = parseBookshelfPosition_(book);

    if (!groupMap.has(pos.groupKey)) {
      groupMap.set(pos.groupKey, {
        key: pos.groupKey,
        label: pos.groupLabel,
        sort: pos.groupSort,
        count: 0,
        sections: new Map()
      });
    }

    const group = groupMap.get(pos.groupKey);
    if (!group.sections.has(pos.sectionKey)) {
      group.sections.set(pos.sectionKey, {
        key: pos.sectionKey,
        label: pos.sectionLabel,
        sort: pos.sectionSort,
        count: 0,
        levels: new Map()
      });
    }

    const section = group.sections.get(pos.sectionKey);
    if (!section.levels.has(pos.levelKey)) {
      section.levels.set(pos.levelKey, {
        key: pos.levelKey,
        label: pos.levelLabel,
        sort: pos.levelSort,
        books: []
      });
    }

    group.count++;
    section.count++;
    section.levels.get(pos.levelKey).books.push({
      book,
      originalIndex
    });
  });

  return Array.from(groupMap.values())
    .sort((a, b) => a.sort - b.sort || String(a.label).localeCompare(String(b.label), 'ja'))
    .map(group => ({
      key: group.key,
      label: group.label,
      sort: group.sort,
      count: group.count || 0,
      sections: Array.from(group.sections.values())
        .sort((a, b) => a.sort - b.sort || String(a.label).localeCompare(String(b.label), 'ja'))
        .map(section => ({
          key: section.key,
          label: section.label,
          sort: section.sort,
          count: section.count || 0,
          levels: Array.from(section.levels.values())
            .sort((a, b) => a.sort - b.sort || String(a.label).localeCompare(String(b.label), 'ja'))
        }))
    }));
}

function flattenShelfBooksForPopup_(groups) {
  const orderedItems = [];
  (groups || []).forEach(group => {
    (group.sections || []).forEach(section => {
      (section.levels || []).forEach(level => {
        (level.books || []).forEach(item => {
          orderedItems.push(item);
        });
      });
    });
  });
  return orderedItems;
}

function setBookRevealIndex_(element, index) {
  if (!element) return;
  const safeIndex = Math.min(Math.max(Number(index) || 0, 0), 14);
  element.style.setProperty('--book-reveal-index', String(safeIndex));
}

function createShelfBookElement_(book, originalIndex, data, revealIndex) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'shelf-book';
  button.setAttribute('aria-label', `${book && book.title ? book.title : 'タイトルなし'} の詳細を開く`);
  setBookRevealIndex_(button, revealIndex);

  const imgWrap = document.createElement('span');
  imgWrap.className = 'shelf-book-cover-wrap';

  const img = document.createElement('img');
  img.className = 'shelf-book-cover';
  img.alt = book && book.title ? book.title : '表紙';
  setupBookImageElement_(img, book, { track: false });

  imgWrap.appendChild(img);
  button.appendChild(imgWrap);

  const title = document.createElement('span');
  title.className = 'shelf-book-title';
  title.textContent = book && book.title ? book.title : '(タイトルなし)';
  button.appendChild(title);

  button.onclick = function(e) {
    e.preventDefault();
    e.stopPropagation();
    queueBookDetailPrefetch_(book, true);
    showPopup(book, originalIndex, data);
  };

  observeBookDetailPrefetch_(button, book);
  return button;
}

function renderShelfView_(data) {
  resetBookDetailPrefetchObserver_();

  const groups = groupBooksByShelf_(data);
  const shelfPopupItems = flattenShelfBooksForPopup_(groups);
  const shelfPopupData = shelfPopupItems.map(item => item.book);
  const shelfPopupIndexByOriginalIndex = new Map();
  shelfPopupItems.forEach((item, popupIndex) => {
    if (!shelfPopupIndexByOriginalIndex.has(item.originalIndex)) {
      shelfPopupIndexByOriginalIndex.set(item.originalIndex, popupIndex);
    }
  });

  const container = document.createElement('div');
  container.className = 'shelf-view';

  if (groups.length > 1) {
    container.appendChild(renderShelfJumpNav_(groups, data.length, isShelfImmersiveMode));
  }

  if (isShelfImmersiveMode) {
    currentShelfRoomMapGroups = groups;
  }

  let shelfRevealIndex = 0;

  container.appendChild(renderShelfViewOverview_(groups, data.length, isShelfImmersiveMode));

  groups.forEach((group, groupIndex) => {
    const groupSection = document.createElement('section');
    groupSection.className = 'bookshelf-group';
    if (group.key === '__unknown__') {
      groupSection.classList.add('is-unresolved');
    }
    groupSection.id = getShelfNavTargetId_(groupIndex);

    const groupTitle = document.createElement('h2');
    groupTitle.className = 'bookshelf-group-title';
    groupTitle.innerHTML = `
      <span class="bookshelf-group-label">${escapeHtml(group.label)}</span>
      <span class="bookshelf-group-count">${escapeHtml(String(group.count || getShelfGroupBookCount_(group)))}冊</span>
    `;
    groupSection.appendChild(groupTitle);

    group.sections.forEach(section => {
      const sectionWrap = document.createElement('div');
      sectionWrap.className = 'bookshelf-section';

      const sectionTitle = document.createElement('h3');
      sectionTitle.className = 'bookshelf-section-title';
      sectionTitle.textContent = section.label;
      sectionWrap.appendChild(sectionTitle);

      section.levels.forEach(level => {
        const levelWrap = document.createElement('div');
        levelWrap.className = 'bookshelf-level';

        const levelTitle = document.createElement('div');
        levelTitle.className = 'bookshelf-level-title';
        levelTitle.innerHTML = `
          <span class="bookshelf-level-label">${escapeHtml(level.label)}</span>
          <span class="bookshelf-level-count">${escapeHtml(String(level.books.length))}冊</span>
        `;
        levelWrap.appendChild(levelTitle);

        const strip = document.createElement('div');
        strip.className = 'bookshelf-strip';
        level.books.forEach(item => {
          const popupIndex = shelfPopupIndexByOriginalIndex.has(item.originalIndex)
            ? shelfPopupIndexByOriginalIndex.get(item.originalIndex)
            : item.originalIndex;
          strip.appendChild(createShelfBookElement_(item.book, popupIndex, shelfPopupData, shelfRevealIndex));
          shelfRevealIndex += 1;
        });

        levelWrap.appendChild(strip);
        sectionWrap.appendChild(levelWrap);
      });

      groupSection.appendChild(sectionWrap);
    });

    container.appendChild(groupSection);
  });

  warmBookDetailPrefetch_(shelfPopupData, {
    limit: BOOK_DETAIL_PREFETCH_WARM_LIMIT,
    timeout: 1200,
    delay: 520
  });

  return container;
}

function showResult(data) {
  hideSpinner();

  const result = document.getElementById('result');
  result.innerHTML = '';

  if (!data || !Array.isArray(data) || data.length === 0) {
    renderEmptyResult_(result);
    resetImageLoadStats_([]);
    disconnectShelfScrollSpy_();
    unmountShelfRoomMapPortal_();
    return;
  }

  updateViewToggleButtons_();

  const viewMode = getCurrentViewMode_();
  syncShelfViewUiState_(viewMode);

  // 本棚ビューは小型表紙を大量に並べるため、画像取得率デバッグ集計には含めない。
  // カード/リストの既存集計だけを維持する。
  resetImageLoadStats_(viewMode === 'shelf' ? [] : data);

  if (viewMode === 'shelf') {
    const shelfView = renderShelfView_(data);
    result.appendChild(shelfView);
    window.requestAnimationFrame(function() {
      bindShelfScrollSpy_(shelfView);
    });
    if (isShelfImmersiveMode) {
      mountShelfRoomMapPortal_(currentShelfRoomMapGroups);
    } else {
      unmountShelfRoomMapPortal_();
    }
  } else if (viewMode === 'card') {
    unmountShelfRoomMapPortal_();
    const container = document.createElement('div');
    container.className = 'card-view';

    data.forEach((book, idx) => {
      const card = document.createElement('div');
      card.className = 'book-card';
      setBookRevealIndex_(card, idx);
      setupBookOpenSurface_(card, book, idx, data);

      const img = document.createElement('img');
      img.className = 'book-cover';
      img.alt = book.title || '表紙';
      img.style.cursor = 'zoom-in';
      img.onclick = function(e) {
        e.stopPropagation();
        showPopup(book, idx, data);
      };

      setupBookImageElement_(img, book, {
        track: true,
        trackKey: getBookImageTrackKey_(book, idx),
        loading: idx < 4 ? 'eager' : 'lazy',
        fetchPriority: idx < 4 ? 'high' : 'low'
      });

      card.appendChild(img);

      const info = document.createElement('div');
      info.className = 'card-info';
      info.innerHTML = `
        <div class="book-title">${escapeHtml(book.title || '(タイトルなし)')}</div>
        ${buildBookAuthorLineHtml_(book)}
        <div class="genre-chip-wrap">${buildGenreChips(book)}</div>
        ${buildBookMetaPillsHtml_(book, { includeIsbn: true })}
        ${buildBookMemoHtml_(book)}
      `;

      appendSummaryAccordion_(info.querySelector('.genre-chip-wrap'), book);
      setupBookKeyboardOpenSurface_(info.querySelector('.book-title'), book, idx, data);

      card.appendChild(info);
      container.appendChild(card);
    });

    result.appendChild(container);
  } else {
    unmountShelfRoomMapPortal_();
    const container = document.createElement('div');
    container.className = 'list-view';

    data.forEach((book, idx) => {
      const card = document.createElement('div');
      card.className = 'book-card list';
      setBookRevealIndex_(card, idx);

      const thumb = document.createElement('img');
      thumb.alt = '表紙';
      thumb.className = 'list-thumb';
      thumb.style.cursor = 'zoom-in';
      thumb.onclick = function(e) {
        e.stopPropagation();
        showPopup(book, idx, data);
      };

      setupBookImageElement_(thumb, book, {
        track: true,
        trackKey: getBookImageTrackKey_(book, idx),
        loading: idx < 8 ? 'eager' : 'lazy',
        fetchPriority: idx < 8 ? 'high' : 'low'
      });

      const row = document.createElement('div');
      row.className = 'list-row';
      setupBookOpenSurface_(row, book, idx, data);

      const titleRow = document.createElement('div');
      titleRow.className = 'list-title-row';

      const titleBlock = document.createElement('div');
      titleBlock.className = 'list-title-block';
      titleBlock.innerHTML = `
        <div class="book-title">${escapeHtml(book.title || '(タイトルなし)')}</div>
        ${buildListBookMetaHtml_(book)}
        <div class="genre-chip-wrap compact">${buildGenreChips(book)}</div>
        ${buildBookMetaPillsHtml_(book, { compact: true })}
      `;

      appendSummaryAccordion_(titleBlock.querySelector('.genre-chip-wrap'), book);
      setupBookKeyboardOpenSurface_(titleBlock.querySelector('.book-title'), book, idx, data);

      titleRow.appendChild(titleBlock);
      if (hasDisplayValue_(book && book.author)) {
        const authorDiv = document.createElement('div');
        authorDiv.className = 'list-title-author';
        authorDiv.textContent = String(book.author).trim();
        titleRow.appendChild(authorDiv);
      }

      row.appendChild(thumb);
      row.appendChild(titleRow);

      const btn = document.createElement('button');
      btn.className = 'accordion-toggle';
      btn.setAttribute('aria-expanded', 'false');
      btn.innerHTML = uiIcon_('chevronDown', 'arrow');
      row.appendChild(btn);

      card.appendChild(row);

      const details = document.createElement('div');
      details.className = 'book-details';
      details.style.display = 'none';
      details.innerHTML = `
        ${buildBookDetailsHtml_(book)}
      `;

      card.appendChild(details);

      btn.onclick = function(e) {
        e.stopPropagation();

        const expanded = card.classList.toggle('open');
        btn.setAttribute('aria-expanded', expanded ? 'true' : 'false');
        details.style.display = expanded ? 'block' : 'none';
      };

      container.appendChild(card);
    });

    result.appendChild(container);
  }

  result.classList.remove('show');
  result.classList.add('result-fade');

  setTimeout(() => {
    result.classList.add('show');
  }, 40);
}