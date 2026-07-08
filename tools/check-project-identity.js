const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const root = path.resolve(__dirname, '..');
const GAS_WEB_APP_URL_PATTERN = /^https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]+\/exec$/;
const EXPECTED_WEB_APP_URL = 'https://script.google.com/macros/s/AKfycbzAfn1SJqfKCRExekRlBMsbo9w4ZwcLNH_W6OJ-1ekS9LUJudAISNhtaGt6kPzAwEWYeQ/exec';
const PUBLIC_FORBIDDEN_PATTERNS = [
  { pattern: /docs\.google\.com\/spreadsheets/i, label: 'Google Spreadsheet URL' },
  { pattern: /spreadsheets\/d\//i, label: 'Google Spreadsheet URL path' },
  { pattern: /SpreadsheetApp\.openById/i, label: 'Spreadsheet ID access by literal ID' },
  { pattern: /openByUrl/i, label: 'Spreadsheet URL access' },
  { pattern: /"scriptId"\s*:/i, label: 'Apps Script scriptId JSON field' }
];

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function readIfExists(relativePath) {
  const filePath = path.join(root, relativePath);
  return fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf8') : '';
}

function getTrackedFiles() {
  return execFileSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8' })
    .split('\0')
    .map(line => line.trim())
    .filter(Boolean);
}

function isTextFile(filePath) {
  return !/\.(png|jpe?g|gif|webp|ico|woff2?|ttf|otf)$/i.test(filePath);
}

assert(GAS_WEB_APP_URL_PATTERN.test(EXPECTED_WEB_APP_URL), 'PWA web app URL has the expected GAS /exec shape');

const buildPages = fs.readFileSync(path.join(root, 'tools', 'build-pages.js'), 'utf8');
const shim = readIfExists(path.join('docs', 'assets', 'js', 'gas-run-shim.js'));
const gitignore = fs.readFileSync(path.join(root, '.gitignore'), 'utf8');
const trackedFiles = getTrackedFiles();

assert(buildPages.includes(EXPECTED_WEB_APP_URL), 'build-pages.js points at the PWA web app deployment');

if (shim) {
  assert(shim.includes(EXPECTED_WEB_APP_URL), 'generated gas-run-shim.js points at the PWA web app deployment');
}

[
  '.clasp.json',
  '.clasprc.json',
  'LOCAL_URLS.md',
  '.env',
  '.env.*',
  '*.local',
  'secrets.*'
].forEach(entry => {
  const escaped = entry.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\\\*/g, '.*');
  assert(new RegExp(`^${escaped}$`, 'm').test(gitignore), `${entry} remains local-only`);
});

[
  '.clasp.json',
  '.clasprc.json',
  'LOCAL_URLS.md'
].forEach(file => {
  assert(!trackedFiles.includes(file), `${file} is not tracked`);
});

trackedFiles
  .filter(isTextFile)
  .filter(file => file !== 'tools/check-project-identity.js')
  .filter(file => fs.existsSync(path.join(root, file)))
  .forEach(file => {
    const text = fs.readFileSync(path.join(root, file), 'utf8');
    PUBLIC_FORBIDDEN_PATTERNS.forEach(({ pattern, label }) => {
      assert(!pattern.test(text), `${label} remains in tracked file: ${file}`);
    });
  });

console.log('project identity checks ok');
