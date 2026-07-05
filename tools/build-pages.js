const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const crypto = require('crypto');

const root = path.resolve(__dirname, '..');
const docsDir = path.join(root, 'docs');
const cssDir = path.join(docsDir, 'assets', 'css');
const jsDir = path.join(docsDir, 'assets', 'js');
const iconDir = path.join(docsDir, 'assets', 'icons');

const gasEndpoint = 'https://script.google.com/macros/s/AKfycbzAfn1SJqfKCRExekRlBMsbo9w4ZwcLNH_W6OJ-1ekS9LUJudAISNhtaGt6kPzAwEWYeQ/exec';

const cssFiles = [
  'style.legacy-core.css.html',
  'style.legacy-modal.css.html',
  'style.shelf.css.html',
  'style.modern-core.css.html',
  'style.modern-modal.css.html',
  'style.modern-shelf.css.html',
  'style.responsive.css.html'
];

const jsFiles = [
  'script.state.js.html',
  'script.images.js.html',
  'script.search.js.html',
  'script.render.js.html',
  'script.shelf.js.html',
  'script.modal.js.html',
  'script.boot.js.html'
];

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function readUtf8(fileName) {
  return fs.readFileSync(path.join(root, fileName), 'utf8');
}

function stripWrapper(source, tagName) {
  const open = new RegExp(`^\\s*<${tagName}>\\s*`, 'i');
  const close = new RegExp(`\\s*</${tagName}>\\s*$`, 'i');
  return source.replace(open, '').replace(close, '');
}

function cssOutName(fileName) {
  return fileName.replace(/\.css\.html$/, '.css');
}

function jsOutName(fileName) {
  return fileName.replace(/\.js\.html$/, '.js');
}

function buildStaticIndex() {
  let source = readUtf8('index.html');

  source = source.replace('<html>', '<html lang="ja">');

  source = source.replace(
    /<title>[^<]*<\/title>/,
    [
      '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover, interactive-widget=resizes-content">',
      '<meta name="theme-color" content="#0a1217">',
      '<meta name="color-scheme" content="dark light">',
      '<meta name="apple-mobile-web-app-capable" content="yes">',
      '<meta name="apple-mobile-web-app-title" content="趣味部屋図書館">',
      '<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">',
      '<link rel="preconnect" href="https://script.google.com">',
      '<link rel="preconnect" href="https://script.googleusercontent.com">',
      '<link rel="dns-prefetch" href="//script.google.com">',
      '<link rel="dns-prefetch" href="//script.googleusercontent.com">',
      '<link rel="manifest" href="./manifest.webmanifest">',
      '<link rel="apple-touch-icon" href="./assets/icons/icon-192.png">',
      '<title>趣味部屋図書館</title>',
      '<style id="pwa-critical-style">html{background:#0a1217;color-scheme:dark light;}body{margin:0;background:#0a1217;color:#edf5f7;}</style>'
    ].join('\n  ')
  );

  source = source.replace(
    'https://i.imgur.com/szIBHwj.png',
    './assets/logo.png'
  );

  source = source.replace(
    /\s*<\?!= HtmlService\.createHtmlOutputFromFile\('([^']+\.css\.html)'\)\.getContent\(\); \?>/g,
    (match, fileName) => `\n  <link rel="stylesheet" href="./assets/css/${cssOutName(fileName)}">`
  );

  source = source.replace(
    '</head>',
    '  <link rel="stylesheet" href="./assets/css/pwa.css">\n</head>'
  );

  source = source.replace(
    /\s*<\?!= HtmlService\.createHtmlOutputFromFile\('script\.state\.js\.html'\)\.getContent\(\); \?>/,
    [
      '\n  <script src="./assets/js/gas-run-shim.js"></script>',
      '  <script src="./assets/js/pwa-client.js"></script>',
      '  <script src="./assets/js/script.state.js"></script>'
    ].join('\n')
  );

  source = source.replace(
    /\s*<\?!= HtmlService\.createHtmlOutputFromFile\('([^']+\.js\.html)'\)\.getContent\(\); \?>/g,
    (match, fileName) => `\n  <script src="./assets/js/${jsOutName(fileName)}"></script>`
  );

  source = source.replace(
    /(<body>)/,
    `$1
  <div id="pwaNetworkBanner" class="pwa-network-banner" role="status" aria-live="polite" hidden></div>
  <button id="pwaSettingsButton" class="pwa-settings-button" type="button" aria-label="設定を開く" aria-controls="pwaSettingsPanel" aria-expanded="false">
    <span aria-hidden="true"></span>
    <span aria-hidden="true"></span>
    <span aria-hidden="true"></span>
  </button>
  <div id="pwaSettingsBackdrop" class="pwa-settings-backdrop" hidden></div>
  <section id="pwaSettingsPanel" class="pwa-settings-panel" role="dialog" aria-modal="true" aria-labelledby="pwaSettingsTitle" tabindex="-1" hidden>
    <div class="pwa-settings-header">
      <h2 id="pwaSettingsTitle">設定</h2>
      <button id="pwaSettingsClose" class="pwa-settings-close" type="button" aria-label="設定を閉じる">
        <span aria-hidden="true">×</span>
      </button>
    </div>
    <div id="pwaSensitiveSetting" class="pwa-settings-section"></div>
    <div class="pwa-settings-section pwa-play-settings" aria-label="遊び">
      <p class="pwa-settings-section-title">遊び</p>
      <label class="pwa-settings-row pwa-settings-toggle-row">
        <span>
          <span class="pwa-settings-row-title">司書の気配</span>
          <span class="pwa-settings-row-note">検索や読み込みの言葉を少しだけ図書館寄りにします</span>
        </span>
        <input id="pwaLibrarianPresence" type="checkbox">
        <span class="pwa-mini-switch" aria-hidden="true"></span>
      </label>
      <label class="pwa-settings-row pwa-settings-toggle-row">
        <span>
          <span class="pwa-settings-row-title">静かな演出</span>
          <span class="pwa-settings-row-note">結果表示や詳細表示に控えめな余韻を足します</span>
        </span>
        <input id="pwaQuietMotion" type="checkbox">
        <span class="pwa-mini-switch" aria-hidden="true"></span>
      </label>
    </div>
    <fieldset class="pwa-settings-section pwa-theme-settings">
      <legend>カラーテーマ</legend>
      <label>
        <input type="radio" name="pwaTheme" value="shinhaku">
        <span>深碧</span>
      </label>
      <label>
        <input type="radio" name="pwaTheme" value="kohi">
        <span>紅緋</span>
      </label>
      <label>
        <input type="radio" name="pwaTheme" value="shikon">
        <span>紫紺</span>
      </label>
      <label>
        <input type="radio" name="pwaTheme" value="kohaku">
        <span>琥珀</span>
      </label>
    </fieldset>
  </section>`
  );

  return source;
}

function writeStaticAssets() {
  cssFiles.forEach(fileName => {
    fs.writeFileSync(
      path.join(cssDir, cssOutName(fileName)),
      stripWrapper(readUtf8(fileName), 'style'),
      'utf8'
    );
  });

  jsFiles.forEach(fileName => {
    fs.writeFileSync(
      path.join(jsDir, jsOutName(fileName)),
      stripWrapper(readUtf8(fileName), 'script'),
      'utf8'
    );
  });
}

