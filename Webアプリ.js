// ＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝
// Webアプリ（APIサイド）メインロジック
// ※定数・ユーティリティはすべて config.gs で一元管理
// ＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝

const WEB_APP_API_REGISTRY_ = Object.freeze({
  webEntry: [
    { name: 'doGet', role: 'WebアプリHTML入口' }
  ],
  currentWebApp: [
    { name: 'getInitialSearchData', calledBy: 'script.js.html: fetchInitialSearchData', role: '初期表示データ一括取得' },
    { name: 'searchBooksSimple', calledBy: 'script.js.html: search/rerunSearchWithParams_', role: '通常検索・本棚全件表示' },
    { name: 'searchBooksAdvanced', calledBy: 'script.js.html: search/rerunSearchWithParams_', role: '詳細検索' },
    { name: 'countPreviewMatchesAuthoritative', calledBy: 'script.js.html: syncSearchStatusPreviewFromForm_', role: '詳細検索プレビュー件数のサーバー補正' },
    { name: 'getRandomBooks', calledBy: 'script.js.html: showRandomBooks', role: 'ランダム表示' },
    { name: 'getBookshelfBooks', calledBy: 'script.js.html: showAllBookshelf', role: 'PWA本棚一覧用の軽量全件取得' },
    { name: 'getBookshelfBooksChunk', calledBy: 'JSONP API: shelfChunk', role: 'PWA本棚一覧用の軽量分割取得' },
    { name: 'getBookDetailByRowIndex', calledBy: 'script.js.html: showPopup', role: 'PWA本棚一覧から開いた本の詳細取得' },
    { name: 'getBookDetailsByRowIndexes', calledBy: 'script.js.html: detail prefetch', role: 'PWA本棚詳細の少量先読み' },
    { name: 'getBooksBySeriesKey', calledBy: 'script.js.html: loadSeriesPanel', role: 'シリーズ一覧表示' },
  ],
  compatibility: [
    { name: 'searchBooks', role: '旧来互換のタイトル/作者検索' },
    { name: 'getSuggestData', role: '旧分割取得互換。現行はgetInitialSearchDataへ統合' },
    { name: 'getAdvancedSearchOptions', role: '旧分割取得互換。現行はgetInitialSearchDataへ統合' },
    { name: 'getPreviewIndex', role: '旧分割取得互換。現行はgetInitialSearchDataへ統合' },
    { name: 'getAllBooks', role: '旧全件取得互換。現行の本棚全件表示はsearchBooksSimple空検索' }
  ],
  manualDebug: [
    { name: 'debugWebAppApiRegistry_', role: 'この台帳をApps Scriptログへ出す' },
    { name: 'debugSeriesMap_', role: 'シリーズ巻数マップ診断' },
    { name: 'debugOwnedMaxVolume_', role: '所持最大巻数診断' },
    { name: 'debugSeriesCandidateList_', role: 'シリーズ候補診断' },
    { name: 'debugSeriesCandidateLinks_', role: 'シリーズ検索リンク診断' },
    { name: 'debugFirstBookLinks_', role: '先頭本のリンク診断' }
  ]
});

const WEBAPP_API_LIMITS_ = Object.freeze({
  RANDOM_MAX_COUNT: 50,
  SHELF_CHUNK_DEFAULT_LIMIT: 300,
  SHELF_CHUNK_MAX_LIMIT: 500,
  BOOK_DETAIL_BATCH_MAX: 12
});

function normalizeWebAppApiInteger_(value, options) {
  const opt = options || {};
  const fallback = Number.isFinite(Number(opt.fallback)) ? Math.floor(Number(opt.fallback)) : 0;
  const min = Number.isFinite(Number(opt.min)) ? Math.floor(Number(opt.min)) : 0;
  const max = Number.isFinite(Number(opt.max)) ? Math.floor(Number(opt.max)) : null;
  let parsed = Math.floor(Number(value));

  if (!Number.isFinite(parsed)) parsed = fallback;
  parsed = Math.max(min, parsed);
  if (max !== null) parsed = Math.min(parsed, max);
  return parsed;
}

/**
 * 目録シートから I列(タイトル)〜AB列(WEB_IMAGE_SOURCE) をまとめて取得する共通関数
 * タイトル空行は除外する
 * @returns {string[][]} 2次元配列（ヘッダ除くデータ部）
 */
function loadMainBookData_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(CONFIG.SHEETS.MAIN);
  if (!sheet) {
    console.error(`シート「${CONFIG.SHEETS.MAIN}」が見つかりません。`);
    return [];
  }

  const lastRow = getMainLastDataRowForWebApp_(sheet);
  if (lastRow <= 1) return [];

  // Webアプリ検索データはAB列のWeb画像管理列まで読む。
  const webappEndCol = CONFIG.COL.WEBAPP_MAX || CONFIG.COL.SERIES_KEY_AUTO;
  const colCount = webappEndCol - CONFIG.COL.TITLE + 1;
  const values = sheet
    .getRange(2, CONFIG.COL.TITLE, lastRow - 1, colCount)
    .getDisplayValues();

  return values.filter(row => {
    const title = String(row[CONFIG.IDX.TITLE] || '')
      .replace(/\u00A0/g, ' ')
      .replace(/\u200B/g, '')
      .replace(/\uFEFF/g, '')
      .trim();
    return title !== '';
  });
}

/**
 * Webアプリ用の目録最終データ行を取得する。
 * 通常は データ!L2 の数式結果を使用し、値が不正な場合だけ従来の列スキャンへフォールバックする。
 * @param {GoogleAppsScript.Spreadsheet.Sheet} sheet 目録シート
 * @returns {number}
 */
function getMainLastDataRowForWebApp_(sheet) {
  const hintedRow = getMainLastDataRowHintForWebApp_(sheet);
  if (hintedRow !== null) {
    return hintedRow;
  }

  console.warn('データ!L2 の最終行ヒントが不正なため、従来の getLastDataRow() にフォールバックします。');
  return getLastDataRow(sheet, CONFIG.COL.TITLE);
}

/**
 * データ!L2 から目録I列タイトル基準の最終データ行ヒントを読む。
 * - L2が空/非数値/範囲外なら null
 * - ヒント行のタイトルが空なら null
 * - ヒント行の次行にもタイトルがあるなら、ヒントが古い可能性があるため null
 * @param {GoogleAppsScript.Spreadsheet.Sheet} sheet 目録シート
 * @returns {number|null}
 */
function getMainLastDataRowHintForWebApp_(sheet) {
  try {
    const ss = sheet.getParent();
    const dataSheet = ss.getSheetByName(CONFIG.SHEETS.DATA);
    const a1 = (CONFIG.WEBAPP && CONFIG.WEBAPP.MAIN_LAST_ROW_A1) || 'L2';
    if (!dataSheet) return null;

    const rawValue = dataSheet.getRange(a1).getDisplayValue();
    const hintedRow = Number(String(rawValue || '').replace(/,/g, '').trim());
    const maxRows = sheet.getMaxRows();

    if (!Number.isFinite(hintedRow)) return null;

    const row = Math.floor(hintedRow);
    if (row <= 1) return 1;
    if (row > maxRows) return null;

    const titleAtHint = String(sheet.getRange(row, CONFIG.COL.TITLE).getDisplayValue() || '')
      .replace(/\u00A0/g, ' ')
      .replace(/\u200B/g, '')
      .replace(/\uFEFF/g, '')
      .trim();

    if (!titleAtHint) return null;

    if (row < maxRows) {
      const titleAtNextRow = String(sheet.getRange(row + 1, CONFIG.COL.TITLE).getDisplayValue() || '')
        .replace(/\u00A0/g, ' ')
        .replace(/\u200B/g, '')
        .replace(/\uFEFF/g, '')
        .trim();

      if (titleAtNextRow) return null;
    }

    return row;
  } catch (e) {
    console.warn('getMainLastDataRowHintForWebApp_ error:', e);
    return null;
  }
}

/**
 * CacheService取得
 * @returns {GoogleAppsScript.Cache.Cache}
 */
function getLibraryCache_() {
  return CacheService.getScriptCache();
}

/**
 * キャッシュ用メタキー
 * @param {string} key
 * @returns {string}
 */
function getCacheMetaKey_(key) {
  return `${key}:meta`;
}

function getUtf8ByteLength_(value) {
  return Utilities.newBlob(String(value == null ? '' : value)).getBytes().length;
}

function normalizeUtf16Boundary_(text, start, end) {
  let boundary = Math.max(start, Math.min(String(text || '').length, end));
  if (
    boundary > start &&
    boundary < text.length &&
    /[\uD800-\uDBFF]/.test(text.charAt(boundary - 1)) &&
    /[\uDC00-\uDFFF]/.test(text.charAt(boundary))
  ) {
    boundary--;
  }
  return boundary;
}

