// ＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝
// あらすじ取得_kobo.gs
//  - Z列 = NOT_FOUND の行だけを楽天Kobo APIで救済
//  - Main側の CONFIG / SYNOPSIS_SOURCE / SYNOPSIS_FETCH_CONFIG を参照
//  - GASでは同一プロジェクト内の .gs ファイルは同じグローバルスコープで動作
// ＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝

function retryNotFoundSynopsisFromRakutenKobo_() {
  return retryNotFoundSynopsisFromRakutenKoboByLimit_(SYNOPSIS_FETCH_CONFIG.KOBO_RETRY_BATCH_SIZE);
}

/**
 * NOT_FOUND行だけを楽天Koboで救済するテスト10件バッチ。
 * @returns {Object}
 */
function retryNotFoundSynopsisFromRakutenKoboTest10_() {
  return retryNotFoundSynopsisFromRakutenKoboByLimit_(SYNOPSIS_FETCH_CONFIG.KOBO_RETRY_TEST_BATCH_SIZE);
}

/**
 * NOT_FOUND行だけを楽天Koboで救済する指定件数バッチ。
 * @param {number} limit
 * @returns {Object}
 */
function retryNotFoundSynopsisFromRakutenKoboByLimit_(limit) {
  const sheet = getSheet(CONFIG.SHEETS.MAIN);
  ensureSynopsisColumns_(sheet);

  // Kobo救済では RakutenKobo / NOT_FOUND. を書き込むため、
  // 古い入力規則が残っていてもここで自動更新する。
  setSynopsisSourceValidation_();

  const last = getLastDataRow(sheet, CONFIG.COL.TITLE);
  if (last < 2) {
    return buildKoboRetryBatchResult_(0, 0, 0, 0, 0);
  }

  const startTime = Date.now();
  const batchLimit = Math.max(1, Number(limit || SYNOPSIS_FETCH_CONFIG.KOBO_RETRY_BATCH_SIZE));
  const rowCount = last - 1;
  const rows = sheet.getRange(2, 1, rowCount, CONFIG.COL.MAX).getDisplayValues();

  let processed = 0;
  let success = 0;
  let notFoundDone = 0;
  let skipped = 0;
  let error = 0;

  for (let i = 0; i < rows.length; i++) {
    if (Date.now() - startTime > SYNOPSIS_FETCH_CONFIG.MAX_EXECUTION_MS) {
      console.log('⏱ Kobo救済: タイムアウト回避で途中終了');
      break;
    }

    if (processed >= batchLimit) break;

    const rowNumber = i + 2;
    const row = rows[i];
    const source = normalizeSynopsisSourceValue_(row[CONFIG.COL.SUMMARY_SOURCE - 1]);

    if (source !== SYNOPSIS_SOURCE.NOT_FOUND) continue;

    const context = buildRakutenKoboSearchContextFromRow_(row);
    if (!context.title) {
      skipped++;
      processed++;
      writeSynopsisResult_(sheet, rowNumber, '', SYNOPSIS_SOURCE.NOT_FOUND_DONE);
      Utilities.sleep(50);
      continue;
    }

    processed++;

    try {
      const result = fetchBestRakutenKoboSynopsisForContext_(context);
      if (result && result.raw) {
        writeSynopsisResult_(sheet, rowNumber, result.raw, SYNOPSIS_SOURCE.RAKUTEN_KOBO);
        success++;
      } else {
        writeSynopsisResult_(sheet, rowNumber, '', SYNOPSIS_SOURCE.NOT_FOUND_DONE);
        notFoundDone++;
      }
    } catch (e) {
      console.error(`retryNotFoundSynopsisFromRakutenKobo row=${rowNumber} title=${context.title}:`, e);
      writeSynopsisResult_(sheet, rowNumber, '', SYNOPSIS_SOURCE.ERROR, e);
      error++;
    }

    Utilities.sleep(Math.max(SYNOPSIS_FETCH_CONFIG.SLEEP_MS, SYNOPSIS_FETCH_CONFIG.KOBO_API_SLEEP_MS));
  }

  SpreadsheetApp.flush();

  const result = buildKoboRetryBatchResult_(processed, success, notFoundDone, skipped, error);
  if (result.processed > 0) {
    clearLibrarySearchCache_();
  }
  SpreadsheetApp.getActive().toast(
    `Kobo救済: 処理${result.processed} / 成功${result.success} / 未発見確定${result.notFoundDone}`
  );

  return result;
}

/**
 * Kobo救済バッチ結果オブジェクト生成。
 * @param {number} processed
 * @param {number} success
 * @param {number} notFoundDone
 * @param {number} skipped
 * @param {number} error
 * @returns {Object}
 */
function buildKoboRetryBatchResult_(processed, success, notFoundDone, skipped, error) {
  return {
    processed,
    success,
    notFoundDone,
    skipped,
    error
  };
}

/**
 * シート行からKobo検索用コンテキストを生成する。
 * @param {string[]} row A列始まりのdisplayValues行
 * @returns {{title: string, author: string, publisher: string, seriesKey: string, volume: number|null}}
 */
function buildRakutenKoboSearchContextFromRow_(row) {
  const title = String(row[CONFIG.COL.TITLE - 1] || '').trim();
  const author = String(row[CONFIG.COL.AUTHOR - 1] || '').trim();
  const publisher = String(row[CONFIG.COL.PUBLISHER - 1] || '').trim();
  const seriesKey = String(row[CONFIG.COL.SERIES_KEY_AUTO - 1] || '').trim();
  const volumeInfo = extractVolumeInfoForKobo_(title);
  const volume = volumeInfo ? volumeInfo.number : null;
  const volumeRaw = volumeInfo ? volumeInfo.raw : '';

  return { title, author, publisher, seriesKey, volume, volumeRaw, volumeInfo };
}

/**
 * Kobo APIから安全に使える最良候補を取得する。
 * @param {{title: string, author: string, publisher: string, seriesKey: string, volume: number|null}} context
 * @returns {{raw: string, source: string, score: number}|null}
 */
