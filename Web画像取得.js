// ＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝
// Web画像取得.gs
//  - AA列 FALLBACK_IMAGE_URL / AB列 FALLBACK_IMAGE_SOURCE を補完する
//  - Hanmotoは扱わない。HanmotoはWeb表示時にブラウザで直接試す。
//  - 取得順: OpenBD → RakutenBooks → GoogleBooks
// ＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝

const FALLBACK_IMAGE_SOURCE = {
  MANUAL   : 'Manual',
  OPENBD   : 'OpenBD',
  RAKUTEN  : 'RakutenBooks',
  GOOGLE   : 'GoogleBooks',
  NOT_FOUND: 'NOT_FOUND',
  ERROR    : 'ERROR',
  SKIPPED  : 'SKIPPED'
};

const FALLBACK_IMAGE_FETCH_CONFIG = {
  BATCH_SIZE: 50,
  TEST_BATCH_SIZE: 10,
  RETRY_BATCH_SIZE: 30,
  SLEEP_MS: 120,
  MAX_EXECUTION_MS: 270000,

  FETCH_RETRY_COUNT: 2,
  FETCH_RETRY_BASE_SLEEP_MS: 400,

  USER_AGENT: 'Mozilla/5.0 (compatible; ShumiRoomLibraryImageBot/1.0; +GoogleAppsScript)',

  OPENBD_API_URL: 'https://api.openbd.jp/v1/get',
  RAKUTEN_BOOKS_API_URL: 'https://openapi.rakuten.co.jp/services/api/BooksBook/Search/20170404',
  GOOGLE_BOOKS_API_URL: 'https://www.googleapis.com/books/v1/volumes',

  RAKUTEN_APP_ID_PROPERTY: 'RAKUTEN_APP_ID',
  RAKUTEN_APKEY_PROPERTY: 'RAKUTEN_APKEY',
  RAKUTEN_REFERER: 'https://script.google.com/',
  RAKUTEN_ORIGIN: 'https://script.google.com'
};

function batchFillFallbackImageUrls() {
  return batchFillFallbackImageUrlsByLimit_(FALLBACK_IMAGE_FETCH_CONFIG.BATCH_SIZE, {
    retryFailed: false
  });
}

function batchFillFallbackImageUrlsTest10() {
  return batchFillFallbackImageUrlsByLimit_(FALLBACK_IMAGE_FETCH_CONFIG.TEST_BATCH_SIZE, {
    retryFailed: false
  });
}

function retryFailedFallbackImageUrls() {
  return batchFillFallbackImageUrlsByLimit_(FALLBACK_IMAGE_FETCH_CONFIG.RETRY_BATCH_SIZE, {
    retryFailed: true
  });
}

function setFallbackImageSourceValidation() {
  const sheet = getSheet(CONFIG.SHEETS.MAIN);
  ensureFallbackImageColumns_(sheet);

  const last = Math.max(getLastDataRow(sheet, CONFIG.COL.TITLE), 2);
  const values = [
    FALLBACK_IMAGE_SOURCE.MANUAL,
    FALLBACK_IMAGE_SOURCE.OPENBD,
    FALLBACK_IMAGE_SOURCE.RAKUTEN,
    FALLBACK_IMAGE_SOURCE.GOOGLE,
    FALLBACK_IMAGE_SOURCE.NOT_FOUND,
    FALLBACK_IMAGE_SOURCE.ERROR,
    FALLBACK_IMAGE_SOURCE.SKIPPED
  ];

  const rule = SpreadsheetApp
    .newDataValidation()
    .requireValueInList(values, true)
    .setAllowInvalid(false)
    .build();

  sheet
    .getRange(2, CONFIG.COL.FALLBACK_IMAGE_SOURCE, Math.max(last - 1, 1), 1)
    .setDataValidation(rule);
}

