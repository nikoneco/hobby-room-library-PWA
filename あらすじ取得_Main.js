/** @OnlyCurrentDoc */
// ＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝
// あらすじ取得_Main.gs
//  - 通常取得: 版元ドットコム / 楽天Books / OpenBD / Google Books
//  - Y列 あらすじ / Z列 あらすじ_SOURCE
//  - 楽天Kobo救済は あらすじ取得_kobo.gs に分離
// ＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝

const SYNOPSIS_SOURCE = {
  OPENBD     : 'OpenBD',
  HANMOTO    : 'Hanmoto',
  RAKUTEN    : 'RakutenBooks',
  RAKUTEN_KOBO: 'RakutenKobo',
  GOOGLE     : 'GoogleBooks',
  MANUAL     : 'Manual',
  NOT_FOUND  : 'NOT_FOUND',
  NOT_FOUND_DONE: 'NOT_FOUND.',
  ERROR      : 'ERROR',
  SKIPPED    : 'SKIPPED'
};

const SYNOPSIS_FETCH_CONFIG = {
  BATCH_SIZE: 50,
  TEST_BATCH_SIZE: 10,
  SLEEP_MS: 350,
  KOBO_RETRY_BATCH_SIZE: 50,
  KOBO_RETRY_TEST_BATCH_SIZE: 10,
  KOBO_API_SLEEP_MS: 1200,
  KOBO_RATE_LIMIT_RETRY_COUNT: 4,
  KOBO_RATE_LIMIT_SLEEP_MS: 1200,
  KOBO_EARLY_STOP_SCORE: 700,
  FETCH_RETRY_COUNT: 3,
  FETCH_RETRY_BASE_SLEEP_MS: 500,
  MAX_RAW_LENGTH: 3000,
  MAX_EXECUTION_MS: 270000,
  USER_AGENT: 'Mozilla/5.0 (compatible; ShumiRoomLibraryBot/1.0; +GoogleAppsScript)',
  MIN_CANDIDATE_SCORE: 80,
  RAKUTEN_APP_ID_PROPERTY: 'RAKUTEN_APP_ID',
  RAKUTEN_APKEY_PROPERTY: 'RAKUTEN_APKEY',
  RAKUTEN_BOOKS_API_URL: 'https://openapi.rakuten.co.jp/services/api/BooksBook/Search/20170404',
  RAKUTEN_KOBO_API_URL: 'https://openapi.rakuten.co.jp/services/api/Kobo/EbookSearch/20170426',
  RAKUTEN_REFERER: 'https://script.google.com/',
  RAKUTEN_ORIGIN: 'https://script.google.com'
};

/**
 * あらすじRAW取得：通常バッチ
 * Z列が空欄の行だけを対象に、最大50件処理する。
 * @returns {Object} 実行結果
 */
function batchFetchSynopsisRaw_() {
  return batchFetchSynopsisRawByLimit_(SYNOPSIS_FETCH_CONFIG.BATCH_SIZE);
}

/**
 * あらすじRAW取得：初回検証用10件バッチ
 * まずはこちらで動作確認する。
 * @returns {Object} 実行結果
 */
function batchFetchSynopsisRawTest10_() {
  return batchFetchSynopsisRawByLimit_(SYNOPSIS_FETCH_CONFIG.TEST_BATCH_SIZE);
}

/**
 * あらすじSOURCE列の入力規則を設定する。
 * 手動運用のブレ防止用。必要なときだけ実行する。
 */
function setSynopsisSourceValidation_() {
  const sheet = getSheet(CONFIG.SHEETS.MAIN);
  ensureSynopsisColumns_(sheet);

  const last = Math.max(getLastDataRow(sheet, CONFIG.COL.TITLE), 2);
  const values = [
    SYNOPSIS_SOURCE.OPENBD,
    SYNOPSIS_SOURCE.HANMOTO,
    SYNOPSIS_SOURCE.RAKUTEN,
    SYNOPSIS_SOURCE.RAKUTEN_KOBO,
    SYNOPSIS_SOURCE.GOOGLE,
    SYNOPSIS_SOURCE.MANUAL,
    SYNOPSIS_SOURCE.NOT_FOUND,
    SYNOPSIS_SOURCE.NOT_FOUND_DONE,
    SYNOPSIS_SOURCE.ERROR,
    SYNOPSIS_SOURCE.SKIPPED
  ];

  const rule = SpreadsheetApp
    .newDataValidation()
    .requireValueInList(values, true)
    .setAllowInvalid(false)
    .build();

  sheet
    .getRange(2, CONFIG.COL.SUMMARY_SOURCE, Math.max(last - 1, 1), 1)
    .setDataValidation(rule);
}

/**
 * あらすじRAW/Y列・SOURCE/Z列を全消去する。
 * ヘッダ行は保持する。Manualも含めて消えるので、全件取り直し時だけ実行する。
 * @returns {Object}
 */
function clearAllSynopsisRawAndSource_() {
  const sheet = getSheet(CONFIG.SHEETS.MAIN);
  ensureSynopsisColumns_(sheet);

  const last = getLastDataRow(sheet, CONFIG.COL.TITLE);
  if (last < 2) {
    return { clearedRows: 0 };
  }

  const rowCount = last - 1;
  sheet
    .getRange(2, CONFIG.COL.SUMMARY, rowCount, 2)
    .clearContent()
    .clearNote();

  SpreadsheetApp.flush();

  const result = { clearedRows: rowCount };
  SpreadsheetApp.getActive().toast(`あらすじRAW/SOURCEを全消去しました: ${rowCount}行`);
  return result;
}

/**
 * あらすじRAW取得：指定件数バッチ
 * @param {number} limit
 * @returns {Object} 実行結果
 */
function batchFetchSynopsisRawByLimit_(limit) {
  const sheet = getSheet(CONFIG.SHEETS.MAIN);
  ensureSynopsisColumns_(sheet);

  const last = getLastDataRow(sheet, CONFIG.COL.TITLE);
  if (last < 2) {
    return buildSynopsisBatchResult_(0, 0, 0, 0, 0, 0);
  }

  const startTime = Date.now(); // ←追加

  const batchLimit = Math.max(1, Number(limit || SYNOPSIS_FETCH_CONFIG.BATCH_SIZE));
  const rowCount = last - 1;
  const rows = sheet.getRange(2, 1, rowCount, CONFIG.COL.MAX).getDisplayValues();

  let processed = 0;
  let success = 0;
  let notFound = 0;
  let skipped = 0;
  let error = 0;
  let manualProtected = 0;

  for (let i = 0; i < rows.length; i++) {

    // ★時間制御（ここが本質）
    if (Date.now() - startTime > SYNOPSIS_FETCH_CONFIG.MAX_EXECUTION_MS) {
      console.log('⏱ タイムアウト回避で途中終了');
      break;
    }

    if (processed >= batchLimit) break;

    const rowNumber = i + 2;
    const row = rows[i];
    const title = String(row[CONFIG.COL.TITLE - 1] || '').trim();
    const isbn = normalizeIsbn_(row[CONFIG.COL.ISBN - 1]);
    const summary = String(row[CONFIG.COL.SUMMARY - 1] || '').trim();
    const source = normalizeSynopsisSourceValue_(row[CONFIG.COL.SUMMARY_SOURCE - 1]);

    if (source) continue;
    if (!title) continue;

    processed++;

    if (summary) {
      writeSynopsisResult_(sheet, rowNumber, summary, SYNOPSIS_SOURCE.MANUAL);
      manualProtected++;
      Utilities.sleep(50);
      continue;
    }

    if (!isbn) {
      writeSynopsisResult_(sheet, rowNumber, '', SYNOPSIS_SOURCE.SKIPPED);
      skipped++;
      Utilities.sleep(50);
      continue;
    }

    try {
      const result = fetchSynopsisFromSources_(isbn);

      if (result && result.raw && result.source) {
        writeSynopsisResult_(sheet, rowNumber, result.raw, result.source);
        success++;
      } else {
        writeSynopsisResult_(sheet, rowNumber, '', SYNOPSIS_SOURCE.NOT_FOUND);
        notFound++;
      }
    } catch (e) {
      console.error(`batchFetchSynopsisRaw row=${rowNumber} isbn=${isbn}:`, e);
      writeSynopsisResult_(sheet, rowNumber, '', SYNOPSIS_SOURCE.ERROR, e);
      error++;
    }

    Utilities.sleep(SYNOPSIS_FETCH_CONFIG.SLEEP_MS);
  }

  SpreadsheetApp.flush();

  const result = buildSynopsisBatchResult_(processed, success, notFound, skipped, error, manualProtected);
  if (result.processed > 0) {
    clearLibrarySearchCache_();
  }

  SpreadsheetApp.getActive().toast(
    `あらすじ取得: 処理${result.processed} / 成功${result.success} / 未発見${result.notFound}`
  );

  return result;
}

