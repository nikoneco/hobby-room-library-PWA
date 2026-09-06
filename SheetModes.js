/** @OnlyCurrentDoc */

const LIBRARY_MODE_HANDLER_ = 'handleLibraryModeEdit_';
const LIBRARY_MODE_FORMAT_FORMULA_ = '=AND($A$1="ISBN入力モード",N("shumiLibrary.isbnMode")=0)';
const LIBRARY_MODE_COMMANDS_ = ['ISBN入力モード', '入力モード終了', 'Filter初期化'];

function onOpen() {
  SpreadsheetApp.getUi().createMenu('図書館')
    .addItem('A1の操作を有効にする（初回設定）', 'setupLibraryModeControls_')
    .addSeparator()
    .addItem('ISBN入力モード', 'startLibraryInputFromMenu_')
    .addItem('入力モード終了', 'finishLibraryInputFromMenu_')
    .addItem('Filter初期化', 'resetLibraryFilterFromMenu_')
    .addToUi();
}

function setupLibraryModeControls_() {
  const ss = SpreadsheetApp.getActive();
  // Requires the bound spreadsheet UI, never a public Web App/API entry point.
  SpreadsheetApp.getUi();
  const existing = ScriptApp.getProjectTriggers().filter(trigger =>
    trigger.getHandlerFunction() === LIBRARY_MODE_HANDLER_ &&
    trigger.getTriggerSourceId() === ss.getId() &&
    trigger.getEventType() === ScriptApp.EventType.ON_EDIT);
  if (!existing.length) ScriptApp.newTrigger(LIBRARY_MODE_HANDLER_).forSpreadsheet(ss).onEdit().create();
  ensureLibraryInputModeFormat_(getSheet(CONFIG.SHEETS.MAIN));
  ss.toast('A1の操作を有効にしました。', '図書館', 5);
  return { installed: existing.length === 0, handler: LIBRARY_MODE_HANDLER_ };
}

function handleLibraryModeEdit_(e) {
  if (!e || !e.range || !e.triggerUid) return;
  const sheet = e.range.getSheet();
  if (sheet.getName() !== CONFIG.SHEETS.MAIN || e.range.getA1Notation() !== 'A1') return;
  const command = String(e.value || '');
  if (!LIBRARY_MODE_COMMANDS_.includes(command)) return;
  return runLibraryModeCommand_(sheet, command);
}

function startLibraryInputFromMenu_() { return runLibraryModeFromMenu_('ISBN入力モード'); }
function finishLibraryInputFromMenu_() { return runLibraryModeFromMenu_('入力モード終了'); }
function resetLibraryFilterFromMenu_() { return runLibraryModeFromMenu_('Filter初期化'); }

function runLibraryModeFromMenu_(command) {
  SpreadsheetApp.getUi();
  const sheet = getSheet(CONFIG.SHEETS.MAIN);
  sheet.getRange('A1').setValue(command);
  // Script writes do not fire onEdit, so dispatch explicitly.
  return runLibraryModeCommand_(sheet, command);
}