function fetchBestRakutenKoboSynopsisForContext_(context) {
  const records = fetchRakutenKoboCandidateRecords_(context);
  if (!records.length) return null;

  records.sort((a, b) => b.score - a.score);
  const best = records[0];
  if (!best || !best.raw) return null;

  return {
    raw: clampSynopsisLength_(best.raw),
    source: SYNOPSIS_SOURCE.RAKUTEN_KOBO,
    score: best.score
  };
}

/**
 * Kobo APIから候補レコードを取得する。
 * @param {{title: string, author: string, publisher: string, seriesKey: string, volume: number|null}} context
 * @returns {Array<{raw: string, source: string, score: number, itemTitle: string, keyword: string}>}
 */
function fetchRakutenKoboCandidateRecords_(context) {
  const credentials = getRakutenBooksApiCredentials_();
  if (!credentials) return [];

  const keywords = buildRakutenKoboKeywordCandidates_(context);
  const seenItemNumbers = {};
  const seenText = {};
  const records = [];

  for (let i = 0; i < keywords.length; i++) {
    const keyword = keywords[i];
    const json = fetchRakutenKoboJson_(buildRakutenKoboSearchUrl_(keyword, credentials));
    const items = json && Array.isArray(json.Items) ? json.Items : [];

    items.forEach(wrapper => {
      const item = wrapper && wrapper.Item ? wrapper.Item : null;
      if (!item) return;

      const itemNumber = String(item.itemNumber || '').trim();
      if (itemNumber && seenItemNumbers[itemNumber]) return;
      if (itemNumber) seenItemNumbers[itemNumber] = true;

      const record = buildRakutenKoboCandidateRecord_(item, context, keyword);
      if (!record) return;

      const dedupeKey = record.raw.replace(/\s+/g, '').slice(0, 160);
      if (seenText[dedupeKey]) return;
      seenText[dedupeKey] = true;

      records.push(record);
    });

    // 十分良い候補が見つかったら、同じ行で追加keywordを叩かない。
    // ただし、英語候補しか見えていない段階で止めると、
    // 次keywordで返る日本語版を見逃すことがある。
    // そのため、日本語候補が十分強い場合は即停止、
    // 非日本語候補だけの場合は少なくとも2keywordまで確認する。
    if (hasPreferredJapaneseRakutenKoboRecord_(records)) {
      break;
    }

    if (i >= 1 && records.some(record => record.score >= SYNOPSIS_FETCH_CONFIG.KOBO_EARLY_STOP_SCORE)) {
      break;
    }

    if (i < keywords.length - 1) {
      Utilities.sleep(SYNOPSIS_FETCH_CONFIG.KOBO_API_SLEEP_MS);
    }
  }

  return records;
}

/**
 * Kobo API検索URLを生成する。
 * @param {string} keyword
 * @param {{appId: string, accessKey: string}} credentials
 * @returns {string}
 */
function buildRakutenKoboSearchUrl_(keyword, credentials) {
  return SYNOPSIS_FETCH_CONFIG.RAKUTEN_KOBO_API_URL
    + '?format=json'
    + '&keyword=' + encodeURIComponent(keyword)
    + '&applicationId=' + encodeURIComponent(credentials.appId)
    + '&accessKey=' + encodeURIComponent(credentials.accessKey);
}

/**
 * Kobo APIからJSONを取得する。
 * @param {string} url
 * @returns {*|null}
 */
function fetchRakutenKoboJson_(url) {
  const max = Math.max(1, Number(SYNOPSIS_FETCH_CONFIG.KOBO_RATE_LIMIT_RETRY_COUNT || 4));
  const sleepMs = Math.max(1000, Number(SYNOPSIS_FETCH_CONFIG.KOBO_RATE_LIMIT_SLEEP_MS || 1200));

  for (let attempt = 0; attempt < max; attempt++) {
    const res = fetchUrlWithRetry_(url, buildRakutenKoboFetchOptions_());
    const code = res.getResponseCode();
    const text = res.getContentText('UTF-8');

    if (code === 429) {
      const wait = sleepMs * (attempt + 1);
      console.warn(`RakutenKobo HTTP 429: rate limit. retry=${attempt + 1}/${max}, wait=${wait}ms`);
      if (attempt >= max - 1) {
        console.error(`RakutenKobo HTTP 429: ${String(text || '').slice(0, 500)}`);
        return null;
      }
      Utilities.sleep(wait);
      continue;
    }

    if (code < 200 || code >= 300) {
      console.error(`RakutenKobo HTTP ${code}: ${String(text || '').slice(0, 500)}`);
      return null;
    }

    if (!text) return null;
    return JSON.parse(text);
  }

  return null;
}

/**
 * Kobo API用UrlFetchオプション。
 * @returns {Object}
 */