function splitUtf8ByByteLimit_(value, byteLimit) {
  const text = String(value == null ? '' : value);
  const limit = Math.max(1, Number(byteLimit || CACHE_CONFIG.CHUNK_BYTE_LIMIT));
  if (!text) return [''];

  const chunks = [];
  let start = 0;

  while (start < text.length) {
    let low = start + 1;
    let high = normalizeUtf16Boundary_(text, start, Math.min(text.length, start + limit));
    let bestEnd = start;

    while (low <= high) {
      const rawMid = Math.floor((low + high) / 2);
      const mid = normalizeUtf16Boundary_(text, start, rawMid);
      if (mid <= start) {
        low = rawMid + 1;
        continue;
      }

      if (getUtf8ByteLength_(text.slice(start, mid)) <= limit) {
        bestEnd = mid;
        low = mid + 1;
      } else {
        high = mid - 1;
      }
    }

    if (bestEnd <= start) {
      throw new Error(`Cannot split cache payload within ${limit} UTF-8 bytes`);
    }

    chunks.push(text.slice(start, bestEnd));
    start = bestEnd;
  }

  return chunks;
}

function getLibraryDatasetRevision_() {
  try {
    const props = PropertiesService.getScriptProperties();
    const revision = String(props.getProperty(CACHE_CONFIG.DATASET_REVISION_PROPERTY) || '').trim();
    return revision || '0';
  } catch (e) {
    console.error('getLibraryDatasetRevision_ error:', e);
    return 'unavailable';
  }
}

function bumpLibraryDatasetRevision_() {
  try {
    const nextRevision = String(Date.now());
    PropertiesService.getScriptProperties()
      .setProperty(CACHE_CONFIG.DATASET_REVISION_PROPERTY, nextRevision);
    return nextRevision;
  } catch (e) {
    console.error('bumpLibraryDatasetRevision_ error:', e);
    return getLibraryDatasetRevision_();
  }
}

/**
 * JSONデータを分割キャッシュから取得
 * @param {string} key
 * @returns {*|null}
 */
function getCachedJson_(key) {
  try {
    const cache = getLibraryCache_();
    const metaText = cache.get(getCacheMetaKey_(key));
    if (!metaText) return null;

    const meta = JSON.parse(metaText);
    const chunkCount = Number(meta.chunkCount || 0);
    if (!chunkCount) return null;

    const keys = Array.from({ length: chunkCount }, (_, i) => `${key}:chunk:${i}`);
    const chunkMap = cache.getAll(keys);
    if (Object.keys(chunkMap).length !== chunkCount) return null;

    let json = '';
    for (let i = 0; i < chunkCount; i++) {
      const chunk = chunkMap[`${key}:chunk:${i}`];
      if (typeof chunk !== 'string') return null;
      json += chunk;
    }

    if (meta.byteLength && getUtf8ByteLength_(json) !== Number(meta.byteLength)) {
      console.error(`getCachedJson_ byte length mismatch: key=${key}`);
      return null;
    }

    return JSON.parse(json);
  } catch (e) {
    console.error('getCachedJson_ error:', e);
    return null;
  }
}

/**
 * JSONデータを分割キャッシュへ保存
 * @param {string} key
 * @param {*} value
 * @param {number=} ttlSeconds
 * @returns {boolean}
 */
function putCachedJson_(key, value, ttlSeconds) {
  try {
    const cache = getLibraryCache_();
    const ttl = ttlSeconds || CACHE_CONFIG.TTL_SECONDS;
    const json = JSON.stringify(value);
    const chunks = splitUtf8ByByteLimit_(json, CACHE_CONFIG.CHUNK_BYTE_LIMIT);
    const chunkCount = chunks.length;
    const totalByteLength = getUtf8ByteLength_(json);
    const payload = {};
    payload[getCacheMetaKey_(key)] = JSON.stringify({ chunkCount, byteLength: totalByteLength });

    for (let i = 0; i < chunkCount; i++) {
      const chunk = chunks[i];
      if (getUtf8ByteLength_(chunk) > CACHE_CONFIG.CHUNK_BYTE_LIMIT) {
        throw new Error(`Cache chunk exceeds byte limit: key=${key} chunk=${i}`);
      }
      payload[`${key}:chunk:${i}`] = chunk;
    }

    clearCachedJson_(key);
    cache.putAll(payload, ttl);

    const restored = getCachedJson_(key);
    if (JSON.stringify(restored) !== json) {
      clearCachedJson_(key);
      throw new Error(`Cache round-trip verification failed: key=${key}`);
    }
    return true;
  } catch (e) {
    console.error(`putCachedJson_ error: key=${key}`, e);
    return false;
  }
}

/**
 * 分割キャッシュ削除
 * @param {string} key
 */
function clearCachedJson_(key) {
  try {
    const cache = getLibraryCache_();
    const metaKey = getCacheMetaKey_(key);
    const metaText = cache.get(metaKey);

    if (!metaText) {
      cache.remove(metaKey);
      return;
    }

    const meta = JSON.parse(metaText);
    const chunkCount = Number(meta.chunkCount || 0);

    const keys = [metaKey];
    for (let i = 0; i < chunkCount; i++) {
      keys.push(`${key}:chunk:${i}`);
    }
    cache.removeAll(keys);
  } catch (e) {
    console.error('clearCachedJson_ error:', e);
  }
}

/**
 * 図書館検索用キャッシュを破棄
 */
function clearLibrarySearchCache_() {
  clearCachedJson_(CACHE_CONFIG.LIBRARY_DATASET_KEY);
  clearCachedJson_(CACHE_CONFIG.SHELF_DATASET_KEY);
  bumpLibraryDatasetRevision_();
}

function addWebAppPerfDuration_(perf, key, startedAt) {
  if (!perf || !key) return;
  const duration = Math.max(0, Date.now() - Number(startedAt || Date.now()));
  perf[key] = Math.max(0, Number(perf[key] || 0)) + duration;
}

function getOrBuildCachedDataset_(cacheKey, isValid, buildDataset, perf) {
  const datasetStartedAt = Date.now();

  try {
    let stepStartedAt = Date.now();
    const cached = getCachedJson_(cacheKey);
    addWebAppPerfDuration_(perf, 'cacheReadMs', stepStartedAt);
    if (isValid(cached)) {
      if (perf) perf.cacheStatus = 'hit';
      return cached;
    }

    if (perf) perf.cacheStatus = 'miss';
    const lock = LockService.getScriptLock();
    let locked = false;

    try {
      stepStartedAt = Date.now();
      locked = lock.tryLock(CACHE_CONFIG.BUILD_LOCK_WAIT_MS);
      addWebAppPerfDuration_(perf, 'lockWaitMs', stepStartedAt);
      if (!locked) {
        console.warn(`Dataset cache build lock timed out: key=${cacheKey}; returning an uncached fallback`);
        if (perf) perf.cacheStatus = 'miss-lock-timeout';
        stepStartedAt = Date.now();
        const fallbackDataset = buildDataset();
        addWebAppPerfDuration_(perf, 'buildMs', stepStartedAt);
        return fallbackDataset;
      }

      stepStartedAt = Date.now();
      const cachedAfterLock = getCachedJson_(cacheKey);
      addWebAppPerfDuration_(perf, 'cacheReadMs', stepStartedAt);
      if (isValid(cachedAfterLock)) {
        if (perf) perf.cacheStatus = 'hit-after-lock';
        return cachedAfterLock;
      }

      stepStartedAt = Date.now();
      const dataset = buildDataset();
      addWebAppPerfDuration_(perf, 'buildMs', stepStartedAt);
      if (isValid(dataset)) {
        stepStartedAt = Date.now();
        putCachedJson_(cacheKey, dataset, CACHE_CONFIG.TTL_SECONDS);
        addWebAppPerfDuration_(perf, 'cacheWriteMs', stepStartedAt);
      }
      if (perf) perf.cacheStatus = 'miss-built';
      return dataset;
    } finally {
      if (locked) lock.releaseLock();
    }
  } finally {
    addWebAppPerfDuration_(perf, 'datasetMs', datasetStartedAt);
  }
}

/**
 * genre_master からジャンル分類マスタを構築
 * A列: 小ジャンル
 * B列: 大ジャンル
 * C列: 使用可否
 *
 * @returns {{
 *   genreToCategory: Object<string, string>,
 *   options: {
 *     story: string[],
 *     theme: string[],
 *     mood: string[],
 *     status: string[]
 *   }
 * }}
 */
