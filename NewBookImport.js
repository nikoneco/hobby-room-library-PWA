/** @OnlyCurrentDoc */

const NEW_BOOK_IMPORT_CONFIG = {
  DEFAULT_LIMIT: 20,
  TEST_LIMIT: 5,
  LOCK_WAIT_MS: 10000,
  PENDING_PROPERTY: 'newBookImport.pending.v1',
  MAX_QUEUED_ATTEMPTS: 3,
  YOMIGANA_CURSOR_PREFIX: 'newBookImport.yomiganaNextRow.'
};

// Spreadsheet drawings can invoke only a top-level function without a trailing
// underscore. Keep the actual write operation private and require the Sheets UI
// confirmation before delegating to it. Calls from the web app have no Sheets UI
// context and therefore stop before any data is changed.
function enrichNewBooksAfterImport() {
  const ui = SpreadsheetApp.getUi();
  const response = ui.alert(
    '新刊登録後処理',
    '本の登録作業が完了していることを確認してください。\n\n新刊処理を最大20冊分実行し、残っているあらすじのNOT_FOUNDを最大50件Koboで再確認します。',
    ui.ButtonSet.OK_CANCEL
  );

  if (response !== ui.Button.OK) {
    SpreadsheetApp.getActive().toast('新刊登録後処理をキャンセルしました。');
    return { cancelled: true };
  }

  SpreadsheetApp.getActive().toast('新刊登録後処理を開始します。');
  return enrichNewBooksAfterImport_();
}

function enrichNewBooksAfterImport_() {
  const spreadsheet = getLibrarySpreadsheet_();
  rememberLibraryEditSource_(spreadsheet);
  const pending = readPendingNewBookImport_();
  if (pending) {
    if (pending.source !== spreadsheet.getId()) {
      throw new Error('New-book import retry does not match the saved bound spreadsheet.');
    }
    // A fresh, confirmed button click can resume a request whose automatic
    // attempts were exhausted. Ordinary duplicate clicks keep the same job.
    if (pending.attempts >= NEW_BOOK_IMPORT_CONFIG.MAX_QUEUED_ATTEMPTS) {
      pending.attempts = 0;
      PropertiesService.getScriptProperties().setProperty(NEW_BOOK_IMPORT_CONFIG.PENDING_PROPERTY, JSON.stringify(pending));
    }
    ensureLibraryEditRetry_();
    return processPendingNewBookImport_(spreadsheet);
  }

  const result = enrichNewBooksAfterImportByLimit_(NEW_BOOK_IMPORT_CONFIG.DEFAULT_LIMIT);
  if (!result.busy) return result;

  // Do not wait out a multi-minute edit retry in a Sheets button execution.
  // Reuse its one-shot worker, which will run this request before more edits.
  if (!readPendingNewBookImport_()) {
    PropertiesService.getScriptProperties().setProperty(NEW_BOOK_IMPORT_CONFIG.PENDING_PROPERTY, JSON.stringify({
      id: Utilities.getUuid(), source: spreadsheet.getId(),
      limit: NEW_BOOK_IMPORT_CONFIG.DEFAULT_LIMIT, attempts: 0
    }));
  }
  ensureLibraryEditRetry_();
  return notifyQueuedNewBookImport_(spreadsheet);
}

function enrichNewBooksAfterImportTest5_() {
  return enrichNewBooksAfterImportByLimit_(NEW_BOOK_IMPORT_CONFIG.TEST_LIMIT);
}

function readPendingNewBookImport_() {
  const json = PropertiesService.getScriptProperties().getProperty(NEW_BOOK_IMPORT_CONFIG.PENDING_PROPERTY);
  if (!json) return null;
  const request = JSON.parse(json);
  if (!request || !request.id || !request.source || !Number.isInteger(request.limit) ||
      request.limit < 1 || request.limit > NEW_BOOK_IMPORT_CONFIG.DEFAULT_LIMIT ||
      !Number.isInteger(request.attempts) || request.attempts < 0) {
    throw new Error('Invalid pending new-book import request.');
  }
  return request;
}

function hasPendingNewBookImport_() {
  const request = readPendingNewBookImport_();
  return Boolean(request && request.attempts < NEW_BOOK_IMPORT_CONFIG.MAX_QUEUED_ATTEMPTS);
}

function notifyQueuedNewBookImport_(spreadsheet) {
  spreadsheet.toast('別の自動更新が実行中のため、新刊登録後処理を予約しました。ロックが空き次第、自動で実行します。', '図書館', 15);
  return { queued: true, busy: true };
}

