const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const masterHeaders = [
  'series_id', 'シリーズ名', 'J-ストーリー', 'J-題材1', 'J-題材2', 'J-雰囲気',
  'J-状態', '蔵書数', '状態', '更新日時', 'canonical_key', 'J-媒体1', 'J-媒体2'
];
const aliasHeaders = [
  'alias_key', 'series_id', '由来', 'match_signature', '蔵書数', '更新日時'
];
const reviewHeaders = [
  '候補キー', '候補series_id', '比較対象キー', '比較対象series_id', '理由', '状態', '更新日時'
];
const files = ['config.js', 'コード.js', 'SeriesRegistry.js', 'NewBookImport.js'];

function pad(row, width) {
  return Array.from({ length: width }, (_, index) => row[index] == null ? '' : row[index]);
}

function makeMaster(id, options = {}) {
  const genres = options.genres || ['', '', '', '', ''];
  const media = options.media || ['', ''];
  return [
    id,
    options.name || options.canonical || id,
    ...pad(genres, 5),
    options.count == null ? 0 : options.count,
    options.status || 'ACTIVE',
    options.updated || '2026-09-21',
    options.canonical || options.name || id,
    ...pad(media, 2)
  ];
}

function makeAlias(key, id, options = {}) {
  return [
    key,
    id,
    options.source || 'FIXTURE',
    options.signature || '',
    options.count == null ? 0 : options.count,
    options.updated || '2026-09-21'
  ];
}

function makeBook(title, key, options = {}) {
  const row = Array(28).fill('');
  row[8] = title;
  row[21] = options.uuid || '';
  row[22] = options.genre || '';
  row[23] = key || '';
  return row;
}

class FakeRange {
  constructor(sheet, row, column, height = 1, width = 1) {
    Object.assign(this, { sheet, row, column, height, width });
    assert.ok(row >= 1 && column >= 1 && height >= 0 && width >= 1, 'range has valid dimensions');
    assert.ok(row + height - 1 <= sheet.capacity, 'range fits sheet row capacity');
    assert.ok(column + width - 1 <= sheet.width, 'range fits sheet column capacity');
  }

  getValues() {
    if (typeof this.sheet.beforeRead === 'function') this.sheet.beforeRead(this);
    return Array.from({ length: this.height }, (_, y) =>
      Array.from({ length: this.width }, (_, x) =>
        this.sheet.rows[this.row + y - 1]?.[this.column + x - 1] ?? ''
      )
    );
  }

  getDisplayValues() {
    return this.getValues().map(row => row.map(value => String(value == null ? '' : value)));
  }

  getFormulas() {
    return this.getValues().map(row => row.map(value =>
      typeof value === 'string' && value.startsWith('=') ? value : ''
    ));
  }

  getValue() { return this.getValues()[0][0]; }
  getDisplayValue() { return String(this.getValue() ?? ''); }
  getFormula() { return this.getFormulas()[0][0]; }

  setValues(values) {
    assert.equal(values.length, this.height, 'setValues height matches range');
    if (typeof this.sheet.beforeWrite === 'function') this.sheet.beforeWrite(this, values);
    values.forEach((row, y) => {
      assert.equal(row.length, this.width, 'setValues width matches range');
      const targetRow = this.row + y - 1;
      while (this.sheet.rows.length <= targetRow) {
        this.sheet.rows.push(pad([], this.sheet.width));
      }
      row.forEach((value, x) => {
        this.sheet.rows[targetRow][this.column + x - 1] = value;
      });
    });
    this.sheet.writes += 1;
    if (typeof this.sheet.afterWrite === 'function') this.sheet.afterWrite(this, values);
    return this;
  }

  setValue(value) { return this.setValues([[value]]); }
  clearContent() { return this.setValues(Array.from({ length: this.height }, () => Array(this.width).fill(''))); }
  copyTo(target) { return target; }
  setNumberFormat() { return this; }
  setDataValidation() { return this; }
  setFormula(value) { return this.setValue(value); }
  getRow() { return this.row; }
  getColumn() { return this.column; }
  getNumRows() { return this.height; }
  getNumColumns() { return this.width; }
  getSheet() { return this.sheet; }

  getA1Notation() {
    let column = this.column;
    let letters = '';
    while (column) {
      const remainder = (column - 1) % 26;
      letters = String.fromCharCode(65 + remainder) + letters;
      column = Math.floor((column - 1) / 26);
    }
    return `${letters}${this.row}`;
  }
}

class FakeSheet {
  constructor(name, header, rows = [], options = {}) {
    this.name = name;
    this.width = options.width || header.length;
    this.rows = [pad(header, this.width), ...rows.map(row => pad(row, this.width))];
    this.capacity = options.capacity || Math.max(100, this.rows.length + 5);
    this.writes = 0;
  }

  getName() { return this.name; }
  getMaxRows() { return this.capacity; }
  getMaxColumns() { return this.width; }
  getLastColumn() { return this.width; }

  getLastRow() {
    let row = this.rows.length;
    while (row > 1 && this.rows[row - 1].every(value => String(value ?? '') === '')) row -= 1;
    return row;
  }

  getRange(row, column, height = 1, width = 1) {
    return new FakeRange(this, row, column, height, width);
  }

  getDataRange() { return this.getRange(1, 1, Math.max(1, this.getLastRow()), this.width); }
  getParent() { return this.parent; }

  insertRowsAfter(after, count) {
    assert.equal(after, this.capacity, 'capacity guard inserts at end of sheet');
    this.capacity += count;
    this.insertedRows = (this.insertedRows || 0) + count;
  }

  deleteRows(startRow, count = 1) {
    this.rows.splice(startRow - 1, count);
    this.capacity -= count;
    this.deletions = (this.deletions || 0) + count;
  }
}