function getGenreMasterData_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(CONFIG.SHEETS.GENRE_MASTER);
  if (!sheet) {
    console.error(`シート「${CONFIG.SHEETS.GENRE_MASTER}」が見つかりません。`);
    return {
      genreToCategory: {},
      options: { story: [], theme: [], mood: [], status: [] }
    };
  }

  const lastRow = sheet.getLastRow();
  if (lastRow <= 1) {
    return {
      genreToCategory: {},
      options: { story: [], theme: [], mood: [], status: [] }
    };
  }

  const values = sheet.getRange(2, 1, lastRow - 1, 3).getDisplayValues();

  const genreToCategory = {};
  const options = {
    story: [],
    theme: [],
    mood: [],
    status: []
  };

  values.forEach(row => {
    const genre = String(row[0] || '').trim();
    const category = String(row[1] || '').trim();
    const enabledRaw = String(row[2] || '').trim().toLowerCase();

    if (!genre || !category) return;
    if (!['true', '1', 'yes', 'on', '有効', 'enable', 'enabled'].includes(enabledRaw)) return;

    genreToCategory[genre] = category;

    switch (category) {
      case 'ストーリー':
        options.story.push(genre);
        break;
      case '題材':
        options.theme.push(genre);
        break;
      case '雰囲気':
        options.mood.push(genre);
        break;
      case '状況':
        options.status.push(genre);
        break;
    }
  });

  return { genreToCategory, options };
}

/**
 * 出版社候補を取得（データ!B2:B）
 * @returns {string[]}
 */
function getPublisherOptions_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(CONFIG.SHEETS.DATA);
  if (!sheet) {
    console.error(`シート「${CONFIG.SHEETS.DATA}」が見つかりません。`);
    return [];
  }

  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];

  const values = sheet.getRange(2, 2, lastRow - 1, 1).getDisplayValues();
  return values
    .map(r => String(r[0] || '').trim())
    .filter(v => v !== '');
}

/**
 * サジェストAPIの空レスポンスを返す
 * @returns {{titles: string[], yomis: string[], authors: string[], genres: string[]}}
 */
function buildEmptySuggestData_() {
  return {
    titles: [],
    yomis: [],
    authors: [],
    genres: []
  };
}

/**
 * 詳細検索オプションAPIの空レスポンスを返す
 * @returns {{
 *   publishers: string[],
 *   storyGenres: string[],
 *   themeGenres: string[],
 *   moodGenres: string[],
 *   statusGenres: string[],
 *   releaseYears: string[]
 * }}
 */
function buildEmptyAdvancedSearchOptions_() {
  return {
    publishers: [],
    storyGenres: [],
    themeGenres: [],
    moodGenres: [],
    statusGenres: [],
    releaseYears: []
  };
}

/**
 * dataset.suggest をWebアプリ返却用に安全整形する
 * @param {Object} dataset
 * @returns {{titles: string[], yomis: string[], authors: string[], genres: string[]}}
 */
function buildSuggestDataPayload_(dataset) {
  const suggest = dataset && dataset.suggest ? dataset.suggest : {};
  return {
    titles : Array.isArray(suggest.titles) ? suggest.titles : [],
    yomis  : Array.isArray(suggest.yomis) ? suggest.yomis : [],
    authors: Array.isArray(suggest.authors) ? suggest.authors : [],
    genres : Array.isArray(suggest.genres) ? suggest.genres : []
  };
}

/**
 * dataset.advancedOptions をWebアプリ返却用に安全整形する
 * @param {Object} dataset
 * @returns {{
 *   publishers: string[],
 *   storyGenres: string[],
 *   themeGenres: string[],
 *   moodGenres: string[],
 *   statusGenres: string[],
 *   releaseYears: string[]
 * }}
 */
function buildAdvancedSearchOptionsPayload_(dataset) {
  const advanced = dataset && dataset.advancedOptions ? dataset.advancedOptions : {};
  return {
    publishers : Array.isArray(advanced.publishers) ? advanced.publishers : [],
    storyGenres: Array.isArray(advanced.storyGenres) ? advanced.storyGenres : [],
    themeGenres: Array.isArray(advanced.themeGenres) ? advanced.themeGenres : [],
    moodGenres : Array.isArray(advanced.moodGenres) ? advanced.moodGenres : [],
    statusGenres: Array.isArray(advanced.statusGenres) ? advanced.statusGenres : [],
    releaseYears: Array.isArray(advanced.releaseYears) ? advanced.releaseYears : []
  };
}

/**
 * dataset.index から件数プレビュー用の軽量インデックスだけを返す
 * @param {Object} dataset
 * @returns {Object[]}
 */
function buildPreviewIndexPayload_(dataset) {
  const index = dataset && Array.isArray(dataset.index) ? dataset.index : [];

  return index.map(item => ({
    title: String(item && item.title || ''),
    yomi: String(item && item.yomi || ''),
    author: String(item && item.author || ''),
    searchKey: String(item && item.searchKey || ''),
    publisher: String(item && item.publisher || ''),
    releasedYm: Number(item && item.releasedYm || 0),
    genres: {
      story: Array.isArray(item && item.genres && item.genres.story) ? item.genres.story : [],
      theme: Array.isArray(item && item.genres && item.genres.theme) ? item.genres.theme : [],
      mood: Array.isArray(item && item.genres && item.genres.mood) ? item.genres.mood : [],
      status: Array.isArray(item && item.genres && item.genres.status) ? item.genres.status : []
    }
  }));
}

/**
 * PWAの「気分で開く」用に、ジャンルカテゴリ別の件数だけを返す。
 * 全件プレビューインデックスより小さく、初期表示のチップ生成に必要な情報に絞る。
 *
 * @param {{index:Object[]}=} dataset
 * @returns {{story:Object<string, number>, theme:Object<string, number>, mood:Object<string, number>, status:Object<string, number>}}
 */
function buildQuickBrowseCountsPayload_(dataset) {
  const counts = {
    story: {},
    theme: {},
    mood: {},
    status: {}
  };
  const index = dataset && Array.isArray(dataset.index) ? dataset.index : [];

  index.forEach(item => {
    const genres = item && item.genres ? item.genres : {};
    Object.keys(counts).forEach(category => {
      const values = Array.isArray(genres[category]) ? genres[category] : [];
      values.forEach(value => {
        const key = String(value || '').trim();
        if (!key) return;
        counts[category][key] = (counts[category][key] || 0) + 1;
      });
    });
  });

  return counts;
}

/**
 * Webアプリの個人用表示設定を保存するScript Propertiesキー。
 * このWebアプリは個人利用かつ executeAs USER_DEPLOYING のため、アプリ単位設定として扱う。
 */
const WEBAPP_PREF_RESULT_VIEW_MODE_KEY = 'webapp.pref.resultViewMode';
const WEBAPP_RESULT_VIEW_MODES = ['card', 'list', 'shelf'];

function normalizeWebAppResultViewMode_(mode) {
  return WEBAPP_RESULT_VIEW_MODES.includes(mode) ? mode : 'card';
}

function getWebAppUserPreferences_() {
  try {
    const props = PropertiesService.getScriptProperties();
    return {
      resultViewMode: normalizeWebAppResultViewMode_(props.getProperty(WEBAPP_PREF_RESULT_VIEW_MODE_KEY))
    };
  } catch (e) {
    console.warn('getWebAppUserPreferences_ error:', e);
    return {
      resultViewMode: 'card'
    };
  }
}

/**
 * Webアプリ初期表示用データをまとめて返す
 * - サジェスト
 * - 詳細検索ドロップダウン候補
 * - 件数プレビュー用軽量インデックス
 * - 表示設定
 *
 * 目的:
 * 初期表示時の google.script.run を3本から1本に統合し、
 * RPC回数と getLibraryDataset_() 呼び出し回数を削減する。
 *
 * @returns {{
 *   suggest: {titles: string[], yomis: string[], authors: string[], genres: string[]},
 *   advancedOptions: {
 *     publishers: string[],
 *     storyGenres: string[],
 *     themeGenres: string[],
 *     moodGenres: string[],
 *     statusGenres: string[],
 *     releaseYears: string[]
 *   },
 *   previewIndex: Object[],
 *   datasetRevision: string,
 *   userPreferences: {resultViewMode: string}
 * }}
 */
function getInitialSearchData() {
  try {
    const dataset = getLibraryDataset_();

    return {
      suggest: buildSuggestDataPayload_(dataset),
      advancedOptions: buildAdvancedSearchOptionsPayload_(dataset),
      previewIndex: buildPreviewIndexPayload_(dataset),
      datasetRevision: getLibraryDatasetRevision_(),
      userPreferences: getWebAppUserPreferences_()
    };
  } catch (e) {
    console.error('getInitialSearchData error:', e);
    return {
      suggest: buildEmptySuggestData_(),
      advancedOptions: buildEmptyAdvancedSearchOptions_(),
      previewIndex: [],
      datasetRevision: getLibraryDatasetRevision_(),
      userPreferences: getWebAppUserPreferences_()
    };
  }
}

/**
 * PWA(JSONP)向け初期表示用データを返す。
 * 件数プレビュー用インデックスは全件分の転送が重いため、PWAでは初期ロードから外す。
 * 入力中の件数確認は countPreview API で必要時だけ行う。
 *
 * @returns {{
 *   suggest: {titles: string[], yomis: string[], authors: string[], genres: string[]},
 *   advancedOptions: {
 *     publishers: string[],
 *     storyGenres: string[],
 *     themeGenres: string[],
 *     moodGenres: string[],
 *     statusGenres: string[],
 *     releaseYears: string[]
 *   },
 *   previewIndex: Object[],
 *   userPreferences: {resultViewMode: string}
 * }}
 */
