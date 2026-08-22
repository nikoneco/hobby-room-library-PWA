const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const shimSource = fs.readFileSync(path.join(root, 'docs', 'assets', 'js', 'gas-run-shim.js'), 'utf8');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function createPayload() {
  return {
    version: 6,
    revision: 'fixture-revision',
    metadata: {
      suggest: {
        titles: ['【推しの子】', '葬送のフリーレン'],
        yomis: ['おしのこ', 'そうそうのふりーれん'],
        authors: ['赤坂アカ×横槍メンゴ', '山田鐘人'],
        genres: ['芸能', 'ファンタジー', '連載中']
      },
      advancedOptions: {
        publishers: ['集英社', '小学館'],
        storyGenres: ['ファンタジー'],
        themeGenres: ['芸能', '18禁'],
        moodGenres: [],
        statusGenres: ['連載中'],
        mediaGenres: ['漫画', '小説'],
        releaseYears: ['2020']
      },
      quickBrowseCounts: {
        story: { 'ファンタジー': 1 },
        theme: { '芸能': 2 },
        mood: {},
        status: { '連載中': 3 },
        media: { '漫画': 4, '小説': 1 }
      }
    },
    columns: [],
    records: [
      [
        0, '11111111-1111-4111-8111-111111111111', '【推しの子】 1', '赤坂アカ×横槍メンゴ', '集英社', 'A', '1-1', '2020/07', 'ヤングジャンプ',
        '9784088916507', 'おしのこ', '芸能,連載中', '推しの子', 2, '【推しの子】', false, 1, 2,
        '', '', false,
        '推しの子1', 'おしのこ', '赤坂あか×横槍めんご', '推しの子1おしのこ赤坂あか×横槍めんご', '集英社', 202007,
        [], ['芸能'], [], ['連載中'], ['漫画']
      ],
      [
        1, '22222222-2222-4222-8222-222222222222', '【推しの子】 2', '赤坂アカ×横槍メンゴ', '集英社', 'A', '1-2', '2020/10', 'ヤングジャンプ',
        '9784088917177', 'おしのこ', '芸能,連載中', '推しの子', 2, '【推しの子】', false, 2, 2,
        '', '', false,
        '推しの子2', 'おしのこ', '赤坂あか×横槍めんご', '推しの子2おしのこ赤坂あか×横槍めんご', '集英社', 202010,
        [], ['芸能'], [], ['連載中'], ['漫画']
      ],
      [
        2, '33333333-3333-4333-8333-333333333333', '葬送のフリーレン 1', '山田鐘人', '小学館', 'B', '2-1', '2020/08', '少年サンデー',
        '9784098501809', 'そうそうのふりーれん', 'ファンタジー,連載中', '葬送のフリーレン', 1, '葬送のフリーレン', false, 1, 1,
        '', '', false,
        '葬送のふりーれん1', 'そうそうのふりーれん', '山田鐘人', '葬送のふりーれん1 そうそうのふりーれん 山田鐘人', '小学館', 202008,
        ['ファンタジー'], [], [], ['連載中'], ['漫画', '小説']
      ],
      [
        3, '44444444-4444-4444-8444-444444444444', 'センシティブ本 1', 'テスト作者', '同人出版社', 'C', '3-1', '2024/01', '自主制作',
        '', 'せんしてぃぶほん', '18禁,恋愛', 'センシティブ本', 1, 'センシティブ本', false, 1, 1,
        '', '', true,
        'せんしてぃぶ本1', 'せんしてぃぶほん', 'てすとさくしゃ', 'せんしてぃぶ本1 せんしてぃぶほん てすとさくしゃ', '同人出版社', 202401,
        [], ['18禁', '恋愛'], [], ['単巻'], ['漫画']
      ]
    ]
  };
}