function makeFixture(options = {}) {
  const sheets = new Map();
  const masterRows = options.masters || [];
  const aliasRows = options.aliases || [];
  const catalogRows = options.books || [];
  const masterSheet = new FakeSheet(
    'series_master_v2', masterHeaders, masterRows,
    { capacity: options.masterCapacity }
  );
  const aliasSheet = new FakeSheet(
    'series_alias_v2', aliasHeaders, aliasRows,
    { capacity: options.aliasCapacity }
  );
  const catalogHeader = Array(28).fill('');
  catalogHeader[8] = 'タイトル';
  catalogHeader[22] = 'ジャンル';
  catalogHeader[23] = 'series_key_auto';
  const catalogSheet = new FakeSheet('目録', catalogHeader, catalogRows, { width: 28 });
  const reviewSheet = new FakeSheet('series_match_review_v2', reviewHeaders, options.reviews || []);
  const dataSheet = new FakeSheet('データ', Array(18).fill(''), [], { width: 18 });
  const genreSheet = new FakeSheet('genre_master', Array(26).fill(''), [], { width: 26 });
  const extraSheets = (options.extraSheets || []).map(item =>
    new FakeSheet(item.name, item.header || ['note'], item.rows || [], { width: item.width || (item.header || ['note']).length })
  );
  for (const sheet of [masterSheet, aliasSheet, catalogSheet, reviewSheet, dataSheet, genreSheet, ...extraSheets]) {
    sheets.set(sheet.getName(), sheet);
  }

  const properties = new Map([['series_registry_v2_active', '1']]);
  let uuid = 0;
  let locked = false;
  let lockAcquires = 0;
  let lockReleases = 0;
  const spreadsheet = {
    getSheetByName: name => sheets.get(name) || null,
    getSheets: () => [...sheets.values()],
    toast() {},
    getId: () => 'series-registry-fixture'
  };
  sheets.forEach(sheet => { sheet.parent = spreadsheet; });
  const context = vm.createContext({
    console: { log() {}, error() {} },
    Date,
    Map,
    Set,
    SpreadsheetApp: {
      getActive: () => spreadsheet,
      getActiveSpreadsheet: () => spreadsheet,
      flush() {},
      CopyPasteType: { PASTE_FORMAT: 'format', PASTE_DATA_VALIDATION: 'validation' }
    },
    PropertiesService: {
      getScriptProperties: () => ({
        getProperty: key => properties.get(key) || null,
        setProperty: (key, value) => properties.set(key, value),
        deleteProperty: key => properties.delete(key)
      })
    },
    Utilities: { getUuid: () => `fixture-${++uuid}`, sleep() {} },
    LockService: {
      getScriptLock: () => ({
        hasLock: () => locked,
        tryLock: () => { lockAcquires += 1; if (locked) return false; locked = true; return true; },
        releaseLock: () => { lockReleases += 1; locked = false; }
      })
    }
  });
  for (const file of files) {
    vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), context, { filename: file });
  }
  context.clearLibrarySearchCache_ = () => {};
  context.markSynopsisManualOnEdit_ = () => {};
  return {
    context,
    sheets,
    masterSheet,
    aliasSheet,
    catalogSheet,
    reviewSheet,
    uuidCount: () => uuid,
    lockCounts: () => ({ acquired: lockAcquires, released: lockReleases })
  };
}

function snapshotWrites(fixture) {
  return [...fixture.sheets.values()].reduce((total, sheet) =>
    total + sheet.writes + Number(sheet.insertedRows || 0) + Number(sheet.deletions || 0), 0);
}

function rowsWithoutHeaders(sheet) {
  return sheet.rows.slice(1).filter(row => row.some(value => String(value ?? '') !== ''));
}

function metadataMergeHoldRows(fixture) {
  return rowsWithoutHeaders(fixture.reviewSheet).filter(row =>
    String(row[4] || '').startsWith('METADATA_MERGE_HOLD:')
  );
}

function makePendingManualMergeFixture(options = {}) {
  const masters = [
    makeMaster('source-automatic', {
      canonical: 'automatic',
      count: 0,
      genres: options.sourceGenres || ['物語', '', '', '', ''],
      media: options.sourceMedia || ['', '']
    }),
    makeMaster('target-series', {
      canonical: 'target',
      count: 1,
      genres: options.targetGenres || ['ギャグ', '', '', '', ''],
      media: options.targetMedia || ['', '']
    }),
    makeMaster('other-series', { canonical: 'other', count: 1 })
  ];
  const aliases = [
    makeAlias('automatic', 'source-automatic'),
    makeAlias('target', 'target-series', { count: 1 }),
    makeAlias('other', 'other-series', { count: 1 })
  ];
  if (options.includeOrdinaryOrphan) {
    masters.push(makeMaster('unrelated-orphan', { canonical: 'unrelated' }));
    aliases.push(makeAlias('unrelated', 'unrelated-orphan'));
  }
  return makeFixture({
    masters,
    aliases,
    books: [
      makeBook('automatic', 'target', { uuid: '307908e3-c9e3-4e91-9750-68d30a9e84a6' }),
      makeBook('other', 'other', { uuid: '323908e3-c9e3-4e91-9750-68d30a9e84a7' })
    ]
  });
}

function triggerManualXEdit(fixture, row) {
  return fixture.context.onEdit({ range: fixture.catalogSheet.getRange(row, 24, 1, 1) });
}

function testActualReferencesOverrideCachedCountsAndCleanupIsIdempotent() {
  const fixture = makeFixture({
    masters: [
      makeMaster('live', { name: 'Live', canonical: 'live', count: 0 }),
      makeMaster('orphan', { name: 'Orphan', canonical: 'orphan', count: 77 })
    ],
    aliases: [
      makeAlias('live', 'live', { count: 0 }),
      makeAlias('orphan', 'orphan', { count: 88 })
    ],
    books: [makeBook('Live 1', 'live')]
  });
  const { context, masterSheet, aliasSheet } = fixture;
  const result = context.cleanupSeriesRegistryLifecycleCore_();
  assert.equal(result.deletedMasters, 1);
  assert.equal(result.deletedAliases, 1);
  assert.deepEqual(rowsWithoutHeaders(masterSheet).map(row => row[0]), ['live']);
  assert.deepEqual(rowsWithoutHeaders(aliasSheet).map(row => row[0]), ['live']);
  const writesAfterFirstRun = snapshotWrites(fixture);
  const second = context.cleanupSeriesRegistryLifecycleCore_();
  assert.equal(second.changed, false);
  assert.equal(snapshotWrites(fixture), writesAfterFirstRun, 'second cleanup has no writes');
}

function testReviewPipeSeparatedReferencesKeepAndDeactivateHistory() {
  const fixture = makeFixture({
    masters: [makeMaster('series_reviewed', { canonical: 'reviewed', count: 0 })],
    aliases: [makeAlias('reviewed', 'series_reviewed', { count: 99 })],
    reviews: [['reviewed', 'series_reviewed|series_other', 'comparison', 'series_other|series_reviewed', '', 'OPEN', '']]
  });
  const result = fixture.context.cleanupSeriesRegistryLifecycleCore_();
  assert.equal(result.deactivatedMasters, 1);
  assert.equal(result.deletedMasters, 0);
  assert.equal(fixture.masterSheet.rows[1][8], 'INACTIVE');
  assert.equal(fixture.aliasSheet.rows[1][1], 'series_reviewed');
  assert.equal(fixture.context.resolveSeriesRegistryKey_('reviewed'), null);
}

function testRetiredStatusesAndDuplicateOwnersFailClosed() {
  const retired = makeFixture({
    masters: [
      makeMaster('merged', { canonical: 'merged', status: 'MERGED' }),
      makeMaster('inactive', { canonical: 'inactive', status: 'INACTIVE' })
    ],
    aliases: [makeAlias('merged', 'merged'), makeAlias('inactive', 'inactive')]
  });
  assert.equal(retired.context.resolveSeriesRegistryKey_('merged'), null);
  assert.equal(retired.context.resolveSeriesRegistryKey_('inactive'), null);
  const beforeRetired = snapshotWrites(retired);
  assert.throws(() => retired.context.ensureSeriesRegistryAlias_('merged'), /inactive or ambiguous/);
  assert.equal(snapshotWrites(retired), beforeRetired);

  const duplicate = makeFixture({
    masters: [makeMaster('a', { canonical: 'shared' }), makeMaster('b', { canonical: 'shared' })],
    aliases: [makeAlias('shared', 'a'), makeAlias('shared', 'b')]
  });
  const beforeDuplicate = snapshotWrites(duplicate);
  assert.throws(() => duplicate.context.ensureSeriesRegistryExtraAliases_(), /integrity check failed/);
  assert.equal(snapshotWrites(duplicate), beforeDuplicate, 'real alias conflict is not partially repaired');
}

