function shouldIgnoreBookOpenSurfaceClick_(target) {
  return !!(
    target &&
    typeof target.closest === 'function' &&
    target.closest('button, a, input, select, textarea, label, .summary-text, .genre-chip')
  );
}

function setupBookOpenSurface_(element, book, idx, data) {
  if (!element) return;
  element.classList.add('book-open-surface');
  element.onclick = function(e) {
    if (shouldIgnoreBookOpenSurfaceClick_(e.target)) return;
    showPopup(book, idx, data);
  };
}

function setupBookKeyboardOpenSurface_(element, book, idx, data) {
  if (!element) return;
  element.classList.add('book-open-keyboard-surface');
  element.tabIndex = 0;
  element.setAttribute('role', 'button');
  element.setAttribute('aria-label', `${book && book.title ? book.title : 'この本'} の詳細を開く`);
  element.onkeydown = function(e) {
    if (shouldIgnoreBookOpenSurfaceClick_(e.target)) return;
    if (e.key !== 'Enter' && e.key !== ' ') return;

    e.preventDefault();
    showPopup(book, idx, data);
  };
}


function shouldShowSeriesButton(book) {
  return !!(
    book &&
    book.seriesKeyAuto &&
    Number(book.seriesCount || 0) >= 2
  );
}

function buildExternalLinksHtml(book) {
  if (!book || !book.links) return '';

  const googleUrl = escapeHtml(book.links.googleUrl || '');
  const bellUrl = escapeHtml(book.links.bellUrl || '');
  const amazonUrl = escapeHtml(book.links.amazonUrl || '');

  return `
    <div class="popup-link-row">
      <a href="${googleUrl}" target="_blank" rel="noopener noreferrer" class="popup-link-btn">${uiIcon_('search', 'ui-icon-inline')}<span>Googleで新刊検索</span></a>
      <a href="${bellUrl}" target="_blank" rel="noopener noreferrer" class="popup-link-btn">${uiIcon_('bell', 'ui-icon-inline')}<span>BellAlert</span></a>
      <a href="${amazonUrl}" target="_blank" rel="noopener noreferrer" class="popup-link-btn">${uiIcon_('store', 'ui-icon-inline')}<span>Amazon</span></a>
    </div>
  `;
}

function buildPopupActionsHtml(book, seriesContext) {
  const parts = [];

  if (seriesContext && Array.isArray(seriesContext.items)) {
    parts.push(`
      <button type="button" id="popup-series-back-btn" class="popup-action-btn">
        ${uiIcon_('back', 'ui-icon-inline')}<span>シリーズ一覧へ戻る</span>
      </button>
    `);
  }

  if (shouldShowSeriesButton(book)) {
    parts.push(`
      <button type="button" id="popup-series-btn" class="popup-action-btn primary">
        ${uiIcon_('collection', 'ui-icon-inline')}<span>このシリーズを見る（${Number(book.seriesCount || 0)}冊）</span>
      </button>
    `);
  }

  const linksHtml = buildExternalLinksHtml(book);
  if (linksHtml) parts.push(linksHtml);

  if (!parts.length) return '';

  return `
    <div class="popup-action-area">
      ${parts.join('')}
    </div>
  `;
}

function attachPopupActionHandlers(book, seriesContext) {
  const seriesBtn = document.getElementById('popup-series-btn');
  if (seriesBtn) {
    seriesBtn.onclick = function(e) {
      e.stopPropagation();
      openSeriesPanel(book);
    };
  }

  const backBtn = document.getElementById('popup-series-back-btn');
  if (backBtn && seriesContext && Array.isArray(seriesContext.items)) {
    backBtn.onclick = function(e) {
      e.stopPropagation();
      showSeriesPanel(seriesContext.sourceBook || book, seriesContext.items, seriesContext.returnContext || null);
    };
  }
}

function getPopupNavBookLabel_(targetIndex) {
  if (!Array.isArray(popupData) || targetIndex < 0 || targetIndex >= popupData.length) return '';
  const targetBook = popupData[targetIndex];
  return targetBook && targetBook.title ? String(targetBook.title) : '';
}

