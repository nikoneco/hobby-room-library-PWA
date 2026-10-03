(function() {
  'use strict';

  const GAS_JSONP_ENDPOINT = "https://script.google.com/macros/s/AKfycbzAfn1SJqfKCRExekRlBMsbo9w4ZwcLNH_W6OJ-1ekS9LUJudAISNhtaGt6kPzAwEWYeQ/exec";
  const JSONP_TIMEOUT_MS = 60000;
  const SERIES_REQUEST_TIMEOUT_MS = 25000;
  const LOCAL_INDEX_DB_NAME = 'shumiLibrary.localIndex.v1';
  const LOCAL_INDEX_STORE_NAME = 'snapshots';
  const LOCAL_INDEX_ACTIVE_KEY = 'active';
  const LOCAL_INDEX_SCHEMA_VERSION = 7;
  const LOCAL_INDEX_CHECK_INTERVAL_MS = 15 * 60 * 1000;
  const LOCAL_INDEX_CHECK_THROTTLE_MS = 5 * 60 * 1000;
  const LOCAL_SEARCH_REFRESH_GRACE_MS = 250;
  const LIBRARY_REVISION_HEDGE_DELAY_MS = 3000;

  const METHOD_CONFIG = {
    getInitialSearchData: { api: 'initial', argNames: [] },
    getLibraryDatasetRevisionForPwa_: { api: 'libraryRevision', argNames: [] },
    getLocalLibraryIndexForPwa_: { api: 'localIndex', argNames: [] },
    getSuggestData: { api: 'suggest', argNames: [] },
    getAdvancedSearchOptions: { api: 'advancedOptions', argNames: [] },
    getPreviewIndex: { api: 'previewIndex', argNames: [] },
    countPreviewMatchesAuthoritative: {
      api: 'countPreview',
      argNames: [
        'keyword',
        'detailTitle',
        'detailYomi',
        'detailAuthor',
        'detailPublisher',
        'detailStory',
        'detailTheme',
        'detailMood',
        'detailStatus',
        'detailReleasedFromYear',
        'detailReleasedFromMonth',
        'detailReleasedToYear',
        'detailReleasedToMonth',
        'detailMedia'
      ]
    },
    searchBooksSimple: { api: 'searchSimple', argNames: ['keyword'] },
    searchBooksAdvanced: {
      api: 'searchAdvanced',
      argNames: [
        'keyword',
        'detailTitle',
        'detailYomi',
        'detailAuthor',
        'detailPublisher',
        'detailStory',
        'detailTheme',
        'detailMood',
        'detailStatus',
        'detailReleasedFromYear',
        'detailReleasedFromMonth',
        'detailReleasedToYear',
        'detailReleasedToMonth',
        'detailMedia'
      ]
    },
    getRandomBooks: { api: 'random', argNames: ['count'] },
    getAllBooks: { api: 'shelf', argNames: [] },
    getBookshelfBooks: { api: 'shelf', argNames: [] },
    getBookshelfBooksChunk: { api: 'shelfChunk', argNames: ['offset', 'limit'] },
    getBookDetailById: { api: 'bookDetailById', argNames: ['bookId'] },
    getBookDetailsByIds: { api: 'bookDetailsByIds', argNames: ['bookIds'] },
    getBookDetailByRowIndex: { api: 'bookDetail', argNames: ['rowIndex'] },
    getBookDetailsByRowIndexes: { api: 'bookDetails', argNames: ['rowIndexes'] },
    getSeriesInventoryStatus: { api: 'seriesStatus', argNames: [] },
    getBooksBySeriesKey: { api: 'series', argNames: ['seriesKeyAuto'], timeoutMs: SERIES_REQUEST_TIMEOUT_MS }
  };

  let requestSeq = 0;
  // A late downloaded script still resolves a callable after its request is removed.
  // Only live callbacks occupy the registry; abandoned requests leave no tombstones.
  const jsonpCallbacks = Object.create(null);
  const ignoreLateJsonp_ = function() {};
  window.__shumiLibraryJsonpCallbacks_ = new Proxy(jsonpCallbacks, {
    get: function(target, key) { return target[key] || ignoreLateJsonp_; }
  });
  const runnerState = {
    successHandler: null,
    failureHandler: null
  };

  function resetRunnerState_() {
    runnerState.successHandler = null;
    runnerState.failureHandler = null;
  }

  function createError_(message, code, details) {
    const error = new Error(message || '通信に失敗しました');
    error.code = code || 'JSONP_ERROR';
    if (details) error.details = details;
    return error;
  }

  function notifyFailure_(error) {
    if (error && error.code === 'TEST_SEARCH_FAILURE') return;
    if (window.ShumiLibraryPwa && typeof window.ShumiLibraryPwa.handleApiFailure === 'function') {
      window.ShumiLibraryPwa.handleApiFailure(error);
    }
  }

  function notifySuccess_() {
    if (window.ShumiLibraryPwa && typeof window.ShumiLibraryPwa.clearApiFailure === 'function') {
      window.ShumiLibraryPwa.clearApiFailure();
    }
  }

  function startPerf_(name, meta) {
    if (window.ShumiLibraryPwa && typeof window.ShumiLibraryPwa.perfStart === 'function') {
      return window.ShumiLibraryPwa.perfStart(name, meta);
    }
    return null;
  }

  function endPerf_(token, meta) {
    if (window.ShumiLibraryPwa && typeof window.ShumiLibraryPwa.perfEnd === 'function') {
      window.ShumiLibraryPwa.perfEnd(token, meta);
    }
  }

  function invokeFailure_(handler, error) {
    notifyFailure_(error);
    if (typeof handler === 'function') {
      handler(error);
    }
  }

  function encodeParamValue_(value) {
    const utf8Binary = encodeURIComponent(String(value)).replace(/%([0-9A-F]{2})/g, function(match, hex) {
      return String.fromCharCode(parseInt(hex, 16));
    });

    return btoa(utf8Binary)
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/g, '');
  }

  function appendArgs_(params, argNames, args) {
    (argNames || []).forEach(function(name, index) {
      const value = args[index];
      if (value === undefined || value === null) return;
      params.set(name + 'B64', encodeParamValue_(value));
    });
  }

  function invokeRemoteJsonp_(methodName, args, successHandler, failureHandler, options) {
    const opt = options || {};
    let config = METHOD_CONFIG[methodName];
    if (methodName === 'searchBooksSimple' && !String(args[0] || '').trim()) {
      config = METHOD_CONFIG.getAllBooks;
      args = [];
    }
    if (!config) {
      invokeFailure_(
        failureHandler,
        createError_('未対応のAPIです: ' + methodName, 'UNSUPPORTED_API')
      );
      return;
    }

    const perfToken = startPerf_(opt.perfName || ('api:' + config.api), {
      method: methodName,
      api: config.api,
      background: Boolean(opt.quiet)
    });

    if (navigator && navigator.onLine === false) {
      endPerf_(perfToken, { ok: false, code: 'OFFLINE' });
      const offlineError = createError_('端末がオフラインです。通信が戻ってから再試行してください。', 'OFFLINE');
      if (opt.quiet) {
        if (typeof failureHandler === 'function') failureHandler(offlineError);
      } else {
        invokeFailure_(failureHandler, offlineError);
      }
      return;
    }

    const callbackId = 'r' + Date.now() + '_' + (++requestSeq);
    const callbackName = '__shumiLibraryJsonpCallbacks_.' + callbackId;
    const params = new URLSearchParams();
    const script = document.createElement('script');
    const requestSentAtEpochMs = Date.now();
    let finished = false;
    let timeoutId = 0;

    params.set('api', config.api);
    params.set('callback', callbackName);
    params.set('rq', String(requestSentAtEpochMs));
    if (perfToken) params.set('perf', '1');
    appendArgs_(params, config.argNames, args);

    function cleanup_() {
      if (timeoutId) window.clearTimeout(timeoutId);
      timeoutId = 0;
      delete jsonpCallbacks[callbackId];
      script.onerror = null;
      if (script.parentNode) {
        script.parentNode.removeChild(script);
      }
    }

    jsonpCallbacks[callbackId] = function(envelope) {
      if (finished) return;
      const callbackReceivedAtEpochMs = Date.now();
      finished = true;
      cleanup_();

      const serverPerf = envelope && envelope.perf && typeof envelope.perf === 'object'
        ? envelope.perf
        : undefined;
      const transportPerf = perfToken ? {
        requestSentAtEpochMs: requestSentAtEpochMs,
        requestSentAt: new Date(requestSentAtEpochMs).toISOString(),
        callbackReceivedAtEpochMs: callbackReceivedAtEpochMs,
        callbackReceivedAt: new Date(callbackReceivedAtEpochMs).toISOString(),
        callbackWaitMs: Math.max(0, callbackReceivedAtEpochMs - requestSentAtEpochMs),
        jsonpResponseChars: serverPerf && serverPerf.jsonpResponseChars !== undefined
          ? Number(serverPerf.jsonpResponseChars)
          : undefined
      } : undefined;

      if (transportPerf && serverPerf) {
        const serverStartedAtEpochMs = Number(serverPerf.serverStartedAtEpochMs);
        const serverResponseReadyAtEpochMs = Number(serverPerf.serverResponseReadyAtEpochMs);
        if (Number.isFinite(serverStartedAtEpochMs)) {
          transportPerf.beforeServerApproxMs = serverStartedAtEpochMs - requestSentAtEpochMs;
        }
        if (Number.isFinite(serverResponseReadyAtEpochMs)) {
          transportPerf.afterServerApproxMs = callbackReceivedAtEpochMs - serverResponseReadyAtEpochMs;
        }
      }

      if (!envelope || envelope.ok === false) {
        const errorInfo = envelope && envelope.error ? envelope.error : {};
        endPerf_(perfToken, {
          ok: false,
          code: errorInfo.code || 'API_ERROR',
          server: serverPerf,
          transport: transportPerf
        });
        const apiError = createError_(errorInfo.message || 'APIからエラーが返りました。', 'API_ERROR', errorInfo);
        if (opt.quiet) {
          if (typeof failureHandler === 'function') failureHandler(apiError);
        } else {
          invokeFailure_(failureHandler, apiError);
        }
        return;
      }

      endPerf_(perfToken, {
        ok: true,
        count: Array.isArray(envelope.data) ? envelope.data.length : undefined,
        server: serverPerf,
        transport: transportPerf
      });
      if (!opt.quiet) notifySuccess_();
      if (typeof successHandler === 'function') {
        successHandler(envelope.data, { source: 'remote' });
      }
    };

    timeoutId = window.setTimeout(function() {
      if (finished) return;
      finished = true;
      cleanup_();
      endPerf_(perfToken, { ok: false, code: 'TIMEOUT' });
      const timeoutError = createError_('通信がタイムアウトしました。時間を置いて再度お試しください。', 'TIMEOUT');
      if (opt.quiet) {
        if (typeof failureHandler === 'function') failureHandler(timeoutError);
      } else {
        invokeFailure_(failureHandler, timeoutError);
      }
    }, config.timeoutMs || JSONP_TIMEOUT_MS);

    script.async = true;
    script.src = GAS_JSONP_ENDPOINT + '?' + params.toString();
    script.onerror = function() {
      if (finished) return;
      finished = true;
      cleanup_();
      endPerf_(perfToken, { ok: false, code: 'SCRIPT_ERROR' });
      const scriptError = createError_('APIを読み込めませんでした。通信状態を確認してください。', 'SCRIPT_ERROR');
      if (opt.quiet) {
        if (typeof failureHandler === 'function') failureHandler(scriptError);
      } else {
        invokeFailure_(failureHandler, scriptError);
      }
    };

    document.head.appendChild(script);
    return function() {
      if (finished) return;
      finished = true;
      cleanup_();
      endPerf_(perfToken, { ok: false, code: 'CANCELLED' });
    };
  }

  let localIndexPayload = null;
  let localIndexRecords = [];
  let localIndexByBookId = new Map();
  let localIndexByRowIndex = new Map();
  let localIndexLoadPromise = null;
  let localIndexRefreshPromise = null;
  let localIndexRevisionRead = null;
  let localIndexLastCheckedAt = 0;
  let localIndexFreshnessState = 'unchecked';
  let localIndexRefreshPhase = 'idle';
  let localIndexForceDownloadRequested = false;
  let localIndexLastSuccessfulUpdateAt = '';
  let localIndexPersistenceState = 'unknown';
  let localIndexLastAcquisitionId = 0;
  let localIndexCurrentDownloadAcquisitionId = 0;

  function normalizeKanaLocal_(value) {
    return String(value || '').normalize('NFKC').toLowerCase()
      .replace(/[ァ-ヶ]/g, function(match) {
        return String.fromCharCode(match.charCodeAt(0) - 0x60);
      })
      .replace(/[\s【】「」『』（）()・:：\-–—~～・,，.。！？!?[\]{}]/g, '');
  }

  function isKanaCharLocal_(char) {
    return /^[ぁ-ゖー]$/.test(char || '');
  }

  function parseBookContributorsLocal_(value) {
    const seen = new Set();
    return String(value == null ? '' : value).split('|').map(function(name) { return name.trim(); }).filter(function(name) {
      if (!name) return false;
      const key = normalizeKanaLocal_(name) || name;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  function splitMixedSearchQueryLocal_(query) {
    const q = normalizeKanaLocal_(query);
    const chunks = [];
    let currentType = '';
    let currentText = '';

    for (let i = 0; i < q.length; i += 1) {
      const type = isKanaCharLocal_(q[i]) ? 'kana' : 'title';
      if (currentText && type !== currentType) {
        chunks.push({ type: currentType, text: currentText });
        currentText = '';
      }
      currentType = type;
      currentText += q[i];
    }
    if (currentText) chunks.push({ type: currentType, text: currentText });
    return chunks;
  }

  function findChunkMixedMatchLocal_(chunk, text, minProgress) {
    if (!chunk || !text) return null;
    const step = 1 / Math.max(text.length, 1);

    for (let index = text.indexOf(chunk); index >= 0; index = text.indexOf(chunk, index + 1)) {
      const progress = index * step;
      if (progress + 0.000001 < minProgress) continue;
      return { progress: progress };
    }
    return null;
  }

  function titleYomiMixedMatchLocal_(query, title, yomi) {
    const q = normalizeKanaLocal_(query);
    const normalizedTitle = normalizeKanaLocal_(title);
    const normalizedYomi = normalizeKanaLocal_(yomi);
    if (!q) return true;
    if ((normalizedTitle && normalizedTitle.includes(q)) || (normalizedYomi && normalizedYomi.includes(q))) {
      return true;
    }
    if (!normalizedTitle || !normalizedYomi) return false;

    const chunks = splitMixedSearchQueryLocal_(q);
    if (chunks.length <= 1) return false;
    let progress = 0;
    for (let i = 0; i < chunks.length; i += 1) {
      const target = chunks[i].type === 'kana' ? normalizedYomi : normalizedTitle;
      const match = findChunkMixedMatchLocal_(chunks[i].text, target, progress);
      if (!match) return false;
      progress = match.progress;
    }
    return true;
  }

  function keywordMixedMatchLocal_(query, item) {
    const q = normalizeKanaLocal_(query);
    if (!q) return true;
    if (item && item.searchKey && item.searchKey.includes(q)) return true;
    if (item && normalizeKanaLocal_(item.seriesSearchTitle || '').includes(q)) return true;
    return titleYomiMixedMatchLocal_(q, item && item.title, item && item.yomi);
  }

  function normalizeReleasedYmLocal_(year, month, isFrom) {
    if (!year) return 0;
    const value = (year + '-' + (month || (isFrom ? '01' : '12'))).trim().normalize('NFKC');
    const match = value.match(/^(\d{4})-(\d{2})$/);
    if (!match || Number(match[2]) < 1 || Number(match[2]) > 12) return 0;
    return Number(match[1]) * 100 + Number(match[2]);
  }

  function buildAdvancedCriteriaLocal_(args) {
    function valueAt_(index) {
      return String(args[index] || '').trim();
    }
    return {
      keyword: normalizeKanaLocal_(valueAt_(0)),
      title: normalizeKanaLocal_(valueAt_(1)),
      yomi: normalizeKanaLocal_(valueAt_(2)),
      author: normalizeKanaLocal_(valueAt_(3)),
      publisher: valueAt_(4),
      story: valueAt_(5),
      theme: valueAt_(6),
      mood: valueAt_(7),
      status: valueAt_(8),
      fromYm: normalizeReleasedYmLocal_(valueAt_(9), valueAt_(10), true),
      toYm: normalizeReleasedYmLocal_(valueAt_(11), valueAt_(12), false),
      media: valueAt_(13)
    };
  }

  function hasGenreSearchCriteriaLocal_(criteria) {
    return Boolean(
      String(criteria.story || '').trim() ||
      String(criteria.theme || '').trim() ||
      String(criteria.mood || '').trim() ||
      String(criteria.status || '').trim() ||
      String(criteria.media || '').trim()
    );
  }

  function hasExplicitSensitiveGenreSearchLocal_(criteria) {
    return String(criteria.theme || '').trim() === '18禁';
  }

  function isSensitiveSearchIndexItemLocal_(item) {
    if (item && item.isSensitive === true) return true;

    const genres = item && item.genres ? item.genres : {};
    return ['story', 'theme', 'mood', 'status', 'media'].some(function(category) {
      const values = Array.isArray(genres[category]) ? genres[category] : [];
      return values.some(function(value) { return String(value || '').trim() === '18禁'; });
    });
  }

  function matchesSensitiveGenrePolicyLocal_(item, criteria) {
    if (!isSensitiveSearchIndexItemLocal_(item)) return true;
    if (!hasGenreSearchCriteriaLocal_(criteria)) return true;
    return hasExplicitSensitiveGenreSearchLocal_(criteria);
  }

  function matchesAdvancedCriteriaLocal_(item, criteria) {
    const genres = item.genres || { story: [], theme: [], mood: [], status: [], media: [] };
    const releasedYm = Number(item.releasedYm || 0);
    return Boolean(
      (!criteria.keyword || keywordMixedMatchLocal_(criteria.keyword, item)) &&
      (!criteria.title || titleYomiMixedMatchLocal_(criteria.title, item.title, item.yomi)) &&
      (!criteria.yomi || titleYomiMixedMatchLocal_(criteria.yomi, item.title, item.yomi)) &&
      (!criteria.author || (item.author && item.author.includes(criteria.author)) ||
        (Array.isArray(item.contributors) && item.contributors.some(function(name) { return name.includes(criteria.author); }))) &&
      (!criteria.publisher || item.publisher === criteria.publisher) &&
      (!criteria.story || genres.story.includes(criteria.story)) &&
      (!criteria.theme || genres.theme.includes(criteria.theme)) &&
      (!criteria.mood || genres.mood.includes(criteria.mood)) &&
      (!criteria.status || genres.status.includes(criteria.status)) &&
      (!criteria.media || genres.media.includes(criteria.media)) &&
      matchesSensitiveGenrePolicyLocal_(item, criteria) &&
      (!criteria.fromYm || (releasedYm && releasedYm >= criteria.fromYm)) &&
      (!criteria.toYm || (releasedYm && releasedYm <= criteria.toYm))
    );
  }

  function buildGenreMetaLocal_(story, theme, mood, status, media) {
    const meta = [];
    [
      ['story', story],
      ['theme', theme],
      ['mood', mood],
      ['status', status],
      ['media', media]
    ].forEach(function(group) {
      (Array.isArray(group[1]) ? group[1] : []).forEach(function(name) {
        meta.push({ name: name, category: group[0] });
      });
    });
    return meta;
  }

  function convertLocalIndexPayload_(payload) {
    if (!payload || Number(payload.version) !== LOCAL_INDEX_SCHEMA_VERSION) {
      throw createError_('ローカル索引の形式が未対応です。', 'LOCAL_INDEX_VERSION');
    }
    if (!Array.isArray(payload.records) || typeof payload.revision !== 'string') {
      throw createError_('ローカル索引が壊れています。', 'LOCAL_INDEX_INVALID');
    }
    if (!payload.metadata || typeof payload.metadata !== 'object') {
      throw createError_('ローカル索引の検索候補が壊れています。', 'LOCAL_INDEX_METADATA_INVALID');
    }

    return payload.records.map(function(record) {
      if (!Array.isArray(record) || record.length < 33 ||
          !(record[32] === null || (typeof record[32] === 'number' && Number.isFinite(record[32])))) {
        throw createError_('ローカル索引のレコードが壊れています。', 'LOCAL_INDEX_RECORD_INVALID');
      }
      const story = Array.isArray(record[27]) ? record[27] : [];
      const theme = Array.isArray(record[28]) ? record[28] : [];
      const mood = Array.isArray(record[29]) ? record[29] : [];
      const status = Array.isArray(record[30]) ? record[30] : [];
      const media = Array.isArray(record[31]) ? record[31] : [];
      return {
        book: {
          rowIndex: Number(record[0]),
          bookId: String(record[1] || ''),
          detailLoaded: false,
          title: String(record[2] || ''),
          author: String(record[3] || ''),
          contributors: parseBookContributorsLocal_(record[3]),
          publisher: String(record[4] || ''),
          shelf: String(record[5] || ''),
          location: String(record[6] || ''),
          released: String(record[7] || ''),
          brand: String(record[8] || ''),
          isbn: String(record[9] || ''),
          yomi: String(record[10] || ''),
          genre: String(record[11] || ''),
          genreMeta: buildGenreMetaLocal_(story, theme, mood, status, media),
          seriesKeyAuto: String(record[12] || ''),
          seriesOrder: record[32],
          seriesCount: Number(record[13] || 0),
          seriesSearchTitle: String(record[14] || ''),
          isExtraSeries: Boolean(record[15]),
          volume: record[16] || 0,
          ownedMaxVolume: record[17] || 0,
          fallbackImg: String(record[18] || ''),
          fallbackImageSource: String(record[19] || ''),
          isSensitive: Boolean(record[20])
        },
        index: {
          title: String(record[21] || ''),
          yomi: String(record[22] || ''),
          author: String(record[23] || ''),
          contributors: parseBookContributorsLocal_(record[3]).map(normalizeKanaLocal_),
          searchKey: String(record[24] || ''),
          seriesSearchTitle: String(record[14] || ''),
          publisher: String(record[25] || ''),
          releasedYm: Number(record[26] || 0),
          isSensitive: Boolean(record[20]),
          genres: { story: story, theme: theme, mood: mood, status: status, media: media }
        }
      };
    });
  }

  function cloneLocalBook_(record) {
    const book = record.book;
    return Object.assign({}, book, {
      seriesCountRevision: localIndexPayload ? String(localIndexPayload.revision || '') : '',
      contributors: Array.isArray(book.contributors) ? book.contributors.slice() : [],
      genreMeta: Array.isArray(book.genreMeta)
        ? book.genreMeta.map(function(item) { return Object.assign({}, item); })
        : []
    });
  }

  function searchLocalSimple_(keyword) {
    const query = normalizeKanaLocal_(keyword);
    return localIndexRecords
      .filter(function(record) { return keywordMixedMatchLocal_(query, record.index); })
      .map(cloneLocalBook_);
  }

  function searchLocalAdvanced_(args) {
    const criteria = buildAdvancedCriteriaLocal_(args);
    return localIndexRecords
      .filter(function(record) { return matchesAdvancedCriteriaLocal_(record.index, criteria); })
      .map(cloneLocalBook_);
  }

  function pickLocalRandom_(count) {
    const maxCount = Math.min(50, localIndexRecords.length);
    const requested = Math.max(0, Math.min(maxCount, Math.floor(Number(count || 10))));
    const candidates = localIndexRecords.slice();
    for (let i = candidates.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      const tmp = candidates[i];
      candidates[i] = candidates[j];
      candidates[j] = tmp;
    }
    return candidates.slice(0, requested).map(cloneLocalBook_);
  }

  function getCompleteLocalSeries_(seriesKey, expectedRevision) {
    const key = String(seriesKey || '').trim();
    if (!key || !localIndexPayload || Number(localIndexPayload.version) !== LOCAL_INDEX_SCHEMA_VERSION ||
        localIndexFreshnessState !== 'fresh' || !String(localIndexPayload.revision || '').trim() ||
        (expectedRevision && String(localIndexPayload.revision) !== String(expectedRevision))) return null;
    // Work from the complete index, never the title/author-filtered result group.
    const records = localIndexRecords.filter(function(record) { return record.book.seriesKeyAuto === key; });
    if (!records.length) return null;
    const ids = new Set();
    const rows = new Set();
    if (!records.every(function(record) {
      const book = record.book;
      const row = book.rowIndex;
      const id = String(book.bookId || '').trim();
      if (!book.title.trim() || book.seriesCount !== records.length ||
          !Number.isInteger(row) || row < 0 || rows.has(row) || (id && ids.has(id))) return false;
      rows.add(row);
      if (id) ids.add(id);
      return true;
    })) return null;
    return records.map(cloneLocalBook_);
  }

  function activeClientRevision_() {
    return typeof currentDatasetRevision === 'undefined' ? '' : String(currentDatasetRevision || '');
  }

  function canHandleLocally_(methodName, args, options) {
    if (methodName === 'getBooksBySeriesKey') {
      const opt = options || {};
      const books = getCompleteLocalSeries_(args[0], opt.expectedRevision || activeClientRevision_());
      return Boolean(books && books.length >= (Number(opt.expectedCount) || 0));
    }
    if (!localIndexPayload) return false;
    if (!(navigator && navigator.onLine === false) && localIndexFreshnessState !== 'fresh') {
      return false;
    }
    if (methodName === 'searchBooksSimple') return Boolean(String(args[0] || '').trim());
    return methodName === 'searchBooksAdvanced' || methodName === 'getRandomBooks' || methodName === 'getBookshelfBooks';
  }

  function invokeLocal_(methodName, args, successHandler, failureHandler, localErrorHandler, options) {
    const config = METHOD_CONFIG[methodName];
    const perfToken = startPerf_('api:' + config.api, {
      method: methodName,
      api: config.api,
      local: true
    });
    let localFinished = false;
    let cancelRemote = null;
    const localTimer = window.setTimeout(function() {
      let result = [];
      try {
        if (methodName === 'searchBooksSimple') result = searchLocalSimple_(args[0]);
        if (methodName === 'getBookshelfBooks') result = localIndexRecords.map(cloneLocalBook_);
        if (methodName === 'searchBooksAdvanced') result = searchLocalAdvanced_(args);
        if (methodName === 'getRandomBooks') result = pickLocalRandom_(args[0]);
        if (methodName === 'getBooksBySeriesKey') {
          const opt = options || {};
          result = getCompleteLocalSeries_(args[0], opt.expectedRevision || activeClientRevision_());
          if (!result || result.length < (Number(opt.expectedCount) || 0)) {
            throw createError_('シリーズのローカル索引を再確認します。', 'LOCAL_SERIES_UNAVAILABLE');
          }
        }
      } catch (error) {
        localFinished = true;
        endPerf_(perfToken, { ok: false, local: true, code: 'LOCAL_INDEX_ERROR' });
        console.warn('local index query failed; falling back to GAS', error);
        if (typeof localErrorHandler === 'function') {
          localErrorHandler(error);
        } else {
          cancelRemote = invokeRemoteJsonp_(methodName, args, successHandler, failureHandler, options);
        }
        return;
      }
      localFinished = true;
      endPerf_(perfToken, {
        ok: true,
        count: result.length,
        local: true,
        sourceCount: localIndexRecords.length,
        revision: localIndexPayload.revision
      });
      if (typeof successHandler === 'function') successHandler(result, { source: 'local' });
    }, 0);
    return function() {
      window.clearTimeout(localTimer);
      if (!localFinished) {
        localFinished = true;
        endPerf_(perfToken, { ok: false, local: true, code: 'CANCELLED' });
      }
      if (typeof cancelRemote === 'function') cancelRemote();
    };
  }

  function invokeSearchWithFreshIndex_(methodName, args, successHandler, failureHandler) {
    let settled = false;
    let remoteStarted = false;
    let localQueued = false;
    let localFailed = false;
    let graceTimer = null;

    function cleanupWait_() {
      if (graceTimer !== null) {
        window.clearTimeout(graceTimer);
        graceTimer = null;
      }
      if (document && typeof document.removeEventListener === 'function') {
        document.removeEventListener('shumi-library-local-index-ready', onLocalIndexReady_);
      }
    }

    function finishSuccess_(result, remote) {
      if (settled) return;
      settled = true;
      cleanupWait_();
      if (remote) notifySuccess_();
      if (typeof successHandler === 'function') successHandler(result);
    }

    function finishFailure_(error) {
      if (settled) return;
      settled = true;
      cleanupWait_();
      notifyFailure_(error);
      if (typeof failureHandler === 'function') failureHandler(error);
    }

    function tryLocalSearch_() {
      if (settled || localQueued || localFailed || !canHandleLocally_(methodName, args)) return false;
      localQueued = true;
      invokeLocal_(methodName, args, function(result) {
        finishSuccess_(result, false);
      }, failureHandler, function() {
        localQueued = false;
        localFailed = true;
        startRemoteSearch_();
      });
      return true;
    }

    function startRemoteSearch_() {
      if (settled || remoteStarted) return;
      if (!localFailed && tryLocalSearch_()) return;
      remoteStarted = true;
      invokeRemoteJsonp_(methodName, args, function(result) {
        finishSuccess_(result, true);
      }, function(error) {
        finishFailure_(error);
      }, { quiet: true });
    }

    function onLocalIndexReady_() {
      tryLocalSearch_();
    }

    if (document && typeof document.addEventListener === 'function') {
      document.addEventListener('shumi-library-local-index-ready', onLocalIndexReady_);
    }
    graceTimer = window.setTimeout(function() {
      graceTimer = null;
      startRemoteSearch_();
    }, LOCAL_SEARCH_REFRESH_GRACE_MS);

    // Begin or join the shared refresh only after the foreground grace timer is armed.
    Promise.resolve(refreshLocalIndex_(true, '')).then(function() {
      if (settled) return;
      if (!tryLocalSearch_() && !canHandleLocally_(methodName, args)) startRemoteSearch_();
    }).catch(function() {
      startRemoteSearch_();
    });

    tryLocalSearch_();
  }

  function invokeJsonp_(methodName, args, successHandler, failureHandler, options) {
    const testMode = window.ShumiLibraryTestMode;
    if (testMode && testMode.enabled && /^searchBooks(Simple|Advanced)$/.test(methodName)) {
      testMode.calls += 1;
      testMode.render();
      if (testMode.searchFailure) {
        window.setTimeout(function() { invokeFailure_(failureHandler, createError_('検証用の検索エラーです。', 'TEST_SEARCH_FAILURE')); }, 0);
        return;
      }
    }
    if (canHandleLocally_(methodName, args, options)) {
      return invokeLocal_(methodName, args, successHandler, failureHandler, null, options);
    }
    if (
      navigator && navigator.onLine !== false &&
      (methodName === 'searchBooksAdvanced' ||
        (methodName === 'searchBooksSimple' && String(args[0] || '').trim())) &&
      window.ShumiLibraryLocalIndex &&
      typeof window.ShumiLibraryLocalIndex.isSupported === 'function' &&
      window.ShumiLibraryLocalIndex.isSupported() &&
      typeof window.ShumiLibraryLocalIndex.whenLoaded === 'function' &&
      typeof window.ShumiLibraryLocalIndex.checkForUpdates === 'function'
    ) {
      invokeSearchWithFreshIndex_(methodName, args, successHandler, failureHandler);
      return;
    }
    return invokeRemoteJsonp_(methodName, args, successHandler, failureHandler, options);
  }

  function openLocalIndexDb_() {
    return new Promise(function(resolve, reject) {
      if (!window.indexedDB) {
        reject(createError_('IndexedDBを利用できません。', 'INDEXED_DB_UNAVAILABLE'));
        return;
      }
      const request = window.indexedDB.open(LOCAL_INDEX_DB_NAME, 1);
      request.onupgradeneeded = function() {
        const db = request.result;
        if (!db.objectStoreNames.contains(LOCAL_INDEX_STORE_NAME)) {
          db.createObjectStore(LOCAL_INDEX_STORE_NAME, { keyPath: 'key' });
        }
      };
      request.onsuccess = function() { resolve(request.result); };
      request.onerror = function() { reject(request.error || createError_('IndexedDBを開けません。', 'INDEXED_DB_OPEN')); };
    });
  }

  async function readStoredLocalIndex_() {
    const db = await openLocalIndexDb_();
    try {
      return await new Promise(function(resolve, reject) {
        const request = db.transaction(LOCAL_INDEX_STORE_NAME, 'readonly')
          .objectStore(LOCAL_INDEX_STORE_NAME)
          .get(LOCAL_INDEX_ACTIVE_KEY);
        request.onsuccess = function() { resolve(request.result || null); };
        request.onerror = function() { reject(request.error || createError_('ローカル索引を読めません。', 'INDEXED_DB_READ')); };
      });
    } finally {
      db.close();
    }
  }

  async function writeStoredLocalIndex_(payload, savedAt, acquisitionId) {
    const db = await openLocalIndexDb_();
    try {
      if (acquisitionId && acquisitionId !== localIndexLastAcquisitionId) return false;
      await new Promise(function(resolve, reject) {
        const transaction = db.transaction(LOCAL_INDEX_STORE_NAME, 'readwrite');
        transaction.objectStore(LOCAL_INDEX_STORE_NAME).put({
          key: LOCAL_INDEX_ACTIVE_KEY,
          schemaVersion: LOCAL_INDEX_SCHEMA_VERSION,
          revision: payload.revision,
          savedAt: savedAt || new Date().toISOString(),
          payload: payload
        });
        transaction.oncomplete = function() { resolve(); };
        transaction.onerror = function() { reject(transaction.error || createError_('ローカル索引を保存できません。', 'INDEXED_DB_WRITE')); };
        transaction.onabort = function() { reject(transaction.error || createError_('ローカル索引の保存が中断されました。', 'INDEXED_DB_ABORT')); };
      });
      return true;
    } finally {
      db.close();
    }
  }

  function dispatchLocalIndexReady_(updated) {
    if (!document || typeof document.dispatchEvent !== 'function' || typeof window.CustomEvent !== 'function') return;
    document.dispatchEvent(new window.CustomEvent('shumi-library-local-index-ready', {
      detail: {
        revision: localIndexPayload ? localIndexPayload.revision : '',
        count: localIndexRecords.length,
        updated: Boolean(updated),
        updatedAt: localIndexLastSuccessfulUpdateAt
      }
    }));
  }

  function dispatchLocalIndexPersistence_(status, acquisitionId) {
    if (!document || typeof document.dispatchEvent !== 'function' || typeof window.CustomEvent !== 'function') return;
    document.dispatchEvent(new window.CustomEvent('shumi-library-local-index-persistence', {
      detail: {
        status: status,
        updatedAt: localIndexLastSuccessfulUpdateAt,
        acquisitionId: acquisitionId
      }
    }));
  }

  function activateLocalIndex_(payload, updated, updatedAt) {
    const converted = convertLocalIndexPayload_(payload);
    localIndexPayload = payload;
    localIndexRecords = converted;
    // Saved schema7 indexes already contain raw K-column text. Rebuild person suggestions
    // from it, so an older joined metadata.authors cache cannot hide individual names.
    localIndexPayload = Object.assign({}, payload, {
      metadata: Object.assign({}, payload.metadata, {
        suggest: Object.assign({}, payload.metadata.suggest, {
          authors: Array.from(new Set(converted.flatMap(function(record) { return record.book.contributors; })))
        })
      })
    });
    localIndexByBookId = new Map();
    localIndexByRowIndex = new Map();
    converted.forEach(function(record) {
      if (record.book.bookId) localIndexByBookId.set(String(record.book.bookId), record);
      localIndexByRowIndex.set(Number(record.book.rowIndex), record);
    });
    if (updated) {
      localIndexFreshnessState = 'fresh';
      localIndexLastSuccessfulUpdateAt = updatedAt || new Date().toISOString();
      localIndexLastAcquisitionId += 1;
      localIndexCurrentDownloadAcquisitionId = localIndexLastAcquisitionId;
      localIndexPersistenceState = 'saving';
    }
    dispatchLocalIndexReady_(updated);
  }

  // HtmlService avoids ContentService's script-download redirect path. Accept
  // only a nonce-bound message sent by this frame (including its nested sandbox).
  function invokeLibraryRevisionFrame_(success, failure, options) {
    const opt = options || {};
    const perfToken = startPerf_(opt.perfName || 'api:libraryRevision:hedge', {
      method: 'getLibraryDatasetRevisionForPwa_', api: 'libraryRevision',
      background: true, transport: 'revisionFrame'
    });
    let finished = false;
    let frame = null;
    let listening = false;
    const requestSentAtEpochMs = Date.now();

    function cleanup_() {
      if (listening) window.removeEventListener('message', receive_);
      listening = false;
      if (frame) {
        frame.onerror = null;
        if (frame.parentNode) frame.parentNode.removeChild(frame);
      }
    }
    function finish_(error, envelope) {
      if (finished) return;
      finished = true;
      cleanup_();
      const callbackReceivedAtEpochMs = Date.now();
      const serverPerf = envelope && envelope.perf && typeof envelope.perf === 'object'
        ? envelope.perf : undefined;
      const transportPerf = {
        name: 'revisionFrame', requestSentAtEpochMs: requestSentAtEpochMs,
        callbackReceivedAtEpochMs: callbackReceivedAtEpochMs,
        callbackWaitMs: Math.max(0, callbackReceivedAtEpochMs - requestSentAtEpochMs)
      };
      if (serverPerf) {
        const serverStartedAtEpochMs = Number(serverPerf.serverStartedAtEpochMs);
        const serverResponseReadyAtEpochMs = Number(serverPerf.serverResponseReadyAtEpochMs);
        if (Number.isFinite(serverStartedAtEpochMs)) {
          transportPerf.beforeServerApproxMs = serverStartedAtEpochMs - requestSentAtEpochMs;
        }
        if (Number.isFinite(serverResponseReadyAtEpochMs)) {
          transportPerf.afterServerApproxMs = callbackReceivedAtEpochMs - serverResponseReadyAtEpochMs;
        }
      }
      endPerf_(perfToken, {
        ok: !error, code: error ? error.code : undefined,
        server: serverPerf, transport: transportPerf
      });
      if (error) {
        if (typeof failure === 'function') failure(error);
      } else if (typeof success === 'function') success(envelope.data);
    }
    function belongsToFrame_(source) {
      if (!frame || !frame.contentWindow || !source) return false;
      try {
        // WindowProxy.parent is readable across origins. Never trust an
        // unrelated Google frame merely because its origin is allowed.
        for (let depth = 0; depth <= 4; depth += 1) {
          if (source === frame.contentWindow) return true;
          if (depth === 4) return false;
          const parent = source.parent;
          if (!parent || parent === source) return false;
          source = parent;
        }
      } catch (error) { return false; }
      return false;
    }
    let nonce;
    function receive_(event) {
      if (finished || typeof event.origin !== 'string' ||
          !/^https:\/\/(?:[a-z0-9-]+-)?script\.googleusercontent\.com$/.test(event.origin) ||
          !belongsToFrame_(event.source)) return;
      const message = event.data;
      if (!message || typeof message !== 'object' ||
          message.kind !== 'SHUMI_LIBRARY_REVISION_FRAME_V1' || message.nonce !== nonce) return;
      const envelope = message.envelope;
      if (!envelope || typeof envelope !== 'object' || envelope.ok !== true ||
          !envelope.data || typeof envelope.data !== 'object' ||
          typeof envelope.data.revision !== 'string' || !envelope.data.revision.trim()) {
        finish_(createError_('Invalid library revision frame response', 'INVALID_LIBRARY_REVISION_FRAME'));
        return;
      }
      finish_(null, envelope);
    }
    try {
      if (!window.crypto || typeof window.crypto.getRandomValues !== 'function') {
        throw createError_('Secure revision frame nonce unavailable', 'REVISION_FRAME_UNAVAILABLE');
      }
      const bytes = new Uint8Array(16);
      window.crypto.getRandomValues(bytes);
      nonce = Array.from(bytes, function(value) { return value.toString(16).padStart(2, '0'); }).join('');
      const params = new URLSearchParams();
      params.set('api', 'libraryRevision');
      params.set('transport', 'revisionFrame');
      params.set('nonce', nonce);
      if (perfToken) params.set('perf', '1');
      frame = document.createElement('iframe');
      frame.hidden = true;
      frame.tabIndex = -1;
      frame.setAttribute('aria-hidden', 'true');
      frame.style.display = 'none';
      frame.onerror = function() {
        finish_(createError_('Revision frame load failed', 'REVISION_FRAME_ERROR'));
      };
      window.addEventListener('message', receive_);
      listening = true;
      frame.src = GAS_JSONP_ENDPOINT + '?' + params.toString();
      (document.body || document.head).appendChild(frame);
    } catch (error) {
      finish_(createError_('Revision frame unavailable', 'REVISION_FRAME_UNAVAILABLE'));
    }
    return function() {
      if (finished) return;
      finished = true;
      cleanup_();
      endPerf_(perfToken, { ok: false, code: 'CANCELLED', transport: { name: 'revisionFrame' } });
    };
  }

  // Only the lightweight revision read has a bounded backup. Its original
  // deadline covers both transports; one failed attempt cannot reject the other.
  function invokeLibraryRevisionRead_(success, failure, options) {
    const opt = options || { quiet: true };
    const attempts = [];
    let settled = false;
    let hedgeTimer = null;
    let deadlineTimer = null;

    function finish_(callback, value) {
      if (settled) return;
      settled = true;
      if (hedgeTimer !== null) window.clearTimeout(hedgeTimer);
      if (deadlineTimer !== null) window.clearTimeout(deadlineTimer);
      hedgeTimer = deadlineTimer = null;
      attempts.forEach(function(attempt) {
        if (typeof attempt.cancel === 'function') attempt.cancel();
      });
      if (typeof callback === 'function') callback(value);
    }

    function startBackup_() {
      if (settled || attempts.length >= 2) return;
      if (hedgeTimer !== null) window.clearTimeout(hedgeTimer);
      hedgeTimer = null;
      startAttempt_(true);
    }

    function startAttempt_(backup) {
      const attempt = { failed: false, cancel: null };
      attempts.push(attempt);
      function failed_(error) {
        if (settled || attempt.failed) return;
        attempt.failed = true;
        // A joined manual refresh requires the full index, not another revision
        // attempt. Preserve refreshLocalIndex_'s existing acquisition fallback.
        if (localIndexForceDownloadRequested) {
          finish_(failure, error);
          return;
        }
        if (!backup && error && (error.code === 'SCRIPT_ERROR' || error.code === 'TIMEOUT')) startBackup_();
        if (attempts.length === 2 && attempts.every(function(item) { return item.failed; })) finish_(failure, error);
      }
      const requestOptions = Object.assign({}, opt, {
        quiet: true,
        perfName: backup ? (opt.perfName || 'api:libraryRevision') + ':hedge' : opt.perfName
      });
      function accepted_(payload) {
        if (!payload || typeof payload.revision !== 'string' || !payload.revision.trim()) {
          failed_(createError_('Invalid library revision response', 'INVALID_LIBRARY_REVISION'));
          return;
        }
        finish_(success, payload);
      }
      const cancel = backup
        ? invokeLibraryRevisionFrame_(accepted_, failed_, requestOptions)
        : invokeRemoteJsonp_('getLibraryDatasetRevisionForPwa_', [], accepted_, failed_, requestOptions);
      if (settled && typeof cancel === 'function') cancel();
      else attempt.cancel = cancel;
    }

    deadlineTimer = window.setTimeout(function() {
      finish_(failure, createError_('通信がタイムアウトしました。時間を置いて再度お試しください。', 'TIMEOUT'));
    }, JSONP_TIMEOUT_MS);
    hedgeTimer = window.setTimeout(startBackup_, LIBRARY_REVISION_HEDGE_DELAY_MS);
    startAttempt_(false);
    return function(error) {
      finish_(failure, error || createError_('Revision read cancelled', 'CANCELLED'));
    };
  }

  function invokeRemotePromise_(methodName, args, options) {
    return new Promise(function(resolve, reject) {
      if (methodName === 'getLibraryDatasetRevisionForPwa_') {
        const operation = { cancel: null };
        localIndexRevisionRead = operation;
        function complete_(callback, value) {
          if (localIndexRevisionRead === operation) localIndexRevisionRead = null;
          callback(value);
        }
        operation.cancel = invokeLibraryRevisionRead_(function(payload) {
          complete_(resolve, payload);
        }, function(error) {
          complete_(reject, error);
        }, options);
        // A synchronous transport hook can request a force refresh before the
        // cancel handle has been assigned. Honor that request after registration.
        if (localIndexRevisionRead === operation && localIndexForceDownloadRequested &&
            localIndexRefreshPhase === 'checking') {
          operation.cancel(createError_('Full index refresh requested', 'FORCED_REFRESH'));
        }
      } else {
        invokeRemoteJsonp_(methodName, args || [], resolve, reject, options || { quiet: true });
      }
    });
  }

  async function downloadAndActivateLocalIndex_() {
    const payload = await invokeRemotePromise_('getLocalLibraryIndexForPwa_', [], {
      quiet: true,
      perfName: 'sync:localIndex'
    });
    const updatedAt = new Date().toISOString();
    activateLocalIndex_(payload, true, updatedAt);
    const acquisitionId = localIndexLastAcquisitionId;
    // Activation and the manual-update result do not wait for IndexedDB to finish.
    Promise.resolve(writeStoredLocalIndex_(payload, updatedAt, acquisitionId))
      .then(function() {
        if (localIndexLastAcquisitionId !== acquisitionId) return;
        localIndexPersistenceState = 'saved';
        dispatchLocalIndexPersistence_('saved', acquisitionId);
      })
      .catch(function(error) {
        if (localIndexLastAcquisitionId !== acquisitionId) return;
        localIndexPersistenceState = 'failed';
        console.warn('local index persistence failed; fresh in-memory index remains active', error);
        dispatchLocalIndexPersistence_('failed', acquisitionId);
      })
      .finally(function() {
        if (localIndexCurrentDownloadAcquisitionId === acquisitionId) {
          localIndexCurrentDownloadAcquisitionId = 0;
        }
      });
    return true;
  }

  function ensureLocalIndexLoaded_() {
    if (localIndexLoadPromise) return localIndexLoadPromise;
    localIndexLoadPromise = readStoredLocalIndex_()
      .then(function(stored) {
        if (
          stored &&
          Number(stored.schemaVersion) === LOCAL_INDEX_SCHEMA_VERSION &&
          stored.payload
        ) {
          activateLocalIndex_(stored.payload, false);
          localIndexLastSuccessfulUpdateAt = String(stored.savedAt || '');
          localIndexPersistenceState = 'saved';
        }
        return Boolean(localIndexPayload);
      })
      .catch(function(error) {
        console.warn('stored local index unavailable; GAS fallback remains active', error);
        return false;
      });
    return localIndexLoadPromise;
  }

  function startLocalIndexDownload_() {
    localIndexForceDownloadRequested = false;
    localIndexRefreshPhase = 'downloading';
    localIndexCurrentDownloadAcquisitionId = 0;
    return downloadAndActivateLocalIndex_();
  }

  function refreshLocalIndex_(force, knownRevision, forceDownload) {
    if (localIndexRefreshPromise) {
      if (forceDownload && localIndexRefreshPhase !== 'downloading') {
        localIndexForceDownloadRequested = true;
        // A manual full refresh supersedes the revision check even if its first
        // attempt already failed. Reject the shared wait so its existing catch
        // starts one full acquisition, rather than leaving the Promise pending.
        if (localIndexRefreshPhase === 'checking' && localIndexRevisionRead &&
            typeof localIndexRevisionRead.cancel === 'function') {
          localIndexRevisionRead.cancel(createError_('Full index refresh requested', 'FORCED_REFRESH'));
        }
      }
      return localIndexRefreshPromise;
    }
    if (forceDownload) localIndexForceDownloadRequested = true;
    localIndexRefreshPhase = 'loading';
    localIndexRefreshPromise = ensureLocalIndexLoaded_()
      .then(async function() {
        if (navigator && navigator.onLine === false) {
          localIndexFreshnessState = 'offline';
          return false;
        }
        const now = Date.now();
        if (
          !force &&
          !localIndexForceDownloadRequested &&
          localIndexPayload &&
          localIndexFreshnessState === 'fresh' &&
          now - localIndexLastCheckedAt < LOCAL_INDEX_CHECK_THROTTLE_MS
        ) {
          return false;
        }
        localIndexFreshnessState = 'checking';
        localIndexRefreshPhase = 'checking';
        localIndexLastCheckedAt = now;
        if (!localIndexPayload || localIndexForceDownloadRequested) {
          return startLocalIndexDownload_();
        }

        let revision = String(knownRevision || '').trim();
        if (!revision) {
          const revisionPayload = await invokeRemotePromise_('getLibraryDatasetRevisionForPwa_', [], {
            quiet: true,
            perfName: 'sync:libraryRevision'
          });
          revision = String(revisionPayload && revisionPayload.revision || '').trim();
        }

        if (localIndexPayload && revision && revision === String(localIndexPayload.revision || '')) {
          localIndexFreshnessState = 'fresh';
          dispatchLocalIndexReady_(false);
          if (localIndexForceDownloadRequested) return startLocalIndexDownload_();
          return false;
        }
        return startLocalIndexDownload_();
      })
      .catch(function(error) {
        if (localIndexForceDownloadRequested && !(navigator && navigator.onLine === false)) {
          console.warn('local index revision check failed; honoring manual refresh request', error);
          return startLocalIndexDownload_().catch(function(downloadError) {
            localIndexFreshnessState = navigator && navigator.onLine === false ? 'offline' : 'failed';
            console.warn('local index refresh failed; previous index remains active', downloadError);
            return false;
          });
        }
        localIndexFreshnessState = navigator && navigator.onLine === false ? 'offline' : 'failed';
        console.warn('local index refresh failed; previous index remains active', error);
        return false;
      })
      .finally(function() {
        localIndexRefreshPromise = null;
        localIndexRefreshPhase = 'idle';
        localIndexForceDownloadRequested = false;
      });
    return localIndexRefreshPromise;
  }

  function forceRefreshLocalIndex_() {
    const previousAcquisitionId = localIndexLastAcquisitionId;
    const inFlightAcquisitionId = localIndexRefreshPromise && localIndexRefreshPhase === 'downloading'
      ? localIndexCurrentDownloadAcquisitionId
      : 0;
    return refreshLocalIndex_(true, '', true).then(function() {
      const acquired = inFlightAcquisitionId
        ? localIndexLastAcquisitionId === inFlightAcquisitionId
        : localIndexLastAcquisitionId > previousAcquisitionId;
      return {
        success: acquired,
        reason: acquired ? '' : (localIndexFreshnessState === 'offline' ? 'offline' : 'failed'),
        updatedAt: localIndexLastSuccessfulUpdateAt,
        persistence: acquired ? localIndexPersistenceState : ''
      };
    });
  }

  window.ShumiLibraryLocalIndex = {
    isSupported: function() { return Boolean(window.indexedDB); },
    isReady: function() { return Boolean(localIndexPayload); },
    whenLoaded: function() { return ensureLocalIndexLoaded_(); },
    whenReadyForSearch: function() { return refreshLocalIndex_(false, ''); },
    countMatches: function(args) {
      if (!canHandleLocally_('searchBooksAdvanced', args || [])) return null;
      const criteria = buildAdvancedCriteriaLocal_(args || []);
      return localIndexRecords.reduce(function(count, record) {
        return count + (matchesAdvancedCriteriaLocal_(record.index, criteria) ? 1 : 0);
      }, 0);
    },
    getRevision: function() { return localIndexPayload ? String(localIndexPayload.revision || '') : ''; },
    getRecordCount: function() { return localIndexRecords.length; },
    getCompleteSeriesBooks: getCompleteLocalSeries_,
    getSuggestionTitles: function() {
      return Array.from(new Set(localIndexRecords.filter(function(record) {
        return record.book.seriesCount > 1 && record.book.seriesSearchTitle;
      }).map(function(record) { return record.book.seriesSearchTitle; })));
    },
    getPreviewIndex: function() { return localIndexRecords.map(function(record) { return record.index; }); },
    getBookById: function(bookId) {
      const record = localIndexByBookId.get(String(bookId || ''));
      return record ? cloneLocalBook_(record) : null;
    },
    getBookByRowIndex: function(rowIndex) {
      const record = localIndexByRowIndex.get(Number(rowIndex));
      return record ? cloneLocalBook_(record) : null;
    },
    getMetadata: function() {
      return localIndexPayload && localIndexPayload.metadata && typeof localIndexPayload.metadata === 'object'
        ? localIndexPayload.metadata
        : null;
    },
    getFreshnessState: function() { return localIndexFreshnessState; },
    getLastSuccessfulUpdateAt: function() { return localIndexLastSuccessfulUpdateAt; },
    getPersistenceState: function() { return localIndexPersistenceState; },
    noteServerRevision: function(revision) { return refreshLocalIndex_(true, revision); },
    checkForUpdates: function() { return refreshLocalIndex_(true, ''); },
    forceRefresh: forceRefreshLocalIndex_
  };

  // Series loading has one deadline owned by the transport, including cleanup.
  window.ShumiLibrarySeriesApi = {
    request: function(key, revision, success, failure, expectedCount) {
      return invokeJsonp_('getBooksBySeriesKey', [key], success, failure, { quiet: true, expectedRevision: revision, expectedCount: expectedCount });
    }
  };

  // The modal owns one deadline across UUID requests and legacy row fallbacks.
  // Return cancellation so its deadline also removes pending JSONP transports.
  window.ShumiLibraryBookDetailApi = {
    request: function(methodName, args, success, failure) {
      if (!['getBookDetailById', 'getBookDetailsByIds', 'getBookDetailByRowIndex', 'getBookDetailsByRowIndexes'].includes(methodName)) {
        if (typeof failure === 'function') failure(createError_('Unsupported book detail API', 'UNSUPPORTED_API'));
        return function() {};
      }
      return invokeRemoteJsonp_(methodName, args, success, failure, { quiet: true });
    }
  };

  if (window.indexedDB) ensureLocalIndexLoaded_();

  if (typeof window.addEventListener === 'function') {
    window.addEventListener('load', function() {
      refreshLocalIndex_(true, '');
    });
    window.addEventListener('focus', function() { refreshLocalIndex_(false, ''); });
    window.addEventListener('online', function() { refreshLocalIndex_(true, ''); });
  }
  if (document && typeof document.addEventListener === 'function') {
    document.addEventListener('visibilitychange', function() {
      if (document.visibilityState === 'visible') refreshLocalIndex_(false, '');
    });
  }
  if (typeof window.setInterval === 'function') {
    window.setInterval(function() { refreshLocalIndex_(false, ''); }, LOCAL_INDEX_CHECK_INTERVAL_MS);
  }

  const runnerProxy = new Proxy({}, {
    get: function(target, property) {
      if (property === 'withSuccessHandler') {
        return function(handler) {
          runnerState.successHandler = handler;
          return runnerProxy;
        };
      }

      if (property === 'withFailureHandler') {
        return function(handler) {
          runnerState.failureHandler = handler;
          return runnerProxy;
        };
      }

      return function() {
        const args = Array.prototype.slice.call(arguments);
        const successHandler = runnerState.successHandler;
        const failureHandler = runnerState.failureHandler;
        resetRunnerState_();
        invokeJsonp_(String(property), args, successHandler, failureHandler);
        return runnerProxy;
      };
    }
  });

  window.google = window.google || {};
  window.google.script = window.google.script || {};
  window.google.script.run = runnerProxy;
})();
