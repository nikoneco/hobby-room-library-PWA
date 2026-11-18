const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function eventTarget() {
  const handlers = new Map();
  return {
    addEventListener(name, handler) {
      if (!handlers.has(name)) handlers.set(name, new Set());
      handlers.get(name).add(handler);
    },
    removeEventListener(name, handler) { handlers.get(name)?.delete(handler); },
    fire(name, fields = {}) {
      const event = {
        target: this, preventDefault() { this.defaultPrevented = true; }, stopPropagation() {}, ...fields
      };
      handlers.get(name)?.forEach(handler => handler(event));
      return event;
    }
  };
}

let document;
let window;
let bookWidth = 104;
let bookHeight = 198;

class Element {
  constructor(tag) {
    Object.assign(this, eventTarget());
    this.tag = tag;
    this.children = [];
    this.dataset = {};
    this.style = { setProperty(name, value) { this[name] = value; } };
    this.attributes = {};
    this.className = '';
    this.scrollLeft = 0;
    this.clientWidth = 390;
    this.classList = {
      contains: name => this.className.split(' ').includes(name),
      add: name => { if (!this.classList.contains(name)) this.className += ' ' + name; },
      remove: name => { this.className = this.className.split(' ').filter(part => part !== name).join(' '); }
    };
  }

