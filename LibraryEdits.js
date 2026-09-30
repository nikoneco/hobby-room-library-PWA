/** @OnlyCurrentDoc */

const LIBRARY_EDIT_CONFIG_ = Object.freeze({
  PREFIX: 'library.edit.pending.v1.',
  SOURCE_PROPERTY: 'library.edit.source.v1',
  RETRY_HANDLER: 'retryLibraryEdits_',
  CAPTURE_ROWS: 4,
  BATCH_ROWS: 4,
  PROPERTY_BYTES: 7500,
  LOCK_WAIT_MS: 250,
  RETRY_MS: 60000,
  MAX_RETRIES: 8
});

// Execution-local context. Time triggers must open the saved bound source;
// registry helpers must not infer a spreadsheet from an active browser tab.
let libraryEditSpreadsheet_ = null;
function getLibrarySpreadsheet_() {
  return libraryEditSpreadsheet_ || SpreadsheetApp.getActive();
}

function withLibraryEditSpreadsheet_(spreadsheet, action) {
  const previous = libraryEditSpreadsheet_;
  libraryEditSpreadsheet_ = spreadsheet;
  try { return action(); } finally { libraryEditSpreadsheet_ = previous; }
}

function rememberLibraryEditSource_(spreadsheet) {
  const properties = PropertiesService.getScriptProperties();
  const id = spreadsheet.getId();
  const existing = properties.getProperty(LIBRARY_EDIT_CONFIG_.SOURCE_PROPERTY);
  if (existing && existing !== id) throw new Error('Library edit source does not match the bound spreadsheet.');
  if (!existing) properties.setProperty(LIBRARY_EDIT_CONFIG_.SOURCE_PROPERTY, id);
}

function getLibraryEditKind_(range) {
  const name = range.getSheet().getName();
  const endRow = range.getRow() + range.getNumRows() - 1;
  const col = range.getColumn();
  const endCol = col + range.getNumColumns() - 1;
  if (endRow < 2) return '';
  const touches = target => col <= target && endCol >= target;
  if (name === CONFIG.SHEETS.MAIN) {
    if (touches(CONFIG.COL.SERIES_KEY_AUTO)) return 'manual';
    if (touches(CONFIG.COL.TITLE)) return 'title';
    if (touches(CONFIG.COL.BOOK_UUID)) return 'uuid';
  }
  if (name === SERIES_REGISTRY_CONFIG_.MASTER_SHEET && col <= SERIES_REGISTRY_CONFIG_.MASTER_HEADERS.length) return 'master';
  if (name === SERIES_REGISTRY_CONFIG_.ALIAS_SHEET && col <= 4) return 'alias';
  return '';
}

function libraryEditByteLength_(text) {
  return encodeURIComponent(text).replace(/%[0-9A-F]{2}/gi, 'x').length;
}

// Each event owns its own property keys. No shared read/modify/write queue
// index can overwrite an edit captured while an import holds ScriptLock.
function writeLibraryEditRecord_(key, record) {
  const properties = PropertiesService.getScriptProperties();
  const json = JSON.stringify(record);
  if (libraryEditByteLength_(json) <= LIBRARY_EDIT_CONFIG_.PROPERTY_BYTES) {
    properties.setProperty(key, json);
    return;
  }
  const parts = [];
  let start = 0;
  while (start < json.length) {
    let end = Math.min(json.length, start + 1800);
    // Do not split a UTF-16 surrogate pair.
    if (end < json.length && /[\uD800-\uDBFF]/.test(json[end - 1])) end--;
    parts.push(json.slice(start, end));
    start = end;
  }
  parts.forEach((part, index) => properties.setProperty(key + '.p' + index, part));
  // The manifest is published last: readers consume only complete records.
  properties.setProperty(key, JSON.stringify({ parts: parts.length }));
}

