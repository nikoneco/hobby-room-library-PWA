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

const jsAssetNames = new Map();

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

function shortHash(source) {
  return crypto.createHash('sha256').update(String(source || '')).digest('hex').slice(0, 10);
}

function cssOutBaseName(fileName) {
  return fileName.replace(/\.css\.html$/, '.css');
}

function jsOutBaseName(fileName) {
  return fileName.replace(/\.js\.html$/, '.js');
}

function cssOutName(fileName) {
  return cssOutBaseName(fileName);
}

function jsOutName(fileName) {
  return jsAssetNames.get(fileName) || jsOutBaseName(fileName);
}

function buildHashedAssetName(baseName, source) {
  const ext = path.extname(baseName);
  const stem = baseName.slice(0, -ext.length);
  return `${stem}.${shortHash(source)}${ext}`;
}

function prepareStaticAssetNames() {
  jsAssetNames.clear();

  jsFiles.forEach(fileName => {
    const source = stripWrapper(readUtf8(fileName), 'script');
    jsAssetNames.set(fileName, buildHashedAssetName(jsOutBaseName(fileName), source));
  });
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
      '<link rel="apple-touch-icon" href="./assets/icons/apple-touch-icon-lantern-180.png">',
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
      `  <script src="./assets/js/${jsOutName('script.state.js.html')}"></script>`
    ].join('\n')
  );

  source = source.replace(
    /\s*<\?!= HtmlService\.createHtmlOutputFromFile\('([^']+\.js\.html)'\)\.getContent\(\); \?>/g,
    (match, fileName) => `\n  <script src="./assets/js/${jsOutName(fileName)}"></script>`
  );

  source = source.replace(
    /(<body>)/,
    `$1
  <div id="pwaLaunchSplash" class="pwa-launch-splash" aria-hidden="true">
    <div class="pwa-launch-splash-scene">
      <img src="./assets/splash-lantern.jpg" alt="">
    </div>
  </div>
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
    <div class="pwa-settings-section pwa-dev-settings" aria-label="開発">
      <p class="pwa-settings-section-title">開発</p>
      <label class="pwa-settings-row pwa-settings-toggle-row">
        <span>
          <span class="pwa-settings-row-title">性能HUD</span>
          <span class="pwa-settings-row-note">スマホ画面にAPI、描画、操作の計測を表示します</span>
        </span>
        <input id="pwaPerfHudEnabled" type="checkbox">
        <span class="pwa-mini-switch" aria-hidden="true"></span>
      </label>
    </div>
  </section>`
  );

  return source;
}

function writeStaticAssets() {
  cssFiles.forEach(fileName => {
    const source = stripWrapper(readUtf8(fileName), 'style');
    fs.writeFileSync(
      path.join(cssDir, cssOutBaseName(fileName)),
      source,
      'utf8'
    );
    fs.writeFileSync(
      path.join(cssDir, cssOutName(fileName)),
      source,
      'utf8'
    );
  });

  jsFiles.forEach(fileName => {
    const source = stripWrapper(readUtf8(fileName), 'script');
    fs.writeFileSync(
      path.join(jsDir, jsOutBaseName(fileName)),
      source,
      'utf8'
    );
    fs.writeFileSync(
      path.join(jsDir, jsOutName(fileName)),
      source,
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

.pwa-launch-splash {
  position: fixed;
  inset: 0;
  z-index: 13000;
  display: grid;
  place-items: center;
  padding: max(18px, env(safe-area-inset-top)) max(18px, env(safe-area-inset-right)) max(18px, env(safe-area-inset-bottom)) max(18px, env(safe-area-inset-left));
  background:
    radial-gradient(circle at 50% 62%, rgba(214, 164, 95, 0.16), transparent 22%),
    radial-gradient(circle at 50% 44%, rgba(90, 174, 192, 0.10), transparent 34%),
    linear-gradient(180deg, #05090d 0%, #0a1217 52%, #05070a 100%);
  opacity: 0;
  visibility: hidden;
  pointer-events: none;
  transition: opacity 520ms ease, visibility 520ms ease;
}

body.pwa-launch-splash-visible .pwa-launch-splash {
  opacity: 1;
  visibility: visible;
  pointer-events: auto;
}

.pwa-launch-splash::before,
.pwa-launch-splash::after {
  content: "";
  position: absolute;
  inset: 0;
  pointer-events: none;
}

.pwa-launch-splash::before {
  background:
    radial-gradient(circle at 50% 59%, rgba(240, 195, 122, 0.00) 0 8%, rgba(240, 195, 122, 0.22) 18%, transparent 38%),
    radial-gradient(circle at 50% 57%, rgba(255, 226, 154, 0.18), transparent 18%);
  opacity: 0;
  transform: scale(0.82);
}

.pwa-launch-splash::after {
  background:
    linear-gradient(180deg, rgba(255, 255, 255, 0.035), transparent 30%),
    radial-gradient(circle at 50% 18%, rgba(120, 200, 200, 0.07), transparent 32%);
  opacity: 0;
}

.pwa-launch-splash-scene {
  position: relative;
  width: min(82vw, 440px);
  max-height: min(82svh, 660px);
  aspect-ratio: 2 / 3;
  display: grid;
  place-items: center;
  overflow: hidden;
  border-radius: 8px;
  transform: translateY(10px) scale(0.985);
  opacity: 0;
}

.pwa-launch-splash-scene img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  object-position: 50% 56%;
  filter: brightness(0.58) saturate(0.92);
  transform: scale(1.04);
}

.pwa-launch-splash-scene::before {
  content: "";
  position: absolute;
  inset: 0;
  z-index: 1;
  background:
    radial-gradient(circle at 50% 61%, rgba(255, 220, 140, 0.00) 0 9%, rgba(255, 218, 139, 0.34) 18%, transparent 36%),
    radial-gradient(circle at 50% 59%, rgba(240, 195, 122, 0.25), transparent 24%);
  mix-blend-mode: screen;
  opacity: 0;
}

.pwa-launch-splash.is-ready::before {
  animation: pwaLanternGlow 1700ms cubic-bezier(.18,.86,.22,1) forwards;
}

.pwa-launch-splash.is-ready::after {
  animation: pwaLanternAir 1700ms ease forwards;
}

.pwa-launch-splash.is-ready .pwa-launch-splash-scene {
  animation: pwaLanternScene 1700ms cubic-bezier(.18,.86,.22,1) forwards;
}

.pwa-launch-splash.is-ready .pwa-launch-splash-scene img {
  animation: pwaLanternImage 1700ms cubic-bezier(.18,.86,.22,1) forwards;
}

.pwa-launch-splash.is-ready .pwa-launch-splash-scene::before {
  animation: pwaLanternCore 1700ms cubic-bezier(.18,.86,.22,1) forwards;
}

.pwa-launch-splash.is-leaving {
  opacity: 0;
  visibility: hidden;
  pointer-events: none;
}

body.pwa-launch-splash-visible {
  overflow: hidden;
}

@keyframes pwaLanternGlow {
  0% { opacity: 0; transform: scale(0.76); filter: blur(16px); }
  38% { opacity: 0.42; transform: scale(0.92); filter: blur(14px); }
  68% { opacity: 0.88; transform: scale(1.02); filter: blur(10px); }
  100% { opacity: 0.66; transform: scale(1); filter: blur(12px); }
}

@keyframes pwaLanternAir {
  0%, 30% { opacity: 0; }
  100% { opacity: 1; }
}

@keyframes pwaLanternScene {
  0% { opacity: 0; transform: translateY(14px) scale(0.975); }
  34% { opacity: 0.72; }
  100% { opacity: 1; transform: translateY(0) scale(1); }
}

@keyframes pwaLanternImage {
  0% { filter: brightness(0.42) saturate(0.82); transform: scale(1.075); }
  58% { filter: brightness(0.84) saturate(1.04); }
  100% { filter: brightness(0.96) saturate(1.08); transform: scale(1.02); }
}

@keyframes pwaLanternCore {
  0%, 24% { opacity: 0; transform: scale(0.76); }
  62% { opacity: 0.72; transform: scale(1.04); }
  100% { opacity: 0.48; transform: scale(1); }
}

@media (prefers-reduced-motion: reduce) {
  .pwa-launch-splash,
  .pwa-launch-splash::before,
  .pwa-launch-splash::after,
  .pwa-launch-splash-scene,
  .pwa-launch-splash-scene img,
  .pwa-launch-splash-scene::before {
    animation: none;
    transition-duration: 160ms;
  }

  .pwa-launch-splash::before,
  .pwa-launch-splash::after,
  .pwa-launch-splash-scene,
  .pwa-launch-splash-scene::before {
    opacity: 1;
    transform: none;
  }

  .pwa-launch-splash-scene img {
    filter: brightness(0.92) saturate(1.02);
    transform: scale(1.02);
  }
}

.pwa-network-banner {
  position: fixed;
  left: max(12px, env(safe-area-inset-left));
  right: max(12px, env(safe-area-inset-right));
  bottom: max(12px, env(safe-area-inset-bottom));
  z-index: 12000;
  overflow: hidden;
  padding: 12px 14px 12px 17px;
  border: 1px solid color-mix(in srgb, var(--pwa-line) 62%, transparent);
  border-radius: 14px;
  background:
    linear-gradient(90deg, rgba(var(--pwa-warm-rgb), 0.12) 0 5px, transparent 5px),
    linear-gradient(145deg, rgba(var(--pwa-accent-rgb), 0.080), rgba(var(--pwa-warm-rgb), 0.050) 46%, rgba(255, 255, 255, 0.024)),
    color-mix(in srgb, var(--pwa-panel-strong) 92%, transparent);
  color: rgba(237, 245, 247, 0.90);
  box-shadow:
    0 18px 44px rgba(0, 0, 0, 0.34),
    inset 0 1px 0 rgba(255, 255, 255, 0.060);
  font-size: 0.92rem;
  line-height: 1.55;
  backdrop-filter: blur(14px);
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
  border: 1px solid color-mix(in srgb, var(--pwa-line) 62%, transparent);
  border-radius: 999px;
  background:
    linear-gradient(180deg, rgba(255, 255, 255, 0.058), rgba(255, 255, 255, 0.022)),
    color-mix(in srgb, var(--pwa-panel-strong) 72%, transparent);
  color: rgba(234, 241, 248, 0.82);
  box-shadow:
    0 12px 28px rgba(0, 0, 0, 0.26),
    inset 0 1px 0 rgba(255, 255, 255, 0.050);
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
  border-color: color-mix(in srgb, var(--pwa-warm-2) 42%, var(--pwa-line-strong));
  background:
    linear-gradient(180deg, rgba(var(--pwa-warm-rgb), 0.14), rgba(255, 255, 255, 0.028)),
    color-mix(in srgb, var(--pwa-panel-strong) 84%, transparent);
  color: var(--pwa-accent-readable);
}

.pwa-settings-backdrop {
  position: fixed;
  inset: 0;
  z-index: 12100;
  background:
    radial-gradient(circle at 82% 10%, rgba(var(--pwa-warm-rgb), 0.055), transparent 30%),
    color-mix(in srgb, var(--pwa-bg-bottom) 72%, transparent);
  backdrop-filter: blur(7px);
}

.pwa-settings-panel {
  position: fixed;
  top: max(64px, calc(env(safe-area-inset-top) + 58px));
  right: max(12px, env(safe-area-inset-right));
  z-index: 12200;
  width: min(380px, calc(100vw - 24px - env(safe-area-inset-left) - env(safe-area-inset-right)));
  max-height: min(760px, calc(100svh - 84px - env(safe-area-inset-top) - env(safe-area-inset-bottom)));
  padding: 14px;
  overflow-y: auto;
  overscroll-behavior: contain;
  border: 1px solid color-mix(in srgb, var(--pwa-line) 72%, transparent);
  border-radius: 18px;
  background:
    radial-gradient(circle at 0% 0%, rgba(var(--pwa-warm-rgb), 0.10), transparent 35%),
    linear-gradient(180deg, rgba(255, 255, 255, 0.064), rgba(255, 255, 255, 0.024)),
    color-mix(in srgb, var(--pwa-panel-strong) 96%, transparent);
  color: #edf5f7;
  box-shadow:
    0 26px 76px rgba(0, 0, 0, 0.50),
    0 0 0 1px rgba(255, 255, 255, 0.035) inset,
    inset 0 1px 0 rgba(255, 255, 255, 0.070);
  scrollbar-color: rgba(var(--pwa-warm-rgb), 0.46) rgba(255, 255, 255, 0.045);
}

.pwa-settings-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 10px;
  padding: 2px 2px 12px;
  border-bottom: 1px solid color-mix(in srgb, var(--pwa-line) 56%, transparent);
}

.pwa-settings-header h2 {
  margin: 0;
  color: rgba(237, 245, 247, 0.96);
  font-size: 1.02rem;
  font-weight: 900;
  letter-spacing: 0;
}

.pwa-settings-close {
  width: 36px;
  height: 36px;
  border: 1px solid color-mix(in srgb, var(--pwa-line) 58%, transparent);
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.046);
  color: rgba(234, 241, 248, 0.78);
  font-size: 1.35rem;
  line-height: 1;
  cursor: pointer;
}

.pwa-settings-close:hover,
.pwa-settings-close:focus-visible {
  border-color: color-mix(in srgb, var(--pwa-warm-2) 34%, transparent);
  background: rgba(var(--pwa-warm-rgb), 0.090);
  color: rgba(255, 246, 232, 0.94);
}

.pwa-settings-section {
  margin: 10px 0 0;
  padding: 11px;
  border: 1px solid color-mix(in srgb, var(--pwa-line) 50%, transparent);
  border-radius: 13px;
  background:
    linear-gradient(180deg, rgba(255, 255, 255, 0.040), rgba(255, 255, 255, 0.014)),
    rgba(255, 255, 255, 0.020);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.040);
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
  min-width: 0;
  padding: 10px;
  border: 1px solid color-mix(in srgb, var(--pwa-line) 48%, transparent);
  border-radius: 11px;
  background:
    linear-gradient(180deg, rgba(255, 255, 255, 0.040), rgba(255, 255, 255, 0.012)),
    rgba(255, 255, 255, 0.024);
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
  transition: border-color 160ms ease, background 160ms ease, transform 160ms ease;
}

.pwa-settings-toggle-row + .pwa-settings-toggle-row {
  margin-top: 8px;
}

.pwa-settings-toggle-row:hover {
  border-color: color-mix(in srgb, var(--pwa-warm-2) 24%, var(--pwa-line));
  background: rgba(var(--pwa-warm-rgb), 0.050);
}

.pwa-settings-toggle-row:active {
  transform: translateY(1px);
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
  border: 1px solid color-mix(in srgb, var(--pwa-line) 70%, transparent);
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.070);
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
  border-color: color-mix(in srgb, var(--pwa-warm-2) 42%, var(--pwa-line-strong));
  background: rgba(var(--pwa-warm-rgb), 0.16);
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
  grid-template-columns: repeat(2, minmax(0, 1fr));
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
  min-height: 40px;
  padding: 8px 9px;
  border: 1px solid color-mix(in srgb, var(--pwa-line) 58%, transparent);
  border-radius: 11px;
  background:
    linear-gradient(180deg, rgba(255, 255, 255, 0.038), rgba(255, 255, 255, 0.012)),
    rgba(255, 255, 255, 0.024);
  color: rgba(234, 241, 248, 0.78);
  font-size: 0.78rem;
  font-weight: 800;
  cursor: pointer;
  transition: border-color 160ms ease, background 160ms ease, color 160ms ease, transform 160ms ease;
}

