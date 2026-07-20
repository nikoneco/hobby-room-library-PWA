(function() {
  'use strict';

  const GAS_JSONP_ENDPOINT = "https://script.google.com/macros/s/AKfycbzAfn1SJqfKCRExekRlBMsbo9w4ZwcLNH_W6OJ-1ekS9LUJudAISNhtaGt6kPzAwEWYeQ/exec";
  const JSONP_TIMEOUT_MS = 60000;

  const METHOD_CONFIG = {
    getInitialSearchData: { api: 'initial', argNames: [] },
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

  function invokeJsonp_(methodName, args, successHandler, failureHandler) {
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

    const perfToken = startPerf_('api:' + config.api, {
      method: methodName,
      api: config.api
    });

    if (navigator && navigator.onLine === false) {
      endPerf_(perfToken, { ok: false, code: 'OFFLINE' });
      invokeFailure_(
        failureHandler,
        createError_('端末がオフラインです。通信が戻ってから再試行してください。', 'OFFLINE')
      );
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
        invokeFailure_(
          failureHandler,
          createError_(errorInfo.message || 'APIからエラーが返りました。', 'API_ERROR', errorInfo)
        );
        return;
      }

      endPerf_(perfToken, {
        ok: true,
        count: Array.isArray(envelope.data) ? envelope.data.length : undefined,
        server: serverPerf,
        transport: transportPerf
      });
      notifySuccess_();
      if (typeof successHandler === 'function') {
        successHandler(envelope.data);
      }
    };

    timeoutId = window.setTimeout(function() {
      if (finished) return;
      finished = true;
      cleanup_();
      endPerf_(perfToken, { ok: false, code: 'TIMEOUT' });
      invokeFailure_(
        failureHandler,
        createError_('通信がタイムアウトしました。時間を置いて再度お試しください。', 'TIMEOUT')
      );
    }, JSONP_TIMEOUT_MS);

    script.async = true;
    script.src = GAS_JSONP_ENDPOINT + '?' + params.toString();
    script.onerror = function() {
      if (finished) return;
      finished = true;
      cleanup_();
      endPerf_(perfToken, { ok: false, code: 'SCRIPT_ERROR' });
      invokeFailure_(
        failureHandler,
        createError_('APIを読み込めませんでした。通信状態を確認してください。', 'SCRIPT_ERROR')
      );
    };

    document.head.appendChild(script);
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
