const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');

const EXPECTED = Object.freeze({
  scriptId: '1q27q49M-wAbHQcIn0766NMm6gGOZiyUj45JG1ZfssaOrKF4sgs5BP5qx',
  deploymentId: 'AKfycbzAfn1SJqfKCRExekRlBMsbo9w4ZwcLNH_W6OJ-1ekS9LUJudAISNhtaGt6kPzAwEWYeQ',
  spreadsheetId: '1lW_U1FPus5LQHGM2ZPukby0Vq8GMdHBHRINgcWyhYH8'
});

const EXPECTED_WEB_APP_URL = `https://script.google.com/macros/s/${EXPECTED.deploymentId}/exec`;

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function readIfExists(relativePath) {
  const filePath = path.join(root, relativePath);
  return fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf8') : '';
}

const clasp = JSON.parse(fs.readFileSync(path.join(root, '.clasp.json'), 'utf8'));
const buildPages = fs.readFileSync(path.join(root, 'tools', 'build-pages.js'), 'utf8');
const shim = readIfExists(path.join('docs', 'assets', 'js', 'gas-run-shim.js'));
const localUrls = readIfExists('LOCAL_URLS.md');
const gitignore = fs.readFileSync(path.join(root, '.gitignore'), 'utf8');

assert(clasp.scriptId === EXPECTED.scriptId, '.clasp.json uses the PWA Apps Script project');
assert(buildPages.includes(EXPECTED_WEB_APP_URL), 'build-pages.js points at the PWA web app deployment');

if (shim) {
  assert(shim.includes(EXPECTED_WEB_APP_URL), 'generated gas-run-shim.js points at the PWA web app deployment');
}

assert(/^LOCAL_URLS\.md$/m.test(gitignore), 'LOCAL_URLS.md remains local-only');

if (localUrls) {
  assert(localUrls.includes(EXPECTED.scriptId), 'LOCAL_URLS.md records the PWA script ID');
  assert(localUrls.includes(EXPECTED.deploymentId), 'LOCAL_URLS.md records the PWA deployment ID');
  assert(localUrls.includes(EXPECTED.spreadsheetId), 'LOCAL_URLS.md records the PWA spreadsheet ID');
}

console.log('project identity checks ok');