.pwa-theme-settings label:active {
  transform: translateY(1px);
}

.pwa-theme-settings input {
  accent-color: var(--pwa-accent);
}

.pwa-perf-hud {
  position: fixed;
  right: max(12px, env(safe-area-inset-right));
  bottom: max(92px, calc(env(safe-area-inset-bottom) + 92px));
  z-index: 11880;
  width: min(330px, calc(100vw - 24px - env(safe-area-inset-left) - env(safe-area-inset-right)));
  max-height: min(52vh, 420px);
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 11px;
  border: 1px solid color-mix(in srgb, var(--pwa-line) 70%, transparent);
  border-radius: 15px;
  background:
    linear-gradient(180deg, rgba(255, 255, 255, 0.065), rgba(255, 255, 255, 0.022)),
    color-mix(in srgb, var(--pwa-panel-strong) 94%, transparent);
  color: rgba(237, 245, 247, 0.92);
  box-shadow:
    0 20px 58px rgba(0, 0, 0, 0.44),
    inset 0 1px 0 rgba(255, 255, 255, 0.070);
  backdrop-filter: blur(16px);
  font-size: 12px;
  line-height: 1.35;
  scrollbar-color: rgba(var(--pwa-warm-rgb), 0.44) rgba(255, 255, 255, 0.040);
}

.pwa-perf-hud[hidden] {
  display: none;
}

.pwa-perf-hud-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding-bottom: 8px;
  border-bottom: 1px solid color-mix(in srgb, var(--pwa-line) 52%, transparent);
}

.pwa-perf-hud-title {
  margin: 0;
  color: rgba(237, 245, 247, 0.95);
  font-size: 0.78rem;
  font-weight: 900;
  letter-spacing: 0;
}

.pwa-perf-hud-actions {
  display: flex;
  gap: 6px;
}

.pwa-perf-hud-actions button {
  min-height: 28px;
  padding: 4px 9px;
  border: 1px solid color-mix(in srgb, var(--pwa-line) 68%, transparent);
  border-radius: 999px;
  background:
    linear-gradient(180deg, rgba(255, 255, 255, 0.070), rgba(255, 255, 255, 0.026)),
    color-mix(in srgb, var(--pwa-panel-soft) 82%, transparent);
  color: rgba(237, 245, 247, 0.86);
  font-size: 0.68rem;
  font-weight: 800;
  cursor: pointer;
  transition: border-color 160ms ease, background 160ms ease, color 160ms ease, transform 160ms ease;
}

.pwa-perf-hud-actions button:hover,
.pwa-perf-hud-actions button:focus-visible {
  border-color: color-mix(in srgb, var(--pwa-warm-2) 38%, var(--pwa-line));
  background:
    linear-gradient(180deg, rgba(var(--pwa-warm-rgb), 0.15), rgba(var(--pwa-accent-rgb), 0.050)),
    color-mix(in srgb, var(--pwa-panel-strong) 88%, transparent);
  color: var(--pwa-accent-readable);
}

.pwa-perf-hud-actions button:active {
  transform: translateY(1px);
}

.pwa-perf-hud-summary {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 7px;
}

.pwa-perf-hud-stat {
  min-width: 0;
  padding: 7px 8px;
  border: 1px solid color-mix(in srgb, var(--pwa-line) 55%, transparent);
  border-radius: 10px;
  background:
    linear-gradient(180deg, rgba(255, 255, 255, 0.052), rgba(255, 255, 255, 0.022)),
    rgba(255, 255, 255, 0.028);
}

.pwa-perf-hud-stat-label {
  display: block;
  color: rgba(220, 232, 238, 0.60);
  font-size: 0.62rem;
  font-weight: 800;
}

.pwa-perf-hud-stat-value {
  display: block;
  margin-top: 2px;
  color: var(--pwa-accent-readable);
  font-size: 0.8rem;
  font-weight: 900;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.pwa-perf-hud-rows {
  display: grid;
  gap: 6px;
  overflow: auto;
  padding-right: 3px;
}

.pwa-perf-hud-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 8px;
  align-items: center;
  min-height: 31px;
  padding: 6px 8px;
  border: 1px solid color-mix(in srgb, var(--pwa-line) 48%, transparent);
  border-radius: 10px;
  background:
    linear-gradient(180deg, rgba(255, 255, 255, 0.044), rgba(255, 255, 255, 0.018)),
    rgba(255, 255, 255, 0.022);
}

.pwa-perf-hud-row.is-slow {
  border-color: rgba(236, 187, 107, 0.54);
  background:
    linear-gradient(180deg, rgba(236, 187, 107, 0.12), rgba(236, 187, 107, 0.048)),
    rgba(255, 255, 255, 0.020);
}

.pwa-perf-hud-name {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: rgba(237, 245, 247, 0.86);
  font-weight: 800;
}

.pwa-perf-hud-time {
  color: var(--pwa-warm-2);
  font-variant-numeric: tabular-nums;
  font-weight: 900;
}

.pwa-perf-hud-note {
  margin: 0;
  color: rgba(220, 232, 238, 0.58);
  font-size: 0.66rem;
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

body.pwa-shell .spinner-panel,
body.pwa-shell .empty-result {
  border-color: color-mix(in srgb, var(--pwa-line) 66%, transparent);
  background:
    radial-gradient(circle at 50% 0%, rgba(var(--pwa-warm-rgb), 0.10), transparent 35%),
    linear-gradient(180deg, rgba(255, 255, 255, 0.052), rgba(255, 255, 255, 0.018)),
    color-mix(in srgb, var(--pwa-panel-strong) 82%, transparent);
}

body.pwa-shell .empty-result::before {
  border-color: color-mix(in srgb, var(--pwa-warm-2) 32%, transparent);
  background:
    radial-gradient(circle at 50% 50%, rgba(var(--pwa-warm-rgb), 0.22) 0 3px, transparent 4px),
    linear-gradient(135deg, transparent 0 55%, rgba(var(--pwa-accent-rgb), 0.22) 55% 61%, transparent 61%),
    rgba(255, 255, 255, 0.034);
  box-shadow:
    0 0 0 6px rgba(var(--pwa-warm-rgb), 0.035),
    inset 0 1px 0 rgba(255, 255, 255, 0.050);
}

body.pwa-shell .empty-result-action {
  border-color: color-mix(in srgb, var(--pwa-line) 54%, transparent);
  background:
    linear-gradient(180deg, rgba(255, 255, 255, 0.058), rgba(255, 255, 255, 0.022)),
    color-mix(in srgb, var(--pwa-panel) 58%, transparent);
}

body.pwa-shell .empty-result-action .ui-icon {
  color: color-mix(in srgb, var(--pwa-warm-2) 84%, white);
}

body.pwa-shell .empty-result-random {
  border-color: color-mix(in srgb, var(--pwa-warm-2) 42%, transparent) !important;
  background:
    linear-gradient(180deg, rgba(var(--pwa-warm-rgb), 0.17), rgba(var(--pwa-warm-rgb), 0.068)),
    color-mix(in srgb, var(--pwa-panel) 58%, transparent) !important;
}

body.pwa-shell .spinner::before {
  background: linear-gradient(90deg, rgba(var(--pwa-accent-rgb), 0.08), rgba(var(--pwa-accent-rgb), 0.92), rgba(var(--pwa-warm-rgb), 0.72));
}

body.pwa-shell .book-card {
  background:
    radial-gradient(circle at 50% 0%, rgba(var(--pwa-accent-rgb), 0.055), transparent 38%),
    linear-gradient(180deg, rgba(255, 255, 255, 0.046), rgba(255, 255, 255, 0.020)),
    color-mix(in srgb, var(--pwa-panel) 76%, transparent);
  border-color: color-mix(in srgb, var(--pwa-line) 58%, transparent);
}

body.pwa-shell .book-card::before {
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.052),
    inset 0 -1px 0 rgba(255, 255, 255, 0.018);
}

body.pwa-shell .book-card:hover {
  border-color: color-mix(in srgb, var(--pwa-warm-2) 34%, transparent);
  background:
    radial-gradient(circle at 50% 0%, rgba(var(--pwa-warm-rgb), 0.070), transparent 40%),
    linear-gradient(180deg, rgba(255, 255, 255, 0.060), rgba(255, 255, 255, 0.028)),
    color-mix(in srgb, var(--pwa-panel-strong) 78%, transparent);
}

body.pwa-shell .book-card.list {
  border-color: color-mix(in srgb, var(--pwa-line) 56%, transparent);
  background:
    linear-gradient(180deg, rgba(255, 255, 255, 0.044), rgba(255, 255, 255, 0.020)),
    color-mix(in srgb, var(--pwa-panel) 76%, transparent);
}

body.pwa-shell .book-card.list::after {
  background: linear-gradient(180deg, rgba(var(--pwa-accent-rgb), 0.44), rgba(var(--pwa-warm-rgb), 0.32));
}

body.pwa-shell .book-card.list:hover,
body.pwa-shell .book-card.list.open {
  border-color: color-mix(in srgb, var(--pwa-warm-2) 32%, var(--pwa-line));
  background:
    linear-gradient(180deg, rgba(255, 255, 255, 0.058), rgba(255, 255, 255, 0.026)),
    color-mix(in srgb, var(--pwa-panel-strong) 78%, transparent);
}