function writePwaCss() {
  const css = `
body.pwa-shell {
  --pwa-bg-top: #10171e;
  --pwa-bg: #0a1217;
  --pwa-bg-bottom: #060a0f;
  --pwa-panel: rgba(13, 22, 29, 0.84);
  --pwa-panel-strong: rgba(14, 23, 31, 0.96);
  --pwa-panel-soft: rgba(255, 255, 255, 0.048);
  --pwa-line: rgba(92, 164, 180, 0.20);
  --pwa-line-strong: rgba(116, 198, 204, 0.36);
  --pwa-accent: #5aaec0;
  --pwa-accent-2: #78c8c8;
  --pwa-accent-rgb: 90, 174, 192;
  --pwa-accent-2-rgb: 120, 200, 200;
  --pwa-accent-text: #06151a;
  --pwa-accent-readable: #dff8ff;
  --pwa-warm: #d6a45f;
  --pwa-warm-2: #f0c37a;
  --pwa-warm-rgb: 214, 164, 95;
  --pwa-grid-rgb: 143, 220, 226;
  --pwa-shadow-rgb: 0, 0, 0;
  --lib-bg: var(--pwa-bg);
  --lib-bg-2: var(--pwa-bg-top);
  --lib-panel: var(--pwa-panel);
  --lib-panel-strong: var(--pwa-panel-strong);
  --lib-panel-soft: var(--pwa-panel-soft);
  --lib-line: var(--pwa-line);
  --lib-line-strong: var(--pwa-line-strong);
  --lib-accent: var(--pwa-accent);
  --lib-accent-2: var(--pwa-accent-2);
  --lib-amber: var(--pwa-warm);
  --lib-amber-2: var(--pwa-warm-2);
  background:
    linear-gradient(135deg, rgba(var(--pwa-grid-rgb), 0.032) 0 1px, transparent 1px 18px),
    linear-gradient(180deg, var(--pwa-bg-top) 0%, var(--pwa-bg) 42%, var(--pwa-bg-bottom) 100%);
}

body.pwa-shell::before {
  background:
    radial-gradient(circle at 14% 12%, rgba(var(--pwa-accent-rgb), 0.055), transparent 32%),
    linear-gradient(90deg, rgba(var(--pwa-accent-rgb), 0.026), transparent 30%, transparent 70%, rgba(var(--pwa-warm-rgb), 0.024)),
    linear-gradient(180deg, rgba(255, 255, 255, 0.028), transparent 36%);
}

body.pwa-theme-shinhaku {
  --pwa-bg-top: #10171e;
  --pwa-bg: #0a1217;
  --pwa-bg-bottom: #060a0f;
  --pwa-panel: rgba(13, 22, 29, 0.84);
  --pwa-panel-strong: rgba(14, 23, 31, 0.96);
  --pwa-line: rgba(92, 164, 180, 0.20);
  --pwa-line-strong: rgba(116, 198, 204, 0.36);
  --pwa-accent: #5aaec0;
  --pwa-accent-2: #78c8c8;
  --pwa-accent-rgb: 90, 174, 192;
  --pwa-accent-2-rgb: 120, 200, 200;
  --pwa-accent-text: #06151a;
  --pwa-accent-readable: #dff8ff;
  --pwa-warm: #d6a45f;
  --pwa-warm-2: #f0c37a;
  --pwa-warm-rgb: 214, 164, 95;
  --pwa-grid-rgb: 104, 191, 215;
}

body.pwa-theme-kohi {
  --pwa-bg-top: #191316;
  --pwa-bg: #120c0f;
  --pwa-bg-bottom: #090608;
  --pwa-panel: rgba(24, 18, 21, 0.84);
  --pwa-panel-strong: rgba(28, 19, 22, 0.96);
  --pwa-line: rgba(186, 82, 86, 0.20);
  --pwa-line-strong: rgba(213, 106, 98, 0.36);
  --pwa-accent: #b94f55;
  --pwa-accent-2: #d56f65;
  --pwa-accent-rgb: 185, 79, 85;
  --pwa-accent-2-rgb: 213, 111, 101;
  --pwa-accent-text: #1b0708;
  --pwa-accent-readable: #ffe1d9;
  --pwa-warm: #d6a45f;
  --pwa-warm-2: #f0c37a;
  --pwa-warm-rgb: 214, 164, 95;
  --pwa-grid-rgb: 219, 90, 93;
}

body.pwa-theme-shikon {
  --pwa-bg-top: #171621;
  --pwa-bg: #0f0e18;
  --pwa-bg-bottom: #080711;
  --pwa-panel: rgba(21, 20, 32, 0.84);
  --pwa-panel-strong: rgba(24, 22, 36, 0.96);
  --pwa-line: rgba(143, 126, 200, 0.22);
  --pwa-line-strong: rgba(171, 151, 224, 0.38);
  --pwa-accent: #8d7cc5;
  --pwa-accent-2: #aa98df;
  --pwa-accent-rgb: 141, 124, 197;
  --pwa-accent-2-rgb: 170, 152, 223;
  --pwa-accent-text: #120d22;
  --pwa-accent-readable: #eee6ff;
  --pwa-warm: #d6a45f;
  --pwa-warm-2: #f0c37a;
  --pwa-warm-rgb: 214, 164, 95;
  --pwa-grid-rgb: 166, 142, 225;
}

body.pwa-theme-kohaku {
  --pwa-bg-top: #18140f;
  --pwa-bg: #120f0b;
  --pwa-bg-bottom: #090705;
  --pwa-panel: rgba(22, 18, 13, 0.86);
  --pwa-panel-strong: rgba(26, 20, 14, 0.96);
  --pwa-line: rgba(191, 143, 78, 0.22);
  --pwa-line-strong: rgba(221, 174, 104, 0.38);
  --pwa-accent: #bd8c4f;
  --pwa-accent-2: #ddb06e;
  --pwa-accent-rgb: 189, 140, 79;
  --pwa-accent-2-rgb: 221, 176, 110;
  --pwa-accent-text: #171006;
  --pwa-accent-readable: #fff2d6;
  --pwa-warm: #c98a49;
  --pwa-warm-2: #f0c37a;
  --pwa-warm-rgb: 201, 138, 73;
  --pwa-grid-rgb: 214, 164, 95;
}

.pwa-network-banner {
  position: fixed;
  left: max(12px, env(safe-area-inset-left));
  right: max(12px, env(safe-area-inset-right));
  bottom: max(12px, env(safe-area-inset-bottom));
  z-index: 12000;
  padding: 12px 14px;
  border: 1px solid rgba(47, 95, 74, 0.22);
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.96);
  color: #1d352b;
  box-shadow: 0 10px 26px rgba(26, 37, 32, 0.16);
  font-size: 0.92rem;
  line-height: 1.55;
}

body.pwa-shell .mobile-app-dock {
  touch-action: manipulation;
}

body.pwa-standalone {
  --pwa-safe-top: env(safe-area-inset-top, 0px);
  -webkit-user-select: none;
  user-select: none;
  min-height: 100svh;
  padding-top: var(--pwa-safe-top);
  background-color: var(--pwa-bg);
}

body.pwa-standalone input,
body.pwa-standalone textarea,
body.pwa-standalone select,
body.pwa-standalone #result,
body.pwa-standalone #image-popup-info {
  -webkit-user-select: text;
  user-select: text;
}

body.pwa-standalone .search-container.centered {
  min-height: calc(100svh - 96px - var(--pwa-safe-top) - env(safe-area-inset-bottom));
}

body.pwa-standalone .search-container:not(.centered) {
  top: var(--pwa-safe-top);
}

body.pwa-standalone .mobile-app-dock {
  border-radius: 22px;
  background: color-mix(in srgb, var(--pwa-panel-strong) 90%, transparent);
}

body.pwa-settings-open {
  overflow: hidden;
}

.pwa-settings-button {
  position: fixed;
  top: max(12px, env(safe-area-inset-top));
  right: max(12px, env(safe-area-inset-right));
  z-index: 11900;
  width: 42px;
  height: 42px;
  display: grid;
  place-content: center;
  gap: 4px;
  border: 1px solid var(--pwa-line);
  border-radius: 999px;
  background: color-mix(in srgb, var(--pwa-panel-strong) 58%, transparent);
  color: rgba(234, 241, 248, 0.82);
  box-shadow: 0 10px 24px rgba(0, 0, 0, 0.24);
  backdrop-filter: blur(14px);
  cursor: pointer;
}

.pwa-settings-button span {
  width: 16px;
  height: 2px;
  border-radius: 999px;
  background: currentColor;
}

.pwa-settings-button[aria-expanded="true"] {
  border-color: var(--pwa-line-strong);
  color: var(--pwa-accent-readable);
}

.pwa-settings-backdrop {
  position: fixed;
  inset: 0;
  z-index: 12100;
  background: color-mix(in srgb, var(--pwa-bg-bottom) 62%, transparent);
  backdrop-filter: blur(5px);
}

.pwa-settings-panel {
  position: fixed;
  top: max(64px, calc(env(safe-area-inset-top) + 58px));
  right: max(12px, env(safe-area-inset-right));
  z-index: 12200;
  width: min(340px, calc(100vw - 24px - env(safe-area-inset-left) - env(safe-area-inset-right)));
  padding: 14px;
  border: 1px solid var(--pwa-line);
  border-radius: 8px;
  background: var(--pwa-panel-strong);
  color: #edf5f7;
  box-shadow: 0 20px 54px rgba(0, 0, 0, 0.46);
}

.pwa-settings-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 12px;
}

.pwa-settings-header h2 {
  margin: 0;
  font-size: 1rem;
  letter-spacing: 0;
}

.pwa-settings-close {
  width: 36px;
  height: 36px;
  border: 1px solid var(--pwa-line);
  border-radius: 999px;
  background: var(--pwa-panel-soft);
  color: rgba(234, 241, 248, 0.78);
  font-size: 1.35rem;
  line-height: 1;
  cursor: pointer;
}

.pwa-settings-section {
  margin: 0;
  padding: 12px 0;
  border: 0;
  border-top: 1px solid color-mix(in srgb, var(--pwa-line) 68%, transparent);
}

.pwa-settings-section-title {
  margin: 0 0 10px;
  color: rgba(237, 245, 247, 0.92);
  font-size: 0.86rem;
  font-weight: 800;
  letter-spacing: 0;
}

.pwa-settings-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 14px;
}

.pwa-settings-row-title,
.pwa-theme-settings legend {
  margin: 0 0 4px;
  color: rgba(237, 245, 247, 0.92);
  font-size: 0.86rem;
  font-weight: 800;
  letter-spacing: 0;
}

.pwa-settings-row-note {
  display: block;
  margin: 0;
  color: rgba(220, 232, 238, 0.58);
  font-size: 0.74rem;
  line-height: 1.45;
}

.pwa-settings-toggle-row {
  min-height: 48px;
  cursor: pointer;
}

.pwa-settings-toggle-row + .pwa-settings-toggle-row {
  margin-top: 10px;
}

.pwa-settings-toggle-row input {
  position: absolute;
  inline-size: 1px;
  block-size: 1px;
  opacity: 0;
  pointer-events: none;
}

.pwa-mini-switch {
  position: relative;
  flex: 0 0 auto;
  width: 42px;
  height: 24px;
  border: 1px solid var(--pwa-line);
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.08);
  transition: background 160ms ease, border-color 160ms ease;
}

.pwa-mini-switch::after {
  content: "";
  position: absolute;
  top: 3px;
  left: 3px;
  width: 16px;
  height: 16px;
  border-radius: 50%;
  background: rgba(237, 245, 247, 0.84);
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.32);
  transition: transform 160ms ease, background 160ms ease;
}

.pwa-settings-toggle-row input:checked + .pwa-mini-switch {
  border-color: var(--pwa-line-strong);
  background: rgba(var(--pwa-accent-rgb), 0.22);
}

.pwa-settings-toggle-row input:checked + .pwa-mini-switch::after {
  transform: translateX(18px);
  background: var(--pwa-warm-2);
}

.pwa-settings-toggle-row:focus-within .pwa-mini-switch {
  outline: 2px solid color-mix(in srgb, var(--pwa-accent-2) 78%, white);
  outline-offset: 3px;
}

.pwa-settings-panel .sensitive-toggle {
  position: relative;
  top: auto;
  right: auto;
  flex: 0 0 auto;
  margin: 0;
}

.pwa-theme-settings {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 8px;
}

.pwa-theme-settings legend {
  grid-column: 1 / -1;
}

.pwa-theme-settings label {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  min-height: 38px;
  padding: 7px 8px;
  border: 1px solid color-mix(in srgb, var(--pwa-line) 72%, transparent);
  border-radius: 8px;
  background: var(--pwa-panel-soft);
  color: rgba(234, 241, 248, 0.78);
  font-size: 0.78rem;
  font-weight: 800;
}

.pwa-theme-settings input {
  accent-color: var(--pwa-accent);
}

body.pwa-shell .search-container,
body.pwa-shell #image-popup-content,
body.pwa-shell .book-card,
body.pwa-shell .bookshelf-group,
body.pwa-shell .shelf-room-map,
body.pwa-shell .shelf-room-map-modal-panel,
body.pwa-shell .spinner-panel {
  background: var(--pwa-panel);
  border-color: var(--pwa-line);
}

body.pwa-shell .search-container {
  box-shadow: 0 10px 34px rgba(var(--pwa-shadow-rgb), 0.30);
}

body.pwa-shell input,
body.pwa-shell select,
body.pwa-shell textarea {
  border-color: color-mix(in srgb, var(--pwa-line) 78%, transparent);
}

body.pwa-shell input:focus,
body.pwa-shell select:focus,
body.pwa-shell textarea:focus {
  border-color: var(--pwa-line-strong);
  box-shadow: 0 0 0 3px rgba(var(--pwa-accent-rgb), 0.09);
}

body.pwa-shell .button-group button.primary,
body.pwa-shell .button-group button[data-action="search"],
body.pwa-shell .pwa-network-banner-action,
body.pwa-shell .mobile-app-dock-btn.active,
body.pwa-shell .mobile-app-dock-btn:focus-visible,
body.pwa-shell .mobile-dock-view-btn.active,
body.pwa-shell .mobile-dock-view-btn:focus-visible,
body.pwa-shell .toggle-btn.active {
  border-color: var(--pwa-line-strong);
  background:
    linear-gradient(180deg, rgba(var(--pwa-accent-2-rgb), 0.26), rgba(var(--pwa-accent-rgb), 0.18)),
    color-mix(in srgb, var(--pwa-panel-strong) 86%, transparent);
  color: var(--pwa-accent-readable);
  box-shadow: 0 10px 24px rgba(var(--pwa-accent-rgb), 0.08);
}

body.pwa-shell .button-group button.secondary,
body.pwa-shell .button-group button[data-action="random"],
body.pwa-shell .toggle-btn,
body.pwa-shell .mobile-app-dock,
body.pwa-shell .mobile-app-dock-btn,
body.pwa-shell .mobile-dock-view-btn,
body.pwa-shell .view-toggle,
body.pwa-shell .shelf-jump-nav,
body.pwa-shell .shelf-jump-chip,
body.pwa-shell .shelf-jump-top-btn {
  border-color: color-mix(in srgb, var(--pwa-line) 68%, transparent);
  background: color-mix(in srgb, var(--pwa-panel-strong) 78%, transparent);
}

body.pwa-shell .button-group button.accent,
body.pwa-shell .top-shelf-btn,
body.pwa-shell .bookshelf-cta-card.top-shelf-btn,
body.pwa-shell .mobile-app-dock-btn.primary,
body.pwa-shell .shelf-jump-chip.is-active,
body.pwa-shell .room-map-shelf.is-active {
  border-color: color-mix(in srgb, var(--pwa-warm-2) 38%, transparent);
  background:
    linear-gradient(135deg, rgba(var(--pwa-warm-rgb), 0.14), rgba(var(--pwa-accent-rgb), 0.055)),
    color-mix(in srgb, var(--pwa-panel-strong) 88%, transparent);
  color: var(--pwa-accent-readable);
}

body.pwa-shell .bookshelf-cta-icon,
body.pwa-shell .bookshelf-cta-title,
body.pwa-shell .shelf-room-map-fab-icon,
body.pwa-shell .book-meta-pill-label,
body.pwa-shell .shelf-view-stat-value,
body.pwa-shell .spinner-shelf::after {
  color: var(--pwa-warm-2);
}

body.pwa-librarian-presence #logoResetBtn.logo {
  width: min(360px, 72vw);
  height: clamp(112px, 17vw, 172px);
  object-fit: cover;
  object-position: 22% 42%;
  border: 1px solid color-mix(in srgb, var(--pwa-warm-2) 28%, transparent);
  border-radius: 18px;
  box-shadow:
    0 18px 46px rgba(0, 0, 0, 0.34),
    0 0 0 1px rgba(255, 255, 255, 0.045) inset;
}

body.pwa-librarian-presence .search-container.shrink #logoResetBtn.logo {
  width: 132px;
  height: 62px;
  border-radius: 12px;
  object-position: 22% 42%;
}

body.pwa-librarian-presence .search-container.shrink.shelf-view-active #logoResetBtn.logo {
  width: 108px;
  height: 48px;
}

body.pwa-shell .genre-chip,
body.pwa-shell .summary-chip-toggle,
body.pwa-shell .book-meta-pill,
body.pwa-shell .search-status-chip,
body.pwa-shell .shelf-view-stat,
body.pwa-shell .bookshelf-level-title {
  border-color: color-mix(in srgb, var(--pwa-line) 62%, transparent);
  background: rgba(var(--pwa-accent-rgb), 0.055);
  color: var(--pwa-accent-readable);
}

body.pwa-shell .summary-chip-toggle,
body.pwa-shell .search-status-chip.shelf,
body.pwa-shell .book-meta-pill.location {
  border-color: color-mix(in srgb, var(--pwa-warm-2) 32%, transparent);
  background: rgba(var(--pwa-warm-rgb), 0.075);
  color: var(--pwa-accent-readable);
}

body.pwa-shell .toggle-btn.active::after,
body.pwa-shell .spinner-shelf span,
body.pwa-shell .bookshelf-group-title::before {
  background: var(--pwa-warm-2);
}

body.pwa-shell .sensitive-toggle-input:checked + .sensitive-toggle-switch,
body.pwa-shell .sensitive-toggle:has(.sensitive-toggle-input:checked) .sensitive-toggle-switch {
  background: rgba(var(--pwa-accent-rgb), 0.22);
  border-color: var(--pwa-line-strong);
}

body.pwa-quiet-motion .result-fade.show {
  transition-duration: 360ms;
  transition-timing-function: cubic-bezier(.18,.86,.22,1);
}

body.pwa-quiet-motion .result-fade.show .book-card,
body.pwa-quiet-motion .result-fade.show .shelf-book {
  animation-duration: 360ms;
  animation-delay: calc(var(--book-reveal-index, 0) * 34ms);
}

body.pwa-quiet-motion #image-popup-content {
  transition:
    transform 220ms cubic-bezier(.18,.86,.22,1),
    opacity 220ms ease,
    border-color 180ms ease,
    box-shadow 180ms ease;
}

body.pwa-quiet-motion .book-cover.book-image-loaded,
body.pwa-quiet-motion .list-thumb.book-image-loaded,
body.pwa-quiet-motion .shelf-book-cover.book-image-loaded,
body.pwa-quiet-motion #image-popup-img.book-image-loaded,
body.pwa-quiet-motion #cover-fullscreen-img.book-image-loaded {
  animation-duration: 360ms;
}

@media (prefers-reduced-motion: reduce) {
  body.pwa-quiet-motion .result-fade.show,
  body.pwa-quiet-motion #image-popup-content {
    transition: none;
  }

  body.pwa-quiet-motion .result-fade.show .book-card,
  body.pwa-quiet-motion .result-fade.show .shelf-book,
  body.pwa-quiet-motion .book-cover.book-image-loaded,
  body.pwa-quiet-motion .list-thumb.book-image-loaded,
  body.pwa-quiet-motion .shelf-book-cover.book-image-loaded,
  body.pwa-quiet-motion #image-popup-img.book-image-loaded,
  body.pwa-quiet-motion #cover-fullscreen-img.book-image-loaded {
    animation: none;
  }
}

body.pwa-shell .sensitive-toggle-input:focus-visible + .sensitive-toggle-switch,
body.pwa-shell button:focus-visible,
body.pwa-shell .book-open-surface:focus-visible,
body.pwa-shell .shelf-book:focus-visible,
body.pwa-shell #image-popup-img:focus-visible,
body.pwa-shell #cover-fullscreen-img:focus-visible {
  outline-color: color-mix(in srgb, var(--pwa-accent-2) 78%, white);
}

body.pwa-shell #image-popup-overlay,
body.pwa-shell #cover-fullscreen-overlay,
body.pwa-shell .shelf-room-map-overlay {
  background: color-mix(in srgb, var(--pwa-bg-bottom) 82%, transparent);
}

body.pwa-shell .room-map-shelf {
  border-color: color-mix(in srgb, var(--pwa-warm-2) 24%, transparent);
  background: linear-gradient(135deg, rgba(var(--pwa-warm-rgb), 0.10), rgba(var(--pwa-accent-rgb), 0.045));
}

body.pwa-shell .room-map-shelf:hover,
body.pwa-shell .room-map-shelf:focus-visible,
body.pwa-shell .shelf-book:hover,
body.pwa-shell .shelf-book:focus-visible,
body.pwa-shell .book-card:hover {
  border-color: var(--pwa-line-strong);
  box-shadow: 0 12px 28px rgba(var(--pwa-accent-rgb), 0.08), 0 12px 28px rgba(0, 0, 0, 0.24);
}

body.pwa-shell .pwa-theme-settings label:has(input:checked) {
  border-color: var(--pwa-line-strong);
  background: rgba(var(--pwa-accent-rgb), 0.105);
  color: var(--pwa-accent-readable);
}

.pwa-settings-button ~ .view-toggle {
  max-width: calc(100vw - 88px - env(safe-area-inset-left) - env(safe-area-inset-right));
}

body.pwa-network-visible {
  --pwa-network-banner-offset: 118px;
}

body.pwa-network-visible:not(.mobile-dock-has-results) {
  --pwa-network-banner-offset: 78px;
}

body.pwa-network-visible .mobile-app-dock {
  transform: translateY(calc(-1 * var(--pwa-network-banner-offset)));
}

body.pwa-network-visible.mobile-input-active .mobile-app-dock {
  transform: translateY(calc(100% + 16px));
}

body.pwa-update-visible .mobile-app-dock {
  transform: none;
}

.pwa-network-banner.is-error {
  border-color: rgba(166, 73, 58, 0.28);
  color: #5f2f26;
}

.pwa-network-banner.is-update {
  border-color: rgba(104, 191, 215, 0.34);
  color: #dff8ff;
  background: rgba(13, 22, 31, 0.94);
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  left: auto;
  right: max(12px, env(safe-area-inset-right));
  bottom: auto;
  top: max(12px, env(safe-area-inset-top));
  max-width: min(360px, calc(100vw - 24px - env(safe-area-inset-left) - env(safe-area-inset-right)));
  padding: 9px 10px 9px 12px;
  box-shadow: 0 12px 28px rgba(0, 0, 0, 0.26);
}

.pwa-network-banner.is-notice {
  border-color: rgba(214, 164, 95, 0.34);
  color: #4c3820;
}

.pwa-network-banner-action {
  margin-left: 0.75em;
  padding: 0.34em 0.78em;
  border: 1px solid rgba(47, 95, 74, 0.28);
  border-radius: 999px;
  background: #2f5f4a;
  color: #fff;
  font: inherit;
  font-weight: 800;
  cursor: pointer;
}

.pwa-network-banner-action-muted {
  margin-left: 0.45em;
  border-color: rgba(47, 95, 74, 0.20);
  background: rgba(255, 255, 255, 0.60);
  color: #2f453d;
}

@media (max-width: 900px) {
  .pwa-settings-button ~ .view-toggle {
    top: max(10px, env(safe-area-inset-top));
    right: auto;
    left: max(10px, env(safe-area-inset-left));
    justify-content: flex-start;
  }
}

@media (max-width: 640px) {
  body.pwa-network-visible {
    padding-bottom: calc(196px + env(safe-area-inset-bottom));
  }

  body.pwa-network-visible:not(.mobile-dock-has-results) {
    padding-bottom: calc(154px + env(safe-area-inset-bottom));
  }

  .pwa-network-banner {
    font-size: 0.86rem;
    padding: 10px 12px;
  }

  .pwa-network-banner.is-update {
    left: max(12px, env(safe-area-inset-left));
    right: max(12px, env(safe-area-inset-right));
    width: auto;
    max-width: none;
    padding: 8px 9px 8px 11px;
    font-size: 0.82rem;
  }

  .pwa-settings-button {
    width: 38px;
    height: 38px;
  }

  .pwa-settings-button ~ .view-toggle {
    top: max(8px, env(safe-area-inset-top));
    left: max(8px, env(safe-area-inset-left));
  }

  .pwa-settings-panel {
    top: max(56px, calc(env(safe-area-inset-top) + 50px));
  }
}

@media (min-width: 641px) {
  body.pwa-network-visible .mobile-app-dock {
    transform: none;
  }
}
`.trim();

  fs.writeFileSync(path.join(cssDir, 'pwa.css'), `${css}\n`, 'utf8');
}

