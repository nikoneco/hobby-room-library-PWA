const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
const build = fs.readFileSync(path.join(root, 'tools/build-pages.js'), 'utf8');
const generated = {};
for (const [name, next] of [['writeGasRunShim', 'writePwaClient'], ['writePwaClient', 'writePwaFiles']]) {
  vm.runInNewContext(build.slice(build.indexOf('function ' + name + '()'), build.indexOf('function ' + next + '()')) + '\n' + name + '();', {
    fs: { writeFileSync(file, content) { generated[path.basename(file)] = content; } },
    path, jsDir: '/fixture', gasEndpoint: 'https://example.invalid/exec'
  });
}
const KEY = 'shumiLibrary.searchPerf.v1';
function harness(enabled = true, stored = []) {
  let now = 0, sequence = 0, mutations = 0, writes = 0;
  const timers = new Map(), frames = new Map(), observers = new Set(), requests = [];
  const storage = new Map([[KEY, JSON.stringify(stored)]]), listeners = new Map();
  const listen = (type, fn) => { if (!listeners.has(type)) listeners.set(type, new Set()); listeners.get(type).add(fn); };
  const emit = type => (listeners.get(type) || []).forEach(fn => fn());
  class Node {
    constructor(tag = 'div') {
      this.tagName = tag; this.children = []; this.style = {}; this.className = ''; this.textContent = '';
      this.isConnected = true; this.rect = { width: 100, height: 100, top: 100, bottom: 200, left: 10, right: 110 };
      this.classList = {
        contains: name => this.className.split(' ').includes(name),
        add: (...names) => { this.className = [...new Set([...this.className.split(' '), ...names])].join(' '); },
        remove: (...names) => { this.className = this.className.split(' ').filter(name => !names.includes(name)).join(' '); },
        toggle: (name, value) => value ? this.classList.add(name) : this.classList.remove(name)
      };
    }
    appendChild(node) { this.children.push(node); node.parentElement = this; return node; }
    setAttribute() {}
    addEventListener(type, fn) { this['on' + type] = fn; }
    getBoundingClientRect() { return this.rect; }
    closest(selector) { return this.parentElement && (selector.split(',').some(part => this.parentElement.classList.contains(part.trim().slice(1))) ? this.parentElement : this.parentElement.closest(selector)); }
    querySelectorAll(selector) {
      return this.children.flatMap(child => [child, ...child.querySelectorAll('*')]).filter(child =>
        selector === '*' || selector.split(',').some(part => part.trim()[0] === '.'
          ? child.classList.contains(part.trim().slice(1)) : child.tagName === part.trim()));
    }
    querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
    set innerHTML(value) {
      this.children = [];
      for (const match of value.matchAll(/<span class="([^"]+)"><\/span>/g)) {
        const child = new Node('span'); child.className = match[1]; this.appendChild(child);
      }
    }
  }
  const body = new Node('body');
  const document = { body, visibilityState: 'visible', addEventListener: listen,
    removeEventListener(type, fn) { if (listeners.has(type)) listeners.get(type).delete(fn); },
    dispatchEvent(event) { emit(event.type); },
    createElement: tag => new Node(tag),
    getElementById: id => [body, ...body.querySelectorAll('*')].find(node => node.id === id) || null,
    head: { appendChild(script) { requests.push({ script, params: new URL(script.src).searchParams }); script.parentNode = { removeChild() {} }; } }
  };
  const window = {
    location: { search: enabled === true ? '?debugPerf' : '', href: 'https://example.invalid/' },
    innerWidth: 800, innerHeight: 600, addEventListener: listen,
    performance: { now: () => now }, console: { debug() {} },
    localStorage: { getItem: key => storage.get(key) || null, setItem(key, value) { writes++; storage.set(key, value); } },
    setTimeout(fn, ms) { const id = ++sequence; timers.set(id, { fn, due: now + ms }); return id; },
    clearTimeout: id => timers.delete(id),
    requestAnimationFrame(fn) { const id = ++sequence; frames.set(id, fn); return id; },
    cancelAnimationFrame: id => frames.delete(id),
    getComputedStyle: node => ({ display: 'block', visibility: 'visible', opacity: '1', ...node.style }),
    CustomEvent: function(type) { this.type = type; },
    MutationObserver: class {
      constructor(fn) { this.fn = fn; mutations++; }
      observe() { observers.add(this); }
      disconnect() { observers.delete(this); }
    }
  };
  if (enabled === 'stored') storage.set('shumiLibrary.perfHudEnabled.v1', '1');
  const c = vm.createContext({ window, document, navigator: { onLine: true }, URLSearchParams, console,
    btoa: value => Buffer.from(value, 'binary').toString('base64') });
  vm.runInContext(generated['pwa-client.js'].replace(/\}\)\(\);\s*$/, 'window.disablePerfFixture = () => setPerfHudEnabled_(false);\n})();'), c);
  const append = body.appendChild.bind(body);
  const fixture = require('./frame-test-fixture').installFrameFixture(window, document);
  const appendFrame = body.appendChild;
  body.appendChild = node => node.tagName === 'iframe' ? appendFrame(node) : append(node);
  vm.runInContext(generated['gas-run-shim.js'].replace(/\}\)\(\);\s*$/, `
    window.shimPerfFixture = { activate: activateLocalIndex_, holdRefresh() { localIndexRefreshPromise = new Promise(() => {}); } };
  })();`), c);
  function advance(ms) {
    const target = now + ms;
    for (;;) {
      const next = [...timers].filter(([, timer]) => timer.due <= target).sort((a, b) => a[1].due - b[1].due)[0];
      if (!next) break;
      now = next[1].due; timers.delete(next[0]); next[1].fn();
    }
    now = target;
  }
  function frame() { advance(16); const pending = [...frames.values()]; frames.clear(); pending.forEach(fn => fn()); }
  const pwa = window.ShumiLibraryPwa;
  function receive(trace, source = 'local') {
    pwa.dispatchSearch(trace); advance(100);
    const token = pwa.perfStart('api:searchSimple', { searchId: trace.id, api: 'searchSimple', local: source === 'local' });
    advance(30);
    const perf = pwa.perfEnd(token, { ok: true });
    pwa.receiveSearch(trace, { source, token, perf });
  }
  function result(empty = false) {
    const node = new Node(); const first = new Node(); first.className = empty ? 'empty-result' : 'book-card'; node.appendChild(first);
    return node;
  }
  const history = () => JSON.parse(storage.get(KEY));
  const summary = () => document.getElementById('pwaPerfHudSummary').children.map(node => node.children.map(child => child.textContent).join(': ')).join('\n');
  return { window, document, pwa, advance, frame, receive, result, history, summary, emit, Node, requests, fixture,
    storage, timers, frames, observers, c, get mutations() { return mutations; }, get writes() { return writes; } };
}