body.pwa-shell .book-card.list.open {
  box-shadow:
    0 16px 36px rgba(0, 0, 0, 0.24),
    inset 0 1px 0 rgba(255, 255, 255, 0.052);
}

body.pwa-shell .book-cover,
body.pwa-shell .list-thumb {
  border-color: rgba(255, 255, 255, 0.075);
}

body.pwa-shell .card-view .book-meta-pill {
  border-color: color-mix(in srgb, var(--pwa-line) 48%, transparent);
  background:
    linear-gradient(180deg, rgba(255, 255, 255, 0.038), rgba(255, 255, 255, 0.014)),
    color-mix(in srgb, var(--pwa-panel) 38%, transparent);
}

body.pwa-shell .card-view .book-meta-pill.location {
  border-color: color-mix(in srgb, var(--pwa-warm-2) 28%, transparent);
  background:
    linear-gradient(180deg, rgba(var(--pwa-warm-rgb), 0.12), rgba(var(--pwa-warm-rgb), 0.040)),
    color-mix(in srgb, var(--pwa-panel) 34%, transparent);
  color: var(--pwa-accent-readable);
}

body.pwa-shell .card-view .genre-chip {
  border-color: color-mix(in srgb, var(--pwa-line) 52%, transparent);
  background:
    linear-gradient(180deg, rgba(var(--pwa-accent-rgb), 0.095), rgba(var(--pwa-accent-rgb), 0.035)),
    color-mix(in srgb, var(--pwa-panel) 30%, transparent);
}

body.pwa-shell .card-view .genre-chip.status {
  border-color: color-mix(in srgb, var(--pwa-warm-2) 26%, transparent);
  background:
    linear-gradient(180deg, rgba(var(--pwa-warm-rgb), 0.13), rgba(var(--pwa-warm-rgb), 0.040)),
    color-mix(in srgb, var(--pwa-panel) 30%, transparent);
}

body.pwa-shell .list-title-author {
  border-color: color-mix(in srgb, var(--pwa-line) 52%, transparent);
  background:
    linear-gradient(180deg, rgba(255, 255, 255, 0.050), rgba(255, 255, 255, 0.018)),
    rgba(255, 255, 255, 0.026);
}

body.pwa-shell .accordion-toggle {
  border-color: color-mix(in srgb, var(--pwa-warm-2) 24%, transparent) !important;
  background:
    linear-gradient(180deg, rgba(255, 255, 255, 0.050), rgba(255, 255, 255, 0.016)),
    color-mix(in srgb, var(--pwa-panel-strong) 62%, transparent) !important;
  color: color-mix(in srgb, var(--pwa-warm-2) 78%, white);
}

body.pwa-shell .accordion-toggle:hover,
body.pwa-shell .accordion-toggle:focus-visible,
body.pwa-shell .accordion-toggle[aria-expanded="true"] {
  border-color: color-mix(in srgb, var(--pwa-accent) 34%, var(--pwa-warm-2)) !important;
  background:
    linear-gradient(180deg, rgba(var(--pwa-accent-rgb), 0.13), rgba(var(--pwa-warm-rgb), 0.050)),
    color-mix(in srgb, var(--pwa-panel-strong) 72%, transparent) !important;
  color: var(--pwa-accent-readable);
}

body.pwa-shell .shelf-view-overview,
body.pwa-shell .bookshelf-group,
body.pwa-shell .shelf-room-map,
body.pwa-shell .shelf-room-map-modal-panel {
  background:
    linear-gradient(180deg, rgba(255, 255, 255, 0.050), rgba(255, 255, 255, 0.024)),
    color-mix(in srgb, var(--pwa-panel) 78%, transparent);
  border-color: color-mix(in srgb, var(--pwa-line) 58%, transparent);
}

body.pwa-shell .bookshelf-group::before {
  background: linear-gradient(90deg, rgba(var(--pwa-warm-rgb), 0.070), transparent 24%);
}

body.pwa-shell .bookshelf-group.is-active,
body.pwa-shell .shelf-jump-chip.is-active,
body.pwa-shell .room-map-shelf.is-active {
  border-color: color-mix(in srgb, var(--pwa-warm-2) 42%, transparent);
}

body.pwa-shell .shelf-book {
  background:
    linear-gradient(180deg, rgba(255, 255, 255, 0.048), rgba(255, 255, 255, 0.022)),
    color-mix(in srgb, var(--pwa-bg-bottom) 38%, transparent);
  border-color: color-mix(in srgb, var(--pwa-line) 46%, transparent);
}

body.pwa-shell .shelf-book-cover-wrap,
body.pwa-shell .shelf-room-map-canvas {
  border-color: rgba(255, 255, 255, 0.064);
}

body.pwa-shell .shelf-room-map-canvas {
  background:
    radial-gradient(circle at 48% 38%, rgba(var(--pwa-warm-rgb), 0.060), transparent 33%),
    linear-gradient(135deg, color-mix(in srgb, var(--pwa-panel-strong) 86%, transparent), color-mix(in srgb, var(--pwa-bg-bottom) 96%, transparent));
}

body.pwa-shell .room-map-fixture,
body.pwa-shell .room-map-outline {
  border-color: color-mix(in srgb, var(--pwa-line) 58%, transparent);
}

body.pwa-shell .room-map-shelf {
  background:
    linear-gradient(180deg, rgba(255, 255, 255, 0.046), rgba(255, 255, 255, 0.018)),
    color-mix(in srgb, var(--pwa-panel-strong) 78%, transparent);
}

body.pwa-shell #image-popup-content {
  background:
    linear-gradient(180deg, rgba(255, 255, 255, 0.056), rgba(255, 255, 255, 0.024)),
    color-mix(in srgb, var(--pwa-panel-strong) 92%, transparent);
  border-color: color-mix(in srgb, var(--pwa-line) 56%, transparent);
  box-shadow:
    0 24px 70px rgba(var(--pwa-shadow-rgb), 0.42),
    inset 0 1px 0 rgba(255, 255, 255, 0.060);
}

body.pwa-shell #image-popup-content::after {
  background: linear-gradient(90deg, rgba(var(--pwa-warm-rgb), 0.060), transparent 22%, rgba(var(--pwa-accent-rgb), 0.034));
}

body.pwa-shell #image-popup-img,
body.pwa-shell #cover-fullscreen-img {
  border-color: rgba(255, 255, 255, 0.078);
  box-shadow:
    0 18px 42px rgba(var(--pwa-shadow-rgb), 0.35),
    0 0 0 1px rgba(var(--pwa-warm-rgb), 0.050) inset;
}

body.pwa-shell #image-popup-close,
body.pwa-shell #cover-fullscreen-close,
body.pwa-shell .popup-arrow,
body.pwa-shell .popup-action-btn,
body.pwa-shell .popup-link-btn {
  border-color: color-mix(in srgb, var(--pwa-line) 52%, transparent);
  background: rgba(255, 255, 255, 0.044);
}

body.pwa-shell #image-popup-close:hover,
body.pwa-shell #cover-fullscreen-close:hover,
body.pwa-shell #cover-fullscreen-close:focus-visible,
body.pwa-shell .popup-arrow:hover,
body.pwa-shell .popup-action-btn:hover,
body.pwa-shell .popup-link-btn:hover,
body.pwa-shell .popup-action-btn:focus-visible,
body.pwa-shell .popup-link-btn:focus-visible {
  border-color: color-mix(in srgb, var(--pwa-warm-2) 34%, transparent);
  background: rgba(var(--pwa-warm-rgb), 0.095);
}

body.pwa-shell .popup-detail-loading,
body.pwa-shell .series-list,
body.pwa-shell .series-empty {
  border-color: color-mix(in srgb, var(--pwa-line) 54%, transparent);
  background:
    linear-gradient(90deg, rgba(var(--pwa-warm-rgb), 0.078) 0 4px, transparent 4px),
    rgba(255, 255, 255, 0.026);
}

body.pwa-shell .popup-detail-loading {
  border-color: color-mix(in srgb, var(--pwa-line) 62%, transparent);
  background:
    linear-gradient(90deg, rgba(var(--pwa-warm-rgb), 0.105) 0 4px, transparent 4px),
    linear-gradient(180deg, rgba(255, 255, 255, 0.046), rgba(255, 255, 255, 0.018)),
    color-mix(in srgb, var(--pwa-panel) 58%, transparent);
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.044),
    0 10px 24px rgba(0, 0, 0, 0.16);
}

body.pwa-shell .series-list-item {
  border-color: color-mix(in srgb, var(--pwa-line) 48%, transparent);
  background:
    linear-gradient(180deg, rgba(255, 255, 255, 0.038), rgba(255, 255, 255, 0.014)),
    color-mix(in srgb, var(--pwa-panel) 54%, transparent);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.032);
}

body.pwa-shell .popup-detail-state,
body.pwa-shell .series-panel-subtitle,
body.pwa-shell .series-list-meta {
  border-color: color-mix(in srgb, var(--pwa-line) 48%, transparent);
  background:
    linear-gradient(180deg, rgba(255, 255, 255, 0.052), rgba(255, 255, 255, 0.018)),
    rgba(var(--pwa-accent-rgb), 0.055);
  color: var(--pwa-accent-readable);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.040);
}

body.pwa-shell .series-list-title::before {
  border-color: color-mix(in srgb, var(--pwa-warm-2) 26%, transparent);
  background:
    linear-gradient(180deg, rgba(var(--pwa-warm-rgb), 0.13), rgba(var(--pwa-warm-rgb), 0.040)),
    color-mix(in srgb, var(--pwa-panel-strong) 54%, transparent);
  color: color-mix(in srgb, var(--pwa-warm-2) 88%, white);
}

body.pwa-shell .popup-detail-state::before {
  background: var(--pwa-warm-2);
  box-shadow: 0 0 0 3px rgba(var(--pwa-warm-rgb), 0.11);
}

body.pwa-shell .popup-detail-state.error::before {
  background: rgba(234, 147, 116, 0.86);
  box-shadow: 0 0 0 3px rgba(234, 147, 116, 0.12);
}

body.pwa-shell .popup-detail-skeleton-line,
body.pwa-shell .popup-detail-skeleton-chip-row span {
  background:
    linear-gradient(180deg, rgba(255, 255, 255, 0.050), rgba(255, 255, 255, 0.020)),
    rgba(255, 255, 255, 0.056);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.030);
}

body.pwa-shell .popup-detail-skeleton-line::after,
body.pwa-shell .popup-detail-skeleton-chip-row span::after {
  background: linear-gradient(90deg, transparent, rgba(var(--pwa-accent-rgb), 0.16), transparent);
}

body.pwa-shell #image-popup-info .genre-chip-wrap.popup {
  border-color: color-mix(in srgb, var(--pwa-line) 48%, transparent);
  background:
    linear-gradient(180deg, rgba(255, 255, 255, 0.038), rgba(255, 255, 255, 0.014)),
    color-mix(in srgb, var(--pwa-panel) 44%, transparent);
}

body.pwa-shell .popup-book-primary-meta:has(.book-meta-pills),
body.pwa-shell .popup-book-primary-meta:has(.book-note) {
  border-color: color-mix(in srgb, var(--pwa-warm-2) 22%, transparent);
  background:
    linear-gradient(180deg, rgba(255, 255, 255, 0.040), rgba(255, 255, 255, 0.014)),
    color-mix(in srgb, var(--pwa-panel) 48%, transparent);
}

body.pwa-shell #image-popup-info .book-meta-pill {
  border-color: color-mix(in srgb, var(--pwa-warm-2) 24%, transparent);
  background:
    linear-gradient(180deg, rgba(255, 255, 255, 0.044), rgba(255, 255, 255, 0.016)),
    rgba(var(--pwa-warm-rgb), 0.050);
}

body.pwa-shell #image-popup-info .book-note {
  border-color: color-mix(in srgb, var(--pwa-line) 44%, transparent);
  background:
    linear-gradient(180deg, rgba(255, 255, 255, 0.035), rgba(255, 255, 255, 0.014)),
    rgba(var(--pwa-accent-rgb), 0.045);
}

body.pwa-shell .popup-position {
  border-color: color-mix(in srgb, var(--pwa-line) 34%, transparent);
  background: rgba(255, 255, 255, 0.026);
}