function setupPopupNavButton_(button, targetIndex, directionLabel) {
  if (!button) return;

  const targetTitle = getPopupNavBookLabel_(targetIndex);
  const accessibleLabel = targetTitle ? `${directionLabel}: ${targetTitle}` : directionLabel;
  button.setAttribute('aria-label', accessibleLabel);
  button.removeAttribute('title');

  if (targetTitle) {
    button.classList.add('has-nav-label');
    button.setAttribute('data-nav-label', targetTitle);
  } else {
    button.classList.remove('has-nav-label');
    button.removeAttribute('data-nav-label');
  }
}

function clearPopupTouchHandlers_() {
  const overlay = document.getElementById('image-popup-overlay');
  const popupContent = document.getElementById('image-popup-content');
  if (overlay) {
    overlay.ontouchstart = null;
    overlay.ontouchmove = null;
    overlay.ontouchend = null;
    overlay.onpointerdown = null;
    overlay.onpointermove = null;
    overlay.onpointerup = null;
    overlay.onpointercancel = null;
    overlay.onmousedown = null;
    overlay.onmousemove = null;
    overlay.onmouseup = null;
    overlay.onmouseleave = null;
  }
  if (popupContent) {
    popupContent.style.removeProperty('--popup-drag-y');
    popupContent.style.removeProperty('--popup-drag-opacity');
  }
}

function closeCoverFullscreen_() {
  const overlay = document.getElementById('cover-fullscreen-overlay');
  const img = document.getElementById('cover-fullscreen-img');
  const caption = document.getElementById('cover-fullscreen-caption');
  if (!overlay || overlay.style.display === 'none') return;

  overlay.style.display = 'none';
  overlay.setAttribute('aria-hidden', 'true');
  overlay.onclick = null;
  overlay.ontouchstart = null;
  overlay.ontouchmove = null;
  overlay.ontouchend = null;
  overlay.onpointerdown = null;
  overlay.onpointermove = null;
  overlay.onpointerup = null;
  overlay.onpointercancel = null;
  overlay.onmousedown = null;
  overlay.onmousemove = null;
  overlay.onmouseup = null;
  overlay.onmouseleave = null;
  overlay.style.removeProperty('--cover-drag-y');
  overlay.style.removeProperty('--cover-drag-opacity');
  document.body.classList.remove('cover-fullscreen-open');
  if (img) {
    img.removeAttribute('src');
    img.removeAttribute('role');
    img.removeAttribute('tabindex');
    img.removeAttribute('aria-label');
    img.removeAttribute('draggable');
    img.onclick = null;
    img.onkeydown = null;
    img.classList.remove('book-image-loading', 'book-image-loaded');
  }
  if (caption) caption.textContent = '';
  document.onkeydown = coverFullscreenPreviousKeydown || null;
  coverFullscreenPreviousKeydown = null;
}

