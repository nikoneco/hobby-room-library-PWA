const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
let now = 1000, searches = 0;
const timers = [];
const nodes = new Map();
let document;
class Element extends EventTarget {
  constructor(id, tagName = 'INPUT') { super(); this.id = id; this.tagName = tagName; this.value = ''; this.dataset = {}; this.style = { display: 'none' }; this.attributes = new Map(); this.hidden = true; this.classList = { add() {}, remove() {} }; }
  focus() { document.activeElement = this; this.dispatchEvent(new Event('focus')); }
  setAttribute(k, v) { this.attributes.set(k, v); }
  removeAttribute(k) { this.attributes.delete(k); }
  getAttribute(k) { return this.attributes.get(k); }
  querySelectorAll() { return []; }
}
const ids = ['keyword', 'detailTitle', 'detailYomi', 'detailAuthor'];
const buttons = ids.map(id => { nodes.set(id, new Element(id)); const b = new Element(id + '-clear', 'BUTTON'); nodes.set(b.id, b); return b; });
for (const id of ['keyword-suggest', 'detailTitle-suggest', 'detailMedia']) nodes.set(id, new Element(id, 'DIV'));
const form = new Element('librarySearchForm', 'FORM'); nodes.set(form.id, form);
const submitButtons = [new Element('main-submit', 'BUTTON'), new Element('advanced-submit', 'BUTTON')];
submitButtons.forEach(button => { button.type = 'submit'; button.form = form; button.dataset.action = 'search'; });
form.querySelectorAll = () => submitButtons;
form.requestSubmit = () => form.dispatchEvent(new Event('submit', { cancelable: true }));
document = {
  activeElement: nodes.get('keyword'), addEventListener() {}, getElementById: id => nodes.get(id),
  querySelector: selector => { const m = selector.match(/data-clear-search-input="([^"]+)"/); return m ? nodes.get(m[1] + '-clear') : null; },
  querySelectorAll: selector => selector === '[data-action]' ? submitButtons : []
};
const c = vm.createContext({ document, window: {}, Event, Date: { now: () => now }, console, setTimeout: fn => timers.push(fn) });
const source = fs.readFileSync(path.join(root, 'script.search.js.html'), 'utf8').replace(/^\s*<script>\s*/, '').replace(/\s*<\/script>\s*$/, '');
vm.runInContext(source, c);
c.search = () => { searches++; };
c.hideAllSuggest = () => ['keyword-suggest', 'detailTitle-suggest'].forEach(id => { nodes.get(id).style.display = 'none'; });
c.syncSearchStatusPreviewFromForm_ = c.syncSearchInputClearButtons_;
c.STATIC_ACTION_HANDLERS = { search: c.search };
const images = fs.readFileSync(path.join(root, 'script.images.js.html'), 'utf8');
const binder = images.indexOf('function bindStaticActionHandlers_(');
vm.runInContext(images.slice(binder, images.indexOf('\nfunction ', binder + 1)), c);
c.bindStaticActionHandlers_();
c.bindSearchInputControls_();
c.addSuggestKeyHandler('keyword', 'keyword-suggest', 'keyword');
c.addSuggestKeyHandler('detailTitle', 'detailTitle-suggest', 'detailTitle');
c.bindSearchSubmitHandlers_();
const read = text => vm.runInContext(text, c);
function emit(target, type, data = {}) { const event = new Event(type, { cancelable: true }); for (const [key, value] of Object.entries(data)) Object.defineProperty(event, key, { value }); target.dispatchEvent(event); return event; }
function tick(ms = 1) { now += ms; timers.splice(0).forEach(fn => fn()); }
const input = nodes.get('keyword');
const down = (target = input, options = {}) => emit(target, 'keydown', { key: 'Enter', keyCode: 13, repeat: false, ...options });
const up = (target = input) => emit(target, 'keyup', { key: 'Enter' });