body.pwa-shell .series-list-item:hover,
body.pwa-shell .series-list-item:focus-visible {
  border-color: color-mix(in srgb, var(--pwa-warm-2) 26%, transparent);
  background:
    linear-gradient(90deg, rgba(var(--pwa-warm-rgb), 0.072), rgba(var(--pwa-accent-rgb), 0.038)),
    rgba(255, 255, 255, 0.032);
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.048),
    0 10px 22px rgba(0, 0, 0, 0.18);
}

body.pwa-shell #image-popup-content {
  border-color: color-mix(in srgb, var(--pwa-line) 58%, var(--pwa-warm-2) 12%);
  background:
    radial-gradient(circle at 0% 0%, rgba(var(--pwa-warm-rgb), 0.10), transparent 30%),
    radial-gradient(circle at 98% 8%, rgba(var(--pwa-accent-rgb), 0.070), transparent 28%),
    linear-gradient(180deg, rgba(255, 255, 255, 0.056), rgba(255, 255, 255, 0.024)),
    color-mix(in srgb, var(--pwa-panel-strong) 92%, transparent);
  box-shadow:
    0 24px 70px rgba(var(--pwa-shadow-rgb), 0.42),
    inset 0 1px 0 rgba(255, 255, 255, 0.060);
}

body.pwa-shell #image-popup-content::after {
  background:
    linear-gradient(90deg, rgba(var(--pwa-warm-rgb), 0.058), transparent 24%, rgba(var(--pwa-accent-rgb), 0.032)),
    linear-gradient(180deg, rgba(255, 255, 255, 0.020), transparent 38%);
}

body.pwa-shell #image-popup-info .popup-summary-text {
  border-color: color-mix(in srgb, var(--pwa-line) 54%, transparent);
  background:
    linear-gradient(180deg, rgba(255, 255, 255, 0.034), rgba(255, 255, 255, 0.012)),
    rgba(4, 9, 14, 0.22);
  color: rgba(232, 242, 246, 0.9);
}

body.pwa-shell #image-popup-info .genre-chip-wrap.popup,
body.pwa-shell #image-popup-info .popup-book-primary-meta:has(.book-meta-pills),
body.pwa-shell #image-popup-info .popup-book-primary-meta:has(.book-note) {
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.034);
}

body.pwa-shell #image-popup-info .genre-chip-wrap.popup {
  border-color: color-mix(in srgb, var(--pwa-line) 46%, transparent);
  background:
    linear-gradient(180deg, rgba(255, 255, 255, 0.034), rgba(255, 255, 255, 0.012)),
    color-mix(in srgb, var(--pwa-panel) 30%, transparent);
}

body.pwa-shell #image-popup-info .popup-book-primary-meta:has(.book-meta-pills),
body.pwa-shell #image-popup-info .popup-book-primary-meta:has(.book-note) {
  border-color: color-mix(in srgb, var(--pwa-warm-2) 20%, transparent);
  background:
    linear-gradient(180deg, rgba(255, 255, 255, 0.040), rgba(255, 255, 255, 0.014)),
    color-mix(in srgb, var(--pwa-panel) 42%, transparent);
}

body.pwa-shell #image-popup-info .popup-book-head {
  border-bottom-color: color-mix(in srgb, var(--pwa-line) 42%, transparent);
}

body.pwa-shell #image-popup-info .popup-action-area {
  border-top-color: color-mix(in srgb, var(--pwa-line) 44%, transparent);
}

body.pwa-shell #image-popup-info .series-list {
  border-color: color-mix(in srgb, var(--pwa-line) 50%, transparent);
  background:
    linear-gradient(90deg, rgba(var(--pwa-warm-rgb), 0.070) 0 4px, transparent 4px),
    linear-gradient(180deg, rgba(255, 255, 255, 0.040), rgba(255, 255, 255, 0.018)),
    color-mix(in srgb, var(--pwa-panel) 34%, transparent);
}

body.pwa-shell #image-popup-info .series-list-item {
  border-color: color-mix(in srgb, var(--pwa-line) 42%, transparent);
  background:
    linear-gradient(180deg, rgba(255, 255, 255, 0.036), rgba(255, 255, 255, 0.014)),
    color-mix(in srgb, var(--pwa-panel) 34%, transparent);
}

body.pwa-shell #image-popup-info .series-list-item:hover,
body.pwa-shell #image-popup-info .series-list-item:focus-visible {
  border-color: color-mix(in srgb, var(--pwa-warm-2) 30%, transparent);
  background:
    linear-gradient(90deg, rgba(var(--pwa-warm-rgb), 0.10), rgba(var(--pwa-accent-rgb), 0.042)),
    rgba(255, 255, 255, 0.034);
}

body.pwa-shell #image-popup-info .series-empty {
  border-color: color-mix(in srgb, var(--pwa-warm-2) 22%, transparent);
  background:
    linear-gradient(90deg, rgba(var(--pwa-warm-rgb), 0.10) 0 4px, transparent 4px),
    linear-gradient(180deg, rgba(255, 255, 255, 0.042), rgba(255, 255, 255, 0.018)),
    color-mix(in srgb, var(--pwa-panel) 36%, transparent);
}

body.pwa-shell .suggest-box {
  border-color: color-mix(in srgb, var(--pwa-line) 58%, transparent);
  border-top-color: color-mix(in srgb, var(--pwa-warm-2) 30%, transparent);
  background:
    radial-gradient(circle at 10% 0%, rgba(var(--pwa-warm-rgb), 0.082), transparent 34%),
    linear-gradient(180deg, rgba(255, 255, 255, 0.054), rgba(255, 255, 255, 0.020)),
    color-mix(in srgb, var(--pwa-panel-strong) 94%, transparent);
}

body.pwa-shell .suggest-item {
  border-color: color-mix(in srgb, var(--pwa-line) 34%, transparent);
  background:
    linear-gradient(180deg, rgba(255, 255, 255, 0.032), rgba(255, 255, 255, 0.012)),
    color-mix(in srgb, var(--pwa-panel) 34%, transparent);
}

body.pwa-shell .suggest-item.active,
body.pwa-shell .suggest-item:hover {
  border-color: color-mix(in srgb, var(--pwa-warm-2) 32%, transparent);
  background:
    linear-gradient(90deg, rgba(var(--pwa-warm-rgb), 0.13), rgba(var(--pwa-accent-rgb), 0.060)),
    rgba(255, 255, 255, 0.044);
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.054),
    0 8px 18px rgba(var(--pwa-shadow-rgb), 0.22);
}

body.pwa-shell .highlight-match {
  background:
    linear-gradient(180deg, rgba(var(--pwa-warm-rgb), 0.24), rgba(var(--pwa-warm-rgb), 0.14)),
    rgba(var(--pwa-warm-rgb), 0.12);
  color: var(--pwa-accent-readable);
}

body.pwa-shell .search-container {
  box-shadow: 0 10px 34px rgba(var(--pwa-shadow-rgb), 0.30);
}

body.pwa-shell .search-container.centered {
  background:
    linear-gradient(90deg, rgba(var(--pwa-warm-rgb), 0.080), transparent 31%, rgba(var(--pwa-accent-rgb), 0.045)),
    linear-gradient(180deg, rgba(6, 10, 14, 0.22), color-mix(in srgb, var(--pwa-panel) 72%, transparent));
  border-color: color-mix(in srgb, var(--pwa-warm-2) 22%, transparent);
  box-shadow: none;
}

body.pwa-shell .search-container.centered::before {
  content: none;
}

body.pwa-shell .search-container.centered #logoResetBtn.logo {
  border-color: color-mix(in srgb, var(--pwa-warm-2) 28%, transparent);
  background:
    linear-gradient(180deg, rgba(255, 255, 255, 0.055), rgba(255, 255, 255, 0.022)),
    rgba(7, 11, 16, 0.54);
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.060),
    0 24px 58px rgba(var(--pwa-shadow-rgb), 0.38);
}

body.pwa-shell .search-container.centered .search-form {
  position: relative;
  isolation: isolate;
  overflow: hidden;
  border-color: color-mix(in srgb, var(--pwa-warm-2) 30%, transparent);
  background:
    linear-gradient(90deg, rgba(var(--pwa-warm-rgb), 0.12) 0 6px, transparent 6px),
    linear-gradient(145deg, rgba(var(--pwa-accent-rgb), 0.10), rgba(var(--pwa-warm-rgb), 0.065) 44%, rgba(255, 255, 255, 0.034)),
    color-mix(in srgb, var(--pwa-panel-strong) 90%, transparent);
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.075),
    inset 7px 0 0 rgba(var(--pwa-warm-rgb), 0.13),
    0 22px 62px rgba(var(--pwa-shadow-rgb), 0.34),
    0 0 0 1px rgba(var(--pwa-accent-rgb), 0.035);
}

body.pwa-shell .search-container.centered .search-form::before {
  content: "";
  position: absolute;
  inset: 0;
  z-index: -1;
  border-radius: inherit;
  background: linear-gradient(135deg, rgba(var(--pwa-accent-2-rgb), 0.08), transparent 38%);
  pointer-events: none;
}

body.pwa-shell .search-container.centered .input-group input {
  background: rgba(4, 9, 13, 0.36);
}

body.pwa-shell .search-status-area {
  border-color: color-mix(in srgb, var(--pwa-line) 68%, transparent);
  background:
    radial-gradient(circle at 0% 0%, rgba(var(--pwa-warm-rgb), 0.075), transparent 34%),
    linear-gradient(180deg, rgba(255, 255, 255, 0.050), rgba(255, 255, 255, 0.020)),
    color-mix(in srgb, var(--pwa-panel-strong) 74%, transparent);
  box-shadow:
    0 10px 24px rgba(var(--pwa-shadow-rgb), 0.16),
    inset 0 1px 0 rgba(255, 255, 255, 0.052);
}

body.pwa-shell .search-status-area::before {
  background: color-mix(in srgb, var(--pwa-warm-2) 62%, var(--pwa-accent));
}

body.pwa-shell .quick-browse-rail,
body.pwa-shell .advanced-search-area {
  border-color: color-mix(in srgb, var(--pwa-line) 66%, transparent);
  background:
    linear-gradient(90deg, rgba(var(--pwa-warm-rgb), 0.10) 0 5px, transparent 5px),
    linear-gradient(145deg, rgba(var(--pwa-accent-rgb), 0.070), rgba(var(--pwa-warm-rgb), 0.042) 44%, rgba(255, 255, 255, 0.026)),
    color-mix(in srgb, var(--pwa-panel-strong) 82%, transparent);
}

body.pwa-shell .advanced-search-area {
  margin-top: 0.52rem;
  padding: 1.05rem;
  border-color: color-mix(in srgb, var(--pwa-line) 70%, transparent);
  border-radius: calc(var(--lib-radius-lg) + 4px);
  background:
    linear-gradient(90deg, rgba(var(--pwa-warm-rgb), 0.085) 0 5px, transparent 5px),
    linear-gradient(145deg, rgba(var(--pwa-accent-rgb), 0.095), rgba(var(--pwa-warm-rgb), 0.046) 44%, rgba(255, 255, 255, 0.030)),
    color-mix(in srgb, var(--pwa-panel-strong) 82%, transparent);
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.060),
    0 18px 44px rgba(var(--pwa-shadow-rgb), 0.20);
}

body.pwa-shell .advanced-grid {
  gap: 0.78rem;
}

body.pwa-shell .quick-browse-rail {
  position: relative;
  isolation: isolate;
  overflow: hidden;
  padding: 0.64rem 0.68rem;
  border-radius: calc(var(--lib-radius-md) + 3px);
  border-color: color-mix(in srgb, var(--pwa-line) 58%, transparent);
  background:
    radial-gradient(circle at 4% 0%, rgba(var(--pwa-warm-rgb), 0.12), transparent 34%),
    linear-gradient(180deg, rgba(255, 255, 255, 0.052), rgba(255, 255, 255, 0.018)),
    color-mix(in srgb, var(--pwa-panel) 62%, transparent);
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.055),
    0 10px 22px rgba(var(--pwa-shadow-rgb), 0.12);
}

body.pwa-shell .search-container.centered .quick-browse-rail::before {
  background: linear-gradient(180deg, rgba(var(--pwa-warm-rgb), 0.44), rgba(var(--pwa-accent-rgb), 0.26));
}

body.pwa-shell .quick-browse-kicker {
  min-height: 32px;
  display: inline-flex;
  align-items: center;
  padding: 0.12rem 0.42rem 0.1rem 0.22rem;
  color: rgba(246, 234, 216, 0.76);
}

