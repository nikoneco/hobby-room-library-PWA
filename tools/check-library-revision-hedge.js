const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

// Execute the actual shim generator without writing docs or calling any endpoint.
const build = read('tools/build-pages.js');
const start = build.indexOf('function writeGasRunShim() {');
const end = build.indexOf('function writePwaClient()', start);
assert(start >= 0 && end > start);
let fixtureShim;
vm.runInNewContext(build.slice(start, end) + '\nwriteGasRunShim();', {
  fs: { writeFileSync(file, content) { fixtureShim = content; } }, path,
  jsDir: '/fixture', gasEndpoint: 'https://example.invalid/exec'
});
// Expose private entry points only to the VM, following the series-loading fixture.
fixtureShim = fixtureShim.replace(/\}\)\(\);\s*$/, `
  window.revisionFixture = {
    read: invokeLibraryRevisionRead_, activate: activateLocalIndex_, remotePromise: invokeRemotePromise_,
    remote: invokeRemoteJsonp_, search: invokeSearchWithFreshIndex_
  };
})();`);
const existing = read('tools/check-series-loading.js');
let prelude = existing.slice(0, existing.indexOf('const booksFor ='));
prelude = prelude.replace("const shim = read('docs/assets/js/gas-run-shim.js');", 'const shim = fixtureShim;');
const injectStart = prelude.indexOf('  vm.runInContext(shim.replace(');
const injectEnd = prelude.indexOf('  c.google = window.google;', injectStart);
assert(injectStart >= 0 && injectEnd > injectStart);
prelude = prelude.slice(0, injectStart) + '  vm.runInContext(shim, c);\n' + prelude.slice(injectEnd);
const host = { require, URL, URLSearchParams, Buffer, fixtureShim, __dirname, module: { exports: {} } };
vm.runInNewContext(prelude + '\nmodule.exports = { harness, payload };', host);
const { harness: baseHarness, payload } = host.module.exports;
function harness() {
  const h = baseHarness(), fixture = h.frameFixture;
  h.message = fixture.message;
  h.frameReply = (request, envelope, overrides = {}) => fixture.reply(request.frame || request.script.frame, envelope, overrides);
  const append = h.document.body.appendChild;
  h.document.body.appendChild = function(frame) {
    const result = append(frame);
    const request = h.requests[h.requests.length - 1];
    request.frame = frame;
    return result;
  };
  return Object.assign(h, { activeFrames: fixture.activeFrames, messageListeners: fixture.listeners });
}
const callback = (h, request) => request.frame ? envelope => h.frameReply(request, envelope)
  : request.params.get('callback').split('.').reduce((obj, key) => obj[key], h.window);
const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };

function begin() {
  const h = harness(), results = [];
  h.window.revisionFixture.read(
    value => results.push({ ok: true, value, atMs: h.window.performance.now() }),
    error => results.push({ ok: false, code: error.code, atMs: h.window.performance.now() }),
    { quiet: true, perfName: 'sync:libraryRevision' }
  );
  assert.equal(h.requests.length, 1);
  return { h, results };
}
function cleaned(h) {
  assert.equal(h.activeScripts.size, 0);
  assert.equal(h.activeFrames.size, 0, 'winner/deadline removes backup iframe');
  assert.equal(h.messageListeners.size, 0, 'winner/deadline removes backup message listener');
  assert.equal(h.timers.size, 0, 'winner/deadline removes hedge and transport timers');
  assert.equal(h.notifications.length, 0, 'revision reads remain quiet');
}