function testInactiveSignatureOwnerBlocksNewAliasBeforeAnyWrite() {
  const fixture = makeFixture({
    masters: [
      makeMaster('active-owner', { canonical: 'ぶるーろっく' }),
      makeMaster('retired-owner', { canonical: 'ブルーロック', status: 'INACTIVE' })
    ],
    aliases: [
      makeAlias('ぶるーろっく', 'active-owner'),
      makeAlias('ブルーロック', 'retired-owner')
    ],
    books: [makeBook('ブルー ロック', 'ブルー ロック')]
  });
  const before = snapshotWrites(fixture);
  assert.throws(
    () => fixture.context.syncSeriesRegistryFromCatalog_(),
    /signature belongs to another master/
  );
  assert.equal(snapshotWrites(fixture), before);
  assert.equal(rowsWithoutHeaders(fixture.aliasSheet).length, 2);
}

function makeOrphanExtraConflictFixture(options = {}) {
  const sourceId = 'source-extra-orphan';
  const targetId = 'target-extra-live';
  return makeFixture({
    masters: [
      makeMaster(sourceId, {
        name: 'art', canonical: 'art',
        genres: options.sourceGenres || ['物語', '', '', '', ''],
        media: options.sourceMedia || ['', '画集'], count: 0
      }),
      makeMaster(targetId, {
        name: 'art', canonical: '__extra__art',
        genres: options.targetGenres || ['', '', '', '', ''],
        media: options.targetMedia || ['画集', ''], count: 0
      })
    ],
    aliases: [
      makeAlias('art', sourceId, { count: 42 }),
      makeAlias('__extra__art', targetId, { count: 0 })
    ],
    books: options.books || [makeBook('art', '__extra__art', { genre: '画集' })],
    reviews: options.reviews || []
  });
}

function testImportRehomesOnlySafeZeroReferenceExtraOwner() {
  const fixture = makeOrphanExtraConflictFixture();
  const { context, masterSheet, aliasSheet, catalogSheet } = fixture;
  const originalBook = catalogSheet.rows[1].slice();
  const result = context.refreshSeriesKeyAutoForImport_(catalogSheet);
  assert.equal(result.stable, true);
  assert.equal(result.registry.orphanMastersDeleted, 1);
  assert.equal(result.registry.orphanAliasesRehomed, 1);
  assert.equal(fixture.uuidCount(), 0, 'safe orphan transition reuses the live destination');
  assert.equal(catalogSheet.rows[1][23], '__extra__art');
  assert.equal(catalogSheet.rows[1][21], originalBook[21]);
  const alias = rowsWithoutHeaders(aliasSheet).find(row => row[0] === 'art');
  assert.equal(alias[1], 'target-extra-live');
  assert.deepEqual(rowsWithoutHeaders(masterSheet).map(row => row[0]), ['target-extra-live']);
  assert.deepEqual(rowsWithoutHeaders(masterSheet)[0].slice(2, 7), ['物語', '', '', '', '']);
  assert.deepEqual(rowsWithoutHeaders(masterSheet)[0].slice(11, 13), ['画集', ''], 'existing media is not duplicated across L/M');
  const writesAfterFirstRun = snapshotWrites(fixture);
  const again = context.refreshSeriesKeyAutoForImport_(catalogSheet);
  assert.equal(again.changed, 0);
  assert.equal(snapshotWrites(fixture), writesAfterFirstRun, 'stable repeat does not write');
}

function testImportHaltsForLiveOrReviewProtectedExtraConflicts() {
  const live = makeOrphanExtraConflictFixture({
    books: [
      makeBook('art', 'art', { genre: '画集' }),
      makeBook('art copy', '__extra__art', { genre: '画集' })
    ]
  });
  const beforeLive = snapshotWrites(live);
  assert.throws(() => live.context.refreshSeriesKeyAutoForImport_(live.catalogSheet), /Series extra alias conflict/);
  assert.equal(snapshotWrites(live), beforeLive, 'live conflict stops before any sheet write');
  assert.equal(live.uuidCount(), 0);

  const reviewed = makeOrphanExtraConflictFixture({
    reviews: [['art', 'source-extra-orphan|other', 'comparison', 'other|source-extra-orphan', '', 'OPEN', '']]
  });
  const beforeReviewed = snapshotWrites(reviewed);
  assert.throws(() => reviewed.context.ensureSeriesRegistryExtraAliases_(), /Series extra alias conflict/);
  assert.equal(snapshotWrites(reviewed), beforeReviewed, 'review-protected history is never deleted or overwritten');
}

function testImportPromotesExistingIdAndReportsEarlierPassChanges() {
  const id = 'existing-normal-id';
  const fixture = makeFixture({
    masters: [makeMaster(id, {
      name: 'ブルーロック',
      canonical: 'ぶるーろっく',
      genres: ['物語', '題材A', '', '', ''],
      media: ['画集', ''],
      count: 1
    })],
    aliases: [makeAlias('ぶるーろっく', id, { count: 1 })],
    books: [makeBook('ブルーロック 第1巻', 'ぶるーろっく', { genre: '画集' })]
  });
  const result = fixture.context.refreshSeriesKeyAutoForImport_(fixture.catalogSheet);
  assert.equal(result.changed, 1);
  assert.deepEqual(Array.from(result.changedRows), [2]);
  assert.equal(result.registry.mastersAdded, 0);
  assert.equal(result.catalogXKeysChanged, 1);
  assert.equal(result.catalogBookIdsChanged, 0);
  assert.equal(fixture.catalogSheet.rows[1][23], '__extra__ぶるーろっく');
  assert.equal(rowsWithoutHeaders(fixture.masterSheet)[0][0], id);
  assert.deepEqual(rowsWithoutHeaders(fixture.masterSheet)[0].slice(2, 7), ['物語', '題材A', '', '', '']);
  assert.deepEqual(rowsWithoutHeaders(fixture.masterSheet)[0].slice(11, 13), ['画集', '']);
  assert.equal(rowsWithoutHeaders(fixture.aliasSheet).some(row => row[0] === '__extra__ぶるーろっく' && row[1] === id), true);
  assert.equal(fixture.uuidCount(), 0);
}