/**
 * バッチ結果オブジェクト生成
 */
function buildSynopsisBatchResult_(processed, success, notFound, skipped, error, manualProtected) {
  return {
    processed,
    success,
    notFound,
    skipped,
    error,
    manualProtected
  };
}

/**
 * Y/Z列が存在することを保証し、ヘッダを補完する。
 * @param {GoogleAppsScript.Spreadsheet.Sheet=} sheet
 */
function ensureSynopsisColumns_(sheet) {
  const sh = sheet || getSheet(CONFIG.SHEETS.MAIN);

  if (sh.getMaxColumns() < CONFIG.COL.MAX) {
    sh.insertColumnsAfter(
      sh.getMaxColumns(),
      CONFIG.COL.MAX - sh.getMaxColumns()
    );
  }

  const summaryHeader = String(sh.getRange(1, CONFIG.COL.SUMMARY).getValue() || '').trim();
  if (!summaryHeader) {
    sh.getRange(1, CONFIG.COL.SUMMARY).setValue('あらすじ');
  }

  const sourceHeader = String(sh.getRange(1, CONFIG.COL.SUMMARY_SOURCE).getValue() || '').trim();
  if (!sourceHeader) {
    sh.getRange(1, CONFIG.COL.SUMMARY_SOURCE).setValue('あらすじ_SOURCE');
  }
  if (CONFIG.COL.WEB_IMAGE_URL) {
    const webImageUrlHeader = String(sh.getRange(1, CONFIG.COL.WEB_IMAGE_URL).getValue() || '').trim();
    if (!webImageUrlHeader) {
      sh.getRange(1, CONFIG.COL.WEB_IMAGE_URL).setValue('WEB_IMAGE_URL');
    }
  }

  if (CONFIG.COL.WEB_IMAGE_SOURCE) {
    const webImageSourceHeader = String(sh.getRange(1, CONFIG.COL.WEB_IMAGE_SOURCE).getValue() || '').trim();
    if (!webImageSourceHeader) {
      sh.getRange(1, CONFIG.COL.WEB_IMAGE_SOURCE).setValue('WEB_IMAGE_SOURCE');
    }
  }
}

/**
 * 手動編集時のManualマーキング。
 * Y列（あらすじ）が手入力された場合、Z列が空欄/失敗系ならManualにする。
 * 既にOpenBD/Hanmoto/GoogleBooks/Manualが入っている場合は上書きしない。
 * @param {GoogleAppsScript.Events.SheetsOnEdit} e
 */
function markSynopsisManualOnEdit_(e) {
  if (!e || !e.range) return;

  const range = e.range;
  const sheet = range.getSheet();
  if (sheet.getName() !== CONFIG.SHEETS.MAIN) return;

  const rowStart = range.getRow();
  const rowEnd = rowStart + range.getNumRows() - 1;
  const colStart = range.getColumn();
  const colEnd = colStart + range.getNumColumns() - 1;

  if (rowEnd < 2) return;

  const touchesSummary = colStart <= CONFIG.COL.SUMMARY && colEnd >= CONFIG.COL.SUMMARY;
  const touchesSource = colStart <= CONFIG.COL.SUMMARY_SOURCE && colEnd >= CONFIG.COL.SUMMARY_SOURCE;

  if (!touchesSummary) return;
  if (touchesSource) return;

  ensureSynopsisColumns_(sheet);

  const targetStartRow = Math.max(rowStart, 2);
  const targetRows = rowEnd - targetStartRow + 1;
  if (targetRows <= 0) return;

  const summaryVals = sheet.getRange(targetStartRow, CONFIG.COL.SUMMARY, targetRows, 1).getDisplayValues();
  const sourceRange = sheet.getRange(targetStartRow, CONFIG.COL.SUMMARY_SOURCE, targetRows, 1);
  const sourceVals = sourceRange.getDisplayValues();

  let changed = false;
  const next = sourceVals.map((r, i) => {
    const current = normalizeSynopsisSourceValue_(r[0]);
    const summary = String(summaryVals[i][0] || '').trim();

    if (summary && shouldAutoMarkManual_(current)) {
      changed = true;
      return [SYNOPSIS_SOURCE.MANUAL];
    }
    return [r[0]];
  });

  if (changed) {
    sourceRange.setValues(next);
  }
}

/**
 * 自動Manual化してよいSOURCE値か判定する。
 * @param {string} source
 * @returns {boolean}
 */
function shouldAutoMarkManual_(source) {
  const s = normalizeSynopsisSourceValue_(source);
  return !s || [
    SYNOPSIS_SOURCE.NOT_FOUND,
    SYNOPSIS_SOURCE.NOT_FOUND_DONE,
    SYNOPSIS_SOURCE.ERROR,
    SYNOPSIS_SOURCE.SKIPPED,
    'FALSE'
  ].includes(s);
}

/**
 * SOURCE値を正規化する。
 * @param {*} value
 * @returns {string}
 */
function normalizeSynopsisSourceValue_(value) {
  return String(value || '').trim();
}


/**
 * OpenBD / Hanmoto / GoogleBooks から候補をすべて集め、品質スコア最高の候補を採用する。
 * 逐次fallbackではなく全候補比較にすることで、OpenBDの目次リスト等がHanmoto本文を潰す事故を防ぐ。
 * @param {*} isbn
 * @returns {{raw: string, source: string}|null}
 */
function fetchSynopsisFromSources_(isbn) {
  const safeIsbn = normalizeIsbn_(isbn);
  if (!safeIsbn) return null;

  const best = chooseBestSynopsisFromAllSources_(safeIsbn);
  if (!best || !best.raw || !best.source) return null;

  return {
    raw: best.raw,
    source: best.source
  };
}

/**
 * 全ソースから取得した候補の中で最良のものを選ぶ。
 * @param {string} safeIsbn
 * @returns {{raw: string, source: string, score: number}|null}
 */
function chooseBestSynopsisFromAllSources_(safeIsbn) {
  const records = [];

  // Hanmotoは本文品質が高いので最優先で候補化する。
  appendSynopsisCandidateRecords_(
    records,
    SYNOPSIS_SOURCE.HANMOTO,
    () => fetchSynopsisCandidateListFromHanmoto_(safeIsbn)
  );

  // 楽天BooksはitemCaptionが取れる場合、漫画・ラノベ系の救済元として強い。
  appendSynopsisCandidateRecords_(
    records,
    SYNOPSIS_SOURCE.RAKUTEN,
    () => fetchSynopsisCandidateListFromRakutenBooks_(safeIsbn)
  );

  appendSynopsisCandidateRecords_(
    records,
    SYNOPSIS_SOURCE.OPENBD,
    () => fetchSynopsisCandidateListFromOpenBD_(safeIsbn)
  );

  appendSynopsisCandidateRecords_(
    records,
    SYNOPSIS_SOURCE.GOOGLE,
    () => fetchSynopsisCandidateListFromGoogleBooks_(safeIsbn)
  );

  return chooseBestSynopsisCandidateRecord_(records);
}

/**
 * 1ソース分の候補を安全に追加する。
 * 1ソースで失敗しても他ソースの評価は継続する。
 * @param {Array<{raw: *, source: string}>} records
 * @param {string} source
 * @param {Function} producer
 */
function appendSynopsisCandidateRecords_(records, source, producer) {
  try {
    const candidates = typeof producer === 'function' ? producer() : [];
    (candidates || []).forEach(raw => {
      if (raw) records.push({ raw, source });
    });
  } catch (e) {
    console.error(`appendSynopsisCandidateRecords_ ${source}:`, e);
  }
}

/**
 * source付き候補から最良候補を選ぶ。
 * @param {Array<{raw: *, source: string}>} records
 * @returns {{raw: string, source: string, score: number}|null}
 */
function chooseBestSynopsisCandidateRecord_(records) {
  const seen = {};
  const cleaned = [];

  (records || []).forEach(record => {
    const source = record && record.source ? String(record.source) : '';
    const text = cleanSynopsisText_(record && record.raw);
    if (!text || text.length < 20) return;
    if (isBadSynopsisCandidate_(text)) return;

    const dedupeKey = text.replace(/\s+/g, '').slice(0, 160);
    if (seen[dedupeKey]) return;
    seen[dedupeKey] = true;

    const score = scoreSynopsisCandidate_(text) + scoreSourceAdjustment_(source, text);
    if (score < SYNOPSIS_FETCH_CONFIG.MIN_CANDIDATE_SCORE) return;

    cleaned.push({
      raw: text,
      source,
      score
    });
  });

  if (!cleaned.length) return null;

  cleaned.sort((a, b) => b.score - a.score);
  return {
    raw: clampSynopsisLength_(cleaned[0].raw),
    source: cleaned[0].source,
    score: cleaned[0].score
  };
}