function clearAllFallbackImageUrlAndSource() {
  const sheet = getSheet(CONFIG.SHEETS.MAIN);
  ensureFallbackImageColumns_(sheet);

  const last = getLastDataRow(sheet, CONFIG.COL.TITLE);
  if (last < 2) {
    return { clearedRows: 0 };
  }

  const rowCount = last - 1;
  sheet
    .getRange(2, CONFIG.COL.FALLBACK_IMAGE_URL, rowCount, 2)
    .clearContent()
    .clearNote();

  SpreadsheetApp.flush();
  clearLibrarySearchCache_();

  const result = { clearedRows: rowCount };
  console.log(JSON.stringify(result, null, 2));
  SpreadsheetApp.getActive().toast(`Fallback画像URL/SOURCEを全消去しました: ${rowCount}行`);
  return result;
}

function batchFillFallbackImageUrlsByLimit_(limit, options) {
  const sheet = getSheet(CONFIG.SHEETS.MAIN);
  ensureFallbackImageColumns_(sheet);
  setFallbackImageSourceValidation();

  const last = getLastDataRow(sheet, CONFIG.COL.TITLE);
  if (last < 2) {
    return buildFallbackImageBatchResult_(0, 0, 0, 0, 0, 0, 0, 0, 0);
  }

  const opt = options || {};
  const retryFailed = Boolean(opt.retryFailed);
  const batchLimit = Math.max(1, Number(limit || FALLBACK_IMAGE_FETCH_CONFIG.BATCH_SIZE));
  const startTime = Date.now();

  const rowCount = last - 1;
  const rows = sheet.getRange(2, 1, rowCount, CONFIG.COL.MAX).getDisplayValues();

  let processed = 0;
  let success = 0;
  let notFound = 0;
  let skippedDone = 0;
  let skippedManual = 0;
  let skippedNoTitle = 0;
  let skippedNoIsbn = 0;
  let error = 0;
  let changed = 0;

  for (let i = 0; i < rows.length; i++) {
    if (Date.now() - startTime > FALLBACK_IMAGE_FETCH_CONFIG.MAX_EXECUTION_MS) {
      console.log('⏱ Fallback画像補完: タイムアウト回避で途中終了');
      break;
    }

    if (processed >= batchLimit) break;

    const rowNumber = i + 2;
    const row = rows[i];

    const title = String(row[CONFIG.COL.TITLE - 1] || '').trim();
    const isbn = normalizeIsbn13ForImage_(row[CONFIG.COL.ISBN - 1]);
    const currentUrl = normalizeFallbackImageUrlForBatch_(row[CONFIG.COL.FALLBACK_IMAGE_URL - 1]);
    let source = normalizeFallbackImageSourceValue_(row[CONFIG.COL.FALLBACK_IMAGE_SOURCE - 1]);

    // 旧仕様のHanmoto残骸は未処理扱いにする。
    if (source === 'Hanmoto') {
      source = '';
    }

    if (!title) {
      skippedNoTitle++;
      continue;
    }

    if (source === FALLBACK_IMAGE_SOURCE.MANUAL) {
      skippedManual++;
      continue;
    }

    if (currentUrl && !source) {
      writeFallbackImageResult_(sheet, rowNumber, currentUrl, FALLBACK_IMAGE_SOURCE.MANUAL);
      skippedManual++;
      changed++;
      continue;
    }

    const retryableSource = isRetryableFallbackImageSource_(source);

    if (source && !retryableSource) {
      skippedDone++;
      continue;
    }

    if (retryableSource && !retryFailed) {
      skippedDone++;
      continue;
    }

    processed++;

    if (!isbn) {
      writeFallbackImageResult_(sheet, rowNumber, '', FALLBACK_IMAGE_SOURCE.SKIPPED);
      skippedNoIsbn++;
      changed++;
      Utilities.sleep(40);
      continue;
    }

    try {
      const result = resolveBestFallbackImageUrlByIsbn_(isbn);

      if (result && result.url && result.source) {
        writeFallbackImageResult_(sheet, rowNumber, result.url, result.source);
        success++;
        changed++;
      } else {
        writeFallbackImageResult_(sheet, rowNumber, '', FALLBACK_IMAGE_SOURCE.NOT_FOUND);
        notFound++;
        changed++;
      }
    } catch (e) {
      console.error(`batchFillFallbackImageUrls row=${rowNumber} title=${title} isbn=${isbn}:`, e);
      writeFallbackImageResult_(sheet, rowNumber, '', FALLBACK_IMAGE_SOURCE.ERROR, e);
      error++;
      changed++;
    }

    Utilities.sleep(FALLBACK_IMAGE_FETCH_CONFIG.SLEEP_MS);
  }

  SpreadsheetApp.flush();

  if (changed > 0) {
    clearLibrarySearchCache_();
  }

  const result = buildFallbackImageBatchResult_(
    processed,
    success,
    notFound,
    skippedDone,
    skippedManual,
    skippedNoTitle,
    skippedNoIsbn,
    error,
    changed
  );

  SpreadsheetApp.getActive().toast(
    `Fallback画像補完: 処理${result.processed} / 成功${result.success} / 未発見${result.notFound} / 変更${result.changed}`
  );

  return result;
}

