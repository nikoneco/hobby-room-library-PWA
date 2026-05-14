/** @OnlyCurrentDoc */
// ＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝
// Googleスプレッドシート管理ロジック
// ※定数・ユーティリティはすべて config.gs で一元管理！
// ＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝

/**
 * onEditトリガー：A1セルや検索モード等の編集イベントをモード分岐
 */
function onEdit(e) {
  if (!e || !e.range) return;

  const sh = e.range.getSheet();
  const sheetName = sh.getName();
  const notation = e.range.getA1Notation();
  const value = e.range.getValue();

  // AA列の手動画像URL補正は、複数列貼り付け時に他のonEdit処理を止めない。
  handleFallbackImageManualEdit_(e);

  const a1 = sh.getRange('A1');
  const row = e.range.getRow();
  const col = e.range.getColumn();
  const colEnd = col + e.range.getNumColumns() - 1;
  const { MAIN, SEARCH } = CONFIG.SHEETS;
  // Web検索データに影響するシート・セルが編集されたら検索キャッシュを破棄
  if (shouldClearLibrarySearchCacheOnEdit_(sheetName, e.range)) {
    clearLibrarySearchCache_();
  }
  // 本棚シート（A1）のモード切り替え
  if (sheetName === MAIN && notation === 'A1') {
    switch (value) {
      case 'Filter初期化':
        resetAndSortFilter();
        a1.setValue('機能選択');
        setDropdownNML();
        break;
      case 'ISBN入力モード':
        resetAndSortFilterISBN();
        break;
      case '入力モード終了':
        convertFormulasAndClearRange();
        resetAndSortFilter();
        a1.setValue('機能選択');
        setDropdownNML();
        break;
      case '検索モード':
        openSearchSheet();
        a1.setValue('機能選択');
        setDropdownNML();
        break;
      case '画像補完モード':
        fillMissingBookImagesFallback();
        highlightFillMode(sh);
        setDropdownFillMode();
        break;
      case '補完モード終了':
        convertFormulasAndClearRange();
        resetAndSortFilter();
        a1.setValue('機能選択');
        setDropdownNML();
        break;
    }
    return;
  }

  // 検索モードシートの戻る操作
  if (sheetName === SEARCH && notation === 'A1' && value === '本棚へ戻る') {
    returnToMainSheet();
    return;
  }
  // 検索モードシートの初期化ボタン（G1）
  if (sheetName === SEARCH && notation === 'G1') {
    resetSearchSheet(sh);
    return;
  }
  if (sheetName === MAIN && row >= 2) {
    markSynopsisManualOnEdit_(e);
  }

  if (
    sheetName === MAIN &&
    row >= 2 &&
    col <= CONFIG.COL.TITLE &&
    colEnd >= CONFIG.COL.TITLE
  ) {
    updateSeriesKeyAutoForEditedRange_(sh, e.range);
  }
}

/**
 * Webアプリ検索キャッシュを破棄すべき編集か判定する。
 * @param {string} sheetName
 * @param {GoogleAppsScript.Spreadsheet.Range} range
 * @returns {boolean}
 */
function shouldClearLibrarySearchCacheOnEdit_(sheetName, range) {
  if (!range) return false;

  const { MAIN, DATA, GENRE_MASTER, SERIES_MASTER } = CONFIG.SHEETS;

  if (sheetName === MAIN) return true;
  if (sheetName === GENRE_MASTER) return true;
  if (sheetName === SERIES_MASTER) return true;

  if (sheetName !== DATA) return false;

  const rowStart = range.getRow();
  const rowEnd = rowStart + range.getNumRows() - 1;
  const colStart = range.getColumn();
  const colEnd = colStart + range.getNumColumns() - 1;

  const touchesPublisherOptions = rowEnd >= 2 && colStart <= 2 && colEnd >= 2;
  const touchesMainLastRowCell = rowStart <= 2 && rowEnd >= 2 && colStart <= 12 && colEnd >= 12;

  return touchesPublisherOptions || touchesMainLastRowCell;
}


function updateSeriesKeyAutoForRow_(sheet, row) {

  const title = sheet.getRange(row, CONFIG.COL.TITLE).getValue();
  if (!title) return;   // 空なら何もしない

  const genresRaw = sheet.getRange(row, CONFIG.COL.GENRE).getValue();
  const key = isExtraBookByGenres_(genresRaw)
  ? generateExtraSeriesKey_(title)
  : generateSeriesKeyAuto(title);

  const cell = sheet.getRange(row, CONFIG.COL.SERIES_KEY_AUTO);
  const current = cell.getValue();

  if (current === key) return;   // 同じなら書かない（無駄onEdit防止）

  cell.setValue(key);
}

