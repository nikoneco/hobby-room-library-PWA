/** @OnlyCurrentDoc */

const NEW_BOOK_IMPORT_CONFIG = {
  DEFAULT_LIMIT: 20,
  TEST_LIMIT: 5,
  LOCK_WAIT_MS: 10000
};

function enrichNewBooksAfterImport() {
  return enrichNewBooksAfterImportByLimit_(NEW_BOOK_IMPORT_CONFIG.DEFAULT_LIMIT);
}

function enrichNewBooksAfterImportTest5() {
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
    const synopsis = batchFetchSynopsisRawByLimit_(batchLimit);
    const fallbackImage = batchFillFallbackImageUrlsByLimit_(batchLimit, {
      retryFailed: false
    });

    clearLibrarySearchCache_();
    SpreadsheetApp.flush();

    const result = {
      limit: batchLimit,
      yomigana,
      series,
      synopsis,
      fallbackImage
    };

    SpreadsheetApp.getActive().toast(
      `New book import: yomi ${yomigana.changed} / series ${series.changed} / synopsis ${synopsis.processed} / image ${fallbackImage.processed}`
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

  let processed = 0;
  let changed = 0;
  let skippedDone = 0;
  let skippedNoTitle = 0;
  let skippedNoIsbn = 0;
  let notFound = 0;
  let error = 0;

  for (let i = 0; i < rows.length; i++) {
    if (processed >= batchLimit) break;

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

    processed++;

    if (!isbn) {
      skippedNoIsbn++;
      continue;
    }

    try {
      const yomi = fetchYomiganaFromRakutenBooksByIsbn_(isbn);

      if (yomi) {
        sh.getRange(rowNumber, CONFIG.COL.YOMIGANA).setValue(yomi);
        changed++;
      } else {
        notFound++;
      }
    } catch (e) {
      console.error(`fillMissingYomiganaForImport row=${rowNumber} isbn=${isbn}:`, e);
      error++;
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
  if (!credentials) return '';

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
  const sh = sheet || getSheet(CONFIG.SHEETS.MAIN);
  const lastRow = getLastDataRow(sh, CONFIG.COL.TITLE);

  if (lastRow < 2) {
    return {
      checked: 0,
      changed: 0
    };
  }

  const rowCount = lastRow - 1;
  const titleCol = CONFIG.COL.TITLE;
  const genreCol = CONFIG.COL.GENRE;
  const seriesKeyCol = CONFIG.COL.SERIES_KEY_AUTO;

  const baseValues = sh
    .getRange(2, 1, rowCount, Math.max(titleCol, genreCol))
    .getValues();
  const currentKeys = sh
    .getRange(2, seriesKeyCol, rowCount, 1)
    .getValues();

  let changed = 0;
  const nextKeys = baseValues.map((row, i) => {
    const title = row[titleCol - 1] || '';
    const genresRaw = row[genreCol - 1] || '';
    const key = title
      ? (isExtraBookByGenres_(genresRaw)
        ? generateExtraSeriesKey_(title)
        : generateSeriesKeyAuto(title))
      : '';

    if (currentKeys[i][0] !== key) changed++;
    return [key];
  });

  if (changed > 0) {
    sh.getRange(2, seriesKeyCol, rowCount, 1).setValues(nextKeys);
  }

  return {
    checked: rowCount,
    changed
  };
}