function openCoverFullscreen_(book) {
  const overlay = document.getElementById('cover-fullscreen-overlay');
  const img = document.getElementById('cover-fullscreen-img');
  const caption = document.getElementById('cover-fullscreen-caption');
  const closeBtn = document.getElementById('cover-fullscreen-close');
  if (!overlay || !img || !closeBtn || !book) return;

  img.alt = `${book.title || '表紙'} の拡大画像`;
  img.setAttribute('role', 'button');
  img.setAttribute('tabindex', '0');
  img.setAttribute('aria-label', '拡大表示を閉じる');
  img.setAttribute('draggable', 'false');
  setupBookImageElement_(img, book, {
    track: false,
    loading: 'eager',
    fetchPriority: 'high'
  });
  if (caption) caption.textContent = book.title || '';

  overlay.style.display = 'flex';
  overlay.setAttribute('aria-hidden', 'false');
  document.body.classList.add('cover-fullscreen-open');

  coverFullscreenPreviousKeydown = document.onkeydown;
  document.onkeydown = function(e) {
    if (e.key === 'Escape') {
      closeCoverFullscreen_();
    }
  };

  overlay.onclick = function(e) {
    if (e.target === overlay) closeCoverFullscreen_();
  };

  let coverPointerStartX = 0;
  let coverPointerStartY = 0;
  let coverPointerDragging = false;
  let coverPointerSource = '';

  function startCoverDrag_(source, x, y) {
    if (coverPointerDragging && coverPointerSource !== source) return false;

    coverPointerStartX = x;
    coverPointerStartY = y;
    coverPointerDragging = true;
    coverPointerSource = source;
    return true;
  }

  function updateCoverDrag_(x, y) {
    const diffY = Math.max(0, y - coverPointerStartY);
    if (diffY < 6) return false;

    const dragY = Math.min(diffY, 150);
    const opacity = Math.max(0.48, 1 - dragY / 260);
    overlay.style.setProperty('--cover-drag-y', `${dragY}px`);
    overlay.style.setProperty('--cover-drag-opacity', String(opacity));
    return true;
  }

  function resetCoverDrag_() {
    coverPointerDragging = false;
    coverPointerSource = '';
    overlay.style.removeProperty('--cover-drag-y');
    overlay.style.removeProperty('--cover-drag-opacity');
  }

  function endCoverDrag_(x, y) {
    const diffX = x - coverPointerStartX;
    const diffY = y - coverPointerStartY;
    resetCoverDrag_();

    if (diffY > 76 && Math.abs(diffY) > Math.abs(diffX) * 1.15) {
      closeCoverFullscreen_();
    }
  }

  overlay.onpointerdown = function(e) {
    if (!e.isPrimary) return;
    if (!startCoverDrag_('pointer', e.clientX, e.clientY)) return;
    if (typeof overlay.setPointerCapture === 'function') {
      overlay.setPointerCapture(e.pointerId);
    }
  };
  overlay.onpointermove = function(e) {
    if (!coverPointerDragging || coverPointerSource !== 'pointer' || !e.isPrimary) return;
    if (updateCoverDrag_(e.clientX, e.clientY)) e.preventDefault();
  };
  overlay.onpointerup = function(e) {
    if (!coverPointerDragging || coverPointerSource !== 'pointer' || !e.isPrimary) return;
    endCoverDrag_(e.clientX, e.clientY);
  };
  overlay.onpointercancel = function() {
    if (coverPointerSource === 'pointer') resetCoverDrag_();
  };
  overlay.onmousedown = function(e) {
    if (e.button !== 0) return;
    startCoverDrag_('mouse', e.clientX, e.clientY);
  };
  overlay.onmousemove = function(e) {
    if (!coverPointerDragging || coverPointerSource !== 'mouse') return;
    if (updateCoverDrag_(e.clientX, e.clientY)) e.preventDefault();
  };
  overlay.onmouseup = function(e) {
    if (!coverPointerDragging || coverPointerSource !== 'mouse') return;
    endCoverDrag_(e.clientX, e.clientY);
  };
  overlay.onmouseleave = function() {
    if (coverPointerSource === 'mouse') resetCoverDrag_();
  };

  img.onclick = function(e) {
    e.stopPropagation();
    closeCoverFullscreen_();
  };
  img.onkeydown = function(e) {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      closeCoverFullscreen_();
    }
  };
  closeBtn.onclick = function(e) {
    e.stopPropagation();
    closeCoverFullscreen_();
  };
}

