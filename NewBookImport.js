/** @OnlyCurrentDoc */

const NEW_BOOK_IMPORT_CONFIG = {
  DEFAULT_LIMIT: 20,
  TEST_LIMIT: 5,
  LOCK_WAIT_MS: 10000,
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
  return enrichNewBooksAfterImportByLimit_(NEW_BOOK_IMPORT_CONFIG.DEFAULT_LIMIT);
}

function enrichNewBooksAfterImportTest5_() {
  return enrichNewBooksAfterImportByLimit_(NEW_BOOK_IMPORT_CONFIG.TEST_LIMIT);
}

function enrichNewBooksAfterImportByLimit_(limit) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(NEW_BOOK_IMPORT_CONFIG.LOCK_WAIT_MS)) {
    throw new Error('Another import enrichment job is already running.');
  }

  try {
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
    return result;
  } finally {
    lock.releaseLock();
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
  const series = refreshSeriesKeyAutoAfterDerivedChange_(targetSheet);
  if (!isSeriesRegistryV2Active_()) return series;

  const registry = syncSeriesRegistryFromCatalog_();
  ensureSeriesRegistryExtraAliases_();
  const converged = refreshSeriesKeyAutoAfterDerivedChange_(targetSheet);
  return Object.assign({}, converged, { registry });
}