function writeGasRunShim() {
  const js = `
(function() {
  'use strict';

  const GAS_JSONP_ENDPOINT = ${JSON.stringify(gasEndpoint)};
  const JSONP_TIMEOUT_MS = 60000;

  const METHOD_CONFIG = {
    getInitialSearchData: { api: 'initial', argNames: [] },
    getSuggestData: { api: 'suggest', argNames: [] },
    getAdvancedSearchOptions: { api: 'advancedOptions', argNames: [] },
    getPreviewIndex: { api: 'previewIndex', argNames: [] },
    countPreviewMatchesAuthoritative: {
      api: 'countPreview',
      argNames: [
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
      ]
    },
    searchBooksSimple: { api: 'searchSimple', argNames: ['keyword'] },
    searchBooksAdvanced: {
      api: 'searchAdvanced',
      argNames: [
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
      ]
    },
    getRandomBooks: { api: 'random', argNames: ['count'] },
    getAllBooks: { api: 'shelf', argNames: [] },
    getBookshelfBooks: { api: 'shelf', argNames: [] },
    getBookshelfBooksChunk: { api: 'shelfChunk', argNames: ['offset', 'limit'] },
    getBookDetailByRowIndex: { api: 'bookDetail', argNames: ['rowIndex'] },
    getBookDetailsByRowIndexes: { api: 'bookDetails', argNames: ['rowIndexes'] },
    getBooksBySeriesKey: { api: 'series', argNames: ['seriesKeyAuto'] }
  };

  let requestSeq = 0;
  const runnerState = {
    successHandler: null,
    failureHandler: null
  };

  function resetRunnerState_() {
    runnerState.successHandler = null;
    runnerState.failureHandler = null;
  }

  function createError_(message, code, details) {
    const error = new Error(message || '通信に失敗しました');
    error.code = code || 'JSONP_ERROR';
    if (details) error.details = details;
    return error;
  }

  function notifyFailure_(error) {
    if (window.ShumiLibraryPwa && typeof window.ShumiLibraryPwa.handleApiFailure === 'function') {
      window.ShumiLibraryPwa.handleApiFailure(error);
    }
  }

  function notifySuccess_() {
    if (window.ShumiLibraryPwa && typeof window.ShumiLibraryPwa.clearApiFailure === 'function') {
      window.ShumiLibraryPwa.clearApiFailure();
    }
  }

  function invokeFailure_(handler, error) {
    notifyFailure_(error);
    if (typeof handler === 'function') {
      handler(error);
    }
  }

  function encodeParamValue_(value) {
    const utf8Binary = encodeURIComponent(String(value)).replace(/%([0-9A-F]{2})/g, function(match, hex) {
      return String.fromCharCode(parseInt(hex, 16));
    });

    return btoa(utf8Binary)
      .replace(/\\+/g, '-')
      .replace(/\\//g, '_')
      .replace(/=+$/g, '');
  }

  function appendArgs_(params, argNames, args) {
    (argNames || []).forEach(function(name, index) {
      const value = args[index];
      if (value === undefined || value === null) return;
      params.set(name + 'B64', encodeParamValue_(value));
    });
  }

  function invokeJsonp_(methodName, args, successHandler, failureHandler) {
    let config = METHOD_CONFIG[methodName];
    if (methodName === 'searchBooksSimple' && !String(args[0] || '').trim()) {
      config = METHOD_CONFIG.getAllBooks;
      args = [];
    }
    if (!config) {
      if (methodName === 'saveWebAppUserPreferences') {
        if (typeof successHandler === 'function') {
          window.setTimeout(function() {
            successHandler(args[0] || {});
          }, 0);
        }
        return;
      }

      invokeFailure_(
        failureHandler,
        createError_('未対応のAPIです: ' + methodName, 'UNSUPPORTED_API')
      );
      return;
    }

    if (navigator && navigator.onLine === false) {
      invokeFailure_(
        failureHandler,
        createError_('端末がオフラインです。通信が戻ってから再試行してください。', 'OFFLINE')
      );
      return;
    }

    const callbackName = '__shumiLibraryJsonp_' + Date.now() + '_' + (++requestSeq);
    const params = new URLSearchParams();
    const script = document.createElement('script');
    let finished = false;
    let timeoutId = 0;

    params.set('api', config.api);
    params.set('callback', callbackName);
    params.set('rq', String(Date.now()));
    appendArgs_(params, config.argNames, args);

    function cleanup_() {
      if (timeoutId) window.clearTimeout(timeoutId);
      try {
        delete window[callbackName];
      } catch (e) {
        window[callbackName] = undefined;
      }
      if (script.parentNode) {
        script.parentNode.removeChild(script);
      }
    }

    window[callbackName] = function(envelope) {
      if (finished) return;
      finished = true;
      cleanup_();

      if (!envelope || envelope.ok === false) {
        const errorInfo = envelope && envelope.error ? envelope.error : {};
        invokeFailure_(
          failureHandler,
          createError_(errorInfo.message || 'APIからエラーが返りました。', 'API_ERROR', errorInfo)
        );
        return;
      }

      notifySuccess_();
      if (typeof successHandler === 'function') {
        successHandler(envelope.data);
      }
    };

    timeoutId = window.setTimeout(function() {
      if (finished) return;
      finished = true;
      cleanup_();
      invokeFailure_(
        failureHandler,
        createError_('通信がタイムアウトしました。時間を置いて再度お試しください。', 'TIMEOUT')
      );
    }, JSONP_TIMEOUT_MS);

    script.async = true;
    script.src = GAS_JSONP_ENDPOINT + '?' + params.toString();
    script.onerror = function() {
      if (finished) return;
      finished = true;
      cleanup_();
      invokeFailure_(
        failureHandler,
        createError_('APIを読み込めませんでした。通信状態を確認してください。', 'SCRIPT_ERROR')
      );
    };

    document.head.appendChild(script);
  }

  const runnerProxy = new Proxy({}, {
    get: function(target, property) {
      if (property === 'withSuccessHandler') {
        return function(handler) {
          runnerState.successHandler = handler;
          return runnerProxy;
        };
      }

      if (property === 'withFailureHandler') {
        return function(handler) {
          runnerState.failureHandler = handler;
          return runnerProxy;
        };
      }

      return function() {
        const args = Array.prototype.slice.call(arguments);
        const successHandler = runnerState.successHandler;
        const failureHandler = runnerState.failureHandler;
        resetRunnerState_();
        invokeJsonp_(String(property), args, successHandler, failureHandler);
        return runnerProxy;
      };
    }
  });

  window.google = window.google || {};
  window.google.script = window.google.script || {};
  window.google.script.run = runnerProxy;
})();
`.trim();

  fs.writeFileSync(path.join(jsDir, 'gas-run-shim.js'), `${js}\n`, 'utf8');
}