function getInitialSearchDataForPwa_() {
  try {
    const dataset = getLibraryDataset_();

    return {
      suggest: buildSuggestDataPayload_(dataset),
      advancedOptions: buildAdvancedSearchOptionsPayload_(dataset),
      previewIndex: [],
      quickBrowseCounts: buildQuickBrowseCountsPayload_(dataset),
      datasetRevision: getLibraryDatasetRevision_(),
      userPreferences: getWebAppUserPreferences_()
    };
  } catch (e) {
    console.error('getInitialSearchDataForPwa_ error:', e);
    return {
      suggest: buildEmptySuggestData_(),
      advancedOptions: buildEmptyAdvancedSearchOptions_(),
      previewIndex: [],
      quickBrowseCounts: buildQuickBrowseCountsPayload_(null),
      datasetRevision: getLibraryDatasetRevision_(),
      userPreferences: getWebAppUserPreferences_()
    };
  }
}

/**
 * 詳細検索のドロップダウン候補を返す
 * @returns {{
 *   publishers: string[],
 *   storyGenres: string[],
 *   themeGenres: string[],
 *   moodGenres: string[],
 *   statusGenres: string[],
 *   releaseYears: string[]
 * }}
 */
function getAdvancedSearchOptions() {
  try {
    const dataset = getLibraryDataset_();
    return buildAdvancedSearchOptionsPayload_(dataset);
  } catch (e) {
    console.error('getAdvancedSearchOptions error:', e);
    return buildEmptyAdvancedSearchOptions_();
  }
}

/**
 * 件数プレビュー用の軽量インデックスを返す
 * 実検索と同じ条件判定に使う最小限の項目だけを返す
 * @returns {Object[]}
 */
function getPreviewIndex() {
  try {
    const dataset = getLibraryDataset_();
    return buildPreviewIndexPayload_(dataset);
  } catch (e) {
    console.error('getPreviewIndex error:', e);
    return [];
  }
}


/**
 * 件数プレビュー用の正確な件数を返す
 * 実検索と同じ条件判定を使い、件数だけ返す
 * @returns {number}
 */
function countPreviewMatchesAuthoritative(
  keyword, title, yomi, author, publisher, story, theme, mood, status,
  releasedFromYear, releasedFromMonth, releasedToYear, releasedToMonth
) {
  try {
    const dataset = getLibraryDataset_();
    const rows = dataset.rows || [];
    const index = dataset.index || [];

    if (!rows.length) return 0;

    const criteria = buildServerSearchCriteria_(
      keyword, title, yomi, author, publisher, story, theme, mood, status,
      releasedFromYear, releasedFromMonth, releasedToYear, releasedToMonth
    );
    let count = 0;

    for (let i = 0; i < rows.length; i++) {
      if (matchesSearchCriteria_(index[i], criteria)) {
        count++;
      }
    }

    return count;
  } catch (e) {
    console.error('countPreviewMatchesAuthoritative error:', e);
    return 0;
  }
}

/**
 * Hanmoto画像URLをISBNから組み立てる。
 * 存在確認はしない。実表示可否はブラウザ側の img.onerror に任せる。
 *
 * @param {*} isbn
 * @param {number=} size
 * @returns {string}
 */
function buildHanmotoImageUrlFromIsbn_(isbn, size) {
  const safeIsbn = normalizeIsbn13ForImage_(isbn);
  if (!safeIsbn) return '';

  const imageSize = Number(size) === 600 ? 600 : 400;
  return `https://hanmoto.com/bd/img/${safeIsbn}_${imageSize}.jpg`;
}

/**
 * ISBNから従来互換のHanmoto 400画像URLを組み立てる。
 * @param {string} isbn
 * @returns {string}
 */
function buildImageUrlFromIsbn_(isbn) {
  return buildHanmotoImageUrlFromIsbn_(isbn, 400) || NO_IMAGE_URL;
}

/**
 * FALLBACK_IMAGE_URLとして使えるURL文字列に正規化する。
 * NO_IMAGE_URLはfallbackとして保存されていても無視する。
 *
 * @param {*} value
 * @returns {string}
 */
function normalizeBookFallbackImageUrl_(value) {
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

function normalizeReleasedYm_(value) {
  const s = String(value || '').trim().normalize('NFKC');
  if (!s) return 0;

  let m = s.match(/^(\d{4})年\s*(\d{1,2})月$/);
  if (m) {
    const y = Number(m[1]);
    const mo = Number(m[2]);
    if (mo < 1 || mo > 12) return 0;
    return y * 100 + mo;
  }

  m = s.match(/^(\d{4})-(\d{2})$/);
  if (m) {
    const y = Number(m[1]);
    const mo = Number(m[2]);
    if (mo < 1 || mo > 12) return 0;
    return y * 100 + mo;
  }

  return 0;
}
/**
 * 行データをWebアプリ返却用オブジェクトへ変換
 * @param {string[][]} rows
 * @param {Object[]=} indexData
 * @param {{compact?: boolean, includeImages?: boolean}=} options
 * @returns {Object[]}
 */
function mapRowsToBooks_(rows, indexData, options) {
  const compact = Boolean(options && options.compact);
  const includeImages = !(options && options.includeImages === false);
  const hasRowOffset = options && Number.isFinite(Number(options.rowOffset));
  const rowOffset = hasRowOffset ? Number(options.rowOffset) : 0;

  return rows.map((row, i) => {
    const isbn = normalizeIsbn_(row[CONFIG.IDX.ISBN]);
    const idx = Array.isArray(indexData) ? indexData[i] : null;
    const summary = row[CONFIG.IDX.SUMMARY] || '';

    const book = {
      title    : row[CONFIG.IDX.TITLE]     || '',
      author   : row[CONFIG.IDX.AUTHOR]    || '',
      publisher: row[CONFIG.IDX.PUBLISHER] || '',
      shelf    : row[CONFIG.IDX.SHELF]     || '',
      location : row[CONFIG.IDX.LOCATION]  || '',
      released : row[CONFIG.IDX.RELEASED]  || '',
      price    : row[CONFIG.IDX.PRICE]     || '',
      brand    : row[CONFIG.IDX.BRAND]     || '',
      isbn     : isbn,
      memo     : row[CONFIG.IDX.MEMO]      || '',
      yomi     : row[CONFIG.IDX.YOMIGANA]  || '',
      genre         : row[CONFIG.IDX.GENRE]     || '',
      genreMeta     : idx ? (idx.genreMeta || []) : [],
      seriesKeyAuto   : idx ? (idx.seriesKeyAuto || '') : '',
      seriesCount     : idx ? Number(idx.seriesCount || 0) : 0,
      seriesSearchTitle: idx ? (idx.seriesSearchTitle || '') : '',
      isExtraSeries   : idx ? Boolean(idx.isExtraSeries) : false,
      volume          : idx ? (idx.volume || 0) : 0,
      ownedMaxVolume  : idx ? (idx.ownedMaxVolume || 0) : 0,
      detailLoaded    : true
    };

    if (hasRowOffset) {
      book.rowIndex = rowOffset + i;
    }

    if (includeImages) {
      book.img = buildHanmotoImageUrlFromIsbn_(isbn, 600);
      book.img400 = buildHanmotoImageUrlFromIsbn_(isbn, 400);
      book.fallbackImg = normalizeBookFallbackImageUrl_(row[CONFIG.IDX.FALLBACK_IMAGE_URL]);
      book.fallbackImageSource = row[CONFIG.IDX.FALLBACK_IMAGE_SOURCE] || '';
    }

    if (!compact) {
      book.summary = summary;
      book.links = idx ? (idx.links || null) : null;
    }

    return book;
  });
}

function isSensitiveIndexItem_(idx) {
  const meta = Array.isArray(idx && idx.genreMeta) ? idx.genreMeta : [];
  return meta.some(item => item && item.category === 'theme' && item.name === '18禁');
}

function isSensitiveGenreText_(genreText) {
  return String(genreText || '')
    .split(',')
    .map(value => value.trim())
    .some(value => value === '18禁');
}

/**
 * PWA本棚表示専用の軽量データへ変換する。
 * 詳細情報はモーダルを開いた時に1冊ずつ取得する。
 * 画像URLはクライアント側でISBNから組み立て、初回JSONPは文字データ優先にする。
 *
 * @param {string[][]} rows
 * @param {Object[]=} indexData
 * @returns {Object[]}
 */
function mapRowsToShelfBooks_(rows, indexData, rowOffset) {
  const offset = Math.max(0, Number(rowOffset || 0));

  return rows.map((row, i) => {
    const isbn = normalizeIsbn_(row[CONFIG.IDX.ISBN]);
    const idx = Array.isArray(indexData) ? indexData[i] : null;
    const isSensitive = idx
      ? isSensitiveIndexItem_(idx)
      : isSensitiveGenreText_(row[CONFIG.IDX.GENRE]);
    const book = {
      rowIndex: offset + i,
      detailLoaded: false,
      title: row[CONFIG.IDX.TITLE] || '',
      isbn,
      shelf: row[CONFIG.IDX.SHELF] || '',
      location: row[CONFIG.IDX.LOCATION] || '',
      isSensitive
    };

    if (isSensitive) {
      book.fallbackImg = normalizeBookFallbackImageUrl_(row[CONFIG.IDX.FALLBACK_IMAGE_URL]);
      book.fallbackImageSource = row[CONFIG.IDX.FALLBACK_IMAGE_SOURCE] || '';
    }

    return book;
  });
}

function buildBookshelfLiteDataset_() {
  const rows = loadMainBookData_();
  const books = mapRowsToShelfBooks_(rows || [], null, 0);
  return {
    books,
    total: books.length
  };
}

function getBookshelfLiteDataset_() {
  const cacheKey = CACHE_CONFIG.SHELF_DATASET_KEY;
  return getOrBuildCachedDataset_(
    cacheKey,
    isBookshelfLiteDatasetValid_,
    buildBookshelfLiteDataset_
  );
}

function isBookshelfLiteDatasetValid_(dataset) {
  return Boolean(
    dataset &&
    Array.isArray(dataset.books) &&
    Number(dataset.total || 0) === dataset.books.length &&
    dataset.books.every(book =>
      book &&
      typeof book.title === 'string' &&
      typeof book.shelf === 'string' &&
      typeof book.location === 'string' &&
      Object.prototype.hasOwnProperty.call(book, 'rowIndex')
    )
  );
}

/**
 * 通常検索用の横断検索キーを作る
 * title / yomi / author を連結した正規化済み文字列
 *
 * @param {string} title
 * @param {string} yomi
 * @param {string} author
 * @returns {string}
 */
function buildSearchKey_(title, yomi, author) {
  return [
    normalizeKana(title || ''),
    normalizeKana(yomi || ''),
    normalizeKana(author || '')
  ].join(' ');
}

function titleYomiMixedMatch_(query, title, yomi) {
  const q = normalizeKana(query || '');
  if (!q) return true;

  const t = normalizeKana(title || '');
  const y = normalizeKana(yomi || '');

  if ((t && t.includes(q)) || (y && y.includes(q))) return true;
  if (!t || !y) return false;

  const chunks = splitMixedSearchQuery_(q);
  if (chunks.length <= 1) return false;

  let progress = 0;

  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];
    const target = chunk.type === 'kana' ? y : t;
    const match = findChunkMixedMatch_(chunk.text, target, progress);

    if (!match) return false;

    progress = match.progress;
  }

  return true;
}