function captureLibraryEdit_(e, simpleOnly) {
  const range = e.range;
  const sheet = range.getSheet();
  const name = sheet.getName();
  if (name === CONFIG.SHEETS.MAIN && range.getA1Notation() === 'A1') return;
  const single = range.getNumRows() === 1 && range.getNumColumns() === 1;
  const manualEventCurrent = !(single && range.getColumn() === CONFIG.COL.SERIES_KEY_AUTO &&
    ('value' in e || 'oldValue' in e)) ||
    String(range.getValue() || '') === String(e.value || '');
  // Installed processing may finish before the simple trigger arrives. An
  // old clear event must not mark the newly derived X as a fresh manual value.
  // Multi-cell events have no e.value; only the installed capture marks them.
  if ((!simpleOnly || single) && manualEventCurrent) markSeriesKeyManualOnEdit_(e);
  handleFallbackImageManualEdit_(e);
  if (name === CONFIG.SHEETS.MAIN) markSynopsisManualOnEdit_(e);
  if (shouldClearLibrarySearchCacheOnEdit_(name, range)) clearLibrarySearchCache_();
  if (simpleOnly) return { captured: 0 };
  if (!manualEventCurrent) return { stale: true, captured: 0 };
  const kind = getLibraryEditKind_(range);
  if (!kind) return { captured: 0 };
  const created = Date.now();
  const source = sheet.getParent().getId();
  if (kind === 'master' || kind === 'alias') {
    writeLibraryEditRecord_(LIBRARY_EDIT_CONFIG_.PREFIX + Utilities.getUuid(), {
      source, created, kind, rows: [], attempts: 0
    });
    return { captured: 1 };
  }
  const first = Math.max(2, range.getRow());
  const last = range.getRow() + range.getNumRows() - 1;
  let captured = 0;
  for (let row = first; row <= last; row += LIBRARY_EDIT_CONFIG_.CAPTURE_ROWS) {
    const count = Math.min(LIBRARY_EDIT_CONFIG_.CAPTURE_ROWS, last - row + 1);
    // Capture only the edited rows, never full registry/catalog scans.
    const values = sheet.getRange(row, CONFIG.COL.TITLE, count,
      CONFIG.COL.SERIES_KEY_AUTO - CONFIG.COL.TITLE + 1).getDisplayValues();
    const rows = values.map(values => {
      const uuid = normalizeBookUuid_(values[CONFIG.COL.BOOK_UUID - CONFIG.COL.TITLE]);
      const anchor = { uuid, oldKey: String(values[CONFIG.COL.SERIES_KEY_AUTO - CONFIG.COL.TITLE] || '') };
      // UUID-bearing books need no stale title/ISBN payload. Keep the queue
      // small enough for bulk edits within Script Properties' total quota.
      if (!isValidBookUuid_(uuid)) {
        anchor.title = String(values[0] || '');
        anchor.isbn = String(values[CONFIG.COL.ISBN - CONFIG.COL.TITLE] || '');
      }
      return anchor;
    });
    writeLibraryEditRecord_(LIBRARY_EDIT_CONFIG_.PREFIX + Utilities.getUuid(), {
      source, created, kind, rows, attempts: 0
    });
    captured += count;
  }
  return { captured };
}

function readLibraryEditQueue_() {
  const snapshot = PropertiesService.getScriptProperties().getProperties();
  const records = [];
  Object.keys(snapshot).filter(key => key.startsWith(LIBRARY_EDIT_CONFIG_.PREFIX) &&
    !/\.(?:(?:p|b)\d+|r[\w-]+)$/.test(key)).forEach(key => {
    try {
      let data = JSON.parse(snapshot[key]);
      const keys = [key];
      if (data.parts) {
        let json = '';
        for (let index = 0; index < data.parts; index++) {
          const partKey = key + '.p' + index;
          if (!(partKey in snapshot)) throw new Error('Incomplete library edit record.');
          json += snapshot[partKey];
          keys.push(partKey);
        }
        data = JSON.parse(json);
      }
      if (!Array.isArray(data.rows) || !data.source || !data.kind) throw new Error('Invalid library edit record.');
      const bindings = data.rows.map((_, index) => {
        const bindingKey = key + '.b' + index;
        if (snapshot[bindingKey]) keys.push(bindingKey);
        return snapshot[bindingKey] || '';
      });
      const attempts = Object.keys(snapshot).filter(candidate => candidate.startsWith(key + '.r'));
      keys.push(...attempts);
      data.attempts = attempts.length;
      records.push({ key, keys, data, bindings });
    } catch (error) { console.error('library edit queue read failed:', key, String(error)); }
  });
  records.sort((a, b) => a.data.created - b.data.created || a.key.localeCompare(b.key));
  return records;
}