function writePwaClient() {
  const js = `
(function() {
  'use strict';

  const OFFLINE_MESSAGE = '端末がオフラインです。通信が戻ったら、もう一度検索してください。';
  const API_ERROR_MESSAGE = '蔵書データを取得できませんでした。通信状態を確認して再試行してください。';
  const UPDATE_MESSAGE = '新しい版があります。';
  const INSTALL_PROMPT_MESSAGE = 'ホーム画面に追加できます。';
  const INSTALL_PROMPT_STORAGE_KEY = 'shumiLibrary.pwaInstallPromptDismissed.v1';
  const IOS_INSTALL_MESSAGE = '共有からホーム画面に追加できます。';
  const IOS_INSTALL_STORAGE_KEY = 'shumiLibrary.pwaIosInstallHintDismissed.v1';
  const INSTALL_HINT_AUTO_HIDE_MS = 12000;
  const THEME_STORAGE_KEY = 'shumiLibrary.pwaTheme.v1';
  const LIBRARIAN_PRESENCE_STORAGE_KEY = 'shumiLibrary.librarianPresence.v1';
  const QUIET_MOTION_STORAGE_KEY = 'shumiLibrary.quietMotion.v1';
  const DEFAULT_LOGO_SRC = './assets/logo.png';
  const LIBRARIAN_LOGO_SRC = './assets/librarian-presence.jpg';
  const THEME_DEFAULT = 'shinhaku';
  const THEME_OPTIONS = ['shinhaku', 'kohi', 'shikon', 'kohaku'];
  const LEGACY_THEME_ALIASES = {
    default: 'shinhaku',
    calm: 'shinhaku',
    warm: 'kohaku'
  };
  const THEME_COLORS = {
    shinhaku: '#0a1217',
    kohi: '#120c0f',
    shikon: '#0f0e18',
    kohaku: '#120f0b'
  };
  const LIBRARIAN_TEXTS = {
    'empty.title': 'この条件の本は、今は棚の奥に隠れているようです',
    'empty.text': '言葉を少しゆるめるか、条件を外してもう一度だけ棚を覗いてみましょう。',
    'empty.action.search': '検索語を整える',
    'empty.action.clear': '条件をほどく',
    'empty.action.random': '別の棚を眺める',
    'status.random': data => data && Number.isFinite(data.count) ? data.count + '冊をそっと選びました' : '棚から本を選びました',
    'status.shelf': data => data && Number.isFinite(data.count) ? '全' + data.count + '冊の棚を開いています' : '本棚を開いています',
    'status.result': data => data && Number.isFinite(data.count) ? data.count + '冊が灯りの下に出てきました' : '本が見つかりました',
    'status.beforeSearch': '棚を探す前',
    'status.previewPending': '棚札を確かめています',
    'status.conditions': '探す手がかり',
    'status.previewReady': data => data && Number.isFinite(data.count) ? 'この手がかりなら' + data.count + '冊' : '候補が見えています',
    'spinner.label.search': '棚を探しています',
    'spinner.label.advanced': '手がかりを照らしています',
    'spinner.label.random': '棚から10冊抜き出しています',
    'spinner.label.shelf': '棚の灯りをともしています',
    'spinner.label.browse': '選んだ入口を辿っています',
    'spinner.label.refine': '棚を並べ直しています',
    'spinner.detail.search': 'タイトル・作者・読みを静かに照合しています',
    'spinner.detail.advanced': 'ジャンルや発売日の札を一枚ずつ確かめています',
    'spinner.detail.random': '今夜目が合う本を少しだけ選んでいます',
    'spinner.detail.shelf': '蔵書全体と棚マップをゆっくり広げています',
    'spinner.detail.browse': '選んだ気分に近い棚を覗いています',
    'spinner.detail.refine': '外した条件を反映して、棚を整えています',
    'shelfOverview.heading.immersive': '蔵書全体の棚を開いています',
    'shelfOverview.heading.result': '見つかった本を棚順に並べています',
    'shelfOverview.note.immersive': 'マップと棚ジャンプで、趣味部屋の奥へ移動できます。',
    'shelfOverview.note.result': '検索結果だけを棚順に並べています。全体を眺めるときはトップの「本棚を見る」からどうぞ。',
    'popup.detailLoading': '詳細の頁を開いています',
    'series.loading': 'シリーズ棚を確かめています...'
  };

  const UPDATE_CHECK_INTERVAL_MS = 60 * 60 * 1000;

  let updateWaitingWorker = null;
  let installPromptEvent = null;
  let reloadForUpdate = false;
  let currentBannerKind = '';
  let activeRegistration = null;
  let lastUpdateCheckAt = 0;
  let installHintTimer = 0;

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

  function clearInstallHintTimer_() {
    if (!installHintTimer) return;
    window.clearTimeout(installHintTimer);
    installHintTimer = 0;
  }

  function autoHideInstallHint_(kind) {
    clearInstallHintTimer_();
    installHintTimer = window.setTimeout(function() {
      installHintTimer = 0;
      if (currentBannerKind === kind) {
        clearBanner_();
      }
    }, INSTALL_HINT_AUTO_HIDE_MS);
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
    clearInstallHintTimer_();
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
      clearInstallHintTimer_();
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
    autoHideInstallHint_('ios-install');
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
    autoHideInstallHint_('install');
  }

  function showUpdateBanner_(worker) {
    if (!worker) return;
    clearInstallHintTimer_();
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

  function normalizeTheme_(theme) {
    const value = String(theme || '').trim();
    const migrated = LEGACY_THEME_ALIASES[value] || value;
    return THEME_OPTIONS.includes(migrated) ? migrated : THEME_DEFAULT;
  }

  function getStoredTheme_() {
    try {
      const value = window.localStorage ? window.localStorage.getItem(THEME_STORAGE_KEY) : '';
      const nextTheme = normalizeTheme_(value);
      if (window.localStorage && value && value !== nextTheme) {
        window.localStorage.setItem(THEME_STORAGE_KEY, nextTheme);
      }
      return nextTheme;
    } catch (e) {
      return THEME_DEFAULT;
    }
  }

  function applyTheme_(theme) {
    const nextTheme = normalizeTheme_(theme);
    if (document.body) {
      THEME_OPTIONS.forEach(option => {
        document.body.classList.toggle('pwa-theme-' + option, nextTheme === option);
      });
    }

    const themeColor = document.querySelector('meta[name="theme-color"]');
    if (themeColor) {
      themeColor.setAttribute('content', THEME_COLORS[nextTheme] || THEME_COLORS.default);
    }

    document.querySelectorAll('input[name="pwaTheme"]').forEach(input => {
      input.checked = input.value === nextTheme;
    });
  }

  function setTheme_(theme) {
    const nextTheme = normalizeTheme_(theme);
    try {
      if (window.localStorage) {
        window.localStorage.setItem(THEME_STORAGE_KEY, nextTheme);
      }
    } catch (e) {
      // localStorageが使えない環境でも、その場のテーマ切替は反映する。
    }
    applyTheme_(nextTheme);
  }

  function getStoredBoolean_(key, defaultValue) {
    try {
      if (!window.localStorage) return Boolean(defaultValue);
      const value = window.localStorage.getItem(key);
      if (value === null || value === '') return Boolean(defaultValue);
      return value === '1';
    } catch (e) {
      return Boolean(defaultValue);
    }
  }

  function setStoredBoolean_(key, value) {
    try {
      if (window.localStorage) {
        window.localStorage.setItem(key, value ? '1' : '0');
      }
    } catch (e) {
      // localStorageが使えない環境でも、その場の設定は反映する。
    }
  }

  function isLibrarianPresenceEnabled_() {
    return getStoredBoolean_(LIBRARIAN_PRESENCE_STORAGE_KEY, false);
  }

  function isQuietMotionEnabled_() {
    return getStoredBoolean_(QUIET_MOTION_STORAGE_KEY, false);
  }

  function syncLogoForLibrarianPresence_(enabled) {
    const logo = document.getElementById('logoResetBtn');
    if (!logo) return;

    const nextSrc = enabled ? LIBRARIAN_LOGO_SRC : DEFAULT_LOGO_SRC;
    const currentSrc = logo.getAttribute('src') || '';
    if (currentSrc !== nextSrc) {
      logo.setAttribute('src', nextSrc);
    }
    logo.setAttribute('alt', enabled ? '司書のいる趣味部屋図書館' : 'ロゴ');
  }

  function applyPlaySettings_() {
    const librarianPresence = isLibrarianPresenceEnabled_();
    const quietMotion = isQuietMotionEnabled_();
    if (document.body) {
      document.body.classList.toggle('pwa-librarian-presence', librarianPresence);
      document.body.classList.toggle('pwa-quiet-motion', quietMotion);
    }
    syncLogoForLibrarianPresence_(librarianPresence);

    const librarianInput = document.getElementById('pwaLibrarianPresence');
    if (librarianInput) librarianInput.checked = librarianPresence;
    const quietMotionInput = document.getElementById('pwaQuietMotion');
    if (quietMotionInput) quietMotionInput.checked = quietMotion;
  }

  function setLibrarianPresence_(enabled) {
    setStoredBoolean_(LIBRARIAN_PRESENCE_STORAGE_KEY, Boolean(enabled));
    applyPlaySettings_();
    if (typeof renderSearchStatus_ === 'function') {
      renderSearchStatus_();
    }
  }

  function setQuietMotion_(enabled) {
    setStoredBoolean_(QUIET_MOTION_STORAGE_KEY, Boolean(enabled));
    applyPlaySettings_();
  }

  function getLibrarianText_(key, fallback, data) {
    if (!isLibrarianPresenceEnabled_()) return fallback;
    const entry = LIBRARIAN_TEXTS[key];
    if (typeof entry === 'function') {
      return entry(data || {});
    }
    return entry || fallback;
  }

  function moveSensitiveToggleToSettings_() {
    const target = document.getElementById('pwaSensitiveSetting');
    const toggle = document.querySelector('.sensitive-toggle');
    if (!target || !toggle) return;

    const row = document.createElement('div');
    row.className = 'pwa-settings-row';

    const text = document.createElement('div');
    const title = document.createElement('p');
    const note = document.createElement('p');
    title.className = 'pwa-settings-row-title';
    note.className = 'pwa-settings-row-note';
    title.textContent = 'センシティブ';
    note.textContent = '検索結果への表示を切り替えます';
    text.appendChild(title);
    text.appendChild(note);

    row.appendChild(text);
    row.appendChild(toggle);
    target.appendChild(row);
  }

  function setSettingsOpen_(open) {
    const panel = document.getElementById('pwaSettingsPanel');
    const backdrop = document.getElementById('pwaSettingsBackdrop');
    const button = document.getElementById('pwaSettingsButton');
    if (!panel || !backdrop || !button || !document.body) return;

    const isOpen = Boolean(open);
    panel.hidden = !isOpen;
    backdrop.hidden = !isOpen;
    document.body.classList.toggle('pwa-settings-open', isOpen);
    button.setAttribute('aria-expanded', isOpen ? 'true' : 'false');

    if (isOpen) {
      const checkedTheme = panel.querySelector('input[name="pwaTheme"]:checked');
      (checkedTheme || panel).focus({ preventScroll: true });
    } else {
      button.focus({ preventScroll: true });
    }
  }

  function bindSettingsPanel_() {
    const panel = document.getElementById('pwaSettingsPanel');
    const backdrop = document.getElementById('pwaSettingsBackdrop');
    const button = document.getElementById('pwaSettingsButton');
    const closeButton = document.getElementById('pwaSettingsClose');
    if (!panel || !backdrop || !button || !closeButton) return;

    moveSensitiveToggleToSettings_();
    applyTheme_(getStoredTheme_());
    applyPlaySettings_();

    button.addEventListener('click', function() {
      setSettingsOpen_(button.getAttribute('aria-expanded') !== 'true');
    });
    closeButton.addEventListener('click', function() {
      setSettingsOpen_(false);
    });
    backdrop.addEventListener('click', function() {
      setSettingsOpen_(false);
    });
    panel.querySelectorAll('input[name="pwaTheme"]').forEach(input => {
      input.addEventListener('change', function() {
        if (input.checked) setTheme_(input.value);
      });
    });
    const librarianInput = document.getElementById('pwaLibrarianPresence');
    if (librarianInput) {
      librarianInput.addEventListener('change', function() {
        setLibrarianPresence_(librarianInput.checked);
      });
    }
    const quietMotionInput = document.getElementById('pwaQuietMotion');
    if (quietMotionInput) {
      quietMotionInput.addEventListener('change', function() {
        setQuietMotion_(quietMotionInput.checked);
      });
    }
    document.addEventListener('keydown', function(event) {
      if (event.key === 'Escape' && button.getAttribute('aria-expanded') === 'true') {
        setSettingsOpen_(false);
      }
    });
  }

  window.ShumiLibraryPwa = {
    isPwaShell: true,
    isLibrarianPresenceEnabled: isLibrarianPresenceEnabled_,
    isQuietMotionEnabled: isQuietMotionEnabled_,
    getLibrarianText: getLibrarianText_,
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
    bindSettingsPanel_();
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
`.trim();

  fs.writeFileSync(path.join(jsDir, 'pwa-client.js'), `${js}\n`, 'utf8');
}

