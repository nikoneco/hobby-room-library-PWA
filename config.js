/** @OnlyCurrentDoc */
/* ====== グローバル定数 ====== */
const CONFIG = {
  SHEETS: {
    MAIN  : '目録',
    DATA  : 'データ',
    GENRE_MASTER: 'genre_master',
    SERIES_MASTER: 'series_master'
  },
  // シート列番号（1始まり）
  COL: {
    TITLE    : 9,    // I列
    AUTHOR   : 11,   // K列
    PUBLISHER: 12,   // L列
    IMAGE    : 10,   // J列：スプシ表示専用
    ISBN     : 19,   // S列
    YOMIGANA : 21,   // U列
    RESERVED  : 22,   // V列：予備
    GENRE    : 23,   // W列
    SERIES_KEY_AUTO: 24, // X列
    SUMMARY   : 25,   // Y列：あらすじ
    SUMMARY_SOURCE: 26, // Z列：あらすじ取得元 / STATUS

    // 旧名互換。今後の新規実装では SUMMARY を使う。
    SUMMARY_RAW: 25, // Y列：旧 SUMMARY_RAW。現在は「あらすじ」

    FALLBACK_IMAGE_URL   : 27, // AA列：Hanmoto失敗時の保険画像URL
    FALLBACK_IMAGE_SOURCE: 28, // AB列：保険画像URL取得元 / STATUS

    // 移行期間の互換エイリアス。旧コードが残っても壊さないため。
    WEB_IMAGE_URL   : 27,
    WEB_IMAGE_SOURCE: 28,

    WEBAPP_MAX: 28, // Webアプリ検索データはAB列まで読む
    MAX       : 28  // シート管理上の最大列（AB列）
  },
  // 配列index（0始まり）
  IDX: {
    TITLE    : 0,
    AUTHOR   : 2,
    PUBLISHER: 3,
    SHELF    : 4,
    LOCATION : 5,
    RELEASED : 6,
    PRICE    : 7,
    BRAND    : 8,
    ISBN     : 10,
    MEMO     : 11,
    YOMIGANA : 12,
    RESERVED  : 13,
    GENRE    : 14,
    SERIES_KEY_AUTO: 15,
    SUMMARY   : 16,
    SUMMARY_SOURCE: 17,
    FALLBACK_IMAGE_URL: 18,
    FALLBACK_IMAGE_SOURCE: 19,

    // 移行期間の互換エイリアス
    SUMMARY_RAW: 16,
    WEB_IMAGE_URL: 18,
    WEB_IMAGE_SOURCE: 19
  },
  // Webアプリ専用設定
  WEBAPP: {
    // データ!L2：目録I列タイトル基準の最終データ行
    // 数式例: =IFERROR(MAX(FILTER(ROW('目録'!I2:I), '目録'!I2:I<>"")),1)
    MAIN_LAST_ROW_A1: 'L2'
  }
};

/* ====== その他定数 ====== */
const NO_IMAGE_URL = "https://i.imgur.com/Q80wBRc.jpeg";

/* ====== Webアプリ検索キャッシュ設定 ====== */
const CACHE_CONFIG = {
  LIBRARY_DATASET_KEY: 'library_dataset_v21',
  SHELF_DATASET_KEY: 'library_shelf_dataset_v1',
  TTL_SECONDS: 60 * 60,     // 1時間
  CHUNK_SIZE: 90000         // CacheService 100KB制限対策
};

/* ====== 操作モードドロップダウン値 ====== */
const DROPDOWN_VALUES = {
  NML: [
    '機能選択',
    'Filter初期化',
    'ISBN入力モード'
  ],
  ISBN: [
    'ISBN入力モード',
    '入力モード終了'
  ]
};

/* ====== 純粋ユーティリティ関数（副作用なし） ====== */
// カタカナ→ひらがな、記号除去、全角→半角
function normalizeKana(str) {
  if (!str) return '';
  return str
    .toString()
    .normalize("NFKC")
    .replace(/[\u30a1-\u30f6]/g, s =>
      String.fromCharCode(s.charCodeAt(0) - 0x60)
    )
    .replace(/[\s【】「」『』（）()・:：\-–—~～・,，.。！？!?[\]{}]/g, '')
    .toLowerCase();
}

/**
 * ISBNをWebアプリ内部で扱いやすい文字列に正規化する
 * - 全角数字 → 半角数字
 * - ISBN表記、ハイフン、空白などを除去
 * - Excel/Sheets由来の指数表記を通常の整数文字列へ戻す
 * - ISBN-10の末尾Xは許可
 *
 * @param {*} value
 * @returns {string}
 */