body.pwa-shell button.quick-browse-chip {
  max-width: min(100%, 24rem);
  padding: 0.3rem 0.44rem 0.3rem 0.58rem;
  border-color: color-mix(in srgb, var(--pwa-line) 68%, transparent);
  background:
    linear-gradient(180deg, rgba(255, 255, 255, 0.058), rgba(255, 255, 255, 0.024)),
    color-mix(in srgb, var(--pwa-panel-strong) 62%, transparent);
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.045),
    0 7px 15px rgba(var(--pwa-shadow-rgb), 0.12);
}

body.pwa-shell .quick-browse-chip-type {
  white-space: nowrap;
}

body.pwa-shell .quick-browse-chip-value {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

body.pwa-shell .advanced-grid .input-group,
body.pwa-shell .released-range-row {
  border-color: color-mix(in srgb, var(--pwa-line) 58%, transparent);
  border-radius: calc(var(--lib-radius-md) + 1px);
  background:
    linear-gradient(180deg, rgba(255, 255, 255, 0.052), rgba(255, 255, 255, 0.020)),
    rgba(255, 255, 255, 0.026);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.044);
}

body.pwa-shell .advanced-grid .input-group:focus-within,
body.pwa-shell .released-range-row:focus-within {
  border-color: color-mix(in srgb, var(--pwa-accent) 42%, var(--pwa-line));
  background:
    linear-gradient(180deg, rgba(255, 255, 255, 0.060), rgba(255, 255, 255, 0.024)),
    rgba(255, 255, 255, 0.034);
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.054),
    0 12px 26px rgba(0, 0, 0, 0.18);
}

body.pwa-shell .advanced-grid .input-group:focus-within label,
body.pwa-shell .released-range-row:focus-within > label {
  color: color-mix(in srgb, var(--pwa-warm-2) 88%, white);
}

body.pwa-shell .advanced-grid .input-group input,
body.pwa-shell .advanced-grid .input-group select,
body.pwa-shell .released-range-controls select {
  border-color: color-mix(in srgb, var(--pwa-line) 66%, transparent);
  background:
    linear-gradient(180deg, rgba(255, 255, 255, 0.034), rgba(255, 255, 255, 0.012)),
    rgba(4, 9, 13, 0.36);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.036);
}

body.pwa-shell .advanced-grid .input-group label,
body.pwa-shell .released-range-row > label {
  font-weight: 760;
}

body.pwa-shell .advanced-grid .input-group input,
body.pwa-shell .advanced-grid .input-group select,
body.pwa-shell .released-range-controls {
  margin-top: 0.34rem;
}

body.pwa-shell .released-range-controls {
  gap: 0.42rem;
}

body.pwa-shell .advanced-actions {
  margin-top: 1rem;
  padding-top: 0.92rem;
  gap: 0.5rem;
}

body.pwa-shell .released-range-controls select:disabled {
  background:
    linear-gradient(180deg, rgba(255, 255, 255, 0.018), rgba(255, 255, 255, 0.006)),
    rgba(4, 9, 13, 0.24);
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

body.pwa-shell .search-container.centered .button-group {
  padding: 0.34rem;
  border: 1px solid color-mix(in srgb, var(--pwa-line) 54%, transparent);
  border-radius: calc(var(--lib-radius-sm) + 5px);
  background:
    linear-gradient(180deg, rgba(255, 255, 255, 0.050), rgba(255, 255, 255, 0.018)),
    color-mix(in srgb, var(--pwa-panel-strong) 70%, transparent);
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.055),
    0 12px 28px rgba(0, 0, 0, 0.16);
}

body.pwa-shell .button-group button,
body.pwa-shell .advanced-actions button,
body.pwa-shell .bookshelf-cta-card.top-shelf-btn {
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.050),
    0 8px 16px rgba(0, 0, 0, 0.12);
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
    linear-gradient(180deg, rgba(255, 255, 255, 0.11), transparent 48%),
    linear-gradient(180deg, rgba(var(--pwa-accent-2-rgb), 0.26), rgba(var(--pwa-accent-rgb), 0.18)),
    color-mix(in srgb, var(--pwa-panel-strong) 86%, transparent);
  color: var(--pwa-accent-readable);
  box-shadow:
    0 10px 24px rgba(var(--pwa-accent-rgb), 0.08),
    inset 0 1px 0 rgba(255, 255, 255, 0.10);
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
  background:
    linear-gradient(180deg, rgba(255, 255, 255, 0.044), rgba(255, 255, 255, 0.016)),
    color-mix(in srgb, var(--pwa-panel-strong) 78%, transparent);
}

body.pwa-shell .mobile-app-dock {
  border-color: color-mix(in srgb, var(--pwa-line) 62%, transparent);
  border-radius: 20px;
  background:
    radial-gradient(circle at 8% 0%, rgba(var(--pwa-warm-rgb), 0.12), transparent 34%),
    linear-gradient(180deg, rgba(255, 255, 255, 0.074), rgba(255, 255, 255, 0.024)),
    color-mix(in srgb, var(--pwa-panel-strong) 90%, transparent);
  box-shadow:
    0 22px 54px rgba(0, 0, 0, 0.42),
    0 0 0 1px rgba(255, 255, 255, 0.035) inset,
    inset 0 1px 0 rgba(255, 255, 255, 0.082);
}

body.pwa-shell .mobile-app-dock-btn,
body.pwa-shell .mobile-dock-view-btn {
  overflow: hidden;
  border-color: color-mix(in srgb, var(--pwa-line) 58%, transparent);
  background:
    linear-gradient(180deg, rgba(255, 255, 255, 0.046), rgba(255, 255, 255, 0.018)),
    rgba(255, 255, 255, 0.024);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.040);
}

body.pwa-shell .mobile-app-dock-btn:hover,
body.pwa-shell .mobile-dock-view-btn:hover {
  border-color: color-mix(in srgb, var(--pwa-warm-2) 26%, var(--pwa-line));
  background:
    linear-gradient(180deg, rgba(var(--pwa-warm-rgb), 0.10), rgba(var(--pwa-accent-rgb), 0.045)),
    rgba(255, 255, 255, 0.030);
  color: rgba(237, 245, 247, 0.90);
}

body.pwa-shell .button-group button.accent,
body.pwa-shell .top-shelf-btn,
body.pwa-shell .bookshelf-cta-card.top-shelf-btn,
body.pwa-shell .mobile-app-dock-btn.primary,
body.pwa-shell .shelf-jump-chip.is-active,
body.pwa-shell .room-map-shelf.is-active {
  border-color: color-mix(in srgb, var(--pwa-warm-2) 38%, transparent);
  background:
    linear-gradient(135deg, rgba(var(--pwa-warm-rgb), 0.17), rgba(var(--pwa-accent-rgb), 0.064)),
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
body.pwa-shell .quick-browse-chip,
body.pwa-shell .shelf-view-stat,
body.pwa-shell .bookshelf-level-title {
  border-color: color-mix(in srgb, var(--pwa-line) 62%, transparent);
  background:
    linear-gradient(180deg, rgba(255, 255, 255, 0.046), rgba(255, 255, 255, 0.022)),
    rgba(var(--pwa-accent-rgb), 0.045);
  color: var(--pwa-accent-readable);
}

body.pwa-shell .shelf-view-overview {
  position: relative;
  isolation: isolate;
  overflow: hidden;
  border-color: color-mix(in srgb, var(--pwa-line) 64%, var(--pwa-warm-2) 14%);
  background:
    radial-gradient(circle at 2% 0%, rgba(var(--pwa-warm-rgb), 0.10), transparent 32%),
    linear-gradient(135deg, rgba(var(--pwa-accent-rgb), 0.060), rgba(var(--pwa-warm-rgb), 0.042)),
    color-mix(in srgb, var(--pwa-panel) 72%, transparent);
  box-shadow:
    0 14px 34px rgba(var(--pwa-shadow-rgb), 0.14),
    inset 0 1px 0 rgba(255, 255, 255, 0.055);
}

body.pwa-shell .shelf-view-overview::before {
  content: "";
  position: absolute;
  inset: 0 auto 0 0;
  z-index: -1;
  width: 5px;
  border-radius: inherit;
  background: linear-gradient(180deg, rgba(var(--pwa-warm-rgb), 0.72), rgba(var(--pwa-accent-rgb), 0.26));
}

body.pwa-shell .shelf-view .shelf-view-stat {
  border-color: color-mix(in srgb, var(--pwa-line) 60%, transparent);
  background:
    linear-gradient(180deg, rgba(255, 255, 255, 0.040), rgba(255, 255, 255, 0.010)),
    rgba(0, 0, 0, 0.18);
  color: var(--pwa-accent-readable);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.036);
}

body.pwa-shell .shelf-view .shelf-jump-nav {
  border-color: color-mix(in srgb, var(--pwa-line) 62%, transparent);
  background:
    linear-gradient(180deg, rgba(255, 255, 255, 0.060), rgba(255, 255, 255, 0.024)),
    color-mix(in srgb, var(--pwa-panel-strong) 76%, transparent);
  box-shadow:
    0 16px 38px rgba(var(--pwa-shadow-rgb), 0.25),
    inset 0 1px 0 rgba(255, 255, 255, 0.050);
}

body.pwa-shell .shelf-view .shelf-jump-chip,
body.pwa-shell .shelf-view .shelf-jump-top-btn {
  background: rgba(255, 255, 255, 0.038);
}

body.pwa-shell .shelf-view .shelf-jump-chip:hover,
body.pwa-shell .shelf-view .shelf-jump-chip:focus-visible,
body.pwa-shell .shelf-view .shelf-jump-top-btn:hover,
body.pwa-shell .shelf-view .shelf-jump-top-btn:focus-visible {
  border-color: color-mix(in srgb, var(--pwa-warm-2) 36%, transparent);
  background: rgba(var(--pwa-warm-rgb), 0.095);
  color: var(--pwa-accent-readable);
}

body.pwa-shell .shelf-view .bookshelf-group {
  border-color: color-mix(in srgb, var(--pwa-line) 56%, transparent);
  background:
    radial-gradient(circle at 0% 0%, rgba(var(--pwa-warm-rgb), 0.070), transparent 28%),
    linear-gradient(180deg, rgba(255, 255, 255, 0.052), rgba(255, 255, 255, 0.022)),
    color-mix(in srgb, var(--pwa-panel) 62%, transparent);
  box-shadow:
    0 16px 38px rgba(var(--pwa-shadow-rgb), 0.14),
    inset 0 1px 0 rgba(255, 255, 255, 0.046);
}

body.pwa-shell .shelf-view .bookshelf-group::before {
  background: linear-gradient(90deg, rgba(var(--pwa-warm-rgb), 0.055), transparent 24%);
}

body.pwa-shell .shelf-view .bookshelf-group::after {
  content: "";
  position: absolute;
  right: 1rem;
  bottom: 0.92rem;
  left: 1rem;
  height: 1px;
  pointer-events: none;
  background: linear-gradient(90deg, transparent, rgba(255, 255, 255, 0.10), transparent);
}

body.pwa-shell .shelf-view .bookshelf-group.is-active {
  border-color: color-mix(in srgb, var(--pwa-warm-2) 36%, transparent);
  background:
    radial-gradient(circle at 0% 0%, rgba(var(--pwa-warm-rgb), 0.10), transparent 30%),
    linear-gradient(180deg, rgba(var(--pwa-warm-rgb), 0.082), rgba(255, 255, 255, 0.026)),
    color-mix(in srgb, var(--pwa-panel-strong) 68%, transparent);
}

body.pwa-shell .shelf-view .bookshelf-group-title::before {
  background: linear-gradient(180deg, rgba(var(--pwa-warm-rgb), 0.82), rgba(var(--pwa-accent-rgb), 0.30));
}

body.pwa-shell .shelf-view .bookshelf-level {
  border-color: color-mix(in srgb, var(--pwa-line) 48%, transparent);
  background:
    linear-gradient(180deg, rgba(255, 255, 255, 0.030), rgba(255, 255, 255, 0.010)),
    rgba(2, 7, 11, 0.20);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.026);
}

body.pwa-shell .shelf-view .bookshelf-level-title {
  border-color: color-mix(in srgb, var(--pwa-line) 58%, transparent);
  background: rgba(255, 255, 255, 0.036);
  color: var(--lib-muted);
}

