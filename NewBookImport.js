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

    const series = refreshSeriesKeyAutoForImport_(sheet);
    const synopsis = batchFetchSynopsisRawByLimit_(batchLimit);
    const fallbackImage = batchFillFallbackImageUrlsByLimit_(batchLimit, {
      retryFailed: false
    });

    clearLibrarySearchCache_();
    SpreadsheetApp.flush();

    const result = {
      limit: batchLimit,
      series,
      synopsis,
      fallbackImage
    };

    SpreadsheetApp.getActive().toast(
      `New book import: series ${series.changed} / synopsis ${synopsis.processed} / image ${fallbackImage.processed}`
    );

    console.log(JSON.stringify(result));
    return result;
  } finally {
    lock.releaseLock();
  }
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