function runLibraryModeCommand_(sheet, command) {
  if (!LIBRARY_MODE_COMMANDS_.includes(command)) return;
  const lock = LockService.getScriptLock();
  const ss = sheet.getParent();
  if (!lock.tryLock(1000)) {
    ss.toast('別の処理を実行中です。完了後にもう一度選択してください。', '図書館', 8);
    return { busy: true };
  }
  const started = Date.now();
  let stage = '開始';
  const a1 = sheet.getRange('A1');
  let changesStarted = false;
  function step_(name, action) {
    stage = name;
    const at = Date.now();
    const result = action();
    console.log(JSON.stringify({ operation: 'libraryMode', command, stage, ms: Date.now() - at }));
    return result;
  }
  try {
    // A queued edit must never apply a command superseded by a newer A1 value.
    if (String(a1.getValue()) !== command) return { stale: true };
    ss.toast(command + 'を実行しています。', '図書館', -1);
    if (command === 'ISBN入力モード') {
      step_('入力モード開始', resetAndSortFilterISBN_);
    } else {
      if (command === '入力モード終了') {
        // Preflight is read-only; failed book fetches must not be frozen/cleared.
        const plan = step_('書誌情報の確認', () => readLibraryInputFinishPlan_(sheet));
        if (plan.incompleteRows.length) throw new Error('書誌情報が未取得です。目録の ' + plan.incompleteRows.join(', ') + ' 行を確認してください。');
        changesStarted = true;
        step_('入力した行の値化', () => convertFormulasAndClearRange_(plan, sheet));
      }
      changesStarted = true;
      step_('並べ替えとフィルター', resetAndSortFilter_);
      step_('キャッシュ更新', clearLibrarySearchCache_);
      changesStarted = false;
      // Do not replace a new command entered while the sheet operation ran.
      if (String(a1.getValue()) === command) {
        step_('通常モードへ復帰', () => { setDropdownNML_(); a1.setValue('機能選択'); });
      }
    }
    const ms = Date.now() - started;
    ss.toast(command + 'が完了しました（' + (ms / 1000).toFixed(1) + '秒）。', '図書館', 8);
    console.log(JSON.stringify({ operation: 'libraryMode', command, completed: true, ms }));
    return { completed: true, ms };
  } catch (error) {
    // Partial writes must invalidate stale row-index caches as well.
    if (changesStarted) {
      try { clearLibrarySearchCache_(); } catch (cacheError) { console.error(cacheError); }
    }
    ss.toast(stage + 'で停止: ' + error.message, '図書館', 20);
    console.error(JSON.stringify({ operation: 'libraryMode', command, stage, ms: Date.now() - started, error: String(error) }));
    throw error;
  } finally {
    lock.releaseLock();
  }
}

function ensureLibraryInputModeFormat_(sheet) {
  const rules = sheet.getConditionalFormatRules();
  const found = rules.some(rule => {
    const condition = rule.getBooleanCondition();
    return condition && condition.getCriteriaValues().some(value => String(value) === LIBRARY_MODE_FORMAT_FORMULA_);
  });
  if (found) return;
  const rule = SpreadsheetApp.newConditionalFormatRule()
    .whenFormulaSatisfied(LIBRARY_MODE_FORMAT_FORMULA_)
    .setBackground('#FFF8DC').setFontColor('#003366')
    .setRanges([sheet.getRange(2, 1, Math.max(1, sheet.getMaxRows() - 1), CONFIG.COL.MAX)])
    .build();
  sheet.setConditionalFormatRules(rules.concat([rule]));
}

function readLibraryInputFinishPlan_(sheet) {
  const count = sheet.getMaxRows() - 1;
  if (count <= 0) return { runs: [], incompleteRows: [] };
  const range = sheet.getRange(2, 2, count, CONFIG.COL.ISBN - 1); // B:S
  return buildLibraryInputFinishPlan_(range.getDisplayValues(), range.getFormulas());
}

function buildLibraryInputFinishPlan_(displayRows, formulaRows) {
  const runs = [];
  const incompleteRows = [];
  const errorValue = /^#(?:N\/A|REF!|VALUE!|ERROR!|DIV\/0!|NUM!|NAME\?|SPILL!|CALC!)/;
  displayRows.forEach((values, index) => {
    const isbn = String(values[CONFIG.COL.ISBN - 2] || '').trim();
    if (!isbn) return; // Leave unused input templates intact.
    const formulas = formulaRows[index] || [];
    const title = String(values[CONFIG.COL.TITLE - 2] || '').trim();
    // J's IMAGE formula can remain on already committed books. It is not an
    // input marker and must not cause all existing books to be rewritten.
    const pending = formulas.some((formula, col) => col !== CONFIG.COL.IMAGE - 2 && col < CONFIG.COL.ISBN - 2 && Boolean(formula));
    const outputColumns = [CONFIG.COL.TITLE, CONFIG.COL.AUTHOR, CONFIG.COL.PUBLISHER, 13, 14, 15, 16, 17, 18];
    if (!title || errorValue.test(title) || (pending && outputColumns.some(col => errorValue.test(String(values[col - 2] || ''))))) {
      incompleteRows.push(index + 2);
      return;
    }
    if (!pending) return;
    const row = index + 2;
    const last = runs[runs.length - 1];
    if (last && last.row + last.count === row) last.count++;
    else runs.push({ row, count: 1 });
  });
  return { runs, incompleteRows };
}