function handleInstalledLibraryEdit_(e) {
  const spreadsheet = e.range.getSheet().getParent();
  rememberLibraryEditSource_(spreadsheet);
  captureLibraryEdit_(e);
  // Schedule before attempting work so an execution timeout cannot strand the
  // durable queue. Successful work leaves at most this single empty follow-up.
  ensureLibraryEditRetry_();
  return processLibraryEditQueue_(spreadsheet);
}

function ensureLibraryEditRetry_() {
  if (!readLibraryEditQueue_().some(record => Number(record.data.attempts || 0) < LIBRARY_EDIT_CONFIG_.MAX_RETRIES)) return false;
  const lock = LockService.getUserLock();
  if (!lock.tryLock(1000)) return false;
  try {
    const existing = ScriptApp.getProjectTriggers().some(trigger =>
      trigger.getHandlerFunction() === LIBRARY_EDIT_CONFIG_.RETRY_HANDLER);
    if (existing) return false;
    ScriptApp.newTrigger(LIBRARY_EDIT_CONFIG_.RETRY_HANDLER)
      .timeBased().after(LIBRARY_EDIT_CONFIG_.RETRY_MS).create();
    return true;
  } finally { lock.releaseLock(); }
}

function retryLibraryEdits_(e) {
  // Delete this one-shot trigger before ensuring its successor. Never maintain
  // a permanent every-minute trigger when there is no work to do.
  if (e && e.triggerUid) ScriptApp.getProjectTriggers().filter(trigger =>
    trigger.getHandlerFunction() === LIBRARY_EDIT_CONFIG_.RETRY_HANDLER &&
    String(trigger.getUniqueId()) === String(e.triggerUid)).forEach(trigger => ScriptApp.deleteTrigger(trigger));
  const records = readLibraryEditQueue_();
  if (!records.some(record => Number(record.data.attempts || 0) < LIBRARY_EDIT_CONFIG_.MAX_RETRIES)) return { pending: records.length };
  const source = PropertiesService.getScriptProperties().getProperty(LIBRARY_EDIT_CONFIG_.SOURCE_PROPERTY);
  if (!source) throw new Error('Library edit source has not been configured.');
  const spreadsheet = SpreadsheetApp.openById(source);
  ensureLibraryEditRetry_();
  try { return processLibraryEditQueue_(spreadsheet, true); }
  catch (error) { console.error('library edit retry deferred:', String(error)); return { pending: readLibraryEditQueue_().length, error: String(error) }; }
}

function libraryEditAnchorKey_(anchor) {
  return isValidBookUuid_(anchor.uuid) ? anchor.uuid : JSON.stringify([anchor.uuid, anchor.title, anchor.isbn, anchor.oldKey]);
}

function readLibraryEditCatalog_(sheet) {
  // Include UUID-bearing rows whose title was just cleared, including the last
  // catalog row. They still need their derived key cleared safely.
  const last = Math.max(getLastDataRow(sheet, CONFIG.COL.TITLE), sheet.getLastRow());
  const values = last >= 2 ? sheet.getRange(2, CONFIG.COL.TITLE, last - 1,
    CONFIG.COL.SERIES_KEY_AUTO - CONFIG.COL.TITLE + 1).getDisplayValues() : [];
  const rows = values.map((values, index) => ({
    row: index + 2, title: values[0], isbn: values[CONFIG.COL.ISBN - CONFIG.COL.TITLE],
    uuid: normalizeBookUuid_(values[CONFIG.COL.BOOK_UUID - CONFIG.COL.TITLE]),
    key: values[CONFIG.COL.SERIES_KEY_AUTO - CONFIG.COL.TITLE]
  }));
  return rows;
}

