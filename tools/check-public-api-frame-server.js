const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const nonce = '0123456789abcdef0123456789abcdef';
const source = fs.readFileSync(path.join(root, 'Webアプリ.js'), 'utf8');
let passed = 0;
function context() {
  const ctx = vm.createContext({
    Date, console: { log() {}, error() {}, warn() {} },
    Utilities: {
      base64DecodeWebSafe: text => [...Buffer.from(text, 'base64url')],
      newBlob: bytes => ({ getDataAsString: () => Buffer.from(bytes).toString('utf8') })
    },
    HtmlService: {
      XFrameOptionsMode: { ALLOWALL: 'ALLOWALL' },
      createHtmlOutput(html) { return { html, mode: null, setXFrameOptionsMode(mode) { this.mode = mode; return this; } }; },
      createTemplateFromFile(name) { return { evaluate: () => ({ native: name }) }; }
    },
    ContentService: {
      MimeType: { JAVASCRIPT: 'javascript' },
      createTextOutput(body) { return { body, setMimeType() { return this; } }; }
    }
  });
  vm.runInContext(fs.readFileSync(path.join(root, 'config.js'), 'utf8'), ctx);
  vm.runInContext(source, ctx);
  return ctx;
}
function request(ctx, api, params = {}) { return ctx.doGet({ parameter: { api, transport: 'apiFrame', nonce, ...params } }); }
function message(output) {
  assert.equal(output.mode, 'ALLOWALL');
  const inline = output.html.match(/<script>([\s\S]*?)<\/script>/)[1];
  let result;
  vm.runInNewContext(inline, { window: { top: { postMessage(data, origin) { result = { data: JSON.parse(JSON.stringify(data)), origin }; } } } });
  assert.equal(result.origin, 'https://nikoneco.github.io');
  return result.data;
}
function test(fn) { fn(); passed += 1; }
test(() => {
  const ctx = context();
  let calls = 0;
  ctx.dispatchWebAppJsonpApi_ = () => { calls += 1; return []; };
  for (const api of ['', 'unknown', 'constructor', 'toString', '__proto__', 'setPreferences', 'diagnoseLibraryColdRead_']) {
    const out = request(ctx, api); assert.equal(out.mode, null); assert(!out.html.includes('postMessage'));
  }
  for (const bad of ['', nonce.slice(1), nonce + '0', '</script>']) assert.equal(request(ctx, 'initial', { nonce: bad }).mode, null);
  assert.equal(calls, 0);
});
test(() => {
  const ctx = context();
  const apis = vm.runInContext('Object.keys(PUBLIC_WEBAPP_JSONP_API_HANDLERS_)', ctx);
  ctx.dispatchWebAppJsonpApi_ = api => ({ result: [api, 'fixture'] });
  for (const api of apis) {
    const reply = message(request(ctx, api));
    assert.equal(reply.kind, 'SHUMI_LIBRARY_API_FRAME_V1'); assert.equal(reply.api, api); assert.equal(reply.nonce, nonce);
    const legacy = ctx.doGet({ parameter: { api, callback: 'cb' } });
    assert.deepEqual(reply.envelope, JSON.parse(legacy.body.slice(3, -2)));
  }
});
test(() => {
  const ctx = context();
  const query = '日本語 😈 & <fixture>';
  let calls = 0;
  ctx.searchBooksSimple = keyword => { calls += 1; assert.equal(keyword, query); return [{ title: query }]; };
  const reply = message(request(ctx, 'searchSimple', { keywordB64: Buffer.from(query).toString('base64url') }));
  assert.deepEqual(reply.envelope.data, [{ title: query }]); assert.equal(calls, 1);
});
test(() => {
  const ctx = context();
  let calls = 0;
  ctx.getBookDetailsByIds = ids => { calls += 1; assert.equal(ids, 'fixture-1,fixture-2'); return [{ bookId: 'fixture-1' }]; };
  const reply = message(request(ctx, 'bookDetailsByIds', { bookIds: 'fixture-1,fixture-2' }));
  assert.equal(reply.envelope.data[0].bookId, 'fixture-1'); assert.equal(calls, 1);
});
test(() => {
  const ctx = context();
  for (const value of [0, null, [], { text: '</script><img src=x>&日本語😈\u2028\u2029'.repeat(40000) }]) {
    ctx.dispatchWebAppJsonpApi_ = () => value;
    const out = request(ctx, 'initial');
    assert(!out.html.includes('<img')); assert(!out.html.includes('\u2028')); assert(!out.html.includes('\u2029'));
    assert.deepEqual(message(out).envelope.data, value);
  }
});
test(() => {
  const ctx = context();
  ctx.dispatchWebAppJsonpApi_ = () => { throw Error('PRIVATE_FIXTURE_ERROR'); };
  const out = request(ctx, 'localIndex');
  assert(!out.html.includes('PRIVATE_FIXTURE_ERROR'));
  assert.deepEqual(message(out).envelope, { ok: false, data: null, error: { api: 'localIndex', message: 'API request failed' } });
});
test(() => {
  const ctx = context();
  ctx.Utilities.base64DecodeWebSafe = () => { throw Error('PRIVATE_DECODER_ERROR'); };
  let calls = 0;
  // Existing decoder intentionally falls back to an empty keyword; keep parity.
  ctx.searchBooksSimple = keyword => { calls += 1; assert.equal(keyword, ''); return []; };
  const out = request(ctx, 'searchSimple', { keywordB64: 'fixture' });
  assert(!out.html.includes('PRIVATE_DECODER_ERROR')); assert.equal(message(out).envelope.ok, true); assert.equal(calls, 1);
  ctx.decodeWebAppJsonpParams_ = () => { throw Error('PRIVATE_PARAMS_ERROR'); };
  const failed = request(ctx, 'searchSimple');
  assert(!failed.html.includes('PRIVATE_PARAMS_ERROR')); assert.equal(message(failed).envelope.ok, false); assert.equal(calls, 1);
});
test(() => {
  const ctx = context();
  ctx.dispatchWebAppJsonpApi_ = (api, params, perf) => { assert(perf); perf.sourceCount = 2; return ['fixture']; };
  const reply = message(request(ctx, 'initial', { perf: '1' })).envelope;
  assert.equal(reply.perf.sourceCount, 2); assert.equal(reply.perf.version, 2); assert(Number.isFinite(reply.perf.serverMs));
});
console.log(`Public API frame server checks ok (${passed})`);