function splitMixedSearchQuery_(query) {
  const q = normalizeKana(query || '');
  if (!q) return [];

  const chunks = [];
  let currentType = '';
  let currentText = '';

  for (let i = 0; i < q.length; i++) {
    const char = q[i];
    const type = isKanaChar_(char) ? 'kana' : 'title';

    if (currentText && type !== currentType) {
      chunks.push({ type: currentType, text: currentText });
      currentText = '';
    }

    currentType = type;
    currentText += char;
  }

  if (currentText) {
    chunks.push({ type: currentType, text: currentText });
  }

  return chunks;
}

function isKanaChar_(char) {
  return /^[\u3041-\u3096\u30fc]$/.test(char || '');
}

function findChunkMixedMatch_(chunk, text, minProgress) {
  if (!chunk || !text) return null;

  const step = 1 / Math.max(text.length, 1);

  for (let index = text.indexOf(chunk); index >= 0; index = text.indexOf(chunk, index + 1)) {
    const progress = index * step;
    if (progress + 0.000001 < minProgress) continue;

    return {
      index,
      progress,
      progressAfter: (index + chunk.length) * step
    };
  }

  return null;
}

function keywordMixedMatch_(query, idx) {
  const q = normalizeKana(query || '');
  if (!q) return true;
  if (idx && idx.searchKey && idx.searchKey.includes(q)) return true;
  return titleYomiMixedMatch_(q, idx && idx.title, idx && idx.yomi);
}

function buildServerSearchCriteria_(
  keyword, title, yomi, author, publisher, story, theme, mood, status,
  releasedFromYear, releasedFromMonth, releasedToYear, releasedToMonth
) {
  return {
    nKeyword: normalizeKana(keyword || ''),
    nTitle: normalizeKana(title || ''),
    nYomi: normalizeKana(yomi || ''),
    nAuthor: normalizeKana(author || ''),
    selectedPublisher: String(publisher || '').trim(),
    selectedStory: String(story || '').trim(),
    selectedTheme: String(theme || '').trim(),
    selectedMood: String(mood || '').trim(),
    selectedStatus: String(status || '').trim(),
    fromYm: releasedFromYear
      ? normalizeReleasedYm_(`${releasedFromYear}-${releasedFromMonth || '01'}`)
      : 0,
    toYm: releasedToYear
      ? normalizeReleasedYm_(`${releasedToYear}-${releasedToMonth || '12'}`)
      : 0
  };
}

function getDefaultSearchIndexItem_() {
  return {
    title: '',
    yomi: '',
    author: '',
    searchKey: '',
    publisher: '',
    releasedYm: 0,
    genres: { story: [], theme: [], mood: [], status: [] }
  };
}

function matchesSearchCriteria_(idx, criteria) {
  const item = idx || getDefaultSearchIndexItem_();
  const c = criteria || buildServerSearchCriteria_();

  const keywordMatch = !c.nKeyword || keywordMixedMatch_(c.nKeyword, item);
  const titleMatch = !c.nTitle || titleYomiMixedMatch_(c.nTitle, item.title, item.yomi);
  const yomiMatch = !c.nYomi || titleYomiMixedMatch_(c.nYomi, item.title, item.yomi);
  const authorMatch = !c.nAuthor || (item.author && item.author.includes(c.nAuthor));
  const publisherMatch = !c.selectedPublisher || item.publisher === c.selectedPublisher;
  const storyMatch = !c.selectedStory || (item.genres.story || []).includes(c.selectedStory);
  const themeMatch = !c.selectedTheme || (item.genres.theme || []).includes(c.selectedTheme);
  const moodMatch = !c.selectedMood || (item.genres.mood || []).includes(c.selectedMood);
  const statusMatch = !c.selectedStatus || (item.genres.status || []).includes(c.selectedStatus);

  const releasedYm = Number(item.releasedYm || 0);
  const releasedFromMatch = !c.fromYm || (releasedYm && releasedYm >= c.fromYm);
  const releasedToMatch = !c.toYm || (releasedYm && releasedYm <= c.toYm);

  return Boolean(
    keywordMatch &&
    titleMatch &&
    yomiMatch &&
    authorMatch &&
    publisherMatch &&
    storyMatch &&
    themeMatch &&
    moodMatch &&
    statusMatch &&
    releasedFromMatch &&
    releasedToMatch
  );
}


/**
 * 検索・サジェスト用データセットを構築
 *
 * @returns {{
 *   rows: string[][],
 *   index: Object[],
 *   suggest: {
 *     titles: string[],
 *     yomis: string[],
 *     authors: string[],
 *     genres: string[]
 *   },
 *   advancedOptions: {
 *     publishers: string[],
 *     storyGenres: string[],
 *     themeGenres: string[],
 *     moodGenres: string[],
 *     statusGenres: string[]
 *   }
 * }}
 */