  get isConnected() { return this === document.body || Boolean(this.parent?.isConnected); }
  setAttribute(name, value) { this.attributes[name] = value; }
  appendChild(node) { return this.insertBefore(node, null); }
  insertBefore(node, next) {
    node.parent = this;
    this.children.splice(next ? this.children.indexOf(next) : this.children.length, 0, node);
    return node;
  }
  remove() {
    if (this.parent) this.parent.children.splice(this.parent.children.indexOf(this), 1);
    this.parent = null;
  }
  querySelectorAll(selector) {
    return this.children.flatMap(node => [
      ...(node.classList.contains(selector.slice(1)) ? [node] : []), ...node.querySelectorAll(selector)
    ]);
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
  closest(selector) {
    if (this.classList.contains(selector.slice(1))) return this;
    return this.parent?.closest(selector) || null;
  }
  focus() { document.activeElement = this; }
  showModal() {
    this.open = true;
    this.querySelector('.shelf-room-map-modal-close').focus();
  }
  close() { this.open = false; }
  getBoundingClientRect() {
    if (this.classList.contains('shelf-window-probe')) return { width: bookWidth, height: bookHeight };
    const row = this.closest('.shelf-view').querySelectorAll('.bookshelf-strip').indexOf(this);
    const top = 450 + row * (bookHeight + 42) - window.scrollY;
    return { top, bottom: top + bookHeight };
  }
}

let fallbackOpener;
document = {
  createElement: tag => new Element(tag),
  body: new Element('body'),
  querySelector: () => fallbackOpener,
  getElementById: () => null
};
document.activeElement = document.body;

const queuedFrames = new Map();
let frameId = 0;
window = {
  ...eventTarget(),
  innerHeight: 760,
  scrollY: 0,
  PointerEvent: function () {},
  getComputedStyle: () => ({ columnGap: '8px' }),
  requestAnimationFrame(callback) { queuedFrames.set(++frameId, callback); return frameId; },
  cancelAnimationFrame(id) { queuedFrames.delete(id); }
};
function flushFrames() {
  const callbacks = [...queuedFrames.values()];
  queuedFrames.clear();
  callbacks.forEach(callback => callback());
}

let restored = false;
let opened;
let covers = 0;
const context = vm.createContext({
  document, window,
  popupFocusReturn_: null,
  escapeHtml: String,
  pwaPerfStart_() {}, pwaPerfEnd_() {},
  resetBookDetailPrefetchObserver_() {}, observeBookDetailPrefetch_() {}, queueBookDetailPrefetch_() {},
  restoreBookshelfScroll_() { restored = true; },
  setupBookImageElement_() { covers += 1; },
  showPopup(book, index, data) { opened = { book, index, data }; }
});
for (const file of ['script.state.js.html', 'script.shelf.js.html']) {
  const source = fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
  vm.runInContext(source.replace(/^<script>\s*/, '').replace(/<\/script>\s*$/, ''), context, { filename: file });
}

const books = Array.from({ length: 24 }, (_, row) => {
  const shelf = '①②③④⑤⑥⑦⑧'[Math.floor(row / 3)] + '-上';
  const location = String(row % 3 + 1);
  return Array.from({ length: row < 12 ? 104 : 103 }, (_, index) => ({
    bookId: `${row}:${index}`, title: `Book ${row}:${index}`, location, shelf
  }));
}).flat();
assert.equal(books.length, 2484);

vm.runInContext('bookshelfPendingRestoreScroll = true', context);
const result = document.body.appendChild(new Element('div'));
const shelf = context.renderShelfView_(books, result);
const strips = shelf.querySelectorAll('.bookshelf-strip');
const renderedBooks = () => shelf.querySelectorAll('.shelf-book').filter(node => !node.classList.contains('shelf-window-probe'));
assert.equal(strips.length, 24);
assert(restored, 'vertical scroll can be restored as soon as row dimensions exist');
assert(strips.every(strip => Number.parseFloat(strip.children[0].style.height) === bookHeight));
assert.equal(Number.parseFloat(strips[0].children[0].style.width), 104 * 112 - 8);
flushFrames();
assert(renderedBooks().length > 0 && renderedBooks().length < 40);
assert.equal(covers, renderedBooks().length, 'only mounted books start creating image plans');
assert.equal(strips[23].querySelectorAll('.shelf-book').length, 0);

const first = strips[0].querySelectorAll('.shelf-book').find(book => book.dataset.shelfBookIndex === '0');
first.focus();
assert(shelf.fire('keydown', { key: 'End', target: first }).defaultPrevented);
flushFrames();
assert.equal(document.activeElement.dataset.shelfBookIndex, '103');
assert(!first.isConnected, 'books outside the horizontal window are removed');
document.activeElement.onclick();
assert.equal(opened.book.bookId, '0:103');
assert.equal(opened.index, 103);
assert.equal(opened.data.length, 2484);
assert.equal(opened.data[opened.index + 1].bookId, '1:0', 'swipe continues into the next row');

window.scrollY = 5600;
window.fire('scroll');
flushFrames();
assert(renderedBooks().length > 0 && renderedBooks().length < 50);
assert(document.activeElement.isConnected, 'focused book survives eviction until focus moves');
strips[22].focus();
shelf.fire('focusin');
flushFrames();
assert.equal(strips[0].querySelectorAll('.shelf-book').filter(node => node.dataset.shelfBookIndex).length, 0);
assert(strips[22].querySelectorAll('.shelf-book').length, 'distant shelf appears on a direct jump');

bookWidth = 88;
bookHeight = 180;
window.fire('resize');
flushFrames();
assert(strips.every(strip => Number.parseFloat(strip.children[0].style.height) === bookHeight));
assert.equal(Number.parseFloat(strips[0].children[0].style.width), 104 * 96 - 8);

for (const shelf of ['①-上', '８－下', 'PC横']) assert(context.canShowBookLocationShelfMap_({ shelf }));
for (const shelf of ['', '⑨-下', '茨城', '別室']) assert(!context.canShowBookLocationShelfMap_({ shelf }));
const opener = document.body.appendChild(new Element('button'));
assert(context.openBookLocationShelfMap_({ shelf: '②-下', location: '3' }, opener));
assert(context.isBookLocationShelfMapOpen_());
const dialog = document.body.querySelector('.shelf-room-map-book-location');
assert.equal(dialog.querySelector('.shelf-room-map-modal-meta').textContent, '②-下・3段');
assert.match(dialog.querySelector('.room-map-location-marker').innerHTML, />2</);
assert.equal(document.activeElement, dialog.querySelector('.shelf-room-map-modal-close'));
dialog.fire('cancel');
assert.equal(document.activeElement, opener);
assert(!context.isBookLocationShelfMapOpen_());

assert(context.openBookLocationShelfMap_({ shelf: 'PC横' }, opener));
fallbackOpener = document.body.appendChild(new Element('button'));
opener.remove();
context.closeBookLocationShelfMap_();
assert.equal(document.activeElement, fallbackOpener, 'opening control is restored after a detail re-render');

window.fire('scroll');
context.resetResultRenderQueue_();
assert.equal(queuedFrames.size, 0);
window.fire('scroll');
assert.equal(queuedFrames.size, 0, 'replacing the view removes its scroll listener');
console.log('shelf window checks ok: 2484-book navigation, bounded rows/covers, resize, focus, and detail map');