body.pwa-shell .shelf-view .bookshelf-strip {
  border-bottom-color: rgba(255, 255, 255, 0.060);
  scrollbar-color: rgba(var(--pwa-warm-rgb), 0.54) rgba(255, 255, 255, 0.045);
}

body.pwa-shell .shelf-view .shelf-book {
  border-color: color-mix(in srgb, var(--pwa-line) 44%, transparent);
  background:
    linear-gradient(180deg, rgba(255, 255, 255, 0.048), rgba(255, 255, 255, 0.022)),
    rgba(5, 8, 12, 0.44);
  color: var(--pwa-text);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.040);
}

body.pwa-shell .shelf-view .shelf-book:hover,
body.pwa-shell .shelf-view .shelf-book:focus-visible {
  border-color: color-mix(in srgb, var(--pwa-warm-2) 34%, transparent);
  background:
    linear-gradient(180deg, rgba(255, 255, 255, 0.060), rgba(255, 255, 255, 0.028)),
    rgba(9, 13, 18, 0.58);
  box-shadow:
    0 14px 30px rgba(var(--pwa-shadow-rgb), 0.26),
    0 0 0 1px rgba(var(--pwa-warm-rgb), 0.060) inset;
}

body.pwa-shell .shelf-view .shelf-book-cover-wrap {
  border-color: rgba(255, 255, 255, 0.060);
  background: rgba(0, 0, 0, 0.28);
  box-shadow:
    0 10px 22px rgba(var(--pwa-shadow-rgb), 0.30),
    inset 0 1px 0 rgba(255, 255, 255, 0.040);
}

body.pwa-shell .summary-chip-toggle,
body.pwa-shell .search-status-chip.shelf,
body.pwa-shell .book-meta-pill.location,
body.pwa-shell .quick-browse-chip-count {
  border-color: color-mix(in srgb, var(--pwa-warm-2) 32%, transparent);
  background: rgba(var(--pwa-warm-rgb), 0.075);
  color: var(--pwa-accent-readable);
}

body.pwa-shell .search-status-chip {
  border-color: color-mix(in srgb, var(--pwa-line) 56%, transparent);
  background:
    linear-gradient(180deg, rgba(255, 255, 255, 0.050), rgba(255, 255, 255, 0.018)),
    color-mix(in srgb, var(--pwa-panel) 64%, transparent);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.036);
}

body.pwa-shell .search-status-chip-key {
  background: rgba(var(--pwa-warm-rgb), 0.12);
  color: color-mix(in srgb, var(--pwa-warm-2) 88%, white);
  box-shadow: inset 0 0 0 1px rgba(var(--pwa-warm-rgb), 0.11);
}

body.pwa-shell .search-status-chip-remove {
  background:
    linear-gradient(180deg, rgba(255, 255, 255, 0.060), rgba(255, 255, 255, 0.020)),
    rgba(255, 255, 255, 0.042);
}

body.pwa-shell .search-status-reroll {
  border-color: color-mix(in srgb, var(--pwa-line-strong) 54%, transparent);
  background:
    linear-gradient(180deg, rgba(var(--pwa-accent-rgb), 0.16), rgba(var(--pwa-accent-rgb), 0.070)),
    rgba(255, 255, 255, 0.018);
}

body.pwa-shell .toggle-btn.active::after,
body.pwa-shell .spinner-shelf span,
body.pwa-shell .bookshelf-group-title::before {
  background: var(--pwa-warm-2);
}

body.pwa-shell .sensitive-toggle-input:checked + .sensitive-toggle-switch,
body.pwa-shell .sensitive-toggle:has(.sensitive-toggle-input:checked) .sensitive-toggle-switch {
  background:
    linear-gradient(180deg, rgba(var(--pwa-accent-2-rgb), 0.30), rgba(var(--pwa-accent-rgb), 0.16)),
    rgba(var(--pwa-accent-rgb), 0.18);
  border-color: var(--pwa-line-strong);
  box-shadow:
    inset 0 1px 4px rgba(0, 0, 0, 0.18),
    0 0 0 1px rgba(var(--pwa-accent-rgb), 0.060);
}

body.pwa-shell .sensitive-toggle,
body.pwa-shell .view-toggle {
  border-color: color-mix(in srgb, var(--pwa-line) 58%, transparent);
  background:
    linear-gradient(180deg, rgba(255, 255, 255, 0.058), rgba(255, 255, 255, 0.022)),
    color-mix(in srgb, var(--pwa-panel-strong) 76%, transparent);
  box-shadow:
    0 12px 28px rgba(0, 0, 0, 0.22),
    inset 0 1px 0 rgba(255, 255, 255, 0.054);
}

body.pwa-shell .toggle-btn.active {
  border-color: color-mix(in srgb, var(--pwa-warm-2) 34%, transparent);
  background:
    linear-gradient(180deg, rgba(var(--pwa-warm-rgb), 0.15), rgba(var(--pwa-accent-rgb), 0.060)),
    rgba(255, 255, 255, 0.030);
  color: var(--pwa-accent-readable);
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
  background:
    linear-gradient(180deg, rgba(255, 255, 255, 0.046), rgba(255, 255, 255, 0.018)),
    color-mix(in srgb, var(--pwa-panel-strong) 78%, transparent);
}

body.pwa-shell .room-map-shelf:hover,
body.pwa-shell .room-map-shelf:focus-visible,
body.pwa-shell .shelf-book:hover,
body.pwa-shell .shelf-book:focus-visible {
  border-color: color-mix(in srgb, var(--pwa-warm-2) 38%, var(--pwa-line-strong));
  box-shadow:
    0 14px 30px rgba(0, 0, 0, 0.26),
    0 0 0 1px rgba(var(--pwa-warm-rgb), 0.070) inset;
}

body.pwa-shell .pwa-theme-settings label:has(input:checked) {
  border-color: color-mix(in srgb, var(--pwa-warm-2) 42%, var(--pwa-line-strong));
  background:
    linear-gradient(180deg, rgba(var(--pwa-warm-rgb), 0.14), rgba(255, 255, 255, 0.024)),
    rgba(var(--pwa-accent-rgb), 0.052);
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
  border-color: rgba(234, 147, 116, 0.34);
  color: rgba(255, 224, 212, 0.92);
  background:
    linear-gradient(90deg, rgba(234, 147, 116, 0.20) 0 5px, transparent 5px),
    linear-gradient(145deg, rgba(234, 147, 116, 0.13), rgba(255, 255, 255, 0.020)),
    color-mix(in srgb, var(--pwa-panel-strong) 92%, transparent);
}

.pwa-network-banner.is-update {
  border-color: color-mix(in srgb, var(--pwa-line-strong) 72%, transparent);
  color: #dff8ff;
  background:
    linear-gradient(90deg, rgba(var(--pwa-accent-rgb), 0.20) 0 5px, transparent 5px),
    linear-gradient(145deg, rgba(var(--pwa-accent-rgb), 0.13), rgba(var(--pwa-warm-rgb), 0.042), rgba(255, 255, 255, 0.022)),
    color-mix(in srgb, var(--pwa-panel-strong) 94%, transparent);
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
  border-color: rgba(var(--pwa-warm-rgb), 0.34);
  color: rgba(255, 241, 214, 0.92);
  background:
    linear-gradient(90deg, rgba(var(--pwa-warm-rgb), 0.20) 0 5px, transparent 5px),
    linear-gradient(145deg, rgba(var(--pwa-warm-rgb), 0.13), rgba(var(--pwa-accent-rgb), 0.044), rgba(255, 255, 255, 0.020)),
    color-mix(in srgb, var(--pwa-panel-strong) 92%, transparent);
}

.pwa-network-banner-action {
  margin-left: 0.75em;
  padding: 0.34em 0.78em;
  border: 1px solid color-mix(in srgb, var(--pwa-warm-2) 36%, transparent);
  border-radius: 999px;
  background:
    linear-gradient(180deg, rgba(var(--pwa-warm-rgb), 0.20), rgba(var(--pwa-accent-rgb), 0.060)),
    color-mix(in srgb, var(--pwa-panel-strong) 84%, transparent);
  color: var(--pwa-accent-readable);
  font: inherit;
  font-weight: 800;
  cursor: pointer;
  transition: border-color 160ms ease, background 160ms ease, color 160ms ease, transform 160ms ease;
}

.pwa-network-banner-action-muted {
  margin-left: 0.45em;
  border-color: color-mix(in srgb, var(--pwa-line) 56%, transparent);
  background: rgba(255, 255, 255, 0.048);
  color: rgba(237, 245, 247, 0.78);
}

.pwa-network-banner-action:hover,
.pwa-network-banner-action:focus-visible {
  border-color: color-mix(in srgb, var(--pwa-warm-2) 56%, transparent);
  background:
    linear-gradient(180deg, rgba(var(--pwa-warm-rgb), 0.26), rgba(var(--pwa-accent-rgb), 0.090)),
    color-mix(in srgb, var(--pwa-panel-strong) 88%, transparent);
  color: #fff6e6;
}

.pwa-network-banner-action-muted:hover,
.pwa-network-banner-action-muted:focus-visible {
  border-color: color-mix(in srgb, var(--pwa-line-strong) 54%, transparent);
  background: rgba(255, 255, 255, 0.078);
  color: rgba(237, 245, 247, 0.92);
}