async function main() {
  // Normal quick response has no backup; advancing past the hedge time adds none.
  {
    const { h, results } = begin();
    h.advance(1000);
    h.reply(h.requests[0], { revision: 'one' });
    h.advance(60000);
    assert.equal(h.requests.length, 1);
    assert.equal(results.length, 1);
    assert.equal(results[0].atMs, 1000);
    cleaned(h);
  }
  // Hung primary recovers from a backup at 3s plus its ordinary response time.
  {
    const { h, results } = begin();
    const lateError = h.requests[0].script.onerror, lateReply = callback(h, h.requests[0]);
    h.advance(2999);
    assert.equal(h.requests.length, 1);
    h.advance(1);
    assert.equal(h.requests.length, 2);
    assert.equal(h.requests[1].params.get('api'), 'libraryRevision');
    assert.equal(h.requests[1].params.get('transport'), 'revisionFrame');
    assert.equal(new URL(h.requests[1].frame.src).searchParams.has('callback'), false);
    assert.match(h.requests[1].params.get('nonce'), /^[a-f0-9]{32}$/);
    h.advance(1000);
    h.reply(h.requests[1], { revision: 'one' });
    assert.equal(results.length, 1);
    assert.equal(results[0].atMs, 4000);
    assert.equal(h.perf[0].result.code, 'CANCELLED');
    cleaned(h);
    lateError();
    lateReply({ ok: true, data: { revision: 'old' } });
    h.reply(h.requests[0], null, 'Late failure');
    assert.equal(results.length, 1);
    assert.equal(results[0].value.revision, 'one');
    cleaned(h);
  }
  // Primary script error (e.g. redirected 404/ORB) starts the backup immediately.
  {
    const { h, results } = begin();
    h.advance(500);
    h.requests[0].script.onerror();
    assert.equal(h.requests.length, 2);
    assert.equal(results.length, 0);
    h.advance(1000);
    h.reply(h.requests[1], { revision: 'one' });
    h.advance(5000);
    assert.equal(h.requests.length, 2);
    assert.equal(results[0].atMs, 1500);
    cleaned(h);
  }
  // The backup failing cannot discard the still-pending primary.
  {
    const { h, results } = begin();
    h.advance(3000);
    h.requests[1].script.onerror();
    assert.equal(results.length, 0);
    assert.equal(h.activeScripts.size, 1);
    h.advance(5000);
    h.reply(h.requests[0], { revision: 'one' });
    assert.equal(results.length, 1);
    assert.equal(results[0].atMs, 8000);
    cleaned(h);
  }
  // Two failures settle once, with at most two lightweight revision requests.
  {
    const { h, results } = begin();
    h.requests[0].script.onerror();
    h.requests[1].script.onerror();
    assert.equal(results.length, 1);
    assert.equal(results[0].ok, false);
    h.advance(60000);
    assert.equal(h.requests.length, 2);
    assert.equal(results.length, 1);
    cleaned(h);
  }
  // Both hung requests retain the original 60s deadline, not 60s after backup.
  {
    const { h, results } = begin();
    const latePrimaryError = h.requests[0].script.onerror;
    h.advance(3000);
    const lateBackupError = h.requests[1].script.onerror;
    h.advance(56999);
    assert.equal(results.length, 0);
    h.advance(1);
    assert.equal(results.length, 1);
    assert.equal(results[0].code, 'TIMEOUT');
    assert.equal(results[0].atMs, 60000);
    cleaned(h);
    latePrimaryError(); lateBackupError();
    h.reply(h.requests[0], { revision: 'old' });
    h.reply(h.requests[1], { revision: 'old' });
    assert.equal(results.length, 1);
    cleaned(h);
  }
  // An invalid revision payload is not a successful validation of a stored index.
  {
    const { h, results } = begin();
    h.reply(h.requests[0], { revision: '' });
    assert.equal(results.length, 0);
    h.advance(3000);
    h.reply(h.requests[1], { revision: 'valid' });
    assert.equal(results[0].value.revision, 'valid');
    cleaned(h);
  }
  // Heavy APIs stay single-request; the hedge is not a general retry wrapper.
  for (const method of ['getInitialSearchData', 'getLocalLibraryIndexForPwa_', 'searchBooksSimple', 'getBookDetailsByIds']) {
    const h = harness();
    h.window.revisionFixture.remotePromise(method, ['fixture'], { quiet: true });
    h.advance(5000);
    assert.equal(h.requests.length, 1, method + ' must not be hedged');
  }
  // Public refresh still requires a matching revision before permitting local queries.
  {
    const h = harness();
    h.window.revisionFixture.activate(payload(), false);
    const refresh = h.window.ShumiLibraryLocalIndex.checkForUpdates();
    await flush();
    assert.equal(h.window.ShumiLibraryLocalIndex.getFreshnessState(), 'checking');
    assert.equal(h.window.ShumiLibraryLocalIndex.countMatches([]), null);
    h.advance(3000);
    h.reply(h.requests[1], { revision: 'revision-one' });
    await refresh;
    assert.equal(h.window.ShumiLibraryLocalIndex.getFreshnessState(), 'fresh');
    assert(h.window.ShumiLibraryLocalIndex.countMatches([]) > 0);
    assert.equal(h.requests.length, 2);
  }
  // A real foreground search joins refresh, races a hung GAS search, and wins
  // locally only after the backup authoritatively validates the saved snapshot.
  {
    const h = harness(), results = [];
    const stored = { schemaVersion: 7, payload: payload(), savedAt: '2026-10-03T00:00:00Z' };
    const db = {
      close() {},
      transaction() {
        return { objectStore() {
          return { get() {
            const request = {};
            queueMicrotask(() => { request.result = stored; request.onsuccess(); });
            return request;
          } };
        } };
      }
    };
    h.window.indexedDB = { open() {
      const request = {};
      queueMicrotask(() => { request.result = db; request.onsuccess(); });
      return request;
    } };
    const refresh = h.window.ShumiLibraryLocalIndex.checkForUpdates();
    await flush();
    const primary = h.requests[0], latePrimaryError = primary.script.onerror;
    h.window.google.script.run.withSuccessHandler(books => results.push({ books, atMs: h.window.performance.now() }))
      .withFailureHandler(error => results.push({ error })).searchBooksSimple('クビキリサイクル');
    h.advance(250);
    const remoteSearch = h.requests[1];
    assert.equal(remoteSearch.params.get('api'), 'searchSimple');
    assert.equal(results.length, 0, 'unverified saved index does not serve the foreground query');
    h.advance(2750);
    const backup = h.requests[2];
    assert.equal(backup.params.get('api'), 'libraryRevision');
    h.advance(1000);
    h.reply(backup, { revision: 'revision-one' });
    await refresh;
    await flush();
    h.advance(0);
    assert.equal(h.window.ShumiLibraryLocalIndex.getFreshnessState(), 'fresh');
    assert.equal(results.length, 1);
    assert.equal(results[0].atMs, 4000, '3s backup plus 1s response releases a local query');
    assert(results[0].books.some(book => book.title === 'クビキリサイクル'));
    assert(h.perf.some(entry => entry.name === 'api:searchSimple' && entry.meta.local && entry.result.ok));
    assert(!h.activeScripts.has(remoteSearch.script), 'local winner cancels the pending remote search frame');
    assert(!h.activeScripts.has(primary.script), 'winning revision cancels its hung primary');
    assert.equal(h.requests.length, 3, 'no duplicate refresh pair or heavy API retry');
    h.advance(16000);
    latePrimaryError();
    h.reply(primary, { revision: 'old' });
    h.reply(remoteSearch, [{ title: 'Late remote result' }]);
    assert.equal(results.length, 1, 'late primary/search replies cannot overwrite the local winner');
    assert.equal(h.notifications.length, 0);
  }

  // Mismatch remains blocked until a newly downloaded index is activated.
  {
    const h = harness();
    h.window.revisionFixture.activate(payload(), false);
    const refresh = h.window.ShumiLibraryLocalIndex.checkForUpdates();
    await flush();
    h.reply(h.requests[0], { revision: 'revision-new' });
    await flush();
    assert.equal(h.requests[1].params.get('api'), 'localIndex');
    assert.equal(h.window.ShumiLibraryLocalIndex.countMatches([]), null);
    const fresh = payload(); fresh.revision = 'revision-new';
    h.reply(h.requests[1], fresh);
    await refresh;
    assert.equal(h.window.ShumiLibraryLocalIndex.getRevision(), 'revision-new');
    assert.equal(h.window.ShumiLibraryLocalIndex.getFreshnessState(), 'fresh');
  }
  // Two failed transports retain the saved snapshot but never authorize local search.
  {
    const h = harness();
    h.window.revisionFixture.activate(payload(), false);
    const refresh = h.window.ShumiLibraryLocalIndex.checkForUpdates();
    await flush();
    h.requests[0].script.onerror();
    h.requests[1].script.onerror();
    await refresh;
    assert.equal(h.window.ShumiLibraryLocalIndex.isReady(), true);
    assert.equal(h.window.ShumiLibraryLocalIndex.getFreshnessState(), 'failed');
    assert.equal(h.window.ShumiLibraryLocalIndex.countMatches([]), null);
    assert.equal(h.requests.length, 2);
  }
  // Manual refresh supersedes all revision waits, including an already failed
  // primary whose backup would otherwise hang until the original 60s deadline.
  for (const phase of ['primary pending', 'backup pending', 'primary failed', 'backup failed', 'revision just succeeded']) {
    const h = harness();
    h.window.revisionFixture.activate(payload(), false);
    const auto = h.window.ShumiLibraryLocalIndex.checkForUpdates();
    await flush();
    if (phase === 'backup pending' || phase === 'backup failed') h.advance(3000);
    if (phase === 'primary failed') {
      h.advance(1000); h.requests[0].script.onerror(); h.advance(1000);
    }
    if (phase === 'backup failed') h.requests[1].script.onerror();
    const lateErrors = h.requests.map(request => request.script.onerror).filter(Boolean);
    const lateReplies = h.requests.map(request => callback(h, request));
    if (phase === 'revision just succeeded') h.reply(h.requests[0], { revision: 'revision-one' });
    const revisionCount = h.requests.length;
    const force = h.window.ShumiLibraryLocalIndex.forceRefresh();
    const duplicateForce = h.window.ShumiLibraryLocalIndex.forceRefresh();
    assert.equal(h.activeScripts.size, 0, phase + ': manual request synchronously cancels the revision transports');
    assert.equal(h.activeFrames.size, 0, phase + ': manual request cancels the frame');
    assert.equal(h.messageListeners.size, 0, phase + ': manual request removes the listener');
    assert.equal(h.timers.size, 0, phase + ': manual request clears both transport and hedge deadlines');
    await flush();
    const full = h.requests.find(request => request.params.get('api') === 'localIndex');
    assert(full, phase + ': manual force starts its full acquisition without waiting for another revision event');
    assert.equal(h.requests.filter(request => request.params.get('api') === 'localIndex').length, 1);
    assert.equal(h.requests.filter(request => request.params.get('api') === 'libraryRevision').length, revisionCount);
    assert.equal(h.activeScripts.size, 1, 'manual fallback cancels any pending revision backup');
    lateErrors.forEach(error => error());
    lateReplies.forEach(reply => reply({ ok: true, data: { revision: 'late-old' } }));
    const downloadingForce = h.window.ShumiLibraryLocalIndex.forceRefresh();
    const fresh = payload(); fresh.revision = 'manual-new';
    h.reply(full, fresh);
    const results = await Promise.all([force, duplicateForce, downloadingForce]);
    await auto;
    assert(results.every(result => result.success), phase + ': every manual caller observes the single successful full acquisition');
    assert.equal(h.window.ShumiLibraryLocalIndex.getRevision(), 'manual-new');
    h.advance(60000);
    assert.equal(h.requests.filter(request => request.params.get('api') === 'libraryRevision').length, revisionCount);
    assert.equal(h.requests.filter(request => request.params.get('api') === 'localIndex').length, 1);
    cleaned(h);
  }
  // Synchronous callback/registration boundaries cannot retain a stale cancel
  // handle or lose a force request that arrived before that handle was returned.
  for (const immediateSuccess of [false, true]) {
    const h = harness();
    const manager = h.window.ShumiLibraryLocalIndex;
    h.window.revisionFixture.activate(payload(), false);
    const append = h.document.head.appendChild;
    let force;
    h.document.head.appendChild = function(script) {
      append(script);
      const request = h.requests[h.requests.length - 1];
      if (request.params.get('api') !== 'libraryRevision') return;
      force = manager.forceRefresh();
      if (immediateSuccess) h.reply(request, { revision: 'revision-one' });
    };
    const auto = manager.checkForUpdates();
    await flush();
    assert(force, 'transport registration triggered the manual request');
    const full = h.requests.find(request => request.params.get('api') === 'localIndex');
    assert(full, 'synchronous registration force starts the full acquisition');
    assert.equal(h.activeScripts.size, 1);
    assert.equal(h.requests.length, 2);
    h.reply(full, payload());
    assert.equal((await force).success, true);
    await auto;
    h.advance(60000);
    assert.equal(h.requests.length, 2);
    cleaned(h);
  }
  console.log('library revision hedge checks ok: 3s backup, fast failure, first valid response, two-attempt cap, original deadline, cleanup, freshness and heavy-API isolation');
}
module.exports = { harness, payload, begin, cleaned, flush, main };
if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1; });