function testNewEquivalentKeysShareOneMasterAndGuardCapacity() {
  const fixture = makeFixture({
    books: [
      makeBook('ブルーロック 第1巻', 'ブルーロック'),
      makeBook('ぶるーろっく 第2巻', 'ぶるーろっく'),
      makeBook('別シリーズ', '別シリーズ')
    ],
    masterCapacity: 2,
    aliasCapacity: 2
  });
  const result = fixture.context.syncSeriesRegistryFromCatalog_();
  assert.equal(result.added, 2);
  assert.equal(result.aliasesAdded, 3);
  const masters = rowsWithoutHeaders(fixture.masterSheet);
  const aliases = rowsWithoutHeaders(fixture.aliasSheet);
  assert.equal(masters.length, 2);
  assert.equal(aliases.length, 3);
  assert.equal(aliases[0][1], aliases[1][1], 'kana-equivalent keys share the same series ID');
  assert.equal(fixture.masterSheet.insertedRows, 1);
  assert.equal(fixture.aliasSheet.insertedRows, 2);
}

function testAmbiguousSignaturesAreConserved() {
  const fixture = makeFixture({
    masters: [
      makeMaster('unused-katakana', { canonical: 'ブルーロック' }),
      makeMaster('live-hiragana', { canonical: 'ぶるーろっく', count: 1 })
    ],
    aliases: [makeAlias('ブルーロック', 'unused-katakana'), makeAlias('ぶるーろっく', 'live-hiragana')],
    books: [makeBook('ぶるーろっく', 'ぶるーろっく')]
  });
  const result = fixture.context.cleanupSeriesRegistryLifecycleCore_();
  assert.equal(result.deletedMasters, 0);
  assert.equal(result.protectedByAmbiguousSignature, 1);
  assert.equal(rowsWithoutHeaders(fixture.masterSheet).length, 2);
}

function testExternalReferenceProtectsOrphanAndUnresolvedBookBlocksCleanup() {
  const external = makeFixture({
    masters: [makeMaster('series_external-ref', { canonical: 'external' })],
    aliases: [makeAlias('external', 'series_external-ref')],
    extraSheets: [{ name: 'notes', header: ['series refs'], rows: [['contains series_external-ref']] }]
  });
  const externalResult = external.context.cleanupSeriesRegistryLifecycleCore_();
  assert.equal(externalResult.deletedMasters, 0);
  assert.equal(externalResult.protectedByExternal, 1);

  const unresolved = makeFixture({
    masters: [makeMaster('safe', { canonical: 'safe' })],
    aliases: [makeAlias('safe', 'safe')],
    books: [makeBook('Missing', 'missing')]
  });
  const before = snapshotWrites(unresolved);
  const unresolvedResult = unresolved.context.cleanupSeriesRegistryLifecycleCore_();
  assert.ok(unresolvedResult.blockers.some(blocker => blocker.includes('unresolved catalog series keys')));
  assert.equal(snapshotWrites(unresolved), before);
  assert.equal(rowsWithoutHeaders(unresolved.masterSheet).length, 1);
}

function testLastBookTitleEditFollowsCanonicalButKeepsManualNameAndMetadata() {
  const id = 'same-series-id';
  const oldKey = '肉の本';
  const newKey = 'つくみずらくがき画集';
  const fixture = makeFixture({
    masters: [makeMaster(id, {
      name: oldKey,
      canonical: oldKey,
      genres: ['物語', '題材', '', '', ''],
      media: ['画集', '']
    })],
    aliases: [makeAlias(oldKey, id), makeAlias(newKey, id)],
    books: [
      makeBook(oldKey, oldKey),
      makeBook(oldKey, oldKey)
    ]
  });
  const { context, catalogSheet, masterSheet } = fixture;
  const call = () => context.linkSeriesKeyAfterTitleEdit_(oldKey, newKey, newKey);
  call();
  assert.equal(masterSheet.rows[1][1], oldKey, 'an earlier edit waits while old-key books remain');
  catalogSheet.rows[1][8] = newKey;
  catalogSheet.rows[1][23] = newKey;
  call();
  assert.equal(masterSheet.rows[1][1], oldKey, 'the last remaining old-key book still defers the change');
  catalogSheet.rows[2][8] = newKey;
  catalogSheet.rows[2][23] = newKey;
  call();
  assert.equal(masterSheet.rows[1][1], newKey);
  assert.equal(masterSheet.rows[1][10], newKey);
  assert.deepEqual(masterSheet.rows[1].slice(2, 7), ['物語', '題材', '', '', '']);
  assert.deepEqual(masterSheet.rows[1].slice(11, 13), ['画集', '']);

  const manual = makeFixture({
    masters: [makeMaster('manual', { name: '手動シリーズ名', canonical: 'old-key' })],
    aliases: [makeAlias('old-key', 'manual'), makeAlias('new-key', 'manual')],
    books: [makeBook('new title', 'new-key')]
  });
  manual.context.linkSeriesKeyAfterTitleEdit_('old-key', 'new-key', 'new title');
  assert.equal(manual.masterSheet.rows[1][1], '手動シリーズ名');
  assert.equal(manual.masterSheet.rows[1][10], 'old-key');
}

function testGeneratedNameEquivalenceHandlesKanaCaseAndExtraPrefix() {
  const cases = [
    { id: 'kana', name: 'ブルーロック', old: 'ぶるーろっく', next: 'ぶるーろっく改', title: 'ぶるーろっく改' },
    { id: 'english', name: 'SPY×FAMILY', old: 'spy×family', next: 'spy×family 改', title: 'SPY×FAMILY 改' },
    { id: 'extra', name: 'SPY×FAMILY', old: '__extra__spy×family', next: '__extra__spy×family改', title: 'SPY×FAMILY 改' }
  ];
  cases.forEach(testCase => {
    const fixture = makeFixture({
      masters: [makeMaster(testCase.id, { name: testCase.name, canonical: testCase.old })],
      aliases: [makeAlias(testCase.old, testCase.id), makeAlias(testCase.next, testCase.id)],
      books: [makeBook(testCase.title, testCase.next)]
    });
    fixture.context.linkSeriesKeyAfterTitleEdit_(testCase.old, testCase.next, testCase.title);
    assert.equal(fixture.masterSheet.rows[1][1], testCase.title, testCase.id);
    assert.equal(fixture.masterSheet.rows[1][10], testCase.next, testCase.id);
  });
}

