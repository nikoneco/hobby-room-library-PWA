const assert = require('node:assert/strict');
const { harness, payload, flush } = require('./check-library-revision-hedge');
const mappings = [
  ['getInitialSearchData', 'initial'], ['getLocalLibraryIndexForPwa_', 'localIndex'],
  ['getSuggestData', 'suggest'], ['getAdvancedSearchOptions', 'advancedOptions'],
  ['getPreviewIndex', 'previewIndex'], ['countPreviewMatchesAuthoritative', 'countPreview'],
  ['searchBooksSimple', 'searchSimple'], ['searchBooksAdvanced', 'searchAdvanced'],
  ['getRandomBooks', 'random'], ['getAllBooks', 'shelf'], ['getBookshelfBooks', 'shelf'],
  ['getBookshelfBooksChunk', 'shelfChunk'], ['getBookDetailById', 'bookDetailById'],
  ['getBookDetailsByIds', 'bookDetailsByIds'], ['getBookDetailByRowIndex', 'bookDetail'],
  ['getBookDetailsByRowIndexes', 'bookDetails'], ['getSeriesInventoryStatus', 'seriesStatus'],
  ['getBooksBySeriesKey', 'series']
];
function start(method = 'getAllBooks', args = [], options = { quiet: true }, h = harness()) {
  const outcomes = [];
  const cancel = h.window.revisionFixture.remote(method, args,
    value => outcomes.push({ ok: true, value }), error => outcomes.push({ ok: false, error }), options);
  return { h, outcomes, cancel, request: h.requests[0] };
}
function clean(h) {
  assert.equal(h.activeFrames.size, 0);
  assert.equal(h.activeScripts.size, 0);
  assert.equal(h.messageListeners.size, 0);
  assert.equal(h.timers.size, 0);
}
async function main() {
  // Every configured read API except revision gets exactly one frame request.
  for (const [method, api] of mappings) {
    const { h, outcomes, request } = start(method, ['fixture']);
    const url = new URL(request.frame.src);
    assert.equal(url.searchParams.get('api'), api);
    assert.equal(url.searchParams.get('transport'), 'apiFrame');
    assert.equal(url.searchParams.has('callback'), false);
    assert.match(url.searchParams.get('nonce'), /^[0-9a-f]{32}$/);
    assert.equal(request.frame.onload, undefined);
    h.advance(3000);
    assert.equal(h.requests.length, 1, api + ': no hedge');
    h.reply(request, []);
    assert.equal(outcomes.length, 1);
    clean(h);
  }
  {
    const { h, request } = start('searchBooksSimple', ['   ']);
    assert.equal(request.params.get('api'), 'shelf', 'empty simple search retains shelf mapping');
    h.reply(request, []); clean(h);
  }
  // Existing Base64URL argument encoding preserves Unicode and array-to-CSV IDs.
  {
    const args = ['世界 <&> / \u2028 \u2029 絵文字😀'], { h, request } = start('searchBooksSimple', args);
    const params = new URL(request.frame.src).searchParams;
    assert.equal(params.has('keyword'), false);
    assert.equal(Buffer.from(params.get('keywordB64'), 'base64url').toString('utf8'), args[0]);
    h.reply(request, []); clean(h);
  }
  {
    const ids = ['fixture-1', 'fixture-2'], { h, request } = start('getBookDetailsByIds', [ids]);
    assert.equal(Buffer.from(request.params.get('bookIdsB64'), 'base64url').toString('utf8'), ids.join(','));
    h.reply(request, []); clean(h);
  }
  // Non-truthy and large array/object payloads are valid data, not API failures.
  for (const data of [0, null, false, '', [], { text: '絵文字😀<&>'.repeat(30000) }]) {
    const { h, outcomes, request } = start();
    h.reply(request, data);
    assert.equal(outcomes.length, 1);
    assert.equal(outcomes[0].ok, true);
    assert.deepEqual(outcomes[0].value, data);
    clean(h);
  }
  // Exact API, kind, origin, bound window and nonce must all agree.
  for (const override of [
    { api: 'localIndex' }, { kind: 'SHUMI_LIBRARY_REVISION_FRAME_V1' }, { nonce: '0'.repeat(32) }
  ]) {
    const { h, outcomes, request } = start();
    const params = new URL(request.frame.src).searchParams;
    const data = Object.assign({ kind: 'SHUMI_LIBRARY_API_FRAME_V1', api: 'shelf', nonce: params.get('nonce'),
      envelope: { ok: true, data: ['forged'] } }, override);
    h.frameReply(request, null, { data });
    assert.equal(outcomes.length, 0);
    h.reply(request, ['valid']); clean(h);
  }
  for (const overrides of [
    { origin: 'https://script.googleusercontent.com.evil.invalid' },
    { origin: 'http://script.googleusercontent.com' }, { origin: 'null' }, { source: {} }
  ]) {
    const { h, outcomes, request } = start();
    h.frameReply(request, { ok: true, data: ['forged'] }, overrides);
    assert.equal(outcomes.length, 0);
    h.reply(request, []); clean(h);
  }
  for (const bad of [{}, { ok: 'true', data: [] }, { ok: true }, Object.assign(Object.create({ data: [] }), { ok: true }), []]) {
    const { h, outcomes, request } = start();
    h.frameReply(request, bad);
    assert.equal(outcomes.length, 1);
    assert.equal(outcomes[0].error.code, 'INVALID_API_FRAME');
    clean(h);
  }
  {
    const { h, outcomes, request } = start('getAllBooks', [], {});
    h.frameReply(request, { ok: false, data: null, error: { message: 'Private backend details', code: 'PRIVATE' } });
    assert.equal(outcomes[0].error.code, 'API_ERROR');
    assert(!outcomes[0].error.message.includes('Private'));
    assert.equal(h.notifications.length, 1, 'foreground failures notify once');
    clean(h);
  }
  {
    const { h, request } = start('getAllBooks', [], {});
    h.reply(request, []);
    assert.equal(h.notifications.length, 1, 'foreground success clears warning once');
    clean(h);
  }
  // Offline and unavailable secure crypto never start JSONP or another frame.
  for (const mode of ['offline', 'no crypto', 'crypto throws']) {
    const h = harness();
    if (mode === 'offline') h.c.navigator.onLine = false;
    if (mode === 'no crypto') delete h.window.crypto;
    if (mode === 'crypto throws') h.window.crypto = { getRandomValues() { throw new Error('No'); } };
    const { outcomes } = start('getAllBooks', [], { quiet: true }, h);
    assert.equal(h.requests.length, 0);
    assert.equal(outcomes.length, 1);
    assert.equal(outcomes[0].error.code, mode === 'offline' ? 'OFFLINE' : 'API_FRAME_UNAVAILABLE');
    assert.equal(h.notifications.length, 0);
    clean(h);
  }
  for (const method of ['getAllBooks', 'getBooksBySeriesKey']) {
    const { h, outcomes, request } = start(method, ['fixture']);
    const deadline = method === 'getAllBooks' ? 60000 : 25000;
    const lateError = request.script.onerror, lateListener = Array.from(h.messageListeners)[0];
    const params = new URL(request.frame.src).searchParams;
    h.advance(deadline - 1); assert.equal(outcomes.length, 0);
    h.advance(1); assert.equal(outcomes[0].error.code, 'TIMEOUT');
    clean(h);
    lateError();
    lateListener({ origin: 'https://script.googleusercontent.com', source: request.frame.contentWindow,
      data: { kind: 'SHUMI_LIBRARY_API_FRAME_V1', api: params.get('api'), nonce: params.get('nonce'), envelope: { ok: true, data: [] } } });
    assert.equal(outcomes.length, 1, 'timeout settles once despite late events');
    assert.equal(h.requests.length, 1);
  }
  {
    const { h, outcomes, cancel, request } = start();
    cancel(); cancel(); h.reply(request, ['late']);
    assert.equal(outcomes.length, 0, 'cancel suppresses callbacks');
    assert.equal(h.perf[0].result.code, 'CANCELLED');
    clean(h);
  }
  // Synchronous frame registration/response still removes listeners/deadlines.
  {
    const h = harness(), append = h.document.body.appendChild;
    h.document.body.appendChild = function(frame) {
      append(frame); h.reply(h.requests[0], []);
    };
    const { outcomes } = start('getAllBooks', [], { quiet: true }, h);
    assert.equal(outcomes.length, 1); clean(h);
  }
  // Search freshness races are verified through the real foreground path.
  {
    const h = harness(), outcomes = [];
    h.window.revisionFixture.activate(payload(), false);
    const refresh = h.window.ShumiLibraryLocalIndex.checkForUpdates();
    await flush();
    h.window.revisionFixture.search('searchBooksSimple', ['クビキリサイクル'], value => outcomes.push(value), error => { throw error; });
    h.advance(250);
    const search = h.requests.find(request => request.params.get('api') === 'searchSimple');
    assert(search.frame);
    assert.equal(outcomes.length, 0, 'unchecked index never serves search');
    h.reply(h.requests[0], { revision: 'revision-one' });
    await refresh; await flush(); h.advance(0);
    assert.equal(outcomes.length, 1);
    assert(outcomes[0].some(book => book.title === 'クビキリサイクル'));
    assert.equal(h.activeFrames.size, 0, 'local winner cancels pending search frame');
    h.reply(search, [{ title: 'Late' }]);
    assert.equal(outcomes.length, 1); clean(h);
  }
  // A remote search replying inside registration must not leave a stale cancel.
  {
    const h = harness(), outcomes = [];
    h.window.revisionFixture.activate(payload(), false);
    const refresh = h.window.ShumiLibraryLocalIndex.checkForUpdates(); await flush();
    const append = h.document.body.appendChild;
    h.document.body.appendChild = function(frame) {
      append(frame);
      if (new URL(frame.src).searchParams.get('api') === 'searchSimple') h.reply(h.requests[h.requests.length - 1], [{ title: 'Remote' }]);
    };
    h.window.revisionFixture.search('searchBooksSimple', ['query'], value => outcomes.push(value), error => { throw error; });
    h.advance(250);
    assert.equal(outcomes.length, 1);
    assert.equal(h.activeFrames.size, 0);
    h.reply(h.requests[0], { revision: 'revision-one' }); await refresh; await flush(); h.advance(0);
    assert.equal(outcomes.length, 1); clean(h);
  }
  // A local result arriving before frame registration returns its cancel handle
  // must still remove that newly registered remote frame immediately afterward.
  {
    const h = harness(), outcomes = [], listeners = new Map();
    h.window.CustomEvent = h.c.CustomEvent;
    h.document.addEventListener = (type, fn) => {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type).add(fn);
    };
    h.document.removeEventListener = (type, fn) => { if (listeners.has(type)) listeners.get(type).delete(fn); };
    h.document.dispatchEvent = event => Array.from(listeners.get(event.type) || []).forEach(fn => fn(event));
    h.window.revisionFixture.activate(payload(), false);
    const refresh = h.window.ShumiLibraryLocalIndex.checkForUpdates(); await flush();
    const append = h.document.body.appendChild;
    h.document.body.appendChild = function(frame) {
      append(frame);
      if (new URL(frame.src).searchParams.get('api') === 'searchSimple') {
        h.window.revisionFixture.activate(payload(), true);
        h.advance(0);
      }
    };
    h.window.revisionFixture.search('searchBooksSimple', ['クビキリサイクル'], value => outcomes.push(value), error => { throw error; });
    h.advance(250);
    assert.equal(outcomes.length, 1);
    assert(outcomes[0].some(book => book.title === 'クビキリサイクル'));
    assert.equal(h.activeFrames.size, 0, 'local registration winner removes frame after cancel handle is returned');
    assert.equal(h.messageListeners.size, 0);
    assert.equal((listeners.get('shumi-library-local-index-ready') || new Set()).size, 0);
    h.reply(h.requests[0], { revision: 'revision-one' }); await refresh; await flush();
    assert.equal(h.requests.length, 2); clean(h);
  }
  console.log('public API frame checks ok: all read APIs, exact binding, data shapes, Unicode args, quiet/foreground errors, deadlines, cancel and search freshness races');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