function writePwaFiles() {
  const manifest = {
    id: './',
    name: '趣味部屋図書館',
    short_name: '図書館',
    description: '蔵書目録を検索し、本棚から読みたい本を見つけるPWA。',
    lang: 'ja',
    dir: 'ltr',
    start_url: './',
    scope: './',
    display: 'standalone',
    display_override: ['standalone', 'browser'],
    background_color: '#0a1217',
    theme_color: '#0a1217',
    orientation: 'portrait',
    categories: ['books', 'education', 'productivity'],
    prefer_related_applications: false,
    shortcuts: [
      {
        name: '検索を開く',
        short_name: '検索',
        description: 'タイトル、読み仮名、作者から蔵書を検索する',
        url: './?launch=search',
        icons: [
          {
            src: './assets/icons/icon-192.png',
            sizes: '192x192',
            type: 'image/png'
          }
        ]
      },
      {
        name: '本棚を見る',
        short_name: '本棚',
        description: '棚マップから所蔵本を眺める',
        url: './?launch=bookshelf',
        icons: [
          {
            src: './assets/icons/icon-192.png',
            sizes: '192x192',
            type: 'image/png'
          }
        ]
      },
      {
        name: 'ランダムに選ぶ',
        short_name: 'ランダム',
        description: '棚から10冊をランダムに表示する',
        url: './?launch=random',
        icons: [
          {
            src: './assets/icons/icon-192.png',
            sizes: '192x192',
            type: 'image/png'
          }
        ]
      }
    ],
    icons: [
      {
        src: './assets/icons/icon-192.png',
        sizes: '192x192',
        type: 'image/png',
        purpose: 'any maskable'
      },
      {
        src: './assets/icons/icon-512.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'any maskable'
      }
    ]
  };

  fs.writeFileSync(
    path.join(docsDir, 'manifest.webmanifest'),
    `${JSON.stringify(manifest, null, 2)}\n`,
    'utf8'
  );

  const offlineHtml = `<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="theme-color" content="#0a1217">
  <meta name="color-scheme" content="dark light">
  <title>オフライン | 趣味部屋図書館</title>
  <link rel="stylesheet" href="./assets/css/pwa.css">
  <style>
    body {
      min-height: 100vh;
      margin: 0;
      display: grid;
      place-items: center;
      padding: 24px;
      background: #0a1217;
      color: #edf5f7;
      font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }
    main {
      width: min(520px, 100%);
    }
    h1 {
      margin: 0 0 12px;
      font-size: clamp(1.5rem, 8vw, 2.25rem);
      letter-spacing: 0;
    }
    p {
      margin: 0 0 18px;
      line-height: 1.75;
    }
    button {
      min-height: 44px;
      padding: 10px 16px;
      border: 0;
      border-radius: 8px;
      background: #68bfd7;
      color: #0a1217;
      font-weight: 700;
    }
  </style>
</head>
<body>
  <main>
    <h1>通信が切れています</h1>
    <p>趣味部屋図書館の検索と本棚データ取得には通信が必要です。回線が戻ったら、もう一度開いてください。</p>
    <button type="button" onclick="location.reload()">再読み込み</button>
  </main>
</body>
</html>
`;

  fs.writeFileSync(path.join(docsDir, 'offline.html'), offlineHtml, 'utf8');

  const appShell = [
  './',
  './index.html',
  './offline.html',
  './manifest.webmanifest',
  './assets/css/style.legacy-core.css',
  './assets/css/style.legacy-modal.css',
  './assets/css/style.shelf.css',
  './assets/css/style.modern-core.css',
  './assets/css/style.modern-modal.css',
  './assets/css/style.modern-shelf.css',
  './assets/css/style.responsive.css',
  './assets/css/pwa.css',
  './assets/logo.png',
  './assets/librarian-presence.jpg',
  './assets/js/gas-run-shim.js',
  './assets/js/pwa-client.js',
  './assets/js/script.state.js',
  './assets/js/script.images.js',
  './assets/js/script.search.js',
  './assets/js/script.render.js',
  './assets/js/script.shelf.js',
  './assets/js/script.modal.js',
  './assets/js/script.boot.js',
  './assets/icons/icon-192.png',
  './assets/icons/icon-512.png'
];
  const cacheName = buildAppShellCacheName_(appShell);
  const appShellSource = appShell.map(entry => `  ${JSON.stringify(entry)}`).join(',\n');

  const sw = `
const CACHE_NAME = ${JSON.stringify(cacheName)};
const APP_SHELL = [
${appShellSource}
];
const NAVIGATION_FALLBACK = './index.html';
const OFFLINE_FALLBACK = './offline.html';
const APP_SHELL_URLS = new Set(APP_SHELL.map(path => new URL(path, self.location.href).href));

function getCacheKey_(url) {
  const copy = new URL(url.href);
  copy.search = '';
  copy.hash = '';
  return copy.href;
}

function isAppShellUrl_(url) {
  return APP_SHELL_URLS.has(getCacheKey_(url));
}

function putCache_(cacheKey, response) {
  if (!response || !response.ok) return response;
  const copy = response.clone();
  caches.open(CACHE_NAME).then(cache => cache.put(cacheKey, copy));
  return response;
}

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(APP_SHELL))
  );
});

self.addEventListener('message', event => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys
        .filter(key => key !== CACHE_NAME)
        .map(key => caches.delete(key))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const request = event.request;
  const url = new URL(request.url);

  if (request.method !== 'GET' || url.origin !== self.location.origin) {
    return;
  }

  if (request.mode === 'navigate') {
    const cacheKey = new URL(NAVIGATION_FALLBACK, self.location.href).href;
    event.respondWith(
      caches.match(cacheKey).then(cached => {
        const refresh = fetch(request)
          .then(response => putCache_(cacheKey, response))
          .catch(() => null);
        return cached || refresh.then(response => response || caches.match(OFFLINE_FALLBACK));
      })
    );
    return;
  }

  if (isAppShellUrl_(url)) {
    const cacheKey = getCacheKey_(url);
    event.respondWith(
      caches.match(cacheKey).then(cached => {
        const refresh = fetch(request)
          .then(response => putCache_(cacheKey, response))
          .catch(() => null);
        return cached || refresh.then(response => response || caches.match(OFFLINE_FALLBACK));
      })
    );
    return;
  }

  event.respondWith(
    fetch(request)
      .then(response => putCache_(getCacheKey_(url), response))
      .catch(() => caches.match(getCacheKey_(url)).then(cached => cached || caches.match(OFFLINE_FALLBACK)))
  );
});
`.trim();

  fs.writeFileSync(path.join(docsDir, 'sw.js'), `${sw}\n`, 'utf8');
}