function resolveLibraryEditAnchor_(sheet, catalog, record, index, resolved) {
  const anchor = record.data.rows[index];
  if (!anchor.uuid && !anchor.title && !anchor.isbn && !anchor.oldKey) return null;
  const identity = libraryEditAnchorKey_(anchor);
  let uuid = record.bindings[index] || (isValidBookUuid_(anchor.uuid) ? anchor.uuid : '');
  if (!uuid && resolved.has(identity)) uuid = resolved.get(identity).uuid;
  let matches = uuid ? catalog.filter(row => row.uuid === uuid) : [];
  if (!matches.length && !isValidBookUuid_(anchor.uuid)) {
    // New rows can acquire a UUID only when their captured contents identify
    // exactly one current row. A moved/ambiguous/deleted row is retained, never
    // rebound by its obsolete row number or used to overwrite another UUID.
    matches = catalog.filter(row => row.uuid === anchor.uuid && row.title === anchor.title &&
      row.isbn === anchor.isbn && row.key === anchor.oldKey);
    if (matches.length === 1 && anchor.title) {
      const target = matches[0];
      uuid = uuid || createUniqueBookUuid_(new Set(catalog.map(row => row.uuid)));
      const bindingKey = record.key + '.b' + index;
      PropertiesService.getScriptProperties().setProperty(bindingKey, uuid);
      record.keys.push(bindingKey);
      const latest = sheet.getRange(target.row, CONFIG.COL.TITLE, 1,
        CONFIG.COL.SERIES_KEY_AUTO - CONFIG.COL.TITLE + 1).getDisplayValues()[0];
      if (String(latest[0] || '') !== anchor.title ||
          String(latest[CONFIG.COL.ISBN - CONFIG.COL.TITLE] || '') !== anchor.isbn ||
          normalizeBookUuid_(latest[CONFIG.COL.BOOK_UUID - CONFIG.COL.TITLE]) !== anchor.uuid ||
          String(latest[CONFIG.COL.SERIES_KEY_AUTO - CONFIG.COL.TITLE] || '') !== anchor.oldKey) {
        throw new Error('Library edit identity changed before UUID allocation.');
      }
      sheet.getRange(target.row, CONFIG.COL.BOOK_UUID).setValue(uuid);
      target.uuid = uuid;
    }
  }
  if (matches.length !== 1) throw new Error('Library edit UUID is missing or ambiguous; edit retained.');
  const target = matches[0];
  if (!isValidBookUuid_(target.uuid)) throw new Error('Library edit has no stable book identity; edit retained.');
  if (!isValidBookUuid_(anchor.uuid)) {
    const bindingKey = record.key + '.b' + index;
    PropertiesService.getScriptProperties().setProperty(bindingKey, target.uuid);
    if (!record.keys.includes(bindingKey)) record.keys.push(bindingKey);
  }
  resolved.set(identity, target);
  return target;
}

function bumpLibraryEditAttempts_(records) {
  // Unique attempt keys keep captured records immutable, including multipart
  // manifests. A busy retry cannot race a shared retry counter or lose intent.
  records.forEach(record => {
    const key = record.key + '.r' + Utilities.getUuid();
    PropertiesService.getScriptProperties().setProperty(key, '1');
    record.keys.push(key);
  });
}

