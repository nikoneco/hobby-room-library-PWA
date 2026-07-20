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
    version: 2,
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
        themeGenres: ['芸能'],
        moodGenres: [],
        statusGenres: ['連載中'],
        releaseYears: ['2020']
      },
      quickBrowseCounts: {
        story: { 'ファンタジー': 1 },
        theme: { '芸能': 2 },
        mood: {},
        status: { '連載中': 3 }
      }
    },
    columns: [],
    records: [
      [
        0, '【推しの子】 1', '赤坂アカ×横槍メンゴ', '集英社', 'A', '1-1', '2020/07', 'ヤングジャンプ',
        '9784088916507', 'おしのこ', '芸能,連載中', '推しの子', 2, '【推しの子】', false, 1, 2,
        '', '', false,
        '【推しの子】1', 'おしのこ', '赤坂あか×横槍めんご', '【推しの子】1 おしのこ 赤坂あか×横槍めんご', '集英社', 202007,
        [], ['芸能'], [], ['連載中']
      ],
      [
        1, '【推しの子】 2', '赤坂アカ×横槍メンゴ', '集英社', 'A', '1-2', '2020/10', 'ヤングジャンプ',
        '9784088917177', 'おしのこ', '芸能,連載中', '推しの子', 2, '【推しの子】', false, 2, 2,
        '', '', false,
        '【推しの子】2', 'おしのこ', '赤坂あか×横槍めんご', '【推しの子】2 おしのこ 赤坂あか×横槍めんご', '集英社', 202010,
        [], ['芸能'], [], ['連載中']
      ],
      [
        2, '葬送のフリーレン 1', '山田鐘人', '小学館', 'B', '2-1', '2020/08', '少年サンデー',
        '9784098501809', 'そうそうのふりーれん', 'ファンタジー,連載中', '葬送のフリーレン', 1, '葬送のフリーレン', false, 1, 1,
        '', '', false,
        '葬送のふりーれん1', 'そうそうのふりーれん', '山田鐘人', '葬送のふりーれん1 そうそうのふりーれん 山田鐘人', '小学館', 202008,
        ['ファンタジー'], [], [], ['連載中']
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
    schemaVersion: 2,
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
  assert(sandboxWindow.ShumiLibraryLocalIndex.getRecordCount() === 3, 'stored index exposes its record count');
  const metadata = sandboxWindow.ShumiLibraryLocalIndex.getMetadata();
  assert(metadata.suggest.titles.includes('【推しの子】'), 'stored index exposes search suggestions');
  assert(metadata.advancedOptions.publishers.includes('小学館'), 'stored index exposes advanced search options');
  assert(metadata.quickBrowseCounts.status['連載中'] === 3, 'stored index exposes quick-browse counts');
  const indexedBook = sandboxWindow.ShumiLibraryLocalIndex.getBookByRowIndex(1);
  assert(indexedBook && indexedBook.title === '【推しの子】 2', 'stored index exposes a book by row index');
  assert(indexedBook.genreMeta.some(item => item.name === '芸能'), 'row lookup preserves locally stored genres');
  assert(documentEvents.some(event => event.type === 'shumi-library-local-index-ready'), 'stored index emits a ready event');

  const runner = sandboxWindow.google.script.run;
  const simple = await invoke(runner, 'searchBooksSimple', ['推しの子']);
  assert(simple.length === 2, 'simple search runs against the local index');
  assert(simple.every(book => book.detailLoaded === false), 'local search defers full book details');

  const advancedArgs = ['', '', '', '', '小学館', '', '', '', '', '', '', '', ''];
  const advanced = await invoke(runner, 'searchBooksAdvanced', advancedArgs);
  assert(advanced.length === 1 && advanced[0].title.includes('フリーレン'), 'advanced search runs against the local index');

  const random = await invoke(runner, 'getRandomBooks', [2]);
  assert(random.length === 2, 'random search returns the requested local count');
  assert(new Set(random.map(book => book.rowIndex)).size === 2, 'random search does not duplicate books');
  assert(appendedScripts.length === 0, 'local queries do not inject JSONP scripts even while offline');
  assert(perfEntries.filter(entry => entry.meta && entry.meta.local).length === 3, 'local queries record local performance entries');

  console.log('local index checks ok');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