// Clear changes one field, preserves filters, emits input, and never submits.
for (const id of ids) {
  searches = 0; ids.forEach(key => { nodes.get(key).value = key + ' retained'; }); nodes.get('detailMedia').value = '漫画';
  c.syncSearchInputClearButtons_(); assert.equal(nodes.get(id + '-clear').hidden, false);
  read("currentSuggestList.keyword = ['古い候補']; currentSuggestIndex.keyword = 0; currentSuggestList.detailTitle = ['古い候補']; currentSuggestIndex.detailTitle = 0;");
  let inputEvents = 0; const listener = () => { inputEvents++; c.syncSearchInputClearButtons_(); }; nodes.get(id).addEventListener('input', listener);
  emit(nodes.get(id + '-clear'), 'click');
  assert.equal(nodes.get(id).value, ''); assert.equal(document.activeElement.id, id); assert.equal(inputEvents, 1); assert.equal(searches, 0); assert.equal(nodes.get(id + '-clear').hidden, true);
  for (const other of ids.filter(key => key !== id)) assert.equal(nodes.get(other).value, other + ' retained');
  assert.equal(nodes.get('detailMedia').value, '漫画');
  if (id === 'keyword' || id === 'detailTitle') { assert.equal(read('currentSuggestIndex.' + id), -1); assert.equal(read('currentSuggestList.' + id + '.length'), 0); assert.equal(nodes.get(id).getAttribute('aria-expanded'), 'false'); }
  nodes.get(id).removeEventListener('input', listener);
}
tick(); input.focus(); searches = 0;
down(); form.requestSubmit(); assert.equal(searches, 1, 'keydown plus native submit searches once');
down(input, { repeat: true }); assert.equal(searches, 1, 'held Enter does not repeatedly search');
up(); down(); assert.equal(searches, 2, 'a distinct Enter press can search immediately'); up(); tick();
for (const id of ids) { searches = 0; nodes.get(id).focus(); down(nodes.get(id)); assert.equal(searches, 1, id + ' Enter'); up(nodes.get(id)); tick(); }
searches = 0; input.focus(); form.requestSubmit(); form.requestSubmit(); assert.equal(searches, 1, 'submit-only mobile action is accepted once'); tick();

// Preserve the selected candidate on first Enter; only the next press searches.
read("currentSuggestList.keyword = ['選択候補']; currentSuggestIndex.keyword = 0;"); nodes.get('keyword-suggest').style.display = 'block'; searches = 0;
down(); form.requestSubmit(); assert.equal(input.value, '選択候補'); assert.equal(searches, 0); up(); down(); assert.equal(searches, 1); up(); tick();
// Both event orders, keyCode=229 without isComposing, and trailing submit are guarded.
for (const order of ['keydown-first', 'compositionend-first', '229']) {
  input.focus(); searches = 0; emit(input, 'compositionstart');
  if (order === 'keydown-first') down(input, { isComposing: true, keyCode: 229 });
  emit(input, 'compositionend');
  if (order !== 'keydown-first') down(input, { isComposing: false, keyCode: order === '229' ? 229 : 13 });
  emit(input, 'input'); form.requestSubmit(); up(); form.requestSubmit(); assert.equal(searches, 0, order);
  down(); assert.equal(searches, 1, 'next intentional Enter after release: ' + order); up(); tick(60);
}
searches = 0; emit(input, 'compositionstart'); form.requestSubmit(); assert.equal(searches, 0); emit(input, 'compositionend'); form.requestSubmit(); assert.equal(searches, 0); tick(60); form.requestSubmit(); assert.equal(searches, 1, 'submit-only search works after IME commit guard'); tick();
// An intentional search-button click is not mistaken for IME confirmation.
searches = 0; emit(input, 'compositionend'); emit(submitButtons[0], 'click', { detail: 1 }); form.requestSubmit(); assert.equal(searches, 1); tick(60);
// Losing focus before keyup must not leave the new IME guard stuck on the field.
searches = 0; emit(input, 'compositionstart'); down(input, { isComposing: true, keyCode: 229 }); emit(input, 'compositionend'); emit(input, 'blur'); tick(60); input.focus(); down(); assert.equal(searches, 1); up(); tick();
// Empty input is delegated to the unchanged search implementation.
input.value = ''; searches = 0; down(); assert.equal(searches, 1); up();
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
for (const id of ids) { assert(new RegExp('id="' + id + '" enterkeyhint="search"').test(html)); assert(html.includes('data-clear-search-input="' + id + '" aria-label="')); }
assert(html.includes('<form id="librarySearchForm"'));
c.syncReleasedRangeOptions_ = () => {};
ids.forEach(id => { nodes.get(id).value = 'filled'; }); c.syncSearchInputClearButtons_();
c.clearAdvancedFields();
assert.equal(nodes.get('keyword-clear').hidden, false);
for (const id of ids.slice(1)) assert.equal(nodes.get(id + '-clear').hidden, true);
c.clearSearchFormValuesForBrowse_();
for (const id of ids) assert.equal(nodes.get(id + '-clear').hidden, true);
console.log('search field clear/focus, single submit, candidate selection, IME ordering and mobile-action checks ok');
