/** @OnlyCurrentDoc */
// ＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝
// Googleスプレッドシート管理ロジック
// ※定数・ユーティリティはすべて config.gs で一元管理！
// ＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝

/**
 * onEditトリガー：A1セル等の編集イベントをモード分岐
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
  const { MAIN } = CONFIG.SHEETS;
  const shouldClearSearchCache = shouldClearLibrarySearchCacheOnEdit_(sheetName, e.range);
  // 本棚シート（A1）のモード切り替え
  if (sheetName === MAIN && notation === 'A1') {
    switch (value) {
      case 'Filter初期化':
        resetAndSortFilter_();
        a1.setValue('機能選択');
        setDropdownNML_();
        break;
      case 'ISBN入力モード':
        resetAndSortFilterISBN_();
        break;
      case '入力モード終了':
        convertFormulasAndClearRange_();
        resetAndSortFilter_();
        a1.setValue('機能選択');
        setDropdownNML_();
        break;
    }
    if (shouldClearSearchCache) clearLibrarySearchCache_();
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

  if (
    sheetName === MAIN &&
    row >= 2 &&
    (
      (col <= CONFIG.COL.TITLE && colEnd >= CONFIG.COL.TITLE) ||
      (col <= CONFIG.COL.SERIES_KEY_AUTO && colEnd >= CONFIG.COL.SERIES_KEY_AUTO) ||
      (col <= CONFIG.COL.BOOK_UUID && colEnd >= CONFIG.COL.BOOK_UUID)
    )
  ) {
    ensureBookUuidsForEditedRange_(sh, e.range);
  }

  // 派生列の更新後に破棄し、更新途中のデータが新キャッシュへ戻る窓を狭める。
  if (shouldClearSearchCache) clearLibrarySearchCache_();
}

function createUniqueBookUuid_(usedUuids) {
  const used = usedUuids || new Set();
  for (let attempt = 0; attempt < 20; attempt++) {
    const uuid = createBookUuid_();
    if (used.has(uuid)) continue;
    used.add(uuid);
    return uuid;
  }
  throw new Error('Failed to allocate a unique book UUID');
}

/**
 * UUID補完・重複修復の純粋な計画を作る。
 * targetIndexesを省略した場合は、タイトルがある全行を対象にする。
 * @param {Array<*>} titles
 * @param {Array<*>} currentUuids
 * @param {number[]=} targetIndexes 0始まり
 * @returns {Object}
 */
function buildBookUuidRepairPlan_(titles, currentUuids, targetIndexes) {
  const titleValues = (Array.isArray(titles) ? titles : []).map(value =>
    Array.isArray(value) ? value[0] : value
  );
  const uuidValues = (Array.isArray(currentUuids) ? currentUuids : []).map(value =>
    Array.isArray(value) ? value[0] : value
  );
  const length = Math.max(titleValues.length, uuidValues.length);
  const output = Array.from({ length }, (_, index) => [String(uuidValues[index] || '')]);
  const targets = Array.isArray(targetIndexes)
    ? targetIndexes.filter(index => Number.isInteger(index) && index >= 0 && index < length)
    : Array.from({ length }, (_, index) => index);
  const targetSet = new Set(targets);
  const occurrences = new Map();
  const used = new Set();

  for (let index = 0; index < length; index++) {
    const uuid = normalizeBookUuid_(uuidValues[index]);
    if (!isValidBookUuid_(uuid)) continue;
    used.add(uuid);
    if (!occurrences.has(uuid)) occurrences.set(uuid, []);
    occurrences.get(uuid).push(index);
  }

  const keptTargetIds = new Set();
  const result = {
    values: output,
    changedIndices: [],
    created: 0,
    repairedDuplicates: 0,
    repairedInvalid: 0,
    normalized: 0
  };

  targets.forEach(index => {
    if (!String(titleValues[index] || '').trim()) return;

    const raw = String(uuidValues[index] || '');
    const normalized = normalizeBookUuid_(raw);
    const valid = isValidBookUuid_(normalized);
    let needsNewUuid = !valid;
    let reason = valid ? '' : (normalized ? 'invalid' : 'created');

    if (valid) {
      const matchingIndexes = occurrences.get(normalized) || [];
      const hasNonTargetOccurrence = matchingIndexes.some(otherIndex => !targetSet.has(otherIndex));
      if (
        matchingIndexes.length > 1 &&
        (hasNonTargetOccurrence || keptTargetIds.has(normalized))
      ) {
        needsNewUuid = true;
        reason = 'duplicate';
      } else {
        keptTargetIds.add(normalized);
      }
    }

    let nextUuid = normalized;
    if (needsNewUuid) {
      nextUuid = createUniqueBookUuid_(used);
      if (reason === 'duplicate') result.repairedDuplicates++;
      else if (reason === 'invalid') result.repairedInvalid++;
      else result.created++;
    } else if (raw !== normalized) {
      result.normalized++;
    }

    if (raw !== nextUuid) {
      output[index] = [nextUuid];
      result.changedIndices.push(index);
    }
  });

  result.changed = result.changedIndices.length;
  return result;
}