function processPendingNewBookImport_(spreadsheet) {
  const request = readPendingNewBookImport_();
  if (!request) return { pending: false };
  if (request.source !== spreadsheet.getId()) {
    throw new Error('New-book import retry does not match the saved bound spreadsheet.');
  }
  if (request.attempts >= NEW_BOOK_IMPORT_CONFIG.MAX_QUEUED_ATTEMPTS) {
    return { failed: true, attempts: request.attempts };
  }
  const properties = PropertiesService.getScriptProperties();
  let result;
  try {
    result = enrichNewBooksAfterImportByLimit_(request.limit, () => {
      // Checkpoint only after acquiring ScriptLock. Busy workers must not spend
      // attempts, while forced GAS termination must still have a durable bound.
      const current = readPendingNewBookImport_();
      if (!current || current.id !== request.id ||
          current.attempts >= NEW_BOOK_IMPORT_CONFIG.MAX_QUEUED_ATTEMPTS) return false;
      current.attempts += 1;
      properties.setProperty(NEW_BOOK_IMPORT_CONFIG.PENDING_PROPERTY, JSON.stringify(current));
      return true;
    }, () => {
      // Consume before releasing ScriptLock so a waiting worker cannot start
      // the same request in the gap between the final write and queue cleanup.
      const current = readPendingNewBookImport_();
      if (current && current.id === request.id) properties.deleteProperty(NEW_BOOK_IMPORT_CONFIG.PENDING_PROPERTY);
    });
  } catch (error) {
    spreadsheet.toast('新刊登録後処理で停止しました。自動再試行は最大3回です。続く場合は実行ログを確認し、新刊登録後処理をもう一度押してください。', '図書館', 20);
    throw error;
  }
  if (result.busy) return notifyQueuedNewBookImport_(spreadsheet);
  return result;
}

function enrichNewBooksAfterImportByLimit_(limit, beforeRun, onComplete) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(NEW_BOOK_IMPORT_CONFIG.LOCK_WAIT_MS)) {
    console.log(JSON.stringify({ operation: 'newBookImport', busy: true }));
    return { busy: true };
  }

  let retryBudgetStarted = false;
  try {
    if (beforeRun && beforeRun() === false) return { stale: true };
    beginRakutenBooks429RetryBudget_();
    retryBudgetStarted = true;
    const batchLimit = Math.max(1, Number(limit || NEW_BOOK_IMPORT_CONFIG.DEFAULT_LIMIT));
    const sheet = getSheet(CONFIG.SHEETS.MAIN);

    ensureSynopsisColumns_(sheet);
    ensureFallbackImageColumns_(sheet);

    const yomigana = fillMissingYomiganaForImport_(sheet, batchLimit);
    const series = refreshSeriesKeyAutoForImport_(sheet);
    const bookUuids = repairBookUuidsAll_(sheet);
    const synopsis = batchFetchSynopsisRawByLimit_(batchLimit);
    const synopsisKobo = retryNotFoundSynopsisFromRakutenKobo_();
    const fallbackImage = batchFillFallbackImageUrlsByLimit_(batchLimit, {
      retryFailed: false
    });

    SpreadsheetApp.flush();
    clearLibrarySearchCache_();

    const result = {
      limit: batchLimit,
      yomigana,
      series,
      bookUuids,
      synopsis,
      synopsisKobo,
      fallbackImage
    };

    const retryPending = yomigana.error + synopsisKobo.error;
    SpreadsheetApp.getActive().toast(
      `New book import: yomi ${yomigana.changed} / series ${series.changed} / UUID ${bookUuids.changed} / synopsis ${synopsis.processed} / Kobo ${synopsisKobo.processed} / image ${fallbackImage.processed}`
      + (retryPending > 0 ? ` / 再試行待ち ${retryPending}` : '')
    );

    console.log(JSON.stringify(result));
    if (onComplete) onComplete();
    return result;
  } finally {
    try {
      if (retryBudgetStarted) endRakutenBooks429RetryBudget_();
    } finally {
      lock.releaseLock();
    }
  }
}