function buildRakutenKoboFetchOptions_() {
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
 * Kobo候補を1件分評価する。
 * @param {Object} item
 * @param {{title: string, author: string, publisher: string, seriesKey: string, volume: number|null}} context
 * @param {string} keyword
 * @returns {{raw: string, source: string, score: number, itemTitle: string, keyword: string}|null}
 */
function buildRakutenKoboCandidateRecord_(item, context, keyword) {
  if (isRakutenKoboTrialItem_(item)) return null;

  const caption = cleanSynopsisText_(item.itemCaption || '');
  if (!caption || caption.length < 20) return null;
  if (isBadSynopsisCandidate_(caption)) return null;

  const match = evaluateRakutenKoboItemMatch_(item, context);
  if (!match || !match.ok) return null;

  const japaneseTextScore = getJapaneseTextScoreForKobo_(caption, item.language);
  const synopsisScore = scoreSynopsisCandidate_(caption) + 70;
  const score = synopsisScore + match.score + japaneseTextScore;

  return {
    raw: caption,
    source: SYNOPSIS_SOURCE.RAKUTEN_KOBO,
    score,
    itemTitle: String(item.title || ''),
    itemSeries: String(item.seriesName || ''),
    itemAuthor: String(item.author || ''),
    itemPublisher: String(item.publisherName || ''),
    itemLanguage: String(item.language || ''),
    japaneseTextScore,
    keyword,
    matchReason: match.reason,
    titleMatch: match.titleMatch,
    authorMatch: match.authorMatch,
    publisherMatch: match.publisherMatch,
    riskyLatinBase: match.riskyLatinBase,
    titleIdentityMatch: match.titleIdentityMatch
  };
}


/**
 * Kobo候補の本文言語スコア。
 * 安全判定を通った候補同士で、日本語説明がある場合は日本語版を優先する。
 * 日本語候補が無い場合は英語版も残すため、英語は除外ではなく減点に留める。
 * @param {*} text
 * @param {*} language
 * @returns {number}
 */
function getJapaneseTextScoreForKobo_(text, language) {
  const s = String(text || '');
  if (!s) return 0;

  const lang = String(language || '').trim().toUpperCase();
  const jaChars = (s.match(/[ぁ-んァ-ヶ一-龠々〆ヵヶ]/g) || []).length;
  const latinChars = (s.match(/[A-Za-z]/g) || []).length;
  const totalLetters = Math.max(1, jaChars + latinChars);
  const jaRatio = jaChars / totalLetters;

  let score = 0;

  if (lang === 'JA') score += 280;
  if (jaChars >= 12) score += 360;
  if (jaChars >= 30) score += 280;
  if (jaRatio >= 0.35) score += 260;
  if (jaRatio >= 0.65) score += 160;

  // itemCaptionが英語のみ・欧文のみっぽい場合は下げる。
  // ただし日本語候補が存在しない作品では、この候補が最良として残れる程度の減点にする。
  if (jaChars === 0 && latinChars >= 80) score -= 420;
  if (lang && lang !== 'JA' && jaChars === 0 && latinChars >= 80) score -= 180;

  return score;
}

/**
 * Kobo候補群に、早期停止してよい日本語優先候補があるか判定する。
 * @param {Array<{score: number, japaneseTextScore: number}>} records
 * @returns {boolean}
 */
function hasPreferredJapaneseRakutenKoboRecord_(records) {
  return (records || []).some(record => {
    const score = Number(record && record.score || 0);
    const jaScore = Number(record && record.japaneseTextScore || 0);
    return score >= SYNOPSIS_FETCH_CONFIG.KOBO_EARLY_STOP_SCORE && jaScore >= 500;
  });
}

/**
 * Koboの無料お試し版など、採用すべきでない商品か判定する。
 * @param {Object} item
 * @returns {boolean}
 */
function isRakutenKoboTrialItem_(item) {
  const title = String(item && item.title || '');
  const caption = String(item && item.itemCaption || '');
  if (/無料お試し版|無料版|試し読み/i.test(title)) return true;
  if (/^\s*【無料お試し版/.test(caption)) return true;
  return false;
}

/**
 * Kobo検索keyword候補を生成する。
 * @param {{title: string, author: string, publisher: string, seriesKey: string, volume: number|null}} context
 * @returns {string[]}
 */
function buildRakutenKoboKeywordCandidates_(context) {
  const title = String(context && context.title || '').trim();
  const seriesKey = String(context && context.seriesKey || '').trim();
  const volumeInfo = (context && context.volumeInfo) ? context.volumeInfo : extractVolumeInfoForKobo_(title);
  const volume = volumeInfo && volumeInfo.number ? Number(volumeInfo.number) : (context && context.volume ? Number(context.volume) : null);
  const volumeRaw = volumeInfo && volumeInfo.raw ? String(volumeInfo.raw).trim() : String(context && context.volumeRaw || '').trim();
  const titleBase = deriveKoboTitleBase_(title);

  const candidates = [];
  // API検索では、シート表示タイトル由来の表記を優先する。
  // series_key_auto はひらがな化されていることがあるため、
  // 「あたしンち」「うさぎドロップ」のようなKobo上の表記を先に投げる。
  const bases = uniqueStringList_([
    titleBase,
    seriesKey,
    stripKoboParentheticalRuby_(titleBase),
    stripKoboParentheticalRuby_(seriesKey),
    normalizeKoboKanaForMatch_(titleBase),
    normalizeKoboKanaForMatch_(seriesKey)
  ]).filter(v => v && v.length >= 2);

  const volumeKeywords = [];

  // 検索語ではシート側タイトルの巻数表記を優先する。
  // 例: 「巻之九」なら「九」、「09」なら「09」を先に投げる。
  if (volumeRaw) volumeKeywords.push(volumeRaw);
  if (volume) volumeKeywords.push(String(volume));

  if (volumeKeywords.length) {
    bases.forEach(base => {
      volumeKeywords.forEach(v => {
        if (base && v) candidates.push(`${base}*${v}`);
      });
    });
  }

  // 狭い検索を優先する。Koboは「うらみちお兄さん 02」のような
  // 表示タイトル+巻数で正解だけを返すことがあるため、titleそのものも早めに入れる。
  if (title) candidates.push(title);

  // 括弧内のルビ・補足を外した候補。
  // 例: ヴァニタスの手記 (カルテ) 01 → ヴァニタスの手記 01
  const titleWithoutParenthetical = stripKoboParentheticalRuby_(title);
  if (titleWithoutParenthetical && normalizeKoboMatchText_(titleWithoutParenthetical) !== normalizeKoboMatchText_(title)) {
    candidates.push(titleWithoutParenthetical);
  }

  if (seriesKey) candidates.push(seriesKey);
  if (titleBase && normalizeKoboMatchText_(titleBase) !== normalizeKoboMatchText_(seriesKey)) candidates.push(titleBase);

  return uniqueStringList_(candidates)
    .filter(v => v && v.length >= 2)
    .slice(0, 10);
}

/**
 * タイトル中の括弧内ルビ・補足を外す。
 * @param {*} value
 * @returns {string}
 */
function stripKoboParentheticalRuby_(value) {
  return String(value || '')
    .replace(/[（(][^）)]{1,24}[）)]/g, '')
    .replace(/[\s　]+/g, ' ')
    .trim();
}