function ensureBookUuidsForEditedRange_(sheet, editedRange) {
  const lastRow = Math.max(
    getLastDataRow(sheet, CONFIG.COL.TITLE),
    editedRange.getRow() + editedRange.getNumRows() - 1
  );
  if (lastRow < 2) return { checked: 0, changed: 0 };

  const rowCount = lastRow - 1;
  const titles = sheet.getRange(2, CONFIG.COL.TITLE, rowCount, 1).getValues();
  const uuidRange = sheet.getRange(2, CONFIG.COL.BOOK_UUID, rowCount, 1);
  const currentUuids = uuidRange.getValues();
  const startIndex = Math.max(0, editedRange.getRow() - 2);
  const endIndex = Math.min(rowCount - 1, editedRange.getRow() + editedRange.getNumRows() - 3);
  const targetIndexes = [];
  for (let index = startIndex; index <= endIndex; index++) targetIndexes.push(index);

  const plan = buildBookUuidRepairPlan_(titles, currentUuids, targetIndexes);
  if (plan.changed > 0) {
    const writeValues = plan.values.slice(startIndex, endIndex + 1);
    sheet.getRange(startIndex + 2, CONFIG.COL.BOOK_UUID, writeValues.length, 1)
      .setValues(writeValues);
  }

  return Object.assign({ checked: targetIndexes.length }, plan);
}

function repairBookUuidsAll_(sheet) {
  const sh = sheet || getSheet(CONFIG.SHEETS.MAIN);
  const headerCell = sh.getRange(1, CONFIG.COL.BOOK_UUID);
  const headerUpdated = String(headerCell.getDisplayValue() || '').trim() !== 'UUID';
  if (headerUpdated) headerCell.setValue('UUID');

  const lastRow = getLastDataRow(sh, CONFIG.COL.TITLE);
  if (lastRow < 2) {
    return { checked: 0, changed: 0, headerUpdated };
  }

  const rowCount = lastRow - 1;
  const titles = sh.getRange(2, CONFIG.COL.TITLE, rowCount, 1).getValues();
  const uuidRange = sh.getRange(2, CONFIG.COL.BOOK_UUID, rowCount, 1);
  const plan = buildBookUuidRepairPlan_(titles, uuidRange.getValues());
  if (plan.changed > 0) uuidRange.setValues(plan.values);

  return Object.assign({ checked: rowCount, headerUpdated }, plan);
}

/**
 * 既存蔵書のV列(UUID)を一括補完する保守用関数。
 * GASエディタから明示的に実行する。既存の有効なUUIDは変更しない。
 */
