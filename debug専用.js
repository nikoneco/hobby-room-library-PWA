/************************************************************
 * debug専用.gs
 * 楽天Kobo あらすじ取得トラブルシュート専用
 *
 * 目的:
 * - 任意keywordでKobo APIの返値を見る
 * - 指定行の title / author / publisher / series_key_auto から
 *   どんなkeywordを生成しているか見る
 * - 候補ごとの除外理由・日本語優先スコア・巻数判定を見る
 *
 * 注意:
 * - 本番データは書き換えない
 * - ログ確認専用
 * - Script Properties:
 *   - RAKUTEN_APP_ID
 *   - RAKUTEN_APKEY
 * 
 *   -console表示は　?debugImageStats=1
 *  
 ************************************************************/

const DBG_KOBO_CONFIG = {
  SHEET_NAME: '目録',

  COL: {
    TITLE: 9,       // I
    AUTHOR: 11,     // K
    PUBLISHER: 12,  // L
    ISBN: 19,       // S
    SERIES_KEY: 24, // X
    RAW: 25,        // Y
    SOURCE: 26      // Z
  },

  API_URL: 'https://openapi.rakuten.co.jp/services/api/Kobo/EbookSearch/20170426',

  // Kobo API対策。連打しすぎない。
  SLEEP_MS: 1200,

  // 返値確認用。APIの1ページ目だけ見る。
  HITS: 30,

  REFERER: 'https://script.google.com/',
  ORIGIN: 'https://script.google.com'
};


/**
 * 行番号デバッグ用プリセット。
 * ここを書き換えて実行する。
 */
function dbgKoboRowPreset() {
  const rowNumber = 1449; // ←ここを書き換える
  dbgKoboRow(rowNumber);
}


/**
 * 任意keyword検索用プリセット。
 * ここを書き換えて実行する。
 */
function dbgKoboKeywordSearchPreset() {
  const keyword = 'もやしもん'; // ←ここを書き換える
  dbgKoboKeywordSearch(keyword);
}


/**
 * 複数keywordをまとめて確認するプリセット。
 * 気になる作品名をここに入れて実行。
 */
function dbgKoboKeywordSearchBatchPreset() {
  const keywords = [
    'デュラララ!! ×02',
    'デュラララ!! ×01',
    'デュラララ!! ×03'
  ];

  keywords.forEach((keyword, i) => {
    if (i > 0) Utilities.sleep(DBG_KOBO_CONFIG.SLEEP_MS);
    dbgKoboKeywordSearch(keyword);
  });
}


/**
 * 指定行からKobo検索候補を作り、候補ごとの判定理由をログ出力する。
 *
 * @param {number} rowNumber 目録シート上の行番号
 */
function dbgKoboRow(rowNumber) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(DBG_KOBO_CONFIG.SHEET_NAME);
  if (!sheet) throw new Error('シートが見つかりません: ' + DBG_KOBO_CONFIG.SHEET_NAME);

  const row = sheet.getRange(rowNumber, 1, 1, DBG_KOBO_CONFIG.COL.SOURCE).getDisplayValues()[0];

  const context = {
    rowNumber,
    title: row[DBG_KOBO_CONFIG.COL.TITLE - 1] || '',
    author: row[DBG_KOBO_CONFIG.COL.AUTHOR - 1] || '',
    publisher: row[DBG_KOBO_CONFIG.COL.PUBLISHER - 1] || '',
    isbn: row[DBG_KOBO_CONFIG.COL.ISBN - 1] || '',
    seriesKey: row[DBG_KOBO_CONFIG.COL.SERIES_KEY - 1] || '',
    raw: row[DBG_KOBO_CONFIG.COL.RAW - 1] || '',
    source: row[DBG_KOBO_CONFIG.COL.SOURCE - 1] || ''
  };

  const volumeInfo = dbgKoboExtractVolumeInfo_(context.title);
  const keywords = dbgKoboBuildKeywordCandidates_(context, volumeInfo);

  const allRecords = [];

  keywords.forEach((keyword, index) => {
    if (index > 0) Utilities.sleep(DBG_KOBO_CONFIG.SLEEP_MS);

    const response = dbgKoboFetchByKeyword_(keyword);
    const items = response.items || [];

    items.forEach((item, itemIndex) => {
      const analysis = dbgKoboAnalyzeItemForRow_(item, context, volumeInfo, keyword, itemIndex);
      allRecords.push(analysis);
    });
  });

  allRecords.sort((a, b) => b.score - a.score);

  const output = {
    mode: 'ROW_DEBUG',
    context: Object.assign({}, context, {
      volumeInfo
    }),
    keywords,
    totalCandidateCount: allRecords.length,
    acceptedCount: allRecords.filter(r => r.accepted).length,
    records: allRecords.slice(0, 80)
  };

  console.log(JSON.stringify(output, null, 2));
}


/**
 * 任意keywordでKobo APIを叩き、返値をログ出力する。
 * 行情報なし。APIが何を返すか確認する用途。
 *
 * @param {string} keyword
 */
function dbgKoboKeywordSearch(keyword) {
  const response = dbgKoboFetchByKeyword_(keyword);
  const items = response.items || [];

  const records = items.map((item, index) => {
    const caption = dbgKoboCleanText_(item.itemCaption || '');
    const lang = dbgKoboAnalyzeCaptionLanguage_(caption, item.language);

    return {
      index,
      title: item.title || '',
      seriesName: item.seriesName || '',
      author: item.author || '',
      publisherName: item.publisherName || '',
      language: item.language || '',
      salesDate: item.salesDate || '',
      itemNumber: item.itemNumber || '',
      itemPrice: item.itemPrice || '',
      volumeInfo: dbgKoboExtractVolumeInfo_(
        [
          item.title || '',
          item.titleKana || '',
          item.seriesName || ''
        ].join(' ')
      ),
      captionLanguage: lang,
      isFreeTrial: dbgKoboIsFreeTrialItem_(item),
      itemCaptionPreview: caption.slice(0, 300),
      itemUrl: item.itemUrl || ''
    };
  });

  const output = {
    mode: 'KEYWORD_SEARCH',
    keyword,
    count: response.count,
    hits: response.hits,
    page: response.page,
    pageCount: response.pageCount,
    records
  };

  console.log(JSON.stringify(output, null, 2));
}


/**
 * Kobo APIをkeywordで検索する。
 *
 * @param {string} keyword
 * @returns {object}
 */
function dbgKoboFetchByKeyword_(keyword) {
  const props = PropertiesService.getScriptProperties();
  const appId = props.getProperty('RAKUTEN_APP_ID');
  const accessKey = props.getProperty('RAKUTEN_APKEY');

  if (!appId) throw new Error('Script Properties に RAKUTEN_APP_ID がありません。');
  if (!accessKey) throw new Error('Script Properties に RAKUTEN_APKEY がありません。');

  const url =
    DBG_KOBO_CONFIG.API_URL
    + '?format=json'
    + '&keyword=' + encodeURIComponent(keyword)
    + '&hits=' + encodeURIComponent(DBG_KOBO_CONFIG.HITS)
    + '&applicationId=' + encodeURIComponent(appId)
    + '&accessKey=' + encodeURIComponent(accessKey);

  const response = dbgKoboFetchWithRetry_(url, {
    method: 'get',
    muteHttpExceptions: true,
    headers: {
      Accept: 'application/json',
      Referer: DBG_KOBO_CONFIG.REFERER,
      Origin: DBG_KOBO_CONFIG.ORIGIN
    }
  }, 3);

  const status = response.getResponseCode();
  const text = response.getContentText();

  if (status !== 200) {
    return {
      keyword,
      status,
      errorBody: text.slice(0, 1000),
      items: []
    };
  }

  const json = JSON.parse(text);
  const items = (json.Items || []).map(obj => obj.Item).filter(Boolean);

  return {
    keyword,
    status,
    count: json.count,
    hits: json.hits,
    page: json.page,
    pageCount: json.pageCount,
    items
  };
}


/**
 * UrlFetchの一時失敗・429に少し強くする。
 *
 * @param {string} url
 * @param {object} options
 * @param {number} retryCount
 * @returns {HTTPResponse}
 */
