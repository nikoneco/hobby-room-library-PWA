let currentViewMode = 'card'; // 'card' | 'list' | 'shelf'
let isShelfImmersiveMode = false; // true: トップの「本棚を見る」専用の没入表示
let currentShelfRoomMapGroups = []; // 没入本棚モード用の現在のマップ集計
let isCardView = true; // 既存コード互換用。card/list切替に同期する。
let lastResult = null;
let coverFullscreenPreviousKeydown = null;
let popupDragSuppressNextClick = false;
let isRandomBooksLoading = false;
let preferredResultViewMode = '';
let resultViewModeChangedLocally = false;
let shelfScrollSpyObserver = null;
let popupReturnScrollY = 0;
let bookDetailCache = new Map();
let bookDetailPrefetchQueue = [];
let bookDetailPrefetchActive = 0;
let bookDetailPrefetchTimer = 0;
let bookDetailPrefetchObserver = null;

const NO_IMAGE_URL = "https://i.imgur.com/Q80wBRc.jpeg";
const SENSITIVE_THEME_NAME = '18禁';
const BOOK_DETAIL_CACHE_LIMIT = 96;
const BOOK_DETAIL_PERSISTENT_CACHE_KEY = 'shumiLibrary.bookDetailCache.v1';
const BOOK_DETAIL_PERSISTENT_CACHE_LIMIT = 180;
const BOOK_DETAIL_PERSISTENT_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const BOOK_DETAIL_PREFETCH_QUEUE_LIMIT = 36;
const BOOK_DETAIL_PREFETCH_CONCURRENCY = 1;
const SENSITIVE_COVER_STORAGE_KEY = 'shumiLibrary.showSensitiveCovers';
const RESULT_VIEW_MODE_STORAGE_KEY = 'shumiLibrary.resultViewMode';
const RESULT_VIEW_MODES = ['card', 'list', 'shelf'];

const UI_ICONS = {
  search: '<svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="6"></circle><path d="M16 16l4 4"></path></svg>',
  shuffle: '<svg viewBox="0 0 24 24"><path d="M4 7h4l3 10h3"></path><path d="M17 7h3v3"></path><path d="M20 7l-6 6"></path><path d="M17 17h3v-3"></path><path d="M20 17l-3-3"></path></svg>',
  filter: '<svg viewBox="0 0 24 24"><path d="M4 7h16"></path><path d="M7 12h10"></path><path d="M10 17h4"></path></svg>',
  shelf: '<svg viewBox="0 0 24 24"><path d="M4 20h16"></path><path d="M5 4h3v13H5z"></path><path d="M10 4h3v13h-3z"></path><path d="M15 5l3-.8 3.4 12.8-3 .8z"></path></svg>',
  map: '<svg viewBox="0 0 24 24"><path d="M4 6l5-2 6 2 5-2v14l-5 2-6-2-5 2z"></path><path d="M9 4v14"></path><path d="M15 6v14"></path></svg>',
  back: '<svg viewBox="0 0 24 24"><path d="M11 6l-6 6 6 6"></path><path d="M5 12h14"></path></svg>',
  collection: '<svg viewBox="0 0 24 24"><path d="M5 5h10a4 4 0 0 1 4 4v10H9a4 4 0 0 1-4-4z"></path><path d="M9 9h6"></path><path d="M9 13h5"></path></svg>',
  link: '<svg viewBox="0 0 24 24"><path d="M10 13a5 5 0 0 0 7 0l2-2a5 5 0 0 0-7-7l-1 1"></path><path d="M14 11a5 5 0 0 0-7 0l-2 2a5 5 0 0 0 7 7l1-1"></path></svg>',
  store: '<svg viewBox="0 0 24 24"><path d="M5 10h14l-1 10H6z"></path><path d="M8 10a4 4 0 0 1 8 0"></path></svg>',
  bell: '<svg viewBox="0 0 24 24"><path d="M6 17h12"></path><path d="M8 17V10a4 4 0 0 1 8 0v7"></path><path d="M10 20h4"></path></svg>',
  close: '<svg viewBox="0 0 24 24"><path d="M6 6l12 12"></path><path d="M18 6L6 18"></path></svg>',
  trash: '<svg viewBox="0 0 24 24"><path d="M5 6h14"></path><path d="M9 6V4h6v2"></path><path d="M8 10v8"></path><path d="M16 10v8"></path><path d="M7 6l1 14h8l1-14"></path></svg>',
  chevronDown: '<svg viewBox="0 0 24 24"><path d="M6 9l6 6 6-6"></path></svg>'
};

function uiIcon_(name, extraClass) {
  return `<span class="ui-icon ${extraClass || ''}" aria-hidden="true">${UI_ICONS[name] || ''}</span>`;
}

// 画像取得率の計測はデバッグ用。
// 通常時はOFF。URLに ?debugImageStats=1 を付けるか、