function fillMissingBookUuidsAll_() {
  const result = repairBookUuidsAll_(getSheet(CONFIG.SHEETS.MAIN));
  if (result.changed > 0 || result.headerUpdated) {
    SpreadsheetApp.flush();
    clearLibrarySearchCache_();
  }
  return result;
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

function resetAndSortFilter_() {
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
function resetAndSortFilterISBN_() {
  const sheet = getSheet(CONFIG.SHEETS.MAIN);

  ensureSynopsisColumns_(sheet);

  const filter = sheet.getFilter();
  if (filter) filter.remove();

  const last = getLastDataRow(sheet, CONFIG.COL.TITLE);
  if (last < 2) {
    highlightISBNMode_(sheet);
    setDropdownISBN_();
    return;
  }

  // ISBN入力モードでも、B:ABを一体でソートしてY/Z/AA/ABの行ズレを防ぐ。
  const genreFormula = detachGenreFormulaForSort_(sheet);

  try {
    sortMainRowsByTitle_(sheet, last);
  } finally {
    restoreGenreFormulaAfterSort_(sheet, genreFormula);
  }

  highlightISBNMode_(sheet);
  setDropdownISBN_();
}

/**
 * ISBNや画像列の式→値変換＆クリア
 *  - ISBN、画像、著者列等をdisplayValuesで書き戻し
 *  - サブ範囲はクリア
 */
function convertFormulasAndClearRange_() {
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

  resetSheetStyle_(sh);
  SpreadsheetApp.flush();
  clearLibrarySearchCache_();
}

/**
 * ドロップダウン切り替え：通常/ISBN
 */
function setDropdownNML_()  { setDropdownFromList_(DROPDOWN_VALUES.NML);  }
function setDropdownISBN_() { setDropdownFromList_(DROPDOWN_VALUES.ISBN); }
function setDropdownFromList_(values) {
  const cell = getSheet(CONFIG.SHEETS.MAIN).getRange('A1');
  cell.clearDataValidations();
  const rule = SpreadsheetApp.newDataValidation().requireValueInList(values, true).build();
  cell.setDataValidation(rule);
}

/**
 * 行全体の背景色リセット・モードごとのハイライト
 */
function highlightISBNMode_(sheet) {
  const r = getLastDataRow(sheet, CONFIG.COL.ISBN);
  const c = sheet.getLastColumn();
  sheet.getRange(1, 1, r, c).setBackground('#FFF8DC').setFontColor('#003366');
}
function resetSheetStyle_(sheet) {
  const r = getLastDataRow(sheet, CONFIG.COL.ISBN);
  const c = sheet.getLastColumn();
  sheet.getRange(1, 1, r, c).setBackground(null).setFontColor(null)
       .setFontWeight(null).setFontStyle(null).setFontLine(null);
}

/**
 * ユーティリティ：シート取得・最終データ行取得
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
function fillSeriesKeyAutoAll_() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet()
    .getSheetByName(CONFIG.SHEETS.MAIN);

  const lastRow = getLastDataRow(sheet, CONFIG.COL.TITLE);
  if (lastRow < 2) return repairBookUuidsAll_(sheet);

  const titleCol = CONFIG.COL.TITLE;
  const genreCol = CONFIG.COL.GENRE;
  const seriesKeyCol = CONFIG.COL.SERIES_KEY_AUTO;

  const values = sheet
    .getRange(2, 1, lastRow - 1, Math.max(titleCol, genreCol, seriesKeyCol))
    .getValues();

  const output = values.map(row => {
    const title = row[titleCol - 1] || '';
    const genresRaw = row[genreCol - 1] || '';

    const key = isExtraBookByGenres_(genresRaw)
      ? generateExtraSeriesKey_(title)
      : generateSeriesKeyAuto(title);

    return [key];
  });

  const currentOutput = values.map(row => [row[seriesKeyCol - 1] || '']);
  const changed = output.some((row, index) => row[0] !== currentOutput[index][0]);
  if (changed) {
    sheet
      .getRange(2, seriesKeyCol, output.length, 1)
      .setValues(output);
  }

  const bookUuids = repairBookUuidsAll_(sheet);
  if (changed || bookUuids.changed > 0 || bookUuids.headerUpdated) {
    SpreadsheetApp.flush();
    clearLibrarySearchCache_();
  }
  return {
    updatedRows: changed ? output.length : 0,
    bookUuids
  };
}