function dbgKoboFetchWithRetry_(url, options, retryCount) {
  const max = Math.max(1, Number(retryCount || 3));

  for (let i = 0; i < max; i++) {
    try {
      const res = UrlFetchApp.fetch(url, options);
      const code = res.getResponseCode();

      if (code !== 429) return res;

      if (i >= max - 1) return res;

      Utilities.sleep(DBG_KOBO_CONFIG.SLEEP_MS * (i + 1));
    } catch (e) {
      if (i >= max - 1) throw e;
      Utilities.sleep(DBG_KOBO_CONFIG.SLEEP_MS * (i + 1));
    }
  }

  throw new Error('dbgKoboFetchWithRetry_: failed');
}


/**
 * 行情報からKobo検索keyword候補を作る。
 *
 * @param {object} context
 * @param {object|null} volumeInfo
 * @returns {string[]}
 */
function dbgKoboBuildKeywordCandidates_(context, volumeInfo) {
  const title = String(context.title || '').trim();
  const seriesKey = String(context.seriesKey || '').trim();
  const titleBase = dbgKoboDeriveTitleBase_(title, seriesKey);

  const raw = volumeInfo && volumeInfo.raw ? String(volumeInfo.raw).trim() : '';
  const num = volumeInfo && volumeInfo.number ? String(volumeInfo.number) : '';

  const candidates = [];

  function add(v) {
    const s = String(v || '').trim();
    if (!s) return;
    if (!candidates.includes(s)) candidates.push(s);
  }

  if (seriesKey && raw) add(seriesKey + '*' + raw);
  if (seriesKey && num && raw !== num) add(seriesKey + '*' + num);

  if (titleBase && raw) add(titleBase + '*' + raw);
  if (titleBase && num && raw !== num) add(titleBase + '*' + num);

  add(title);

  if (titleBase && titleBase !== title) add(titleBase);
  if (seriesKey && seriesKey !== titleBase) add(seriesKey);

  // 括弧内ルビ・副題を落とした候補
  const noParen = title
    .replace(/[（(][^）)]*[）)]/g, '')
    .replace(/\s+/g, ' ')
    .trim();

  if (noParen && noParen !== title) add(noParen);

  return candidates;
}


/**
 * Kobo候補1件を、指定行に対して分析する。
 *
 * @param {object} item
 * @param {object} context
 * @param {object|null} rowVolumeInfo
 * @param {string} keyword
 * @param {number} itemIndex
 * @returns {object}
 */
function dbgKoboAnalyzeItemForRow_(item, context, rowVolumeInfo, keyword, itemIndex) {
  const itemTitle = item.title || '';
  const itemSeries = item.seriesName || '';
  const itemAuthor = item.author || '';
  const itemPublisher = item.publisherName || '';
  const caption = dbgKoboCleanText_(item.itemCaption || '');

  const itemVolumeInfo = dbgKoboExtractVolumeInfo_(
    [
      itemTitle,
      item.titleKana || '',
      itemSeries
    ].join(' ')
  );

  const rowTitleBase = dbgKoboDeriveTitleBase_(context.title, context.seriesKey);

  const titleMatch = dbgKoboHasTitleMatch_(rowTitleBase, context.seriesKey, itemTitle, itemSeries);
  const titleIdentityMatch = dbgKoboHasTitleIdentityMatch_(rowTitleBase, context.seriesKey, itemTitle, itemSeries);
  const volumeMatch = dbgKoboHasVolumeMatch_(rowVolumeInfo, itemVolumeInfo);
  const authorMatch = dbgKoboHasLooseAuthorMatch_(context.author, itemAuthor);
  const publisherMatch = dbgKoboHasLoosePublisherMatch_(context.publisher, itemPublisher);
  const freeTrial = dbgKoboIsFreeTrialItem_(item);
  const captionLanguage = dbgKoboAnalyzeCaptionLanguage_(caption, item.language);
  const japaneseTextScore = dbgKoboGetJapaneseTextScore_(caption, item.language);

  const riskyLatinBase = dbgKoboIsRiskyShortLatinBase_(rowTitleBase || context.seriesKey || context.title);

  const rejectReasons = [];

  if (!caption || caption.length < 20) {
    rejectReasons.push('CAPTION_TOO_SHORT');
  }

  if (freeTrial) {
    rejectReasons.push('FREE_TRIAL_ITEM');
  }

  if (rowVolumeInfo && rowVolumeInfo.number && itemVolumeInfo && itemVolumeInfo.number) {
    if (rowVolumeInfo.number !== itemVolumeInfo.number) {
      rejectReasons.push('VOLUME_MISMATCH');
    }
  }

  if (!titleMatch) {
    rejectReasons.push('TITLE_MISMATCH');
  }

  // 短い英字タイトルは危険。
  // titleが完全同一級でない場合、作者か出版社のゆる一致がないと危ない。
  if (riskyLatinBase && !titleIdentityMatch && !authorMatch && !publisherMatch) {
    rejectReasons.push('RISKY_SHORT_LATIN_WITHOUT_AUTHOR_OR_PUBLISHER');
  }

  // 短い英字で、出版社だけ一致してもDolls系誤爆が残る場合を見たいので警告扱い。
  const warnings = [];
  if (riskyLatinBase && !authorMatch && publisherMatch) {
    warnings.push('RISKY_SHORT_LATIN_PUBLISHER_ONLY');
  }

  let score = 0;

  if (titleMatch) score += 500;
  if (titleIdentityMatch) score += 300;
  if (volumeMatch === true) score += 250;
  if (authorMatch) score += 180;
  if (publisherMatch) score += 120;
  if (caption.length >= 40) score += Math.min(200, Math.floor(caption.length / 4));

  score += japaneseTextScore;

  if (freeTrial) score -= 1000;
  if (rejectReasons.length) score -= 3000;

  const accepted = rejectReasons.length === 0;

  return {
    keyword,
    itemIndex,
    accepted,
    score,
    rejectReasons,
    warnings,

    rowTitle: context.title || '',
    rowSeriesKey: context.seriesKey || '',
    rowAuthor: context.author || '',
    rowPublisher: context.publisher || '',
    rowVolumeInfo,

    itemTitle,
    itemSeries,
    itemAuthor,
    itemPublisher,
    itemLanguage: item.language || '',
    itemVolumeInfo,

    titleMatch,
    titleIdentityMatch,
    volumeMatch,
    authorMatch,
    publisherMatch,
    riskyLatinBase,

    captionLanguage,
    japaneseTextScore,
    captionLength: caption.length,
    itemCaptionPreview: caption.slice(0, 300),
    itemUrl: item.itemUrl || ''
  };
}


/**
 * タイトルから検索用baseを作る。
 *
 * @param {string} title
 * @param {string} seriesKey
 * @returns {string}
 */
function dbgKoboDeriveTitleBase_(title, seriesKey) {
  const sk = String(seriesKey || '').trim();
  if (sk && !/^__extra__/.test(sk)) return sk;

  let s = String(title || '').trim();

  s = s
    .replace(/[：:]\s*.*$/, '')
    .replace(/[（(][^）)]*[）)]/g, '')
    .replace(/\b(?:vol\.?|volume)\s*\d+$/i, '')
    .replace(/(?:第)?[0-9０-９]+(?:巻|巻目|集|号)?$/i, '')
    .replace(/(?:第)?[一二三四五六七八九十壱弐参〇零]+(?:巻|巻目|集|号)?$/i, '')
    .replace(/\s+[0-9０-９]+$/i, '')
    .replace(/\s+/g, ' ')
    .trim();

  return s || String(title || '').trim();
}


/**
 * 巻数情報を抽出する。
 * rawは検索keyword用に元表記寄りで持つ。
 *
 * @param {string} text
 * @returns {{number:number, raw:string}|null}
 */
function dbgKoboExtractVolumeInfo_(text) {
  const original = String(text || '');
  const s = original.normalize('NFKC');

  let m =
    s.match(/(?:第)?(\d{1,3})(?:巻|巻目|集|号|話)/i) ||
    s.match(/(?:vol\.?|volume)\s*(\d{1,3})/i) ||
    s.match(/(?:^|[\s._-])(\d{1,3})(?:$|[\s)）(（])/);

  if (m) {
    return {
      number: Number(m[1]),
      raw: m[1]
    };
  }

  m = s.match(/(?:第)?([一二三四五六七八九十壱弐参〇零]{1,5})(?:巻|巻目|集|号|話)/);
  if (m) {
    const n = dbgKoboParseJapaneseNumber_(m[1]);
    if (n) {
      return {
        number: n,
        raw: m[1]
      };
    }
  }

  return null;
}