/**
 * Kobo返却itemがシート行と一致していそうかスコア化する。
 * @param {Object} item
 * @param {{title: string, author: string, publisher: string, seriesKey: string, volume: number|null}} context
 * @returns {number}
 */
function scoreRakutenKoboItemMatch_(item, context) {
  const match = evaluateRakutenKoboItemMatch_(item, context);
  return match && match.ok ? match.score : 0;
}

/**
 * Kobo返却itemがシート行と一致していそうか厳格判定する。
 * 誤爆防止のため、巻数だけ一致しても採用しない。
 * - タイトル/seriesName不一致は不採用
 * - タイトル一致が弱い場合は作者一致または出版社ゆる一致を要求
 * - Dolls/BADON/ARIA等の短い英字ベースは、強一致に見えても作者一致または出版社ゆる一致を要求
 * - 短い英字ベースで、item側が「別シリーズ名 + dolls talk」のような包含一致だけの場合は不採用
 * @param {Object} item
 * @param {{title: string, author: string, publisher: string, seriesKey: string, volume: number|null}} context
 * @returns {{ok: boolean, score: number, reason: string, titleMatch: string, authorMatch: boolean, publisherMatch: boolean, riskyLatinBase: boolean, titleIdentityMatch: boolean}}
 */
function evaluateRakutenKoboItemMatch_(item, context) {
  const itemTitle = String(item && item.title || '');
  const itemSeries = String(item && item.seriesName || '');
  const itemAuthor = String(item && item.author || '');
  const itemPublisher = String(item && item.publisherName || '');

  const titleMatch = classifyRakutenKoboTitleMatch_(item, context);
  const titleIdentityMatch = hasRakutenKoboTitleIdentityMatch_(item, context);

  if (titleMatch === 'none') {
    return {
      ok: false,
      score: 0,
      reason: 'title_mismatch',
      titleMatch,
      authorMatch: false,
      publisherMatch: false,
      riskyLatinBase: false,
      titleIdentityMatch
    };
  }

  const targetVolume = context && context.volume ? Number(context.volume) : null;
  const itemVolumeInfo =
    extractVolumeInfoForKobo_(itemTitle) ||
    extractVolumeInfoForKobo_(item.titleKana) ||
    extractVolumeInfoForKobo_(itemSeries);
  const itemVolume = itemVolumeInfo ? Number(itemVolumeInfo.number) : null;

  if (targetVolume) {
    if (!itemVolume) {
      return {
        ok: false,
        score: 0,
        reason: 'item_volume_missing',
        titleMatch,
        authorMatch: false,
        publisherMatch: false,
        riskyLatinBase: false,
        titleIdentityMatch
      };
    }
    if (itemVolume !== targetVolume) {
      return {
        ok: false,
        score: 0,
        reason: 'volume_mismatch',
        titleMatch,
        authorMatch: false,
        publisherMatch: false,
        riskyLatinBase: false,
        titleIdentityMatch
      };
    }
  }

  const authorMatch = hasLooseKoboAuthorMatch_(context.author, itemAuthor);
  const publisherMatch = hasLooseKoboPublisherMatch_(context.publisher, itemPublisher);
  const riskyLatinBase = isRiskyShortLatinKoboBase_(context);

  // タイトル一致が弱い場合は、作者または出版社の一致がないと誤爆リスクが高い。
  // 出版社は完全一致ではなく、別名マップ込みのゆるい一致で判定する。
  if (titleMatch === 'weak' && !authorMatch && !publisherMatch) {
    return {
      ok: false,
      score: 0,
      reason: 'weak_title_without_author_or_publisher',
      titleMatch,
      authorMatch,
      publisherMatch,
      riskyLatinBase,
      titleIdentityMatch
    };
  }

  // Dolls / BADON / B.B.Joker 等の短い英字ベースは別作品を拾いやすい。
  // タイトルだけでは信用せず、作者一致または出版社ゆる一致を必須にする。
  if (riskyLatinBase && !authorMatch && !publisherMatch) {
    return {
      ok: false,
      score: 0,
      reason: 'risky_latin_title_without_author_or_publisher',
      titleMatch,
      authorMatch,
      publisherMatch,
      riskyLatinBase,
      titleIdentityMatch
    };
  }

  // さらに短い英字ベースでは、itemTitle内の単なる部分一致を強一致扱いしない。
  // 例: シート「Dolls 2」→ Kobo「Rozen Maiden dolls talk 2」を除外。
  // 正しい「DOLLS 2」なら deriveKoboTitleBase_ 後に titleIdentityMatch=true になる。
  if (riskyLatinBase && !titleIdentityMatch && !authorMatch) {
    return {
      ok: false,
      score: 0,
      reason: 'risky_latin_without_identity_or_author',
      titleMatch,
      authorMatch,
      publisherMatch,
      riskyLatinBase,
      titleIdentityMatch
    };
  }

  let score = 0;
  if (titleMatch === 'strong') score += 180;
  if (titleMatch === 'weak') score += 95;
  if (titleIdentityMatch) score += 90;
  if (targetVolume) score += 130;
  if (authorMatch) score += 90;
  if (publisherMatch) score += 70;

  // 同じシリーズ・同じ巻で旧版と新装版/SUPER/ベスト等が並ぶ場合は、
  // シート側タイトルにも同じ派生語が含まれる候補を優先する。
  score += scoreKoboEditionVariantPreference_(context, item);

  return { ok: score >= 180, score, reason: 'ok', titleMatch, authorMatch, publisherMatch, riskyLatinBase, titleIdentityMatch };
}

/**
 * シート側タイトルとKobo候補の版種差を軽くスコア調整する。
 * 正解候補を除外はせず、旧版/通常版と新装版が同時に返る場合の並びを整える目的。
 * @param {Object} context
 * @param {Object} item
 * @returns {number}
 */