/**
 * ソース別の微調整スコア。
 * @param {string} source
 * @param {string} text
 * @returns {number}
 */
function scoreSourceAdjustment_(source, text) {
  const s = String(text || '');
  let score = 0;

  if (source === SYNOPSIS_SOURCE.HANMOTO) score += 75;
  if (source === SYNOPSIS_SOURCE.RAKUTEN) score += 65;
  if (source === SYNOPSIS_SOURCE.OPENBD) score += 25;
  if (source === SYNOPSIS_SOURCE.GOOGLE) score += 10;

  // OpenBDは目次・収録作リストを拾うことがあるため、純目次型は強めに下げる。
  if (source === SYNOPSIS_SOURCE.OPENBD && isPureTocListCandidate_(s)) score -= 600;

  // Hanmotoは本文取得できると強いが、商品仕様・価格ブロックは混ざりやすい。
  if (source === SYNOPSIS_SOURCE.HANMOTO && isProductSpecHeavyCandidate_(s)) score -= 220;

  // 楽天Booksは商品説明(itemCaption)が本命。価格・販売系が混ざる候補は下げる。
  if (source === SYNOPSIS_SOURCE.RAKUTEN && isProductSpecHeavyCandidate_(s)) score -= 180;

  return score;
}

/**
 * OpenBD側に本文候補があるか確認するデバッグ用。
 * ログに候補件数と先頭候補を出す。必要時だけ手動実行。
 * @param {*} isbn
 * @returns {Object}
 */
function debugOpenBdSynopsis_(isbn) {
  const safeIsbn = normalizeIsbn_(isbn);
  if (!safeIsbn) {
    console.log('ISBNが空です。');
    return { isbn: '', hasItem: false, candidateCount: 0, best: '' };
  }

  const url = `https://api.openbd.jp/v1/get?isbn=${encodeURIComponent(safeIsbn)}`;
  const json = fetchJson_(url);
  const item = Array.isArray(json) ? json[0] : null;

  if (!item) {
    console.log(`OpenBD itemなし: ${safeIsbn}`);
    return { isbn: safeIsbn, hasItem: false, candidateCount: 0, best: '' };
  }

  const candidates = [];

  if (item.summary) {
    candidates.push(item.summary.content);
    candidates.push(item.summary.description);
  }

  const textContents = item.onix &&
    item.onix.CollateralDetail &&
    item.onix.CollateralDetail.TextContent;

  if (Array.isArray(textContents)) {
    textContents.forEach(textContent => {
      collectTextCandidatesFromObject_(textContent).forEach(v => candidates.push(v));
    });
  }

  if (item.hanmoto) {
    collectLikelySynopsisFields_(item.hanmoto).forEach(v => candidates.push(v));
  }

  const cleaned = (candidates || [])
    .map(cleanSynopsisText_)
    .filter(v => v && v.length >= 20)
    .filter(v => !isBadSynopsisCandidate_(v));

  const best = chooseBestSynopsisCandidate_(candidates) || '';

  const result = {
    isbn: safeIsbn,
    hasItem: true,
    hasTextContent: Array.isArray(textContents) && textContents.length > 0,
    candidateCount: cleaned.length,
    best: best.slice(0, 500)
  };

  console.log(JSON.stringify(result, null, 2));
  return result;
}


/**
 * OpenBDからあらすじ候補を取得する。
 * @param {*} isbn
 * @returns {string|null}
 */
function fetchSynopsisFromOpenBD_(isbn) {
  return chooseBestSynopsisCandidate_(fetchSynopsisCandidateListFromOpenBD_(isbn));
}

/**
 * OpenBDからあらすじ候補リストを取得する。
 * @param {*} isbn
 * @returns {string[]}
 */
function fetchSynopsisCandidateListFromOpenBD_(isbn) {
  const safeIsbn = normalizeIsbn_(isbn);
  if (!safeIsbn) return [];

  const url = `https://api.openbd.jp/v1/get?isbn=${encodeURIComponent(safeIsbn)}`;
  const json = fetchJson_(url);
  const item = Array.isArray(json) ? json[0] : null;
  if (!item) return [];

  const candidates = [];

  // OpenBDのsummaryは多くの場合、書名・著者・出版社などの短いメタ情報中心。
  // content/descriptionが存在する場合だけ候補に入れる。
  if (item.summary) {
    candidates.push(item.summary.content);
    candidates.push(item.summary.description);
  }

  // ONIX本文。OpenBD側にあらすじがある場合は基本ここに入る。
  const textContents = item.onix &&
    item.onix.CollateralDetail &&
    item.onix.CollateralDetail.TextContent;

  if (Array.isArray(textContents)) {
    textContents.forEach(textContent => {
      collectTextCandidatesFromObject_(textContent).forEach(v => candidates.push(v));
    });
  }

  // OpenBDのhanmoto拡張に説明系フィールドが入っている場合があるため拾う。
  if (item.hanmoto) {
    collectLikelySynopsisFields_(item.hanmoto).forEach(v => candidates.push(v));
  }

  return candidates;
}


/**
 * 版元ドットコムの書誌ページHTMLからあらすじ候補を取得する。
 * 公式APIは停止済みのため、HTML内の本文ブロック/JSON-LD/meta descriptionをfallbackとして利用する。
 * @param {*} isbn
 * @returns {string|null}
 */
function fetchSynopsisFromHanmoto_(isbn) {
  return chooseBestSynopsisCandidate_(fetchSynopsisCandidateListFromHanmoto_(isbn));
}

/**
 * 版元ドットコムの書誌ページHTMLからあらすじ候補リストを取得する。
 * @param {*} isbn
 * @returns {string[]}
 */
function fetchSynopsisCandidateListFromHanmoto_(isbn) {
  const safeIsbn = normalizeIsbn13ForImage_(isbn) || normalizeIsbn_(isbn);
  if (!safeIsbn) return [];

  const url = `https://www.hanmoto.com/bd/isbn/${encodeURIComponent(safeIsbn)}`;
  const html = fetchText_(url);
  if (!html) return [];

  const candidates = [];

  // Hanmotoは「内容紹介」などの見出し直後に本文があるケースが多い。
  // 先にHTMLを行単位のプレーンテキストへ落として、ラベル直後だけを狙って抜く。
  extractHanmotoLabeledTextCandidates_(html).forEach(v => candidates.push(v));

  // 次にclass/idやdt/ddなどの構造から拾う。
  extractHanmotoTextBlockCandidates_(html).forEach(v => candidates.push(v));

  // 最後のfallback: 構造化データ・meta系。
  // ここは検索結果用の短縮文や著者プロフィールを拾うことがあるため、スコアリングで弱める。
  candidates.push(extractJsonLdDescription_(html));
  candidates.push(extractMetaPropertyContent_(html, 'og:description'));
  candidates.push(extractMetaContent_(html, 'description'));

  return candidates;
}

/**
 * 楽天Booksからあらすじ候補を取得する。
 * Script Properties:
 * - RAKUTEN_APP_ID
 * - RAKUTEN_APKEY
 * @param {*} isbn
 * @returns {string|null}
 */
function fetchSynopsisFromRakutenBooks_(isbn) {
  return chooseBestSynopsisCandidate_(fetchSynopsisCandidateListFromRakutenBooks_(isbn));
}

/**
 * 楽天Booksからあらすじ候補リストを取得する。
 * 主に itemCaption をY列あらすじ候補として利用する。
 * @param {*} isbn
 * @returns {string[]}
 */
function fetchSynopsisCandidateListFromRakutenBooks_(isbn) {
  const safeIsbn = normalizeIsbn_(isbn);
  if (!safeIsbn) return [];

  const credentials = getRakutenBooksApiCredentials_();
  if (!credentials) return [];

  const url = buildRakutenBooksSearchUrl_(safeIsbn, credentials);
  const json = fetchRakutenBooksJson_(url);
  const items = json && Array.isArray(json.Items) ? json.Items : [];
  if (!items.length) return [];

  const candidates = [];

  items.forEach(wrapper => {
    const item = wrapper && wrapper.Item ? wrapper.Item : null;
    if (!item) return;

    // ISBN検索でも念のため完全一致を確認する。
    if (normalizeIsbn_(item.isbn) !== safeIsbn) return;

    candidates.push(item.itemCaption);
    candidates.push(item.contents);
  });

  return candidates;
}