function groupLibraryEditRecords_(records) {
  const groups = [];
  records.forEach(record => {
    const identities = new Set(record.data.rows.map((anchor, index) =>
      record.bindings[index] || libraryEditAnchorKey_(anchor)));
    if (!identities.size) identities.add('registry');
    const overlaps = groups.filter(group => [...identities].some(key => group.identities.has(key)));
    const group = { records: [record], identities };
    overlaps.forEach(previous => {
      group.records.push(...previous.records);
      previous.identities.forEach(key => identities.add(key));
      groups.splice(groups.indexOf(previous), 1);
    });
    group.records.sort((a, b) => a.data.created - b.data.created || a.key.localeCompare(b.key));
    groups.push(group);
  });
  return groups.map(group => group.records);
}

function expandLibraryEditRecords_(records) {
  const properties = PropertiesService.getScriptProperties();
  const selectedKeys = new Set();
  records.forEach(record => {
    if (record.data.rows.length <= 1) { selectedKeys.add(record.key); return; }
    // Keep bulk captures compact, but publish independent row intents before
    // consuming their parent. A crash can leave duplicates, never lost rows.
    record.data.rows.forEach((anchor, index) => {
      const key = record.key + '.s' + index;
      if (!properties.getProperty(key)) {
        if (record.bindings[index]) properties.setProperty(key + '.b0', record.bindings[index]);
        for (let attempt = 0; attempt < record.data.attempts; attempt++) {
          properties.setProperty(key + '.rprevious' + attempt, '1');
        }
        writeLibraryEditRecord_(key, Object.assign({}, record.data, { rows: [anchor] }));
      }
      selectedKeys.add(key);
    });
    record.keys.forEach(key => properties.deleteProperty(key));
  });
  return readLibraryEditQueue_().filter(record => selectedKeys.has(record.key));
}