function openSeriesPanel(sourceBook) {
  if (!sourceBook || !sourceBook.seriesKeyAuto) return;

  const overlay = document.getElementById('image-popup-overlay');
  const popupContent = document.getElementById('image-popup-content');
  const img = document.getElementById('image-popup-img');
  const info = document.getElementById('image-popup-info');
  const prevBtn = document.getElementById('popup-prev');
  const nextBtn = document.getElementById('popup-next');
  const returnContext = { index: popupIndex, data: popupData };

  overlay.style.display = 'flex';
  document.body.classList.add('modal-open');
  if (popupContent) popupContent.classList.add('series-mode');
  img.style.display = 'none';
  prevBtn.style.display = 'none';
  nextBtn.style.display = 'none';
  clearPopupTouchHandlers_();

  info.innerHTML = `
    <div class="series-panel">
      <div class="series-panel-title">シリーズ一覧を読み込み中...</div>
      <div class="series-panel-subtitle">${escapeHtml(sourceBook.seriesSearchTitle || sourceBook.title || '')}</div>
    </div>
  `;

  google.script.run
    .withSuccessHandler(function(seriesBooks) {
      showSeriesPanel(sourceBook, Array.isArray(seriesBooks) ? seriesBooks : [], returnContext);
    })
    .withFailureHandler(function(error) {
      info.innerHTML = `
          <div class="series-panel">
            <div class="series-panel-title">シリーズ一覧を取得できませんでした</div>
            <div class="series-panel-subtitle">${escapeHtml(error && error.message ? error.message : '時間を置いて再度お試しください。')}</div>
          <button type="button" id="series-panel-back-detail" class="popup-action-btn primary">${uiIcon_('back', 'ui-icon-inline')}<span>詳細へ戻る</span></button>
        </div>
      `;
      const backBtn = document.getElementById('series-panel-back-detail');
      if (backBtn) backBtn.onclick = function(e) {
        e.stopPropagation();
        showPopup(sourceBook, returnContext.index, returnContext.data);
      };
    })
    .getBooksBySeriesKey(sourceBook.seriesKeyAuto);
}

function showSeriesPanel(sourceBook, seriesBooks, returnContext) {
  const overlay = document.getElementById('image-popup-overlay');
  const popupContent = document.getElementById('image-popup-content');
  const img = document.getElementById('image-popup-img');
  const info = document.getElementById('image-popup-info');
  const closeBtn = document.getElementById('image-popup-close');
  const prevBtn = document.getElementById('popup-prev');
  const nextBtn = document.getElementById('popup-next');

  const items = Array.isArray(seriesBooks) ? seriesBooks : [];
  const sourceTitle = sourceBook && (sourceBook.seriesSearchTitle || sourceBook.title) || 'シリーズ';
  const linksHtml = buildExternalLinksHtml(sourceBook);

  img.style.display = 'none';
  if (popupContent) popupContent.classList.add('series-mode');
  prevBtn.style.display = 'none';
  nextBtn.style.display = 'none';
  clearPopupTouchHandlers_();

  const listHtml = items.length
    ? items.map((item, idx) => `
        <button type="button" class="series-list-item" data-series-index="${idx}">
          <span class="series-list-title">${escapeHtml(item.title || '(タイトルなし)')}</span>
          <span class="series-list-meta">
            発: ${escapeHtml(item.released || '-')} ／ 棚: ${escapeHtml(item.shelf || '-')}-${escapeHtml(item.location || '')}
          </span>
        </button>
      `).join('')
    : '<div class="series-empty">同じシリーズの本が見つかりませんでした。</div>';

  info.innerHTML = `
    <div class="series-panel">
      <div class="series-panel-title">${escapeHtml(sourceTitle)} シリーズ一覧（${items.length}冊）</div>
      ${linksHtml ? `<div class="series-panel-actions">${linksHtml}</div>` : ''}
      <div class="series-list">${listHtml}</div>
      <button type="button" id="series-panel-back-detail" class="popup-action-btn">${uiIcon_('back', 'ui-icon-inline')}<span>詳細へ戻る</span></button>
    </div>
  `;

  const backBtn = document.getElementById('series-panel-back-detail');
  if (backBtn) {
    backBtn.onclick = function(e) {
      e.stopPropagation();
      const targetIndex = returnContext && typeof returnContext.index === 'number' ? returnContext.index : popupIndex;
      const targetData = returnContext && Array.isArray(returnContext.data) ? returnContext.data : popupData;
      showPopup(sourceBook, targetIndex, targetData);
    };
  }

  info.querySelectorAll('.series-list-item').forEach(btn => {
    btn.onclick = function(e) {
      e.stopPropagation();
      const idx = Number(btn.getAttribute('data-series-index'));
      const book = items[idx];
      if (!book) return;
      showPopup(book, idx, items, { sourceBook, items, returnContext });
    };
  });

  overlay.onclick = function(e) {
    if (e.target === overlay) {
      overlay.style.display = 'none';
      document.body.classList.remove('modal-open');
      document.onkeydown = null;
    }
  };

  closeBtn.onclick = function() {
    overlay.style.display = 'none';
    document.body.classList.remove('modal-open');
    document.onkeydown = null;
  };

  document.onkeydown = function(e) {
    if (e.key === 'Escape') {
      overlay.style.display = 'none';
      document.body.classList.remove('modal-open');
      document.onkeydown = null;
    }
  };
}