function testManualMergeDeletesOnlyUnreferencedSourceAndKeepsLiveSource() {
  const safe = makeFixture({
    masters: [
      makeMaster('target', { canonical: 'target', count: 1, media: ['', ''] }),
      makeMaster('orphan-source', {
        canonical: 'automatic', count: 77,
        genres: ['物語', '', '', '', ''],
        media: ['', '電子書籍']
      })
    ],
    aliases: [makeAlias('target', 'target'), makeAlias('automatic', 'orphan-source', { count: 42 })],
    books: [makeBook('automatic', 'target')]
  });
  const merged = safe.context.syncSeriesRegistryAfterManualKeyEdit_(safe.catalogSheet, 2, 1);
  assert.equal(merged.aliasesMerged, 1);
  assert.equal(merged.cleanup.deletedMasters, 1);
  assert.equal(rowsWithoutHeaders(safe.masterSheet).some(row => row[0] === 'orphan-source'), false);
  assert.equal(rowsWithoutHeaders(safe.aliasSheet).find(row => row[0] === 'automatic')[1], 'target');
  assert.deepEqual(rowsWithoutHeaders(safe.masterSheet)[0].slice(2, 7), ['物語', '', '', '', '']);
  assert.deepEqual(rowsWithoutHeaders(safe.masterSheet)[0].slice(11, 13), ['', '電子書籍']);

  const live = makeFixture({
    masters: [makeMaster('target', { canonical: 'target' }), makeMaster('live-source', { canonical: 'automatic' })],
    aliases: [makeAlias('target', 'target'), makeAlias('automatic', 'live-source')],
    books: [makeBook('automatic', 'target'), makeBook('automatic', 'automatic')]
  });
  const kept = live.context.syncSeriesRegistryAfterManualKeyEdit_(live.catalogSheet, 2, 1);
  assert.equal(kept.preservedLiveSources, 1);
  assert.equal(rowsWithoutHeaders(live.masterSheet).some(row => row[0] === 'live-source'), true);
  assert.equal(rowsWithoutHeaders(live.aliasSheet).find(row => row[0] === 'automatic')[1], 'live-source');
}

function testMediaEditMColumnRunsInsideRegistryLockAndPromotesSameId() {
  const id = 'media-edited-series';
  const fixture = makeFixture({
    masters: [makeMaster(id, {
      name: 'ブルーロック',
      canonical: 'ぶるーろっく',
      genres: ['物語', '題材', '', '', '']
    })],
    aliases: [makeAlias('ぶるーろっく', id)],
    books: [makeBook('ブルーロック 第1巻', 'ぶるーろっく', {
      uuid: '123e4567-e89b-42d3-a456-426614174000'
    })]
  });
  const masterRange = fixture.masterSheet.getRange(2, 13, 1, 1);
  fixture.masterSheet.rows[1][12] = '画集';
  fixture.context.onEdit({ range: masterRange });
  assert.equal(fixture.catalogSheet.rows[1][23], '__extra__ぶるーろっく');
  assert.equal(rowsWithoutHeaders(fixture.masterSheet)[0][0], id);
  assert.deepEqual(rowsWithoutHeaders(fixture.masterSheet)[0].slice(2, 7), ['物語', '題材', '', '', '']);
  assert.equal(rowsWithoutHeaders(fixture.masterSheet)[0][12], '画集');
  assert.ok(snapshotWrites(fixture) > 0);
  assert.deepEqual(fixture.lockCounts(), { acquired: 1, released: 1 });

  const editTitle = nextTitle => {
    fixture.catalogSheet.rows[1][8] = nextTitle;
    fixture.context.onEdit({ range: fixture.catalogSheet.getRange(2, 9, 1, 1) });
  };
  editTitle('ブルーロック改 第1巻');
  const firstCanonical = fixture.masterSheet.rows[1][10];
  assert.equal(firstCanonical, 'ぶるーろっく改');
  assert.equal(fixture.catalogSheet.rows[1][23], '__extra__ぶるーろっく改');
  editTitle('ブルーロック最終章');
  assert.equal(fixture.masterSheet.rows[1][10], 'ぶるーろっく最終章');
  assert.equal(fixture.catalogSheet.rows[1][23], '__extra__ぶるーろっく最終章');
  assert.equal(fixture.masterSheet.rows[1][0], id);
  assert.equal(fixture.masterSheet.rows[1][1], 'ブルーロック最終章');
  assert.deepEqual(fixture.masterSheet.rows[1].slice(2, 7), ['物語', '題材', '', '', '']);
  assert.equal(fixture.masterSheet.rows[1][12], '画集');
  assert.deepEqual(fixture.lockCounts(), { acquired: 3, released: 3 });
}

function testTitleEditPreflightsInactiveAliasOwnerBeforeChangingX() {
  const fixtureOptions = {
    masters: [
      makeMaster('active-old', { name: 'old', canonical: 'old' }),
      makeMaster('retired-new', { name: 'new', canonical: 'new', status: 'INACTIVE' })
    ],
    aliases: [makeAlias('old', 'active-old'), makeAlias('new', 'retired-new')],
    books: [makeBook('old', 'old', { uuid: '123e4567-e89b-42d3-a456-426614174000' })]
  };
  const direct = makeFixture(fixtureOptions);
  const directBefore = snapshotWrites(direct);
  assert.throws(
    () => direct.context.linkSeriesKeyAfterTitleEdit_('old', 'new', 'new'),
    /inactive or different master/
  );
  assert.equal(snapshotWrites(direct), directBefore);

  const onEdit = makeFixture(fixtureOptions);
  onEdit.catalogSheet.rows[1][8] = 'new';
  const before = snapshotWrites(onEdit);
  assert.throws(
    () => onEdit.context.onEdit({ range: onEdit.catalogSheet.getRange(2, 9, 1, 1) }),
    /inactive or different master/
  );
  assert.equal(onEdit.catalogSheet.rows[1][23], 'old');
  assert.equal(snapshotWrites(onEdit), before, 'title-link preflight makes no catalog or registry writes');
  assert.equal(rowsWithoutHeaders(onEdit.aliasSheet).length, 2);
  assert.deepEqual(onEdit.lockCounts(), { acquired: 1, released: 1 });
}

function testA1OnEditReturnsBeforeRegistryReads() {
  const fixture = makeFixture();
  fixture.context.isSeriesRegistryV2Active_ = () => { throw new Error('A1 should not load registry'); };
  const range = {
    getSheet: () => ({ getName: () => '目録' }),
    getA1Notation: () => 'A1'
  };
  assert.doesNotThrow(() => fixture.context.onEdit({ range }));
  assert.deepEqual(fixture.lockCounts(), { acquired: 0, released: 0 });
}

function testTitledBlankSeriesKeyOnEditFailsClosedWithoutDeletingRegistry() {
  const seriesId = 'series-blank-x';
  const uuid = '307908e3-c9e3-4e91-9750-68d30a9e84a6';
  const fixture = makeFixture({
    masters: [makeMaster(seriesId, { canonical: 'retained', count: 1 })],
    aliases: [makeAlias('retained', seriesId, { count: 1 })],
    books: [makeBook('Retained book', 'retained', { uuid })]
  });
  fixture.catalogSheet.rows[1][23] = '';
  const before = snapshotWrites(fixture);
  const usage = fixture.context.loadSeriesRegistryLookup_().catalogUsage;
  assert.equal(usage.unresolved.length, 1);
  assert.equal(usage.unresolved[0].reason, 'TITLE_WITHOUT_SERIES_KEY');
  assert.throws(
    () => fixture.context.onEdit({ range: fixture.catalogSheet.getRange(2, 24, 1, 1) }),
    /Series registry merge preflight failed: unresolved catalog series keys.*row 2: titled book has blank series_key_auto/
  );
  assert.equal(snapshotWrites(fixture), before, 'blank X aborts before registry count or lifecycle writes');
  assert.equal(fixture.catalogSheet.rows[1][8], 'Retained book');
  assert.equal(fixture.catalogSheet.rows[1][23], '');
  assert.equal(rowsWithoutHeaders(fixture.masterSheet)[0][0], seriesId);
  assert.equal(rowsWithoutHeaders(fixture.aliasSheet)[0][1], seriesId);
}