.pwa-network-banner-action:active {
  transform: translateY(1px);
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

  body.pwa-shell .search-container.centered {
    min-height: calc(100svh - 72px - var(--pwa-safe-top) - env(safe-area-inset-bottom));
    padding-inline: 10px;
  }

  body.pwa-shell .search-container.centered #logoResetBtn.logo {
    width: 116px;
    height: 116px;
    padding: 0.58rem;
    border-radius: var(--lib-radius-lg);
  }

  body.pwa-shell .search-container.centered .search-form {
    width: min(100%, 390px);
    max-width: calc(100vw - 20px);
    padding: 0.86rem;
    border-radius: calc(var(--lib-radius-lg) + 2px);
  }

  body.pwa-shell .search-container.centered .button-group {
    display: grid;
    width: 100%;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 0.55rem;
  }

  body.pwa-shell .search-container.centered #advancedToggleBtn {
    grid-column: 1 / -1;
  }

  body.pwa-shell .search-container.centered .button-group button {
    width: 100%;
  }

  body.pwa-shell .advanced-search-area {
    padding: 0.88rem;
  }

  body.pwa-shell .released-range-controls {
    grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  }

  body.pwa-shell .released-range-separator {
    grid-column: 1 / -1;
    justify-self: center;
    line-height: 1;
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

  function startPerf_(name, meta) {
    if (window.ShumiLibraryPwa && typeof window.ShumiLibraryPwa.perfStart === 'function') {
      return window.ShumiLibraryPwa.perfStart(name, meta);
    }
    return null;
  }

  function endPerf_(token, meta) {
    if (window.ShumiLibraryPwa && typeof window.ShumiLibraryPwa.perfEnd === 'function') {
      window.ShumiLibraryPwa.perfEnd(token, meta);
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

    const perfToken = startPerf_('api:' + config.api, {
      method: methodName,
      api: config.api
    });

    if (navigator && navigator.onLine === false) {
      endPerf_(perfToken, { ok: false, code: 'OFFLINE' });
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
        endPerf_(perfToken, { ok: false, code: errorInfo.code || 'API_ERROR' });
        invokeFailure_(
          failureHandler,
          createError_(errorInfo.message || 'APIからエラーが返りました。', 'API_ERROR', errorInfo)
        );
        return;
      }

      endPerf_(perfToken, {
        ok: true,
        count: Array.isArray(envelope.data) ? envelope.data.length : undefined
      });
      notifySuccess_();
      if (typeof successHandler === 'function') {
        successHandler(envelope.data);
      }
    };

    timeoutId = window.setTimeout(function() {
      if (finished) return;
      finished = true;
      cleanup_();
      endPerf_(perfToken, { ok: false, code: 'TIMEOUT' });
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
      endPerf_(perfToken, { ok: false, code: 'SCRIPT_ERROR' });
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
  const LAUNCH_SPLASH_DURATION_MS = 1850;
  const LAUNCH_SPLASH_DEBUG_DURATION_MS = 6000;
  const THEME_STORAGE_KEY = 'shumiLibrary.pwaTheme.v1';
  const LIBRARIAN_PRESENCE_STORAGE_KEY = 'shumiLibrary.librarianPresence.v1';
  const QUIET_MOTION_STORAGE_KEY = 'shumiLibrary.quietMotion.v1';
  const PERF_HUD_STORAGE_KEY = 'shumiLibrary.perfHudEnabled.v1';
  const PERF_LOG_STORAGE_KEY = 'shumiLibrary.perfLog.v1';
  const PERF_LOG_LIMIT = 20;
  const PERF_SLOW_THRESHOLD_MS = 250;
  const PERF_LONG_TASK_THRESHOLD_MS = 50;
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
    'status.note.random': data => data && Number.isFinite(data.count) ? '今夜の気配で、この' + data.count + '冊を手前に出しました。' : '今夜目が合う本を手前に出しました。',
    'status.note.shelf': data => data && Number.isFinite(data.count) ? '棚位置を確かめたい時は、この' + data.count + '冊の眺めが近道です。' : '棚位置を確かめるなら、この眺めが近道です。',
    'status.note.result': data => data && data.sourceMode === 'advanced' ? '細かい手がかりに合う本だけ、棚の前へ寄せています。' : '見つかった本だけ、棚の前へ寄せています。',
    'notice.keywordRequired': '探す手がかりをひとつください',
    'notice.conditionsRequired': '棚を探す手がかりをひとつください',
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
  let launchSplashTimer = 0;
  let launchSplashReady = false;
  let perfHudEnabled = false;
  let perfHudElement = null;
  let perfLog = null;
  let perfLongTaskObserver = null;

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

  function now_() {
    return window.performance && typeof window.performance.now === 'function'
      ? window.performance.now()
      : Date.now();
  }

  function isPerfHudRequested_() {
    try {
      const params = new URLSearchParams(window.location.search || '');
      return params.has('debugPerf');
    } catch (e) {
      return false;
    }
  }

  function isPerfHudEnabled_() {
    return Boolean(perfHudEnabled || isPerfHudRequested_() || getStoredBoolean_(PERF_HUD_STORAGE_KEY, false));
  }

  function getPerfLog_() {
    if (Array.isArray(perfLog)) return perfLog;
    try {
      const raw = window.localStorage ? window.localStorage.getItem(PERF_LOG_STORAGE_KEY) : '';
      const parsed = raw ? JSON.parse(raw) : [];
      perfLog = Array.isArray(parsed) ? parsed.slice(-PERF_LOG_LIMIT) : [];
    } catch (e) {
      perfLog = [];
    }
    return perfLog;
  }

  function savePerfLog_() {
    try {
      if (window.localStorage) {
        window.localStorage.setItem(PERF_LOG_STORAGE_KEY, JSON.stringify(getPerfLog_().slice(-PERF_LOG_LIMIT)));
      }
    } catch (e) {
      // 計測ログが保存できなくてもHUD表示だけ継続する。
    }
  }

  function formatDuration_(durationMs) {
    const value = Math.max(0, Number(durationMs || 0));
    if (value >= 1000) return (value / 1000).toFixed(2) + 's';
    return Math.round(value) + 'ms';
  }

  function summarizePerfMeta_(entry) {
    const meta = entry && entry.meta && typeof entry.meta === 'object' ? entry.meta : {};
    const parts = [];
    if (meta.api) parts.push('api=' + meta.api);
    if (meta.method) parts.push('method=' + meta.method);
    if (meta.count !== undefined) parts.push('count=' + meta.count);
    if (meta.ok === false) parts.push('fail');
    if (meta.code) parts.push('code=' + meta.code);
    return parts.join(' / ');
  }

  function ensurePerfHud_() {
    if (perfHudElement) return perfHudElement;

    const hud = document.createElement('section');
    hud.id = 'pwaPerfHud';
    hud.className = 'pwa-perf-hud';
    hud.setAttribute('aria-label', '性能HUD');
    hud.hidden = true;

    const header = document.createElement('div');
    header.className = 'pwa-perf-hud-header';

    const title = document.createElement('p');
    title.className = 'pwa-perf-hud-title';
    title.textContent = 'Perf HUD';
    header.appendChild(title);

    const actions = document.createElement('div');
    actions.className = 'pwa-perf-hud-actions';

    const copyButton = document.createElement('button');
    copyButton.id = 'pwaPerfHudCopy';
    copyButton.type = 'button';
    copyButton.textContent = 'コピー';
    actions.appendChild(copyButton);

    const clearButton = document.createElement('button');
    clearButton.id = 'pwaPerfHudClear';
    clearButton.type = 'button';
    clearButton.textContent = '消す';
    actions.appendChild(clearButton);

    header.appendChild(actions);
    hud.appendChild(header);

    const summary = document.createElement('div');
    summary.id = 'pwaPerfHudSummary';
    summary.className = 'pwa-perf-hud-summary';
    hud.appendChild(summary);

    const rows = document.createElement('div');
    rows.id = 'pwaPerfHudRows';
    rows.className = 'pwa-perf-hud-rows';
    hud.appendChild(rows);

    const note = document.createElement('p');
    note.id = 'pwaPerfHudNote';
    note.className = 'pwa-perf-hud-note';
    note.textContent = '直近20件を保存します';
    hud.appendChild(note);

    copyButton.addEventListener('click', copyPerfLog_);
    clearButton.addEventListener('click', function() {
      perfLog = [];
      savePerfLog_();
      renderPerfHud_();
    });

    document.body.appendChild(hud);
    perfHudElement = hud;
    return hud;
  }

  function renderPerfHud_() {
    const enabled = isPerfHudEnabled_();
    if (document.body) {
      document.body.classList.toggle('pwa-perf-hud-visible', enabled);
    }

    const input = document.getElementById('pwaPerfHudEnabled');
    if (input) input.checked = enabled;

    if (!enabled) {
      if (perfHudElement) perfHudElement.hidden = true;
      return;
    }

    const hud = ensurePerfHud_();
    const rowsEl = document.getElementById('pwaPerfHudRows');
    const summaryEl = document.getElementById('pwaPerfHudSummary');
    const entries = getPerfLog_();
    hud.hidden = false;

    if (summaryEl) {
      const latestApi = entries.slice().reverse().find(entry => String(entry.name || '').indexOf('api:') === 0);
      const latestRender = entries.slice().reverse().find(entry => String(entry.name || '').indexOf('render:') === 0 || String(entry.name || '').indexOf('shelf:') === 0);
      const latestPopup = entries.slice().reverse().find(entry => String(entry.name || '').indexOf('popup:') === 0);
      const longTasks = entries.filter(entry => String(entry.name || '') === 'longtask').length;
      const stats = [
        { label: 'API', value: latestApi ? formatDuration_(latestApi.durationMs) : '-' },
        { label: '描画', value: latestRender ? formatDuration_(latestRender.durationMs) : '-' },
        { label: 'モーダル', value: latestPopup ? formatDuration_(latestPopup.durationMs) : '-' },
        { label: 'Long task', value: String(longTasks) }
      ];
      summaryEl.innerHTML = '';
      stats.forEach(function(stat) {
        const item = document.createElement('div');
        item.className = 'pwa-perf-hud-stat';
        item.innerHTML = '<span class="pwa-perf-hud-stat-label"></span><span class="pwa-perf-hud-stat-value"></span>';
        item.querySelector('.pwa-perf-hud-stat-label').textContent = stat.label;
        item.querySelector('.pwa-perf-hud-stat-value').textContent = stat.value;
        summaryEl.appendChild(item);
      });
    }

    if (!rowsEl) return;
    rowsEl.innerHTML = '';
    entries.slice(-8).reverse().forEach(function(entry) {
      const row = document.createElement('div');
      row.className = 'pwa-perf-hud-row';
      if (Number(entry.durationMs || 0) >= PERF_SLOW_THRESHOLD_MS || entry.name === 'longtask') {
        row.classList.add('is-slow');
      }
      const name = document.createElement('div');
      name.className = 'pwa-perf-hud-name';
      const metaText = summarizePerfMeta_(entry);
      name.textContent = metaText ? entry.name + ' / ' + metaText : entry.name;
      const time = document.createElement('div');
      time.className = 'pwa-perf-hud-time';
      time.textContent = formatDuration_(entry.durationMs);
      row.appendChild(name);
      row.appendChild(time);
      rowsEl.appendChild(row);
    });
  }

  function copyPerfLog_() {
    const payload = {
      generatedAt: new Date().toISOString(),
      url: window.location.href,
      userAgent: navigator.userAgent,
      entries: getPerfLog_()
    };
    const text = JSON.stringify(payload, null, 2);
    const done = function(ok) {
      const note = document.getElementById('pwaPerfHudNote');
      if (note) note.textContent = ok ? 'コピーしました' : 'コピーできませんでした';
    };

    if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
      navigator.clipboard.writeText(text).then(function() {
        done(true);
      }).catch(function() {
        done(false);
      });
      return;
    }

    try {
      const textarea = document.createElement('textarea');
      textarea.value = text;
      textarea.setAttribute('readonly', 'readonly');
      textarea.style.position = 'fixed';
      textarea.style.opacity = '0';
      document.body.appendChild(textarea);
      textarea.select();
      const ok = document.execCommand('copy');
      textarea.remove();
      done(ok);
    } catch (e) {
      done(false);
    }
  }

  function recordPerf_(name, durationMs, meta) {
    if (!isPerfHudEnabled_()) return null;
    const entry = {
      name: String(name || 'measure'),
      durationMs: Math.max(0, Math.round(Number(durationMs || 0))),
      at: new Date().toISOString(),
      meta: meta && typeof meta === 'object' ? meta : {}
    };
    const log = getPerfLog_();
    log.push(entry);
    while (log.length > PERF_LOG_LIMIT) log.shift();
    savePerfLog_();
    renderPerfHud_();
    if (window.console && typeof window.console.debug === 'function') {
      window.console.debug('[perf]', entry);
    }
    return entry;
  }

  function startPerf_(name, meta) {
    if (!isPerfHudEnabled_()) return null;
    return {
      name: String(name || 'measure'),
      startedAt: now_(),
      meta: meta && typeof meta === 'object' ? meta : {}
    };
  }

  function endPerf_(token, meta) {
    if (!token) return null;
    const mergedMeta = Object.assign({}, token.meta || {}, meta || {});
    return recordPerf_(token.name, now_() - Number(token.startedAt || now_()), mergedMeta);
  }

  function observeLongTasks_() {
    if (perfLongTaskObserver || !isPerfHudEnabled_()) return;
    if (!('PerformanceObserver' in window)) return;
    try {
      perfLongTaskObserver = new PerformanceObserver(function(list) {
        list.getEntries().forEach(function(entry) {
          if (Number(entry.duration || 0) >= PERF_LONG_TASK_THRESHOLD_MS) {
            recordPerf_('longtask', entry.duration, {});
          }
        });
      });
      perfLongTaskObserver.observe({ entryTypes: ['longtask'] });
    } catch (e) {
      perfLongTaskObserver = null;
    }
  }

  function setPerfHudEnabled_(enabled) {
    perfHudEnabled = Boolean(enabled);
    setStoredBoolean_(PERF_HUD_STORAGE_KEY, perfHudEnabled);
    if (perfHudEnabled) observeLongTasks_();
    renderPerfHud_();
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
    const perfInput = document.getElementById('pwaPerfHudEnabled');
    if (perfInput) {
      perfInput.addEventListener('change', function() {
        setPerfHudEnabled_(perfInput.checked);
      });
    }
    perfHudEnabled = isPerfHudEnabled_();
    if (perfHudEnabled) observeLongTasks_();
    renderPerfHud_();
    document.addEventListener('keydown', function(event) {
      if (event.key === 'Escape' && button.getAttribute('aria-expanded') === 'true') {
        setSettingsOpen_(false);
      }
    });
  }

  function finishLaunchSplash_() {
    const splash = document.getElementById('pwaLaunchSplash');
    if (!splash) return;

    splash.classList.add('is-leaving');
    if (document.body) {
      document.body.classList.remove('pwa-launch-splash-visible');
    }
    window.setTimeout(function() {
      if (splash.parentNode) {
        splash.parentNode.removeChild(splash);
      }
    }, 560);
  }

  function getLaunchSplashDuration_() {
    try {
      const params = new URLSearchParams(window.location.search || '');
      return params.has('debugLaunchSplash') ? LAUNCH_SPLASH_DEBUG_DURATION_MS : LAUNCH_SPLASH_DURATION_MS;
    } catch (e) {
      return LAUNCH_SPLASH_DURATION_MS;
    }
  }

  function isLaunchSplashDebug_() {
    try {
      const params = new URLSearchParams(window.location.search || '');
      return params.has('debugLaunchSplash');
    } catch (e) {
      return false;
    }
  }

  function shouldShowLaunchSplash_() {
    return isStandalone_() || isLaunchSplashDebug_();
  }

  function removeLaunchSplashImmediately_() {
    const splash = document.getElementById('pwaLaunchSplash');
    if (!splash) return;
    if (document.body) {
      document.body.classList.remove('pwa-launch-splash-visible');
    }
    if (splash.parentNode) {
      splash.parentNode.removeChild(splash);
    }
  }

  function startLaunchSplash_() {
    const splash = document.getElementById('pwaLaunchSplash');
    if (!splash || !document.body) return;

    if (!shouldShowLaunchSplash_()) {
      removeLaunchSplashImmediately_();
      return;
    }

    document.body.classList.add('pwa-launch-splash-visible');

    function markReady() {
      if (launchSplashReady) return;
      launchSplashReady = true;
      splash.classList.add('is-ready');
      launchSplashTimer = window.setTimeout(function() {
        launchSplashTimer = 0;
        finishLaunchSplash_();
      }, getLaunchSplashDuration_());
    }

    const image = splash.querySelector('img');
    if (!image || image.complete) {
      window.setTimeout(markReady, 40);
      return;
    }

    image.addEventListener('load', markReady, { once: true });
    image.addEventListener('error', markReady, { once: true });
    window.setTimeout(markReady, 1200);
  }

  window.ShumiLibraryPwa = {
    isPwaShell: true,
    isLibrarianPresenceEnabled: isLibrarianPresenceEnabled_,
    isQuietMotionEnabled: isQuietMotionEnabled_,
    getLibrarianText: getLibrarianText_,
    perfStart: startPerf_,
    perfEnd: endPerf_,
    recordPerf: recordPerf_,
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
    startLaunchSplash_();
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
            src: './assets/icons/icon-lantern-192.png',
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
            src: './assets/icons/icon-lantern-192.png',
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
            src: './assets/icons/icon-lantern-192.png',
            sizes: '192x192',
            type: 'image/png'
          }
        ]
      }
    ],
    icons: [
      {
        src: './assets/icons/icon-lantern-192.png',
        sizes: '192x192',
        type: 'image/png',
        purpose: 'any maskable'
      },
      {
        src: './assets/icons/icon-lantern-512.png',
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
    :root {
      --offline-bg: #0a1217;
      --offline-panel: rgba(13, 22, 29, 0.88);
      --offline-line: rgba(116, 198, 204, 0.22);
      --offline-warm: #f0c37a;
      --offline-accent: #68bfd7;
      --offline-text: #edf5f7;
      --offline-muted: rgba(220, 232, 238, 0.68);
    }

    * {
      box-sizing: border-box;
    }

    body {
      min-height: 100vh;
      margin: 0;
      display: grid;
      place-items: center;
      padding: clamp(20px, 5vw, 44px);
      background:
        radial-gradient(circle at 24% 16%, rgba(240, 195, 122, 0.10), transparent 34%),
        radial-gradient(circle at 78% 20%, rgba(104, 191, 215, 0.10), transparent 36%),
        linear-gradient(180deg, #10171e 0%, var(--offline-bg) 52%, #05070a 100%);
      color: var(--offline-text);
      font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }

    main {
      position: relative;
      isolation: isolate;
      overflow: hidden;
      width: min(560px, 100%);
      padding: clamp(1.35rem, 4vw, 1.9rem);
      border: 1px solid var(--offline-line);
      border-radius: 18px;
      background:
        linear-gradient(90deg, rgba(240, 195, 122, 0.12) 0 5px, transparent 5px),
        linear-gradient(145deg, rgba(104, 191, 215, 0.080), rgba(240, 195, 122, 0.045) 46%, rgba(255, 255, 255, 0.026)),
        var(--offline-panel);
      box-shadow:
        0 24px 70px rgba(0, 0, 0, 0.38),
        inset 0 1px 0 rgba(255, 255, 255, 0.060);
    }

    main::before {
      content: "";
      display: block;
      width: 92px;
      height: 38px;
      margin: 0 0 1rem;
      border-bottom: 2px solid rgba(240, 195, 122, 0.34);
      background:
        linear-gradient(90deg, rgba(104, 191, 215, 0.78) 0 10px, transparent 10px 14px),
        linear-gradient(90deg, transparent 14px, rgba(240, 195, 122, 0.74) 14px 28px, transparent 28px 32px),
        linear-gradient(90deg, transparent 32px, rgba(105, 198, 163, 0.68) 32px 44px, transparent 44px 48px),
        linear-gradient(90deg, transparent 48px, rgba(104, 191, 215, 0.60) 48px 62px, transparent 62px 66px),
        linear-gradient(90deg, transparent 66px, rgba(214, 164, 95, 0.62) 66px 84px, transparent 84px);
      background-position: center bottom;
      background-repeat: no-repeat;
      background-size: 100% 82%;
      opacity: 0.86;
    }

    main::after {
      content: "";
      position: absolute;
      inset: 0;
      z-index: -1;
      background:
        radial-gradient(circle at 18% 0%, rgba(240, 195, 122, 0.12), transparent 34%),
        radial-gradient(circle at 86% 8%, rgba(104, 191, 215, 0.10), transparent 36%);
      pointer-events: none;
    }

    h1 {
      margin: 0 0 12px;
      font-size: clamp(1.5rem, 8vw, 2.25rem);
      line-height: 1.22;
      letter-spacing: 0;
    }

    p {
      margin: 0 0 18px;
      color: var(--offline-muted);
      line-height: 1.75;
    }

    button {
      min-height: 44px;
      padding: 10px 18px;
      border: 1px solid rgba(240, 195, 122, 0.36);
      border-radius: 999px;
      background:
        linear-gradient(180deg, rgba(240, 195, 122, 0.18), rgba(104, 191, 215, 0.070)),
        rgba(255, 255, 255, 0.040);
      color: #fff1d8;
      font: inherit;
      font-weight: 800;
      cursor: pointer;
    }

    button:hover,
    button:focus-visible {
      border-color: rgba(240, 195, 122, 0.62);
      background:
        linear-gradient(180deg, rgba(240, 195, 122, 0.24), rgba(104, 191, 215, 0.085)),
        rgba(255, 255, 255, 0.052);
      outline: none;
    }

    button:focus-visible {
      box-shadow: 0 0 0 3px rgba(104, 191, 215, 0.18);
    }

    @media (max-width: 520px) {
      main {
        border-radius: 16px;
      }

      button {
        width: 100%;
      }
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
  './assets/splash-lantern.jpg',
  './assets/js/gas-run-shim.js',
  './assets/js/pwa-client.js',
  ...jsFiles.map(fileName => './assets/js/' + jsOutName(fileName)),
  './assets/icons/icon-lantern-192.png',
  './assets/icons/icon-lantern-512.png',
  './assets/icons/apple-touch-icon-lantern-180.png'
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

function readPng(filePath) {
  const source = fs.readFileSync(filePath);
  const signature = source.subarray(0, 8);
  const pngSignature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (!signature.equals(pngSignature)) {
    throw new Error(`${filePath} is not a PNG`);
  }

  let offset = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  const idat = [];

  while (offset < source.length) {
    const length = source.readUInt32BE(offset);
    const type = source.subarray(offset + 4, offset + 8).toString('ascii');
    const data = source.subarray(offset + 8, offset + 8 + length);
    offset += 12 + length;

    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8];
      colorType = data[9];
      const compression = data[10];
      const filter = data[11];
      const interlace = data[12];
      if (bitDepth !== 8 || ![2, 6].includes(colorType) || compression !== 0 || filter !== 0 || interlace !== 0) {
        throw new Error(`${filePath} must be a non-interlaced 8-bit RGB/RGBA PNG`);
      }
    } else if (type === 'IDAT') {
      idat.push(data);
    } else if (type === 'IEND') {
      break;
    }
  }

  const sourceBytesPerPixel = colorType === 6 ? 4 : 3;
  const bytesPerPixel = 4;
  const scanlineLength = width * sourceBytesPerPixel;
  const inflated = zlib.inflateSync(Buffer.concat(idat));
  const sourcePixels = Buffer.alloc(width * height * sourceBytesPerPixel);
  const pixels = Buffer.alloc(width * height * bytesPerPixel);
  let readOffset = 0;

  for (let y = 0; y < height; y++) {
    const filterType = inflated[readOffset++];
    const row = inflated.subarray(readOffset, readOffset + scanlineLength);
    readOffset += scanlineLength;
    const outRowStart = y * scanlineLength;
    const prevRowStart = y > 0 ? (y - 1) * scanlineLength : -1;

    for (let x = 0; x < scanlineLength; x++) {
      const left = x >= sourceBytesPerPixel ? sourcePixels[outRowStart + x - sourceBytesPerPixel] : 0;
      const up = prevRowStart >= 0 ? sourcePixels[prevRowStart + x] : 0;
      const upLeft = prevRowStart >= 0 && x >= sourceBytesPerPixel ? sourcePixels[prevRowStart + x - sourceBytesPerPixel] : 0;
      let value = row[x];

      if (filterType === 1) {
        value = (value + left) & 0xff;
      } else if (filterType === 2) {
        value = (value + up) & 0xff;
      } else if (filterType === 3) {
        value = (value + Math.floor((left + up) / 2)) & 0xff;
      } else if (filterType === 4) {
        const p = left + up - upLeft;
        const pa = Math.abs(p - left);
        const pb = Math.abs(p - up);
        const pc = Math.abs(p - upLeft);
        const predictor = pa <= pb && pa <= pc ? left : (pb <= pc ? up : upLeft);
        value = (value + predictor) & 0xff;
      } else if (filterType !== 0) {
        throw new Error(`Unsupported PNG filter ${filterType}`);
      }

      sourcePixels[outRowStart + x] = value;
    }
  }

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const sourceOffset = (y * width + x) * sourceBytesPerPixel;
      const outOffset = (y * width + x) * bytesPerPixel;
      pixels[outOffset] = sourcePixels[sourceOffset];
      pixels[outOffset + 1] = sourcePixels[sourceOffset + 1];
      pixels[outOffset + 2] = sourcePixels[sourceOffset + 2];
      pixels[outOffset + 3] = colorType === 6 ? sourcePixels[sourceOffset + 3] : 255;
    }
  }

  return { width, height, pixels };
}

