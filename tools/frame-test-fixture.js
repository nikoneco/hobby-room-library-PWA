// Bridge existing deterministic JSONP reply mocks to actual frame messages.
// Production frame URLs are retained on `script.frame`; only the mock projection
// receives a synthetic callback URL, which dispatches the authenticated envelope.
function installFrameFixture(window, document) {
  if (window.__frameFixture) return window.__frameFixture;
  const listeners = new Set(), activeFrames = new Set(), callbacks = Object.create(null);
  let sequence = 0;
  const add = window.addEventListener, remove = window.removeEventListener;
  window.addEventListener = function(type, handler, ...rest) {
    if (type === 'message') listeners.add(handler);
    else if (typeof add === 'function') add.call(this, type, handler, ...rest);
  };
  window.removeEventListener = function(type, handler, ...rest) {
    if (type === 'message') listeners.delete(handler);
    else if (typeof remove === 'function') remove.call(this, type, handler, ...rest);
  };
  window.crypto = require('node:crypto').webcrypto;
  window.__fixtureFrameCallbacks = new Proxy(callbacks, { get: (target, key) => target[key] || (() => {}) });
  const create = document.createElement;
  document.createElement = function(tag) {
    const node = create.call(this, tag);
    if (tag === 'iframe') {
      node.style = node.style || {};
      node.setAttribute = node.setAttribute || (() => {});
      node.contentWindow = { parent: window };
    }
    return node;
  };
  document.body = document.body || {};
  const message = event => Array.from(listeners).forEach(handler => handler(event));
  const reply = (frame, envelope, overrides = {}) => {
    const params = new URL(frame.src).searchParams;
    message(Object.assign({
      origin: 'https://fixture-script.googleusercontent.com', source: frame.contentWindow,
      data: { kind: params.get('transport') === 'revisionFrame' ? 'SHUMI_LIBRARY_REVISION_FRAME_V1' : 'SHUMI_LIBRARY_API_FRAME_V1',
        api: params.get('api'), nonce: params.get('nonce'), envelope }
    }, overrides));
  };
  document.body.appendChild = function(frame) {
    activeFrames.add(frame);
    const key = 'f' + (++sequence), url = new URL(frame.src);
    callbacks[key] = envelope => reply(frame, envelope && envelope.ok === false
      ? Object.assign({ data: null }, envelope) : envelope);
    url.searchParams.set('callback', '__fixtureFrameCallbacks.' + key);
    const projection = { src: url.toString(), frame };
    Object.defineProperty(projection, 'onerror', { get: () => frame.onerror, set: value => { frame.onerror = value; } });
    frame.parentNode = { removeChild() {
      activeFrames.delete(frame);
      delete callbacks[key];
      const parent = projection.parentNode;
      if (parent && typeof parent.removeChild === 'function') parent.removeChild(projection);
      frame.parentNode = null;
      projection.parentNode = null;
    } };
    document.head.appendChild(projection);
    return frame;
  };
  return (window.__frameFixture = { message, reply, activeFrames, listeners });
}
module.exports = { installFrameFixture };