/**
 * タイトル列を含む編集範囲に対して、X列(series_key_auto)を行単位で更新する。
 * 複数行ペースト時も先頭行だけで止まらないようにする。
 * @param {GoogleAppsScript.Spreadsheet.Sheet} sheet
 * @param {GoogleAppsScript.Spreadsheet.Range} editedRange
 */
function updateSeriesKeyAutoForEditedRange_(sheet, editedRange) {
  const startRow = Math.max(editedRange.getRow(), 2);
  const endRow = editedRange.getRow() + editedRange.getNumRows() - 1;
  const rowCount = endRow - startRow + 1;
  if (rowCount <= 0) return;

  const titles = sheet
    .getRange(startRow, CONFIG.COL.TITLE, rowCount, 1)
    .getValues();
  const genres = sheet
    .getRange(startRow, CONFIG.COL.GENRE, rowCount, 1)
    .getValues();
  const keyRange = sheet
    .getRange(startRow, CONFIG.COL.SERIES_KEY_AUTO, rowCount, 1);
  const currentKeys = keyRange.getValues();

  let changed = false;
  const nextKeys = titles.map((row, i) => {
    const title = row[0] || '';
    const genresRaw = genres[i][0] || '';
    const key = title
      ? (isExtraBookByGenres_(genresRaw)
        ? generateExtraSeriesKey_(title)
        : generateSeriesKeyAuto(title))
      : '';

    if (currentKeys[i][0] !== key) changed = true;
    return [key];
  });

  if (changed) {
    keyRange.setValues(nextKeys);
  }
}

/**
 * FALLBACK_IMAGE_URL列を手編集した時に、FALLBACK_IMAGE_SOURCE列を自動補正する。
 *
 * 仕様:
 * - AA列に値を入れたら AB列を Manual にする
 * - AA列を空にした時、AB列が Manual ならABも空にする
 * - 2行目以降のみ対象
 * - 複数行貼り付けにも対応
 *
 * @param {GoogleAppsScript.Events.SheetsOnEdit} e
 * @returns {boolean} この関数で処理した場合 true
 */
function handleFallbackImageManualEdit_(e) {
  if (!e || !e.range) return false;

  const range = e.range;
  const sheet = range.getSheet();

  if (sheet.getName() !== CONFIG.SHEETS.MAIN) return false;
  if (!CONFIG.COL.FALLBACK_IMAGE_URL || !CONFIG.COL.FALLBACK_IMAGE_SOURCE) return false;

  const editedStartCol = range.getColumn();
  const editedEndCol = editedStartCol + range.getNumColumns() - 1;

  const fallbackUrlCol = CONFIG.COL.FALLBACK_IMAGE_URL;
  const fallbackSourceCol = CONFIG.COL.FALLBACK_IMAGE_SOURCE;

  // 編集範囲にAA列が含まれないなら対象外
  if (fallbackUrlCol < editedStartCol || fallbackUrlCol > editedEndCol) {
    return false;
  }

  const startRow = range.getRow();
  const numRows = range.getNumRows();

  // ヘッダ行だけなら対象外
  if (startRow + numRows - 1 < 2) return false;

  const targetStartRow = Math.max(startRow, 2);
  const targetNumRows = startRow + numRows - targetStartRow;

  if (targetNumRows <= 0) return false;

  const urlValues = sheet
    .getRange(targetStartRow, fallbackUrlCol, targetNumRows, 1)
    .getDisplayValues();

  const sourceRange = sheet
    .getRange(targetStartRow, fallbackSourceCol, targetNumRows, 1);

  const sourceValues = sourceRange.getDisplayValues();

  let changed = false;

  const nextSourceValues = sourceValues.map((row, i) => {
    const url = String(urlValues[i][0] || '').trim();
    const source = String(row[0] || '').trim();

    // AAに何か入ったら、人間の手入力としてManualにする
    if (url) {
      if (source !== 'Manual') {
        changed = true;
        return ['Manual'];
      }
      return [source];
    }

    // AAを空にした時、Manualだけは連動して空に戻す
    if (!url && source === 'Manual') {
      changed = true;
      return [''];
    }

    return [source];
  });

  if (changed) {
    sourceRange.setValues(nextSourceValues);
    clearLibrarySearchCache_();
  }

  return true;
}


/**
 * 目録データ行をタイトル列でソートする。
 * B:ABを一体でソートし、Y/Zあらすじ管理列・AA/AB Web画像管理列の行ズレを防ぐ。
 * @param {GoogleAppsScript.Spreadsheet.Sheet} sheet
 * @param {number} lastRow
 */