function writeRgbaPng(filePath, width, height, pixels) {
  const bytesPerPixel = 4;
  const raw = Buffer.alloc((width * bytesPerPixel + 1) * height);

  for (let y = 0; y < height; y++) {
    const rawRowStart = y * (width * bytesPerPixel + 1);
    const pixelRowStart = y * width * bytesPerPixel;
    raw[rawRowStart] = 0;
    pixels.copy(raw, rawRowStart + 1, pixelRowStart, pixelRowStart + width * bytesPerPixel);
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
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
  const source = readPng(path.join(docsDir, 'assets', 'splash-lantern.png'));
  writeLanternIcon(source, path.join(iconDir, 'icon-lantern-192.png'), 192);
  writeLanternIcon(source, path.join(iconDir, 'icon-lantern-512.png'), 512);
  writeLanternIcon(source, path.join(iconDir, 'apple-touch-icon-lantern-180.png'), 180);
}

function writeLanternIcon(source, filePath, size) {
  const bytesPerPixel = 4;
  const out = Buffer.alloc(size * size * bytesPerPixel);
  const cropSize = Math.min(source.width, source.height);
  const cropX = Math.floor((source.width - cropSize) / 2);
  const cropY = Math.floor((source.height - cropSize) * 0.52);

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const srcX = Math.min(source.width - 1, Math.max(0, Math.floor(cropX + (x + 0.5) * cropSize / size)));
      const srcY = Math.min(source.height - 1, Math.max(0, Math.floor(cropY + (y + 0.5) * cropSize / size)));
      const srcOffset = (srcY * source.width + srcX) * bytesPerPixel;
      const outOffset = (y * size + x) * bytesPerPixel;
      out[outOffset] = source.pixels[srcOffset];
      out[outOffset + 1] = source.pixels[srcOffset + 1];
      out[outOffset + 2] = source.pixels[srcOffset + 2];
      out[outOffset + 3] = 255;
    }
  }

  writeRgbaPng(filePath, size, size, out);
}

function main() {
  [docsDir, cssDir, jsDir, iconDir].forEach(ensureDir);
  prepareStaticAssetNames();
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