/**
 * 楽天Books API用の認証情報をScript Propertiesから取得する。
 * @returns {{appId: string, accessKey: string}|null}
 */
function getRakutenBooksApiCredentials_() {
  const props = PropertiesService.getScriptProperties();
  const appId = String(props.getProperty(SYNOPSIS_FETCH_CONFIG.RAKUTEN_APP_ID_PROPERTY) || '').trim();
  const accessKey = String(props.getProperty(SYNOPSIS_FETCH_CONFIG.RAKUTEN_APKEY_PROPERTY) || '').trim();

  if (!appId || !accessKey) return null;
  return { appId, accessKey };
}

/**
 * 楽天Books書籍検索API URLを生成する。
 * @param {string} safeIsbn
 * @param {{appId: string, accessKey: string}} credentials
 * @returns {string}
 */
function buildRakutenBooksSearchUrl_(safeIsbn, credentials) {
  return SYNOPSIS_FETCH_CONFIG.RAKUTEN_BOOKS_API_URL
    + '?format=json'
    + '&isbn=' + encodeURIComponent(safeIsbn)
    + '&applicationId=' + encodeURIComponent(credentials.appId)
    + '&accessKey=' + encodeURIComponent(credentials.accessKey);
}

/**
 * 楽天Books APIからJSONを取得する。
 * Webアプリケーション登録のReferer制限対策としてReferer/Originを付ける。
 * @param {string} url
 * @returns {*|null}
 */
function fetchRakutenBooksJson_(url) {
  const res = fetchUrlWithRetry_(url, buildRakutenBooksFetchOptions_());
  const code = res.getResponseCode();
  const text = res.getContentText('UTF-8');

  if (code < 200 || code >= 300) {
    console.error(`RakutenBooks HTTP ${code}: ${String(text || '').slice(0, 500)}`);
    return null;
  }

  if (!text) return null;
  return JSON.parse(text);
}

/**
 * 楽天Books API用UrlFetchオプション。
 * @returns {Object}
 */
function buildRakutenBooksFetchOptions_() {
  return {
    muteHttpExceptions: true,
    followRedirects: true,
    headers: {
      'User-Agent': SYNOPSIS_FETCH_CONFIG.USER_AGENT,
      'Accept': 'application/json',
      'Referer': SYNOPSIS_FETCH_CONFIG.RAKUTEN_REFERER,
      'Origin': SYNOPSIS_FETCH_CONFIG.RAKUTEN_ORIGIN
    }
  };
}

/**
 * 楽天Books API接続確認用。
 * 秘密情報はマスクしてログ出力する。
 * @returns {Object}
 */
function testRakutenBooksApiConnection_() {
  const credentials = getRakutenBooksApiCredentials_();
  console.log('=== Rakuten Books API 接続テスト開始 ===');

  if (!credentials) {
    console.error('RAKUTEN_APP_ID または RAKUTEN_APKEY がScript Propertiesにありません。');
    return { ok: false, reason: 'missing_properties' };
  }

  console.log('RAKUTEN_APP_ID: ' + maskSecret_(credentials.appId));
  console.log('RAKUTEN_APKEY : ' + maskSecret_(credentials.accessKey));

  const isbn = '9784088916507';
  const url = buildRakutenBooksSearchUrl_(isbn, credentials);
  const json = fetchRakutenBooksJson_(url);

  if (!json) {
    console.error('楽天Books API取得失敗');
    return { ok: false, reason: 'fetch_failed' };
  }

  console.log('count: ' + json.count);
  console.log('hits : ' + json.hits);

  const item = json.Items && json.Items[0] && json.Items[0].Item ? json.Items[0].Item : null;
  if (!item) {
    console.warn('Items が空です。');
    return { ok: false, reason: 'no_items', count: json.count || 0, hits: json.hits || 0 };
  }

  console.log('title       : ' + item.title);
  console.log('author      : ' + item.author);
  console.log('publisher   : ' + item.publisherName);
  console.log('isbn        : ' + item.isbn);
  console.log('salesDate   : ' + item.salesDate);
  console.log('itemCaption : ' + String(item.itemCaption || '').slice(0, 500));
  console.log('=== Rakuten Books API 接続テスト成功 ===');

  return {
    ok: true,
    title: item.title || '',
    isbn: item.isbn || '',
    captionLength: String(item.itemCaption || '').length
  };
}

/**
 * 楽天Books候補のデバッグ用。
 * @param {*} isbn
 * @returns {Array<Object>}
 */
function debugRakutenBooksCandidates_(isbn) {
  const safeIsbn = normalizeIsbn_(isbn);
  const candidates = fetchSynopsisCandidateListFromRakutenBooks_(safeIsbn);

  const result = (candidates || []).map((raw, index) => {
    const cleaned = cleanSynopsisText_(raw);
    const bad = isBadSynopsisCandidate_(cleaned);
    return {
      index,
      rawLength: String(raw || '').length,
      length: cleaned.length,
      bad,
      score: bad ? null : scoreSynopsisCandidate_(cleaned) + scoreSourceAdjustment_(SYNOPSIS_SOURCE.RAKUTEN, cleaned),
      preview: cleaned.slice(0, 500)
    };
  });

  console.log(JSON.stringify(result, null, 2));
  return result;
}

/**
 * NOT_FOUND行だけを楽天Koboで救済する通常バッチ。
 * 成功: Y=Kobo itemCaption / Z=RakutenKobo
 * 失敗: Y=空欄 / Z=NOT_FOUND.
 * @returns {Object}
 */

// 楽天Kobo救済関連の関数は『あらすじ取得_kobo.gs』へ分離。

function maskSecret_(value) {
  const s = String(value || '');
  if (s.length <= 8) return '********';
  return s.slice(0, 4) + '...' + s.slice(-4);
}

/**
 * Google Booksからあらすじ候補を取得する。
 * @param {*} isbn
 * @returns {string|null}
 */
function fetchSynopsisFromGoogleBooks_(isbn) {
  return chooseBestSynopsisCandidate_(fetchSynopsisCandidateListFromGoogleBooks_(isbn));
}

/**
 * Google Booksからあらすじ候補リストを取得する。
 * @param {*} isbn
 * @returns {string[]}
 */
function fetchSynopsisCandidateListFromGoogleBooks_(isbn) {
  const safeIsbn = normalizeIsbn_(isbn);
  if (!safeIsbn) return [];

  const url = `https://www.googleapis.com/books/v1/volumes?q=ISBN:${encodeURIComponent(safeIsbn)}&maxResults=3&langRestrict=ja`;
  const json = fetchJson_(url);
  const items = json && Array.isArray(json.items) ? json.items : [];
  if (!items.length) return [];

  const candidates = [];

  items.forEach(item => {
    const info = item && item.volumeInfo ? item.volumeInfo : null;
    if (!info) return;

    // ISBN検索でも念のため識別子一致を確認する。
    const identifiers = Array.isArray(info.industryIdentifiers) ? info.industryIdentifiers : [];
    const hasMatchingIsbn = identifiers.some(id => normalizeIsbn_(id && id.identifier) === safeIsbn);
    if (!hasMatchingIsbn && items.length > 1) return;

    candidates.push(info.description);
  });

  return candidates;
}

/**
 * UrlFetchApp.fetch() を短いリトライ付きで実行する。
 * Address unavailable 等の一時通信失敗対策。
 * @param {string} url
 * @param {Object=} options
 * @param {number=} retryCount
 * @returns {GoogleAppsScript.URL_Fetch.HTTPResponse}
 */
function fetchUrlWithRetry_(url, options, retryCount) {
  const max = Math.max(1, Number(retryCount || SYNOPSIS_FETCH_CONFIG.FETCH_RETRY_COUNT || 3));
  const baseSleep = Math.max(0, Number(SYNOPSIS_FETCH_CONFIG.FETCH_RETRY_BASE_SLEEP_MS || 500));

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

  throw lastError || new Error('fetchUrlWithRetry_: unknown error');
}

/**
 * URLからJSONを取得する。
 * @param {string} url
 * @returns {*|null}
 */
function fetchJson_(url) {
  const res = fetchUrlWithRetry_(url, buildFetchOptions_());
  const code = res.getResponseCode();
  if (code < 200 || code >= 300) return null;

  const text = res.getContentText('UTF-8');
  if (!text) return null;

  return JSON.parse(text);
}