function sortMainRowsByTitle_(sheet, lastRow) {
  const sortStartCol = 2; // B
  const sortColCount = CONFIG.COL.MAX - sortStartCol + 1; // B:AB

  sheet
    .getRange(2, sortStartCol, lastRow - 1, sortColCount)
    .sort([
      {
        column: CONFIG.COL.TITLE,
        ascending: true
      }
    ]);
}

/**
 * W列ジャンルのARRAYFORMULAを、B:Zソート前に一時退避する。
 * W2:Wのスピル範囲を含むままではB:Zソートできないため。
 * @param {GoogleAppsScript.Spreadsheet.Sheet} sheet
 * @returns {string} 退避した数式。数式が無い場合は空文字。
 */
function detachGenreFormulaForSort_(sheet) {
  const formulaCell = sheet.getRange(1, CONFIG.COL.GENRE);
  const formula = formulaCell.getFormula();
  if (!formula) return '';

  formulaCell.clearContent();
  SpreadsheetApp.flush();
  return formula;
}

/**
 * B:Zソート後、退避していたW列ジャンルのARRAYFORMULAを復元する。
 * @param {GoogleAppsScript.Spreadsheet.Sheet} sheet
 * @param {string} formula
 */
function restoreGenreFormulaAfterSort_(sheet, formula) {
  if (!formula) return;

  sheet.getRange(1, CONFIG.COL.GENRE).setFormula(formula);
  SpreadsheetApp.flush();
}


/**
 * フィルター＆ソート補助
 * B:Zソート本体は sortMainRowsByTitle_() に集約する。
 */
function colInRange_(sheetCol, rangeStartCol) {
  return sheetCol - rangeStartCol + 1; // sort用（Range内の相対列）
}

function resetAndSortFilter() {
  const sheet = getSheet(CONFIG.SHEETS.MAIN);

  ensureSynopsisColumns_(sheet);

  const filter = sheet.getFilter();
  if (filter) filter.remove();

  const last = getLastDataRow(sheet, CONFIG.COL.TITLE);
  if (last < 2) return;

  // W列はARRAYFORMULAのため、B:ABソート前に一時的に外す。
  // Y/Z/AA/ABはB:ABに含めて、タイトル・ISBN等と一体で動かす。
  const genreFormula = detachGenreFormulaForSort_(sheet);

  try {
    sortMainRowsByTitle_(sheet, last);
  } finally {
    restoreGenreFormulaAfterSort_(sheet, genreFormula);
  }

  // フィルター範囲は B:AB まで
  const filterStartCol = 2; // B
  const filterColCount = CONFIG.COL.MAX - filterStartCol + 1;
  const fullRange = sheet.getRange(
    1,
    filterStartCol,
    sheet.getMaxRows(),
    filterColCount
  );

  const newFilter = fullRange.createFilter();

  // ここは現行と同じくシート列番号 I=9 でOK
  const rule = SpreadsheetApp
    .newFilterCriteria()
    .whenCellNotEmpty()
    .build();

  newFilter.setColumnFilterCriteria(CONFIG.COL.TITLE, rule);
}


/**
 * ISBN入力モード用フィルター＆ハイライト
 *  - ISBN入力中だけ用の色味・ドロップダウン等
 */
function resetAndSortFilterISBN() {
  const sheet = getSheet(CONFIG.SHEETS.MAIN);

  ensureSynopsisColumns_(sheet);

  const filter = sheet.getFilter();
  if (filter) filter.remove();

  const last = getLastDataRow(sheet, CONFIG.COL.TITLE);
  if (last < 2) {
    highlightISBNMode(sheet);
    setDropdownISBN();
    return;
  }

  // ISBN入力モードでも、B:ABを一体でソートしてY/Z/AA/ABの行ズレを防ぐ。
  const genreFormula = detachGenreFormulaForSort_(sheet);

  try {
    sortMainRowsByTitle_(sheet, last);
  } finally {
    restoreGenreFormulaAfterSort_(sheet, genreFormula);
  }

  highlightISBNMode(sheet);
  setDropdownISBN();
}

/**
 * 画像補完：ISBNから画像URL補完
 *  - 画像列が空欄で、ISBNが存在する行に対して一括補完
 */
