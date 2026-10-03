const assert = require('node:assert/strict');
const { harness, begin, cleaned, flush, payload } = require('./check-library-revision-hedge');

const envelope = revision => ({ ok: true, data: { revision } });
function withFrame() {
  const result = begin();
  result.h.advance(3000);
  result.frame = result.h.requests[1];
  assert(result.frame.frame);
  return result;
}
function sourceAtDepth(frame, depth) {
  let source = frame.contentWindow;
  for (let i = 0; i < depth; i++) source = { parent: source };
  return source;
}

async function main() {
  // The one backup uses a secure 128-bit nonce and the same read-only endpoint.
  {
    const h = harness(), calls = [];
    h.window.crypto = { getRandomValues(bytes) {
      calls.push(bytes.length);
      bytes.set(Array.from({ length: 16 }, (_, i) => i));
      return bytes;
    } };
    h.window.revisionFixture.read(() => {}, () => {});
    h.advance(3000);
    const request = h.requests[1];
    assert.deepEqual(calls, [16]);
    assert.equal(request.params.get('nonce'), '000102030405060708090a0b0c0d0e0f');
    assert.equal(request.params.get('api'), 'libraryRevision');
    assert.equal(request.params.get('transport'), 'revisionFrame');
    assert.equal(new URL(request.frame.src).searchParams.has('callback'), false);
    assert.equal(request.frame.hidden, true);
    assert.equal(request.frame.tabIndex, -1);
    assert.equal(request.frame.style.display, 'none');
    assert.equal(request.frame.onload, undefined, 'load never authorizes freshness');
    assert.equal(new URL(request.frame.src).origin, new URL(h.requests[0].script.src).origin);
    h.reply(request, { revision: 'valid' });
    cleaned(h);
  }
  // HTTPS Googleusercontent origins plus source binding and nonce must all match.
  for (const badOrigin of [
    'http://script.googleusercontent.com', 'https://script.google.com',
    'https://script.googleusercontent.com.evil.invalid',
    'https://evilscript.googleusercontent.com', 'https://script.googleusercontent.com:444',
    'https://script.googleusercontent.com/', 'https://script.googleusercontent.com@evil.invalid',
    'https://foo.bar-script.googleusercontent.com', 'null', '', undefined
  ]) {
    const { h, results, frame } = withFrame();
    h.frameReply(frame, envelope('forged'), { origin: badOrigin });
    assert.equal(results.length, 0, String(badOrigin) + ': unknown origin ignored');
    assert.equal(h.activeFrames.size, 1);
    h.reply(h.requests[0], { revision: 'primary' });
    assert.equal(results[0].value.revision, 'primary');
    cleaned(h);
  }
  for (const badSource of [null, {}, { parent: null }]) {
    const { h, results, frame } = withFrame();
    h.frameReply(frame, envelope('forged'), { source: badSource });
    assert.equal(results.length, 0, 'allowed origin and nonce alone cannot authorize an unrelated source');
    h.reply(frame, { revision: 'valid' });
    cleaned(h);
  }
  {
    const { h, results, frame } = withFrame();
    const source = { get parent() { throw new Error('Cross-origin access denied'); } };
    h.frameReply(frame, envelope('forged'), { source });
    assert.equal(results.length, 0, 'unreadable ancestry fails closed');
    h.frameReply(frame, envelope('too-deep'), { source: sourceAtDepth(frame.frame, 5) });
    assert.equal(results.length, 0, 'ancestry traversal is bounded at four parent hops');
    const unrelated = { parent: h.window };
    h.frameReply(frame, envelope('sibling'), { source: unrelated });
    assert.equal(results.length, 0, 'another frame under the public top window is rejected');
    h.reply(frame, { revision: 'valid' });
    cleaned(h);
  }
  for (const origin of ['https://script.googleusercontent.com', 'https://a-b123-script.googleusercontent.com']) {
    for (const depth of [0, 1, 2, 4]) {
      const { h, results, frame } = withFrame();
      h.frameReply(frame, envelope('valid'), { origin, source: sourceAtDepth(frame.frame, depth) });
      assert.equal(results.length, 1);
      assert.equal(results[0].value.revision, 'valid');
      cleaned(h);
    }
  }
  for (const data of [null, 'string', { kind: 'other' },
    { kind: 'SHUMI_LIBRARY_REVISION_FRAME_V1', nonce: 'wrong', envelope: envelope('forged') }]) {
    const { h, results, frame } = withFrame();
    h.frameReply(frame, envelope('unused'), { data });
    assert.equal(results.length, 0, 'unrelated/mismatched message ignored');
    h.reply(frame, { revision: 'valid' });
    cleaned(h);
  }
  // Concurrent revision reads cannot consume each other's nonce or frame.
  {
    const h = harness(), results = [[], []];
    for (let i = 0; i < 2; i++) h.window.revisionFixture.read(value => results[i].push(value), () => {});
    h.advance(3000);
    const first = h.requests[2], second = h.requests[3];
    assert.notEqual(first.params.get('nonce'), second.params.get('nonce'));
    h.frameReply(second, envelope('wrong-nonce'), { data: {
      kind: 'SHUMI_LIBRARY_REVISION_FRAME_V1', nonce: first.params.get('nonce'), envelope: envelope('wrong-nonce')
    } });
    assert.deepEqual(results, [[], []]);
    h.reply(first, { revision: 'first' });
    assert.equal(results[0][0].revision, 'first');
    assert.equal(results[1].length, 0);
    assert.equal(h.activeFrames.size, 1);
    assert.equal(h.messageListeners.size, 1);
    h.reply(second, { revision: 'second' });
    assert.equal(results[1][0].revision, 'second');
    cleaned(h);
  }
  // An authenticated malformed/API-error envelope fails only the backup.
  for (const invalid of [null, {}, { data: { revision: 'forged' } },
    { ok: false, data: { revision: 'forged' } }, { ok: true },
    envelope(''), envelope('   '), envelope(12), { ok: true, data: 'text' }]) {
    const { h, results, frame } = withFrame();
    h.frameReply(frame, invalid);
    assert.equal(results.length, 0, 'failed backup leaves primary pending');
    assert.equal(h.activeFrames.size, 0);
    assert.equal(h.messageListeners.size, 0);
    assert.equal(h.activeScripts.size, 1);
    assert.equal(h.notifications.length, 0);
    h.reply(h.requests[0], { revision: 'primary' });
    assert.equal(results[0].value.revision, 'primary');
    cleaned(h);
  }
  // No crypto, thrown crypto, or frame setup failure must not create a third request.
  for (const mode of ['missing', 'throws', 'frame setup']) {
    const { h, results } = begin();
    if (mode === 'missing') delete h.window.crypto;
    if (mode === 'throws') h.window.crypto = { getRandomValues() { throw new Error('Unavailable'); } };
    if (mode === 'frame setup') h.document.body.appendChild = () => { throw new Error('Unavailable'); };
    h.advance(3000);
    assert.equal(h.requests.length, 1);
    assert.equal(h.activeFrames.size, 0);
    assert.equal(h.messageListeners.size, 0);
    assert.equal(results.length, 0, 'unavailable backup keeps primary pending');
    h.reply(h.requests[0], { revision: 'primary' });
    h.advance(60000);
    assert.equal(h.requests.length, 1, 'no JSONP replacement or third request');
    cleaned(h);
  }
  // A primary win removes an already-started frame; captured late handlers are inert.
  {
    const { h, results, frame } = withFrame();
    const lateListener = Array.from(h.messageListeners)[0], lateError = frame.frame.onerror;
    h.reply(h.requests[0], { revision: 'primary' });
    lateListener({ origin: 'https://script.googleusercontent.com', source: frame.frame.contentWindow,
      data: { kind: 'SHUMI_LIBRARY_REVISION_FRAME_V1', nonce: frame.params.get('nonce'), envelope: envelope('late') } });
    lateError();
    assert.equal(results.length, 1);
    assert.equal(results[0].value.revision, 'primary');
    cleaned(h);
  }
  // A matched frame mismatch never enables stale local results before downloading.
  {
    const h = harness();
    h.window.revisionFixture.activate(payload(), false);
    const refresh = h.window.ShumiLibraryLocalIndex.checkForUpdates();
    await flush();
    h.advance(3000);
    h.reply(h.requests[1], { revision: 'new-revision' });
    await flush();
    const full = h.requests.find(request => request.params.get('api') === 'localIndex');
    assert(full);
    assert.equal(h.window.ShumiLibraryLocalIndex.countMatches([]), null);
    const fresh = payload(); fresh.revision = 'new-revision';
    h.reply(full, fresh);
    await refresh;
    assert.equal(h.window.ShumiLibraryLocalIndex.getFreshnessState(), 'fresh');
    assert.equal(h.window.ShumiLibraryLocalIndex.getRevision(), 'new-revision');
    cleaned(h);
  }
  // A force update during synchronous frame registration cleans up once the
  // transport returns its cancellation handle, and still starts one full download.
  for (const immediateSuccess of [false, true]) {
    const h = harness(), manager = h.window.ShumiLibraryLocalIndex;
    h.window.revisionFixture.activate(payload(), false);
    const append = h.document.body.appendChild;
    let force;
    h.document.body.appendChild = function(frame) {
      append(frame);
      if (new URL(frame.src).searchParams.get('transport') !== 'revisionFrame') return;
      force = manager.forceRefresh();
      if (immediateSuccess) h.reply(h.requests[h.requests.length - 1], { revision: 'revision-one' });
    };
    const auto = manager.checkForUpdates();
    await flush();
    h.advance(3000);
    assert(force);
    assert.equal(h.activeFrames.size, 0);
    assert.equal(h.messageListeners.size, 0);
    await flush();
    const full = h.requests.find(request => request.params.get('api') === 'localIndex');
    assert(full);
    h.reply(full, payload());
    assert.equal((await force).success, true);
    await auto;
    assert.equal(h.requests.length, 3);
    cleaned(h);
  }
  console.log('library revision frame checks ok: secure nonce, exact origin, bounded source ancestry, envelope validation, quiet failure, cleanup, force races and strict freshness');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