function showPopup(book, index, dataArr, seriesContext) {
  popupIndex = index;
  popupData = dataArr;
  popupSeriesContext = seriesContext || null;

  const overlay = document.getElementById('image-popup-overlay');
  const popupContent = document.getElementById('image-popup-content');
  const img = document.getElementById('image-popup-img');
  const info = document.getElementById('image-popup-info');
  const closeBtn = document.getElementById('image-popup-close');
  const prevBtn = document.getElementById('popup-prev');
  const nextBtn = document.getElementById('popup-next');

  img.style.display = '';
  if (popupContent) popupContent.classList.remove('series-mode');
  img.alt = book.title || '表紙';
  img.setAttribute('role', 'button');
  img.setAttribute('tabindex', '0');
  img.setAttribute('aria-label', '表紙を全画面で表示');
  setupBookImageElement_(img, book, {
    track: false,
    loading: 'eager',
    fetchPriority: 'high'
  });
  img.onclick = function(e) {
    e.stopPropagation();
    if (popupDragSuppressNextClick) {
      e.preventDefault();
      popupDragSuppressNextClick = false;
      return;
    }
    openCoverFullscreen_(book);
  };
  img.onkeydown = function(e) {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      openCoverFullscreen_(book);
    }
  };

  const actionsHtml = buildPopupActionsHtml(book, popupSeriesContext);
  info.innerHTML = `
    <div class="popup-book-detail">
      <div class="popup-book-head">
        ${buildPopupBookContextHtml_(book)}
        <div class="popup-book-title">${escapeHtml(book.title || '(タイトルなし)')}</div>
        ${buildPopupBookLeadHtml_(book)}
      </div>
      <div class="genre-chip-wrap popup">${buildGenreChips(book)}</div>
      <div class="popup-book-primary-meta">
        ${buildBookMetaPillsHtml_(book, { includeIsbn: true })}
        ${buildBookMemoHtml_(book)}
      </div>
      ${actionsHtml}
      <div class="popup-position">${popupIndex + 1} / ${popupData.length}</div>
    </div>
  `;

  appendPopupSummaryAccordion_(info.querySelector('.genre-chip-wrap.popup'), book);
  attachPopupActionHandlers(book, popupSeriesContext);

  overlay.style.display = 'flex';
  document.body.classList.add('modal-open');

  popupContent.classList.remove('popup-slide-next', 'popup-slide-prev');

  function hide() {
    closeCoverFullscreen_();
    clearPopupTouchHandlers_();
    overlay.style.display = 'none';
    document.body.classList.remove('modal-open');
    document.onkeydown = null;
  }

  overlay.onclick = function(e) {
    if (e.target === overlay) hide();
  };
  closeBtn.onclick = hide;

  document.onkeydown = function(e) {
    if (e.key === 'Escape') hide();
    if (e.key === 'ArrowLeft') popupMove(-1);
    if (e.key === 'ArrowRight') popupMove(1);
  };

  prevBtn.style.display = (popupIndex > 0) ? 'block' : 'none';
  nextBtn.style.display = (popupIndex < popupData.length - 1) ? 'block' : 'none';
  setupPopupNavButton_(prevBtn, popupIndex - 1, '前へ');
  setupPopupNavButton_(nextBtn, popupIndex + 1, '次へ');
  prevBtn.onclick = function(e) { e.stopPropagation(); popupMove(-1); };
  nextBtn.onclick = function(e) { e.stopPropagation(); popupMove(1); };

  let popupDragStartX = 0;
  let popupDragStartY = 0;
  let popupDragging = false;
  let popupDragSource = '';
  let popupDragScrollTarget = false;

  function startPopupDrag_(source, x, y, target) {
    if (popupDragging && popupDragSource !== source) return false;

    popupDragStartX = x;
    popupDragStartY = y;
    popupDragging = true;
    popupDragSource = source;
    popupDragScrollTarget = isPopupSummaryScrollTarget_(target);
    return true;
  }

  function updatePopupDrag_(x, y) {
    if (popupDragScrollTarget) return false;

    const diffY = Math.max(0, y - popupDragStartY);
    if (diffY < 8) return false;

    const dragY = Math.min(diffY, 130);
    const opacity = Math.max(0.56, 1 - dragY / 260);
    popupContent.style.setProperty('--popup-drag-y', `${dragY}px`);
    popupContent.style.setProperty('--popup-drag-opacity', String(opacity));
    return true;
  }

  function resetPopupDrag_() {
    popupDragging = false;
    popupDragSource = '';
    popupDragScrollTarget = false;
    popupContent.style.removeProperty('--popup-drag-y');
    popupContent.style.removeProperty('--popup-drag-opacity');
  }

  function endPopupDrag_(x, y) {
    const diffX = x - popupDragStartX;
    const diffY = y - popupDragStartY;
    const shouldClose = !popupDragScrollTarget && diffY > 92 && Math.abs(diffY) > Math.abs(diffX) * 1.12;
    const shouldMove = !popupDragScrollTarget && Math.abs(diffX) > 48 && Math.abs(diffX) > Math.abs(diffY);

    resetPopupDrag_();

    if (shouldClose) {
      popupDragSuppressNextClick = true;
      hide();
      window.setTimeout(function() {
        popupDragSuppressNextClick = false;
      }, 260);
    } else if (shouldMove) {
      popupMove(diffX > 0 ? -1 : 1);
    }
  }

  overlay.ontouchstart = function(e) {
    if (e.touches.length === 1) {
      startPopupDrag_('touch', e.touches[0].clientX, e.touches[0].clientY, e.target);
    }
  };
  overlay.ontouchmove = function(e) {
    if (!popupDragging || popupDragSource !== 'touch' || !e.touches || e.touches.length !== 1) return;
    if (popupDragScrollTarget) return;
    e.preventDefault();
    updatePopupDrag_(e.touches[0].clientX, e.touches[0].clientY);
  };
  overlay.ontouchend = function(e) {
    if (!popupDragging || popupDragSource !== 'touch') return;
    if (e.changedTouches && e.changedTouches.length === 1) {
      endPopupDrag_(e.changedTouches[0].clientX, e.changedTouches[0].clientY);
    } else {
      resetPopupDrag_();
    }
  };
  overlay.onmousedown = function(e) {
    if (e.button !== 0) return;
    startPopupDrag_('mouse', e.clientX, e.clientY, e.target);
  };
  overlay.onmousemove = function(e) {
    if (!popupDragging || popupDragSource !== 'mouse') return;
    if (updatePopupDrag_(e.clientX, e.clientY)) e.preventDefault();
  };
  overlay.onmouseup = function(e) {
    if (!popupDragging || popupDragSource !== 'mouse') return;
    endPopupDrag_(e.clientX, e.clientY);
  };
  overlay.onmouseleave = function() {
    if (popupDragSource === 'mouse') resetPopupDrag_();
  };
}

function popupMove(diff) {
  const newIndex = popupIndex + diff;
  if (newIndex < 0 || newIndex >= popupData.length) return;

  popupIndex = newIndex;
  const popupContent = document.getElementById('image-popup-content');
  popupContent.classList.remove('popup-slide-next', 'popup-slide-prev');
  void popupContent.offsetWidth;

  if (diff > 0) {
    popupContent.classList.add('popup-slide-next');
  } else {
    popupContent.classList.add('popup-slide-prev');
  }

  setTimeout(() => {
    popupContent.classList.remove('popup-slide-next', 'popup-slide-prev');
    showPopup(popupData[popupIndex], popupIndex, popupData, popupSeriesContext);
  }, 220);
}