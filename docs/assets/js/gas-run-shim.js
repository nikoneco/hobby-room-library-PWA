(function() {
  'use strict';

  const GAS_JSONP_ENDPOINT = "https://script.google.com/macros/s/AKfycbzAfn1SJqfKCRExekRlBMsbo9w4ZwcLNH_W6OJ-1ekS9LUJudAISNhtaGt6kPzAwEWYeQ/exec";
  const JSONP_TIMEOUT_MS = 60000;
  const LOCAL_INDEX_DB_NAME = 'shumiLibrary.localIndex.v1';
  const LOCAL_INDEX_STORE_NAME = 'snapshots';
  const LOCAL_INDEX_ACTIVE_KEY = 'active';
  const LOCAL_INDEX_SCHEMA_VERSION = 2;
  const LOCAL_INDEX_CHECK_INTERVAL_MS = 15 * 60 * 1000;
  const LOCAL_INDEX_CHECK_THROTTLE_MS = 5 * 60 * 1000;

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
        'detailReleasedToMonth'
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
        'detailReleasedToMonth'
      ]
    },
    getRandomBooks: { api: 'random', argNames: ['count'] },
    getAllBooks: { api: 'shelf', argNames: [] },
    getBookshelfBooks: { api: 'shelf', argNames: [] },
    getBookshelfBooksChunk: { api: 'shelfChunk', argNames: ['offset', 'limit'] },
    getBookDetailByRowIndex: { api: 'bookDetail', argNames: ['rowIndex'] },
    getBookDetailsByRowIndexes: { api: 'bookDetails', argNames: ['rowIndexes'] },
    getBooksBySeriesKey: { api: 'series', argNames: ['seriesKeyAuto'] }
  };

  let requestSeq = 0;
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

    const callbackName = '__shumiLibraryJsonp_' + Date.now() + '_' + (++requestSeq);
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
      try {
        delete window[callbackName];
      } catch (e) {
        window[callbackName] = undefined;
      }
      if (script.parentNode) {
        script.parentNode.removeChild(script);
      }
    }

    window[callbackName] = function(envelope) {
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
        successHandler(envelope.data);
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
    }, JSONP_TIMEOUT_MS);

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
  }

  let localIndexPayload = null;
  let localIndexRecords = [];
  let localIndexByRowIndex = new Map();
  let localIndexLoadPromise = null;
  let localIndexRefreshPromise = null;
  let localIndexLastCheckedAt = 0;

  function normalizeKanaLocal_(value) {
    return String(value || '').toLowerCase().normalize('NFKC')
      .replace(/[ァ-ヶ]/g, function(match) {
        return String.fromCharCode(match.charCodeAt(0) - 0x60);
      })
      .replace(/[\s　]/g, '');
  }

  function isKanaCharLocal_(char) {
    return /^[ぁ-ゖー]$/.test(char || '');
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
    return titleYomiMixedMatchLocal_(q, item && item.title, item && item.yomi);
  }

  function normalizeReleasedYmLocal_(year, month, isFrom) {
    if (!year) return 0;
    return Number(year) * 100 + Number(month || (isFrom ? '01' : '12'));
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
      toYm: normalizeReleasedYmLocal_(valueAt_(11), valueAt_(12), false)
    };
  }

  function matchesAdvancedCriteriaLocal_(item, criteria) {
    const genres = item.genres || { story: [], theme: [], mood: [], status: [] };
    const releasedYm = Number(item.releasedYm || 0);
    return Boolean(
      (!criteria.keyword || keywordMixedMatchLocal_(criteria.keyword, item)) &&
      (!criteria.title || titleYomiMixedMatchLocal_(criteria.title, item.title, item.yomi)) &&
      (!criteria.yomi || titleYomiMixedMatchLocal_(criteria.yomi, item.title, item.yomi)) &&
      (!criteria.author || (item.author && item.author.includes(criteria.author))) &&
      (!criteria.publisher || item.publisher === criteria.publisher) &&
      (!criteria.story || genres.story.includes(criteria.story)) &&
      (!criteria.theme || genres.theme.includes(criteria.theme)) &&
      (!criteria.mood || genres.mood.includes(criteria.mood)) &&
      (!criteria.status || genres.status.includes(criteria.status)) &&
      (!criteria.fromYm || (releasedYm && releasedYm >= criteria.fromYm)) &&
      (!criteria.toYm || (releasedYm && releasedYm <= criteria.toYm))
    );
  }

  function buildGenreMetaLocal_(story, theme, mood, status) {
    const meta = [];
    [
      ['story', story],
      ['theme', theme],
      ['mood', mood],
      ['status', status]
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
      if (!Array.isArray(record) || record.length < 30) {
        throw createError_('ローカル索引のレコードが壊れています。', 'LOCAL_INDEX_RECORD_INVALID');
      }
      const story = Array.isArray(record[26]) ? record[26] : [];
      const theme = Array.isArray(record[27]) ? record[27] : [];
      const mood = Array.isArray(record[28]) ? record[28] : [];
      const status = Array.isArray(record[29]) ? record[29] : [];
      return {
        book: {
          rowIndex: Number(record[0]),
          detailLoaded: false,
          title: String(record[1] || ''),
          author: String(record[2] || ''),
          publisher: String(record[3] || ''),
          shelf: String(record[4] || ''),
          location: String(record[5] || ''),
          released: String(record[6] || ''),
          brand: String(record[7] || ''),
          isbn: String(record[8] || ''),
          yomi: String(record[9] || ''),
          genre: String(record[10] || ''),
          genreMeta: buildGenreMetaLocal_(story, theme, mood, status),
          seriesKeyAuto: String(record[11] || ''),
          seriesCount: Number(record[12] || 0),
          seriesSearchTitle: String(record[13] || ''),
          isExtraSeries: Boolean(record[14]),
          volume: record[15] || 0,
          ownedMaxVolume: record[16] || 0,
          fallbackImg: String(record[17] || ''),
          fallbackImageSource: String(record[18] || ''),
          isSensitive: Boolean(record[19])
        },
        index: {
          title: String(record[20] || ''),
          yomi: String(record[21] || ''),
          author: String(record[22] || ''),
          searchKey: String(record[23] || ''),
          publisher: String(record[24] || ''),
          releasedYm: Number(record[25] || 0),
          genres: { story: story, theme: theme, mood: mood, status: status }
        }
      };
    });
  }

  function cloneLocalBook_(record) {
    const book = record.book;
    return Object.assign({}, book, {
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

  function canHandleLocally_(methodName, args) {
    if (!localIndexPayload) return false;
    if (methodName === 'searchBooksSimple') return Boolean(String(args[0] || '').trim());
    return methodName === 'searchBooksAdvanced' || methodName === 'getRandomBooks';
  }

  function invokeLocal_(methodName, args, successHandler, failureHandler) {
    const config = METHOD_CONFIG[methodName];
    const perfToken = startPerf_('api:' + config.api, {
      method: methodName,
      api: config.api,
      local: true
    });

    window.setTimeout(function() {
      try {
        let result = [];
        if (methodName === 'searchBooksSimple') result = searchLocalSimple_(args[0]);
        if (methodName === 'searchBooksAdvanced') result = searchLocalAdvanced_(args);
        if (methodName === 'getRandomBooks') result = pickLocalRandom_(args[0]);
        endPerf_(perfToken, {
          ok: true,
          count: result.length,
          local: true,
          sourceCount: localIndexRecords.length,
          revision: localIndexPayload.revision
        });
        if (typeof successHandler === 'function') successHandler(result);
      } catch (error) {
        endPerf_(perfToken, { ok: false, local: true, code: 'LOCAL_INDEX_ERROR' });
        console.warn('local index query failed; falling back to GAS', error);
        invokeRemoteJsonp_(methodName, args, successHandler, failureHandler);
      }
    }, 0);
  }

  function invokeJsonp_(methodName, args, successHandler, failureHandler) {
    if (canHandleLocally_(methodName, args)) {
      invokeLocal_(methodName, args, successHandler, failureHandler);
      return;
    }
    invokeRemoteJsonp_(methodName, args, successHandler, failureHandler);
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

  async function writeStoredLocalIndex_(payload) {
    const db = await openLocalIndexDb_();
    try {
      await new Promise(function(resolve, reject) {
        const transaction = db.transaction(LOCAL_INDEX_STORE_NAME, 'readwrite');
        transaction.objectStore(LOCAL_INDEX_STORE_NAME).put({
          key: LOCAL_INDEX_ACTIVE_KEY,
          schemaVersion: LOCAL_INDEX_SCHEMA_VERSION,
          revision: payload.revision,
          savedAt: new Date().toISOString(),
          payload: payload
        });
        transaction.oncomplete = function() { resolve(); };
        transaction.onerror = function() { reject(transaction.error || createError_('ローカル索引を保存できません。', 'INDEXED_DB_WRITE')); };
        transaction.onabort = function() { reject(transaction.error || createError_('ローカル索引の保存が中断されました。', 'INDEXED_DB_ABORT')); };
      });
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
        updated: Boolean(updated)
      }
    }));
  }

  function activateLocalIndex_(payload, updated) {
    const converted = convertLocalIndexPayload_(payload);
    localIndexPayload = payload;
    localIndexRecords = converted;
    localIndexByRowIndex = new Map();
    converted.forEach(function(record) {
      localIndexByRowIndex.set(Number(record.book.rowIndex), record);
    });
    dispatchLocalIndexReady_(updated);
  }

  function invokeRemotePromise_(methodName, args, options) {
    return new Promise(function(resolve, reject) {
      invokeRemoteJsonp_(methodName, args || [], resolve, reject, options || { quiet: true });
    });
  }

  async function downloadAndActivateLocalIndex_() {
    const payload = await invokeRemotePromise_('getLocalLibraryIndexForPwa_', [], {
      quiet: true,
      perfName: 'sync:localIndex'
    });
    convertLocalIndexPayload_(payload);
    await writeStoredLocalIndex_(payload);
    activateLocalIndex_(payload, true);
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
        }
        return Boolean(localIndexPayload);
      })
      .catch(function(error) {
        console.warn('stored local index unavailable; GAS fallback remains active', error);
        return false;
      });
    return localIndexLoadPromise;
  }

  function refreshLocalIndex_(force, knownRevision) {
    if (localIndexRefreshPromise) return localIndexRefreshPromise;
    localIndexRefreshPromise = ensureLocalIndexLoaded_()
      .then(async function() {
        if (navigator && navigator.onLine === false) return false;
        const now = Date.now();
        if (!force && localIndexPayload && now - localIndexLastCheckedAt < LOCAL_INDEX_CHECK_THROTTLE_MS) {
          return false;
        }
        localIndexLastCheckedAt = now;

        let revision = String(knownRevision || '').trim();
        if (!revision) {
          const revisionPayload = await invokeRemotePromise_('getLibraryDatasetRevisionForPwa_', [], {
            quiet: true,
            perfName: 'sync:libraryRevision'
          });
          revision = String(revisionPayload && revisionPayload.revision || '').trim();
        }

        if (localIndexPayload && revision && revision === String(localIndexPayload.revision || '')) {
          return false;
        }
        return downloadAndActivateLocalIndex_();
      })
      .catch(function(error) {
        console.warn('local index refresh failed; previous index remains active', error);
        return false;
      })
      .finally(function() {
        localIndexRefreshPromise = null;
      });
    return localIndexRefreshPromise;
  }

  window.ShumiLibraryLocalIndex = {
    isSupported: function() { return Boolean(window.indexedDB); },
    isReady: function() { return Boolean(localIndexPayload); },
    whenLoaded: function() { return ensureLocalIndexLoaded_(); },
    getRevision: function() { return localIndexPayload ? String(localIndexPayload.revision || '') : ''; },
    getRecordCount: function() { return localIndexRecords.length; },
    getPreviewIndex: function() { return localIndexRecords.map(function(record) { return record.index; }); },
    getBookByRowIndex: function(rowIndex) {
      const record = localIndexByRowIndex.get(Number(rowIndex));
      return record ? cloneLocalBook_(record) : null;
    },
    getMetadata: function() {
      return localIndexPayload && localIndexPayload.metadata && typeof localIndexPayload.metadata === 'object'
        ? localIndexPayload.metadata
        : null;
    },
    noteServerRevision: function(revision) { return refreshLocalIndex_(true, revision); },
    checkForUpdates: function() { return refreshLocalIndex_(true, ''); }
  };

  if (window.indexedDB) ensureLocalIndexLoaded_();

  if (typeof window.addEventListener === 'function') {
    window.addEventListener('load', function() {
      window.setTimeout(function() { refreshLocalIndex_(false, ''); }, 1500);
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