function createIndexedDb(stored) {
  const db = {
    objectStoreNames: { contains: () => true },
    close() {},
    transaction() {
      return {
        objectStore() {
          return {
            get() {
              const request = {};
              queueMicrotask(() => {
                request.result = stored;
                if (request.onsuccess) request.onsuccess();
              });
              return request;
            }
          };
        }
      };
    }
  };

  return {
    open() {
      const request = {};
      queueMicrotask(() => {
        request.result = db;
        if (request.onsuccess) request.onsuccess();
      });
      return request;
    }
  };
}

function invoke(runner, method, args) {
  return new Promise((resolve, reject) => {
    runner
      .withSuccessHandler(resolve)
      .withFailureHandler(reject)[method](...(args || []));
  });
}

(async function main() {
  const appendedScripts = [];
  const payload = createPayload();
  const stored = {
    key: 'active',
    schemaVersion: 6,
    revision: payload.revision,
    payload
  };
  const perfEntries = [];
  const documentEvents = [];

  const sandboxWindow = {
    indexedDB: createIndexedDb(stored),
    CustomEvent: function(type, init) { this.type = type; this.detail = init && init.detail; },
    addEventListener() {},
    setTimeout(callback, delay) {
      if (!delay) queueMicrotask(callback);
      return 1;
    },
    clearTimeout() {},
    setInterval() { return 1; },
    ShumiLibraryPwa: {
      perfStart(name, meta) { return { name, meta }; },
      perfEnd(token, meta) { perfEntries.push({ token, meta }); },
      handleApiFailure() {},
      clearApiFailure() {}
    }
  };
  const sandboxDocument = {
    visibilityState: 'visible',
    addEventListener() {},
    dispatchEvent(event) { documentEvents.push(event); },
    createElement() {
      return { parentNode: { removeChild() {} } };
    },
    head: { appendChild(script) { appendedScripts.push(script); } }
  };

  vm.runInNewContext(shimSource, {
    window: sandboxWindow,
    document: sandboxDocument,
    navigator: { onLine: false },
    URLSearchParams,
    btoa: value => Buffer.from(String(value), 'binary').toString('base64'),
    Proxy,
    Promise,
    Error,
    Date,
    String,
    Array,
    Object,
    Math,
    Number,
    Boolean,
    console
  });

  await new Promise(resolve => setImmediate(resolve));
  assert(sandboxWindow.ShumiLibraryLocalIndex.isSupported(), 'IndexedDB support is exposed');
  assert(await sandboxWindow.ShumiLibraryLocalIndex.whenLoaded(), 'stored index load can be awaited');
  assert(sandboxWindow.ShumiLibraryLocalIndex.isReady(), 'stored index becomes ready');
  await sandboxWindow.ShumiLibraryLocalIndex.checkForUpdates();
  assert(
    sandboxWindow.ShumiLibraryLocalIndex.getFreshnessState() === 'offline',
    'offline clients keep the stored index available without a revision check'
  );
  assert(sandboxWindow.ShumiLibraryLocalIndex.getRecordCount() === 4, 'stored index exposes its record count');
  const metadata = sandboxWindow.ShumiLibraryLocalIndex.getMetadata();
  assert(metadata.suggest.titles.includes('【推しの子】'), 'stored index exposes search suggestions');
  assert(metadata.advancedOptions.publishers.includes('小学館'), 'stored index exposes advanced search options');
  assert(metadata.quickBrowseCounts.status['連載中'] === 3, 'stored index exposes quick-browse counts');
  assert(metadata.quickBrowseCounts.media['漫画'] === 4, 'stored index exposes media quick-browse counts');
  const indexedBook = sandboxWindow.ShumiLibraryLocalIndex.getBookByRowIndex(1);
  assert(indexedBook && indexedBook.title === '【推しの子】 2', 'stored index exposes a book by row index');
  const indexedBookById = sandboxWindow.ShumiLibraryLocalIndex.getBookById('22222222-2222-4222-8222-222222222222');
  assert(indexedBookById && indexedBookById.title === '【推しの子】 2', 'stored index exposes a book by stable ID');
  assert(indexedBook.genreMeta.some(item => item.name === '芸能'), 'row lookup preserves locally stored genres');
  assert(indexedBook.genreMeta.some(item => item.name === '漫画' && item.category === 'media'), 'row lookup preserves series media');
  assert(documentEvents.some(event => event.type === 'shumi-library-local-index-ready'), 'stored index emits a ready event');

  const runner = sandboxWindow.google.script.run;
  const simple = await invoke(runner, 'searchBooksSimple', ['推しの子']);
  assert(simple.length === 2, 'simple search runs against the local index');
  assert(simple.every(book => book.detailLoaded === false), 'local search defers full book details');
  const punctuatedSimple = await invoke(runner, 'searchBooksSimple', ['【推しの子】']);
  assert(punctuatedSimple.length === 2, 'local search shares the server punctuation-normalization contract');

  const advancedArgs = ['', '', '', '', '小学館', '', '', '', '', '', '', '', ''];
  const advanced = await invoke(runner, 'searchBooksAdvanced', advancedArgs);
  assert(advanced.length === 1 && advanced[0].title.includes('フリーレン'), 'advanced search runs against the local index');

  const otherGenreArgs = ['', '', '', '', '', '', '恋愛', '', '', '', '', '', ''];
  const otherGenre = await invoke(runner, 'searchBooksAdvanced', otherGenreArgs);
  assert(otherGenre.length === 0, 'local genre search excludes 18禁 books from other genre searches');

  const otherStatusArgs = ['', '', '', '', '', '', '', '', '単巻', '', '', '', ''];
  const otherStatus = await invoke(runner, 'searchBooksAdvanced', otherStatusArgs);
  assert(otherStatus.length === 0, 'local genre search with another category excludes 18禁 books unless theme=18禁');

  const storySensitiveArgs = ['', '', '', '', '', '18禁', '', '', '', '', '', '', ''];
  const storySensitive = await invoke(runner, 'searchBooksAdvanced', storySensitiveArgs);
  assert(storySensitive.length === 0, 'local story field cannot opt into 18禁 books');

  const sensitiveGenreArgs = ['', '', '', '', '', '', '18禁', '', '', '', '', '', ''];
  const sensitiveGenre = await invoke(runner, 'searchBooksAdvanced', sensitiveGenreArgs);
  assert(
    sensitiveGenre.length === 1 && sensitiveGenre[0].title.includes('センシティブ本'),
    'local genre search includes 18禁 books when 18禁 is explicitly selected'
  );

  const novelMediaArgs = ['', '', '', '', '', '', '', '', '', '', '', '', '', '小説'];
  const novelMedia = await invoke(runner, 'searchBooksAdvanced', novelMediaArgs);
  assert(
    novelMedia.length === 1 && novelMedia[0].title.includes('フリーレン'),
    'local media search matches either series-level media slot'
  );

  const mangaMediaArgs = ['', '', '', '', '', '', '', '', '', '', '', '', '', '漫画'];
  const mangaMedia = await invoke(runner, 'searchBooksAdvanced', mangaMediaArgs);
  assert(mangaMedia.length === 3, 'local media-only search excludes 18禁 books');

  const sensitiveMediaArgs = ['', '', '', '', '', '', '18禁', '', '', '', '', '', '', '漫画'];
  const sensitiveMedia = await invoke(runner, 'searchBooksAdvanced', sensitiveMediaArgs);
  assert(
    sensitiveMedia.length === 1 && sensitiveMedia[0].title.includes('センシティブ本'),
    'local media search includes 18禁 books when 題材=18禁 is explicit'
  );

  const keywordSensitive = await invoke(runner, 'searchBooksSimple', ['センシティブ本']);
  assert(
    keywordSensitive.length === 1 && keywordSensitive[0].title.includes('センシティブ本'),
    'local keyword search keeps 18禁 books eligible because genres are not keyword-search fields'
  );

  const random = await invoke(runner, 'getRandomBooks', [2]);
  assert(random.length === 2, 'random search returns the requested local count');
  assert(new Set(random.map(book => book.rowIndex)).size === 2, 'random search does not duplicate books');
  assert(appendedScripts.length === 0, 'local queries do not inject JSONP scripts even while offline');
  assert(perfEntries.filter(entry => entry.meta && entry.meta.local).length === 12, 'local queries record local performance entries');

  const onlineScripts = [];
  const onlineLoadHandlers = [];
  const onlineWindow = {
    indexedDB: createIndexedDb(stored),
    CustomEvent: function(type, init) { this.type = type; this.detail = init && init.detail; },
    addEventListener(type, handler) {
      if (type === 'load') onlineLoadHandlers.push(handler);
    },
    setTimeout(callback, delay) {
      if (!delay) queueMicrotask(callback);
      return 1;
    },
    clearTimeout() {},
    setInterval() { return 1; },
    ShumiLibraryPwa: {
      perfStart(name, meta) { return { name, meta }; },
      perfEnd() {},
      handleApiFailure() {},
      clearApiFailure() {}
    }
  };
  const onlineDocument = {
    visibilityState: 'visible',
    addEventListener() {},
    dispatchEvent() {},
    createElement() {
      return { parentNode: { removeChild() {} } };
    },
    head: { appendChild(script) { onlineScripts.push(script); } }
  };

  vm.runInNewContext(shimSource, {
    window: onlineWindow,
    document: onlineDocument,
    navigator: { onLine: true },
    URLSearchParams,
    btoa: value => Buffer.from(String(value), 'binary').toString('base64'),
    Proxy,
    Promise,
    Error,
    Date,
    String,
    Array,
    Object,
    Math,
    Number,
    Boolean,
    console
  });

  await new Promise(resolve => setImmediate(resolve));
  onlineLoadHandlers.forEach(handler => handler());
  await new Promise(resolve => setImmediate(resolve));

  const onlineManager = onlineWindow.ShumiLibraryLocalIndex;
  assert(onlineManager.isReady(), 'online client can load the stored index before freshness confirmation');
  assert(onlineManager.getFreshnessState() === 'checking', 'page load starts the freshness check immediately');

  const onlineRunner = onlineWindow.google.script.run;
  const remoteSearchPromise = invoke(onlineRunner, 'searchBooksSimple', ['推しの子']);
  await new Promise(resolve => setImmediate(resolve));

  const getScriptApi = script => new URL(script.src).searchParams.get('api');
  const invokeScriptCallback = (targetWindow, script, data) => {
    const callback = new URL(script.src).searchParams.get('callback');
    targetWindow[callback]({ ok: true, data, error: null });
  };
  const revisionScript = onlineScripts.find(script => getScriptApi(script) === 'libraryRevision');
  const searchScript = onlineScripts.find(script => getScriptApi(script) === 'searchSimple');
  assert(revisionScript, 'page load requests the lightweight server revision');
  assert(searchScript, 'search during freshness confirmation bypasses the stored local index');

  invokeScriptCallback(onlineWindow, searchScript, [{ title: 'サーバー最新本' }]);
  const remoteSearch = await remoteSearchPromise;
  assert(
    remoteSearch.length === 1 && remoteSearch[0].title === 'サーバー最新本',
    'freshness-gated search returns the authoritative server result'
  );

  invokeScriptCallback(onlineWindow, revisionScript, {
    version: 6,
    revision: payload.revision
  });
  await new Promise(resolve => setImmediate(resolve));
  assert(onlineManager.getFreshnessState() === 'fresh', 'matching revision enables local queries');

  const scriptCountBeforeLocalSearch = onlineScripts.length;
  const confirmedLocalSearch = await invoke(onlineRunner, 'searchBooksSimple', ['推しの子']);
  assert(confirmedLocalSearch.length === 2, 'confirmed-fresh index serves subsequent searches locally');
  assert(
    onlineScripts.length === scriptCountBeforeLocalSearch,
    'confirmed-fresh local search does not add another JSONP request'
  );

  console.log('local index checks ok');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