function buildLibraryDataset_() {
  const rows = loadMainBookData_();
  const genreMaster = getGenreMasterData_();
  const publisherOptions = getPublisherOptions_();

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

  const seriesMaxMap = buildSeriesMaxVolumeMap_({ index });
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

  const seriesMetaMap = new Map();
  seriesGroupMap.forEach((group, key) => {
    seriesMetaMap.set(key, {
      count: group.indices.length,
      searchTitle: chooseSeriesSearchTitle_(group.titles)
    });
  });

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

  const sortedReleaseYears = Array.from(releaseYearSet).sort((a, b) => a - b);
  let releaseYears = [];

  if (sortedReleaseYears.length) {
    const minYear = sortedReleaseYears[0] - 1;
    const maxYear = sortedReleaseYears[sortedReleaseYears.length - 1] + 2;
    for (let y = minYear; y <= maxYear; y++) {
      releaseYears.push(String(y));
    }
  }

  return {
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
}




function extractVolumeNumber(title) {
  if (!title) return 0;
  const t = String(title).normalize('NFKC');
  let m;

  m = t.match(/第\s*(\d+)\s*巻/i);
  if (m) return Number(m[1]);
  m = t.match(/(\d+)\s*巻/i);
  if (m) return Number(m[1]);
  m = t.match(/[\(\（]\s*(\d+)\s*[\)\）]/);
  if (m) return Number(m[1]);
  m = t.match(/\s(\d+)\s*$/);
  if (m) return Number(m[1]);

  return 0;
}

function buildSeriesDisplayTitle_(title) {
  if (!title) return '';

  let t = extractPrimarySeriesTitle_(title);

  t = String(t).normalize('NFKC').trim();

  // 末尾の版種・特典語を除去
  t = t.replace(/\s*(特装版|限定版|通常版|小冊子付き|ドラマCD付き|CD付き|Blu-ray付き|DVD付き|フィギュア付き|特典付き)\s*$/i, '');

  // 末尾の巻数表現を除去
  t = t.replace(/\s*第\s*\d+\s*巻\s*$/i, '');
  t = t.replace(/\s*\d+\s*巻\s*$/i, '');
  t = t.replace(/\s*[\(\（]\s*\d+\s*[\)\）]\s*$/i, '');
  t = t.replace(/\s+\d+\s*$/i, '');

  // 語尾ドット除去
  t = t.replace(/[\.．。]+$/g, '');

  // 空白整理
  t = t.replace(/\s+/g, ' ').trim();

  return t;
}





/**
 * 外部検索に使うシリーズ名をタイトルから生成する。
 * generateSeriesKeyAuto と同系統の巻数除去を行うが、カタカナ→ひらがな変換はしない。
 *
 * @param {string} title
 * @returns {string}
 */
function buildSeriesSearchTitle_(title) {
  if (!title) return '';

  let t = extractPrimarySeriesTitle_(title);

  t = String(t).normalize('NFKC');
  t = t.replace(/　/g, ' ');
  t = t.trim();

  // 版種・付属品系の語を除去
  t = t.replace(
    /(特装版|限定版|通常版|小冊子付き|ドラマCD付き|CD付き|Blu-ray付き|DVD付き|フィギュア付き|特典付き)/gi,
    ''
  );

  // 巻数・号数・集数などの末尾除去
  t = t.replace(/\s*第\s*\d+\s*巻\s*.*$/i, '');
  t = t.replace(/\s*第\s*\d+\s*集\s*.*$/i, '');

  t = t.replace(/\s*[〈<]\s*\d+\s*[〉>]\s*.*$/i, '');
  t = t.replace(/\s*[〈<]\s*第?\s*[一二三四五六七八九十百千〇零\d]+\s*集\s*[〉>]\s*.*$/i, '');

  t = t.replace(/\s*\d+\s*巻\s*.*$/i, '');
  t = t.replace(/\s*[\(\（]\s*\d+\s*[\)\）]\s*.*$/i, '');

  t = t.replace(/\s+v(?:ol(?:ume)?\.?|\.?)\s*\d+\s*.*$/i, '');
  t = t.replace(/\s*#\s*\d+\s*.*$/i, '');
  t = t.replace(/\s*×\s*\d+\s*.*$/i, '');

  t = t.replace(/\s*[上中下]\s*巻\s*.*$/i, '');
  t = t.replace(/\s+[上中下]\s*$/i, '');

  t = t.replace(/\s+\d+\s*.*$/i, '');

  // 語尾のドットと区切り記号を整理。ただし No.6 / D.Gray-man などの中間ドットは残す。
  t = t.replace(/[\.．。]+$/g, '');
  t = t.replace(/\s*[:：]\s*$/g, '');
  t = t.replace(/\s+/g, ' ').trim();

  return t;
}

/**
 * 同一シリーズ内のタイトル群から外部検索向けシリーズ名を選ぶ。
 * @param {string[]} titles
 * @returns {string}
 */
function chooseSeriesSearchTitle_(titles) {
  const candidates = (Array.isArray(titles) ? titles : [])
    .map(title => buildSeriesSearchTitle_(title))
    .map(title => String(title || '').trim())
    .filter(title => title !== '');

  if (!candidates.length) return '';

  const unique = Array.from(new Set(candidates));
  unique.sort((a, b) => {
    const aLen = a.replace(/\s/g, '').length;
    const bLen = b.replace(/\s/g, '').length;
    if (aLen !== bLen) return aLen - bLen;
    return a.length - b.length;
  });

  return unique[0] || '';
}

/**
 * 本ごとの外部検索リンクを構築する。
 * 複数巻シリーズかつ __extra__ でなければシリーズ検索名を優先する。
 *
 * @param {string} title
 * @param {string} seriesSearchTitle
 * @param {number} seriesCount
 * @param {boolean} isExtraSeries
 * @returns {{googleUrl:string,bellUrl:string,amazonUrl:string}}
 */
function buildBookSearchLinks_(title, seriesSearchTitle, seriesCount, isExtraSeries) {
  const useSeriesTitle = Number(seriesCount || 0) >= 2 && !isExtraSeries && String(seriesSearchTitle || '').trim();
  const searchTitle = useSeriesTitle ? String(seriesSearchTitle).trim() : String(title || '').trim();
  return buildSeriesSearchLinks_(searchTitle);
}

function buildSeriesMaxVolumeMap_(dataset) {
  const map = new Map();
  const list = (dataset && Array.isArray(dataset.index)) ? dataset.index : [];

  list.forEach(item => {
    const key = item && item.seriesKeyAuto;
    const vol = item && item.volume;

    if (!key || !vol) return;

    const current = map.get(key) || 0;
    if (vol > current) {
      map.set(key, vol);
    }
  });

  return map;
}


function getSeriesCandidateList_(dataset) {
  const list = (dataset && Array.isArray(dataset.index)) ? dataset.index : [];
  const map = new Map();

  list.forEach(item => {
    if (!item || !item.seriesKeyAuto || !item.isMainVolume) return;

    const current = map.get(item.seriesKeyAuto);
    const volume = Number(item.volume || 0);

    if (!current || volume > current.latestOwnedVolume) {
      const seriesDisplayTitle = item.seriesDisplayTitle || '';

      map.set(item.seriesKeyAuto, {
        seriesKeyAuto: item.seriesKeyAuto,
        seriesDisplayTitle,
        latestOwnedVolume: volume,
        ownedMaxVolume: Number(item.ownedMaxVolume || 0),
        publisher: item.publisher || '',
        links: buildSeriesSearchLinks_(seriesDisplayTitle)
      });
    }
  });

  return [...map.values()];
}

function buildSeriesSearchLinks_(title) {
  const q = encodeURIComponent(String(title || '').trim());
  return {
    googleUrl : `https://www.google.com/search?q=${q}%20新刊%20発売日`,
    bellUrl   : `https://alert.shop-bell.com/search/?Books=1&BrowseNode=&Title=${q}`,
    amazonUrl : `https://www.amazon.co.jp/s?k=${q}&i=stripbooks`
  };
}

/**
 * キャッシュ付きで検索用データセットを取得
 * @returns {{
 *   rows: string[][],
 *   index: Object[],
 *   suggest: Object,
 *   advancedOptions: Object
 * }}
 */
function getLibraryDataset_(perf) {
  const cacheKey = CACHE_CONFIG.LIBRARY_DATASET_KEY;
  return getOrBuildCachedDataset_(
    cacheKey,
    isLibraryDatasetValid_,
    buildLibraryDataset_,
    perf
  );
}

function isLibraryDatasetValid_(dataset) {
  return Boolean(
    dataset &&
    Array.isArray(dataset.rows) &&
    Array.isArray(dataset.index) &&
    dataset.suggest &&
    dataset.advancedOptions &&
    dataset.rows.length > 0 &&
    dataset.index.length === dataset.rows.length &&
    dataset.index.every(idx =>
      idx &&
      typeof idx.searchKey === 'string' &&
      typeof idx.seriesDisplayTitle === 'string' &&
      typeof idx.seriesSearchTitle === 'string' &&
      typeof idx.seriesCount === 'number' &&
      typeof idx.links === 'object'
    )
  );
}

/**
 * 互換API: 旧来のタイトル/作者検索。
 * 現行Web画面は searchBooksSimple / searchBooksAdvanced を使う。
 *
 * 第1引数: タイトル/読み仮名
 * 第2引数: 作者
 */
function searchBooks(title, author) {
  try {
    const dataset = getLibraryDataset_();
    const rows = dataset.rows || [];
    const index = dataset.index || [];

    if (!rows.length) return [];

    const nTitle = normalizeKana(title || '');
    const nAuthor = normalizeKana(author || '');

    const matchedRows = [];
    const matchedIndex = [];

    for (let i = 0; i < rows.length; i++) {
      const idx = index[i] || { title: '', yomi: '', author: '' };

      let titleMatch = false;
      if (nTitle) {
        titleMatch =
          (idx.title && idx.title.includes(nTitle)) ||
          (idx.yomi && idx.yomi.includes(nTitle));
      } else {
        titleMatch = true;
      }

      let authorMatch = false;
      if (nAuthor) {
        authorMatch = !!(idx.author && idx.author.includes(nAuthor));
      } else {
        authorMatch = true;
      }

      if (titleMatch && authorMatch) {
        matchedRows.push(rows[i]);
        matchedIndex.push(idx);
      }
    }

    return mapRowsToBooks_(matchedRows, matchedIndex);
  } catch (e) {
    console.error('searchBooks error:', e);
    return [];
  }
}

/**
 * 現行WebアプリAPI: 通常検索。
 * キーワードをタイトル・読み仮名・作者に対して部分一致
 * @param {string} keyword
 * @returns {Object[]}
 */
function searchBooksSimple(keyword, perf) {
  try {
    const dataset = getLibraryDataset_(perf);
    const rows = dataset.rows || [];
    const index = dataset.index || [];

    if (perf) perf.sourceCount = rows.length;

    if (!rows.length) {
      if (perf) perf.resultCount = 0;
      return [];
    }

    const filterStartedAt = Date.now();
    const nKeyword = normalizeKana(keyword || '');

    if (!nKeyword) {
      addWebAppPerfDuration_(perf, 'filterMs', filterStartedAt);
      const mapStartedAt = Date.now();
      const allBooks = mapRowsToBooks_(rows, index, { compact: true });
      addWebAppPerfDuration_(perf, 'mapMs', mapStartedAt);
      if (perf) perf.resultCount = allBooks.length;
      return allBooks;
    }

    const matchedRows = [];
    const matchedIndex = [];

    for (let i = 0; i < rows.length; i++) {
      const idx = index[i] || { title: '', yomi: '', searchKey: '' };

      if (keywordMixedMatch_(nKeyword, idx)) {
        matchedRows.push(rows[i]);
        matchedIndex.push(idx);
      }
    }

    addWebAppPerfDuration_(perf, 'filterMs', filterStartedAt);
    const mapStartedAt = Date.now();
    const books = mapRowsToBooks_(matchedRows, matchedIndex, {
      compact: matchedRows.length > 80
    });
    addWebAppPerfDuration_(perf, 'mapMs', mapStartedAt);
    if (perf) perf.resultCount = books.length;
    return books;
  } catch (e) {
    console.error('searchBooksSimple error:', e);
    return [];
  }
}

/**
 * 現行WebアプリAPI: ランダム表示。
 * 全件返却せず、サーバー側で重複なしランダム抽出した件数だけ返す
 * @param {number} count
 * @returns {Object[]}
 */
function getRandomBooks(count, perf) {
  try {
    const dataset = getLibraryDataset_(perf);
    const rows = dataset.rows || [];
    const index = dataset.index || [];

    if (perf) perf.sourceCount = rows.length;

    if (!rows.length) {
      if (perf) perf.resultCount = 0;
      return [];
    }

    const n = normalizeWebAppApiInteger_(count, {
      fallback: 10,
      min: 0,
      max: Math.min(WEBAPP_API_LIMITS_.RANDOM_MAX_COUNT, rows.length)
    });

    if (n <= 0) {
      if (perf) perf.resultCount = 0;
      return [];
    }

    const pickStartedAt = Date.now();
    const used = new Set();
    const pickedRows = [];
    const pickedIndex = [];

    while (pickedRows.length < n) {
      const i = Math.floor(Math.random() * rows.length);
      if (used.has(i)) continue;

      used.add(i);
      pickedRows.push(rows[i]);
      pickedIndex.push(index[i] || {});
    }

    addWebAppPerfDuration_(perf, 'pickMs', pickStartedAt);
    const mapStartedAt = Date.now();
    const books = mapRowsToBooks_(pickedRows, pickedIndex);
    addWebAppPerfDuration_(perf, 'mapMs', mapStartedAt);
    if (perf) perf.resultCount = books.length;
    return books;
  } catch (e) {
    console.error('getRandomBooks error:', e);
    return [];
  }
}

/**
 * 現行WebアプリAPI: 詳細検索。
 * 文字入力欄は部分一致
 * ドロップダウンは完全一致
 * すべてAND
 */
function searchBooksAdvanced(
  keyword, title, yomi, author, publisher, story, theme, mood, status,
  releasedFromYear, releasedFromMonth, releasedToYear, releasedToMonth
) {
  try {
    const dataset = getLibraryDataset_();
    const rows = dataset.rows || [];
    const index = dataset.index || [];

    if (!rows.length) return [];

    const criteria = buildServerSearchCriteria_(
      keyword, title, yomi, author, publisher, story, theme, mood, status,
      releasedFromYear, releasedFromMonth, releasedToYear, releasedToMonth
    );
    const matchedRows = [];
    const matchedIndex = [];

    for (let i = 0; i < rows.length; i++) {
      const idx = index[i] || getDefaultSearchIndexItem_();
      if (matchesSearchCriteria_(idx, criteria)) {
        matchedRows.push(rows[i]);
        matchedIndex.push(idx);
      }
    }

    return mapRowsToBooks_(matchedRows, matchedIndex);
  } catch (e) {
    console.error('searchBooksAdvanced error:', e);
    return [];
  }
}

/**
 * 互換API: サジェスト単体取得。
 * 現行Web画面は getInitialSearchData で初期データとしてまとめて取得する。
 */
function getSuggestData() {
  try {
    const dataset = getLibraryDataset_();
    return buildSuggestDataPayload_(dataset);
  } catch (e) {
    console.error('getSuggestData error:', e);
    return buildEmptySuggestData_();
  }
}

/**
 * 互換API: 全件取得。
 * 現行Web画面の本棚全件表示は searchBooksSimple('') を使う。
 */
function getAllBooks() {
  try {
    const dataset = getLibraryDataset_();
    return mapRowsToBooks_(dataset.rows || [], dataset.index || [], { compact: true });
  } catch (e) {
    console.error('getAllBooks error:', e);
    return [];
  }
}

/**
 * PWA本棚表示向けの軽量全件取得。
 * 全件JSONPで落ちないよう、棚表示に必要な最小項目だけ返す。
 */
function getBookshelfBooks() {
  try {
    const dataset = getBookshelfLiteDataset_();
    return dataset.books || [];
  } catch (e) {
    console.error('getBookshelfBooks error:', e);
    return [];
  }
}

function getBookshelfBooksChunk(offset, limit) {
  try {
    const dataset = getBookshelfLiteDataset_();
    const books = dataset.books || [];
    const total = books.length;
    const start = normalizeWebAppApiInteger_(offset, {
      fallback: 0,
      min: 0,
      max: total
    });
    const size = normalizeWebAppApiInteger_(limit, {
      fallback: WEBAPP_API_LIMITS_.SHELF_CHUNK_DEFAULT_LIMIT,
      min: 1,
      max: WEBAPP_API_LIMITS_.SHELF_CHUNK_MAX_LIMIT
    });
    const end = Math.min(start + size, total);

    return {
      books: books.slice(start, end),
      total,
      offset: start,
      nextOffset: end,
      done: end >= total
    };
  } catch (e) {
    console.error('getBookshelfBooksChunk error:', e);
    return {
      books: [],
      total: 0,
      offset: normalizeWebAppApiInteger_(offset, { fallback: 0, min: 0 }),
      nextOffset: normalizeWebAppApiInteger_(offset, { fallback: 0, min: 0 }),
      done: true,
      error: e && e.message ? e.message : String(e)
    };
  }
}

function getBookDetailByRowIndex(rowIndex) {
  try {
    const dataset = getLibraryDataset_();
    const rows = dataset.rows || [];
    const index = dataset.index || [];
    const targetIndex = Math.floor(Number(rowIndex));

    if (!Number.isFinite(targetIndex) || targetIndex < 0 || targetIndex >= rows.length) {
      throw new Error(`Invalid book row index: ${rowIndex}`);
    }

    const books = mapRowsToBooks_(
      [rows[targetIndex]],
      [index[targetIndex] || {}],
      { includeImages: false, rowOffset: targetIndex }
    );

    return books[0] || null;
  } catch (e) {
    console.error('getBookDetailByRowIndex error:', e);
    return null;
  }
}

function parseBookDetailRowIndexes_(rowIndexes) {
  const seen = {};
  return String(rowIndexes || '')
    .split(/[,\s]+/)
    .map(value => Math.floor(Number(value)))
    .filter(value => Number.isFinite(value) && value >= 0)
    .filter(value => {
      if (seen[value]) return false;
      seen[value] = true;
      return true;
    })
    .slice(0, WEBAPP_API_LIMITS_.BOOK_DETAIL_BATCH_MAX);
}

function getBookDetailsByRowIndexes(rowIndexes) {
  try {
    const targets = parseBookDetailRowIndexes_(rowIndexes);
    if (!targets.length) return [];

    const dataset = getLibraryDataset_();
    const rows = dataset.rows || [];
    const index = dataset.index || [];

    return targets
      .filter(targetIndex => targetIndex < rows.length)
      .map(targetIndex => {
        return mapRowsToBooks_(
          [rows[targetIndex]],
          [index[targetIndex] || {}],
          { includeImages: false, rowOffset: targetIndex }
        )[0] || null;
      })
      .filter(Boolean);
  } catch (e) {
    console.error('getBookDetailsByRowIndexes error:', e);
    return [];
  }
}

/**
 * 現行WebアプリAPI: 同一 series_key_auto の本を目録順で返す。
 * @param {string} seriesKeyAuto
 * @returns {Object[]}
 */
function getBooksBySeriesKey(seriesKeyAuto) {
  try {
    const key = String(seriesKeyAuto || '').trim();
    if (!key) return [];

    const dataset = getLibraryDataset_();
    const rows = dataset.rows || [];
    const index = dataset.index || [];

    const matchedRows = [];
    const matchedIndex = [];

    for (let i = 0; i < index.length; i++) {
      const idx = index[i] || {};
      if (String(idx.seriesKeyAuto || '') !== key) continue;

      matchedRows.push(rows[i]);
      matchedIndex.push(idx);
    }

    return mapRowsToBooks_(matchedRows, matchedIndex);
  } catch (e) {
    console.error('getBooksBySeriesKey error:', e);
    return [];
  }
}

const WEBAPP_JSONP_CALLBACK_PATTERN_ = /^[A-Za-z_$][0-9A-Za-z_$]*(?:\.[A-Za-z_$][0-9A-Za-z_$]*)*$/;
const WEBAPP_JSONP_DEFAULT_CALLBACK_ = '__shumiLibraryJsonpCallback';
const PUBLIC_WEBAPP_JSONP_API_HANDLERS_ = Object.freeze({
  initial: () => getInitialSearchDataForPwa_(),
  suggest: () => getSuggestData(),
  advancedOptions: () => getAdvancedSearchOptions(),
  previewIndex: () => [],
  countPreview: params => countPreviewMatchesAuthoritative(
    params.keyword,
    params.detailTitle,
    params.detailYomi,
    params.detailAuthor,
    params.detailPublisher,
    params.detailStory,
    params.detailTheme,
    params.detailMood,
    params.detailStatus,
    params.detailReleasedFromYear,
    params.detailReleasedFromMonth,
    params.detailReleasedToYear,
    params.detailReleasedToMonth
  ),
  searchSimple: (params, perf) => searchBooksSimple(params.keyword || '', perf),
  searchAdvanced: params => searchBooksAdvanced(
    params.keyword,
    params.detailTitle,
    params.detailYomi,
    params.detailAuthor,
    params.detailPublisher,
    params.detailStory,
    params.detailTheme,
    params.detailMood,
    params.detailStatus,
    params.detailReleasedFromYear,
    params.detailReleasedFromMonth,
    params.detailReleasedToYear,
    params.detailReleasedToMonth
  ),
  random: (params, perf) => getRandomBooks(params.count || 10, perf),
  shelf: () => getBookshelfBooks(),
  shelfChunk: params => getBookshelfBooksChunk(params.offset, params.limit),
  bookDetail: params => getBookDetailByRowIndex(params.rowIndex),
  bookDetails: params => getBookDetailsByRowIndexes(params.rowIndexes || params.rowIndexesCsv || ''),
  series: params => getBooksBySeriesKey(params.seriesKeyAuto || params.seriesKey || '')
});

/**
 * JSONP APIまたはWebアプリHTML入口。
 *
 * `api` パラメータがある場合はGitHub Pages版PWA向けの読み取りAPIとして動作する。
 * `api` がない従来アクセスでは、これまでどおりGAS版HTMLを返す。
 */
function doGet(e) {
  const params = e && e.parameter ? e.parameter : {};
  const apiName = String(params.api || '').trim();

  if (apiName) {
    return handleWebAppJsonpRequest_(apiName, params);
  }

  return HtmlService.createTemplateFromFile('index').evaluate();
}

/**
 * GitHub Pages版PWA向けJSONP APIを返す。
 * @param {string} apiName
 * @param {Object<string, string>} params
 * @returns {GoogleAppsScript.Content.TextOutput}
 */
function handleWebAppJsonpRequest_(apiName, params) {
  const serverStartedAt = Date.now();
  const callback = normalizeWebAppJsonpCallback_(params.callback);
  const decodedParams = decodeWebAppJsonpParams_(params || {});
  const perf = String(decodedParams.perf || '') === '1'
    ? { version: 1 }
    : null;
  const envelope = buildWebAppJsonpEnvelope_(apiName, decodedParams, perf);
  if (perf) {
    perf.serverMs = Math.max(0, Date.now() - serverStartedAt);
    envelope.perf = perf;
  }
  const body = `${callback}(${stringifyForJsonp_(envelope)});`;

  return ContentService
    .createTextOutput(body)
    .setMimeType(ContentService.MimeType.JAVASCRIPT);
}

/**
 * JSONPのURLパラメータを復元する。
 * PWA側は日本語検索語をURLへ直接載せず、`keywordB64` のようなBase64URL値で送る。
 * ここで `B64` 接尾辞を外した通常パラメータ名へ戻す。
 *
 * @param {Object<string, string>} params
 * @returns {Object<string, string>}
 */
function decodeWebAppJsonpParams_(params) {
  const decoded = {};
  const source = params || {};

  Object.keys(source).forEach(key => {
    decoded[key] = source[key];
  });

  Object.keys(source).forEach(key => {
    if (!/B64$/.test(key)) return;

    const targetKey = key.slice(0, -3);
    if (!targetKey) return;

    decoded[targetKey] = decodeWebAppJsonpBase64Url_(source[key]);
  });

  return decoded;
}

/**
 * @param {string} value
 * @returns {string}
 */
function decodeWebAppJsonpBase64Url_(value) {
  try {
    const bytes = Utilities.base64DecodeWebSafe(String(value || ''));
    return Utilities.newBlob(bytes).getDataAsString('UTF-8');
  } catch (e) {
    console.error('decodeWebAppJsonpBase64Url_ error:', e);
    return '';
  }
}

/**
 * JSONP内で安全に埋め込めるJSON文字列を返す。
 * @param {*} value
 * @returns {string}
 */
function stringifyForJsonp_(value) {
  return JSON.stringify(value)
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

/**
 * @param {*} callback
 * @returns {string}
 */
function normalizeWebAppJsonpCallback_(callback) {
  const name = String(callback || '').trim();
  return WEBAPP_JSONP_CALLBACK_PATTERN_.test(name)
    ? name
    : WEBAPP_JSONP_DEFAULT_CALLBACK_;
}

/**
 * @param {string} apiName
 * @param {Object<string, string>} params
 * @returns {{ok:boolean,data:*,error:Object|null}}
 */
function buildWebAppJsonpEnvelope_(apiName, params, perf) {
  try {
    return {
      ok: true,
      data: dispatchWebAppJsonpApi_(apiName, params, perf),
      error: null
    };
  } catch (e) {
    console.error('buildWebAppJsonpEnvelope_ error:', e);
    return {
      ok: false,
      data: null,
      error: {
        message: e && e.message ? e.message : 'API request failed',
        api: String(apiName || '')
      }
    };
  }
}

/**
 * @param {string} apiName
 * @param {Object<string, string>} params
 * @returns {*}
 */
function dispatchWebAppJsonpApi_(apiName, params, perf) {
  const normalizedApiName = String(apiName || '').trim();
  const handler = PUBLIC_WEBAPP_JSONP_API_HANDLERS_[normalizedApiName];
  if (typeof handler !== 'function') {
    throw new Error(`Unknown API: ${apiName}`);
  }
  return handler(params || {}, perf || null);
}





/** Apps Scriptエディタ手動実行専用 / debug */

function debugWebAppApiRegistry_() {
  Logger.log(JSON.stringify(WEB_APP_API_REGISTRY_, null, 2));
}

function debugSeriesMap_(){
  const ds = getLibraryDataset_();
  const map = buildSeriesMaxVolumeMap_(ds);
  Logger.log([...map.entries()].slice(0,30));
}
function debugOwnedMaxVolume_() {
  const ds = getLibraryDataset_();
  Logger.log(ds.index.slice(0, 20).map(v => ({
    seriesKeyAuto: v.seriesKeyAuto,
    volume: v.volume,
    ownedMaxVolume: v.ownedMaxVolume
  })));
}
function debugSeriesCandidateList_() {
  const ds = getLibraryDataset_();
  const list = getSeriesCandidateList_(ds);
  Logger.log(list.slice(0, 30));
}
function debugSeriesCandidateLinks_() {
  const ds = getLibraryDataset_();
  const list = getSeriesCandidateList_(ds);
  Logger.log(list.slice(0, 10));
}
function debugFirstBookLinks_() {
  const ds = getLibraryDataset_();
  Logger.log(ds.index[0]);
}