function fillMissingBookImagesFallback() {
  const sh = getSheet(CONFIG.SHEETS.MAIN);
  const last = getLastDataRow(sh, CONFIG.COL.ISBN);
  const isbnList = sh.getRange(2, CONFIG.COL.ISBN, last - 1).getValues();
  const jVals = sh.getRange(2, CONFIG.COL.IMAGE, last - 1).getDisplayValues();

  for (let i = 0; i < isbnList.length; i++) {
    const isbn = normalizeIsbn_(isbnList[i][0]);
    const j = jVals[i][0];

    if (!isbn || j !== '') continue;

    const url = getImageUrlByISBN(isbn);
    if (url) sh.getRange(i + 2, CONFIG.COL.IMAGE).setFormula(`=IMAGE("${url}")`);
  }

  const jr = sh.getRange(2, CONFIG.COL.IMAGE, last - 1);
  jr.copyTo(jr, { contentsOnly: true });

  SpreadsheetApp.flush();
  clearLibrarySearchCache_();
  SpreadsheetApp.getActive().toast('画像補完が完了しました');
}

/**
 * ISBN→画像URL補完（OpenBD→GoogleBooks順に取得）
 */
function getImageUrlByISBN(isbn) {
  const safeIsbn = normalizeIsbn13ForImage_(isbn);
  if (!safeIsbn) return null;

  const han = `https://hanmoto.com/bd/img/${safeIsbn}_400.jpg`;
  if (urlExists(han)) return han;

  try {
    const ob = UrlFetchApp.fetch(`https://api.openbd.jp/v1/get?isbn=${safeIsbn}`, { muteHttpExceptions: true });
    const cover = JSON.parse(ob.getContentText())[0]?.summary?.cover;
    if (cover && urlExists(cover)) return cover;
  } catch (e) {}

  try {
    const gb = UrlFetchApp.fetch(`https://www.googleapis.com/books/v1/volumes?q=isbn:${safeIsbn}`, { muteHttpExceptions: true });
    const thumb = JSON.parse(gb.getContentText())?.items?.[0]?.volumeInfo?.imageLinks?.thumbnail;
    if (thumb && urlExists(thumb.replace(/^http:/, 'https:')))
      return thumb.replace(/^http:/, 'https:');
  } catch (e) {}

  return null;
}

/**
 * ISBNや画像列の式→値変換＆クリア
 *  - ISBN、画像、著者列等をdisplayValuesで書き戻し
 *  - サブ範囲はクリア
 */
function convertFormulasAndClearRange() {
  const sh = getSheet(CONFIG.SHEETS.MAIN);
  const last = getLastDataRow(sh, CONFIG.COL.ISBN);
  const rows = last - 1;

  sh.getRange(2, CONFIG.COL.TITLE , rows, 1).setValues(
    sh.getRange(2, CONFIG.COL.TITLE , rows, 1).getDisplayValues());

  const jRange = sh.getRange(2, CONFIG.COL.IMAGE, rows, 1);
  jRange.copyTo(jRange, { contentsOnly: true });

  sh.getRange(2, CONFIG.COL.AUTHOR, rows, 8).setValues(
    sh.getRange(2, CONFIG.COL.AUTHOR, rows, 8).getDisplayValues());

  sh.getRange(2, 2, rows, 7).clearContent();

  resetSheetStyle(sh);
  SpreadsheetApp.flush();
  clearLibrarySearchCache_();
}

/**
 * ドロップダウン切り替え：通常/ISBN/画像補完
 */
function setDropdownNML()  { setDropdownFromList(DROPDOWN_VALUES.NML);  }
function setDropdownISBN() { setDropdownFromList(DROPDOWN_VALUES.ISBN); }
function setDropdownFillMode() { setDropdownFromList(DROPDOWN_VALUES.FILL); }
function setDropdownFromList(values) {
  const cell = getSheet(CONFIG.SHEETS.MAIN).getRange('A1');
  cell.clearDataValidations();
  const rule = SpreadsheetApp.newDataValidation().requireValueInList(values, true).build();
  cell.setDataValidation(rule);
}

/**
 * 行全体の背景色リセット・モードごとのハイライト
 */
function highlightISBNMode(sheet) {
  const r = getLastDataRow(sheet, CONFIG.COL.ISBN);
  const c = sheet.getLastColumn();
  sheet.getRange(1, 1, r, c).setBackground('#FFF8DC').setFontColor('#003366');
}
function highlightFillMode(sheet) {
  const r = getLastDataRow(sheet, CONFIG.COL.ISBN);
  const c = sheet.getLastColumn();
  sheet.getRange(1, 1, r, c).setBackground('#E0F7FA').setFontColor('#004D40');
}
function resetSheetStyle(sheet) {
  const r = getLastDataRow(sheet, CONFIG.COL.ISBN);
  const c = sheet.getLastColumn();
  sheet.getRange(1, 1, r, c).setBackground(null).setFontColor(null)
       .setFontWeight(null).setFontStyle(null).setFontLine(null);
}

