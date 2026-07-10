(function() {
  'use strict';

  const frame = document.getElementById('appPreview');
  const loading = document.getElementById('previewLoading');
  const error = document.getElementById('previewError');
  const previewCssUrl = new URL('./styles.css?v=20260710-4', window.location.href).href;
  const tablerCssUrl = 'https://cdn.jsdelivr.net/npm/@tabler/icons-webfont@3.34.1/dist/tabler-icons.min.css';

  const iconMap = [
    ['[data-action="search"] .ui-icon', 'ti-search'],
    ['[data-action="random"] .ui-icon', 'ti-arrows-shuffle'],
    ['[data-action="toggle-advanced"] .ui-icon', 'ti-adjustments-horizontal'],
    ['[data-action="clear-conditions"] .ui-icon', 'ti-trash'],
    ['[data-action="focus-search"] .ui-icon', 'ti-search'],
    ['[data-action="bookshelf"] .ui-icon', 'ti-books'],
    ['.bookshelf-cta-icon', 'ti-books'],
    ['#tileViewBtn .ui-icon', 'ti-layout-grid'],
    ['#listViewBtn .ui-icon', 'ti-list'],
    ['#shelfViewBtn .ui-icon', 'ti-books'],
    ['[data-view-mode="card"] .ui-icon', 'ti-layout-grid'],
    ['[data-view-mode="list"] .ui-icon', 'ti-list'],
    ['[data-view-mode="shelf"] .ui-icon', 'ti-books'],
    ['#image-popup-close', 'ti-x'],
    ['#popup-prev .ui-icon', 'ti-chevron-left'],
    ['#popup-next .ui-icon', 'ti-chevron-right'],
    ['#cover-fullscreen-close', 'ti-x']
  ];

  function appendStylesheet(doc, href, marker) {
    if (doc.querySelector('link[data-preview-style="' + marker + '"]')) return;
    const link = doc.createElement('link');
    link.rel = 'stylesheet';
    link.href = href;
    link.dataset.previewStyle = marker;
    doc.head.appendChild(link);
  }

  function replaceIcon(element, iconClass) {
    if (!element || element.dataset.previewIcon === iconClass) return;
    element.textContent = '';
    const icon = element.ownerDocument.createElement('i');
    icon.className = 'ti ' + iconClass;
    icon.setAttribute('aria-hidden', 'true');
    element.appendChild(icon);
    element.dataset.previewIcon = iconClass;
  }

  function decorateIcons(doc) {
    iconMap.forEach(function(entry) {
      doc.querySelectorAll(entry[0]).forEach(function(element) {
        replaceIcon(element, entry[1]);
      });
    });

    const settingsButton = doc.getElementById('pwaSettingsButton');
    if (settingsButton) replaceIcon(settingsButton, 'ti-settings');

    const settingsClose = doc.getElementById('pwaSettingsClose');
    if (settingsClose) replaceIcon(settingsClose, 'ti-x');
  }

  function addBrand(doc) {
    const searchContainer = doc.getElementById('searchContainer');
    const originalLogo = doc.getElementById('logoResetBtn');
    if (!searchContainer || !originalLogo || doc.getElementById('appBrandResetBtn') || doc.getElementById('previewBrand')) return;

    const brand = doc.createElement('button');
    brand.id = 'previewBrand';
    brand.className = 'preview-brand';
    brand.type = 'button';
    brand.setAttribute('aria-label', '検索をリセットして最初に戻る');
    brand.innerHTML = [
      '<span class="preview-brand-mark" aria-hidden="true"><i class="ti ti-door-enter"></i></span>',
      '<span class="preview-brand-copy">',
      '<span class="preview-brand-name">趣味部屋図書館</span>',
      '<span class="preview-brand-note">個人の蔵書を探す、眺める。</span>',
      '</span>'
    ].join('');
    brand.addEventListener('click', function() {
      originalLogo.click();
    });
    searchContainer.insertBefore(brand, searchContainer.firstChild);
  }

  function addBookshelfArrow(doc) {
    const shelfButton = doc.querySelector('.bookshelf-cta-card.top-shelf-btn');
    if (!shelfButton || shelfButton.querySelector('.preview-cta-arrow')) return;
    const arrow = doc.createElement('span');
    arrow.className = 'preview-cta-arrow';
    arrow.setAttribute('aria-hidden', 'true');
    arrow.innerHTML = '<i class="ti ti-chevron-right"></i>';
    shelfButton.appendChild(arrow);
  }

  function addPreviewNote(doc) {
    const panel = doc.getElementById('pwaSettingsPanel');
    if (!panel || doc.getElementById('previewModeNote')) return;

    const note = doc.createElement('p');
    note.id = 'previewModeNote';
    note.className = 'preview-mode-note';
    note.textContent = 'UI試作モード。本番の画面とデータは変更しません。';
    panel.appendChild(note);
  }

  function installDynamicIconObserver(doc) {
    const target = doc.body;
    if (!target || target.dataset.previewObserver === 'ready') return;
    target.dataset.previewObserver = 'ready';

    let scheduled = false;
    const observer = new MutationObserver(function(mutations) {
      const needsRefresh = mutations.some(function(mutation) {
        return Array.from(mutation.addedNodes).some(function(node) {
          return node.nodeType === 1 && (
            node.id === 'image-popup-content' ||
            node.querySelector && node.querySelector('#image-popup-content, .shelf-room-map-overlay')
          );
        });
      });
      if (!needsRefresh || scheduled) return;
      scheduled = true;
      window.requestAnimationFrame(function() {
        scheduled = false;
        decorateIcons(doc);
      });
    });
    observer.observe(target, { childList: true, subtree: true });
  }

  function initializePreview() {
    try {
      const doc = frame.contentDocument;
      if (!doc || !doc.head || !doc.body) throw new Error('preview document unavailable');

      appendStylesheet(doc, tablerCssUrl, 'tabler');
      appendStylesheet(doc, previewCssUrl, 'night-library');
      doc.body.classList.add('sandbox-redesign');
      doc.documentElement.classList.add('sandbox-redesign-root');
      doc.title = '趣味部屋図書館 夜の個人書庫';

      const splash = doc.getElementById('pwaLaunchSplash');
      if (splash) splash.setAttribute('hidden', '');

      addBrand(doc);
      addBookshelfArrow(doc);
      addPreviewNote(doc);
      decorateIcons(doc);
      installDynamicIconObserver(doc);

      loading.hidden = true;
      error.hidden = true;
    } catch (previewError) {
      loading.hidden = true;
      error.hidden = false;
      console.error(previewError);
    }
  }

  frame.addEventListener('load', initializePreview);
  window.setTimeout(function() {
    if (!loading.hidden) initializePreview();
  }, 8000);
})();