function scoreKoboEditionVariantPreference_(context, item) {
  const rowText = normalizeKoboMatchText_([context && context.title, context && context.seriesKey].join(' '));
  const itemText = normalizeKoboMatchText_([item && item.title, item && item.seriesName].join(' '));
  if (!itemText) return 0;

  const variants = [
    '新装版',
    '完全版',
    'super',
    'ベスト',
    'best',
    '公式',
    'ガイド',
    'guide',
    'official',
    '番外編',
    '特別編'
  ];

  let score = 0;
  variants.forEach(v => {
    const n = normalizeKoboMatchText_(v);
    const rowHas = rowText.indexOf(n) >= 0;
    const itemHas = itemText.indexOf(n) >= 0;
    if (rowHas && itemHas) score += 24;
    if (!rowHas && itemHas) score -= 28;
  });

  return score;
}

/**
 * Kobo返却itemのタイトル/シリーズ一致度を分類する。
 * @param {Object} item
 * @param {{title: string, seriesKey: string}} context
 * @returns {'strong'|'weak'|'none'}
 */
function classifyRakutenKoboTitleMatch_(item, context) {
  const itemTitle = String(item && item.title || '');
  const itemSeries = String(item && item.seriesName || '');

  const base = context.seriesKey || deriveKoboTitleBase_(context.title);
  const baseNorm = normalizeKoboMatchText_(base);
  const titleNorm = normalizeKoboMatchText_(context.title);
  const titleBaseNorm = normalizeKoboMatchText_(deriveKoboTitleBase_(context.title));

  const itemTitleNorm = normalizeKoboMatchText_(itemTitle);
  const itemSeriesNorm = normalizeKoboMatchText_(itemSeries);
  const itemTitleBaseNorm = normalizeKoboMatchText_(deriveKoboTitleBase_(itemTitle));
  const itemSeriesBaseNorm = normalizeKoboMatchText_(deriveKoboTitleBase_(itemSeries));

  const targetBase = baseNorm || titleBaseNorm || titleNorm;
  if (!targetBase || !itemTitleNorm && !itemSeriesNorm) return 'none';

  // seriesName完全一致・titleBase完全一致は強一致。
  if (itemSeriesNorm && itemSeriesNorm === targetBase) return 'strong';
  if (itemSeriesBaseNorm && itemSeriesBaseNorm === targetBase) return 'strong';
  if (itemTitleBaseNorm && itemTitleBaseNorm === targetBase) return 'strong';
  if (itemTitleNorm && itemTitleNorm === titleNorm) return 'strong';

  // Koboでは「ばらかもん9巻」「PandoraHearts24巻」のように、シリーズ名+巻数の表記が多い。
  // ただし短い英字ベースは誤爆しやすいので、ここでは弱一致に留める。
  if (itemTitleNorm && itemTitleNorm.indexOf(targetBase) === 0) {
    return isRiskyShortLatinKoboText_(targetBase) ? 'weak' : 'strong';
  }

  // 「新装版 うさぎドロップ」「あたしンち SUPER」などは、シリーズ名が前後に付くため弱一致。
  // 弱一致は作者または出版社一致がないと採用しない。
  if (targetBase.length >= 4) {
    if (itemSeriesNorm && (itemSeriesNorm.indexOf(targetBase) >= 0 || targetBase.indexOf(itemSeriesNorm) >= 0)) return 'weak';
    if (itemSeriesBaseNorm && (itemSeriesBaseNorm.indexOf(targetBase) >= 0 || targetBase.indexOf(itemSeriesBaseNorm) >= 0)) return 'weak';
    if (itemTitleNorm && itemTitleNorm.indexOf(targetBase) >= 0) return 'weak';
  }

  return 'none';
}

/**
 * Kobo作者名のゆるい一致判定。
 * 日本語名は2文字以上の連続片、英字名は2文字以上tokenを使う。
 * @param {*} sheetAuthor
 * @param {*} koboAuthor
 * @returns {boolean}
 */
function hasLooseKoboAuthorMatch_(sheetAuthor, koboAuthor) {
  const a = String(sheetAuthor || '').trim();
  const b = String(koboAuthor || '').trim();
  if (!a || !b) return false;

  const aNorm = normalizeKoboMatchText_(a);
  const bNorm = normalizeKoboMatchText_(b);
  if (!aNorm || !bNorm) return false;

  if (aNorm.length >= 2 && bNorm.length >= 2 && (aNorm.indexOf(bNorm) >= 0 || bNorm.indexOf(aNorm) >= 0)) {
    return true;
  }

  const aTokens = buildKoboAuthorTokens_(a);
  const bTokens = buildKoboAuthorTokens_(b);
  if (aTokens.some(token => bTokens.indexOf(token) >= 0)) return true;

  // 区切りやローマ字揺れでtoken化できない場合の補助。1文字一致は誤爆が多いので使わない。
  return hasSharedKoboNameToken_(aNorm, bNorm);
}

/**
 * Kobo出版社名のゆるい一致判定。
 * 完全一致には依存せず、既知出版社の別名・包含・2文字以上tokenで見る。
 * ただし「社」などの短すぎる共通文字では一致扱いにしない。
 * @param {*} sheetPublisher
 * @param {*} koboPublisher
 * @returns {boolean}
 */
function hasLooseKoboPublisherMatch_(sheetPublisher, koboPublisher) {
  const rawA = String(sheetPublisher || '').trim();
  const rawB = String(koboPublisher || '').trim();
  if (!rawA || !rawB) return false;

  const aliasA = normalizeKoboPublisherAlias_(rawA);
  const aliasB = normalizeKoboPublisherAlias_(rawB);
  if (aliasA && aliasB && aliasA === aliasB) return true;

  const a = normalizeKoboPublisherText_(rawA);
  const b = normalizeKoboPublisherText_(rawB);
  if (!a || !b) return false;
  if (a === b) return true;

  // 短すぎる包含一致は誤爆しやすいので使わない。
  if (a.length >= 4 && b.length >= 4 && (a.indexOf(b) >= 0 || b.indexOf(a) >= 0)) return true;

  const aTokens = buildKoboPublisherTokens_(rawA);
  const bTokens = buildKoboPublisherTokens_(rawB);
  return aTokens.some(token => bTokens.indexOf(token) >= 0);
}

/**
 * 既知出版社の別名を共通IDへ寄せる。
 * @param {*} value
 * @returns {string}
 */