function buildFallbackImageBatchResult_(
  processed,
  success,
  notFound,
  skippedDone,
  skippedManual,
  skippedNoTitle,
  skippedNoIsbn,
  error,
  changed
) {
  return {
    processed,
    success,
    notFound,
    skippedDone,
    skippedManual,
    skippedNoTitle,
    skippedNoIsbn,
    error,
    changed
  };
}

function ensureFallbackImageColumns_(sheet) {
  const sh = sheet || getSheet(CONFIG.SHEETS.MAIN);

  if (sh.getMaxColumns() < CONFIG.COL.MAX) {
    sh.insertColumnsAfter(
      sh.getMaxColumns(),
      CONFIG.COL.MAX - sh.getMaxColumns()
    );
  }

  sh.getRange(1, CONFIG.COL.FALLBACK_IMAGE_URL).setValue('FALLBACK_IMAGE_URL');
  sh.getRange(1, CONFIG.COL.FALLBACK_IMAGE_SOURCE).setValue('FALLBACK_IMAGE_SOURCE');
}

function writeFallbackImageResult_(sheet, rowNumber, url, source, errorObject) {
  const range = sheet.getRange(rowNumber, CONFIG.COL.FALLBACK_IMAGE_URL, 1, 2);

  range.setValues([[
    String(url || ''),
    String(source || '')
  ]]);

  const sourceCell = sheet.getRange(rowNumber, CONFIG.COL.FALLBACK_IMAGE_SOURCE);
  if (errorObject) {
    sourceCell.setNote(String(errorObject && errorObject.stack || errorObject).slice(0, 1000));
  } else {
    sourceCell.clearNote();
  }
}

function normalizeFallbackImageSourceValue_(value) {
  return String(value || '').trim();
}

function isRetryableFallbackImageSource_(source) {
  return source === FALLBACK_IMAGE_SOURCE.NOT_FOUND ||
    source === FALLBACK_IMAGE_SOURCE.ERROR ||
    source === FALLBACK_IMAGE_SOURCE.SKIPPED;
}

