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
  // A1 commands run in the dedicated installable trigger (SheetModes.js).
  // Do not execute them twice or spend the simple trigger's 30-second budget.
  if (sheetName === CONFIG.SHEETS.MAIN && notation === 'A1') return;

  // AA列の手動画像URL補正は、複数列貼り付け時に他のonEdit処理を止めない。
  handleFallbackImageManualEdit_(e);

  const row = e.range.getRow();
  const col = e.range.getColumn();
  const colEnd = col + e.range.getNumColumns() - 1;
  const { MAIN } = CONFIG.SHEETS;
  const seriesRegistryActive = isSeriesRegistryV2Active_();
  const shouldClearSearchCache = shouldClearLibrarySearchCacheOnEdit_(sheetName, e.range);
  const rowEnd = row + e.range.getNumRows() - 1;
  const touchesMainTitle =
    sheetName === MAIN &&
    rowEnd >= 2 &&
    col <= CONFIG.COL.TITLE &&
    colEnd >= CONFIG.COL.TITLE;
  const touchesMainSeriesKey =
    sheetName === MAIN &&
    rowEnd >= 2 &&
    col <= CONFIG.COL.SERIES_KEY_AUTO &&
    colEnd >= CONFIG.COL.SERIES_KEY_AUTO;
  const touchesSeriesRegistryMaster =
    seriesRegistryActive &&
    sheetName === SERIES_REGISTRY_CONFIG_.MASTER_SHEET &&
    rowEnd >= 2 &&
    col <= 11 &&
    colEnd >= 2;
  const touchesSeriesRegistryAlias =
    seriesRegistryActive &&
    sheetName === SERIES_REGISTRY_CONFIG_.ALIAS_SHEET &&
    rowEnd >= 2 &&
    col <= 4 &&
    colEnd >= 1;
  let oldSeriesKeys = null;
  let seriesEditStartRow = 0;
  let seriesEditRowCount = 0;
  if (seriesRegistryActive && touchesMainTitle) {
    seriesEditStartRow = Math.max(row, 2);
    const seriesEditEndRow = Math.max(seriesEditStartRow, rowEnd);
    seriesEditRowCount = seriesEditEndRow - seriesEditStartRow + 1;
    oldSeriesKeys = sh
      .getRange(seriesEditStartRow, CONFIG.COL.SERIES_KEY_AUTO, seriesEditRowCount, 1)
      .getDisplayValues();
  }
  if (sheetName === MAIN && row >= 2) {
    markSynopsisManualOnEdit_(e);
  }

  let seriesKeyRefreshError = null;
  if (touchesSeriesRegistryMaster) {
    try {
      ensureSeriesRegistryExtraAliases_();
      refreshSeriesKeyAutoAfterDerivedChange_(getSheet(MAIN));
      syncSeriesRegistryFromCatalog_();
    } catch (error) {
      seriesKeyRefreshError = error;
      console.error('series registry refresh failed after master edit:', error);
    }
  } else if (touchesSeriesRegistryAlias) {
    try {
      refreshSeriesKeyAutoAfterDerivedChange_(getSheet(MAIN));
    } catch (error) {
      seriesKeyRefreshError = error;
      console.error('series registry refresh failed after alias edit:', error);
    }
  } else if (touchesMainTitle) {
    updateSeriesKeyAutoForEditedRange_(sh, e.range);
    if (seriesRegistryActive) {
      try {
        const registrySyncResult = syncSeriesRegistryAfterTitleEdit_(
          sh,
          seriesEditStartRow,
          seriesEditRowCount,
          oldSeriesKeys
        );
        ensureSeriesRegistryExtraAliases_();
        if (!registrySyncResult.conflicts) {
          updateSeriesKeyAutoForEditedRange_(sh, e.range);
        } else {
          const conflictRows = new Set(registrySyncResult.conflictRows || []);
          for (let index = 0; index < seriesEditRowCount; index++) {
            const targetRow = seriesEditStartRow + index;
            if (!conflictRows.has(targetRow)) {
              updateSeriesKeyAutoForEditedRange_(
                sh,
                sh.getRange(targetRow, CONFIG.COL.TITLE, 1, 1)
              );
            }
          }
        }
      } catch (error) {
        seriesKeyRefreshError = error;
        console.error('series registry title-link refresh failed:', error);
      }
    }
  } else if (seriesRegistryActive && touchesMainSeriesKey) {
    try {
      const seriesKeyStartRow = Math.max(row, 2);
      syncSeriesRegistryAfterManualKeyEdit_(
        sh,
        seriesKeyStartRow,
        rowEnd - seriesKeyStartRow + 1
      );
    } catch (error) {
      seriesKeyRefreshError = error;
      console.error('series registry sync failed after manual series-key edit:', error);
    }
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
  if (seriesKeyRefreshError) throw seriesKeyRefreshError;
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

  const { MAIN, DATA, GENRE_MASTER } = CONFIG.SHEETS;

  if (sheetName === MAIN) return true;
  if (sheetName === GENRE_MASTER) return true;
  if (sheetName === SERIES_REGISTRY_CONFIG_.MASTER_SHEET) return true;
  if (sheetName === SERIES_REGISTRY_CONFIG_.ALIAS_SHEET) return true;

  if (sheetName !== DATA) return false;

  const rowStart = range.getRow();
  const rowEnd = rowStart + range.getNumRows() - 1;
  const colStart = range.getColumn();
  const colEnd = colStart + range.getNumColumns() - 1;

  const touchesPublisherOptions = rowEnd >= 2 && colStart <= 2 && colEnd >= 2;
  const touchesMainLastRowCell = rowStart <= 2 && rowEnd >= 2 && colStart <= 12 && colEnd >= 12;

  return touchesPublisherOptions || touchesMainLastRowCell;
}