function fillMissingYomiganaForImport_(sheet, limit) {
  const sh = sheet || getSheet(CONFIG.SHEETS.MAIN);
  const lastRow = getLastDataRow(sh, CONFIG.COL.TITLE);

  if (lastRow < 2) {
    return buildYomiganaImportResult_(0, 0, 0, 0, 0, 0, 0);
  }

  const batchLimit = Math.max(1, Number(limit || NEW_BOOK_IMPORT_CONFIG.DEFAULT_LIMIT));
  const rowCount = lastRow - 1;
  const readWidth = Math.max(CONFIG.COL.TITLE, CONFIG.COL.ISBN, CONFIG.COL.YOMIGANA);
  const rows = sh.getRange(2, 1, rowCount, readWidth).getDisplayValues();
  const properties = PropertiesService.getScriptProperties();
  const cursorKey = NEW_BOOK_IMPORT_CONFIG.YOMIGANA_CURSOR_PREFIX + sh.getParent().getId() + '.' + sh.getSheetId();
  const savedNextRow = Number(properties.getProperty(cursorKey));
  const startIndex = Number.isInteger(savedNextRow) && savedNextRow >= 2 && savedNextRow <= lastRow
    ? savedNextRow - 2
    : 0;

  let processed = 0;
  let changed = 0;
  let skippedDone = 0;
  let skippedNoTitle = 0;
  let skippedNoIsbn = 0;
  let notFound = 0;
  let error = 0;

  // Scan at most one full cycle; unresolved rows cannot monopolize every run.
  for (let offset = 0; offset < rows.length; offset++) {
    if (processed >= batchLimit) break;

    const i = (startIndex + offset) % rows.length;
    const row = rows[i];
    const rowNumber = i + 2;
    const title = String(row[CONFIG.COL.TITLE - 1] || '').trim();
    const currentYomi = String(row[CONFIG.COL.YOMIGANA - 1] || '').trim();
    const isbn = normalizeIsbn_(row[CONFIG.COL.ISBN - 1]);

    if (!title) {
      skippedNoTitle++;
      continue;
    }

    if (currentYomi) {
      skippedDone++;
      continue;
    }

    if (!isbn) {
      skippedNoIsbn++;
      continue;
    }

    processed++;
    // Checkpoint before external I/O so even an interrupted execution advances.
    properties.setProperty(cursorKey, String(rowNumber + 1));
    try {
      const yomi = fetchYomiganaFromRakutenBooksByIsbn_(isbn);

      if (yomi) {
        sh.getRange(rowNumber, CONFIG.COL.YOMIGANA).setValue(escapeSheetFormulaText_(yomi));
        changed++;
      } else {
        notFound++;
      }
    } catch (e) {
      console.error(`fillMissingYomiganaForImport row=${rowNumber} isbn=${isbn}:`, e);
      error++;
      break;
    }

    Utilities.sleep(120);
  }

  return buildYomiganaImportResult_(
    processed,
    changed,
    skippedDone,
    skippedNoTitle,
    skippedNoIsbn,
    notFound,
    error
  );
}

function fetchYomiganaFromRakutenBooksByIsbn_(isbn) {
  const safeIsbn = normalizeIsbn_(isbn);
  if (!safeIsbn) return '';

  const credentials = getRakutenBooksApiCredentials_();
  if (!credentials) throw new Error('楽天Booksの認証設定が不足しています。');

  const url = buildRakutenBooksSearchUrl_(safeIsbn, credentials);
  const json = fetchRakutenBooksJson_(url);
  const items = json && Array.isArray(json.Items) ? json.Items : [];
  if (!items.length) return '';

  for (let i = 0; i < items.length; i++) {
    const item = items[i] && items[i].Item ? items[i].Item : null;
    if (!item) continue;

    if (normalizeIsbn_(item.isbn) && normalizeIsbn_(item.isbn) !== safeIsbn) {
      continue;
    }

    const yomi = normalizeYomiganaForImport_(item.titleKana);
    if (yomi) return yomi;
  }

  return '';
}

function normalizeYomiganaForImport_(value) {
  const raw = String(value || '').normalize('NFKC').trim();
  if (!raw) return '';

  return raw
    .replace(/[\u30a1-\u30f6]/g, char =>
      String.fromCharCode(char.charCodeAt(0) - 0x60)
    )
    .replace(/\s+/g, ' ')
    .trim();
}

function buildYomiganaImportResult_(
  processed,
  changed,
  skippedDone,
  skippedNoTitle,
  skippedNoIsbn,
  notFound,
  error
) {
  return {
    processed,
    changed,
    skippedDone,
    skippedNoTitle,
    skippedNoIsbn,
    notFound,
    error
  };
}