function getAppShellFilePath_(entry) {
  const relativePath = entry === './' ? 'index.html' : entry.replace(/^\.\//, '');
  return path.join(docsDir, relativePath);
}

function buildAppShellCacheName_(appShell) {
  const hash = crypto.createHash('sha256');

  appShell.forEach(entry => {
    const filePath = getAppShellFilePath_(entry);
    hash.update(entry);
    hash.update('\0');
    hash.update(fs.readFileSync(filePath));
    hash.update('\0');
  });

  return `shumi-library-pwa-${hash.digest('hex').slice(0, 12)}`;
}

function crc32(buffer) {
  const table = crc32.table || (crc32.table = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    return c >>> 0;
  }));

  let crc = 0xffffffff;
  for (let i = 0; i < buffer.length; i++) {
    crc = table[(crc ^ buffer[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const typeBuffer = Buffer.from(type, 'ascii');
  const length = Buffer.alloc(4);
  const crc = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), 0);
  return Buffer.concat([length, typeBuffer, data, crc]);
}

function writePng(filePath, size) {
  const bytesPerPixel = 4;
  const raw = Buffer.alloc((size * bytesPerPixel + 1) * size);

  for (let y = 0; y < size; y++) {
    const rowStart = y * (size * bytesPerPixel + 1);
    raw[rowStart] = 0;

    for (let x = 0; x < size; x++) {
      const offset = rowStart + 1 + x * bytesPerPixel;
      const edge = Math.min(x, y, size - 1 - x, size - 1 - y);
      const inBook = x > size * 0.22 && x < size * 0.78 && y > size * 0.18 && y < size * 0.82;
      const spine = x > size * 0.30 && x < size * 0.40 && y > size * 0.25 && y < size * 0.75;
      const page = x > size * 0.43 && x < size * 0.68 && y > size * 0.28 && y < size * 0.72;
      let r = 47;
      let g = 95;
      let b = 74;

      if (edge < size * 0.08) {
        r = 36; g = 72; b = 58;
      }
      if (inBook) {
        r = 246; g = 238; b = 218;
      }
      if (spine) {
        r = 122; g = 67; b = 52;
      }
      if (page) {
        r = 255; g = 252; b = 241;
      }
      if (page && y > size * 0.46 && y < size * 0.50) {
        r = 47; g = 95; b = 74;
      }

      raw[offset] = r;
      raw[offset + 1] = g;
      raw[offset + 2] = b;
      raw[offset + 3] = 255;
    }
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', zlib.deflateSync(raw)),
    pngChunk('IEND', Buffer.alloc(0))
  ]);

  fs.writeFileSync(filePath, png);
}

function writeIcons() {
  writePng(path.join(iconDir, 'icon-192.png'), 192);
  writePng(path.join(iconDir, 'icon-512.png'), 512);
}

function main() {
  [docsDir, cssDir, jsDir, iconDir].forEach(ensureDir);
  writeStaticAssets();
  writePwaCss();
  writeGasRunShim();
  writePwaClient();
  writeIcons();
  fs.writeFileSync(path.join(docsDir, 'index.html'), buildStaticIndex(), 'utf8');
  writePwaFiles();
  fs.writeFileSync(path.join(docsDir, '.nojekyll'), '', 'utf8');
  console.log('GitHub Pages PWA files generated in docs/');
}

main();
