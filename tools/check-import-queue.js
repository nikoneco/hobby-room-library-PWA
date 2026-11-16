const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const source = ['config.js', 'LibraryEdits.js', 'NewBookImport.js']
  .map(file => fs.readFileSync(path.join(root, file), 'utf8')).join('\n');
const pendingKey = 'newBookImport.pending.v1';
const editKey = 'library.edit.pending.v1.fixture';

// Real lock/queue orchestration with isolated Apps Script services. No live I/O.
function fixture() {
  const properties = new Map();
  const triggers = [];
  const state = { busy: true, stages: [], toasts: [], acquired: 0, released: 0, id: 0 };
  const spreadsheet = { getId: () => 'fixture-spreadsheet', toast: text => state.toasts.push(text) };
  const context = vm.createContext({
    console: { log() {}, error() {} },
    PropertiesService: { getScriptProperties: () => ({
      getProperty: key => properties.get(key) ?? null,
      getProperties: () => Object.fromEntries(properties),
      setProperty: (key, value) => properties.set(key, value),
      deleteProperty: key => properties.delete(key)
    }) },
    SpreadsheetApp: { getActive: () => spreadsheet, getActiveSpreadsheet: () => spreadsheet,
      flush: () => state.stages.push('flush') },
    Utilities: { getUuid: () => 'request-' + ++state.id },
    LockService: {
      getScriptLock: () => ({
        tryLock: () => { if (state.busy) return false; state.busy = true; state.acquired++; return true; },
        releaseLock: () => { state.busy = false; state.released++; }
      }),
      getUserLock: () => ({ tryLock: () => true, releaseLock() {} })
    },
    ScriptApp: {
      getProjectTriggers: () => triggers.slice(),
      deleteTrigger: trigger => triggers.splice(triggers.indexOf(trigger), 1),
      newTrigger: handler => {
        const id = 'trigger-' + ++state.id;
        const builder = { timeBased: () => builder, after: () => builder, create: () => {
          const trigger = { getHandlerFunction: () => handler, getUniqueId: () => id };
          triggers.push(trigger);
          return trigger;
        } };
        return builder;
      }
    }
  });
  vm.runInContext(source, context);
  const stage = (name, result = {}) => () => { state.stages.push(name); return result; };
  Object.assign(context, {
    getSheet: () => { assert.equal(context.getLibrarySpreadsheet_(), spreadsheet); return {}; },
    beginRakutenBooks429RetryBudget_: stage('begin'), endRakutenBooks429RetryBudget_: stage('end'),
    ensureSynopsisColumns_: stage('synopsisColumns'), ensureFallbackImageColumns_: stage('imageColumns'),
    fillMissingYomiganaForImport_: stage('yomi', { changed: 0, error: 0 }),
    refreshSeriesKeyAutoForImport_: stage('series', { changed: 0 }),
    repairBookUuidsAll_: stage('uuid', { changed: 0 }),
    batchFetchSynopsisRawByLimit_: stage('synopsis', { processed: 0 }),
    retryNotFoundSynopsisFromRakutenKobo_: stage('kobo', { processed: 0, error: 0 }),
    batchFillFallbackImageUrlsByLimit_: stage('image', { processed: 0 }),
    clearLibrarySearchCache_: stage('cache')
  });
  const retry = () => {
    assert.equal(triggers.length, 1, 'exactly one one-shot worker exists');
    return context.retryLibraryEdits_({ triggerUid: triggers[0].getUniqueId() });
  };
  const addEdit = () => properties.set(editKey, JSON.stringify({
    source: spreadsheet.getId(), created: 1, kind: 'title', rows: [{ uuid: 'retained-identity' }], attempts: 0
  }));
  return { context, properties, triggers, state, spreadsheet, retry, addEdit };
}

let cases = 0;
function test(name, run) {
  try { run(); cases++; }
  catch (error) { error.message = `${name}: ${error.message}`; throw error; }
}

test('a busy lock queues one confirmed import without sheet writes or a thrown error', () => {
  const f = fixture();
  assert.equal(f.context.enrichNewBooksAfterImport_().queued, true);
  const first = f.properties.get(pendingKey);
  assert.equal(JSON.parse(first).limit, 20);
  assert.equal(JSON.parse(first).attempts, 0);
  assert.equal(f.context.enrichNewBooksAfterImport_().queued, true);
  assert.equal(f.properties.get(pendingKey), first, 'duplicate clicks share the pending batch');
  assert.equal(f.triggers.length, 1);
  assert.deepEqual(f.state.stages, []);
  assert.equal(f.state.released, 0, 'never release another execution\'s lock');
  assert.match(f.state.toasts.at(-1), /予約/);
});