/**
 * URLからテキストを取得する。
 * @param {string} url
 * @returns {string|null}
 */
function fetchText_(url) {
  const res = fetchUrlWithRetry_(url, buildFetchOptions_());
  const code = res.getResponseCode();
  if (code < 200 || code >= 300) return null;

  return res.getContentText('UTF-8') || null;
}

/**
 * UrlFetch共通オプション。
 * @returns {Object}
 */
function buildFetchOptions_() {
  return {
    muteHttpExceptions: true,
    followRedirects: true,
    headers: {
      'User-Agent': SYNOPSIS_FETCH_CONFIG.USER_AGENT,
      'Accept': 'application/json,text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
    }
  };
}

/**
 * OpenBDのText項目を文字列化する。
 * @param {*} value
 * @returns {string}
 */
function extractOpenBdText_(value) {
  if (!value) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);

  if (Array.isArray(value)) {
    return value
      .map(v => extractOpenBdText_(v))
      .filter(Boolean)
      .join('\n');
  }

  if (typeof value === 'object') {
    return value.content ||
      value.text ||
      value.value ||
      value.Text ||
      value.TextContent ||
      '';
  }

  return String(value || '');
}



/**
 * OpenBD/hanmoto拡張などのオブジェクトから本文候補を再帰的に拾う。
 * @param {*} value
 * @returns {string[]}
 */
function collectTextCandidatesFromObject_(value) {
  const results = [];

  function walk(v, key) {
    if (v === null || v === undefined) return;

    if (typeof v === 'string') {
      const normalizedKey = String(key || '').toLowerCase();
      if (
        !normalizedKey ||
        /text|content|description|summary|maegaki|kaisetsu|intro|abstract|review|toc|mokuji/.test(normalizedKey)
      ) {
        results.push(v);
      }
      return;
    }

    if (Array.isArray(v)) {
      v.forEach(item => walk(item, key));
      return;
    }

    if (typeof v === 'object') {
      Object.keys(v).forEach(k => {
        if (/isbn|title|author|publisher|pubdate|cover|url|date|price|code|extent|subject/i.test(k)) return;
        walk(v[k], k);
      });
    }
  }

  walk(value, '');
  return results;
}

/**
 * OpenBDのhanmoto拡張などから、あらすじに使えそうなフィールドだけ拾う。
 * @param {Object} obj
 * @returns {string[]}
 */
function collectLikelySynopsisFields_(obj) {
  if (!obj || typeof obj !== 'object') return [];

  const candidates = [];
  const preferredKeys = [
    'maegaki',
    'hanmoto_maegaki',
    'kaisetsu',
    'kaisetsu105w',
    'description',
    'content',
    'summary',
    'abstract',
    'intro',
    'introduction',
    'review',
    'toc',
    'mokuji'
  ];

  preferredKeys.forEach(key => {
    if (obj[key]) candidates.push(extractOpenBdText_(obj[key]));
  });

  collectTextCandidatesFromObject_(obj).forEach(v => candidates.push(v));

  return candidates;
}

/**
 * JSON-LDからdescriptionを抽出する。
 * @param {string} html
 * @returns {string}
 */
function extractJsonLdDescription_(html) {
  const blocks = String(html || '').match(/<script[^>]+type=["']application\/ld\+json["'][^>]*>[\s\S]*?<\/script>/gi) || [];

  for (let i = 0; i < blocks.length; i++) {
    const jsonText = blocks[i]
      .replace(/^<script[^>]*>/i, '')
      .replace(/<\/script>$/i, '')
      .trim();

    try {
      const parsed = JSON.parse(jsonText);
      const found = findDescriptionInJsonLd_(parsed);
      if (found) return found;
    } catch (e) {
      // JSON-LDが壊れているページは無視する
    }
  }

  return '';
}

/**
 * JSON-LD構造内のdescriptionを再帰的に探す。
 * @param {*} value
 * @returns {string}
 */
function findDescriptionInJsonLd_(value) {
  if (!value) return '';

  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      const found = findDescriptionInJsonLd_(value[i]);
      if (found) return found;
    }
    return '';
  }

  if (typeof value === 'object') {
    if (value.description) return String(value.description || '');
    if (value['@graph']) return findDescriptionInJsonLd_(value['@graph']);
  }

  return '';
}

/**
 * meta name="..." からcontentを抽出する。
 * @param {string} html
 * @param {string} name
 * @returns {string}
 */
function extractMetaContent_(html, name) {
  const escaped = escapeRegExp_(name);
  const re = new RegExp(`<meta[^>]+name=["']${escaped}["'][^>]+content=["']([^"']*)["'][^>]*>`, 'i');
  const alt = new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]+name=["']${escaped}["'][^>]*>`, 'i');
  const m = String(html || '').match(re) || String(html || '').match(alt);
  return m ? decodeHtmlEntities_(m[1]) : '';
}

/**
 * meta property="..." からcontentを抽出する。
 * @param {string} html
 * @param {string} property
 * @returns {string}
 */
function extractMetaPropertyContent_(html, property) {
  const escaped = escapeRegExp_(property);
  const re = new RegExp(`<meta[^>]+property=["']${escaped}["'][^>]+content=["']([^"']*)["'][^>]*>`, 'i');
  const alt = new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]+property=["']${escaped}["'][^>]*>`, 'i');
  const m = String(html || '').match(re) || String(html || '').match(alt);
  return m ? decodeHtmlEntities_(m[1]) : '';
}


/**
 * 版元ドットコムHTMLをプレーンテキスト行へ変換し、
 * 「内容紹介」などのラベル直後にある本文だけを候補化する。
 * class/id抽出で取り逃すページの主力fallback。
 * @param {string} html
 * @returns {string[]}
 */
function extractHanmotoLabeledTextCandidates_(html) {
  const lines = htmlToHanmotoPlainLines_(html);
  const candidates = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!isHanmotoSynopsisStartLabel_(line)) continue;

    const chunk = [];
    for (let j = i + 1; j < lines.length && chunk.length < 80; j++) {
      const next = lines[j];
      if (!next) continue;
      if (isHanmotoSynopsisStopLabel_(next)) break;
      if (isHanmotoSynopsisStartLabel_(next) && chunk.length > 0) break;
      if (isHanmotoNoiseLine_(next)) continue;
      chunk.push(next);
    }

    const candidate = chunk.join('\n').trim();
    if (candidate) candidates.push(candidate);
  }

  return candidates;
}

/**
 * HanmotoのHTMLを抽出用の行配列へ変換する。
 * @param {string} html
 * @returns {string[]}
 */
function htmlToHanmotoPlainLines_(html) {
  let s = String(html || '');
  if (!s) return [];

  s = s.replace(/<script[\s\S]*?<\/script>/gi, '');
  s = s.replace(/<style[\s\S]*?<\/style>/gi, '');
  s = s.replace(/<br\s*\/?>/gi, '\n');
  s = s.replace(/<\/?(?:p|div|section|article|li|ul|ol|dl|dt|dd|tr|td|th|table|tbody|thead|h[1-6]|header|footer|nav|aside)[^>]*>/gi, '\n');
  s = s.replace(/<[^>]+>/g, '');
  s = decodeHtmlEntities_(s);
  s = s.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

  return s
    .split('\n')
    .map(normalizeHanmotoPlainLine_)
    .filter(Boolean);
}

/**
 * Hanmotoプレーンテキスト行を正規化する。
 * @param {*} value
 * @returns {string}
 */