function normalizeKoboPublisherAlias_(value) {
  const s = normalizeKoboMatchText_(value);
  if (!s) return '';

  if (/スクウェアエニックス|スクエアエニックス|squareenix|sqex/.test(s)) return 'square_enix';
  if (/集英社|shueisha/.test(s)) return 'shueisha';
  if (/講談社|kodansha/.test(s)) return 'kodansha';
  if (/白泉社|hakusensha/.test(s)) return 'hakusensha';
  if (/一迅社|ichijinsha/.test(s)) return 'ichijinsha';
  if (/kadokawa|角川|メディアファクトリー|富士見書房|エンターブレイン/.test(s)) return 'kadokawa';
  if (/マッグガーデン|maggarden/.test(s)) return 'mag_garden';
  if (/リイド社|leed/.test(s)) return 'leed';
  if (/文芸社|bungeisha/.test(s)) return 'bungeisha';
  if (/幻冬舎|gentosha/.test(s)) return 'gentosha';
  if (/小学館|shogakukan/.test(s)) return 'shogakukan';
  if (/秋田書店|akitashoten/.test(s)) return 'akita_shoten';
  if (/双葉社|futabasha/.test(s)) return 'futabasha';
  if (/新潮社|shinchosha/.test(s)) return 'shinchosha';

  return '';
}

/**
 * 出版社比較用tokenを生成する。
 * @param {*} value
 * @returns {string[]}
 */