function normalizeFallbackImageUrlForBatch_(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';

  const imageFormulaMatch = raw.match(/^=IMAGE\(\s*"([^"]+)"/i);
  let url = imageFormulaMatch ? imageFormulaMatch[1].trim() : raw;

  if (/^http:\/\//i.test(url)) {
    url = url.replace(/^http:/i, 'https:');
  }

  if (!/^https:\/\//i.test(url)) return '';

  const noImage = String(NO_IMAGE_URL || '').trim().replace(/^http:/i, 'https:');
  if (url === noImage) return '';

  return url;
}

function normalizeRakutenFallbackCoverUrlForWeb_(value) {
  const url = normalizeFallbackImageUrlForBatch_(value);
  if (!url) return '';

  if (!/thumbnail\.image\.rakuten\.co\.jp/i.test(url)) {
    return url;
  }

  if (/[?&]_ex=\d+x\d+/i.test(url)) {
    return url.replace(/([?&]_ex=)\d+x\d+/i, function(_, prefix) {
      return prefix + '600x600';
    });
  }

  const separator = url.indexOf('?') >= 0 ? '&' : '?';
  return url + separator + '_ex=600x600';
}

function normalizeGoogleFallbackCoverUrlForWeb_(value) {
  let url = normalizeFallbackImageUrlForBatch_(value);
  if (!url) return '';

  if (/books\.google\./i.test(url)) {
    if (/[?&]zoom=\d+/i.test(url)) {
      url = url.replace(/([?&]zoom=)\d+/i, '$10');
    }
  }

  return url;
}

function resolveBestFallbackImageUrlByIsbn_(isbn) {
  const safeIsbn = normalizeIsbn13ForImage_(isbn);
  if (!safeIsbn) return null;

  const openBdUrl = fetchFallbackImageUrlFromOpenBd_(safeIsbn);
  if (openBdUrl) {
    return {
      url: openBdUrl,
      source: FALLBACK_IMAGE_SOURCE.OPENBD
    };
  }

  const rakutenUrl = fetchFallbackImageUrlFromRakutenBooks_(safeIsbn);
  if (rakutenUrl) {
    return {
      url: rakutenUrl,
      source: FALLBACK_IMAGE_SOURCE.RAKUTEN
    };
  }

  const googleUrl = fetchFallbackImageUrlFromGoogleBooks_(safeIsbn);
  if (googleUrl) {
    return {
      url: googleUrl,
      source: FALLBACK_IMAGE_SOURCE.GOOGLE
    };
  }

  return null;
}

function fetchFallbackImageUrlFromOpenBd_(safeIsbn) {
  const url = FALLBACK_IMAGE_FETCH_CONFIG.OPENBD_API_URL
    + '?isbn=' + encodeURIComponent(safeIsbn);

  const json = fetchFallbackImageJson_(url, buildFallbackImageFetchOptions_());
  const item = Array.isArray(json) ? json[0] : null;
  if (!item) return '';

  const cover = item.summary && item.summary.cover
    ? item.summary.cover
    : '';

  return normalizeFallbackImageUrlForBatch_(cover);
}

function fetchFallbackImageUrlFromRakutenBooks_(safeIsbn) {
  const credentials = getFallbackImageRakutenBooksCredentials_();
  if (!credentials) return '';

  const url = FALLBACK_IMAGE_FETCH_CONFIG.RAKUTEN_BOOKS_API_URL
    + '?format=json'
    + '&isbn=' + encodeURIComponent(safeIsbn)
    + '&applicationId=' + encodeURIComponent(credentials.appId)
    + '&accessKey=' + encodeURIComponent(credentials.accessKey);

  const json = fetchFallbackImageJson_(url, buildFallbackImageRakutenFetchOptions_());
  const items = json && Array.isArray(json.Items) ? json.Items : [];
  if (!items.length) return '';

  for (let i = 0; i < items.length; i++) {
    const item = items[i] && items[i].Item ? items[i].Item : null;
    if (!item) continue;

    if (normalizeIsbn_(item.isbn) && normalizeIsbn_(item.isbn) !== safeIsbn) {
      continue;
    }

    const candidates = [
      item.largeImageUrl,
      item.mediumImageUrl,
      item.smallImageUrl
    ];

    for (let j = 0; j < candidates.length; j++) {
      const normalized = normalizeRakutenFallbackCoverUrlForWeb_(candidates[j]);
      if (normalized) return normalized;
    }
  }

  return '';
}

function fetchFallbackImageUrlFromGoogleBooks_(safeIsbn) {
  const url = FALLBACK_IMAGE_FETCH_CONFIG.GOOGLE_BOOKS_API_URL
    + '?q=' + encodeURIComponent('isbn:' + safeIsbn)
    + '&maxResults=5';

  const json = fetchFallbackImageJson_(url, buildFallbackImageFetchOptions_());
  const items = json && Array.isArray(json.items) ? json.items : [];
  if (!items.length) return '';

  for (let i = 0; i < items.length; i++) {
    const info = items[i] && items[i].volumeInfo ? items[i].volumeInfo : null;
    if (!info) continue;

    const identifiers = Array.isArray(info.industryIdentifiers) ? info.industryIdentifiers : [];
    const hasMatchingIsbn = identifiers.some(id => {
      return normalizeIsbn_(id && id.identifier) === safeIsbn;
    });

    if (!hasMatchingIsbn && items.length > 1) continue;

    const links = info.imageLinks || {};
    const candidates = [
      links.extraLarge,
      links.large,
      links.medium,
      links.small,
      links.thumbnail,
      links.smallThumbnail
    ];

    for (let j = 0; j < candidates.length; j++) {
      const normalized = normalizeGoogleFallbackCoverUrlForWeb_(candidates[j]);
      if (normalized) return normalized;
    }
  }

  return '';
}

function getFallbackImageRakutenBooksCredentials_() {
  if (typeof getRakutenBooksApiCredentials_ === 'function') {
    return getRakutenBooksApiCredentials_();
  }

  const props = PropertiesService.getScriptProperties();
  const appId = String(props.getProperty(FALLBACK_IMAGE_FETCH_CONFIG.RAKUTEN_APP_ID_PROPERTY) || '').trim();
  const accessKey = String(props.getProperty(FALLBACK_IMAGE_FETCH_CONFIG.RAKUTEN_APKEY_PROPERTY) || '').trim();

  if (!appId || !accessKey) return null;
  return { appId, accessKey };
}

function fetchFallbackImageJson_(url, options) {
  const res = fetchFallbackImageUrlWithRetry_(url, options || buildFallbackImageFetchOptions_());
  const code = res.getResponseCode();

  if (code < 200 || code >= 300) {
    return null;
  }

  const text = res.getContentText('UTF-8');
  if (!text) return null;

  return JSON.parse(text);
}

function buildFallbackImageFetchOptions_() {
  return {
    muteHttpExceptions: true,
    followRedirects: true,
    headers: {
      'User-Agent': FALLBACK_IMAGE_FETCH_CONFIG.USER_AGENT,
      'Accept': 'application/json'
    }
  };
}

function buildFallbackImageRakutenFetchOptions_() {
  return {
    muteHttpExceptions: true,
    followRedirects: true,
    headers: {
      'User-Agent': FALLBACK_IMAGE_FETCH_CONFIG.USER_AGENT,
      'Accept': 'application/json',
      'Referer': FALLBACK_IMAGE_FETCH_CONFIG.RAKUTEN_REFERER,
      'Origin': FALLBACK_IMAGE_FETCH_CONFIG.RAKUTEN_ORIGIN
    }
  };
}

function fetchFallbackImageUrlWithRetry_(url, options, retryCount) {
  const max = Math.max(1, Number(retryCount || FALLBACK_IMAGE_FETCH_CONFIG.FETCH_RETRY_COUNT || 2));
  const baseSleep = Math.max(0, Number(FALLBACK_IMAGE_FETCH_CONFIG.FETCH_RETRY_BASE_SLEEP_MS || 400));

  let lastError = null;

  for (let i = 0; i < max; i++) {
    try {
      return UrlFetchApp.fetch(url, options || {});
    } catch (e) {
      lastError = e;
      if (i >= max - 1) break;
      Utilities.sleep(baseSleep * (i + 1));
    }
  }

  throw lastError || new Error('fetchFallbackImageUrlWithRetry_: unknown error');
}

function debugResolveFallbackImageUrlPreset() {
  const isbn = '9784088931722';
  return debugResolveFallbackImageUrlByIsbn_(isbn);
}

function debugResolveFallbackImageUrlByIsbn_(isbn) {
  const safeIsbn = normalizeIsbn13ForImage_(isbn);
  const result = resolveBestFallbackImageUrlByIsbn_(safeIsbn);

  const output = {
    isbn: String(isbn || ''),
    safeIsbn,
    result
  };

  console.log(JSON.stringify(output, null, 2));
  return output;
}