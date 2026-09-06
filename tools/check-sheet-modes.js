const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert/strict');
const root = path.resolve(__dirname, '..');
const context = vm.createContext({ console: { log() {}, error() {} }, Date });
for (const file of ['config.js', 'コード.js', 'SheetModes.js']) {
  vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), context, { filename: file });
}
const plain = value => JSON.parse(JSON.stringify(value));
function row(title, isbn) { const values = Array(18).fill(''); values[7] = title; values[17] = isbn; return values; }
const values = [row('既存', '1'), row('新刊A', '2'), row('新刊B', '3'), row('', ''), row('新刊C', '4')];
const formulas = values.map(() => Array(18).fill(''));
formulas[0][8] = '=IMAGE("cover")'; // Existing image alone is not pending input.
formulas[1][7] = '=E3'; formulas[2][0] = '=IMPORTXML("source", "//items")'; formulas[3][0] = '=IMPORTXML("source", "//items")'; formulas[4][9] = '=D6';
assert.deepEqual(plain(context.buildLibraryInputFinishPlan_(values, formulas)), { runs: [{ row: 3, count: 2 }, { row: 6, count: 1 }], incompleteRows: [] });
assert.deepEqual(plain(context.buildLibraryInputFinishPlan_([], [])), { runs: [], incompleteRows: [] });
const incomplete = [row('', 'missing'), row('#N/A', 'error'), row('書名', 'publisher-error')];
incomplete[2][10] = '#REF!';
assert.deepEqual(plain(context.buildLibraryInputFinishPlan_(incomplete, [[], [], ['=IMPORTXML()']])), { runs: [], incompleteRows: [2, 3, 4] });

// Values/clear only target completed input runs; no existing row, template,
// image, date format, UUID, genre spill or summary column is touched.
const writes = [];
const displayed=[['本A','','著者','出版社','棚','2','2026年 9月','¥650','文庫',''],['本B','','著者B','出版社B','棚','3','2026年 8月','¥900','文庫','']];
const sheet = { getRange(r,c,n,w) { const range = { getDisplayValues() { return displayed; }, setValues(values) { writes.push(['values',r,c,n,w,plain(values)]); }, copyTo(target,options) { assert.equal(target, range); assert.equal(options.contentsOnly,true); writes.push(['image',r,c,n,w]); }, clearContent() { writes.push(['clear',r,c,n,w]); } }; return range; } };
context.SpreadsheetApp = { CopyPasteType: { PASTE_VALUES: 'PASTE_VALUES' } };
context.convertFormulasAndClearRange_({ runs: [{row:3,count:2}], incompleteRows: [] }, sheet);
assert.deepEqual(writes, [['values',3,9,2,1,[['本A'],['本B']]],['image',3,10,2,1],['values',3,11,2,8,displayed.map(v=>v.slice(2))],['clear',3,2,2,7]]);
writes.length=0;
assert.throws(() => context.convertFormulasAndClearRange_({runs:[{row:3,count:1}],incompleteRows:[4]},sheet), /4/);
assert.equal(writes.length,0);

// A1 is dispatched only once; the simple trigger never loads registry/sheet data.
context.onEdit({ range: { getSheet: () => ({getName: () => '目録'}), getA1Notation: () => 'A1', getValue() { throw Error('simple trigger read'); } } });
let calls=0;
const originalCommand=context.runLibraryModeCommand_;
context.runLibraryModeCommand_=()=>calls++;
const event={range:{getSheet:()=>({getName:()=> '目録'}),getA1Notation:()=> 'A1'},value:'ISBN入力モード'};
context.handleLibraryModeEdit_(event); assert.equal(calls,0);
context.handleLibraryModeEdit_({...event,triggerUid:'installed'}); assert.equal(calls,1);
context.handleLibraryModeEdit_({...event,triggerUid:'installed',value:'機能選択'}); assert.equal(calls,1);
context.runLibraryModeCommand_=originalCommand;

// Input entry removes only the filter, not the genre formula or sort order.
const entry=[];
context.getSheet=()=>({getFilter:()=>({remove:()=>entry.push('removeFilter')})});
context.highlightISBNMode_=()=>entry.push('conditionalFormat');
context.setDropdownISBN_=()=>entry.push('dropdown');
context.sortMainRowsByTitle_=()=>{throw Error('must not sort on entry');};
context.resetAndSortFilterISBN_();
assert.deepEqual(entry,['removeFilter','conditionalFormat','dropdown']);

let locked=true,released=0,a1='入力モード終了'; const operations=[];
const commandSheet={getParent:()=>({toast(){}}),getRange:()=>({getValue:()=>a1,setValue:value=>{a1=value;operations.push('a1');}})};
context.LockService={getScriptLock:()=>({tryLock:()=>locked,releaseLock:()=>released++})};
context.readLibraryInputFinishPlan_=()=>({runs:[],incompleteRows:[2254]});
context.convertFormulasAndClearRange_=()=>operations.push('convert');
context.resetAndSortFilter_=()=>operations.push('sort');
context.clearLibrarySearchCache_=()=>operations.push('cache');
context.setDropdownNML_=()=>operations.push('dropdown');
assert.throws(()=>context.runLibraryModeCommand_(commandSheet,'入力モード終了'),/2254/);
assert.deepEqual(operations,[]);assert.equal(a1,'入力モード終了');assert.equal(released,1);
context.readLibraryInputFinishPlan_=()=>({runs:[],incompleteRows:[]});
context.runLibraryModeCommand_(commandSheet,'入力モード終了');
assert.deepEqual(operations,['convert','sort','cache','dropdown','a1']);assert.equal(a1,'機能選択');assert.equal(released,2);
operations.length=0;
assert.equal(context.runLibraryModeCommand_(commandSheet,'Filter初期化').stale,true);assert.deepEqual(operations,[]);
locked=false;
assert.equal(context.runLibraryModeCommand_(commandSheet,'Filter初期化').busy,true);assert.deepEqual(operations,[]);
console.log('sheet mode checks ok');