function testImportRepairsBlankExtraKeyToTheExistingSeriesId() {
  const seriesId = 'extra-existing-id';
  const fixture = makeFixture({
    masters: [makeMaster(seriesId, {
      name: 'art', canonical: '__extra__art', media: ['画集', ''], count: 0
    })],
    aliases: [makeAlias('__extra__art', seriesId)],
    books: [makeBook('art', '', {
      uuid: '307908e3-c9e3-4e91-9750-68d30a9e84a6'
    })]
  });
  const result = fixture.context.refreshSeriesKeyAutoForImport_(fixture.catalogSheet);
  assert.equal(fixture.catalogSheet.rows[1][23], '__extra__art');
  assert.equal(result.registry.mastersAdded, 0);
  assert.equal(result.cleanup.deletedMasters, 0);
  assert.deepEqual(rowsWithoutHeaders(fixture.masterSheet).map(row => row[0]), [seriesId]);
  assert.equal(rowsWithoutHeaders(fixture.aliasSheet)[0][1], seriesId);
  assert.deepEqual(rowsWithoutHeaders(fixture.masterSheet)[0].slice(11, 13), ['画集', '']);
}

function testBlankTitleWithNormalAndExtraOwnersFailsClosedAsAmbiguous() {
  const fixture = makeFixture({
    masters: [
      makeMaster('normal-art', { canonical: 'art' }),
      makeMaster('extra-art', { canonical: '__extra__art', media: ['画集', ''] })
    ],
    aliases: [makeAlias('art', 'normal-art'), makeAlias('__extra__art', 'extra-art')],
    books: [makeBook('art', '', { uuid: '307908e3-c9e3-4e91-9750-68d30a9e84a6' })]
  });
  const before = snapshotWrites(fixture);
  assert.throws(
    () => fixture.context.refreshSeriesKeyAutoForImport_(fixture.catalogSheet),
    /Ambiguous series classification for title: art/
  );
  assert.equal(snapshotWrites(fixture), before);
  assert.deepEqual(rowsWithoutHeaders(fixture.masterSheet).map(row => row[0]), ['normal-art', 'extra-art']);
}

function testEmptyTitleRowsDoNotBlockUnrelatedOrphanDeletion() {
  const fixture = makeFixture({
    masters: [
      makeMaster('live', { canonical: 'live', count: 1 }),
      makeMaster('orphan', { canonical: 'orphan', count: 0 })
    ],
    aliases: [makeAlias('live', 'live', { count: 1 }), makeAlias('orphan', 'orphan')],
    books: [makeBook('', ''), makeBook('Live book', 'live')]
  });
  const usage = fixture.context.loadSeriesRegistryLookup_().catalogUsage;
  assert.equal(usage.unresolved.length, 0, 'blank rows and deleted titles are not unresolved books');
  const result = fixture.context.cleanupSeriesRegistryLifecycleCore_();
  assert.equal(result.deletedMasters, 1);
  assert.equal(rowsWithoutHeaders(fixture.masterSheet).some(row => row[0] === 'orphan'), false);
  assert.equal(rowsWithoutHeaders(fixture.masterSheet).some(row => row[0] === 'live'), true);
}

function testLifecycleRehomeTransfersMissingGenreAndMediaSlots() {
  const fixture = makeFixture({
    masters: [
      makeMaster('source', {
        canonical: 'sample',
        genres: ['物語', '', '', '', ''],
        media: ['', '電子書籍']
      }),
      makeMaster('target-extra', {
        canonical: '__extra__sample',
        genres: ['', '', '', '', ''],
        media: ['', '']
      })
    ],
    aliases: [makeAlias('sample', 'source'), makeAlias('__extra__sample', 'target-extra')],
    books: [makeBook('sample', '__extra__sample', { genre: '画集' })]
  });
  const result = fixture.context.cleanupSeriesRegistryLifecycleCore_();
  assert.equal(result.deletedMasters, 1);
  assert.equal(result.rehomedAliases, 1);
  assert.equal(result.metadataSlotsMerged, 2);
  const target = rowsWithoutHeaders(fixture.masterSheet)[0];
  assert.equal(target[0], 'target-extra');
  assert.deepEqual(target.slice(2, 7), ['物語', '', '', '', '']);
  assert.deepEqual(target.slice(11, 13), ['', '電子書籍']);
}

function testMetadataConflictPreservesMergeSourceButAllowsPlainOrphanDeletion() {
  const fixture = makeFixture({
    masters: [
      makeMaster('source-conflict', { canonical: 'art', genres: ['物語', '', '', '', ''] }),
      makeMaster('target-extra', { canonical: '__extra__art', genres: ['ギャグ', '', '', '', ''] }),
      makeMaster('unrelated-orphan', { canonical: 'unrelated' })
    ],
    aliases: [
      makeAlias('art', 'source-conflict'),
      makeAlias('__extra__art', 'target-extra'),
      makeAlias('unrelated', 'unrelated-orphan')
    ],
    books: [makeBook('art', '__extra__art')]
  });
  const result = fixture.context.cleanupSeriesRegistryLifecycleCore_();
  assert.equal(result.deletedMasters, 1, 'a plain orphan without a destination still follows lifecycle cleanup');
  assert.equal(rowsWithoutHeaders(fixture.masterSheet).some(row => row[0] === 'source-conflict'), true);
  assert.equal(rowsWithoutHeaders(fixture.aliasSheet).some(row => row[0] === 'art' && row[1] === 'source-conflict'), true);
  assert.equal(rowsWithoutHeaders(fixture.masterSheet).find(row => row[0] === 'target-extra')[2], 'ギャグ');
  assert.ok(result.metadataBlockers.some(blocker => blocker.includes('column C')));
}

function testConflictingMetadataFromMultipleSourcesBlocksAllLifecycleRehomes() {
  const fixture = makeFixture({
    masters: [
      makeMaster('source-art', { canonical: 'art', genres: ['物語', '', '', '', ''] }),
      makeMaster('source-artist', { canonical: 'artist', genres: ['ギャグ', '', '', '', ''] }),
      makeMaster('target-extra', { canonical: '__extra__art' })
    ],
    aliases: [
      makeAlias('art', 'source-art'),
      makeAlias('artist', 'source-artist'),
      makeAlias('__extra__art', 'target-extra'),
      makeAlias('__extra__artist', 'target-extra')
    ],
    books: [makeBook('art', '__extra__art')]
  });
  const before = snapshotWrites(fixture);
  const masterWritesBefore = fixture.masterSheet.writes;
  const aliasWritesBefore = fixture.aliasSheet.writes;
  const result = fixture.context.cleanupSeriesRegistryLifecycleCore_();
  assert.equal(snapshotWrites(fixture), before + 1, 'only the verified review hold batch is written');
  assert.equal(fixture.masterSheet.writes, masterWritesBefore);
  assert.equal(fixture.aliasSheet.writes, aliasWritesBefore);
  assert.equal(result.deletedMasters, 0);
  assert.equal(result.rehomedAliases, 0);
  assert.ok(result.metadataBlockers.some(blocker => blocker.includes('column C')));
  assert.equal(metadataMergeHoldRows(fixture).length, 2);
  assert.deepEqual(
    rowsWithoutHeaders(fixture.aliasSheet).filter(row => ['art', 'artist'].includes(row[0])).map(row => row[1]),
    ['source-art', 'source-artist']
  );
}