test('busy workers preserve all retry attempts until the active edit finishes', () => {
  const f = fixture();
  f.context.enrichNewBooksAfterImport_();
  for (let i = 0; i < 10; i++) assert.equal(f.retry().queued, true);
  assert.equal(JSON.parse(f.properties.get(pendingKey)).attempts, 0);
  assert.deepEqual(f.state.stages, []);
  f.state.busy = false;
  const result = f.retry();
  assert.equal(result.limit, 20);
  assert.equal(f.properties.has(pendingKey), false);
  assert.ok(f.state.stages.indexOf('flush') < f.state.stages.indexOf('cache'));
  assert.equal(f.state.acquired, 1);
  assert.equal(f.state.released, 1);
  f.retry();
  assert.equal(f.triggers.length, 0, 'empty successor removes itself');
});

test('the queued import runs before the edit backlog without consuming edit identities', () => {
  const f = fixture();
  f.addEdit();
  const before = f.properties.get(editKey);
  f.context.enrichNewBooksAfterImport_();
  f.state.busy = false;
  assert.equal(f.context.processLibraryEditQueue_(f.spreadsheet, true).importPending, true);
  assert.equal(f.state.acquired, 0);
  f.context.processLibraryEditQueue_ = () => { throw Error('edit backlog ran before import'); };
  assert.equal(f.retry().limit, 20);
  assert.equal(f.properties.get(editKey), before);
  assert.equal(f.context.hasPendingNewBookImport_(), false);
});

test('three real failures stop automatically and a confirmed manual retry can recover', () => {
  const f = fixture();
  f.context.enrichNewBooksAfterImport_();
  f.state.busy = false;
  f.context.ensureSynopsisColumns_ = () => {
    const request = JSON.parse(f.properties.get(pendingKey));
    assert.ok(request.attempts > 0, 'attempt is checkpointed before expensive sheet work');
    throw Error('simulated Sheets failure');
  };
  for (let attempt = 1; attempt <= 3; attempt++) {
    assert.match(f.retry().error, /simulated Sheets failure/);
    assert.equal(JSON.parse(f.properties.get(pendingKey)).attempts, attempt);
    assert.equal(f.state.busy, false);
  }
  f.retry();
  assert.equal(f.triggers.length, 0);
  assert.equal(f.properties.has(pendingKey), true, 'failed request is retained for inspection');
  f.context.ensureSynopsisColumns_ = () => {};
  assert.equal(f.context.enrichNewBooksAfterImport_().limit, 20);
  assert.equal(f.properties.has(pendingKey), false);
  assert.equal(f.state.acquired, f.state.released);
});

test('a queued request cannot run against a different spreadsheet', () => {
  const f = fixture();
  f.context.enrichNewBooksAfterImport_();
  f.state.busy = false;
  assert.throws(() => f.context.processPendingNewBookImport_({ getId: () => 'wrong-spreadsheet' }), /does not match/);
  f.context.SpreadsheetApp.getActiveSpreadsheet = () => ({ getId: () => 'wrong-spreadsheet' });
  assert.throws(() => f.retry(), /does not match/);
  assert.deepEqual(f.state.stages, []);
  assert.equal(f.properties.has(pendingKey), true);
});

test('a request already consumed while waiting for the lock cannot run twice', () => {
  const f = fixture();
  f.context.enrichNewBooksAfterImport_();
  f.state.busy = false;
  const original = f.context.LockService.getScriptLock;
  f.context.LockService.getScriptLock = () => {
    f.properties.delete(pendingKey); // Another execution completed while this one waited.
    return original();
  };
  assert.equal(f.context.processPendingNewBookImport_(f.spreadsheet).stale, true);
  assert.deepEqual(f.state.stages, []);
  assert.equal(f.state.released, 1);
});

test('an uncontended button call completes immediately and installs no trigger', () => {
  const f = fixture();
  f.state.busy = false;
  assert.equal(f.context.enrichNewBooksAfterImport_().limit, 20);
  assert.equal(f.triggers.length, 0);
  assert.equal(f.properties.has(pendingKey), false);
});

test('successful queue cleanup happens before another worker can acquire the lock', () => {
  const f = fixture();
  f.context.enrichNewBooksAfterImport_();
  f.state.busy = false;
  const original = f.context.LockService.getScriptLock;
  f.context.LockService.getScriptLock = () => {
    const lock = original();
    return { ...lock, releaseLock: () => {
      assert.equal(f.properties.has(pendingKey), false, 'completed request is consumed while still locked');
      lock.releaseLock();
    } };
  };
  assert.equal(f.retry().limit, 20);
});

test('the public button still requires Sheets confirmation before queueing any work', () => {
  const f = fixture();
  f.context.SpreadsheetApp.getUi = () => ({
    alert: () => 'cancel', ButtonSet: { OK_CANCEL: 'confirm' }, Button: { OK: 'ok' }
  });
  assert.equal(f.context.enrichNewBooksAfterImport().cancelled, true);
  assert.equal(f.properties.size, 0);
  assert.equal(f.triggers.length, 0);
  assert.deepEqual(f.state.stages, []);
});

console.log(`Import queue checks passed (${cases} cases).`);