function normalizeIsbn_(value) {
  if (value === null || value === undefined) return '';

  let s = String(value)
    .normalize('NFKC')
    .trim();

  if (!s) return '';

  // "ISBN978..." / "ISBN-13: 978..." / "ISBN-10: ..." などを除去
  s = s.replace(/^ISBN(?:-1[03])?\s*:?\s*/i, '').trim();

  // Sheets経由で指数表記になった場合の救済
  // 例: 9.784592217145E12 → 9784592217145
  if (/^\d+(?:\.\d+)?E\+?\d+$/i.test(s)) {
    const n = Number(s);
    if (Number.isFinite(n)) {
      s = String(Math.round(n));
    }
  }

  // 数字とISBN-10末尾X以外を除去
  return s.replace(/[^0-9Xx]/g, '').toUpperCase();
}

/**
 * ISBN-10をISBN-13へ変換する
 * 画像URL生成など、ISBN-13が欲しい用途向け
 *
 * @param {string} isbn10
 * @returns {string}
 */
function convertIsbn10To13_(isbn10) {
  const s = normalizeIsbn_(isbn10);
  if (!/^\d{9}[\dX]$/.test(s)) return '';

  const base = '978' + s.slice(0, 9);
  let sum = 0;

  for (let i = 0; i < base.length; i++) {
    sum += Number(base[i]) * (i % 2 === 0 ? 1 : 3);
  }

  const checkDigit = (10 - (sum % 10)) % 10;
  return base + String(checkDigit);
}

/**
 * 画像URL生成向けにISBN-13へ寄せる
 *
 * @param {*} value
 * @returns {string}
 */
function normalizeIsbn13ForImage_(value) {
  const isbn = normalizeIsbn_(value);

  if (/^\d{13}$/.test(isbn)) return isbn;
  if (/^\d{9}[\dX]$/.test(isbn)) return convertIsbn10To13_(isbn);

  return '';
}


// ひらがな→カタカナ
function hiraToKana(str) {
  if (!str) return '';
  return str.replace(/[\u3041-\u3096]/g, c =>
    String.fromCharCode(c.charCodeAt(0) + 0x60)
  );
}
// すべての文字をひらがな化
function toHiragana(str) {
  if (!str) return '';
  return str.replace(/[\u30a1-\u30f6]/g, s =>
    String.fromCharCode(s.charCodeAt(0) - 0x60)
  );
}

/* ====== 命名・運用ルールまとめ ====== */
// - CONFIG.COL: シート列番号（1始まり）
// - CONFIG.IDX: 配列index（0始まり、getDisplayValues()用）
// - グローバル定数・関数はconfig.gsだけで宣言。他ファイルはimport不要
// - 副作用ある関数（シート操作など）は各ファイルに

/**
 * 「日本語タイトル = 英語タイトル ...」形式のとき、
 * シリーズ名候補として左側を優先して返す。
 * 該当しない場合は元の文字列を返す。
 *
 * @param {string} title
 * @returns {string}
 */
function extractPrimarySeriesTitle_(title) {
  if (!title) return '';

  let t = String(title).normalize('NFKC').replace(/　/g, ' ').trim();
  if (!t) return '';

  const parts = t.split(/\s*=\s*/);
  if (parts.length < 2) return t;

  const left = (parts[0] || '').trim();
  const right = parts.slice(1).join(' = ').trim();

  if (!left) return t;

  // 左側に日本語（漢字・ひらがな・カタカナ）が含まれていれば最優先採用
  if (/[\u3040-\u30ff\u3400-\u9fff]/.test(left)) {
    return left;
  }

  // 左が短いタイトル、右が英数字主体なら左を採用
  if (
    left.length <= 40 &&
    /[a-zA-Z]/.test(right) &&
    !/[\u3040-\u30ff\u3400-\u9fff]/.test(right)
  ) {
    return left;
  }

  return t;
}

/**
 * ジャンルから「資料系（画集・写真集・資料集）」か判定
 *
 * @param {string|string[]} genresRaw
 * @returns {boolean}
 */
function isExtraBookByGenres_(genresRaw) {
  if (!genresRaw) return false;

  const list = Array.isArray(genresRaw)
    ? genresRaw
    : String(genresRaw)
        .split(',')
        .map(v => v.trim())
        .filter(Boolean);

  return list.includes('写真集/画集/資料集');
}

/**
 * extra本用の series_key_auto を生成する。
 * 本編と混ざらないよう prefix を付ける。
 *
 * @param {string} title
 * @returns {string}
 */
function generateExtraSeriesKey_(title) {
  const base = generateSeriesKeyAuto(title);
  return base ? `__extra__${base}` : '__extra__';
}