/**
 * 検索モード切り替え・戻る操作
 */
function openSearchSheet() {
  const main = getSheet(CONFIG.SHEETS.MAIN);
  const search = getSheet(CONFIG.SHEETS.SEARCH);
  search.showSheet(); main.hideSheet();
  resetSearchSheet(search);
}
function returnToMainSheet() {
  const main = getSheet(CONFIG.SHEETS.MAIN);
  const search = getSheet(CONFIG.SHEETS.SEARCH);
  main.showSheet(); search.hideSheet();
  resetSearchSheet(search);
  main.getRange('A1').setValue('機能選択');
  resetAndSortFilter();
}
function resetSearchSheet(sheet) {
  const r = sheet.getRangeList(['A1','B1','D1','G1']).getRanges();
  r[0].setValue('検索モード');
  r[1].clearContent();
  r[2].clearContent();
  r[3].uncheck();
}

/**
 * ユーティリティ：シート取得・最終データ行取得・URL存在判定
 */
function getSheet(name) {
  const s = SpreadsheetApp.getActive().getSheetByName(name);
  if (!s) throw new Error(`Sheet "${name}" not found`);
  return s;
}
function getLastDataRow(sheet, col) {
  const maxRows = sheet.getMaxRows();
  const vals = sheet.getRange(2, col, maxRows - 1, 1).getValues();
  for (let i = vals.length - 1; i >= 0; i--) if (vals[i][0] !== '') return i + 2;
  return 1;
}
function urlExists(url) {
  try {
    const head = UrlFetchApp.fetch(url, {
      method: 'head',
      muteHttpExceptions: true,
      followRedirects: true
    });

    const code = head.getResponseCode();
    if (code >= 200 && code < 400) return true;

    if (code !== 403 && code !== 405) return false;

    const get = UrlFetchApp.fetch(url, {
      method: 'get',
      muteHttpExceptions: true,
      followRedirects: true
    });

    const getCode = get.getResponseCode();
    return getCode >= 200 && getCode < 400;
  } catch (e) {
    return false;
  }
}


/**
 * タイトルから series_key_auto を生成する
 * 目的:
 *  - 巻数違いを同一シリーズに寄せる
 *  - 特装版/限定版などを除去する
 *  - 「日本語 = 英語タイトル」形式は日本語側を優先する
 *
 * @param {string} title
 * @returns {string}
 */
function generateSeriesKeyAuto(title) {
  if (!title) return '';

  let t = extractPrimarySeriesTitle_(title);

  // 基本正規化
  t = String(t).normalize('NFKC');
  t = t.replace(/　/g, ' ');
  t = t.trim().toLowerCase();

  // 版種・付属品系の語を除去
  t = t.replace(
    /(特装版|限定版|通常版|小冊子付き|ドラマcd付き|cd付き|blu-ray付き|dvd付き|フィギュア付き|特典付き)/gi,
    ''
  );

  // 末尾の巻数表現を除去
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

  // 空白整理
  t = t.replace(/\s+/g, ' ').trim();

  // 語尾のドット除去
  t = t.replace(/[\.．。]+$/g, '');

  // 全体の不要ドット除去
  t = t.replace(/[\.．。]/g, '');

  t = t.replace(/\s*[:：]\s*$/g, '');
  t = t.trim();


  // カタカナ → ひらがな
  t = t.replace(/[\u30a1-\u30f6]/g, s =>
    String.fromCharCode(s.charCodeAt(0) - 0x60)
  );

  return t;
}


/**
 * 目録シートの X列(series_key_auto) を既存データから一括生成する
 * 資料系（写真集/画集/資料集）は __extra__ プレフィックス付きで本編から分離する
 */
function fillSeriesKeyAutoAll() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet()
    .getSheetByName(CONFIG.SHEETS.MAIN);

  const lastRow = getLastDataRow(sheet, CONFIG.COL.TITLE);
  if (lastRow < 2) return;

  const titleCol = CONFIG.COL.TITLE;
  const genreCol = CONFIG.COL.GENRE;
  const seriesKeyCol = CONFIG.COL.SERIES_KEY_AUTO;

  const values = sheet
    .getRange(2, 1, lastRow - 1, Math.max(titleCol, genreCol))
    .getValues();

  const output = values.map(row => {
    const title = row[titleCol - 1] || '';
    const genresRaw = row[genreCol - 1] || '';

    const key = isExtraBookByGenres_(genresRaw)
      ? generateExtraSeriesKey_(title)
      : generateSeriesKeyAuto(title);

    return [key];
  });

  sheet
    .getRange(2, seriesKeyCol, output.length, 1)
    .setValues(output);
}
