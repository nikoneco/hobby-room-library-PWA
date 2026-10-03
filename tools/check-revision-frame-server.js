const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const web = fs.readFileSync(path.join(root, 'Webアプリ.js'), 'utf8');
const nonce = '0123456789abcdef0123456789abcdef';
let count = 0;
function makeContext() {
  const state = { reads: 0, data: { version: 1, revision: 'revision-fixture' } };
  const context = vm.createContext({
    Date, console: { error() {}, warn() {}, log() {} },
    HtmlService: {
      XFrameOptionsMode: { ALLOWALL: 'ALLOWALL' },
      createHtmlOutput(html) {
        return { kind: 'html', html, mode: null, setXFrameOptionsMode(mode) { this.mode = mode; return this; } };
      },
      createTemplateFromFile(name) { return { evaluate: () => ({ kind: 'native', name }) }; }
    },
    ContentService: {
      MimeType: { JAVASCRIPT: 'javascript' },
      createTextOutput(body) { return { kind: 'jsonp', body, setMimeType(mime) { this.mime = mime; return this; } }; }
    }
  });
  vm.runInContext(fs.readFileSync(path.join(root, 'config.js'), 'utf8'), context);
  vm.runInContext(web, context);
  context.getLibraryDatasetRevisionForPwa_ = () => {
    state.reads += 1;
    if (state.error) throw state.error;
    return state.data;
  };
  return { context, state };
}
function request(context, params) { return context.doGet({ parameter: params }); }
function message(output) {
  assert.equal(output.kind, 'html');
  const script = output.html.match(/<script>([\s\S]*?)<\/script>/)[1];
  let result;
  vm.runInNewContext(script, { window: { top: { postMessage(payload, origin) { result = { payload: JSON.parse(JSON.stringify(payload)), origin }; } } } });
  return result;
}
function test(fn) { fn(); count += 1; }

test(() => {
  const { context, state } = makeContext();
  const jsonp = request(context, { api: 'libraryRevision', callback: 'cb' });
  assert.equal(jsonp.kind, 'jsonp');
  assert.equal(jsonp.body, 'cb({"ok":true,"data":{"version":1,"revision":"revision-fixture"},"error":null});');
  assert.equal(state.reads, 1);
  assert.equal(request(context, {}).kind, 'native');
  assert.equal(request(context, { transport: 'revisionFrame', nonce }).kind, 'native');
});
test(() => {
  const { context, state } = makeContext();
  const output = request(context, { api: 'libraryRevision', transport: 'revisionFrame', nonce, targetOrigin: 'https://untrusted.invalid' });
  assert.equal(output.mode, 'ALLOWALL');
  const reply = message(output);
  assert.equal(reply.origin, 'https://nikoneco.github.io');
  assert.deepEqual(reply.payload, { kind: 'SHUMI_LIBRARY_REVISION_FRAME_V1', nonce, envelope: { ok: true, data: state.data, error: null } });
  assert.equal(state.reads, 1);
});
test(() => {
  const { context, state } = makeContext();
  for (const bad of [undefined, '', nonce.slice(1), nonce + '0', 'g'.repeat(32), '</script><script>bad()</script>']) {
    const output = request(context, { api: 'libraryRevision', transport: 'revisionFrame', nonce: bad });
    assert.equal(output.kind, 'html'); assert.equal(output.mode, null);
    assert(!output.html.includes('postMessage')); assert(!output.html.includes('<script>'));
  }
  assert.equal(state.reads, 0);
});
test(() => {
  const { context, state } = makeContext();
  state.data.revision = '</script><img src=x onerror=bad()>&\u2028\u2029';
  const output = request(context, { api: 'libraryRevision', transport: 'revisionFrame', nonce });
  assert(!output.html.includes('<img')); assert(!output.html.includes('</script><img'));
  assert(!output.html.includes('\u2028')); assert(!output.html.includes('\u2029'));
  assert.equal(message(output).payload.envelope.data.revision, state.data.revision);
});
test(() => {
  const { context, state } = makeContext();
  state.error = new Error('PRIVATE_FIXTURE_DO_NOT_PUBLISH');
  const output = request(context, { api: 'libraryRevision', transport: 'revisionFrame', nonce });
  assert(!output.html.includes(state.error.message));
  const reply = message(output).payload.envelope;
  assert.equal(reply.ok, false); assert.equal(reply.data, null);
  assert.equal(reply.error.message, 'Revision request failed');
});
test(() => {
  const { context, state } = makeContext();
  context.searchBooksSimple = () => ['fixture'];
  const output = request(context, { api: 'searchSimple', transport: 'revisionFrame', nonce, callback: 'cb' });
  assert.equal(output.kind, 'jsonp');
  assert.equal(output.body, 'cb({"ok":true,"data":["fixture"],"error":null});');
  assert.equal(state.reads, 0);
});
test(() => {
  const { context } = makeContext();
  const reply = message(request(context, { api: 'libraryRevision', transport: 'revisionFrame', nonce, perf: '1' })).payload.envelope;
  assert.equal(reply.perf.version, 2); assert(Number.isFinite(reply.perf.serverMs));
  assert(reply.perf.serverResponseReadyAtEpochMs >= reply.perf.serverStartedAtEpochMs);
  assert.equal(reply.data.revision, 'revision-fixture');
});
console.log(`Revision frame server checks ok (${count})`);