function processLibraryEditQueue_(spreadsheet, retryOnly) {
  const started = Date.now();
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(LIBRARY_EDIT_CONFIG_.LOCK_WAIT_MS)) {
    const pending = readLibraryEditQueue_().filter(record => record.data.source === spreadsheet.getId());
    if (retryOnly) bumpLibraryEditAttempts_(pending.filter(record => Number(record.data.attempts || 0) < LIBRARY_EDIT_CONFIG_.MAX_RETRIES));
    console.log(JSON.stringify({ operation: 'libraryEdit', busy: true, processed: 0, pending: pending.length, ms: Date.now() - started }));
    return { busy: true, pending: pending.length };
  }
  let selected = [];
  let processed = 0;
  try {
    return withLibraryEditSpreadsheet_(spreadsheet, () => {
      const source = spreadsheet.getId();
      const captured = readLibraryEditQueue_().filter(record => record.data.source === source);
      const activeIdentities = new Set(captured.filter(record =>
        Number(record.data.attempts || 0) < LIBRARY_EDIT_CONFIG_.MAX_RETRIES)
        .flatMap(record => record.data.rows.map((anchor, index) =>
          record.bindings[index] || libraryEditAnchorKey_(anchor))));
      const queue = captured.filter(record => Number(record.data.attempts || 0) < LIBRARY_EDIT_CONFIG_.MAX_RETRIES ||
        (!retryOnly && record.data.rows.some((anchor, index) =>
          activeIdentities.has(record.bindings[index] || libraryEditAnchorKey_(anchor)))));
      let count = 0;
      for (const record of queue) {
        const rows = Math.max(1, record.data.rows.length);
        if (selected.length && count + rows > LIBRARY_EDIT_CONFIG_.BATCH_ROWS) break;
        selected.push(record);
        count += rows;
      }
      if (!selected.length) return { processed: 0, pending: queue.length };
      const units = groupLibraryEditRecords_(expandLibraryEditRecords_(selected));
      let firstError = null;
      for (const unit of units) {
        selected = unit;
        try {
          // Checkpoint a scheduled attempt before heavy work. GAS termination at
          // its execution limit does not run catch/finally, so retries must still
          // have a durable bound when a service call never returns.
          if (retryOnly) bumpLibraryEditAttempts_(selected);
          const sheet = getSheet(CONFIG.SHEETS.MAIN);
          const catalog = readLibraryEditCatalog_(sheet);
          const resolved = new Map();
          const work = new Map();
          // Resolve every identity before derived writes. Coalesce repeated edits
          // by UUID, retaining the earliest title event's pre-edit X identity.
          selected.forEach(record => record.data.rows.forEach((anchor, index) => {
            const current = resolveLibraryEditAnchor_(sheet, catalog, record, index, resolved);
            if (!current) return;
            let item = work.get(current.uuid);
            if (!item) { item = { uuid: current.uuid, row: current.row, kind: 'uuid', oldKey: null }; work.set(current.uuid, item); }
            if (record.data.kind === 'manual') item.kind = 'manual';
            if (record.data.kind === 'title') {
              if (item.kind !== 'manual') item.kind = 'title';
              if (item.oldKey === null) item.oldKey = anchor.oldKey;
            }
          }));
          // Current notes outrank queued event intent, including a manual edit that
          // arrived after this snapshot. Never replay an old cell value or note.
          const items = [...work.values()].sort((a, b) => a.row - b.row);
          items.forEach(item => {
            const note = sheet.getRange(item.row, CONFIG.COL.SERIES_KEY_AUTO).getNote();
            if (hasSeriesKeyManualNote_(note) || hasSeriesKeyAutoResetNote_(note)) item.kind = 'manual';
          });
          const groups = [];
          items.forEach(item => {
            const group = groups[groups.length - 1];
            if (group && group.kind === item.kind && group.items[group.items.length - 1].row + 1 === item.row) group.items.push(item);
            else groups.push({ kind: item.kind, items: [item] });
          });
          groups.forEach(group => {
            group.items.forEach(item => {
              if (normalizeBookUuid_(sheet.getRange(item.row, CONFIG.COL.BOOK_UUID).getValue()) !== item.uuid) {
                throw new Error('Library edit row moved during synchronization; edit retained.');
              }
            });
            const column = group.kind === 'manual' ? CONFIG.COL.SERIES_KEY_AUTO :
              group.kind === 'title' ? CONFIG.COL.TITLE : CONFIG.COL.BOOK_UUID;
            onEditBody_({ range: sheet.getRange(group.items[0].row, column, group.items.length, 1),
              libraryDeferred: true, libraryOldSeriesKeys: group.items.map(item => [item.oldKey || '']) });
          });
          const master = selected.some(record => record.data.kind === 'master');
          const alias = selected.some(record => record.data.kind === 'alias');
          if (master || alias) {
            const edited = getSheet(master ? SERIES_REGISTRY_CONFIG_.MASTER_SHEET : SERIES_REGISTRY_CONFIG_.ALIAS_SHEET);
            onEditBody_({ range: edited.getRange(2, 1), libraryDeferred: true });
          }
          if (items.length && isSeriesRegistryV2Active_()) refreshSeriesRegistryUsageCountsFromCatalog_(sheet);
          SpreadsheetApp.flush();
          clearLibrarySearchCache_();
          // Delete exactly the successful snapshot, preserving independently added
          // event keys even when they concern the same UUID.
          const properties = PropertiesService.getScriptProperties();
          selected.forEach(record => record.keys.forEach(key => properties.deleteProperty(key)));
          processed += selected.length;
        } catch (error) {
          if (!retryOnly) bumpLibraryEditAttempts_(selected);
          firstError = firstError || error;
          console.error('library edit retained:', selected.map(record => record.key).join(','), String(error));
        }
      }
      if (firstError && !processed) throw firstError;
      return { processed, pending: readLibraryEditQueue_().length };
    });
  } catch (error) {
    clearLibrarySearchCache_();
    throw error;
  } finally {
    lock.releaseLock();
    console.log(JSON.stringify({ operation: 'libraryEdit', processed, pending: readLibraryEditQueue_().length, ms: Date.now() - started }));
  }
}