function normalizeHanmotoPlainLine_(value) {
  return String(value || '')
    .replace(/\u00A0/g, ' ')
    .replace(/[\t　]+/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

/**
 * 内容紹介系ラベルか判定する。
 * @param {string} line
 * @returns {boolean}
 */
function isHanmotoSynopsisStartLabel_(line) {
  const s = String(line || '').trim().replace(/[：:]$/, '');
  return /^(?:内容紹介|内容|紹介|出版社内容情報|著者からの内容紹介|前書きなど|解説|概要|あらすじ|版元から一言)$/.test(s);
}

/**
 * 内容紹介抽出を止めるラベルか判定する。
 * @param {string} line
 * @returns {boolean}
 */
function isHanmotoSynopsisStopLabel_(line) {
  const s = String(line || '').trim().replace(/[：:]$/, '');
  return /^(?:著者プロフィール|著者略歴|書評掲載情報|目次|書誌情報|判型|ページ数|重量|定価|価格|ISBN|Cコード|ジャンル|発売日|書店発売日|発行日|出版社|登録日|最終更新日|利用可否|在庫|この本を注文する|近刊検索デルタ|版元ドットコム|本の表紙画像の使用に際しての注意点|関連リンク)$/.test(s);
}

/**
 * 抽出時に捨ててよいHanmoto行か判定する。
 * @param {string} line
 * @returns {boolean}
 */
function isHanmotoNoiseLine_(line) {
  const s = String(line || '').trim();
  if (!s) return true;
  if (/^(?:&times;|×)$/i.test(s)) return true;
  if (/^(?:MORE|LESS)$/i.test(s)) return true;
  if (/^(?:この本を注文する|近刊検索デルタ|版元ドットコム)$/.test(s)) return true;
  if (/^【利用可/.test(s)) return true;
  if (/本の表紙画像の使用に際しての注意点|著作権法35条|お問い合わせフォーム/.test(s)) return true;
  return false;
}

/**
 * 著者プロフィール系候補か判定する。
 * @param {string} text
 * @returns {boolean}
 */
function isAuthorProfileCandidate_(text) {
  const s = String(text || '').trim();
  if (!s) return false;
  if (/^著者プロフィール/.test(s)) return true;
  if (/^著者略歴/.test(s)) return true;
  if (/（著）[\s\S]{0,120}(出身|生まれ|デビュー|著書|既刊|受賞歴|漫画家|作家)/.test(s)) return true;
  return false;
}

/**
 * 利用可否・書影利用案内など、あらすじでない権利案内候補か判定する。
 * @param {string} text
 * @returns {boolean}
 */
function isRightsOrAvailabilityCandidate_(text) {
  const s = String(text || '').trim();
  if (!s) return false;
  return /【利用可】|【利用可否不明】|本の表紙画像の使用に際しての注意点|著作権法35条|教育機関における複製等|お問い合わせフォーム|掲載誌見本/.test(s);
}

/**
 * Hanmotoから拾いがちな「タイトル・巻次だけ」の候補か判定する。
 * @param {string} text
 * @returns {boolean}
 */
function isHanmotoLabelOnlyCandidate_(text) {
  const s = String(text || '').trim();
  if (!s) return true;
  if (s.length >= 260) return false;
  if (/[。！？!?]/.test(s)) return false;

  const lines = s.split('\n').map(v => v.trim()).filter(Boolean);
  if (!lines.length) return true;

  const hasVolume = lines.some(line => /巻次[:：]/.test(line));
  const hasOnlyShortLines = lines.every(line => line.length <= 90);
  const hasSynopsisHint = /物語|描く|収録|解説|登場|舞台|主人公|世界|作品|始まる|挑む|入門|実践|レシピ|恋|事件|青春|ファンタジー|ミステリー|家族|謎|冒険|対決|成長|運命|危機|秘密|日常|学園|バトル|コメディ|ラブコメ|サスペンス|ホラー|異世界|転生|魔法|能力/.test(s);

  // 巻次つき・数行だけの短い候補は、作品タイトル自体に「。」や説明語があっても巻情報断片とみなす。
  if (hasVolume && lines.length <= 4 && s.length < 320) return true;

  if (hasVolume && hasOnlyShortLines && !hasSynopsisHint) return true;
  if (lines.length <= 3 && hasOnlyShortLines && !hasSynopsisHint && /^[\w\W]+\([^)]{2,}\)/.test(lines[0])) return true;

  return false;
}

/**
 * 著者プロフィール・書評・書影利用案内など、本文後方のノイズを切る。
 * @param {string} text
 * @returns {string}
 */
function stripTrailingHanmotoNoiseSections_(text) {
  let s = String(text || '');
  const cutPatterns = [
    /\n?\s*上記内容は本書刊行時のものです。?[\s\S]*$/,
    /\n?\s*書店員向け情報はこちら[\s\S]*$/,
    /\n?\s*書店の店頭在庫を確認[\s\S]*$/,
    /\n?\s*近くの本屋の在庫情報を確認する[\s\S]*$/,
    /\n?\s*近くの本屋の在庫情報を[\s\S]*$/,
    /\n?\s*確認しませんか？[\s\S]*$/,
    /\n?\s*ご注文はこちらから[\s\S]*$/,
    /\n?\s*楽天ブックスで購入する[\s\S]*$/,
    /\n?\s*オンライン書店で購入[\s\S]*$/,
    /\n?\s*各書店の検索機能を確認[\s\S]*$/,
    /\n?\s*東京都書店案内[\s\S]*$/,
    /\n?\s*書誌情報の利用[\s\S]*$/,
    /\n?\s*書誌情報の間違いの報告[\s\S]*$/,
    /\n?\s*版元ドットコムについて[\s\S]*$/,
    /\n?\s*会員ログイン[\s\S]*$/,
    /\n?\s*一般社団法人版元ドットコム[\s\S]*$/,
    /\n?\s*Copyright ©[\s\S]*$/,
    /\n?\s*著者プロフィール[\s\S]*$/,
    /\n?\s*著者略歴[\s\S]*$/,
    /\n?\s*書評掲載情報[\s\S]*$/,
    /\n?\s*【本の表紙画像の使用に際しての注意点】[\s\S]*$/,
    /\n?\s*【利用可】[\s\S]*$/,
    /\n?\s*【利用可否不明】[\s\S]*$/,
    /\n?\s*本の表紙画像の使用に際しての注意点[\s\S]*$/,
    /\n?\s*初版年月日[\s\S]*登録日[\s\S]*最終更新日[\s\S]*$/,
    /\n?\s*登録日[\s\S]*最終更新日[\s\S]*$/
  ];

  cutPatterns.forEach(pattern => {
    s = s.replace(pattern, '');
  });

  return s;
}

function debug_isbn_preset_(){
  debugHanmotoCandidates_('9784063546330');
}
/**
 * Hanmoto候補の見え方を確認するデバッグ用。
 * 必要時に手動で debugHanmotoCandidates_('9784063546330') のように実行する。
 * @param {*} isbn
 * @returns {Array<Object>}
 */


function debugHanmotoCandidates_(isbn) {
  const safeIsbn = normalizeIsbn13ForImage_(isbn) || normalizeIsbn_(isbn);
  if (!safeIsbn) {
    console.log('ISBNが空です。');
    return [];
  }

  const candidates = fetchSynopsisCandidateListFromHanmoto_(safeIsbn);
  const result = (candidates || []).map((raw, index) => {
    const cleaned = cleanSynopsisText_(raw);
    const bad = isBadSynopsisCandidate_(cleaned);
    const score = bad ? null : scoreSynopsisCandidate_(cleaned) + scoreSourceAdjustment_(SYNOPSIS_SOURCE.HANMOTO, cleaned);
    return {
      index,
      rawLength: String(raw || '').length,
      length: cleaned.length,
      bad,
      score,
      preview: cleaned.slice(0, 700)
    };
  });

  console.log(JSON.stringify(result, null, 2));
  return result;
}

/**
 * 版元ページ本文から説明文らしきブロックを拾うfallback。
 * @param {string} html
 * @returns {string}
 */
function extractHanmotoTextBlock_(html) {
  const candidates = extractHanmotoTextBlockCandidates_(html);
  return candidates.length ? candidates[0] : '';
}

/**
 * 版元ページ本文から説明文らしきブロックを複数候補として拾う。
 * meta descriptionは短縮されやすいため、本文ブロック優先で使う。
 * @param {string} html
 * @returns {string[]}
 */
function extractHanmotoTextBlockCandidates_(html) {
  const text = String(html || '');
  const candidates = [];

  // label抽出は別関数で最優先済み。ここではHTML構造から拾える候補を補助的に集める。
  const blockPatterns = [
    /<(?:div|section|article|p)[^>]+(?:id|class)=["'][^"']*(?:bookdetail|book-detail|book_data|book-data|bookinfo|book-info|content|description|item_text|item-text|book_text|book-text|summary|lead|intro|introduction|kaisetsu|maegaki|honbun|description-area|detail-text)[^"']*["'][^>]*>([\s\S]*?)<\/(?:div|section|article|p)>/gi
  ];

  blockPatterns.forEach(pattern => {
    let m;
    while ((m = pattern.exec(text)) !== null) {
      if (m[1]) candidates.push(m[1]);
    }
  });

  // 見出し「内容紹介」「出版社内容情報」などの直後を拾うfallback。
  const headingPattern = /<(h[1-6]|dt|th|strong|b)[^>]*>\s*(?:<[^>]+>)*\s*(?:内容紹介|内容|紹介|出版社内容情報|著者からの内容紹介|前書きなど|解説|概要|あらすじ)\s*(?:<\/[^>]+>)*\s*<\/\1>([\s\S]{0,7000}?)(?=<(?:h[1-6]|dt|th|strong|b)[^>]*>|<\/(?:section|article)>|$)/gi;
  let mh;
  while ((mh = headingPattern.exec(text)) !== null) {
    if (mh[2]) candidates.push(mh[2]);
  }

  // dl構造の「内容紹介」→dd。
  const ddPattern = /<dt[^>]*>\s*(?:<[^>]+>)*\s*(?:内容紹介|内容|紹介|出版社内容情報|前書きなど|解説|概要|あらすじ)\s*(?:<\/[^>]+>)*\s*<\/dt>\s*<dd[^>]*>([\s\S]*?)<\/dd>/gi;
  let md;
  while ((md = ddPattern.exec(text)) !== null) {
    if (md[1]) candidates.push(md[1]);
  }

  // table構造の「内容紹介」→td。
  const tdPattern = /<t[hd][^>]*>\s*(?:<[^>]+>)*\s*(?:内容紹介|内容|紹介|出版社内容情報|前書きなど|解説|概要|あらすじ)\s*(?:<\/[^>]+>)*\s*<\/t[hd]>\s*<td[^>]*>([\s\S]*?)<\/td>/gi;
  let mt;
  while ((mt = tdPattern.exec(text)) !== null) {
    if (mt[1]) candidates.push(mt[1]);
  }

  return candidates;
}

/**
 * 複数候補から最も使いやすい本文を選ぶ。
 * 単一ソース内での互換関数。全ソース比較は chooseBestSynopsisCandidateRecord_ を使う。
 * @param {Array<*>} candidates
 * @returns {string|null}
 */
function chooseBestSynopsisCandidate_(candidates) {
  const records = (candidates || []).map(raw => ({ raw, source: '' }));
  const best = chooseBestSynopsisCandidateRecord_(records);
  return best ? best.raw : null;
}

/**
 * あらすじ候補の簡易スコア。
 * 長すぎず短すぎず、書誌メタだけではないものを優先する。
 * @param {string} text
 * @returns {number}
 */
function scoreSynopsisCandidate_(text) {
  const s = String(text || '');
  const len = s.length;
  let score = Math.min(len, 1200);

  const sentenceCount = (s.match(/[。！？!?]/g) || []).length;
  const lineCount = getMeaningfulLineCount_(s);

  if (len >= 60 && len <= 1800) score += 180;
  if (len >= 120) score += 100;
  if (len >= 250) score += 80;
  if (sentenceCount >= 1) score += 90;
  if (sentenceCount >= 2) score += 90;
  if (sentenceCount >= 4) score += 60;

  // 説明文らしさは「加点」に留める。足切りには使わない。
  if (/内容|物語|主人公|世界|作品|収録|解説|入門|描く|舞台|青春|恋|家族|事件|登場|始まる|挑む|新装版|完全版|短編集|実践|レシピ|写真|イラスト|カレンダー|特典|ファンタジー/.test(s)) {
    score += 80;
  }

  // 適度な箇条書きはガイドブック・特典説明などで有用なことがある。
  if (/[●◆■★・]/.test(s) && !isPureTocListCandidate_(s)) score += 30;

  // 純粋な目次・収録作一覧はRAWとしては弱い。
  if (isPureTocListCandidate_(s)) score -= 500;

  // 商品仕様が本文より強い候補は下げる。
  if (isProductSpecHeavyCandidate_(s)) score -= 220;

  // 著者プロフィール・権利案内・書誌メタ情報は強めに減点。
  if (isAuthorProfileCandidate_(s)) score -= 900;
  if (isRightsOrAvailabilityCandidate_(s)) score -= 900;
  if (/ISBN|発売日|出版社|価格|判型|ページ数|ジャンル|著者名|登録日|最終更新日|初版年月日|Cコード/.test(s)) score -= 220;
  if (/引用：版元ドットコム/.test(s)) score -= 700;
  if (/[……]\n?$/.test(s)) score -= 120;
  if (/[……]\n?\s*[-－—]\s*引用：版元ドットコム\s*$/.test(s)) score -= 900;

  // タイトルだけっぽい短文はほぼ使えない。
  if (isTitleOnlyLikeCandidate_(s)) score -= 500;
  if (isHanmotoLabelOnlyCandidate_(s)) score -= 700;

  // 行数が少なく、句点もなく、短い候補は弱い。
  if (lineCount <= 2 && sentenceCount === 0 && len < 120) score -= 260;

  return score;
}

/**
 * あらすじとして不適切な候補を除外する。
 * ここでは明確なゴミだけ落とす。曖昧な判定はスコア側で調整する。
 * @param {string} text
 * @returns {boolean}
 */
function isBadSynopsisCandidate_(text) {
  const s = String(text || '').trim();
  if (!s) return true;
  if (/^https?:\/\//i.test(s)) return true;
  if (/^ISBN[:：\s]/i.test(s)) return true;
  if (/^(発売日|出版社|価格|判型|ページ数)[:：]/.test(s)) return true;
  if (s.length < 20) return true;

  // HanmotoのページUI/利用可否断片。
  if (/【利用可否不明】/.test(s)) return true;
  if (/【利用可】/.test(s)) return true;
  if (/^(?:&times;|×)\s*$/i.test(s)) return true;
  if (/^(?:&times;|×)\s*\n+/i.test(s)) return true;
  if (isRightsOrAvailabilityCandidate_(s)) return true;

  // 著者プロフィール・書評・書影ルールだけの候補。
  if (isAuthorProfileCandidate_(s)) return true;
  if (/^書評掲載情報/.test(s)) return true;
  if (/^【本の表紙画像の使用に際しての注意点】/.test(s)) return true;

  // 価格だけ・商品仕様だけ。
  if (/^定価\s*\n+\s*[\d,.]+\s*円\+税\s*\n+\s*[\d,.]+\s*円（税込）\s*$/s.test(s)) return true;
  if (/定価\s*\n+\s*[\d,.]+\s*円\+税/.test(s) && s.length < 180) return true;

  // 書誌メタ情報だけ。
  if (/初版年月日[\s\S]*登録日[\s\S]*最終更新日/.test(s) && s.length < 350) return true;
  if (/登録日[\s\S]*最終更新日/.test(s) && s.length < 260) return true;

  // 巻次・タイトル表記だけ。
  if (/巻次[:：]/.test(s) && s.length < 320) return true;
  if (isHanmotoLabelOnlyCandidate_(s)) return true;
  if (isTitleOnlyLikeCandidate_(s)) return true;

  // 純粋な目次・収録作一覧だけは、あらすじRAWとしては採用しない。
  if (isPureTocListCandidate_(s)) return true;

  // ほぼ書誌情報だけの候補は除外。
  const metaWords = (s.match(/ISBN|発売日|出版社|価格|判型|ページ数|著者|Cコード/g) || []).length;
  if (metaWords >= 3 && s.length < 500) return true;

  return false;
}

/**
 * タイトル・読み・単純な表記だけに見える短文か判定する。
 * @param {string} text
 * @returns {boolean}
 */
function isTitleOnlyLikeCandidate_(text) {
  const s = String(text || '').trim();
  if (!s) return true;
  if (s.length >= 120) return false;
  if (/[。！？!?]/.test(s)) return false;
  if ((s.match(/\n/g) || []).length >= 2) return false;
  if (/物語|描く|収録|解説|登場|舞台|主人公|世界|作品|始まる|挑む|入門|実践|レシピ|ファンタジー|ミステリー|青春|恋|事件/.test(s)) return false;

  // 「タイトル (読み)」だけのような候補。
  if (/^[\s\S]{2,80}\([^)]{2,80}\)$/.test(s)) return true;
  if (/^[\s\S]{2,80}（[^）]{2,80}）$/.test(s)) return true;

  // 記号や英数字中心の短い表題。
  const noSpace = s.replace(/\s+/g, '');
  if (noSpace.length < 80 && !/[、，]/.test(s)) return true;

  return false;
}

/**
 * 純粋な目次・収録作一覧だけに見える候補か判定する。
 * @param {string} text
 * @returns {boolean}
 */
function isPureTocListCandidate_(text) {
  const lines = String(text || '')
    .split('\n')
    .map(v => v.trim())
    .filter(Boolean);

  if (lines.length < 8) return false;

  const joined = lines.join('');
  const sentenceCount = (joined.match(/[。！？!?]/g) || []).length;
  if (sentenceCount >= 2) return false;

  const avgLen = joined.length / lines.length;
  if (avgLen > 32) return false;

  // 章タイトル・収録作名が並んでいるだけの形。
  const shortLineRatio = lines.filter(line => line.length <= 28).length / lines.length;
  return shortLineRatio >= 0.75;
}

/**
 * 商品サイズ・特典・定価などの仕様情報が強すぎる候補か判定する。
 * @param {string} text
 * @returns {boolean}
 */
function isProductSpecHeavyCandidate_(text) {
  const s = String(text || '');
  const specHits = (s.match(/定価|税込|商品サイズ|予定|特典|封入|仕様|カバー|シール|ポスター|カード|応募者全員|タテ|ヨコ|厚み/g) || []).length;
  const sentenceCount = (s.match(/[。！？!?]/g) || []).length;

  if (specHits >= 4 && sentenceCount <= 2) return true;
  if (/^定価\s*\n/.test(s)) return true;
  return false;
}

/**
 * 空行を除いた行数を返す。
 * @param {string} text
 * @returns {number}
 */
function getMeaningfulLineCount_(text) {
  return String(text || '')
    .split('\n')
    .map(v => v.trim())
    .filter(Boolean)
    .length;
}

/**
 * 本文をセル保存向けに整形する。
 * @param {*} value
 * @returns {string}
 */
function cleanSynopsisText_(value) {
  let s = String(value || '');
  if (!s) return '';

  s = s.replace(/<script[\s\S]*?<\/script>/gi, '');
  s = s.replace(/<style[\s\S]*?<\/style>/gi, '');
  s = s.replace(/<br\s*\/?>/gi, '\n');
  s = s.replace(/<\/(?:p|li|dt|dd|tr|td|th|div|section|article|h[1-6])\s*>/gi, '\n');
  s = s.replace(/<[^>]+>/g, '');
  s = decodeHtmlEntities_(s);
  s = s.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

  // 先頭のページUI断片。
  s = s.replace(/^\s*(?:&times;|×)\s*\n+/i, '');

  // 版元ドットコムの検索結果用descriptionに付く引用表記を除去。
  s = s.replace(/\s*[……]\s*[-－—]\s*引用：版元ドットコム\s*$/g, '…');
  s = s.replace(/\s*[-－—]\s*引用：版元ドットコム\s*$/g, '');

  // 版元ページ内のUI文言や余計なラベルを軽く掃除。
  s = s.replace(/^\s*(内容紹介|出版社内容情報|紹介|解説|概要|前書きなど|あらすじ)\s*[:：]?\s*/gm, '');
  s = s.replace(/^\s*(この本を注文する|近刊検索デルタ|版元ドットコム|書誌情報|利用可否|在庫|定価|MORE|LESS)\s*$/gmi, '');
  s = s.replace(/^\s*【利用可否不明】\s*$/gm, '');
  s = s.replace(/^\s*【利用可】\s*$/gm, '');

  // 内容紹介の後ろに混ざりやすいノイズを切る。
  s = stripTrailingHanmotoNoiseSections_(s);

  s = s.replace(/[ \t\f\v]+/g, ' ');
  s = s.replace(/[　]+/g, ' ');
  s = s.replace(/\n[ \t　]+/g, '\n');
  s = s.replace(/[ \t　]+\n/g, '\n');
  s = s.replace(/\n{3,}/g, '\n\n');
  s = s.replace(/^[\s　]+|[\s　]+$/g, '');

  // クリーニング後にUI断片だけになったものは空にする。
  if (/^(?:&times;|×)$/i.test(s)) return '';
  if (isRightsOrAvailabilityCandidate_(s)) return '';

  return s;
}

/**
 * セルに入れるRAWの最大長を制限する。
 * @param {string} text
 * @returns {string}
 */
function clampSynopsisLength_(text) {
  const s = String(text || '').trim();
  const max = SYNOPSIS_FETCH_CONFIG.MAX_RAW_LENGTH;
  if (s.length <= max) return s;
  return `${s.slice(0, max)}…`;
}

/**
 * HTMLエンティティを最低限デコードする。
 * @param {string} text
 * @returns {string}
 */
function decodeHtmlEntities_(text) {
  return String(text || '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, num) => String.fromCharCode(parseInt(num, 10)));
}

/**
 * 正規表現用エスケープ。
 * @param {string} text
 * @returns {string}
 */
function escapeRegExp_(text) {
  return String(text || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Y/Zへ結果を書き込む。
 * @param {GoogleAppsScript.Spreadsheet.Sheet} sheet
 * @param {number} rowNumber
 * @param {string} raw
 * @param {string} source
 * @param {*=} errorObj
 */
function writeSynopsisResult_(sheet, rowNumber, raw, source, errorObj) {
  sheet
    .getRange(rowNumber, CONFIG.COL.SUMMARY, 1, 2)
    .setValues([[raw || '', source || '']]);

  const sourceCell = sheet.getRange(rowNumber, CONFIG.COL.SUMMARY_SOURCE);
  if (errorObj) {
    const message = errorObj && errorObj.message ? errorObj.message : String(errorObj || 'Unknown error');
    sourceCell.setNote(message.slice(0, 500));
  } else {
    sourceCell.clearNote();
  }
}

/**
 * ソート前にY/Zを本ごとのキーで退避する。
 * 重複キーにも対応するため、値は配列キューで保持する。
 * @param {GoogleAppsScript.Spreadsheet.Sheet} sheet
 * @param {number=} lastRow
 * @returns {Object<string, Array<Array<string>>>}
 */
function snapshotSynopsisByBookKey_(sheet, lastRow) {
  ensureSynopsisColumns_(sheet);

  const last = lastRow || getLastDataRow(sheet, CONFIG.COL.TITLE);
  if (last < 2) return {};

  const rowCount = last - 1;
  const displayRows = sheet.getRange(2, 1, rowCount, CONFIG.COL.MAX).getDisplayValues();
  const synopsisRows = sheet.getRange(2, CONFIG.COL.SUMMARY, rowCount, 2).getValues();
  const map = {};

  displayRows.forEach((row, i) => {
    const key = buildSynopsisPreserveKeyFromAbsoluteRow_(row);
    if (!key) return;

    const raw = synopsisRows[i][0] || '';
    const source = synopsisRows[i][1] || '';
    if (!raw && !source) return;

    if (!map[key]) map[key] = [];
    map[key].push([raw, source]);
  });

  return map;
}

/**
 * ソート後の現在行に合わせてY/Zを復元する。
 * キー一致しない行は空欄にして、別本のあらすじが残る事故を防ぐ。
 * @param {GoogleAppsScript.Spreadsheet.Sheet} sheet
 * @param {Object<string, Array<Array<string>>>} snapshot
 * @param {number=} lastRow
 */
function restoreSynopsisByBookKey_(sheet, snapshot, lastRow) {
  ensureSynopsisColumns_(sheet);

  const last = lastRow || getLastDataRow(sheet, CONFIG.COL.TITLE);
  if (last < 2) return;

  const rowCount = last - 1;
  const displayRows = sheet.getRange(2, 1, rowCount, CONFIG.COL.MAX).getDisplayValues();
  const output = displayRows.map(row => {
    const key = buildSynopsisPreserveKeyFromAbsoluteRow_(row);
    if (!key || !snapshot || !snapshot[key] || !snapshot[key].length) {
      return ['', ''];
    }
    return snapshot[key].shift();
  });

  sheet
    .getRange(2, CONFIG.COL.SUMMARY, output.length, 2)
    .setValues(output);
}

/**
 * Y/Z退避用キーを生成する。
 * ISBNを主軸にしつつ、タイトル・作者も足して誤衝突を避ける。
 * @param {string[]} row A列始まりのdisplayValues行
 * @returns {string}
 */
function buildSynopsisPreserveKeyFromAbsoluteRow_(row) {
  const isbn = normalizeIsbn_(row[CONFIG.COL.ISBN - 1]);
  const title = normalizeSynopsisKeyPart_(row[CONFIG.COL.TITLE - 1]);
  const author = normalizeSynopsisKeyPart_(row[CONFIG.COL.AUTHOR - 1]);

  if (!isbn && !title) return '';

  return [isbn, title, author].join('::');
}

/**
 * 退避用キーの文字列正規化。
 * @param {*} value
 * @returns {string}
 */
function normalizeSynopsisKeyPart_(value) {
  return String(value || '')
    .normalize('NFKC')
    .replace(/\u00A0/g, ' ')
    .replace(/\u200B/g, '')
    .replace(/\uFEFF/g, '')
    .replace(/[\s　]+/g, ' ')
    .trim()
    .toLowerCase();
}