function testMetadataReadbackFailureKeepsLifecycleSourceAndAlias() {
  const fixture = makeFixture({
    masters: [
      makeMaster('source', {
        canonical: 'sample',
        genres: ['物語', '', '', '', ''],
        media: ['', '電子書籍']
      }),
      makeMaster('target-extra', { canonical: '__extra__sample' })
    ],
    aliases: [makeAlias('sample', 'source'), makeAlias('__extra__sample', 'target-extra')],
    books: [makeBook('sample', '__extra__sample')]
  });
  let destinationMetadataWritten = false;
  fixture.masterSheet.afterWrite = range => {
    if (range.row === 3 && range.column >= 3 && range.column <= 13) {
      destinationMetadataWritten = true;
    }
  };
  fixture.masterSheet.beforeRead = range => {
    if (destinationMetadataWritten && range.row === 3 && range.column === 3) {
      throw new Error('simulated readback failure');
    }
  };
  const result = fixture.context.cleanupSeriesRegistryLifecycleCore_();
  assert.equal(result.deletedMasters, 0);
  assert.equal(result.rehomedAliases, 0);
  assert.equal(result.metadataSlotsMerged, 0);
  assert.equal(result.metadataSlotsWritten, 2, 'destination fills are reported when readback fails');
  assert.ok(result.metadataBlockers.some(blocker => blocker.includes('readback failed')));
  assert.equal(rowsWithoutHeaders(fixture.masterSheet).some(row => row[0] === 'source'), true);
  assert.equal(rowsWithoutHeaders(fixture.aliasSheet).find(row => row[0] === 'sample')[1], 'source');
  assert.equal(fixture.masterSheet.rows[2][2], '物語');
}

function testMetadataSnapshotChangeBlocksBeforeAnyMergeWrite() {
  const fixture = makeFixture({
    masters: [
      makeMaster('source', { canonical: 'sample', genres: ['物語', '', '', '', ''] }),
      makeMaster('target-extra', { canonical: '__extra__sample' })
    ],
    aliases: [makeAlias('sample', 'source'), makeAlias('__extra__sample', 'target-extra')],
    books: [makeBook('sample', '__extra__sample')]
  });
  const registry = fixture.context.loadSeriesRegistryLookup_();
  const plan = fixture.context.buildSeriesRegistryMetadataMergePlan_(registry, [{
    sourceSeriesId: 'source',
    destinationSeriesId: 'target-extra'
  }]);
  assert.equal(plan.blockers.length, 0);

  const writesBeforeApply = snapshotWrites(fixture);
  fixture.masterSheet.rows[2][2] = 'manual concurrent edit';
  const result = fixture.context.applySeriesRegistryMetadataMergePlan_(registry, plan);
  assert.equal(result.ok, false);
  assert.ok(result.blockers.some(blocker => blocker.includes('metadata changed before merge for series target-extra')));
  assert.equal(snapshotWrites(fixture), writesBeforeApply, 'stale metadata is detected before any merge writes');
  assert.equal(fixture.masterSheet.rows[1][2], '物語', 'source metadata remains intact');
  assert.equal(fixture.masterSheet.rows[2][2], 'manual concurrent edit', 'concurrent destination edit is preserved');
  assert.equal(rowsWithoutHeaders(fixture.aliasSheet).find(row => row[0] === 'sample')[1], 'source');
}

function testFailedOnEditMetadataMergeHoldSurvivesLaterOnEditAndIsDeduped() {
  const fixture = makePendingManualMergeFixture();
  assert.throws(
    () => triggerManualXEdit(fixture, 2),
    /Manual series metadata merge blocked: metadata conflict at series target-series column C/
  );
  assert.equal(metadataMergeHoldRows(fixture).length, 1);
  assert.equal(metadataMergeHoldRows(fixture)[0][1], 'source-automatic');
  assert.equal(metadataMergeHoldRows(fixture)[0][3], 'target-series');

  triggerManualXEdit(fixture, 3);
  assert.equal(rowsWithoutHeaders(fixture.masterSheet).some(row => row[0] === 'source-automatic'), true);
  assert.equal(rowsWithoutHeaders(fixture.aliasSheet).find(row => row[0] === 'automatic')[1], 'source-automatic');
  assert.equal(metadataMergeHoldRows(fixture).length, 1, 'later unrelated edit does not duplicate the durable hold');

  triggerManualXEdit(fixture, 2);
  assert.equal(rowsWithoutHeaders(fixture.masterSheet).some(row => row[0] === 'source-automatic'), true);
  assert.equal(rowsWithoutHeaders(fixture.aliasSheet).some(row => row[0] === 'automatic'), true);
  assert.equal(metadataMergeHoldRows(fixture).length, 1, 'repeated edit keeps one hold row');
}

function testManualMetadataReadbackFailureHoldSurvivesLaterCleanup() {
  const fixture = makePendingManualMergeFixture({
    targetGenres: ['', '', '', '', ''],
    sourceMedia: ['', '電子書籍']
  });
  let destinationMetadataWritten = false;
  fixture.masterSheet.afterWrite = range => {
    if (range.row === 3 && range.column === 3) destinationMetadataWritten = true;
  };
  fixture.masterSheet.beforeRead = range => {
    if (destinationMetadataWritten && range.row === 3 && range.column === 3) {
      throw new Error('simulated manual readback failure');
    }
  };
  assert.throws(
    () => triggerManualXEdit(fixture, 2),
    /Manual series metadata merge blocked: metadata readback failed/
  );
  assert.equal(metadataMergeHoldRows(fixture).length, 1);
  fixture.masterSheet.beforeRead = null;
  const cleanup = fixture.context.cleanupSeriesRegistryLifecycleCore_();
  assert.equal(cleanup.deletedMasters, 0);
  assert.equal(rowsWithoutHeaders(fixture.masterSheet).some(row => row[0] === 'source-automatic'), true);
  assert.equal(rowsWithoutHeaders(fixture.aliasSheet).find(row => row[0] === 'automatic')[1], 'source-automatic');
  assert.equal(metadataMergeHoldRows(fixture).length, 1);
}