/**
 * 漢数字をざっくり数値化する。
 *
 * @param {string} value
 * @returns {number|null}
 */
function dbgKoboParseJapaneseNumber_(value) {
  const s = String(value || '')
    .replace(/零|〇/g, '0')
    .replace(/壱/g, '一')
    .replace(/弐/g, '二')
    .replace(/参/g, '三')
    .trim();

  if (/^\d+$/.test(s)) return Number(s);

  const map = {
    一: 1,
    二: 2,
    三: 3,
    四: 4,
    五: 5,
    六: 6,
    七: 7,
    八: 8,
    九: 9
  };

  if (map[s]) return map[s];
  if (s === '十') return 10;

  let m = s.match(/^([一二三四五六七八九])?十([一二三四五六七八九])?$/);
  if (m) {
    const tens = m[1] ? map[m[1]] : 1;
    const ones = m[2] ? map[m[2]] : 0;
    return tens * 10 + ones;
  }

  return null;
}


/**
 * 巻数一致判定。
 *
 * @param {object|null} rowVolume
 * @param {object|null} itemVolume
 * @returns {boolean|null}
 */
function dbgKoboHasVolumeMatch_(rowVolume, itemVolume) {
  if (!rowVolume || !rowVolume.number) return null;
  if (!itemVolume || !itemVolume.number) return null;
  return rowVolume.number === itemVolume.number;
}


/**
 * タイトル一致判定。
 *
 * @param {string} rowTitleBase
 * @param {string} rowSeriesKey
 * @param {string} itemTitle
 * @param {string} itemSeries
 * @returns {boolean}
 */
function dbgKoboHasTitleMatch_(rowTitleBase, rowSeriesKey, itemTitle, itemSeries) {
  const base = dbgKoboNormalizeTitle_(rowTitleBase || rowSeriesKey);
  const series = dbgKoboNormalizeTitle_(rowSeriesKey);
  const title = dbgKoboNormalizeTitle_([itemTitle, itemSeries].join(' '));

  if (!base || !title) return false;

  if (title.includes(base)) return true;
  if (series && title.includes(series)) return true;

  return false;
}


/**
 * 強めのタイトル同一判定。
 *
 * @param {string} rowTitleBase
 * @param {string} rowSeriesKey
 * @param {string} itemTitle
 * @param {string} itemSeries
 * @returns {boolean}
 */
function dbgKoboHasTitleIdentityMatch_(rowTitleBase, rowSeriesKey, itemTitle, itemSeries) {
  const base = dbgKoboNormalizeTitle_(rowTitleBase || rowSeriesKey);
  const series = dbgKoboNormalizeTitle_(rowSeriesKey);
  const itemTitleOnly = dbgKoboNormalizeTitle_(
    String(itemTitle || '')
      .replace(/\d{1,3}巻?$/i, '')
      .replace(/vol\.?\s*\d{1,3}$/i, '')
  );
  const itemSeriesOnly = dbgKoboNormalizeTitle_(itemSeries);

  if (!base) return false;

  if (itemSeriesOnly && (itemSeriesOnly === base || itemSeriesOnly === series)) return true;
  if (itemTitleOnly && (itemTitleOnly === base || itemTitleOnly === series)) return true;

  return false;
}


/**
 * 作者ゆる一致。
 *
 * @param {string} sheetAuthor
 * @param {string} koboAuthor
 * @returns {boolean}
 */
function dbgKoboHasLooseAuthorMatch_(sheetAuthor, koboAuthor) {
  const a = dbgKoboNormalizePersonOrPublisher_(sheetAuthor);
  const b = dbgKoboNormalizePersonOrPublisher_(koboAuthor);

  if (!a || !b) return false;
  if (a.includes(b) || b.includes(a)) return true;

  const aTokens = dbgKoboBuildNameTokens_(a);
  const bTokens = dbgKoboBuildNameTokens_(b);

  return aTokens.some(token => bTokens.includes(token));
}


/**
 * 出版社ゆる一致。
 *
 * @param {string} sheetPublisher
 * @param {string} koboPublisher
 * @returns {boolean}
 */
function dbgKoboHasLoosePublisherMatch_(sheetPublisher, koboPublisher) {
  const a = dbgKoboNormalizePersonOrPublisher_(sheetPublisher);
  const b = dbgKoboNormalizePersonOrPublisher_(koboPublisher);

  if (!a || !b) return false;
  if (a.includes(b) || b.includes(a)) return true;

  const aliasA = dbgKoboPublisherAlias_(a);
  const aliasB = dbgKoboPublisherAlias_(b);

  if (aliasA && aliasB && aliasA === aliasB) return true;

  const aTokens = dbgKoboBuildNameTokens_(a);
  const bTokens = dbgKoboBuildNameTokens_(b);

  return aTokens.some(token => bTokens.includes(token));
}


/**
 * 出版社別名マップ。
 *
 * @param {string} s
 * @returns {string}
 */
function dbgKoboPublisherAlias_(s) {
  const x = String(s || '').toLowerCase();

  if (/スクウェア|スクエア|スクエニ|squareenix|square/.test(x)) return 'square_enix';
  if (/集英社|shueisha/.test(x)) return 'shueisha';
  if (/講談社|kodansha/.test(x)) return 'kodansha';
  if (/白泉社|hakusensha/.test(x)) return 'hakusensha';
  if (/一迅社|ichijinsha/.test(x)) return 'ichijinsha';
  if (/角川|kadokawa/.test(x)) return 'kadokawa';
  if (/マッグガーデン|maggarden|maggarden/.test(x)) return 'mag_garden';
  if (/幻冬舎|gentosha/.test(x)) return 'gentosha';
  if (/リイド社|leed/.test(x)) return 'leed';
  if (/太田出版|ohta/.test(x)) return 'ohta';
  if (/メディアファクトリー|mediafactory/.test(x)) return 'media_factory';

  return '';
}


/**
 * 本文が日本語かを見る。
 *
 * @param {string} text
 * @param {string} apiLanguage
 * @returns {object}
 */
function dbgKoboAnalyzeCaptionLanguage_(text, apiLanguage) {
  const s = String(text || '');
  const jaChars = (s.match(/[ぁ-んァ-ヶ一-龠]/g) || []).length;
  const latinChars = (s.match(/[A-Za-z]/g) || []).length;
  const total = Math.max(1, jaChars + latinChars);

  let type = 'UNKNOWN';
  if (jaChars >= 20 && jaChars / total >= 0.35) type = 'JA';
  else if (jaChars > 0 && latinChars > 0) type = 'MIXED';
  else if (jaChars === 0 && latinChars >= 40) type = 'LATIN_ONLY';

  return {
    apiLanguage: apiLanguage || '',
    type,
    jaChars,
    latinChars,
    jaRatio: Math.round((jaChars / total) * 1000) / 1000
  };
}


/**
 * 日本語本文優先スコア。
 *
 * @param {string} text
 * @param {string} apiLanguage
 * @returns {number}
 */
function dbgKoboGetJapaneseTextScore_(text, apiLanguage) {
  const lang = String(apiLanguage || '').toUpperCase();
  const analysis = dbgKoboAnalyzeCaptionLanguage_(text, apiLanguage);

  let score = 0;

  if (lang === 'JA') score += 300;
  if (analysis.jaChars >= 20) score += 500;
  if (analysis.jaRatio >= 0.35) score += 300;

  if (analysis.jaChars === 0 && analysis.latinChars >= 80) score -= 700;

  return score;
}


/**
 * 無料お試し版除外。
 *
 * @param {object} item
 * @returns {boolean}
 */
function dbgKoboIsFreeTrialItem_(item) {
  const s = [
    item.title || '',
    item.subTitle || '',
    item.seriesName || '',
    item.itemCaption || ''
  ].join('\n');

  return /無料お試し版|期間限定無料|無料版|お試し版/.test(s);
}


/**
 * 短い英字タイトルの危険判定。
 *
 * @param {string} value
 * @returns {boolean}
 */
function dbgKoboIsRiskyShortLatinBase_(value) {
  const s = dbgKoboNormalizeTitle_(value);

  if (!s) return false;

  // 日本語を含むなら対象外
  if (/[ぁ-んァ-ヶ一-龠]/.test(String(value || ''))) return false;

  // 短い英字・一般語系
  if (/^[a-z0-9]{1,8}$/.test(s)) return true;

  const riskyWords = [
    'dolls',
    'doll',
    'world',
    'game',
    'note',
    'death',
    'brain',
    'storming',
    'teens',
    'fantastic',
    'trick'
  ];

  return riskyWords.includes(s);
}