function refreshSeriesKeyAutoForImport_(sheet) {
  const targetSheet = sheet || getSheet(CONFIG.SHEETS.MAIN);
  if (!isSeriesRegistryV2Active_()) {
    return summarizeSeriesKeyAutoPlan_(refreshSeriesKeyAutoAfterDerivedChange_(targetSheet));
  }

  preflightSeriesKeyAutoClassification_(targetSheet);
  const stats = {
    passes: 0,
    mastersAdded: 0,
    aliasesAdded: 0,
    extraAliasesAdded: 0,
    masterCountsChanged: 0,
    aliasCountsChanged: 0,
    changedCatalogRows: new Set()
  };
  const initialExtraAliases = ensureSeriesRegistryExtraAliases_();
  stats.extraAliasesAdded += Number(initialExtraAliases.added || 0);
  stats.orphanMastersDeleted = Number(
    initialExtraAliases.reconciledOrphans && initialExtraAliases.reconciledOrphans.deletedMasters || 0
  );
  stats.orphanAliasesDeleted = Number(
    initialExtraAliases.reconciledOrphans && initialExtraAliases.reconciledOrphans.deletedAliases || 0
  );
  stats.orphanAliasesRehomed = Number(
    initialExtraAliases.reconciledOrphans && initialExtraAliases.reconciledOrphans.rehomedAliases || 0
  );
  let stable = false;
  let converged = null;
  for (let pass = 0; pass < 3; pass++) {
    stats.passes = pass + 1;
    converged = refreshSeriesKeyAutoAfterDerivedChange_(targetSheet);
    const changedIndices = Array.isArray(converged && converged.changedIndices)
      ? converged.changedIndices
      : [];
    const changedStartRow = Number(converged && converged.startRow || 2);
    changedIndices.forEach(index => stats.changedCatalogRows.add(changedStartRow + index));
    const registrySync = syncSeriesRegistryFromCatalog_();
    const extraAliases = ensureSeriesRegistryExtraAliases_();
    stats.mastersAdded += Number(registrySync.added || 0);
    stats.aliasesAdded += Number(registrySync.aliasesAdded || 0);
    stats.extraAliasesAdded += Number(extraAliases.added || 0);
    stats.masterCountsChanged += Number(registrySync.masterCountsChanged || 0);
    stats.aliasCountsChanged += Number(registrySync.aliasCountsChanged || 0);
    const rehomedOrphans = extraAliases.reconciledOrphans || {};
    stats.orphanMastersDeleted += Number(rehomedOrphans.deletedMasters || 0);
    stats.orphanAliasesDeleted += Number(rehomedOrphans.deletedAliases || 0);
    stats.orphanAliasesRehomed += Number(rehomedOrphans.rehomedAliases || 0);
    if (
      converged.changed === 0 &&
      Number(registrySync.added || 0) === 0 &&
      Number(registrySync.aliasesAdded || 0) === 0 &&
      Number(extraAliases.added || 0) === 0
    ) {
      stable = true;
      break;
    }
  }

  if (!stable) {
    throw new Error('Series registry classification did not converge after three passes.');
  }

  const cleanup = cleanupSeriesRegistryLifecycleCore_();
  const usage = cleanup.changed
    ? refreshSeriesRegistryUsageCountsFromCatalog_(targetSheet)
    : { masterCountsChanged: 0, aliasCountsChanged: 0 };
  const registry = loadSeriesRegistryLookup_();
  const integrity = registry
    ? {
        masters: registry.allMasterById.size,
        aliases: registry.allAliasRows.length,
        checkedBooks: registry.catalogUsage.checkedBooks,
        unresolvedCatalogKeys: registry.catalogUsage.unresolved.length,
        danglingAliases: registry.danglingAliasRows.length,
        duplicateMasterIds: registry.duplicateMasterIds.size,
        ambiguousAliasKeys: registry.ambiguousAliasKeys.size
      }
    : { masters: 0, aliases: 0, unresolvedCatalogKeys: 0 };

  stats.masterCountsChanged += Number(usage.masterCountsChanged || 0);
  stats.aliasCountsChanged += Number(usage.aliasCountsChanged || 0);
  const summary = summarizeSeriesKeyAutoPlan_(converged);
  const changedRows = [...stats.changedCatalogRows].sort((left, right) => left - right);
  summary.changed = changedRows.length;
  summary.changedRows = changedRows.slice(0, 100);
  summary.truncated = changedRows.length > summary.changedRows.length;
  delete stats.changedCatalogRows;
  return Object.assign({}, summary, {
    catalogXKeysChanged: summary.changed,
    catalogBookIdsChanged: 0,
    stable: true,
    registry: stats,
    cleanup,
    integrity
  });
}