// Disabled instrumentation creates no traces, observers, timers, storage writes or HUD.
{
  const h = harness(false); const before = h.writes;
  assert.equal(h.pwa.startSearch(1), null);
  h.pwa.renderSearch(null, h.result(), 1); h.pwa.cancelSearch('navigate');
  assert.equal(h.mutations, 0); assert.equal(h.timers.size + h.frames.size, 0);
  assert.equal(h.writes, before); assert.equal(h.document.getElementById('pwaPerfHud'), null);
}

// A visible element must survive another animation frame; stages partition total time.
{
  const h = harness(), trace = h.pwa.startSearch(1); h.receive(trace); h.advance(20);
  const result = h.result(); result.style.opacity = '0'; h.pwa.renderSearch(trace, result, 1);
  h.frame(); assert.equal(trace.status, 'pending');
  result.style.opacity = '1'; h.frame(); assert.equal(trace.status, 'pending');
  h.frame(); assert.equal(trace.status, 'success');
  assert.equal(trace.prepareMs, 100); assert.equal(trace.queryMs, 30); assert.equal(trace.assembleMs, 20);
  assert.equal(trace.totalMs, trace.inputMs + trace.prepareMs + trace.queryMs + trace.assembleMs + trace.displayWaitMs);
  assert.equal(trace.covers.total, 0); assert.equal(trace.covers.elapsedMs, undefined);
  const snapshot = JSON.stringify(trace.api);
  for (let i = 0; i < 30; i++) h.pwa.recordPerf(i % 2 ? 'sync:libraryRevision' : 'api:bookDetailsByIds', 2000, { api: 'bookDetailsByIds', ok: i % 2 === 0, code: 'CANCELLED' });
  assert.equal(JSON.stringify(h.history().find(item => item.status === 'success').api), snapshot);
  assert.match(h.summary(), /先頭表示（描画機会後）: 198ms/);
  assert.match(h.summary(), /ローカル/);
  for (let i = 2; i < 11; i++) { h.pwa.startSearch(i); h.pwa.cancelSearch('superseded'); }
  assert.equal(h.history().length, 5); assert(h.history().some(item => item.id === trace.id && item.status === 'success'));
  assert.match(h.summary(), /取消 \/ superseded/);
}