/**
 * タイトル比較用正規化。
 *
 * @param {string} value
 * @returns {string}
 */
function dbgKoboNormalizeTitle_(value) {
  return String(value || '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[【】『』「」\[\]（）()〈〉《》]/g, '')
    .replace(/[・･\s　:_\-—–‐.,，、。!！?？'’"“”]/g, '')
    .replace(/巻|巻目|第/g, '')
    .trim();
}


/**
 * 作者/出版社比較用正規化。
 *
 * @param {string} value
 * @returns {string}
 */
function dbgKoboNormalizePersonOrPublisher_(value) {
  return String(value || '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/\d{4}-?/g, ' ')
    .replace(/[()（）\[\]【】『』「」]/g, ' ')
    .replace(/[×・･\/／,，、＋+&＆]/g, ' ')
    .replace(/[.\-‐–—_]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}


/**
 * 2文字以上tokenを作る。
 *
 * @param {string} value
 * @returns {string[]}
 */
function dbgKoboBuildNameTokens_(value) {
  return String(value || '')
    .split(/\s+/)
    .map(s => s.trim())
    .filter(s => s.length >= 2);
}


/**
 * テキスト整形。
 *
 * @param {string} value
 * @returns {string}
 */
function dbgKoboCleanText_(value) {
  return String(value || '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}



function debugLibraryDatasetSize() {
  const t0 = Date.now();
  const dataset = buildLibraryDataset_();
  const t1 = Date.now();

  const json = JSON.stringify(dataset);
  const byteSize = Utilities.newBlob(json).getBytes().length;
  const chunkSize = CACHE_CONFIG.CHUNK_SIZE;
  const chunkCount = Math.max(1, Math.ceil(json.length / chunkSize));

  console.log(JSON.stringify({
    rows: Array.isArray(dataset.rows) ? dataset.rows.length : 0,
    index: Array.isArray(dataset.index) ? dataset.index.length : 0,
    jsonChars: json.length,
    jsonBytes: byteSize,
    jsonKB: Math.round(byteSize / 1024),
    jsonMB: Math.round(byteSize / 1024 / 1024 * 100) / 100,
    chunkSize,
    chunkCount,
    buildMs: t1 - t0
  }, null, 2));
}


/************************************************************
 * debug: 図書館Webアプリ dataset サイズ検証
 *
 * 目的:
 * - 現在のY列あらすじRAW込みdatasetサイズを測る
 * - Y列あらすじRAWを空にした仮想datasetサイズを測る
 * - V/Y両方を空にした仮想datasetサイズを測る
 * - 検索レスポンスにsummaryがある/ない場合のサイズ差を見る
 * - 本番キャッシュキーを壊さず、debug専用キーでput/get速度を見る
 *
 * 注意:
 * - スプレッドシート本体は変更しない
 * - 本番の CACHE_CONFIG.LIBRARY_DATASET_KEY は消さない
 * - debug用CacheServiceだけ一時使用する
 ************************************************************/

const DEBUG_LIBRARY_SIZE_CONFIG = {
  CACHE_KEY_FULL: 'debug_library_dataset_size_full',
  CACHE_KEY_NO_RAW: 'debug_library_dataset_size_no_raw',
  CACHE_TTL_SECONDS: 300,

  // 検索レスポンス検証用。
  // keyword: '' なら先頭から指定件数をサンプル化。
  SAMPLE_KEYWORD: '',
  SAMPLE_LIMIT: 30
};

/**
 * datasetサイズ比較メイン。
 * Apps Script上でこの関数を手動実行する。
 *
 * @returns {Object}
 */
function debugCompareLibraryDatasetSize() {
  const result = debugCompareLibraryDatasetSize_(DEBUG_LIBRARY_SIZE_CONFIG.SAMPLE_KEYWORD, DEBUG_LIBRARY_SIZE_CONFIG.SAMPLE_LIMIT);
  console.log(JSON.stringify(result, null, 2));
  return result;
}

/**
 * キーワードを変えて検索レスポンスサイズも見たい時用。
 * ここを書き換えて実行する。
 *
 * @returns {Object}
 */
function debugCompareLibraryDatasetSizePreset() {
  const keyword = 'よつばと'; // ←必要に応じて変更
  const limit = 30;           // ←必要に応じて変更

  const result = debugCompareLibraryDatasetSize_(keyword, limit);
  console.log(JSON.stringify(result, null, 2));
  return result;
}

/**
 * datasetサイズ比較本体。
 *
 * @param {string} keyword 検索レスポンス検証用キーワード。空なら先頭から抽出。
 * @param {number} limit 検索レスポンス検証用の最大件数。
 * @returns {Object}
 */
function debugCompareLibraryDatasetSize_(keyword, limit) {
  const t0 = Date.now();

  const dataset = buildLibraryDataset_();
  const t1 = Date.now();

  const noRawDataset = stripSummaryRawFromDatasetForDebug_(dataset);
  const noSummaryDataset = stripSummaryAndRawFromDatasetForDebug_(dataset);

  const t2 = Date.now();

  const fullSize = measureJsonPayloadForDebug_('dataset_full_current_V_and_Y', dataset);
  const noRawSize = measureJsonPayloadForDebug_('dataset_no_Y_summary_raw', noRawDataset);
  const noSummarySize = measureJsonPayloadForDebug_('dataset_no_V_summary_no_Y_raw', noSummaryDataset);

  const fullCache = debugCacheRoundTripForDebug_(DEBUG_LIBRARY_SIZE_CONFIG.CACHE_KEY_FULL, dataset);
  const noRawCache = debugCacheRoundTripForDebug_(DEBUG_LIBRARY_SIZE_CONFIG.CACHE_KEY_NO_RAW, noRawDataset);

  const searchSample = buildSearchResponseSampleForDebug_(dataset, keyword, limit);
  const searchWithSummarySize = measureJsonPayloadForDebug_(
    'search_response_with_summary',
    searchSample.booksWithSummary
  );
  const searchNoSummarySize = measureJsonPayloadForDebug_(
    'search_response_no_summary',
    searchSample.booksNoSummary
  );

  const t3 = Date.now();

  return {
    mode: 'LIBRARY_DATASET_SIZE_COMPARE',
    generatedAt: new Date().toISOString(),

    config: {
      webappMaxCol: CONFIG.COL.WEBAPP_MAX,
      summaryCol: CONFIG.COL.SUMMARY,
      summaryRawCol: CONFIG.COL.SUMMARY_RAW,
      summaryIndex: CONFIG.IDX.SUMMARY,
      summaryRawIndex: CONFIG.IDX.SUMMARY_RAW,
      productionCacheKey: CACHE_CONFIG.LIBRARY_DATASET_KEY,
      chunkSize: CACHE_CONFIG.CHUNK_SIZE,
      ttlSeconds: CACHE_CONFIG.TTL_SECONDS
    },

    counts: {
      rows: Array.isArray(dataset.rows) ? dataset.rows.length : 0,
      index: Array.isArray(dataset.index) ? dataset.index.length : 0,
      suggestTitles: dataset.suggest && Array.isArray(dataset.suggest.titles) ? dataset.suggest.titles.length : 0,
      suggestYomis: dataset.suggest && Array.isArray(dataset.suggest.yomis) ? dataset.suggest.yomis.length : 0,
      suggestAuthors: dataset.suggest && Array.isArray(dataset.suggest.authors) ? dataset.suggest.authors.length : 0
    },

    timingMs: {
      buildDataset: t1 - t0,
      cloneDatasets: t2 - t1,
      total: t3 - t0
    },

    datasetSize: {
      fullCurrent: fullSize,
      noSummaryRawY: noRawSize,
      noSummaryVAndRawY: noSummarySize,
      diffFullMinusNoRaw: buildPayloadDiffForDebug_(fullSize, noRawSize),
      diffFullMinusNoSummary: buildPayloadDiffForDebug_(fullSize, noSummarySize)
    },

    cacheRoundTrip: {
      fullCurrent: fullCache,
      noSummaryRawY: noRawCache
    },

    searchResponseSample: {
      keyword: String(keyword || ''),
      limit: Number(limit || 0),
      matchedCount: searchSample.matchedCount,
      sampledCount: searchSample.sampledCount,
      withSummary: searchWithSummarySize,
      noSummary: searchNoSummarySize,
      diffWithMinusNoSummary: buildPayloadDiffForDebug_(searchWithSummarySize, searchNoSummarySize)
    }
  };
}

/**
 * Y列あらすじRAWだけを空にした仮想datasetを作る。
 * 実データは変更しない。
 *
 * @param {Object} dataset
 * @returns {Object}
 */
function stripSummaryRawFromDatasetForDebug_(dataset) {
  const rawIndex = CONFIG.IDX.SUMMARY_RAW;

  return {
    rows: (dataset.rows || []).map(row => {
      const next = row.slice();
      if (rawIndex >= 0 && rawIndex < next.length) {
        next[rawIndex] = '';
      }
      return next;
    }),
    index: dataset.index || [],
    suggest: dataset.suggest || {},
    advancedOptions: dataset.advancedOptions || {}
  };
}

/**
 * V列SUMMARYとY列SUMMARY_RAWを空にした仮想datasetを作る。
 * 将来V列に短縮あらすじを入れた時の重さ見積もり用。
 *
 * @param {Object} dataset
 * @returns {Object}
 */
function stripSummaryAndRawFromDatasetForDebug_(dataset) {
  const summaryIndex = CONFIG.IDX.SUMMARY;
  const rawIndex = CONFIG.IDX.SUMMARY_RAW;

  return {
    rows: (dataset.rows || []).map(row => {
      const next = row.slice();

      if (summaryIndex >= 0 && summaryIndex < next.length) {
        next[summaryIndex] = '';
      }
      if (rawIndex >= 0 && rawIndex < next.length) {
        next[rawIndex] = '';
      }

      return next;
    }),
    index: dataset.index || [],
    suggest: dataset.suggest || {},
    advancedOptions: dataset.advancedOptions || {}
  };
}

/**
 * JSON payloadのサイズを測定する。
 *
 * @param {string} label
 * @param {*} value
 * @returns {Object}
 */
function measureJsonPayloadForDebug_(label, value) {
  const t0 = Date.now();
  const json = JSON.stringify(value);
  const stringifyMs = Date.now() - t0;

  const byteSize = Utilities.newBlob(json, 'application/json').getBytes().length;
  const chunkSize = Number(CACHE_CONFIG.CHUNK_SIZE || 90000);

  return {
    label,
    jsonChars: json.length,
    jsonBytes: byteSize,
    jsonKB: Math.round(byteSize / 1024),
    jsonMB: Math.round((byteSize / 1024 / 1024) * 100) / 100,
    chunkSize,
    chunkCountByChars: Math.max(1, Math.ceil(json.length / chunkSize)),
    estimatedChunkCountByBytes: Math.max(1, Math.ceil(byteSize / chunkSize)),
    stringifyMs
  };
}

/**
 * 2つのpayload測定結果の差分。
 *
 * @param {Object} bigger
 * @param {Object} smaller
 * @returns {Object}
 */
function buildPayloadDiffForDebug_(bigger, smaller) {
  const bytes = Number(bigger.jsonBytes || 0) - Number(smaller.jsonBytes || 0);
  const chars = Number(bigger.jsonChars || 0) - Number(smaller.jsonChars || 0);

  return {
    jsonCharsDiff: chars,
    jsonBytesDiff: bytes,
    jsonKBDiff: Math.round(bytes / 1024),
    jsonMBDiff: Math.round((bytes / 1024 / 1024) * 100) / 100,
    reductionRate: bigger.jsonBytes
      ? Math.round((bytes / Number(bigger.jsonBytes)) * 1000) / 10 + '%'
      : '0%'
  };
}

/**
 * debug専用キーでCacheServiceのput/getを試す。
 * 本番キャッシュキーは触らない。
 *
 * @param {string} key
 * @param {*} value
 * @returns {Object}
 */
function debugCacheRoundTripForDebug_(key, value) {
  const result = {
    cacheKey: key,
    putOk: false,
    putMs: 0,
    getMs: 0,
    restored: false,
    restoredRows: 0,
    error: ''
  };

  try {
    clearCachedJson_(key);

    const t0 = Date.now();
    result.putOk = putCachedJson_(key, value, DEBUG_LIBRARY_SIZE_CONFIG.CACHE_TTL_SECONDS);
    result.putMs = Date.now() - t0;

    const t1 = Date.now();
    const restored = getCachedJson_(key);
    result.getMs = Date.now() - t1;

    result.restored = !!(
      restored &&
      Array.isArray(restored.rows) &&
      Array.isArray(restored.index) &&
      restored.rows.length === (value.rows || []).length &&
      restored.index.length === (value.index || []).length
    );

    result.restoredRows = restored && Array.isArray(restored.rows)
      ? restored.rows.length
      : 0;

    clearCachedJson_(key);
  } catch (e) {
    result.error = e && e.stack ? e.stack : String(e);
    try {
      clearCachedJson_(key);
    } catch (ignore) {}
  }

  return result;
}

/**
 * 検索レスポンスのサンプルを作る。
 * 現行の検索ロジックに近く、index.searchKeyで絞り込む。
 *
 * @param {Object} dataset
 * @param {string} keyword
 * @param {number} limit
 * @returns {{matchedCount:number, sampledCount:number, booksWithSummary:Object[], booksNoSummary:Object[]}}
 */
function buildSearchResponseSampleForDebug_(dataset, keyword, limit) {
  const rows = Array.isArray(dataset.rows) ? dataset.rows : [];
  const index = Array.isArray(dataset.index) ? dataset.index : [];

  const nKeyword = normalizeKana(keyword || '');
  const max = Math.max(1, Number(limit || 30));

  const matchedRows = [];
  const matchedIndex = [];
  let matchedCount = 0;

  for (let i = 0; i < rows.length; i++) {
    const idx = index[i] || {};
    const ok = !nKeyword || (idx.searchKey && idx.searchKey.includes(nKeyword));
    if (!ok) continue;

    matchedCount++;

    if (matchedRows.length < max) {
      matchedRows.push(rows[i]);
      matchedIndex.push(idx);
    }
  }

  const booksWithSummary = mapRowsToBooks_(matchedRows, matchedIndex);
  const booksNoSummary = booksWithSummary.map(book => {
    const next = Object.assign({}, book);
    next.summary = '';
    return next;
  });

  return {
    matchedCount,
    sampledCount: booksWithSummary.length,
    booksWithSummary,
    booksNoSummary
  };
}






/************************************************************
 * debug: Webアプリ初期ロード / dataset構築ボトルネック調査
 *
 * 目的:
 * - buildLibraryDataset_() の工程別時間を測る
 * - getLibraryDataset_() の cache miss / cache hit を分けて測る
 * - 初期表示時に呼ばれる3API相当
 *   getSuggestData / getAdvancedSearchOptions / getPreviewIndex
 *   の重さを確認する
 *
 * 注意:
 * - 本番データは変更しない
 * - 本番キャッシュを消す関数は明示的に分ける
 ************************************************************/

/**
 * 大本命調査メイン。
 * まずこれを実行する。
 */
function debugFindLibraryLoadBottleneck() {
  const result = {
    mode: 'FIND_LIBRARY_LOAD_BOTTLENECK',
    generatedAt: new Date().toISOString(),
    productionCacheKey: CACHE_CONFIG.LIBRARY_DATASET_KEY,
    chunkSize: CACHE_CONFIG.CHUNK_SIZE,
    results: {}
  };

  // 1. buildLibraryDataset_() の工程別計測
  result.results.buildProfile = debugProfileBuildLibraryDataset_();

  // 2. キャッシュなし/ありの getLibraryDataset_() を計測
  result.results.cacheFlow = debugProfileLibraryDatasetCacheFlow_();

  // 3. 初期表示API 3本相当の重さを計測
  result.results.initialApis = debugProfileInitialLoadApis_();

  console.log(JSON.stringify(result, null, 2));
  return result;
}

/**
 * buildLibraryDataset_() と同等処理を工程別に計測する。
 * 既存 buildLibraryDataset_() は変更しない。
 */
function debugProfileBuildLibraryDataset_() {
  const marks = [];
  const mark = label => marks.push({ label, ms: Date.now() });

  mark('start');

  const rows = loadMainBookData_();
  mark('loadMainBookData');

  const genreMaster = getGenreMasterData_();
  mark('getGenreMasterData');

  const publisherOptions = getPublisherOptions_();
  mark('getPublisherOptions');

  const index = [];
  const titleSet = new Set();
  const yomiSet = new Set();
  const authorSet = new Set();
  const genreSet = new Set();
  const releaseYearSet = new Set();

  rows.forEach(row => {
    const title = row[CONFIG.IDX.TITLE] || '';
    const yomi = row[CONFIG.IDX.YOMIGANA] || '';
    const author = row[CONFIG.IDX.AUTHOR] || '';
    const seriesKeyAuto = row[CONFIG.IDX.SERIES_KEY_AUTO] || '';
    const volume = extractVolumeNumber(title);
    const publisher = row[CONFIG.IDX.PUBLISHER] || '';
    const released = row[CONFIG.IDX.RELEASED] || '';
    const genreText = row[CONFIG.IDX.GENRE] || '';

    const rawGenres = String(genreText)
      .split(',')
      .map(v => v.trim())
      .filter(v => v !== '');

    const genreMeta = [];
    const genres = {
      story: [],
      theme: [],
      mood: [],
      status: []
    };

    rawGenres.forEach(genre => {
      genreSet.add(genre);
      const category = genreMaster.genreToCategory[genre];
      if (!category) return;

      switch (category) {
        case 'ストーリー':
          genres.story.push(genre);
          genreMeta.push({ name: genre, category: 'story' });
          break;
        case '題材':
          genres.theme.push(genre);
          genreMeta.push({ name: genre, category: 'theme' });
          break;
        case '雰囲気':
          genres.mood.push(genre);
          genreMeta.push({ name: genre, category: 'mood' });
          break;
        case '状況':
          genres.status.push(genre);
          genreMeta.push({ name: genre, category: 'status' });
          break;
      }
    });

    const normalizedTitle = normalizeKana(title);
    const normalizedYomi = normalizeKana(yomi);
    const normalizedAuthor = normalizeKana(author);
    const releasedYm = normalizeReleasedYm_(released);

    if (releasedYm) {
      releaseYearSet.add(Math.floor(releasedYm / 100));
    }

    index.push({
      title: normalizedTitle,
      yomi: normalizedYomi,
      author: normalizedAuthor,
      searchKey: buildSearchKey_(title, yomi, author),
      publisher: String(publisher).trim(),
      genresRaw: rawGenres,
      genres,
      genreMeta,
      seriesKeyAuto,
      seriesDisplayTitle: buildSeriesDisplayTitle_(title),
      volume,
      isMainVolume: Number(volume) > 0,
      ownedMaxVolume: 0,
      releasedYm: releasedYm
    });

    if (title) titleSet.add(title);
    if (yomi) yomiSet.add(yomi);
    if (author) authorSet.add(author);
  });

  mark('buildIndexAndSuggestSets');

  const seriesMaxMap = buildSeriesMaxVolumeMap_({ index });
  mark('buildSeriesMaxVolumeMap');

  const seriesGroupMap = new Map();

  index.forEach((item, i) => {
    if (!item || !item.seriesKeyAuto) return;

    if (!seriesGroupMap.has(item.seriesKeyAuto)) {
      seriesGroupMap.set(item.seriesKeyAuto, { indices: [], titles: [] });
    }

    const group = seriesGroupMap.get(item.seriesKeyAuto);
    group.indices.push(i);
    group.titles.push(rows[i] ? (rows[i][CONFIG.IDX.TITLE] || '') : '');
  });

  mark('buildSeriesGroupMap');

  const seriesMetaMap = new Map();

  seriesGroupMap.forEach((group, key) => {
    seriesMetaMap.set(key, {
      count: group.indices.length,
      searchTitle: chooseSeriesSearchTitle_(group.titles)
    });
  });

  mark('buildSeriesMetaMap_chooseSearchTitle');

  index.forEach((item, i) => {
    if (!item) return;

    const meta = item.seriesKeyAuto ? seriesMetaMap.get(item.seriesKeyAuto) : null;
    const seriesCount = meta ? Number(meta.count || 0) : 0;
    const seriesSearchTitle = meta ? (meta.searchTitle || '') : '';
    const isExtraSeries = /^__extra__/.test(String(item.seriesKeyAuto || ''));

    if (item.seriesKeyAuto) {
      item.ownedMaxVolume = seriesMaxMap.get(item.seriesKeyAuto) || 0;
    } else {
      item.ownedMaxVolume = 0;
    }

    item.seriesCount = seriesCount;
    item.seriesSearchTitle = seriesSearchTitle;
    item.isExtraSeries = isExtraSeries;
    item.links = buildBookSearchLinks_(
      rows[i] ? (rows[i][CONFIG.IDX.TITLE] || '') : '',
      seriesSearchTitle,
      seriesCount,
      isExtraSeries
    );
  });

  mark('attachSeriesMetaAndLinks');

  const sortedReleaseYears = Array.from(releaseYearSet).sort((a, b) => a - b);
  let releaseYears = [];

  if (sortedReleaseYears.length) {
    const minYear = sortedReleaseYears[0] - 1;
    const maxYear = sortedReleaseYears[sortedReleaseYears.length - 1] + 2;
    for (let y = minYear; y <= maxYear; y++) {
      releaseYears.push(String(y));
    }
  }

  mark('buildReleaseYears');

  const dataset = {
    rows,
    index,
    suggest: {
      titles : Array.from(titleSet),
      yomis  : Array.from(yomiSet),
      authors: Array.from(authorSet),
      genres : Array.from(genreSet)
    },
    advancedOptions: {
      publishers : publisherOptions,
      storyGenres: genreMaster.options.story,
      themeGenres: genreMaster.options.theme,
      moodGenres : genreMaster.options.mood,
      statusGenres: genreMaster.options.status,
      releaseYears: releaseYears
    }
  };

  mark('assembleDataset');

  const size = debugMeasurePayloadBrief_(dataset);
  mark('measureDatasetSize');

  return {
    rows: rows.length,
    index: index.length,
    seriesGroupCount: seriesGroupMap.size,
    suggestCounts: {
      titles: titleSet.size,
      yomis: yomiSet.size,
      authors: authorSet.size,
      genres: genreSet.size
    },
    size,
    timings: debugBuildTimingDiffs_(marks)
  };
}

/**
 * getLibraryDataset_() のキャッシュなし/ありを計測。
 * 本番キャッシュを一度消すので、実行タイミングに注意。
 */
function debugProfileLibraryDatasetCacheFlow_() {
  const cacheKey = CACHE_CONFIG.LIBRARY_DATASET_KEY;
  const result = {};

  clearLibrarySearchCache_();

  let t0 = Date.now();
  const missDataset = getLibraryDataset_();
  result.cacheMissGetLibraryDatasetMs = Date.now() - t0;
  result.cacheMissRows = missDataset && Array.isArray(missDataset.rows) ? missDataset.rows.length : 0;

  t0 = Date.now();
  const hitDataset1 = getLibraryDataset_();
  result.cacheHit1GetLibraryDatasetMs = Date.now() - t0;
  result.cacheHit1Rows = hitDataset1 && Array.isArray(hitDataset1.rows) ? hitDataset1.rows.length : 0;

  t0 = Date.now();
  const hitDataset2 = getLibraryDataset_();
  result.cacheHit2GetLibraryDatasetMs = Date.now() - t0;
  result.cacheHit2Rows = hitDataset2 && Array.isArray(hitDataset2.rows) ? hitDataset2.rows.length : 0;

  result.cacheKey = cacheKey;
  return result;
}

/**
 * 初期表示時に呼ばれる3API相当の処理時間を見る。
 * DOMContentLoaded側では fetchSuggestData / fetchAdvancedOptions / fetchPreviewIndex が走る。
 */
function debugProfileInitialLoadApis_() {
  const result = {};

  clearLibrarySearchCache_();

  let t0 = Date.now();
  const suggest = getSuggestData();
  result.first_getSuggestDataMs = Date.now() - t0;
  result.suggestCounts = {
    titles: Array.isArray(suggest.titles) ? suggest.titles.length : 0,
    yomis: Array.isArray(suggest.yomis) ? suggest.yomis.length : 0,
    authors: Array.isArray(suggest.authors) ? suggest.authors.length : 0,
    genres: Array.isArray(suggest.genres) ? suggest.genres.length : 0
  };
  result.suggestSize = debugMeasurePayloadBrief_(suggest);

  t0 = Date.now();
  const advanced = getAdvancedSearchOptions();
  result.second_getAdvancedSearchOptionsMs = Date.now() - t0;
  result.advancedSize = debugMeasurePayloadBrief_(advanced);

  t0 = Date.now();
  const preview = getPreviewIndex();
  result.third_getPreviewIndexMs = Date.now() - t0;
  result.previewCount = Array.isArray(preview) ? preview.length : 0;
  result.previewSize = debugMeasurePayloadBrief_(preview);

  t0 = Date.now();
  const suggest2 = getSuggestData();
  result.cacheHit_getSuggestDataAgainMs = Date.now() - t0;
  result.suggest2Size = debugMeasurePayloadBrief_(suggest2);

  return result;
}

/**
 * 簡易payloadサイズ測定。
 */
function debugMeasurePayloadBrief_(value) {
  const json = JSON.stringify(value);
  const bytes = Utilities.newBlob(json, 'application/json').getBytes().length;

  return {
    jsonChars: json.length,
    jsonBytes: bytes,
    jsonKB: Math.round(bytes / 1024),
    jsonMB: Math.round((bytes / 1024 / 1024) * 100) / 100
  };
}

/**
 * mark配列から差分msを作る。
 */
function debugBuildTimingDiffs_(marks) {
  const out = [];
  for (let i = 1; i < marks.length; i++) {
    out.push({
      step: `${marks[i - 1].label} -> ${marks[i].label}`,
      ms: marks[i].ms - marks[i - 1].ms
    });
  }

  const first = marks[0];
  const last = marks[marks.length - 1];

  return {
    totalMs: last.ms - first.ms,
    steps: out
  };
}



/************************************************************
 * debug: データ!L2 の最終行キャッシュ利用検証
 *
 * 目的:
 * - 従来の getLastDataRow(sheet, TITLE) 方式
 * - データ!L2 の数式結果を使う方式
 * - sheet.getLastRow() 方式
 * を比較し、loadMainBookData_() のボトルネック改善幅を見る。
 *
 * 注意:
 * - 本番データは変更しない
 * - 本番 loadMainBookData_() は変更しない
 * - キャッシュは触らない
 ************************************************************/

const DEBUG_LAST_ROW_CELL_CONFIG = {
  DATA_SHEET_NAME: 'データ',
  LAST_ROW_A1: 'L2',
  TRIALS: 5
};

/**
 * データ!L2 の最終行キャッシュ方式を検証するメイン関数。
 * まずこれを手動実行する。
 *
 * @returns {Object}
 */
function debugCompareLoadMainBookDataWithLastRowCell() {
  const result = debugCompareLoadMainBookDataWithLastRowCell_(
    DEBUG_LAST_ROW_CELL_CONFIG.TRIALS
  );

  console.log(JSON.stringify(result, null, 2));
  return result;
}

/**
 * 試行回数を変えたい場合用。
 *
 * @returns {Object}
 */
function debugCompareLoadMainBookDataWithLastRowCellPreset() {
  const trials = 10;
  const result = debugCompareLoadMainBookDataWithLastRowCell_(trials);

  console.log(JSON.stringify(result, null, 2));
  return result;
}

/**
 * 比較本体。
 *
 * @param {number} trials
 * @returns {Object}
 */
function debugCompareLoadMainBookDataWithLastRowCell_(trials) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const mainSheet = ss.getSheetByName(CONFIG.SHEETS.MAIN);
  const dataSheet = ss.getSheetByName(DEBUG_LAST_ROW_CELL_CONFIG.DATA_SHEET_NAME);

  if (!mainSheet) {
    throw new Error('目録シートが見つかりません: ' + CONFIG.SHEETS.MAIN);
  }
  if (!dataSheet) {
    throw new Error('データシートが見つかりません: ' + DEBUG_LAST_ROW_CELL_CONFIG.DATA_SHEET_NAME);
  }

  const trialCount = Math.max(1, Number(trials || 1));
  const webappEndCol = CONFIG.COL.WEBAPP_MAX || CONFIG.COL.SERIES_KEY_AUTO;
  const colCount = webappEndCol - CONFIG.COL.TITLE + 1;

  const lastRowCellValue = readDebugLastRowCell_();
  const sheetLastRow = mainSheet.getLastRow();

  const runs = {
    current_getLastDataRow: [],
    formulaCell_L2: [],
    sheet_getLastRow: []
  };

  // 先に1回軽く読む。GAS/Sheets側の初回ウォームアップ揺れを少し逃がす。
  try {
    mainSheet.getRange(1, CONFIG.COL.TITLE, 1, 1).getDisplayValue();
    dataSheet.getRange(DEBUG_LAST_ROW_CELL_CONFIG.LAST_ROW_A1).getDisplayValue();
  } catch (e) {
    console.warn('warmup failed:', e);
  }

  for (let i = 0; i < trialCount; i++) {
    runs.current_getLastDataRow.push(
      measureLoadMainBookDataVariantForDebug_({
        label: 'current_getLastDataRow',
        lastRowGetter: function() {
          return getLastDataRow(mainSheet, CONFIG.COL.TITLE);
        },
        mainSheet,
        colCount
      })
    );

    runs.formulaCell_L2.push(
      measureLoadMainBookDataVariantForDebug_({
        label: 'formulaCell_L2',
        lastRowGetter: function() {
          return readDebugLastRowCell_();
        },
        mainSheet,
        colCount
      })
    );

    runs.sheet_getLastRow.push(
      measureLoadMainBookDataVariantForDebug_({
        label: 'sheet_getLastRow',
        lastRowGetter: function() {
          return mainSheet.getLastRow();
        },
        mainSheet,
        colCount
      })
    );
  }

  return {
    mode: 'COMPARE_LOAD_MAIN_BOOK_DATA_WITH_LAST_ROW_CELL',
    generatedAt: new Date().toISOString(),
    config: {
      mainSheetName: CONFIG.SHEETS.MAIN,
      dataSheetName: DEBUG_LAST_ROW_CELL_CONFIG.DATA_SHEET_NAME,
      lastRowCell: DEBUG_LAST_ROW_CELL_CONFIG.LAST_ROW_A1,
      titleCol: CONFIG.COL.TITLE,
      webappMaxCol: CONFIG.COL.WEBAPP_MAX,
      colCount,
      trials: trialCount
    },
    observed: {
      lastRowCellValue,
      sheetGetLastRow: sheetLastRow,
      maxRows: mainSheet.getMaxRows()
    },
    summary: {
      current_getLastDataRow: summarizeDebugRuns_(runs.current_getLastDataRow),
      formulaCell_L2: summarizeDebugRuns_(runs.formulaCell_L2),
      sheet_getLastRow: summarizeDebugRuns_(runs.sheet_getLastRow)
    },
    runs
  };
}

/**
 * データ!L2 の最終行値を読む。
 *
 * @returns {number}
 */
function readDebugLastRowCell_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const dataSheet = ss.getSheetByName(DEBUG_LAST_ROW_CELL_CONFIG.DATA_SHEET_NAME);
  if (!dataSheet) return 1;

  const value = dataSheet
    .getRange(DEBUG_LAST_ROW_CELL_CONFIG.LAST_ROW_A1)
    .getDisplayValue();

  const n = Number(String(value || '').replace(/,/g, '').trim());
  return Number.isFinite(n) && n >= 1 ? Math.floor(n) : 1;
}

/**
 * loadMainBookData_() 相当の読み取りを、lastRow取得方法だけ差し替えて測る。
 *
 * @param {{
 *   label: string,
 *   lastRowGetter: Function,
 *   mainSheet: GoogleAppsScript.Spreadsheet.Sheet,
 *   colCount: number
 * }} params
 * @returns {Object}
 */
function measureLoadMainBookDataVariantForDebug_(params) {
  const label = params.label;
  const sheet = params.mainSheet;
  const colCount = params.colCount;

  const t0 = Date.now();
  const lastRow = Number(params.lastRowGetter()) || 1;
  const t1 = Date.now();

  if (lastRow <= 1) {
    return {
      label,
      lastRow,
      rawRows: 0,
      filteredRows: 0,
      lastRowMs: t1 - t0,
      readValuesMs: 0,
      filterMs: 0,
      totalMs: Date.now() - t0,
      error: ''
    };
  }

  let values = [];
  let error = '';

  const t2 = Date.now();
  try {
    values = sheet
      .getRange(2, CONFIG.COL.TITLE, lastRow - 1, colCount)
      .getDisplayValues();
  } catch (e) {
    error = e && e.stack ? e.stack : String(e);
  }
  const t3 = Date.now();

  let filtered = [];
  if (!error) {
    filtered = values.filter(row => {
      const title = String(row[CONFIG.IDX.TITLE] || '')
        .replace(/\u00A0/g, ' ')
        .replace(/\u200B/g, '')
        .replace(/\uFEFF/g, '')
        .trim();
      return title !== '';
    });
  }
  const t4 = Date.now();

  return {
    label,
    lastRow,
    rawRows: values.length,
    filteredRows: filtered.length,
    lastRowMs: t1 - t0,
    readValuesMs: t3 - t2,
    filterMs: t4 - t3,
    totalMs: t4 - t0,
    error
  };
}

/**
 * 実行結果配列の要約。
 *
 * @param {Object[]} runs
 * @returns {Object}
 */
function summarizeDebugRuns_(runs) {
  const valid = (runs || []).filter(r => !r.error);
  if (!valid.length) {
    return {
      count: 0,
      errorCount: (runs || []).length,
      avgTotalMs: 0,
      avgLastRowMs: 0,
      avgReadValuesMs: 0,
      avgFilterMs: 0,
      minTotalMs: 0,
      maxTotalMs: 0,
      lastRowValues: []
    };
  }

  const avg = key => Math.round(
    valid.reduce((sum, r) => sum + Number(r[key] || 0), 0) / valid.length
  );

  const totals = valid.map(r => Number(r.totalMs || 0));

  return {
    count: valid.length,
    errorCount: (runs || []).length - valid.length,
    avgTotalMs: avg('totalMs'),
    avgLastRowMs: avg('lastRowMs'),
    avgReadValuesMs: avg('readValuesMs'),
    avgFilterMs: avg('filterMs'),
    minTotalMs: Math.min.apply(null, totals),
    maxTotalMs: Math.max.apply(null, totals),
    lastRowValues: Array.from(new Set(valid.map(r => r.lastRow))),
    rawRowsValues: Array.from(new Set(valid.map(r => r.rawRows))),
    filteredRowsValues: Array.from(new Set(valid.map(r => r.filteredRows)))
  };
}

function debugClearLibrarySearchCache() {
  clearLibrarySearchCache_();
}

function debugGetInitialSearchData() {
  const data = getInitialSearchData();

  console.log(JSON.stringify({
    suggest: {
      titles: data.suggest.titles.length,
      yomis: data.suggest.yomis.length,
      authors: data.suggest.authors.length,
      genres: data.suggest.genres.length
    },
    advancedOptions: {
      publishers: data.advancedOptions.publishers.length,
      storyGenres: data.advancedOptions.storyGenres.length,
      themeGenres: data.advancedOptions.themeGenres.length,
      moodGenres: data.advancedOptions.moodGenres.length,
      statusGenres: data.advancedOptions.statusGenres.length,
      releaseYears: data.advancedOptions.releaseYears.length
    },
    previewIndex: data.previewIndex.length
  }, null, 2));
}


/**
 * 初期API統合の効果比較
 *
 * 比較対象:
 * - 旧方式: getSuggestData + getAdvancedSearchOptions + getPreviewIndex
 * - 新方式: getInitialSearchData
 *
 * 注意:
 * - 本番データは変更しない
 * - 検索キャッシュは比較のために削除する
 */
function debugCompareInitialSearchApiIntegration() {
  const result = {
    mode: 'COMPARE_INITIAL_SEARCH_API_INTEGRATION',
    generatedAt: new Date().toISOString(),
    cacheKey: CACHE_CONFIG.LIBRARY_DATASET_KEY,
    results: {}
  };

  // 旧方式：キャッシュなし状態から3APIを順番に呼ぶ
  clearLibrarySearchCache_();

  let t0 = Date.now();
  const oldSuggest = getSuggestData();
  const oldAdvanced = getAdvancedSearchOptions();
  const oldPreview = getPreviewIndex();
  result.results.oldThreeApisCacheMiss = {
    totalMs: Date.now() - t0,
    suggestCounts: {
      titles: Array.isArray(oldSuggest.titles) ? oldSuggest.titles.length : 0,
      yomis: Array.isArray(oldSuggest.yomis) ? oldSuggest.yomis.length : 0,
      authors: Array.isArray(oldSuggest.authors) ? oldSuggest.authors.length : 0,
      genres: Array.isArray(oldSuggest.genres) ? oldSuggest.genres.length : 0
    },
    advancedCounts: {
      publishers: Array.isArray(oldAdvanced.publishers) ? oldAdvanced.publishers.length : 0,
      storyGenres: Array.isArray(oldAdvanced.storyGenres) ? oldAdvanced.storyGenres.length : 0,
      themeGenres: Array.isArray(oldAdvanced.themeGenres) ? oldAdvanced.themeGenres.length : 0,
      moodGenres: Array.isArray(oldAdvanced.moodGenres) ? oldAdvanced.moodGenres.length : 0,
      statusGenres: Array.isArray(oldAdvanced.statusGenres) ? oldAdvanced.statusGenres.length : 0,
      releaseYears: Array.isArray(oldAdvanced.releaseYears) ? oldAdvanced.releaseYears.length : 0
    },
    previewCount: Array.isArray(oldPreview) ? oldPreview.length : 0,
    payloadSize: debugMeasurePayloadBrief_({
      suggest: oldSuggest,
      advancedOptions: oldAdvanced,
      previewIndex: oldPreview
    })
  };

  // 新方式：キャッシュなし状態から統合APIを1回呼ぶ
  clearLibrarySearchCache_();

  t0 = Date.now();
  const unified = getInitialSearchData();
  result.results.newUnifiedApiCacheMiss = {
    totalMs: Date.now() - t0,
    suggestCounts: {
      titles: Array.isArray(unified.suggest.titles) ? unified.suggest.titles.length : 0,
      yomis: Array.isArray(unified.suggest.yomis) ? unified.suggest.yomis.length : 0,
      authors: Array.isArray(unified.suggest.authors) ? unified.suggest.authors.length : 0,
      genres: Array.isArray(unified.suggest.genres) ? unified.suggest.genres.length : 0
    },
    advancedCounts: {
      publishers: Array.isArray(unified.advancedOptions.publishers) ? unified.advancedOptions.publishers.length : 0,
      storyGenres: Array.isArray(unified.advancedOptions.storyGenres) ? unified.advancedOptions.storyGenres.length : 0,
      themeGenres: Array.isArray(unified.advancedOptions.themeGenres) ? unified.advancedOptions.themeGenres.length : 0,
      moodGenres: Array.isArray(unified.advancedOptions.moodGenres) ? unified.advancedOptions.moodGenres.length : 0,
      statusGenres: Array.isArray(unified.advancedOptions.statusGenres) ? unified.advancedOptions.statusGenres.length : 0,
      releaseYears: Array.isArray(unified.advancedOptions.releaseYears) ? unified.advancedOptions.releaseYears.length : 0
    },
    previewCount: Array.isArray(unified.previewIndex) ? unified.previewIndex.length : 0,
    payloadSize: debugMeasurePayloadBrief_(unified)
  };

  // キャッシュあり状態での旧方式
  t0 = Date.now();
  const oldSuggestHit = getSuggestData();
  const oldAdvancedHit = getAdvancedSearchOptions();
  const oldPreviewHit = getPreviewIndex();
  result.results.oldThreeApisCacheHit = {
    totalMs: Date.now() - t0,
    previewCount: Array.isArray(oldPreviewHit) ? oldPreviewHit.length : 0,
    payloadSize: debugMeasurePayloadBrief_({
      suggest: oldSuggestHit,
      advancedOptions: oldAdvancedHit,
      previewIndex: oldPreviewHit
    })
  };

  // キャッシュあり状態での新方式
  t0 = Date.now();
  const unifiedHit = getInitialSearchData();
  result.results.newUnifiedApiCacheHit = {
    totalMs: Date.now() - t0,
    previewCount: Array.isArray(unifiedHit.previewIndex) ? unifiedHit.previewIndex.length : 0,
    payloadSize: debugMeasurePayloadBrief_(unifiedHit)
  };

  console.log(JSON.stringify(result, null, 2));
  return result;
}