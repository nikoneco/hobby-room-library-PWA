function escapeHtml(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function hasDisplayValue_(value) {
  const text = String(value == null ? '' : value).trim();
  return Boolean(text && text !== '-');
}

function formatShelfLabel_(book) {
  const shelf = hasDisplayValue_(book && book.shelf) ? String(book.shelf).trim() : '';
  const location = hasDisplayValue_(book && book.location) ? String(book.location).trim() : '';
  if (shelf && location) return `${shelf}-${location}`;
  return shelf || location || '';
}

function buildBookAuthorLineHtml_(book) {
  const author = hasDisplayValue_(book && book.author) ? String(book.author).trim() : '';
  const publisher = hasDisplayValue_(book && book.publisher) ? String(book.publisher).trim() : '';
  if (!author && !publisher) return '';

  return `
    <div class="book-author-line">
      ${author ? `<span class="book-author-name">${escapeHtml(author)}</span>` : ''}
      ${publisher ? `<span class="book-publisher-name">${escapeHtml(publisher)}</span>` : ''}
    </div>
  `;
}

function buildListBookMetaHtml_(book) {
  const publisher = hasDisplayValue_(book && book.publisher) ? String(book.publisher).trim() : '';
  const shelfLabel = formatShelfLabel_(book);
  const parts = [];
  if (publisher) parts.push(publisher);
  parts.push(shelfLabel || '棚未定');
  return `<div class="list-book-meta">${parts.map(part => escapeHtml(part)).join(' / ')}</div>`;
}

function buildBookMetaPillsHtml_(book, options) {
  const opt = options || {};
  const items = [];
  const shelfLabel = formatShelfLabel_(book);

  if (shelfLabel) items.push({ label: '棚', value: shelfLabel });
  if (hasDisplayValue_(book && book.released)) items.push({ label: '発売', value: book.released });
  if (hasDisplayValue_(book && book.price)) items.push({ label: '値', value: book.price });
  if (hasDisplayValue_(book && book.brand)) items.push({ label: 'レーベル', value: book.brand });
  if (opt.includeIsbn && hasDisplayValue_(book && book.isbn)) items.push({ label: 'ISBN', value: book.isbn });

  if (!items.length) return '';

  return `
    <div class="book-meta-pills${opt.compact ? ' compact' : ''}">
      ${items.map(item => `
        <span class="book-meta-pill">
          <span class="book-meta-pill-label">${escapeHtml(item.label)}</span>
          <span class="book-meta-pill-value">${escapeHtml(item.value)}</span>
        </span>
      `).join('')}
    </div>
  `;
}

function buildBookMemoHtml_(book) {
  if (!hasDisplayValue_(book && book.memo)) return '';
  return `<div class="book-note">備考: ${escapeHtml(book.memo)}</div>`;
}

function buildPopupBookLeadHtml_(book) {
  const parts = [];
  if (hasDisplayValue_(book && book.author)) parts.push(escapeHtml(book.author));
  if (hasDisplayValue_(book && book.publisher)) parts.push(escapeHtml(book.publisher));
  if (!parts.length) return '';

  return `<div class="popup-book-lead">${parts.join('<span></span>')}</div>`;
}

function buildPopupBookContextHtml_(book) {
  const parts = [];
  const shelfLabel = formatShelfLabel_(book);
  const seriesCount = Number(book && book.seriesCount || 0);
  const ownedMaxVolume = Number(book && book.ownedMaxVolume || 0);

  if (shelfLabel) parts.push(`棚 ${shelfLabel}`);
  if (seriesCount >= 2) parts.push(`${seriesCount}冊のシリーズ`);
  if (ownedMaxVolume > 0) parts.push(`所持 ${ownedMaxVolume}巻まで`);
  if (!parts.length) return '';

  return `
    <div class="popup-book-kicker">
      ${parts.map(part => `<span>${escapeHtml(part)}</span>`).join('')}
    </div>
  `;
}

function buildBookDetailsHtml_(book) {
  const rows = [
    ['著者', book && book.author],
    ['出版社', book && book.publisher],
    ['ISBN', book && book.isbn],
    ['棚', formatShelfLabel_(book)],
    ['発売日', book && book.released],
    ['価格', book && book.price],
    ['レーベル', book && book.brand],
    ['備考', book && book.memo]
  ].filter(([, value]) => hasDisplayValue_(value));

  if (!rows.length) {
    return '<div class="book-details-empty">詳細情報はまだ入っていません</div>';
  }

  return rows.map(([label, value]) => `
    <div><span>${escapeHtml(label)}</span>${escapeHtml(value)}</div>
  `).join('');
}

function renderEmptyResult_(result) {
  if (!result) return;

  const empty = document.createElement('div');
  empty.className = 'empty-result';

  const title = document.createElement('div');
  title.className = 'empty-result-title';
  title.textContent = '該当する本が見つかりませんでした';

  const text = document.createElement('div');
  text.className = 'empty-result-text';
  text.textContent = 'キーワードを短くするか、条件チップを外してもう一度探してみてください。';

  const actions = document.createElement('div');
  actions.className = 'empty-result-actions';

  const focusButton = document.createElement('button');
  focusButton.type = 'button';
  focusButton.className = 'quiet-action empty-result-action';
  focusButton.innerHTML = `${uiIcon_('search', 'ui-icon-inline')}<span>検索語を見直す</span>`;
  focusButton.onclick = function() {
    const keyword = document.getElementById('keyword');
    if (keyword && typeof keyword.focus === 'function') {
      keyword.focus();
      keyword.select();
    }
  };

  const clearButton = document.createElement('button');
  clearButton.type = 'button';
  clearButton.className = 'quiet-action empty-result-action';
  clearButton.innerHTML = `${uiIcon_('trash', 'ui-icon-inline')}<span>条件をクリア</span>`;
  clearButton.onclick = function() {
    resetSearch();
  };

  const randomButton = document.createElement('button');
  randomButton.type = 'button';
  randomButton.className = 'quiet-action empty-result-action empty-result-random';
  randomButton.innerHTML = `${uiIcon_('shuffle', 'ui-icon-inline')}<span>ランダムで眺める</span>`;
  randomButton.onclick = function() {
    showRandomBooks();
  };

  actions.appendChild(focusButton);
  actions.appendChild(clearButton);
  actions.appendChild(randomButton);

  empty.appendChild(title);
  empty.appendChild(text);
  empty.appendChild(actions);
  result.appendChild(empty);
}

function buildGenreChips(book) {
  const meta = Array.isArray(book.genreMeta) ? book.genreMeta : [];
  if (!meta.length) return '';

  return meta.map(item => {
    const cls = item.category === 'status' ? 'genre-chip status' : 'genre-chip';
    const field = getGenreSearchField_(item.category);
    const label = getGenreCategoryLabel_(item.category);
    if (!field || !hasDisplayValue_(item.name)) return '';

    return `
      <button
        type="button"
        class="${cls}"
        data-genre-field="${escapeHtml(field)}"
        data-genre-value="${escapeHtml(item.name)}"
        aria-label="${escapeHtml(label + ': ' + item.name + 'で探す')}"
      >${escapeHtml(item.name)}</button>
    `;
  }).join('');
}

function appendSummaryAccordion_(chipWrap, book) {
  if (!chipWrap || !book || !book.summary) return;

  const summaryBtn = document.createElement('button');
  summaryBtn.type = 'button';
  summaryBtn.className = 'summary-chip-toggle';
  summaryBtn.textContent = 'あらすじを見る';
  summaryBtn.setAttribute('aria-expanded', 'false');

  const summaryText = document.createElement('div');
  summaryText.className = 'summary-text';
  summaryText.textContent = book.summary || '';
  summaryText.style.display = 'none';

  summaryBtn.onclick = function(e) {
    e.stopPropagation();
    const visible = summaryText.style.display === 'block';
    summaryText.style.display = visible ? 'none' : 'block';
    summaryBtn.textContent = visible ? 'あらすじを見る' : 'あらすじを閉じる';
    summaryBtn.setAttribute('aria-expanded', visible ? 'false' : 'true');
  };

  chipWrap.appendChild(summaryBtn);
  chipWrap.insertAdjacentElement('afterend', summaryText);
}

function appendPopupSummaryAccordion_(chipWrap, book) {
  if (!chipWrap || !book || !book.summary) return;

  const summaryBtn = document.createElement('button');
  summaryBtn.type = 'button';
  summaryBtn.className = 'summary-chip-toggle popup-summary-toggle';
  summaryBtn.textContent = 'あらすじを見る';
  summaryBtn.setAttribute('aria-expanded', 'false');

  const summaryText = document.createElement('div');
  summaryText.className = 'summary-text popup-summary-text';
  summaryText.textContent = book.summary || '';
  summaryText.style.display = 'none';

  summaryBtn.onclick = function(e) {
    e.stopPropagation();
    const visible = summaryText.style.display === 'block';
    summaryText.style.display = visible ? 'none' : 'block';
    summaryBtn.textContent = visible ? 'あらすじを見る' : 'あらすじを閉じる';
    summaryBtn.setAttribute('aria-expanded', visible ? 'false' : 'true');
  };

  chipWrap.appendChild(summaryBtn);
  chipWrap.insertAdjacentElement('afterend', summaryText);
}

function isPopupSummaryScrollTarget_(target) {
  return !!(
    target &&
    typeof target.closest === 'function' &&
    target.closest('.popup-summary-text')
  );
}


function getCurrentViewMode_() {
  if (RESULT_VIEW_MODES.includes(currentViewMode)) {
    return currentViewMode;
  }
  return isCardView ? 'card' : 'list';
}

function applyResultViewMode_(mode) {
  const nextMode = normalizeResultViewMode_(mode);
  currentViewMode = nextMode;
  isCardView = nextMode === 'card';
  isShelfImmersiveMode = false;
  currentShelfRoomMapGroups = [];
  closeShelfRoomMapOverlay_();
  updateViewToggleButtons_();
  syncShelfViewUiState_(nextMode);
}

function resetViewModeToCardForNewSearch_() {
  applyResultViewMode_('card');
}

function resetViewModeForNewResults_() {
  const preferredMode = loadPreferredResultViewMode_();
  const currentMode = getCurrentViewMode_();
  const nextMode = currentMode === 'shelf' || preferredMode === 'shelf'
    ? 'card'
    : preferredMode;
  applyResultViewMode_(nextMode);
}

function setViewMode_(mode) {
  const nextMode = savePreferredResultViewMode_(mode);
  applyResultViewMode_(nextMode);

  if (lastResult) {
    showResult(lastResult);
  }
}

function updateViewToggleButtons_() {
  const mode = getCurrentViewMode_();
  const buttonMap = {
    card: document.getElementById('tileViewBtn'),
    list: document.getElementById('listViewBtn'),
    shelf: document.getElementById('shelfViewBtn')
  };

  Object.keys(buttonMap).forEach(key => {
    const btn = buttonMap[key];
    if (!btn) return;
    const active = key === mode;
    btn.classList.toggle('active', active);
    btn.setAttribute('aria-pressed', active ? 'true' : 'false');
    btn.setAttribute('data-state', active ? 'active' : 'idle');
  });
}

function syncShelfViewUiState_(mode) {
  const isShelf = mode === 'shelf';
  const isImmersive = isShelf && Boolean(isShelfImmersiveMode);
  const body = document.body;
  const searchContainer = document.getElementById('searchContainer');
  const viewToggle = document.getElementById('viewToggle');

  if (body) {
    body.classList.toggle('shelf-view-active', isShelf);
    body.classList.toggle('shelf-immersive-active', isImmersive);
  }
  if (searchContainer) {
    searchContainer.classList.toggle('shelf-view-active', isShelf && !isImmersive);
    searchContainer.classList.toggle('shelf-immersive-active', isImmersive);
  }
  if (viewToggle) {
    viewToggle.classList.toggle('shelf-view-active', isShelf && !isImmersive);
    viewToggle.classList.toggle('shelf-immersive-active', isImmersive);
  }

  if (!isImmersive) {
    unmountShelfRoomMapPortal_();
  }

  if (!isShelf) {
    disconnectShelfScrollSpy_();
  }
}