// Zero results are a successful visible empty-state, independent of cover loading.
{
  const h = harness(), trace = h.pwa.startSearch(1); h.receive(trace, 'remote');
  h.pwa.renderSearch(trace, h.result(true), 0); h.frame(); h.frame();
  assert.equal(trace.status, 'success'); assert.equal(trace.count, 0); assert.equal(trace.source, 'GAS');
}

// Cover observation never delays the first-result milestone; fallbacks/failures settle separately.
{
  const h = harness(), trace = h.pwa.startSearch(1); h.receive(trace);
  const result = h.result(), images = Array.from({ length: 3 }, () => new h.Node('img'));
  images.forEach(img => result.appendChild(img)); h.pwa.renderSearch(trace, result, 3); h.frame(); h.frame();
  assert.equal(trace.status, 'success'); assert.equal(trace.covers.pending, 3);
  const total = trace.totalMs; h.advance(200);
  images[0].naturalWidth = 100; images[0].className = 'book-image-loaded';
  images[1].naturalWidth = 100; images[1].className = 'book-image-loaded book-image-generated-cover';
  images[2].naturalWidth = 0; images[2].className = 'book-image-loaded';
  [...h.observers].forEach(observer => observer.fn());
  assert.equal(trace.totalMs, total); assert.equal(trace.covers.elapsedMs, total + 200);
  assert.equal(trace.covers.loaded, 1); assert.equal(trace.covers.fallback, 1); assert.equal(trace.covers.failed, 1);
  assert.equal(trace.covers.status, 'settled'); assert.equal(h.observers.size + h.timers.size + h.frames.size, 0);
}
{
  const h = harness(), trace = h.pwa.startSearch(1); h.receive(trace);
  const result = h.result(), image = new h.Node('img'); image.rect.width = image.rect.height = 0;
  result.children[0].appendChild(image); h.pwa.renderSearch(trace, result, 1); h.frame(); h.frame();
  assert.equal(trace.covers.total, 1, 'unloaded dimensionless cover still belongs to a visible result');
  h.pwa.startSearch(2); assert.equal(trace.covers.status, 'interrupted');
  assert.equal(h.observers.size + h.timers.size + h.frames.size, 0);
}
for (const interrupt of ['pagehide', 'hidden', 'hud-disabled', 'superseded', 'detached', 'view-change']) {
  const h = harness(interrupt === 'hud-disabled' ? 'stored' : true), trace = h.pwa.startSearch(1); h.receive(trace);
  const result = h.result(); h.pwa.renderSearch(trace, result, 1);
  if (interrupt === 'pagehide') h.emit('pagehide');
  else if (interrupt === 'hidden') { h.document.visibilityState = 'hidden'; h.emit('visibilitychange'); }
  else if (interrupt === 'hud-disabled') h.window.disablePerfFixture();
  else if (interrupt === 'superseded') h.pwa.startSearch(2);
  else if (interrupt === 'detached') { result.isConnected = false; h.frame(); }
  else h.pwa.cancelSearch(interrupt);
  h.pwa.receiveSearch(trace, { source: 'remote' }); h.pwa.failSearch(trace, 'LATE');
  assert.equal(trace.status, 'cancelled', interrupt); assert.equal(h.timers.size + h.frames.size + h.observers.size, 0);
  if (interrupt === 'hud-disabled') assert.equal(h.pwa.startSearch(2), null);
}
{
  const h = harness(), trace = h.pwa.startSearch(1); h.receive(trace);
  const result = h.result(); result.children[0].rect.left = 1000; h.pwa.renderSearch(trace, result, 1); h.frame(); h.advance(5000);
  assert.equal(trace.status, 'failed'); assert.equal(trace.code, 'DISPLAY_NOT_CONFIRMED'); assert.equal(h.frames.size, 0);
}
{
  const h = harness(), trace = h.pwa.startSearch(1); h.receive(trace);
  const result = h.result(); result.appendChild(new h.Node('img')); h.pwa.renderSearch(trace, result, 1); h.frame(); h.frame(); h.advance(15000);
  assert.equal(trace.status, 'success'); assert.equal(trace.covers.status, 'timeout'); assert.equal(h.observers.size, 0);
}
{
  const h = harness(true, [{ id: 'old', session: 'old', status: 'pending', covers: { status: 'pending' } }]);
  h.pwa.recordPerf('sync:test', 10, {});
  assert.match(h.summary(), /過去の検索: #old 取消 \/ previous-session/);
}

// Execute the actual shim through the local winner, losing remote cancellation, and GAS winner.
const payload = { version: 7, revision: 'fixture', metadata: {}, records: [
  [1, '00000000-0000-4000-8000-000000000001', 'Fixture title', 'Author', '', '', '', '', '', '', '', '', '', 0, '', false, 0, 0, '', '', false, 'Fixture title', '', 'Author', 'fixture title author', '', 0, [], [], [], [], [], 0]
] };
for (const route of ['local', 'wait-local', 'remote', 'advanced']) {
  const h = harness(), trace = h.pwa.startSearch(1); let calls = 0;
  if (route === 'local' || route === 'advanced') h.window.shimPerfFixture.activate(payload, true);
  else { h.window.indexedDB = {}; h.window.shimPerfFixture.holdRefresh(); }
  const runner = h.window.google.script.run.withSuccessHandler(() => { calls++; });
  if (route === 'advanced') runner.searchBooksAdvanced('Fixture'); else runner.searchBooksSimple('Fixture');
  if (route === 'wait-local' || route === 'remote') h.advance(250);
  if (route === 'wait-local') { h.advance(750); h.window.shimPerfFixture.activate(payload, true); }
  if (route === 'remote') {
    h.advance(1000); h.fixture.reply(h.requests[0].script.frame, { ok: true, data: [{ title: 'Remote' }] });
  }
  h.advance(0); assert.equal(calls, 1, route); assert.equal(trace.api.meta.searchId, trace.id, route);
  assert.equal(trace.source, route === 'remote' ? 'GAS' : 'local');
  assert.equal(trace.prepareMs, route === 'remote' ? 250 : route === 'wait-local' ? 1000 : 0, route);
  if (route === 'wait-local') {
    assert.equal(h.fixture.activeFrames.size, 0);
    assert.equal(JSON.parse(h.storage.get('shumiLibrary.perfLog.v1')).filter(item => item.meta.code === 'CANCELLED').length, 1);
    h.fixture.reply(h.requests[0].script.frame, { ok: true, data: [{ title: 'Late' }] }); assert.equal(calls, 1);
  }
}
console.log('search performance lifecycle checks ok');