function buildKoboPublisherTokens_(value) {
  const normalized = String(value || '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/株式会社|有限会社|合同会社|一般社団法人|inc\.?|ltd\.?|co\.?|出版社|出版|コミックス|books|manga/g, ' ')
    .replace(/[・･／\/\,，、＋+&＆;；:：()（）\[\]{}「」『』<>〈〉《》.。]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  const rawTokens = normalized.split(' ').map(v => v.trim()).filter(Boolean);
  const tokens = [];

  rawTokens.forEach(token => {
    const compact = normalizeKoboPublisherText_(token);
    if (compact.length >= 3) tokens.push(compact);
  });

  const compactAll = normalizeKoboPublisherText_(normalized);
  if (compactAll.length >= 4) {
    for (let i = 0; i <= compactAll.length - 3; i++) {
      const token = compactAll.slice(i, i + 3);
      if (token.length >= 3) tokens.push(token);
    }
  }

  return uniqueStringList_(tokens);
}

/**
 * 出版社比較用の正規化。
 * @param {*} value
 * @returns {string}
 */
function normalizeKoboPublisherText_(value) {
  const alias = normalizeKoboPublisherAlias_(value);
  if (alias) return alias;

  return normalizeKoboMatchText_(value)
    .replace(/株式会社|有限会社|合同会社|一般社団法人|inc|ltd|co/g, '')
    .replace(/出版社|出版|コミックス|books|manga/g, '')
    .trim();
}

/**
 * Kobo itemが対象タイトルそのものにかなり近いか判定する。
 * 短い英字タイトルの部分一致誤爆を防ぐための補助。
 * @param {Object} item
 * @param {{title: string, seriesKey: string}} context
 * @returns {boolean}
 */
function hasRakutenKoboTitleIdentityMatch_(item, context) {
  const base = context && (context.seriesKey || deriveKoboTitleBase_(context.title));
  const targetBase = normalizeKoboMatchText_(base || deriveKoboTitleBase_(context && context.title));
  const targetTitle = normalizeKoboMatchText_(context && context.title);
  if (!targetBase && !targetTitle) return false;

  const itemTitle = String(item && item.title || '');
  const itemSeries = String(item && item.seriesName || '');
  const itemTitleNorm = normalizeKoboMatchText_(itemTitle);
  const itemSeriesNorm = normalizeKoboMatchText_(itemSeries);
  const itemTitleBaseNorm = normalizeKoboMatchText_(deriveKoboTitleBase_(itemTitle));
  const itemSeriesBaseNorm = normalizeKoboMatchText_(deriveKoboTitleBase_(itemSeries));

  if (targetBase) {
    if (itemSeriesNorm && itemSeriesNorm === targetBase) return true;
    if (itemSeriesBaseNorm && itemSeriesBaseNorm === targetBase) return true;
    if (itemTitleBaseNorm && itemTitleBaseNorm === targetBase) return true;
  }

  if (targetTitle && itemTitleNorm && itemTitleNorm === targetTitle) return true;

  return false;
}

/**
 * Kobo救済で誤爆しやすい短い英字ベースか判定する。
 * Dolls / BADON / ARIA / NO6 など、英字だけの短いシリーズは別作品を拾いやすい。
 * @param {{title: string, seriesKey: string}=} context
 * @returns {boolean}
 */
function isRiskyShortLatinKoboBase_(context) {
  const base = context && (context.seriesKey || deriveKoboTitleBase_(context.title));
  return isRiskyShortLatinKoboText_(normalizeKoboMatchText_(base));
}

/**
 * 正規化済み、または未正規化の文字列が短い英字ベースか判定する。
 * @param {*} value
 * @returns {boolean}
 */
function isRiskyShortLatinKoboText_(value) {
  const s = normalizeKoboMatchText_(value);
  return /^[a-z0-9]+$/.test(s) && s.length >= 2 && s.length <= 8;
}

/**
 * 作者名比較用tokenを生成する。
 * @param {*} value
 * @returns {string[]}
 */
function buildKoboAuthorTokens_(value) {
  const normalized = String(value || '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/\d{4}-?/g, ' ')
    .replace(/[×・･／\/\,，、＋+&＆;；:：()（）\[\]{}「」『』<>〈〉《》]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  const rawTokens = normalized.split(' ').map(v => v.trim()).filter(Boolean);
  const tokens = [];

  rawTokens.forEach(token => {
    const compact = normalizeKoboMatchText_(token);
    if (compact.length >= 2) tokens.push(compact);
  });

  // スペース区切りがない日本語名向けに2文字gramも作る。
  const compactAll = normalizeKoboMatchText_(normalized);
  if (compactAll.length >= 2) {
    for (let i = 0; i <= compactAll.length - 2; i++) {
      tokens.push(compactAll.slice(i, i + 2));
    }
  }

  return uniqueStringList_(tokens);
}

/**
 * タイトルからKobo検索用の主タイトルを推定する。
 * @param {*} title
 * @returns {string}
 */
function deriveKoboTitleBase_(title) {
  let s = String(title || '').normalize('NFKC').trim();
  if (!s) return '';

  // 末尾の括弧付き巻数だけ先に削る。
  // 例: うらみちお兄さん（２） / あたしンち(14)
  s = s.replace(/[（(]\s*0*\d{1,3}\s*[）)]\s*$/g, '').trim();
  s = s.replace(/[（(]\s*[一二三四五六七八九十百〇零壱弐参]+\s*[）)]\s*$/g, '').trim();

  // 末尾の括弧内補足を削る。例: TRICK（劇場版）等。
  s = s.replace(/[（(][^）)]*[）)]\s*$/g, '').trim();

  // 算用数字の巻数表記を削る。Kobo返却の「ばらかもん9巻」のような隣接表記にも対応する。
  s = s.replace(/(?:volume|vol\.?)\s*0*\d{1,3}\s*$/i, '').trim();
  s = s.replace(/(?:volume|vol\.?)\s*0*\d{1,3}\s*巻?\s*$/i, '').trim();
  // 「第01巻」は、直付け数字除去より先にまとめて落とす。
  s = s.replace(/[\s　.．]*第\s*0*\d{1,3}\s*(?:巻|集|号|話)\s*$/g, '').trim();
  s = s.replace(/[\s　.．]+0*\d{1,3}\s*巻?\s*$/g, '').trim();
  s = s.replace(/0*\d{1,3}\s*巻\s*$/g, '').trim();

  // 漢数字の巻数表記を削る。検索語生成では raw を別保持するため、base側からは落とす。
  s = s.replace(/[\s　.．]*(?:巻之|卷之)\s*[一二三四五六七八九十百〇零壱弐参]+\s*$/g, '').trim();
  s = s.replace(/[\s　.．]*第\s*[一二三四五六七八九十百〇零壱弐参]+\s*(?:巻|集|号|話)\s*$/g, '').trim();
  s = s.replace(/[\s　.．]+[一二三四五六七八九十百〇零壱弐参]+\s*(?:巻|巻目|集|号|話)\s*$/g, '').trim();
  s = s.replace(/[一二三四五六七八九十百〇零壱弐参]+\s*巻\s*$/g, '').trim();

  s = s.replace(/[\s　]+/g, ' ');
  return s;
}

/**
 * タイトルからKobo救済用の巻数情報を抽出する。
 * - raw は検索keywordで優先使用する元表記（例: "09", "九"）
 * - number は誤爆防止の内部照合に使う数値
 * @param {*} title
 * @returns {{number: number, raw: string}|null}
 */
function extractVolumeInfoForKobo_(title) {
  const s = String(title || '').normalize('NFKC').trim();
  if (!s) return null;

  const patterns = [
    // 括弧付き巻数。Kobo返却で非常に多い。例: うらみちお兄さん（２） / あたしンち(14)
    { re: /[（(]\s*(\d{1,3})\s*[）)]/, type: 'num' },
    { re: /[（(]\s*([一二三四五六七八九十百〇零壱弐参]+)\s*[）)]/, type: 'jp' },

    // 漢数字の正式表記。例: 巻之九 / 第九巻 / 九巻
    { re: /(?:巻之|卷之)\s*([一二三四五六七八九十百〇零壱弐参]+)/, type: 'jp' },
    { re: /第\s*([一二三四五六七八九十百〇零壱弐参]+)\s*(?:巻|集|号|話)?/, type: 'jp' },
    { re: /(?:^|[\s　.．])([一二三四五六七八九十百〇零壱弐参]+)\s*(?:巻|巻目|集|号|話)(?:\s|$|[【（(])/, type: 'jp' },

    // 算用数字。rawは 09 / 009 などを維持する。
    { re: /(?:^|[\s　.．])(\d{1,3})\s*巻(?:\s|$|[【（(])/, type: 'num' },
    { re: /(?:^|[\s　.．])(\d{1,3})(?:\s*$|\s*[（(])/, type: 'num' },
    { re: /(?:volume|vol\.?)\s*(\d{1,3})/i, type: 'num' },
    { re: /第\s*(\d{1,3})\s*(?:巻|集|号|話)?/, type: 'num' },
    { re: /(\d{1,3})\s*カン/i, type: 'num' },

    // Kobo titleKana の「024カン」以外に、タイトル末尾へ直付けされるケース。
    // 例: PandoraHearts24巻 / ばらかもん9巻
    { re: /(\d{1,3})\s*巻\s*$/i, type: 'num' }
  ];

  for (let i = 0; i < patterns.length; i++) {
    const pattern = patterns[i];
    const m = s.match(pattern.re);
    if (!m || !m[1]) continue;

    const raw = String(m[1]).trim();
    const n = pattern.type === 'jp' ? parseJapaneseNumberForKobo_(raw) : Number(raw.replace(/^0+(?=\d)/, ''));
    if (Number.isFinite(n) && n > 0) {
      return { number: n, raw };
    }
  }

  return null;
}

/**
 * Kobo巻数照合用の漢数字変換。
 * 検索keywordでは元の漢数字を使い、照合時だけ数値化する。
 * 対応目安: 一〜百九十九程度。
 * @param {*} value
 * @returns {number|null}
 */
function parseJapaneseNumberForKobo_(value) {
  let s = String(value || '').trim();
  if (!s) return null;

  s = s
    .replace(/零|〇/g, '零')
    .replace(/壱/g, '一')
    .replace(/弐/g, '二')
    .replace(/参/g, '三');

  if (/^\d+$/.test(s)) return Number(s);

  const digitMap = {
    '零': 0,
    '一': 1,
    '二': 2,
    '三': 3,
    '四': 4,
    '五': 5,
    '六': 6,
    '七': 7,
    '八': 8,
    '九': 9
  };

  if (/^[零一二三四五六七八九]$/.test(s)) return digitMap[s];

  let total = 0;
  let rest = s;

  const hundredMatch = rest.match(/^([一二三四五六七八九])?百/);
  if (hundredMatch) {
    total += (hundredMatch[1] ? digitMap[hundredMatch[1]] : 1) * 100;
    rest = rest.slice(hundredMatch[0].length);
  }

  const tenMatch = rest.match(/^([一二三四五六七八九])?十/);
  if (tenMatch) {
    total += (tenMatch[1] ? digitMap[tenMatch[1]] : 1) * 10;
    rest = rest.slice(tenMatch[0].length);
  }

  if (rest) {
    if (!/^[零一二三四五六七八九]$/.test(rest)) return null;
    total += digitMap[rest];
  }

  return total > 0 ? total : null;
}

/**
 * タイトルから巻数を抽出する。Kobo救済用。
 * @param {*} title
 * @returns {number|null}
 */
function extractVolumeNumberForKobo_(title) {
  const info = extractVolumeInfoForKobo_(title);
  return info ? info.number : null;
}

/**
 * Kobo照合用に文字列を強めに正規化する。
 * @param {*} value
 * @returns {string}
 */
function normalizeKoboKanaForMatch_(value) {
  return String(value || '')
    .normalize('NFKC')
    .replace(/[ァ-ヶ]/g, ch => String.fromCharCode(ch.charCodeAt(0) - 0x60));
}

/**
 * Kobo比較用正規化。
 * カタカナ/ひらがなの揺れも吸収する。
 * 例: あたしンち → あたしんち / うさぎドロップ → うさぎどろっぷ
 * @param {*} value
 * @returns {string}
 */
function normalizeKoboMatchText_(value) {
  return normalizeKoboKanaForMatch_(value)
    .toLowerCase()
    .replace(/[\s　・･×＊*★☆【】「」『』（）()\[\]{}<>〈〉《》:：;；,，.。!！?？\-‐‑‒–—―~〜～_/／\\|｜+＋=＝'"“”‘’]/g, '');
}

/**
 * 作者名の部分一致用。正規化済み文字列から2文字以上の共通tokenを見る。
 * @param {string} a
 * @param {string} b
 * @returns {boolean}
 */
function hasSharedKoboNameToken_(a, b) {
  if (!a || !b) return false;
  if (a.length <= 2 || b.length <= 2) return false;

  for (let i = 0; i <= a.length - 2; i++) {
    const token = a.slice(i, i + 2);
    if (b.indexOf(token) >= 0) return true;
  }

  return false;
}

/**
 * 文字列配列を順序保持で重複除去する。
 * @param {Array<*>} values
 * @returns {string[]}
 */
function uniqueStringList_(values) {
  const seen = {};
  const results = [];

  (values || []).forEach(value => {
    const s = String(value || '').trim();
    if (!s) return;
    const key = normalizeKoboMatchText_(s);
    if (!key || seen[key]) return;
    seen[key] = true;
    results.push(s);
  });

  return results;
}

/**
 * Kobo救済の行デバッグ用。
 * 例: debugRakutenKoboCandidatesByRow_(123)
 * @param {number} rowNumber
 * @returns {Object}
 */
function debugRakutenKoboCandidatesByRow_(rowNumber) {
  const sheet = getSheet(CONFIG.SHEETS.MAIN);
  ensureSynopsisColumns_(sheet);

  const row = sheet.getRange(Number(rowNumber), 1, 1, CONFIG.COL.MAX).getDisplayValues()[0];
  const context = buildRakutenKoboSearchContextFromRow_(row);
  const keywords = buildRakutenKoboKeywordCandidates_(context);
  const records = fetchRakutenKoboCandidateRecords_(context);

  const result = {
    rowNumber: Number(rowNumber),
    context,
    keywords,
    records: records.map(r => ({
      score: r.score,
      itemTitle: r.itemTitle,
      keyword: r.keyword,
      matchReason: r.matchReason || '',
      titleMatch: r.titleMatch || '',
      authorMatch: !!r.authorMatch,
      publisherMatch: !!r.publisherMatch,
      riskyLatinBase: !!r.riskyLatinBase,
      titleIdentityMatch: !!r.titleIdentityMatch,
      itemAuthor: r.itemAuthor || '',
      itemPublisher: r.itemPublisher || '',
      itemLanguage: r.itemLanguage || '',
      japaneseTextScore: Number(r.japaneseTextScore || 0),
      preview: r.raw.slice(0, 500)
    })).slice(0, 20)
  };

  console.log(JSON.stringify(result, null, 2));
  return result;
}

/**
 * NOT_FOUND. を再試行前の NOT_FOUND に戻し、Y列あらすじを空にする。
 * Kobo救済ロジック調整後に再実行したい場合だけ手動実行する。
 * @returns {{resetRows: number}}
 */
function resetKoboNotFoundDoneToNotFound_() {
  const sheet = getSheet(CONFIG.SHEETS.MAIN);
  ensureSynopsisColumns_(sheet);

  const last = getLastDataRow(sheet, CONFIG.COL.TITLE);
  if (last < 2) return { resetRows: 0 };

  const rowCount = last - 1;
  const range = sheet.getRange(2, CONFIG.COL.SUMMARY, rowCount, 2);
  const values = range.getValues();
  let resetRows = 0;

  const next = values.map(row => {
    const source = normalizeSynopsisSourceValue_(row[1]);
    if (source === SYNOPSIS_SOURCE.NOT_FOUND_DONE) {
      resetRows++;
      return ['', SYNOPSIS_SOURCE.NOT_FOUND];
    }
    return row;
  });

  if (resetRows) {
    range.setValues(next);
    SpreadsheetApp.flush();
  }

  SpreadsheetApp.getActive().toast(`NOT_FOUND. を NOT_FOUND に戻しました: ${resetRows}行`);
  return { resetRows };
}

/**
 * 秘密情報をログ用にマスクする。
 * @param {string} value
 * @returns {string}
 */