function normalizeSeriesLookupKey_(value) {
  return String(value || '')
    .replace(/　/g, ' ')
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

/**
 * 目録W列のARRAYFORMULAと同じ規則で、タイトルからシリーズ検索キーを作る。
 * W列はタイトルの先頭空白区切り要素だけをXLOOKUPへ渡している。
 */
function extractSeriesLookupKeyFromTitle_(title) {
  const normalized = normalizeSeriesLookupKey_(title);
  if (!normalized) return '';

  return normalized.split(' ')[0];
}

function loadSeriesRegistryExtraLookup_() {
  const registry = loadSeriesRegistryLookup_();
  if (!registry) {
    throw new Error('series_master_v2 / series_alias_v2 registry is not active');
  }
  return buildSeriesRegistryExtraLookup_(registry);
}

function buildSeriesKeyAutoRepairPlan_(titles, genres, currentKeys, extraLookup) {
  const titleValues = Array.isArray(titles) ? titles : [];
  const genreValues = Array.isArray(genres) ? genres : [];
  const keyValues = Array.isArray(currentKeys) ? currentKeys : [];
  const rowCount = Math.max(titleValues.length, genreValues.length, keyValues.length);
  const lookup = extraLookup instanceof Map ? extraLookup : null;
  const values = [];
  const changedIndices = [];
  let extraCount = 0;

  for (let index = 0; index < rowCount; index++) {
    const titleRow = titleValues[index];
    const genreRow = genreValues[index];
    const keyRow = keyValues[index];
    const title = String(Array.isArray(titleRow) ? titleRow[0] || '' : titleRow || '');
    const genresRaw = Array.isArray(genreRow) ? genreRow[0] || '' : genreRow || '';
    const currentKey = String(Array.isArray(keyRow) ? keyRow[0] || '' : keyRow || '');
    const baseKey = title ? generateSeriesKeyAuto(title) : '';
    const lookupKey = extractSeriesLookupKeyFromTitle_(title);
    const isExtra = lookup
      ? (
          lookup.get(normalizeSeriesLookupKey_(baseKey)) === true ||
          lookup.get(lookupKey) === true
        )
      : isExtraBookByGenres_(genresRaw);
    const nextKey = title
      ? (isExtra ? generateExtraSeriesKey_(title) : baseKey)
      : '';

    if (isExtra && title) extraCount++;
    values.push([nextKey]);
    if (currentKey !== nextKey) changedIndices.push(index);
  }

  return {
    values,
    changedIndices,
    changed: changedIndices.length,
    extraCount
  };
}

/**
 * 変更行だけを連続範囲へまとめて書く。変更なしではsetValuesを呼ばない。
 */
function writeSeriesKeyAutoRepairPlan_(sheet, startRow, plan) {
  const changedIndices = Array.isArray(plan && plan.changedIndices)
    ? plan.changedIndices
    : [];
  const updatedRanges = [];
  if (!changedIndices.length) return updatedRanges;

  let runStart = changedIndices[0];
  let runEnd = runStart;

  const writeRun = function(firstIndex, lastIndex) {
    const rowCount = lastIndex - firstIndex + 1;
    const firstRow = startRow + firstIndex;
    sheet
      .getRange(firstRow, CONFIG.COL.SERIES_KEY_AUTO, rowCount, 1)
      .setValues(plan.values.slice(firstIndex, lastIndex + 1));
    updatedRanges.push({
      startRow: firstRow,
      endRow: firstRow + rowCount - 1
    });
  };

  for (let index = 1; index < changedIndices.length; index++) {
    const current = changedIndices[index];
    if (current === runEnd + 1) {
      runEnd = current;
      continue;
    }
    writeRun(runStart, runEnd);
    runStart = current;
    runEnd = current;
  }
  writeRun(runStart, runEnd);
  return updatedRanges;
}

function buildSeriesKeyAutoSheetPlan_(sheet, startRow, rowCount, extraLookup) {
  if (rowCount <= 0) {
    return {
      values: [],
      changedIndices: [],
      changed: 0,
      extraCount: 0,
      checked: 0,
      startRow
    };
  }

  const titles = sheet
    .getRange(startRow, CONFIG.COL.TITLE, rowCount, 1)
    .getValues();
  const genres = sheet
    .getRange(startRow, CONFIG.COL.GENRE, rowCount, 1)
    .getDisplayValues();
  const currentKeys = sheet
    .getRange(startRow, CONFIG.COL.SERIES_KEY_AUTO, rowCount, 1)
    .getValues();
  const plan = buildSeriesKeyAutoRepairPlan_(titles, genres, currentKeys, extraLookup);
  plan.checked = rowCount;
  plan.startRow = startRow;
  return plan;
}

function repairSeriesKeyAutoRange_(sheet, startRow, rowCount, extraLookup) {
  const lookup = extraLookup instanceof Map
    ? extraLookup
    : loadSeriesRegistryExtraLookup_();
  const plan = buildSeriesKeyAutoSheetPlan_(sheet, startRow, rowCount, lookup);
  plan.updatedRanges = writeSeriesKeyAutoRepairPlan_(sheet, startRow, plan);
  return plan;
}

function repairSeriesKeyAutoAll_(sheet) {
  const sh = sheet || getSheet(CONFIG.SHEETS.MAIN);
  const lastRow = getLastDataRow(sh, CONFIG.COL.TITLE);
  if (lastRow < 2) return repairSeriesKeyAutoRange_(sh, 2, 0, new Map());
  return repairSeriesKeyAutoRange_(
    sh,
    2,
    lastRow - 1,
    loadSeriesRegistryExtraLookup_()
  );
}

function summarizeSeriesKeyAutoPlan_(plan) {
  const changedIndices = Array.isArray(plan && plan.changedIndices)
    ? plan.changedIndices
    : [];
  const startRow = Number(plan && plan.startRow || 2);
  const rowNumbers = changedIndices.slice(0, 100).map(index => startRow + index);
  return {
    checked: Number(plan && plan.checked || 0),
    changed: changedIndices.length,
    extraCount: Number(plan && plan.extraCount || 0),
    changedRows: rowNumbers,
    truncated: changedIndices.length > rowNumbers.length
  };
}

function auditSeriesKeyAutoConsistency_() {
  const sheet = getSheet(CONFIG.SHEETS.MAIN);
  const lastRow = getLastDataRow(sheet, CONFIG.COL.TITLE);
  const plan = buildSeriesKeyAutoSheetPlan_(
    sheet,
    2,
    Math.max(0, lastRow - 1),
    loadSeriesRegistryExtraLookup_()
  );
  return summarizeSeriesKeyAutoPlan_(plan);
}

function markSeriesKeyAutoDirty_() {
  try {
    PropertiesService.getScriptProperties().setProperty(
      SERIES_KEY_AUTO_CONFIG_.DIRTY_PROPERTY,
      String(Date.now())
    );
    return true;
  } catch (error) {
    console.error('markSeriesKeyAutoDirty_ error:', error);
    return false;
  }
}

function clearSeriesKeyAutoDirty_() {
  try {
    PropertiesService.getScriptProperties().deleteProperty(
      SERIES_KEY_AUTO_CONFIG_.DIRTY_PROPERTY
    );
    return true;
  } catch (error) {
    console.error('clearSeriesKeyAutoDirty_ error:', error);
    return false;
  }
}

function refreshSeriesKeyAutoAfterDerivedChange_(sheet) {
  markSeriesKeyAutoDirty_();
  SpreadsheetApp.flush();
  const result = repairSeriesKeyAutoAll_(sheet || getSheet(CONFIG.SHEETS.MAIN));
  SpreadsheetApp.flush();
  clearSeriesKeyAutoDirty_();
  return result;
}

function updateSeriesKeyAutoForRow_(sheet, row) {
  if (row < 2) return { checked: 0, changed: 0 };
  return repairSeriesKeyAutoRange_(sheet, row, 1, loadSeriesRegistryExtraLookup_());
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
  if (rowCount <= 0) return { checked: 0, changed: 0 };
  return repairSeriesKeyAutoRange_(
    sheet,
    startRow,
    rowCount,
    loadSeriesRegistryExtraLookup_()
  );
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
  const filter = sheet.getFilter();
  if (filter) filter.remove();
  // Entering input mode never changes book order or recalculates W's spill.
  highlightISBNMode_(sheet);
  setDropdownISBN_();
}

/**
 * 取得済みの入力行だけを書誌の値へ確定し、補助入力範囲をクリアする。
 * 既存の確定行、ISBN未入力のテンプレート、画像式、書式は保持する。
 */
function convertFormulasAndClearRange_(validatedPlan, sheet) {
  const sh = sheet || getSheet(CONFIG.SHEETS.MAIN);
  const plan = validatedPlan || readLibraryInputFinishPlan_(sh);
  if (plan.incompleteRows.length) {
    throw new Error('書誌情報が未取得です。目録の ' + plan.incompleteRows.join(', ') + ' 行を確認してください。数式と入力欄は変更していません。');
  }
  plan.runs.forEach(run => {
    // Preserve the established display-text conversion (including formatted
    // dates/prices) and the image-specific copy behavior, but only for input rows.
    // Read all displayed metadata before clearing its B:H dependencies.
    const displayed = sh.getRange(run.row, CONFIG.COL.TITLE, run.count, 10).getDisplayValues();
    const title = sh.getRange(run.row, CONFIG.COL.TITLE, run.count, 1);
    title.setValues(displayed.map(values => [values[0]]));
    const image = sh.getRange(run.row, CONFIG.COL.IMAGE, run.count, 1);
    image.copyTo(image, { contentsOnly: true });
    const metadata = sh.getRange(run.row, CONFIG.COL.AUTHOR, run.count, 8);
    metadata.setValues(displayed.map(values => values.slice(2, 10)));
    sh.getRange(run.row, 2, run.count, 7).clearContent();
  });
  return plan;
}

/**
 * ドロップダウン切り替え：通常/ISBN
 */
function setDropdownNML_()  { setDropdownFromList_(DROPDOWN_VALUES.NML);  }
function setDropdownISBN_() { setDropdownFromList_(DROPDOWN_VALUES.ISBN); }
function setDropdownFromList_(values) {
  const cell = getSheet(CONFIG.SHEETS.MAIN).getRange('A1');
  const rule = SpreadsheetApp.newDataValidation().requireValueInList(values, true).build();
  cell.setDataValidation(rule);
}

/**
 * 行全体の背景色リセット・モードごとのハイライト
 */
function highlightISBNMode_(sheet) {
  ensureLibraryInputModeFormat_(sheet);
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
  const series = refreshSeriesKeyAutoAfterDerivedChange_(sheet);
  const bookUuids = repairBookUuidsAll_(sheet);
  if (series.changed > 0 || bookUuids.changed > 0 || bookUuids.headerUpdated) {
    SpreadsheetApp.flush();
    clearLibrarySearchCache_();
  }
  return {
    updatedRows: series.changed > 0 ? series.checked : 0,
    changedRows: series.changed,
    series: summarizeSeriesKeyAutoPlan_(series),
    bookUuids
  };
}