function testManualMetadataWriteFailureHoldSurvivesLaterCleanup() {
  const fixture = makePendingManualMergeFixture({
    targetGenres: ['', '', '', '', ''],
    sourceMedia: ['', '電子書籍']
  });
  fixture.masterSheet.beforeWrite = range => {
    if (range.row === 3 && range.column === 13) throw new Error('simulated manual write failure');
  };
  assert.throws(
    () => triggerManualXEdit(fixture, 2),
    /Manual series metadata merge blocked: metadata write failed/
  );
  assert.equal(fixture.masterSheet.rows[2][2], '物語', 'the first destination fill may remain after a later write failure');
  assert.equal(metadataMergeHoldRows(fixture).length, 1);
  fixture.masterSheet.beforeWrite = null;
  const cleanup = fixture.context.cleanupSeriesRegistryLifecycleCore_();
  assert.equal(cleanup.deletedMasters, 0);
  assert.equal(rowsWithoutHeaders(fixture.masterSheet).some(row => row[0] === 'source-automatic'), true);
  assert.equal(rowsWithoutHeaders(fixture.aliasSheet).find(row => row[0] === 'automatic')[1], 'source-automatic');
  assert.equal(metadataMergeHoldRows(fixture).length, 1);
}

function testReviewHoldWriteFailureUsesCatalogEvidenceOnLaterCleanup() {
  const fixture = makePendingManualMergeFixture({ includeOrdinaryOrphan: true });
  fixture.reviewSheet.beforeWrite = () => { throw new Error('simulated review hold append failure'); };
  assert.throws(
    () => triggerManualXEdit(fixture, 2),
    /Unable to persist metadata merge safety hold; no alias or master deletion was performed/
  );
  assert.equal(metadataMergeHoldRows(fixture).length, 0);
  assert.equal(rowsWithoutHeaders(fixture.masterSheet).some(row => row[0] === 'source-automatic'), true);

  fixture.reviewSheet.beforeWrite = null;
  const cleanup = fixture.context.cleanupSeriesRegistryLifecycleCore_();
  assert.equal(cleanup.protectedByPendingManualMerge, 1);
  assert.equal(cleanup.pendingManualMerges[0].sourceSeriesId, 'source-automatic');
  assert.equal(cleanup.pendingManualMerges[0].destinationSeriesId, 'target-series');
  assert.equal(cleanup.deletedMasters, 1, 'unrelated orphan without a matching catalog title is still deleted');
  assert.equal(rowsWithoutHeaders(fixture.masterSheet).some(row => row[0] === 'source-automatic'), true);
  assert.equal(rowsWithoutHeaders(fixture.aliasSheet).find(row => row[0] === 'automatic')[1], 'source-automatic');
  assert.equal(metadataMergeHoldRows(fixture).length, 0);
}

function testManualMergeDetectsConflictingMetadataFromMultipleSources() {
  const fixture = makeFixture({
    masters: [
      makeMaster('target', { canonical: 'target', count: 2 }),
      makeMaster('source-one', { canonical: 'automatic', genres: ['物語', '', '', '', ''] }),
      makeMaster('source-two', { canonical: 'different', genres: ['ギャグ', '', '', '', ''] })
    ],
    aliases: [
      makeAlias('target', 'target', { count: 2 }),
      makeAlias('automatic', 'source-one'),
      makeAlias('different', 'source-two')
    ],
    books: [
      makeBook('automatic', 'target', { uuid: '307908e3-c9e3-4e91-9750-68d30a9e84a6' }),
      makeBook('different', 'target', { uuid: '323908e3-c9e3-4e91-9750-68d30a9e84a7' })
    ]
  });
  const before = snapshotWrites(fixture);
  assert.throws(
    () => fixture.context.syncSeriesRegistryAfterManualKeyEdit_(fixture.catalogSheet, 2, 2),
    /Manual series metadata merge blocked: metadata conflict at series target column C/
  );
  assert.equal(snapshotWrites(fixture), before + 1, 'failed manual merge persists one review-hold batch');
  assert.equal(metadataMergeHoldRows(fixture).length, 2);
  assert.equal(rowsWithoutHeaders(fixture.masterSheet).some(row => row[0] === 'source-one'), true);
  assert.equal(rowsWithoutHeaders(fixture.masterSheet).some(row => row[0] === 'source-two'), true);
  assert.equal(rowsWithoutHeaders(fixture.aliasSheet).find(row => row[0] === 'automatic')[1], 'source-one');
  assert.equal(rowsWithoutHeaders(fixture.aliasSheet).find(row => row[0] === 'different')[1], 'source-two');
}

const tests = [
  testActualReferencesOverrideCachedCountsAndCleanupIsIdempotent,
  testReviewPipeSeparatedReferencesKeepAndDeactivateHistory,
  testRetiredStatusesAndDuplicateOwnersFailClosed,
  testInactiveSignatureOwnerBlocksNewAliasBeforeAnyWrite,
  testImportRehomesOnlySafeZeroReferenceExtraOwner,
  testImportHaltsForLiveOrReviewProtectedExtraConflicts,
  testImportPromotesExistingIdAndReportsEarlierPassChanges,
  testNewEquivalentKeysShareOneMasterAndGuardCapacity,
  testAmbiguousSignaturesAreConserved,
  testExternalReferenceProtectsOrphanAndUnresolvedBookBlocksCleanup,
  testLastBookTitleEditFollowsCanonicalButKeepsManualNameAndMetadata,
  testGeneratedNameEquivalenceHandlesKanaCaseAndExtraPrefix,
  testManualMergeDeletesOnlyUnreferencedSourceAndKeepsLiveSource,
  testMediaEditMColumnRunsInsideRegistryLockAndPromotesSameId,
  testTitleEditPreflightsInactiveAliasOwnerBeforeChangingX,
  testA1OnEditReturnsBeforeRegistryReads,
  testTitledBlankSeriesKeyOnEditFailsClosedWithoutDeletingRegistry,
  testImportRepairsBlankExtraKeyToTheExistingSeriesId,
  testBlankTitleWithNormalAndExtraOwnersFailsClosedAsAmbiguous,
  testEmptyTitleRowsDoNotBlockUnrelatedOrphanDeletion,
  testLifecycleRehomeTransfersMissingGenreAndMediaSlots,
  testMetadataConflictPreservesMergeSourceButAllowsPlainOrphanDeletion,
  testConflictingMetadataFromMultipleSourcesBlocksAllLifecycleRehomes,
  testMetadataReadbackFailureKeepsLifecycleSourceAndAlias,
  testMetadataSnapshotChangeBlocksBeforeAnyMergeWrite,
  testFailedOnEditMetadataMergeHoldSurvivesLaterOnEditAndIsDeduped,
  testManualMetadataReadbackFailureHoldSurvivesLaterCleanup,
  testManualMetadataWriteFailureHoldSurvivesLaterCleanup,
  testReviewHoldWriteFailureUsesCatalogEvidenceOnLaterCleanup,
  testManualMergeDetectsConflictingMetadataFromMultipleSources
];

tests.forEach(test => test());
console.log(`SeriesRegistry checks passed (${tests.length} scenarios).`);
