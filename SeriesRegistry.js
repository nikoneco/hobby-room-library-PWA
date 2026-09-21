/** @OnlyCurrentDoc */

const SERIES_REGISTRY_CONFIG_ = Object.freeze({
  MASTER_SHEET: 'series_master_v2',
  ALIAS_SHEET: 'series_alias_v2',
  REVIEW_SHEET: 'series_match_review_v2',
  ACTIVE_PROPERTY: 'series_registry_v2_active',
  EXTRA_PREFIX: '__extra__',
  LEGACY_MASTER_HEADERS: [
    'series_id',
    'シリーズ名',
    'J-ストーリー',
    'J-題材1',
    'J-題材2',
    'J-雰囲気',
    'J-状態',
    '蔵書数',
    '状態',
    '更新日時',
    'canonical_key'
  ],
  MASTER_HEADERS: [
    'series_id',
    'シリーズ名',
    'J-ストーリー',
    'J-題材1',
    'J-題材2',
    'J-雰囲気',
    'J-状態',
    '蔵書数',
    '状態',
    '更新日時',
    'canonical_key',
    'J-媒体1',
    'J-媒体2'
  ],
  ALIAS_HEADERS: [
    'alias_key',
    'series_id',
    '由来',
    'match_signature',
    '蔵書数',
    '更新日時'
  ],
  REVIEW_HEADERS: [
    '候補キー',
    '候補series_id',
    '比較対象キー',
    '比較対象series_id',
    '理由',
    '状態',
    '更新日時'
  ],
  METADATA_MERGE_HOLD_REASON_PREFIX: 'METADATA_MERGE_HOLD:'
});

const SERIES_REGISTRY_MEDIA_EXTRA_VALUES_ = Object.freeze([
  '写真集',
  '画集',
  '資料集',
  '写真集/画集/資料集',
  '写真集／画集／資料集'
]);

function normalizeSeriesRegistryMedia_(value) {
  return String(value || '').normalize('NFKC').trim();
}

function isSeriesRegistryExtraMedia_(value) {
  const normalized = normalizeSeriesRegistryMedia_(value);
  return SERIES_REGISTRY_MEDIA_EXTRA_VALUES_.some(candidate =>
    normalizeSeriesRegistryMedia_(candidate) === normalized
  );
}

function isSeriesRegistryLegacyExtraGenre_(value) {
  const normalized = normalizeSeriesRegistryMedia_(value);
  return normalized === normalizeSeriesRegistryMedia_('写真集/画集/資料集');
}

function isSeriesRegistryExtraClassification_(genres, media, canonicalKey) {
  if (hasExtraSeriesPrefix_(canonicalKey)) return true;
  if ((Array.isArray(genres) ? genres : []).some(isSeriesRegistryLegacyExtraGenre_)) return true;
  const populatedMedia = (Array.isArray(media) ? media : [])
    .map(normalizeSeriesRegistryMedia_)
    .filter(Boolean);
  return populatedMedia.length > 0 && populatedMedia.every(isSeriesRegistryExtraMedia_);
}

/**
 * L/Mがまだ存在しない移行前シートも読み書きできるよう、実際のヘッダーから列数を決める。
 * A:Kは互換性のため完全一致を要求し、L/Mは2列揃った場合だけ有効化する。
 */
function getSeriesRegistryMasterColumnCount_(masterSheet) {
  const legacyHeaders = SERIES_REGISTRY_CONFIG_.LEGACY_MASTER_HEADERS;
  const fullHeaders = SERIES_REGISTRY_CONFIG_.MASTER_HEADERS;
  const maxColumns = Number(masterSheet.getMaxColumns());
  if (maxColumns < legacyHeaders.length) {
    throw new Error('series_master_v2 does not have enough columns');
  }
  const readColumns = Math.min(maxColumns, fullHeaders.length);
  const actual = masterSheet.getRange(1, 1, 1, readColumns).getDisplayValues()[0];
  if (actual.slice(0, legacyHeaders.length).join('\u0000') !== legacyHeaders.join('\u0000')) {
    throw new Error('series_master_v2 headers do not match');
  }
  if (readColumns < fullHeaders.length) {
    if (actual.slice(legacyHeaders.length).some(Boolean)) {
      throw new Error('series_master_v2 media headers do not match');
    }
    return legacyHeaders.length;
  }

  const actualMedia = actual.slice(legacyHeaders.length, fullHeaders.length);
  const expectedMedia = fullHeaders.slice(legacyHeaders.length);
  if (actualMedia.join('\u0000') === expectedMedia.join('\u0000')) return fullHeaders.length;
  if (actualMedia.some(Boolean)) {
    throw new Error('series_master_v2 media headers do not match');
  }
  return legacyHeaders.length;
}

function buildSeriesRegistryMasterRow_(
  seriesId,
  displayName,
  genreSlots,
  count,
  status,
  timestamp,
  canonicalKey,
  mediaSlots,
  columnCount
) {
  const genres = Array.isArray(genreSlots) ? genreSlots.slice(0, 5) : [];
  const media = Array.isArray(mediaSlots) ? mediaSlots.slice(0, 2) : [];
  while (genres.length < 5) genres.push('');
  while (media.length < 2) media.push('');
  const row = [
    seriesId,
    displayName,
    ...genres,
    Number(count || 0),
    status || 'ACTIVE',
    timestamp || new Date(),
    normalizeSeriesAliasKey_(canonicalKey),
    ...media
  ];
  return row.slice(0, Number(columnCount) || SERIES_REGISTRY_CONFIG_.MASTER_HEADERS.length);
}

function normalizeSeriesAliasKey_(value) {
  return String(value || '')
    .normalize('NFKC')
    .replace(/　/g, ' ')
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

function stripExtraSeriesPrefix_(value) {
  const key = normalizeSeriesAliasKey_(value);
  return key.indexOf(SERIES_REGISTRY_CONFIG_.EXTRA_PREFIX) === 0
    ? key.slice(SERIES_REGISTRY_CONFIG_.EXTRA_PREFIX.length)
    : key;
}

function hasExtraSeriesPrefix_(value) {
  return normalizeSeriesAliasKey_(value).indexOf(SERIES_REGISTRY_CONFIG_.EXTRA_PREFIX) === 0;
}

function normalizeSeriesRegistryStatus_(value) {
  return String(value || '').trim().toUpperCase();
}

function isSeriesRegistryMasterLookupActive_(status) {
  const normalized = normalizeSeriesRegistryStatus_(status);
  return normalized !== 'MERGED' && normalized !== 'INACTIVE';
}

function parseSeriesRegistryReviewIds_(value) {
  return Array.from(new Set(String(value || '')
    .split('|')
    .map(item => String(item || '').trim())
    .filter(Boolean)));
}

function ensureSeriesRegistryRowCapacity_(sheet, startRow, rowCount) {
  const firstRow = Math.max(1, Number(startRow) || 1);
  const count = Math.max(0, Number(rowCount) || 0);
  const requiredLastRow = firstRow + count - 1;
  if (!count || !sheet || typeof sheet.getMaxRows !== 'function') return requiredLastRow;
  const maxRows = Number(sheet.getMaxRows()) || 0;
  if (requiredLastRow > maxRows) {
    if (typeof sheet.insertRowsAfter !== 'function') {
      throw new Error(`Sheet row capacity is insufficient: need ${requiredLastRow}, have ${maxRows}`);
    }
    sheet.insertRowsAfter(maxRows, requiredLastRow - maxRows);
  }
  return requiredLastRow;
}

function getNextSeriesRegistryRow_(sheet) {
  const lastDataRow = getLastDataRow(sheet, 1);
  const lastContentRow = typeof sheet.getLastRow === 'function'
    ? Number(sheet.getLastRow()) || 1
    : 1;
  return Math.max(lastDataRow, lastContentRow) + 1;
}

function appendSeriesRegistryRows_(sheet, rows, columnCount, copyPreviousTemplate) {
  const values = Array.isArray(rows) ? rows : [];
  if (!values.length) return 0;
  const startRow = getNextSeriesRegistryRow_(sheet);
  ensureSeriesRegistryRowCapacity_(sheet, startRow, values.length);
  const target = sheet.getRange(startRow, 1, values.length, columnCount);
  if (copyPreviousTemplate && startRow > 2) {
    const template = sheet.getRange(startRow - 1, 1, 1, columnCount);
    template.copyTo(target, SpreadsheetApp.CopyPasteType.PASTE_FORMAT, false);
    template.copyTo(target, SpreadsheetApp.CopyPasteType.PASTE_DATA_VALIDATION, false);
  }
  target.setValues(values);
  return startRow;
}

/**
 * 空白、括弧、記号、かな表記だけの差を同一候補として扱う照合署名。
 * 資料系prefixは通常シリーズとの誤結合を避けるため署名へ残す。
 */
function buildSeriesAliasSignature_(value) {
  const normalized = normalizeSeriesAliasKey_(value);
  if (!normalized) return '';
  const isExtra = hasExtraSeriesPrefix_(normalized);
  const base = stripExtraSeriesPrefix_(normalized);
  const signature = normalizeKana(base);
  if (!signature) return '';
  return `${isExtra ? 'extra' : 'normal'}:${signature}`;
}

/**
 * 機械照合用キーとは別に、人が読めるシリーズ名をタイトルから作る。
 * カタカナ・大小文字・記号は表示上の表記を維持する。
 */
function buildSeriesRegistryDisplayName_(title, fallbackKey) {
  let value = String(title || '').normalize('NFKC').replace(/　/g, ' ').trim();
  if (value) {
    const parts = value.split(/\s*=\s*/);
    if (parts.length >= 2) {
      const left = String(parts[0] || '').trim();
      const right = parts.slice(1).join(' = ').trim();
      if (
        left &&
        (/[぀-ヿ㐀-鿿]/.test(left) ||
          (left.length <= 40 && /[a-zA-Z]/.test(right) && /^[\x00-\x7F\s\p{P}\p{S}]+$/u.test(right)))
      ) {
        value = left;
      }
    }

    value = value.replace(
      /(特装版|限定版|通常版|小冊子付き|ドラマCD付き|CD付き|Blu-ray付き|DVD付き|フィギュア付き|特典付き)/gi,
      ''
    );
    value = value.replace(/\s*第\s*\d+\s*巻\s*.*$/i, '');
    value = value.replace(/\s*第\s*\d+\s*集\s*.*$/i, '');
    value = value.replace(/\s*[〈<]\s*\d+\s*[〉>]\s*.*$/i, '');
    value = value.replace(/\s*[〈<]\s*第?\s*[一二三四五六七八九十百千〇零\d]+\s*集\s*[〉>]\s*.*$/i, '');
    value = value.replace(/\s*\d+\s*巻\s*.*$/i, '');
    value = value.replace(/\s*[\(（]\s*\d+\s*[\)）]\s*.*$/i, '');
    value = value.replace(/\s+v(?:ol(?:ume)?\.?|\.?)\s*\d+\s*.*$/i, '');
    value = value.replace(/\s*#\s*\d+\s*.*$/i, '');
    value = value.replace(/\s*×\s*\d+\s*.*$/i, '');
    value = value.replace(/\s*[上中下]\s*巻\s*.*$/i, '');
    value = value.replace(/\s+[上中下]\s*$/i, '');
    value = value.replace(/\s+\d+\s*.*$/i, '');
    value = value.replace(/[\.．。]+$/g, '');
    value = value.replace(/\s*[:：]\s*$/g, '');
    value = value.replace(/\s+/g, ' ').trim();
  }

  if (value) return value;
  return stripExtraSeriesPrefix_(fallbackKey);
}

function chooseSeriesRegistryDisplayName_(titles, fallbackKey) {
  const candidates = (Array.isArray(titles) ? titles : [])
    .map(title => buildSeriesRegistryDisplayName_(title, ''))
    .filter(Boolean);
  if (!candidates.length) return buildSeriesRegistryDisplayName_('', fallbackKey);
  const unique = Array.from(new Set(candidates));
  unique.sort((a, b) => {
    const lengthDiff = a.replace(/\s/g, '').length - b.replace(/\s/g, '').length;
    return lengthDiff || a.length - b.length || a.localeCompare(b, 'ja');
  });
  return unique[0];
}

function buildGenreCategoryLookup_(rows) {
  const lookup = new Map();
  (Array.isArray(rows) ? rows : []).forEach(row => {
    const genre = String(Array.isArray(row) ? row[0] || '' : '').trim();
    const category = String(Array.isArray(row) ? row[1] || '' : '').trim();
    if (genre && category && !lookup.has(genre)) lookup.set(genre, category);
  });
  return lookup;
}

function buildSeriesGenreClassification_(genreText, categoryLookup) {
  const lookup = categoryLookup instanceof Map ? categoryLookup : new Map();
  const genres = String(genreText || '')
    .split(',')
    .map(value => value.trim())
    .filter(Boolean);
  const slots = ['', '', '', '', ''];
  const media = ['', ''];

  genres.forEach(genre => {
    if (isSeriesRegistryExtraMedia_(genre)) {
      if (!media[0]) media[0] = genre;
      return;
    }
    switch (lookup.get(genre)) {
      case 'ストーリー':
        if (!slots[0]) slots[0] = genre;
        break;
      case '題材':
        if (!slots[1]) slots[1] = genre;
        else if (!slots[2] && slots[1] !== genre) slots[2] = genre;
        break;
      case '雰囲気':
        if (!slots[3]) slots[3] = genre;
        break;
      case '状況':
        if (!slots[4]) slots[4] = genre;
        break;
      case '媒体':
        if (!media[0]) media[0] = genre;
        else if (!media[1] && media[0] !== genre) media[1] = genre;
        break;
    }
  });

  return { genres: slots, media };
}

function buildSeriesGenreSlots_(genreText, categoryLookup) {
  return buildSeriesGenreClassification_(genreText, categoryLookup).genres;
}

function buildSeriesRegistryMigrationPlan_(catalogRows, genreCategoryRows, createSeriesId, nowText) {
  const rows = Array.isArray(catalogRows) ? catalogRows : [];
  const categoryLookup = buildGenreCategoryLookup_(genreCategoryRows);
  const createId = typeof createSeriesId === 'function'
    ? createSeriesId
    : () => `series_${Utilities.getUuid()}`;
  const timestamp = String(nowText || new Date().toISOString());
  const groups = new Map();

  rows.forEach(row => {
    const item = row && typeof row === 'object' && !Array.isArray(row)
      ? row
      : {
          title: Array.isArray(row) ? row[0] : '',
          author: Array.isArray(row) ? row[1] : '',
          publisher: Array.isArray(row) ? row[2] : '',
          genreText: Array.isArray(row) ? row[3] : '',
          rawKey: Array.isArray(row) ? row[4] : ''
        };
    const rawKey = normalizeSeriesAliasKey_(item.rawKey);
    if (!rawKey) return;
    if (!groups.has(rawKey)) {
      groups.set(rawKey, {
        canonicalKey: rawKey,
        titles: [],
        authors: new Set(),
        publishers: new Set(),
        genreTexts: new Set(),
        count: 0
      });
    }
    const group = groups.get(rawKey);
    group.count += 1;
    if (item.title) group.titles.push(String(item.title));
    if (item.author) group.authors.add(String(item.author).trim());
    if (item.publisher) group.publishers.add(String(item.publisher).trim());
    const genreText = String(item.genreText || '').trim();
    if (genreText) group.genreTexts.add(genreText);
  });

  const masterRows = [];
  const aliasCandidates = [];
  const conflicts = [];
  const idByCanonicalKey = new Map();

  [...groups.values()]
    .sort((a, b) => a.canonicalKey.localeCompare(b.canonicalKey, 'ja'))
    .forEach(group => {
      const genreTexts = [...group.genreTexts];
      if (genreTexts.length > 1) {
        conflicts.push({
          type: 'GENRE_CONFLICT',
          key: group.canonicalKey,
          values: genreTexts
        });
      }
      const genreText = genreTexts[0] || '';
      const seriesId = String(createId(group.canonicalKey) || '').trim();
      if (!seriesId) throw new Error(`series_id generation failed: ${group.canonicalKey}`);
      idByCanonicalKey.set(group.canonicalKey, seriesId);
      const classification = buildSeriesGenreClassification_(genreText, categoryLookup);
      const displayName = chooseSeriesRegistryDisplayName_(group.titles, group.canonicalKey);
      masterRows.push(buildSeriesRegistryMasterRow_(
        seriesId,
        displayName,
        classification.genres,
        group.count,
        'ACTIVE',
        timestamp,
        group.canonicalKey,
        classification.media,
        SERIES_REGISTRY_CONFIG_.MASTER_HEADERS.length
      ));
      aliasCandidates.push({
        aliasKey: group.canonicalKey,
        seriesId,
        source: 'MIGRATION_X',
        count: group.count
      });

      if (hasExtraSeriesPrefix_(group.canonicalKey)) {
        aliasCandidates.push({
          aliasKey: stripExtraSeriesPrefix_(group.canonicalKey),
          seriesId,
          source: 'EXTRA_BASE',
          count: group.count
        });
      }
    });

  const aliasByKey = new Map();
  aliasCandidates.forEach(candidate => {
    const aliasKey = normalizeSeriesAliasKey_(candidate.aliasKey);
    if (!aliasKey) return;
    const existing = aliasByKey.get(aliasKey);
    if (existing && existing.seriesId !== candidate.seriesId) {
      conflicts.push({
        type: 'ALIAS_CONFLICT',
        key: aliasKey,
        values: [existing.seriesId, candidate.seriesId]
      });
      return;
    }
    if (!existing || candidate.source === 'MIGRATION_X') {
      aliasByKey.set(aliasKey, Object.assign({}, candidate, { aliasKey }));
    }
  });

  const aliasRows = [...aliasByKey.values()]
    .sort((a, b) => a.aliasKey.localeCompare(b.aliasKey, 'ja'))
    .map(candidate => [
      candidate.aliasKey,
      candidate.seriesId,
      candidate.source,
      buildSeriesAliasSignature_(candidate.aliasKey),
      candidate.count,
      timestamp
    ]);

  const signatureOwners = new Map();
  aliasRows.forEach(row => {
    const signature = String(row[3] || '');
    const seriesId = String(row[1] || '');
    if (!signature || !seriesId) return;
    if (!signatureOwners.has(signature)) signatureOwners.set(signature, new Set());
    signatureOwners.get(signature).add(seriesId);
  });
  const signatureConflicts = [...signatureOwners.entries()]
    .filter(([, ids]) => ids.size > 1)
    .map(([signature, ids]) => ({
      type: 'SIGNATURE_CONFLICT',
      key: signature,
      values: [...ids]
    }));

  return {
    masterRows,
    aliasRows,
    conflicts,
    signatureConflicts,
    idByCanonicalKey,
    bookCount: rows.filter(row => normalizeSeriesAliasKey_(row && (row.rawKey || row[4]))).length,
    seriesCount: masterRows.length,
    aliasCount: aliasRows.length
  };
}

function isSeriesRegistryV2Active_() {
  try {
    if (PropertiesService.getScriptProperties().getProperty(
      SERIES_REGISTRY_CONFIG_.ACTIVE_PROPERTY
    ) === '1') return true;

    const spreadsheet = SpreadsheetApp.getActive();
    const masterSheet = spreadsheet.getSheetByName(SERIES_REGISTRY_CONFIG_.MASTER_SHEET);
    const aliasSheet = spreadsheet.getSheetByName(SERIES_REGISTRY_CONFIG_.ALIAS_SHEET);
    const mainSheet = spreadsheet.getSheetByName(CONFIG.SHEETS.MAIN);
    if (!masterSheet || !aliasSheet || !mainSheet) return false;
    const genreFormula = mainSheet.getRange(1, CONFIG.COL.GENRE).getFormula();
    return genreFormula.indexOf(`${SERIES_REGISTRY_CONFIG_.ALIAS_SHEET}!`) !== -1;
  } catch (error) {
    console.error('isSeriesRegistryV2Active_ error:', error);
    return false;
  }
}

function loadSeriesRegistryLookup_() {
  if (!isSeriesRegistryV2Active_()) return null;
  const spreadsheet = SpreadsheetApp.getActive();
  const masterSheet = spreadsheet.getSheetByName(SERIES_REGISTRY_CONFIG_.MASTER_SHEET);
  const aliasSheet = spreadsheet.getSheetByName(SERIES_REGISTRY_CONFIG_.ALIAS_SHEET);
  if (!masterSheet || !aliasSheet) return null;

  const masterLastRow = Math.max(1, Number(masterSheet.getLastRow()) || getLastDataRow(masterSheet, 1));
  const aliasLastRow = Math.max(1, Number(aliasSheet.getLastRow()) || getLastDataRow(aliasSheet, 1));
  const masterColumnCount = getSeriesRegistryMasterColumnCount_(masterSheet);
  const masterRows = masterLastRow >= 2
    ? masterSheet.getRange(
        2,
        1,
        masterLastRow - 1,
        masterColumnCount
      ).getDisplayValues()
    : [];
  const aliasSheetRows = aliasLastRow >= 2
    ? aliasSheet.getRange(2, 1, aliasLastRow - 1, 6).getDisplayValues()
    : [];

  const masterById = new Map();
  const allMasterById = new Map();
  const duplicateMasterIds = new Set();
  const malformedMasterRows = [];
  masterRows.forEach((row, index) => {
    const seriesId = String(row[0] || '').trim();
    if (!seriesId) {
      if (row.some(value => String(value || '').trim())) {
        malformedMasterRows.push({ row: index + 2, rawRow: row.slice() });
      }
      return;
    }
    if (allMasterById.has(seriesId)) {
      duplicateMasterIds.add(seriesId);
      return;
    }
    const genres = row.slice(2, 7).map(value => String(value || '').trim());
    const media = masterColumnCount > SERIES_REGISTRY_CONFIG_.LEGACY_MASTER_HEADERS.length
      ? row.slice(11, 13).map(value => String(value || '').trim())
      : ['', ''];
    const master = {
      seriesId,
      displayName: String(row[1] || '').trim(),
      canonicalKey: normalizeSeriesAliasKey_(row[10] || row[1]),
      genres,
      media,
      status: normalizeSeriesRegistryStatus_(row[8]) || 'ACTIVE',
      isExtra: isSeriesRegistryExtraClassification_(
        genres,
        media,
        row[10] || row[1]
      ),
      row: index + 2,
      rawRow: row.slice()
    };
    allMasterById.set(seriesId, master);
    if (isSeriesRegistryMasterLookupActive_(master.status)) masterById.set(seriesId, master);
  });

  const aliasByKey = new Map();
  const aliasOwnersByKey = new Map();
  const allAliasOwnersByKey = new Map();
  const ambiguousAliasKeys = new Set();
  const aliasRowsBySeriesId = new Map();
  const allAliasRowsBySeriesId = new Map();
  const parsedAliasRows = [];
  const signatureOwners = new Map();
  const allSignatureOwners = new Map();
  const danglingAliasRows = [];
  aliasSheetRows.forEach((row, index) => {
    const aliasKey = normalizeSeriesAliasKey_(row[0]);
    const seriesId = String(row[1] || '').trim();
    const signature = buildSeriesAliasSignature_(aliasKey);
    if (!aliasKey || !seriesId) return;
    const alias = { aliasKey, seriesId, signature, row: index + 2, rawRow: row.slice() };
    parsedAliasRows.push(alias);
    if (!allAliasRowsBySeriesId.has(seriesId)) allAliasRowsBySeriesId.set(seriesId, []);
    allAliasRowsBySeriesId.get(seriesId).push(alias);
    if (!allAliasOwnersByKey.has(aliasKey)) allAliasOwnersByKey.set(aliasKey, new Set());
    allAliasOwnersByKey.get(aliasKey).add(seriesId);
    if (signature) {
      if (!allSignatureOwners.has(signature)) allSignatureOwners.set(signature, new Set());
      allSignatureOwners.get(signature).add(seriesId);
    }
    if (!allMasterById.has(seriesId)) {
      danglingAliasRows.push(alias);
      return;
    }
    if (!masterById.has(seriesId)) return;
    if (!aliasRowsBySeriesId.has(seriesId)) aliasRowsBySeriesId.set(seriesId, []);
    aliasRowsBySeriesId.get(seriesId).push(alias);
    if (!aliasOwnersByKey.has(aliasKey)) aliasOwnersByKey.set(aliasKey, new Set());
    aliasOwnersByKey.get(aliasKey).add(seriesId);
    if (signature) {
      if (!signatureOwners.has(signature)) signatureOwners.set(signature, new Set());
      signatureOwners.get(signature).add(seriesId);
    }
  });

  aliasOwnersByKey.forEach((seriesIds, aliasKey) => {
    if (seriesIds.size === 1) {
      aliasByKey.set(aliasKey, {
        aliasKey,
        seriesId: [...seriesIds][0],
        row: (aliasRowsBySeriesId.get([...seriesIds][0]) || [])
          .find(alias => alias.aliasKey === aliasKey).row
      });
    } else {
      ambiguousAliasKeys.add(aliasKey);
    }
  });

  const uniqueSeriesIdBySignature = new Map();
  const ambiguousSignatures = new Set();
  signatureOwners.forEach((seriesIds, signature) => {
    if (seriesIds.size === 1) uniqueSeriesIdBySignature.set(signature, [...seriesIds][0]);
    else ambiguousSignatures.add(signature);
  });

  const lookup = {
    masterById,
    allMasterById,
    duplicateMasterIds,
    malformedMasterRows,
    aliasByKey,
    aliasOwnersByKey,
    allAliasOwnersByKey,
    ambiguousAliasKeys,
    aliasRowsBySeriesId,
    allAliasRowsBySeriesId,
    allAliasRows: parsedAliasRows,
    danglingAliasRows,
    uniqueSeriesIdBySignature,
    signatureOwners,
    allSignatureOwners,
    ambiguousSignatures,
    masterColumnCount,
    masterSheet,
    aliasSheet
  };
  lookup.catalogUsage = readSeriesRegistryCatalogUsage_(lookup);
  return lookup;
}

function readSeriesRegistryCatalogUsage_(lookup, catalogSheet) {
  const result = {
    refsBySeriesId: new Map(),
    keyCounts: new Map(),
    checkedBooks: 0,
    unresolved: [],
    blankKeyRows: [],
    pendingManualMergePairs: [],
    complete: false
  };
  if (!lookup || typeof CONFIG === 'undefined' || !CONFIG.SHEETS || !CONFIG.COL) return result;
  const sheet = catalogSheet || getSheet(CONFIG.SHEETS.MAIN);
  const lastRow = getLastDataRow(sheet, CONFIG.COL.TITLE);
  if (lastRow < 2) {
    result.complete = true;
    return result;
  }
  const keys = sheet
    .getRange(2, CONFIG.COL.SERIES_KEY_AUTO, lastRow - 1, 1)
    .getDisplayValues();
  const titles = sheet
    .getRange(2, CONFIG.COL.TITLE, lastRow - 1, 1)
    .getDisplayValues();
  const resolvedCatalogRows = [];
  result.checkedBooks = keys.length;
  keys.forEach((row, index) => {
    const key = normalizeSeriesAliasKey_(row[0]);
    const title = String(titles[index] ? titles[index][0] || '' : '').trim();
    if (!key) {
      if (title) {
        const unresolved = {
          row: index + 2,
          key: '',
          reason: 'TITLE_WITHOUT_SERIES_KEY',
          title
        };
        result.unresolved.push(unresolved);
        result.blankKeyRows.push(unresolved);
      }
      return;
    }
    result.keyCounts.set(key, (result.keyCounts.get(key) || 0) + 1);
    let seriesId = '';
    if (!(lookup.ambiguousAliasKeys && lookup.ambiguousAliasKeys.has(key))) {
      const exact = lookup.aliasByKey.get(key);
      seriesId = exact ? exact.seriesId : '';
    }
    const allOwners = lookup.allAliasOwnersByKey && lookup.allAliasOwnersByKey.get(key);
    if (!seriesId && !(allOwners && allOwners.size)) {
      const signature = buildSeriesAliasSignature_(key);
      seriesId = lookup.uniqueSeriesIdBySignature.get(signature) || '';
    }
    if (!seriesId) {
      result.unresolved.push({
        row: index + 2,
        key,
        reason: 'SERIES_KEY_NOT_RESOLVED'
      });
      return;
    }
    result.refsBySeriesId.set(
      seriesId,
      (result.refsBySeriesId.get(seriesId) || 0) + 1
    );
    if (title) {
      const autoKeys = [
        typeof generateSeriesKeyAuto === 'function' ? generateSeriesKeyAuto(title) : '',
        typeof extractSeriesLookupKeyFromTitle_ === 'function'
          ? extractSeriesLookupKeyFromTitle_(title)
          : ''
      ];
      const baseSignatures = new Set(autoKeys
        .map(autoKey => normalizeSeriesAliasKey_(autoKey))
        .filter(Boolean)
        .map(autoKey => buildSeriesRegistryBaseSignature_(autoKey))
        .filter(Boolean));
      if (baseSignatures.size) {
        resolvedCatalogRows.push({ row: index + 2, title, destinationSeriesId: seriesId, baseSignatures });
      }
    }
  });
  const sourceIdsByBaseSignature = new Map();
  if (lookup.allAliasRowsBySeriesId instanceof Map) {
    lookup.allAliasRowsBySeriesId.forEach((aliases, seriesId) => {
      (aliases || []).forEach(alias => {
        const signature = buildSeriesRegistryBaseSignature_(alias.aliasKey);
        if (!signature) return;
        if (!sourceIdsByBaseSignature.has(signature)) sourceIdsByBaseSignature.set(signature, new Set());
        sourceIdsByBaseSignature.get(signature).add(seriesId);
      });
    });
  }
  const pendingPairsByIds = new Map();
  resolvedCatalogRows.forEach(row => {
    row.baseSignatures.forEach(signature => {
      const sourceIds = sourceIdsByBaseSignature.get(signature) || new Set();
      sourceIds.forEach(sourceSeriesId => {
        if (sourceSeriesId === row.destinationSeriesId) return;
        if ((result.refsBySeriesId.get(sourceSeriesId) || 0) > 0) return;
        const pairKey = `${sourceSeriesId}\u0000${row.destinationSeriesId}`;
        let pair = pendingPairsByIds.get(pairKey);
        if (!pair) {
          pair = {
            sourceSeriesId,
            destinationSeriesId: row.destinationSeriesId,
            rows: [],
            titles: []
          };
          pendingPairsByIds.set(pairKey, pair);
        }
        if (!pair.rows.includes(row.row)) pair.rows.push(row.row);
        if (!pair.titles.includes(row.title)) pair.titles.push(row.title);
      });
    });
  });
  result.pendingManualMergePairs = [...pendingPairsByIds.values()];
  result.complete = true;
  return result;
}

function resolveSeriesRegistryKey_(rawKey, lookup) {
  const registry = lookup || loadSeriesRegistryLookup_();
  const key = normalizeSeriesAliasKey_(rawKey);
  if (!registry || !key) return null;
  if (registry.ambiguousAliasKeys && registry.ambiguousAliasKeys.has(key)) return null;
  const exact = registry.aliasByKey.get(key);
  let seriesId = exact ? exact.seriesId : '';
  let matchedBy = exact ? 'EXACT_ALIAS' : '';

  if (!seriesId) {
    const allOwners = registry.allAliasOwnersByKey && registry.allAliasOwnersByKey.get(key);
    if (!(allOwners && allOwners.size)) {
      const signature = buildSeriesAliasSignature_(key);
      seriesId = registry.uniqueSeriesIdBySignature.get(signature) || '';
      if (seriesId) matchedBy = 'UNIQUE_SIGNATURE';
    }
  }

  const master = seriesId ? registry.masterById.get(seriesId) : null;
  if (!master) return null;
  return {
    seriesId,
    canonicalKey: master.canonicalKey,
    displayName: master.displayName,
    genres: master.genres.slice(),
    media: Array.isArray(master.media) ? master.media.slice() : ['', ''],
    isExtra: Boolean(master.isExtra || hasExtraSeriesPrefix_(key)),
    matchedBy
  };
}

function buildSeriesRegistryExtraLookup_(lookup) {
  const registry = lookup || loadSeriesRegistryLookup_();
  if (!registry) return new Map();
  const result = new Map();
  const usage = registry.catalogUsage || (
    registry.masterSheet && registry.aliasSheet
      ? readSeriesRegistryCatalogUsage_(registry)
      : {
          refsBySeriesId: new Map(
            [...registry.masterById.keys()].map(seriesId => [seriesId, 1])
          )
        }
  );
  const normalOwnersByBase = new Map();
  const extraOwnersByBase = new Map();
  const ambiguousBaseKeys = new Set();
  const exactSeriesIdByKey = new Map();
  const exactIsExtraByKey = new Map();
  const pendingBlankTitleBases = new Set();
  (usage.blankKeyRows || []).forEach(item => {
    const title = String(item && item.title || '').trim();
    if (!title) return;
    const generated = typeof generateSeriesKeyAuto === 'function'
      ? normalizeSeriesAliasKey_(generateSeriesKeyAuto(title))
      : '';
    const extracted = typeof extractSeriesLookupKeyFromTitle_ === 'function'
      ? normalizeSeriesAliasKey_(extractSeriesLookupKeyFromTitle_(title))
      : '';
    if (generated) pendingBlankTitleBases.add(stripExtraSeriesPrefix_(generated));
    if (extracted) pendingBlankTitleBases.add(stripExtraSeriesPrefix_(extracted));
  });
  const addOwner = (map, key, seriesId) => {
    if (!map.has(key)) map.set(key, new Set());
    map.get(key).add(seriesId);
  };

  registry.aliasByKey.forEach((alias, aliasKey) => {
    const master = registry.masterById.get(alias.seriesId);
    const hasLiveCatalogReference = usage.refsBySeriesId.get(alias.seriesId) > 0;
    const hasPendingBlankTitleMatch = pendingBlankTitleBases.has(stripExtraSeriesPrefix_(aliasKey));
    if (!master || (!hasLiveCatalogReference && !hasPendingBlankTitleMatch)) return;
    const isExtra = Boolean(master.isExtra || hasExtraSeriesPrefix_(aliasKey));
    exactSeriesIdByKey.set(aliasKey, alias.seriesId);
    exactIsExtraByKey.set(aliasKey, isExtra);
    result.set(aliasKey, isExtra);
    const baseKey = stripExtraSeriesPrefix_(aliasKey);
    addOwner(isExtra ? extraOwnersByBase : normalOwnersByBase, baseKey, alias.seriesId);
  });

  const baseKeys = new Set([
    ...normalOwnersByBase.keys(),
    ...extraOwnersByBase.keys()
  ]);
  baseKeys.forEach(baseKey => {
    const normalIds = normalOwnersByBase.get(baseKey) || new Set();
    const extraIds = extraOwnersByBase.get(baseKey) || new Set();
    if (normalIds.size > 1 || extraIds.size > 1) {
      ambiguousBaseKeys.add(baseKey);
      return;
    }
    if (normalIds.size === 1) {
      const normalId = [...normalIds][0];
      result.set(baseKey, false);
      if (extraIds.size === 1 && [...extraIds][0] !== normalId) {
        ambiguousBaseKeys.add(baseKey);
      }
      return;
    }
    if (extraIds.size === 1) result.set(baseKey, true);
  });

  result.ambiguousBaseKeys = ambiguousBaseKeys;
  result.exactSeriesIdByKey = exactSeriesIdByKey;
  result.exactIsExtraByKey = exactIsExtraByKey;
  return result;
}

function buildSeriesRegistryExtraAliasPlan_(registry) {
  const additions = [];
  const conflicts = [];
  const plannedByKey = new Map();

  registry.aliasByKey.forEach((alias, aliasKey) => {
    const master = registry.masterById.get(alias.seriesId);
    if (!master) return;
    const baseKey = stripExtraSeriesPrefix_(aliasKey);
    const desiredKey = master.isExtra
      ? `${SERIES_REGISTRY_CONFIG_.EXTRA_PREFIX}${baseKey}`
      : baseKey;
    if (!desiredKey || desiredKey === aliasKey) return;
    const allOwners = registry.allAliasOwnersByKey && registry.allAliasOwnersByKey.get(desiredKey);
    if (allOwners && [...allOwners].some(seriesId => seriesId !== alias.seriesId)) {
      conflicts.push({ aliasKey: desiredKey, seriesIds: [...allOwners, alias.seriesId] });
      return;
    }
    if (registry.ambiguousAliasKeys && registry.ambiguousAliasKeys.has(desiredKey)) {
      conflicts.push({
        aliasKey: desiredKey,
        seriesIds: [...registry.aliasOwnersByKey.get(desiredKey)]
      });
      return;
    }
    const existing = registry.aliasByKey.get(desiredKey);
    if (existing && existing.seriesId !== alias.seriesId) {
      conflicts.push({ aliasKey: desiredKey, seriesIds: [existing.seriesId, alias.seriesId] });
      return;
    }
    const planned = plannedByKey.get(desiredKey);
    if (planned && planned.seriesId !== alias.seriesId) {
      conflicts.push({ aliasKey: desiredKey, seriesIds: [planned.seriesId, alias.seriesId] });
      return;
    }
    if (!existing && !planned) {
      const item = {
        aliasKey: desiredKey,
        seriesId: alias.seriesId,
        source: master.isExtra ? 'EXTRA_DERIVED' : 'NORMAL_DERIVED'
      };
      additions.push(item);
      plannedByKey.set(desiredKey, item);
    }
  });

  return { additions, conflicts };
}

function getSeriesRegistryIntegrityBlockers_(registry) {
  if (!registry) return ['registry unavailable'];
  const blockers = [];
  if (registry.duplicateMasterIds && registry.duplicateMasterIds.size) blockers.push('duplicate master ids');
  if (registry.malformedMasterRows && registry.malformedMasterRows.length) blockers.push('master rows missing series_id');
  if (registry.danglingAliasRows && registry.danglingAliasRows.length) blockers.push('dangling aliases');
  if (registry.ambiguousAliasKeys && registry.ambiguousAliasKeys.size) blockers.push('alias keys with multiple active owners');
  if (registry.allAliasOwnersByKey) {
    for (const owners of registry.allAliasOwnersByKey.values()) {
      if (owners.size > 1) {
        blockers.push('alias keys with multiple master owners');
        break;
      }
    }
  }
  return blockers;
}

function readSeriesRegistryMergeMetadataSnapshot_(registry, master) {
  const sheet = registry.masterSheet;
  const row = master.row;
  const genreRange = sheet.getRange(row, 3, 1, 5);
  const genreValues = genreRange.getValues()[0];
  const genreFormulas = genreRange.getFormulas()[0];
  let mediaValues = ['', ''];
  let mediaFormulas = ['', ''];
  if (registry.masterColumnCount > SERIES_REGISTRY_CONFIG_.LEGACY_MASTER_HEADERS.length) {
    const mediaRange = sheet.getRange(row, 12, 1, 2);
    mediaValues = mediaRange.getValues()[0];
    mediaFormulas = mediaRange.getFormulas()[0];
  }
  return {
    seriesId: String(sheet.getRange(row, 1).getDisplayValue() || '').trim(),
    row,
    genres: genreValues,
    genreFormulas,
    media: mediaValues,
    mediaFormulas
  };
}

function seriesRegistryMergeValueEquals_(left, right) {
  if (left instanceof Date || right instanceof Date) {
    return left instanceof Date && right instanceof Date && left.getTime() === right.getTime();
  }
  if (left === right) return true;
  if (left == null || right == null) {
    return (left == null || left === '') && (right == null || right === '');
  }
  return typeof left === typeof right && String(left) === String(right);
}

function seriesRegistryMergeText_(value) {
  return String(value == null ? '' : value).normalize('NFKC').trim();
}

function seriesRegistryMergeSlotIsEmpty_(value, formula) {
  return !formula && !seriesRegistryMergeText_(value);
}

function seriesRegistryMergeSnapshotEquals_(left, right) {
  if (!left || !right || left.seriesId !== right.seriesId) return false;
  const equalSlots = (leftValues, rightValues, leftFormulas, rightFormulas) =>
    leftValues.length === rightValues.length && leftValues.every((value, index) =>
      seriesRegistryMergeValueEquals_(value, rightValues[index]) &&
      String(leftFormulas[index] || '') === String(rightFormulas[index] || '')
    );
  return equalSlots(left.genres, right.genres, left.genreFormulas, right.genreFormulas) &&
    equalSlots(left.media, right.media, left.mediaFormulas, right.mediaFormulas);
}

function buildSeriesRegistryMetadataMergePlan_(registry, sourceTargetPairs) {
  const plan = {
    pairs: [],
    blockers: [],
    blockedSourceIds: new Set(),
    sourceIds: new Set(),
    snapshotsById: new Map(),
    destinations: new Map(),
    changedSlots: 0
  };
  if (!registry) {
    plan.blockers.push('registry unavailable for metadata merge');
    return plan;
  }

  const seenPairs = new Set();
  (Array.isArray(sourceTargetPairs) ? sourceTargetPairs : []).forEach(pair => {
    const sourceSeriesId = String(pair && (pair.sourceSeriesId || pair.sourceId) || '').trim();
    const destinationSeriesId = String(pair && (pair.destinationSeriesId || pair.targetSeriesId || pair.destinationId) || '').trim();
    if (!sourceSeriesId || !destinationSeriesId || sourceSeriesId === destinationSeriesId) return;
    const pairKey = `${sourceSeriesId}\u0000${destinationSeriesId}`;
    if (seenPairs.has(pairKey)) return;
    seenPairs.add(pairKey);
    plan.pairs.push({ sourceSeriesId, destinationSeriesId });
    plan.sourceIds.add(sourceSeriesId);
  });
  if (!plan.pairs.length) return plan;

  const addBlocker = (reason, sourceIds) => {
    if (!plan.blockers.includes(reason)) plan.blockers.push(reason);
    (sourceIds || []).forEach(seriesId => {
      const id = String(seriesId || '').trim();
      if (id) plan.blockedSourceIds.add(id);
    });
  };
  const allIds = new Set();
  const sourceTargets = new Map();
  const destinationIds = new Set();
  plan.pairs.forEach(pair => {
    allIds.add(pair.sourceSeriesId);
    allIds.add(pair.destinationSeriesId);
    destinationIds.add(pair.destinationSeriesId);
    if (!sourceTargets.has(pair.sourceSeriesId)) sourceTargets.set(pair.sourceSeriesId, new Set());
    sourceTargets.get(pair.sourceSeriesId).add(pair.destinationSeriesId);
  });

  allIds.forEach(seriesId => {
    const master = registry.allMasterById.get(seriesId);
    if (!master) {
      addBlocker(`metadata merge master is missing: ${seriesId}`, plan.sourceIds);
      return;
    }
    try {
      const snapshot = readSeriesRegistryMergeMetadataSnapshot_(registry, master);
      if (snapshot.seriesId !== seriesId) {
        addBlocker(`metadata row changed for series ${seriesId}`, plan.sourceIds);
        return;
      }
      plan.snapshotsById.set(seriesId, snapshot);
    } catch (error) {
      addBlocker(`metadata read failed for series ${seriesId}: ${String(error && error.message || error)}`, plan.sourceIds);
    }
  });
  if (plan.blockers.length) {
    plan.sourceIds.forEach(seriesId => plan.blockedSourceIds.add(seriesId));
    return plan;
  }

  sourceTargets.forEach((targets, sourceSeriesId) => {
    if (targets.size > 1) {
      addBlocker(
        `metadata source ${sourceSeriesId} has multiple destinations: ${[...targets].join(', ')}`,
        [sourceSeriesId]
      );
    }
    if (destinationIds.has(sourceSeriesId)) {
      addBlocker(`metadata merge chain is ambiguous at series ${sourceSeriesId}`, [sourceSeriesId]);
    }
  });

  sourceTargets.forEach((targets, sourceSeriesId) => {
    const source = plan.snapshotsById.get(sourceSeriesId);
    if (!source) return;
    const formulaColumns = [
      ...source.genreFormulas.map((formula, index) => formula ? String.fromCharCode(67 + index) : ''),
      ...source.mediaFormulas.map((formula, index) => formula ? (index === 0 ? 'L' : 'M') : '')
    ].filter(Boolean);
    if (formulaColumns.length) {
      addBlocker(
        `metadata source ${sourceSeriesId} contains formulas that cannot be safely transferred (${formulaColumns.join(', ')})`,
        [sourceSeriesId]
      );
    }
  });

  plan.pairs.forEach(pair => {
    const source = plan.snapshotsById.get(pair.sourceSeriesId);
    const target = plan.snapshotsById.get(pair.destinationSeriesId);
    if (!source || !target) return;
    let destination = plan.destinations.get(pair.destinationSeriesId);
    if (!destination) {
      destination = {
        seriesId: pair.destinationSeriesId,
        row: target.row,
        expected: {
          seriesId: target.seriesId,
          row: target.row,
          genres: target.genres.slice(),
          genreFormulas: target.genreFormulas.slice(),
          media: target.media.slice(),
          mediaFormulas: target.mediaFormulas.slice()
        },
        changedSlots: [],
        sourceIds: new Set()
      };
      plan.destinations.set(pair.destinationSeriesId, destination);
    }
    destination.sourceIds.add(pair.sourceSeriesId);

    source.genres.forEach((sourceValue, index) => {
      const sourceText = seriesRegistryMergeText_(sourceValue);
      if (!sourceText) return;
      const destinationValue = destination.expected.genres[index];
      const destinationFormula = destination.expected.genreFormulas[index];
      const destinationText = seriesRegistryMergeText_(destinationValue);
      const column = String.fromCharCode(67 + index);
      if (destinationText) {
        if (sourceText !== destinationText) {
          addBlocker(
            `metadata conflict at series ${pair.destinationSeriesId} column ${column}: source ${pair.sourceSeriesId} has "${sourceText}" while destination has "${destinationText}"`,
            [...destination.sourceIds]
          );
        }
        return;
      }
      if (destinationFormula) {
        addBlocker(
          `metadata conflict at series ${pair.destinationSeriesId} column ${column}: destination formula prevents transfer from ${pair.sourceSeriesId}`,
          [...destination.sourceIds]
        );
        return;
      }
      destination.expected.genres[index] = sourceValue;
      destination.changedSlots.push({ column: 3 + index, value: sourceValue });
      plan.changedSlots += 1;
    });

    source.media.forEach((sourceValue, index) => {
      const sourceText = normalizeSeriesRegistryMedia_(sourceValue);
      if (!sourceText) return;
      const alreadyPresent = destination.expected.media.some(value =>
        normalizeSeriesRegistryMedia_(value) === sourceText
      );
      if (alreadyPresent) return;
      const destinationValue = destination.expected.media[index];
      const destinationFormula = destination.expected.mediaFormulas[index];
      const destinationText = normalizeSeriesRegistryMedia_(destinationValue);
      const column = index === 0 ? 'L' : 'M';
      if (destinationText || destinationFormula) {
        addBlocker(
          `metadata conflict at series ${pair.destinationSeriesId} column ${column}: source ${pair.sourceSeriesId} has "${sourceText}" while destination has "${destinationText || 'a formula'}"`,
          [...destination.sourceIds]
        );
        return;
      }
      destination.expected.media[index] = sourceValue;
      destination.changedSlots.push({ column: 12 + index, value: sourceValue });
      plan.changedSlots += 1;
    });
  });

  if (plan.blockers.length) {
    plan.sourceIds.forEach(seriesId => plan.blockedSourceIds.add(seriesId));
  }
  return plan;
}

function applySeriesRegistryMetadataMergePlan_(registry, plan) {
  if (!plan || !plan.pairs.length) return { ok: true, changed: false, blockers: [] };
  const blockers = (plan.blockers || []).slice();
  if (blockers.length) {
    return { ok: false, changed: false, blockers, sourceIds: plan.sourceIds };
  }
  const addBlocker = reason => {
    if (!blockers.includes(reason)) blockers.push(reason);
  };
  try {
    plan.snapshotsById.forEach((expected, seriesId) => {
      const master = registry.allMasterById.get(seriesId);
      const current = master && readSeriesRegistryMergeMetadataSnapshot_(registry, master);
      if (!current || !seriesRegistryMergeSnapshotEquals_(expected, current)) {
        addBlocker(`metadata changed before merge for series ${seriesId}`);
      }
    });
  } catch (error) {
    addBlocker(`metadata pre-write check failed: ${String(error && error.message || error)}`);
  }
  if (blockers.length) {
    return { ok: false, changed: false, blockers, sourceIds: plan.sourceIds };
  }

  let wrote = false;
  let slotsWritten = 0;
  try {
    plan.destinations.forEach(destination => {
      destination.changedSlots.forEach(slot => {
        registry.masterSheet.getRange(destination.row, slot.column).setValue(slot.value);
        wrote = true;
        slotsWritten += 1;
      });
    });
    if (wrote) SpreadsheetApp.flush();
  } catch (error) {
    addBlocker(`metadata write failed before source deletion: ${String(error && error.message || error)}`);
    return { ok: false, changed: wrote, slotsWritten, blockers, sourceIds: plan.sourceIds };
  }

  try {
    plan.destinations.forEach(destination => {
      const master = registry.allMasterById.get(destination.seriesId);
      const actual = master && readSeriesRegistryMergeMetadataSnapshot_(registry, master);
      if (!actual || !seriesRegistryMergeSnapshotEquals_(destination.expected, actual)) {
        addBlocker(`metadata readback mismatch before source deletion for series ${destination.seriesId}`);
      }
    });
    plan.sourceIds.forEach(seriesId => {
      const expected = plan.snapshotsById.get(seriesId);
      const master = registry.allMasterById.get(seriesId);
      const actual = master && readSeriesRegistryMergeMetadataSnapshot_(registry, master);
      if (!actual || !seriesRegistryMergeSnapshotEquals_(expected, actual)) {
        addBlocker(`metadata source changed before deletion for series ${seriesId}`);
      }
    });
  } catch (error) {
    addBlocker(`metadata readback failed before source deletion: ${String(error && error.message || error)}`);
  }
  return {
    ok: blockers.length === 0,
    changed: wrote,
    slotsWritten,
    blockers,
    sourceIds: plan.sourceIds
  };
}

function reconcileSafeOrphanExtraAliasConflicts_(registry, extraAliasPlan) {
  if (!extraAliasPlan || !extraAliasPlan.conflicts.length) return { changed: false };
  const review = readSeriesRegistryReviewReferenceIds_(registry);
  const external = readSeriesRegistryExternalReferenceIds_(registry);
  const lifecyclePlan = buildSeriesRegistryLifecyclePlan_(registry, {
    reviewReferencedIds: review.references,
    reviewScanComplete: review.complete,
    externalReferencedIds: external.references,
    externalScanComplete: external.complete
  });
  if (lifecyclePlan.blockers.length) {
    const unresolved = registry.catalogUsage && registry.catalogUsage.unresolved || [];
    const catalogRepairable = Boolean(
      unresolved.length &&
      unresolved.every(item => item.reason === 'TITLE_WITHOUT_SERIES_KEY') &&
      lifecyclePlan.blockers.every(blocker =>
        String(blocker).indexOf('unresolved catalog series keys') === 0
      )
    );
    return {
      changed: false,
      blockers: lifecyclePlan.blockers,
      catalogRepairable
    };
  }

  const sourceTargetById = new Map();
  for (const conflict of extraAliasPlan.conflicts) {
    const targetAlias = registry.aliasByKey.get(conflict.aliasKey);
    const targetMaster = targetAlias && registry.masterById.get(targetAlias.seriesId);
    const targetReferences = targetAlias
      ? registry.catalogUsage.refsBySeriesId.get(targetAlias.seriesId) || 0
      : 0;
    if (!targetAlias || !targetMaster || !targetMaster.isExtra || targetReferences <= 0) {
      return { changed: false, blockers: [`extra destination is not a unique live owner: ${conflict.aliasKey}`] };
    }
    const baseSignature = buildSeriesRegistryBaseSignature_(conflict.aliasKey);
    const candidateSources = (conflict.seriesIds || []).filter(seriesId => {
      if (seriesId === targetAlias.seriesId) return false;
      const master = registry.masterById.get(seriesId);
      if (!master || !master.isExtra) return false;
      if ((registry.catalogUsage.refsBySeriesId.get(seriesId) || 0) !== 0) return false;
      if (review.references.has(seriesId) || external.references.has(seriesId)) return false;
      const hasBaseAlias = (registry.aliasRowsBySeriesId.get(seriesId) || []).some(alias =>
        !hasExtraSeriesPrefix_(alias.aliasKey) &&
        buildSeriesRegistryBaseSignature_(alias.aliasKey) === baseSignature
      );
      const willBeRehomed = lifecyclePlan.rehomeAliases.some(alias =>
        alias.sourceSeriesId === seriesId && alias.destinationSeriesId === targetAlias.seriesId
      );
      return hasBaseAlias && willBeRehomed && lifecyclePlan.deleteSeriesIds.includes(seriesId);
    });
    if (candidateSources.length !== 1) {
      return { changed: false, blockers: [`extra conflict is not a unique orphan transition: ${conflict.aliasKey}`] };
    }
    const sourceId = candidateSources[0];
    const previousTarget = sourceTargetById.get(sourceId);
    if (previousTarget && previousTarget !== targetAlias.seriesId) {
      return { changed: false, blockers: [`orphan has multiple extra destinations: ${sourceId}`] };
    }
    sourceTargetById.set(sourceId, targetAlias.seriesId);
  }

  const sourceIds = new Set(sourceTargetById.keys());
  const rehomes = lifecyclePlan.rehomeAliases.filter(alias => sourceIds.has(alias.sourceSeriesId));
  const aliasRows = lifecyclePlan.deleteAliasRows.filter(row =>
    lifecyclePlan.candidateIds.some(seriesId => sourceIds.has(seriesId) &&
      (registry.allAliasRowsBySeriesId.get(seriesId) || []).some(alias => alias.row === row)
    )
  );
  const masterRows = [...sourceIds].map(seriesId => registry.allMasterById.get(seriesId).row);
  const metadataPlan = buildSeriesRegistryMetadataMergePlan_(
    registry,
    [...sourceTargetById].map(([sourceSeriesId, destinationSeriesId]) => ({
      sourceSeriesId,
      destinationSeriesId
    }))
  );
  if (metadataPlan.blockers.length) {
    persistSeriesRegistryMetadataMergeHolds_(
      registry,
      metadataPlan.pairs,
      metadataPlan.blockers
    );
    return { changed: false, blockers: metadataPlan.blockers };
  }
  const metadataMerge = applySeriesRegistryMetadataMergePlan_(registry, metadataPlan);
  if (!metadataMerge.ok) {
    persistSeriesRegistryMetadataMergeHolds_(
      registry,
      metadataPlan.pairs,
      metadataMerge.blockers
    );
    return { changed: false, blockers: metadataMerge.blockers };
  }
  const timestamp = new Date();
  rehomes.forEach(item => {
    registry.aliasSheet.getRange(item.row, 2).setValue(item.destinationSeriesId);
    registry.aliasSheet.getRange(item.row, 3).setValue('LIFECYCLE_REHOME');
    registry.aliasSheet.getRange(item.row, 6).setValue(timestamp);
  });
  const deletedAliases = deleteSeriesRegistryRows_(registry.aliasSheet, aliasRows);
  const deletedMasters = deleteSeriesRegistryRows_(registry.masterSheet, masterRows);
  return {
    changed: true,
    deletedMasters,
    deletedAliases,
    rehomedAliases: rehomes.length,
    metadataSlotsMerged: metadataPlan.changedSlots
  };
}

function ensureSeriesRegistryExtraAliases_() {
  if (!isSeriesRegistryV2Active_()) return { added: 0, conflicts: 0 };
  let registry = loadSeriesRegistryLookup_();
  if (!registry) return { added: 0, conflicts: 0 };
  let blockers = getSeriesRegistryIntegrityBlockers_(registry);
  if (blockers.length) throw new Error(`Series registry integrity check failed: ${blockers[0]}`);
  let plan = buildSeriesRegistryExtraAliasPlan_(registry);
  if (plan.conflicts.length) {
    const reconciled = reconcileSafeOrphanExtraAliasConflicts_(registry, plan);
    if (!reconciled.changed) {
      const detail = (reconciled.blockers || [])[0];
      if (reconciled.catalogRepairable) {
        return {
          added: 0,
          conflicts: plan.conflicts.length,
          reconciliationDeferred: reconciled.blockers.slice()
        };
      }
      throw new Error(
        `Series extra alias conflict: ${plan.conflicts[0].aliasKey}` +
        (detail ? `; ${detail}` : '')
      );
    }
    registry = loadSeriesRegistryLookup_();
    blockers = getSeriesRegistryIntegrityBlockers_(registry);
    if (blockers.length) throw new Error(`Series registry integrity check failed: ${blockers[0]}`);
    plan = buildSeriesRegistryExtraAliasPlan_(registry);
    if (plan.conflicts.length) {
      throw new Error(`Series extra alias conflict: ${plan.conflicts[0].aliasKey}`);
    }
    plan.reconciledOrphans = reconciled;
  }
  if (plan.additions.length) {
    const timestamp = new Date();
    appendSeriesRegistryRows_(
      registry.aliasSheet,
      plan.additions.map(item => [
        item.aliasKey,
        item.seriesId,
        item.source,
        buildSeriesAliasSignature_(item.aliasKey),
        0,
        timestamp
      ]),
      6,
      true
    );
  }
  return {
    added: plan.additions.length,
    conflicts: 0,
    reconciledOrphans: plan.reconciledOrphans || { changed: false }
  };
}

function readSeriesRegistryReviewReferenceIds_(registry) {
  const references = new Set();
  const spreadsheet = SpreadsheetApp.getActive();
  const reviewSheet = spreadsheet.getSheetByName(SERIES_REGISTRY_CONFIG_.REVIEW_SHEET);
  if (!reviewSheet) return { complete: false, references, rows: 0 };
  const lastRow = Math.max(1, Number(reviewSheet.getLastRow()) || 1);
  if (lastRow < 2) return { complete: true, references, rows: 0 };
  const rows = reviewSheet.getRange(2, 2, lastRow - 1, 3).getDisplayValues();
  rows.forEach(row => {
    parseSeriesRegistryReviewIds_(row[0]).forEach(id => references.add(id));
    parseSeriesRegistryReviewIds_(row[2]).forEach(id => references.add(id));
  });
  return { complete: true, references, rows: rows.length };
}

function readSeriesRegistryExternalReferenceIds_(registry) {
  const references = new Set();
  const spreadsheet = SpreadsheetApp.getActive();
  if (!spreadsheet || typeof spreadsheet.getSheets !== 'function') {
    return { complete: false, references, sheetsScanned: 0 };
  }
  const knownIds = new Set(registry && registry.allMasterById
    ? [...registry.allMasterById.keys()]
    : []);
  const skipped = new Set([
    CONFIG.SHEETS.MAIN,
    SERIES_REGISTRY_CONFIG_.MASTER_SHEET,
    SERIES_REGISTRY_CONFIG_.ALIAS_SHEET,
    SERIES_REGISTRY_CONFIG_.REVIEW_SHEET
  ]);
  let sheetsScanned = 0;
  try {
    spreadsheet.getSheets().forEach(sheet => {
      if (!sheet || skipped.has(sheet.getName())) return;
      const range = sheet.getDataRange();
      if (!range) return;
      const values = range.getDisplayValues();
      const formulas = typeof range.getFormulas === 'function' ? range.getFormulas() : [];
      const scan = cell => {
        const text = String(cell || '');
        const matches = text.match(/series_[A-Za-z0-9_-]+/g) || [];
        matches.forEach(id => {
          if (knownIds.has(id)) references.add(id);
        });
      };
      values.forEach(row => row.forEach(scan));
      formulas.forEach(row => row.forEach(scan));
      sheetsScanned += 1;
    });
  } catch (error) {
    return { complete: false, references, sheetsScanned, error: String(error) };
  }
  return { complete: true, references, sheetsScanned };
}

function buildSeriesRegistryBaseSignature_(key) {
  return normalizeKana(stripExtraSeriesPrefix_(key));
}

function describeSeriesRegistryUnresolvedCatalogKeys_(unresolved) {
  const rows = Array.isArray(unresolved) ? unresolved : [];
  const examples = rows.slice(0, 3).map(item => {
    const row = Number(item && item.row) || '?';
    if (item && item.reason === 'TITLE_WITHOUT_SERIES_KEY') {
      return `row ${row}: titled book has blank series_key_auto`;
    }
    const key = String(item && item.key || '').slice(0, 48);
    return `row ${row}: ${key ? `key "${key}" does not resolve` : 'series_key_auto does not resolve'}`;
  });
  const remaining = rows.length - examples.length;
  return `unresolved catalog series keys (${rows.length}): ${examples.join('; ')}` +
    (remaining > 0 ? `; and ${remaining} more` : '');
}

function buildSeriesRegistryLifecyclePlan_(registry, referenceScans) {
  const scans = referenceScans || {};
  const usage = registry && registry.catalogUsage || { refsBySeriesId: new Map(), unresolved: [] };
  const reviewReferences = scans.reviewReferencedIds instanceof Set
    ? scans.reviewReferencedIds
    : new Set();
  const externalReferences = scans.externalReferencedIds instanceof Set
    ? scans.externalReferencedIds
    : new Set();
  const blockers = [];
  const protectedByReview = [];
  const protectedByExternal = [];
  const protectedByAmbiguousSignature = [];
  const protectedByPendingManualMerge = [];
  const pendingManualMerges = [];
  const deactivateSeriesIds = [];
  const deleteSeriesIds = [];
  const deleteAliasRows = [];
  const rehomeAliases = [];
  const candidateIds = [];

  if (!registry) blockers.push('registry unavailable');
  if (!scans.reviewScanComplete) blockers.push('review reference scan incomplete');
  if (!scans.externalScanComplete) blockers.push('external reference scan incomplete');
  if (!usage.complete) blockers.push('catalog reference scan incomplete');
  if (registry && registry.duplicateMasterIds && registry.duplicateMasterIds.size) {
    blockers.push('duplicate master ids');
  }
  if (registry && registry.malformedMasterRows && registry.malformedMasterRows.length) {
    blockers.push('master rows missing series_id');
  }
  if (registry && registry.danglingAliasRows && registry.danglingAliasRows.length) {
    blockers.push('dangling aliases');
  }
  if (registry && registry.ambiguousAliasKeys && registry.ambiguousAliasKeys.size) {
    blockers.push('alias keys with multiple active owners');
  }
  if (registry && registry.allAliasOwnersByKey) {
    for (const owners of registry.allAliasOwnersByKey.values()) {
      if (owners.size > 1) {
        blockers.push('alias keys with multiple master owners');
        break;
      }
    }
  }
  if (usage.unresolved && usage.unresolved.length) {
    blockers.push(describeSeriesRegistryUnresolvedCatalogKeys_(usage.unresolved));
  }

  if (registry) {
    registry.masterById.forEach((master, seriesId) => {
      if ((usage.refsBySeriesId.get(seriesId) || 0) === 0) candidateIds.push(seriesId);
    });
    registry.allMasterById.forEach((master, seriesId) => {
      if (registry.masterById.has(seriesId)) return;
      if ((usage.refsBySeriesId.get(seriesId) || 0) === 0) candidateIds.push(seriesId);
    });
  }

  if (blockers.length) {
    return {
      blockers,
      candidateIds,
      deleteSeriesIds,
      deleteAliasRows,
      rehomeAliases,
      protectedByReview,
      protectedByExternal,
      protectedByAmbiguousSignature,
      protectedByPendingManualMerge,
      pendingManualMerges,
      deactivateSeriesIds
    };
  }

  const supportedStatuses = new Set(['', 'ACTIVE', 'MERGED', 'INACTIVE']);
  const liveExtraIdsByBaseSignature = new Map();
  registry.masterById.forEach((master, seriesId) => {
    if (!master.isExtra || !(usage.refsBySeriesId.get(seriesId) > 0)) return;
    (registry.aliasRowsBySeriesId.get(seriesId) || []).forEach(alias => {
      const signature = buildSeriesRegistryBaseSignature_(alias.aliasKey);
      if (!signature) return;
      if (!liveExtraIdsByBaseSignature.has(signature)) {
        liveExtraIdsByBaseSignature.set(signature, new Set());
      }
      liveExtraIdsByBaseSignature.get(signature).add(seriesId);
    });
  });

  const deleteIdSet = new Set();
  candidateIds.forEach(seriesId => {
    const master = registry.allMasterById.get(seriesId);
    if (!master || !supportedStatuses.has(master.status)) return;
    if (reviewReferences.has(seriesId)) {
      protectedByReview.push(seriesId);
      if (master.status !== 'MERGED' && master.status !== 'INACTIVE') {
        deactivateSeriesIds.push(seriesId);
      }
      return;
    }
    if (externalReferences.has(seriesId)) {
      protectedByExternal.push(seriesId);
      return;
    }

    const aliases = registry.allAliasRowsBySeriesId.get(seriesId) || [];
    const hasAmbiguousSignature = aliases.some(alias => {
      const owners = registry.allSignatureOwners && registry.allSignatureOwners.get(alias.signature);
      return owners && [...owners].some(ownerId => ownerId !== seriesId);
    });
    if (hasAmbiguousSignature) {
      protectedByAmbiguousSignature.push(seriesId);
      return;
    }

    const candidateRehomes = [];
    const candidateDeleteAliasRows = [];
    aliases.forEach(alias => {
      if (!hasExtraSeriesPrefix_(alias.aliasKey)) {
        const baseSignature = buildSeriesRegistryBaseSignature_(alias.aliasKey);
        const destinations = liveExtraIdsByBaseSignature.get(baseSignature) || new Set();
        if (destinations.size === 1) {
          const destinationSeriesId = [...destinations][0];
          if (destinationSeriesId !== seriesId) {
            candidateRehomes.push({
              row: alias.row,
              aliasKey: alias.aliasKey,
              sourceSeriesId: seriesId,
              destinationSeriesId
            });
            return;
          }
        }
      }
      candidateDeleteAliasRows.push(alias.row);
    });
    const pendingPairs = (usage.pendingManualMergePairs || []).filter(pair =>
      pair.sourceSeriesId === seriesId
    );
    const pendingMergesCovered = pendingPairs.every(pair => candidateRehomes.some(item =>
      item.destinationSeriesId === pair.destinationSeriesId
    ));
    if (pendingPairs.length && !pendingMergesCovered) {
      protectedByPendingManualMerge.push(seriesId);
      pendingPairs.forEach(pair => {
        if (!pendingManualMerges.some(existing =>
          existing.sourceSeriesId === pair.sourceSeriesId &&
          existing.destinationSeriesId === pair.destinationSeriesId
        )) pendingManualMerges.push(pair);
      });
      return;
    }
    deleteIdSet.add(seriesId);
    rehomeAliases.push(...candidateRehomes);
    deleteAliasRows.push(...candidateDeleteAliasRows);
  });

  deleteSeriesIds.push(...deleteIdSet);
  return {
    blockers,
    candidateIds,
    deleteSeriesIds,
    deleteAliasRows: Array.from(new Set(deleteAliasRows)),
    rehomeAliases,
    protectedByReview,
    protectedByExternal,
    protectedByAmbiguousSignature,
    protectedByPendingManualMerge,
    pendingManualMerges,
    deactivateSeriesIds
  };
}

function deleteSeriesRegistryRows_(sheet, rowNumbers) {
  const rows = Array.from(new Set((rowNumbers || []).map(Number).filter(row => row >= 2)))
    .sort((left, right) => left - right);
  if (!rows.length) return 0;
  const groups = [];
  let start = rows[0];
  let end = start;
  for (let index = 1; index < rows.length; index++) {
    const row = rows[index];
    if (row === end + 1) {
      end = row;
      continue;
    }
    groups.push({ start, count: end - start + 1 });
    start = row;
    end = row;
  }
  groups.push({ start, count: end - start + 1 });
  groups.reverse().forEach(group => sheet.deleteRows(group.start, group.count));
  return rows.length;
}

function preserveSeriesRegistryLifecycleSources_(registry, plan, sourceIds) {
  const ids = new Set(Array.from(sourceIds || []).map(id => String(id || '').trim()).filter(Boolean));
  if (!ids.size) return;
  const aliasRows = new Set();
  ids.forEach(seriesId => {
    (registry.allAliasRowsBySeriesId.get(seriesId) || []).forEach(alias => aliasRows.add(alias.row));
  });
  plan.deleteSeriesIds = (plan.deleteSeriesIds || []).filter(seriesId => !ids.has(seriesId));
  plan.rehomeAliases = (plan.rehomeAliases || []).filter(item => !ids.has(item.sourceSeriesId));
  plan.deleteAliasRows = (plan.deleteAliasRows || []).filter(row => !aliasRows.has(row));
}

function summarizeSeriesRegistryLifecyclePlan_(plan) {
  const value = plan || {};
  return {
    candidates: (value.candidateIds || []).length,
    deletedMasters: (value.deleteSeriesIds || []).length,
    deactivatedMasters: (value.deactivateSeriesIds || []).length,
    deletedAliases: (value.deleteAliasRows || []).length,
    rehomedAliases: (value.rehomeAliases || []).length,
    protectedByReview: (value.protectedByReview || []).length,
    protectedByExternal: (value.protectedByExternal || []).length,
    protectedByAmbiguousSignature: (value.protectedByAmbiguousSignature || []).length,
    protectedByPendingManualMerge: (value.protectedByPendingManualMerge || []).length,
    pendingManualMerges: (value.pendingManualMerges || []).slice(0, 10).map(pair => ({
      sourceSeriesId: pair.sourceSeriesId,
      destinationSeriesId: pair.destinationSeriesId,
      rows: (pair.rows || []).slice(0, 5),
      titles: (pair.titles || []).slice(0, 3)
    })),
    blockers: (value.blockers || []).slice(0, 10),
    metadataBlockers: (value.metadataBlockers || []).slice(0, 10),
    metadataSlotsMerged: Number(value.metadataSlotsMerged || 0),
    metadataSlotsWritten: Number(value.metadataSlotsWritten || 0)
  };
}

function withSeriesRegistryScriptLock_(callback, waitMs) {
  const lock = LockService.getScriptLock();
  const alreadyLocked = typeof lock.hasLock === 'function' && lock.hasLock();
  if (!alreadyLocked && !lock.tryLock(Number(waitMs) || 10000)) {
    throw new Error('Series registry is being updated by another operation.');
  }
  try {
    return callback();
  } finally {
    if (!alreadyLocked) lock.releaseLock();
  }
}

function cleanupSeriesRegistryLifecycleCore_() {
  if (!isSeriesRegistryV2Active_()) return { active: false, deletedMasters: 0 };
  let registry = loadSeriesRegistryLookup_();
  if (!registry) return { active: true, deletedMasters: 0, blockers: ['registry unavailable'] };
  const review = readSeriesRegistryReviewReferenceIds_(registry);
  const external = readSeriesRegistryExternalReferenceIds_(registry);
  const plan = buildSeriesRegistryLifecyclePlan_(registry, {
    reviewReferencedIds: review.references,
    reviewScanComplete: review.complete,
    externalReferencedIds: external.references,
    externalScanComplete: external.complete
  });
  if (plan.blockers.length) {
    return Object.assign({ active: true, changed: false }, summarizeSeriesRegistryLifecyclePlan_(plan));
  }

  const metadataBlockers = [];
  const extraAliasPlan = buildSeriesRegistryExtraAliasPlan_(registry);
  if (extraAliasPlan.conflicts.length) {
    plan.blockers.push(`extra alias conflict: ${extraAliasPlan.conflicts[0].aliasKey}`);
    plan.deleteSeriesIds = [];
    plan.deleteAliasRows = [];
    plan.rehomeAliases = [];
    plan.deactivateSeriesIds = [];
    return Object.assign({ active: true, changed: false }, summarizeSeriesRegistryLifecyclePlan_(plan));
  }

  let metadataMerge = { ok: true, changed: false, slotsWritten: 0, blockers: [] };
  const metadataPlan = buildSeriesRegistryMetadataMergePlan_(
    registry,
    plan.rehomeAliases.map(item => ({
      sourceSeriesId: item.sourceSeriesId,
      destinationSeriesId: item.destinationSeriesId
    }))
  );
  if (metadataPlan.blockers.length) {
    persistSeriesRegistryMetadataMergeHolds_(
      registry,
      metadataPlan.pairs,
      metadataPlan.blockers
    );
    metadataMerge = {
      ok: false,
      changed: false,
      slotsWritten: 0,
      blockers: metadataPlan.blockers
    };
    metadataBlockers.push(...metadataPlan.blockers);
    preserveSeriesRegistryLifecycleSources_(registry, plan, metadataPlan.sourceIds);
  } else if (metadataPlan.pairs.length) {
    metadataMerge = applySeriesRegistryMetadataMergePlan_(registry, metadataPlan);
    if (!metadataMerge.ok) {
      persistSeriesRegistryMetadataMergeHolds_(
        registry,
        metadataPlan.pairs,
        metadataMerge.blockers
      );
      metadataBlockers.push(...metadataMerge.blockers);
      preserveSeriesRegistryLifecycleSources_(registry, plan, metadataPlan.sourceIds);
    }
  }
  plan.metadataBlockers = metadataBlockers;
  plan.metadataSlotsMerged = metadataMerge.ok ? metadataPlan.changedSlots : 0;
  plan.metadataSlotsWritten = metadataMerge.slotsWritten || 0;
  const summary = summarizeSeriesRegistryLifecyclePlan_(plan);
  const hasLifecycleActions = Boolean(
    plan.deleteSeriesIds.length ||
    plan.rehomeAliases.length ||
    plan.deactivateSeriesIds.length
  );
  if (!hasLifecycleActions) {
    return Object.assign({ active: true, changed: metadataMerge.changed }, summary);
  }

  const aliasSheet = registry.aliasSheet;
  const masterSheet = registry.masterSheet;
  const timestamp = new Date();
  plan.deactivateSeriesIds.forEach(seriesId => {
    const master = registry.allMasterById.get(seriesId);
    if (!master || master.status === 'MERGED' || master.status === 'INACTIVE') return;
    registry.masterSheet.getRange(master.row, 9).setValue('INACTIVE');
    registry.masterSheet.getRange(master.row, 10).setValue(timestamp);
  });
  plan.rehomeAliases.forEach(item => {
    aliasSheet.getRange(item.row, 2).setValue(item.destinationSeriesId);
    aliasSheet.getRange(item.row, 3).setValue('LIFECYCLE_REHOME');
    aliasSheet.getRange(item.row, 6).setValue(timestamp);
  });
  const deletedAliases = deleteSeriesRegistryRows_(aliasSheet, plan.deleteAliasRows);
  const masterRows = plan.deleteSeriesIds
    .map(seriesId => registry.allMasterById.get(seriesId).row);
  const deletedMasters = deleteSeriesRegistryRows_(masterSheet, masterRows);
  return Object.assign({ active: true, changed: true }, summary, {
    deletedAliases,
    deletedMasters,
    metadataSlotsMerged: metadataMerge.ok ? metadataPlan.changedSlots : 0,
    metadataSlotsWritten: metadataMerge.slotsWritten || 0
  });
}

function cleanupSeriesRegistryLifecycle_() {
  return withSeriesRegistryScriptLock_(cleanupSeriesRegistryLifecycleCore_, 10000);
}

function auditSeriesRegistryLifecycle_() {
  if (!isSeriesRegistryV2Active_()) return { active: false };
  const registry = loadSeriesRegistryLookup_();
  const review = readSeriesRegistryReviewReferenceIds_(registry);
  const external = readSeriesRegistryExternalReferenceIds_(registry);
  const plan = buildSeriesRegistryLifecyclePlan_(registry, {
    reviewReferencedIds: review.references,
    reviewScanComplete: review.complete,
    externalReferencedIds: external.references,
    externalScanComplete: external.complete
  });
  return Object.assign({ active: true }, summarizeSeriesRegistryLifecyclePlan_(plan));
}

function appendSeriesAliasRow_(aliasSheet, aliasKey, seriesId, source, count, timestamp) {
  const key = normalizeSeriesAliasKey_(aliasKey);
  if (!key || !seriesId) return false;
  const registry = loadSeriesRegistryLookup_();
  if (!assertSeriesRegistryAliasAdditionAllowed_(key, seriesId, registry)) return false;
  appendSeriesRegistryRows_(aliasSheet, [[
    key,
    seriesId,
    source || 'AUTO',
    buildSeriesAliasSignature_(key),
    Number(count || 0),
    timestamp || new Date()
  ]], 6, true);
  return true;
}

function assertSeriesRegistryAliasAdditionAllowed_(rawKey, seriesId, registry) {
  const key = normalizeSeriesAliasKey_(rawKey);
  const lookup = registry || loadSeriesRegistryLookup_();
  if (!key || !lookup) throw new Error('Series registry is unavailable for alias preflight.');
  const targetId = String(seriesId || '');
  const exactOwners = lookup.allAliasOwnersByKey.get(key);
  if (exactOwners && exactOwners.size) {
    if (targetId && exactOwners.size === 1 && exactOwners.has(targetId)) return false;
    throw new Error(`Series alias is owned by an inactive or different master: ${key}`);
  }
  const signature = buildSeriesAliasSignature_(key);
  const signatureOwners = lookup.allSignatureOwners.get(signature);
  if (signatureOwners && [...signatureOwners].some(ownerId => ownerId !== targetId)) {
    throw new Error(`Series alias signature belongs to another master: ${key}`);
  }
  return true;
}

function appendSeriesReviewRow_(candidateKey, candidateSeriesId, comparisonKey, comparisonSeriesId, reason) {
  const reviewSheet = SpreadsheetApp.getActive().getSheetByName(
    SERIES_REGISTRY_CONFIG_.REVIEW_SHEET
  );
  if (!reviewSheet) return false;
  appendSeriesRegistryRows_(reviewSheet, [[
    normalizeSeriesAliasKey_(candidateKey),
    String(candidateSeriesId || ''),
    normalizeSeriesAliasKey_(comparisonKey),
    String(comparisonSeriesId || ''),
    reason || 'TITLE_EDIT_CONFLICT',
    '要確認',
    new Date()
  ]], 7, true);
  return true;
}

function persistSeriesRegistryMetadataMergeHolds_(registry, sourceTargetPairs, blockers) {
  const pairs = [];
  const seen = new Set();
  (Array.isArray(sourceTargetPairs) ? sourceTargetPairs : []).forEach(pair => {
    const sourceSeriesId = String(pair && (pair.sourceSeriesId || pair.sourceId) || '').trim();
    const destinationSeriesId = String(
      pair && (pair.destinationSeriesId || pair.targetSeriesId || pair.destinationId) || ''
    ).trim();
    if (!sourceSeriesId || !destinationSeriesId || sourceSeriesId === destinationSeriesId) return;
    const key = `${sourceSeriesId}\u0000${destinationSeriesId}`;
    if (seen.has(key)) return;
    seen.add(key);
    pairs.push({ sourceSeriesId, destinationSeriesId, key });
  });
  if (!pairs.length) {
    throw new Error('Unable to persist metadata merge safety hold: no source/destination pairs were available.');
  }

  const spreadsheet = SpreadsheetApp.getActive();
  const reviewSheet = spreadsheet && spreadsheet.getSheetByName(SERIES_REGISTRY_CONFIG_.REVIEW_SHEET);
  if (!reviewSheet) {
    throw new Error('Unable to persist metadata merge safety hold: review sheet is missing.');
  }
  const readHoldPairs = () => {
    const lastRow = Math.max(1, Number(reviewSheet.getLastRow()) || 1);
    if (lastRow < 2) return new Set();
    const rows = reviewSheet.getRange(2, 2, lastRow - 1, 4).getDisplayValues();
    const result = new Set();
    rows.forEach(row => {
      const sourceSeriesId = String(row[0] || '').trim();
      const destinationSeriesId = String(row[2] || '').trim();
      const reason = String(row[3] || '').trim();
      if (
        sourceSeriesId && destinationSeriesId &&
        reason.startsWith(SERIES_REGISTRY_CONFIG_.METADATA_MERGE_HOLD_REASON_PREFIX)
      ) result.add(`${sourceSeriesId}\u0000${destinationSeriesId}`);
    });
    return result;
  };

  try {
    const existing = readHoldPairs();
    const rowsToAppend = pairs.filter(pair => !existing.has(pair.key)).map(pair => {
      const source = registry && registry.allMasterById.get(pair.sourceSeriesId);
      const destination = registry && registry.allMasterById.get(pair.destinationSeriesId);
      const detail = (Array.isArray(blockers) ? blockers : [])
        .slice(0, 3)
        .map(reason => String(reason || '').trim())
        .filter(Boolean)
        .join('; ')
        .slice(0, 900);
      const reason = `${SERIES_REGISTRY_CONFIG_.METADATA_MERGE_HOLD_REASON_PREFIX} ${detail || 'metadata transfer requires review'}`;
      return [
        source && source.canonicalKey || '',
        pair.sourceSeriesId,
        destination && destination.canonicalKey || '',
        pair.destinationSeriesId,
        reason,
        '要確認',
        new Date()
      ];
    });
    if (rowsToAppend.length) {
      appendSeriesRegistryRows_(
        reviewSheet,
        rowsToAppend,
        SERIES_REGISTRY_CONFIG_.REVIEW_HEADERS.length,
        true
      );
      SpreadsheetApp.flush();
    }
    const verified = readHoldPairs();
    const missing = pairs.filter(pair => !verified.has(pair.key));
    if (missing.length) {
      throw new Error(`review hold readback did not confirm ${missing.length} source/destination pair(s)`);
    }
    return { added: rowsToAppend.length, verified: pairs.length };
  } catch (error) {
    throw new Error(
      `Unable to persist metadata merge safety hold; no alias or master deletion was performed: ${String(error && error.message || error)}`
    );
  }
}

function appendSeriesMasterRow_(
  masterSheet,
  canonicalKey,
  genreSlots,
  count,
  timestamp,
  displayName,
  mediaSlots
) {
  const seriesId = `series_${Utilities.getUuid()}`;
  const masterColumnCount = getSeriesRegistryMasterColumnCount_(masterSheet);
  appendSeriesRegistryRows_(masterSheet, [buildSeriesRegistryMasterRow_(
    seriesId,
    buildSeriesRegistryDisplayName_(displayName, canonicalKey),
    genreSlots,
    Number(count || 0),
    'ACTIVE',
    timestamp || new Date(),
    canonicalKey,
    mediaSlots,
    masterColumnCount
  )], masterColumnCount, true);
  return seriesId;
}

function ensureSeriesRegistryAlias_(rawKey, options) {
  const key = normalizeSeriesAliasKey_(rawKey);
  if (!key || !isSeriesRegistryV2Active_()) return null;
  const registry = loadSeriesRegistryLookup_();
  const blockers = getSeriesRegistryIntegrityBlockers_(registry);
  if (blockers.length) throw new Error(`Series registry integrity check failed: ${blockers[0]}`);
  const resolved = resolveSeriesRegistryKey_(key, registry);
  if (resolved) {
    if (resolved.matchedBy === 'UNIQUE_SIGNATURE' && !registry.aliasByKey.has(key)) {
      appendSeriesAliasRow_(
        registry.aliasSheet,
        key,
        resolved.seriesId,
        options && options.source || 'AUTO_SIGNATURE',
        options && options.count || 1,
        new Date()
      );
    }
    return resolved;
  }

  if (registry.allAliasOwnersByKey.has(key)) {
    throw new Error(`Series alias is owned by an inactive or ambiguous master: ${key}`);
  }
  const signature = buildSeriesAliasSignature_(key);
  const signatureOwners = registry.signatureOwners.get(signature);
  if (signatureOwners && signatureOwners.size > 1) {
    throw new Error(`Series signature has multiple active owners: ${key}`);
  }
  assertSeriesRegistryAliasAdditionAllowed_(key, '', registry);

  const seriesId = appendSeriesMasterRow_(
    registry.masterSheet,
    key,
    [],
    options && options.count || 1,
    new Date(),
    options && options.displayName || '',
    options && options.media || []
  );
  appendSeriesAliasRow_(
    registry.aliasSheet,
    key,
    seriesId,
    options && options.source || 'AUTO_NEW_KEY',
    options && options.count || 1,
    new Date()
  );
  return {
    seriesId,
    canonicalKey: key,
    displayName: buildSeriesRegistryDisplayName_(
      options && options.displayName || '',
      key
    ),
    genres: ['', '', '', '', ''],
    media: Array.isArray(options && options.media)
      ? options.media.slice(0, 2)
      : ['', ''],
    isExtra: isSeriesRegistryExtraClassification_(
      [],
      options && options.media || [],
      key
    ),
    matchedBy: 'NEW_SERIES'
  };
}

function buildSeriesTitleEditLinkPlan_(oldKey, newKey, oldResolved, newResolved) {
  const oldNormalized = normalizeSeriesAliasKey_(oldKey);
  const newNormalized = normalizeSeriesAliasKey_(newKey);
  if (!newNormalized) return { action: 'NONE', oldKey: oldNormalized, newKey: '' };
  if (oldNormalized === newNormalized) {
    return { action: 'UNCHANGED', oldKey: oldNormalized, newKey: newNormalized };
  }
  if (
    oldResolved && newResolved &&
    String(oldResolved.seriesId || '') !== String(newResolved.seriesId || '')
  ) {
    return {
      action: 'CONFLICT',
      oldKey: oldNormalized,
      newKey: newNormalized,
      oldSeriesId: String(oldResolved.seriesId || ''),
      newSeriesId: String(newResolved.seriesId || '')
    };
  }
  if (newResolved) {
    return {
      action: 'USE_EXISTING',
      oldKey: oldNormalized,
      newKey: newNormalized,
      seriesId: String(newResolved.seriesId || '')
    };
  }
  if (oldResolved) {
    return {
      action: 'LINK_TO_OLD',
      oldKey: oldNormalized,
      newKey: newNormalized,
      seriesId: String(oldResolved.seriesId || '')
    };
  }
  return { action: 'CREATE', oldKey: oldNormalized, newKey: newNormalized };
}

function maybeFollowSeriesRegistryCanonicalAfterTitleEdit_(oldKey, newKey, displayName, seriesId) {
  const oldNormalized = normalizeSeriesAliasKey_(oldKey);
  const newNormalized = normalizeSeriesAliasKey_(newKey);
  if (!oldNormalized || !newNormalized || oldNormalized === newNormalized || !seriesId) return false;
  const registry = loadSeriesRegistryLookup_();
  if (!registry || !registry.catalogUsage) return false;
  const master = registry.masterById.get(seriesId);
  const newAlias = registry.aliasByKey.get(newNormalized);
  if (!master || !newAlias || newAlias.seriesId !== seriesId) return false;

  const oldKeyReferences = registry.catalogUsage.keyCounts.get(oldNormalized) || 0;
  const newKeyReferences = registry.catalogUsage.keyCounts.get(newNormalized) || 0;
  const seriesReferences = registry.catalogUsage.refsBySeriesId.get(seriesId) || 0;
  if (oldKeyReferences !== 0 || newKeyReferences <= 0 || seriesReferences !== newKeyReferences) {
    return false;
  }
  const canonicalKey = normalizeSeriesAliasKey_(master.canonicalKey);
  if (
    canonicalKey !== oldNormalized &&
    buildSeriesRegistryBaseSignature_(canonicalKey) !==
      buildSeriesRegistryBaseSignature_(oldNormalized)
  ) return false;
  const generatedFromCurrentName = generateSeriesKeyAuto(master.displayName);
  if (
    !generatedFromCurrentName ||
    buildSeriesRegistryBaseSignature_(generatedFromCurrentName) !==
      buildSeriesRegistryBaseSignature_(oldNormalized)
  ) {
    return false;
  }

  const nextDisplayName = buildSeriesRegistryDisplayName_(displayName, newNormalized);
  if (!nextDisplayName) return false;
  registry.masterSheet.getRange(master.row, 2).setValue(nextDisplayName);
  registry.masterSheet.getRange(master.row, 10).setValue(new Date());
  registry.masterSheet.getRange(master.row, 11).setValue(newNormalized);
  return true;
}

function linkSeriesKeyAfterTitleEdit_(oldKey, newKey, displayName) {
  const oldNormalized = normalizeSeriesAliasKey_(oldKey);
  const newNormalized = normalizeSeriesAliasKey_(newKey);
  if (!newNormalized || !isSeriesRegistryV2Active_()) return null;
  const registry = loadSeriesRegistryLookup_();
  const oldResolved = oldNormalized
    ? resolveSeriesRegistryKey_(oldNormalized, registry)
    : null;
  const newResolved = resolveSeriesRegistryKey_(newNormalized, registry);
  const plan = buildSeriesTitleEditLinkPlan_(
    oldNormalized,
    newNormalized,
    oldResolved,
    newResolved
  );

  if (plan.action === 'LINK_TO_OLD') {
    assertSeriesRegistryAliasAdditionAllowed_(newNormalized, oldResolved.seriesId, registry);
  } else if (plan.action === 'CREATE') {
    assertSeriesRegistryAliasAdditionAllowed_(newNormalized, '', registry);
  } else if (
    plan.action === 'USE_EXISTING' &&
    newResolved &&
    newResolved.matchedBy === 'UNIQUE_SIGNATURE' &&
    !registry.aliasByKey.has(newNormalized)
  ) {
    assertSeriesRegistryAliasAdditionAllowed_(newNormalized, newResolved.seriesId, registry);
  }

  if (plan.action === 'CONFLICT') {
    appendSeriesReviewRow_(
      oldNormalized,
      plan.oldSeriesId,
      newNormalized,
      plan.newSeriesId,
      'TITLE_EDIT_CONFLICT'
    );
    return Object.assign({}, oldResolved, {
      matchedBy: 'CONFLICT',
      conflictKey: newNormalized,
      conflictSeriesId: plan.newSeriesId
    });
  }
  if (plan.action === 'USE_EXISTING') {
    const linked = ensureSeriesRegistryAlias_(newNormalized, { source: 'TITLE_EDIT_SIGNATURE' });
    if (oldResolved && linked && linked.seriesId === oldResolved.seriesId) {
      maybeFollowSeriesRegistryCanonicalAfterTitleEdit_(
        oldNormalized,
        newNormalized,
        displayName,
        oldResolved.seriesId
      );
    }
    return linked;
  }
  if (plan.action === 'UNCHANGED') return newResolved;
  if (plan.action === 'CREATE') {
    return ensureSeriesRegistryAlias_(newNormalized, {
      source: 'TITLE_EDIT_NEW',
      displayName
    });
  }

  appendSeriesAliasRow_(
    registry.aliasSheet,
    newNormalized,
    oldResolved.seriesId,
    'TITLE_EDIT',
    1,
    new Date()
  );
  maybeFollowSeriesRegistryCanonicalAfterTitleEdit_(
    oldNormalized,
    newNormalized,
    displayName,
    oldResolved.seriesId
  );
  return Object.assign({}, oldResolved, { matchedBy: 'TITLE_EDIT' });
}

function syncSeriesRegistryAfterTitleEdit_(sheet, startRow, rowCount, oldKeys) {
  if (!isSeriesRegistryV2Active_() || rowCount <= 0) {
    return { linked: 0, created: 0, conflicts: 0, conflictRows: [] };
  }
  const currentKeys = sheet
    .getRange(startRow, CONFIG.COL.SERIES_KEY_AUTO, rowCount, 1)
    .getDisplayValues();
  const currentTitles = sheet
    .getRange(startRow, CONFIG.COL.TITLE, rowCount, 1)
    .getDisplayValues();
  let linked = 0;
  let created = 0;
  let conflicts = 0;
  const conflictRows = [];

  for (let index = 0; index < rowCount; index++) {
    const oldKey = String(oldKeys && oldKeys[index] ? oldKeys[index][0] || '' : '');
    const newKey = String(currentKeys[index] ? currentKeys[index][0] || '' : '');
    if (!newKey || normalizeSeriesAliasKey_(oldKey) === normalizeSeriesAliasKey_(newKey)) {
      if (newKey) ensureSeriesRegistryAlias_(newKey, { source: 'TITLE_EDIT_EXISTING' });
      continue;
    }
    const result = linkSeriesKeyAfterTitleEdit_(
      oldKey,
      newKey,
      currentTitles[index] ? currentTitles[index][0] : ''
    );
    if (result && result.matchedBy === 'CONFLICT') {
      sheet.getRange(startRow + index, CONFIG.COL.SERIES_KEY_AUTO).setValue(oldKey);
      conflicts += 1;
      conflictRows.push(startRow + index);
    } else if (result && result.matchedBy === 'NEW_SERIES') created += 1;
    else if (result) linked += 1;
  }
  return { linked, created, conflicts, conflictRows };
}

function syncSeriesRegistryFromCatalog_() {
  if (!isSeriesRegistryV2Active_()) return { active: false, added: 0 };
  const sheet = getSheet(CONFIG.SHEETS.MAIN);
  const lastRow = getLastDataRow(sheet, CONFIG.COL.TITLE);
  if (lastRow < 2) return { active: true, added: 0 };
  const keys = sheet
    .getRange(2, CONFIG.COL.SERIES_KEY_AUTO, lastRow - 1, 1)
    .getDisplayValues();
  const titles = sheet
    .getRange(2, CONFIG.COL.TITLE, lastRow - 1, 1)
    .getDisplayValues();
  const counts = new Map();
  keys.forEach((row, index) => {
    const key = normalizeSeriesAliasKey_(row[0]);
    if (!key) return;
    if (!counts.has(key)) counts.set(key, { count: 0, titles: [] });
    const item = counts.get(key);
    item.count += 1;
    const title = String(titles[index] ? titles[index][0] || '' : '').trim();
    if (title) item.titles.push(title);
  });
  const registry = loadSeriesRegistryLookup_();
  if (!registry) return { active: true, added: 0, keys: counts.size };
  const integrityBlockers = getSeriesRegistryIntegrityBlockers_(registry);
  if (integrityBlockers.length) {
    throw new Error(`Series registry integrity check failed: ${integrityBlockers[0]}`);
  }
  const timestamp = new Date();
  const newMasterRows = [];
  const newAliasRows = [];
  const newMasterBySignature = new Map();
  let added = 0;
  counts.forEach((item, key) => {
    const count = item.count;
    if (registry.ambiguousAliasKeys && registry.ambiguousAliasKeys.has(key)) {
      throw new Error(`Series alias has multiple active owners: ${key}`);
    }
    const resolved = resolveSeriesRegistryKey_(key, registry);
    if (resolved) {
      if (resolved.matchedBy === 'UNIQUE_SIGNATURE' && !registry.aliasByKey.has(key)) {
        assertSeriesRegistryAliasAdditionAllowed_(key, resolved.seriesId, registry);
        newAliasRows.push([
          key,
          resolved.seriesId,
          'AUTO_SIGNATURE',
          buildSeriesAliasSignature_(key),
          count,
          timestamp
        ]);
        registry.aliasByKey.set(key, { aliasKey: key, seriesId: resolved.seriesId, row: 0 });
      }
      return;
    }

    if (registry.allAliasOwnersByKey.has(key)) {
      throw new Error(`Series alias belongs to an inactive or missing master: ${key}`);
    }
    const signature = buildSeriesAliasSignature_(key);
    const signatureOwners = registry.signatureOwners.get(signature);
    if (signatureOwners && signatureOwners.size > 1) {
      throw new Error(`Series signature has multiple active owners: ${key}`);
    }
    const allSignatureOwners = registry.allSignatureOwners.get(signature);
    if (allSignatureOwners && allSignatureOwners.size) {
      throw new Error(`Series signature belongs to an inactive or ambiguous master: ${key}`);
    }
    const pending = newMasterBySignature.get(signature);
    if (pending) {
      pending.count += count;
      pending.titles.push(...item.titles);
      newAliasRows.push([
        key,
        pending.seriesId,
        'CATALOG_SYNC_SIGNATURE',
        signature,
        count,
        timestamp
      ]);
      return;
    }

    const seriesId = `series_${Utilities.getUuid()}`;
    const displayName = chooseSeriesRegistryDisplayName_(item.titles, key);
    const group = { seriesId, canonicalKey: key, displayName, titles: item.titles.slice(), count };
    newMasterBySignature.set(signature, group);
    newMasterRows.push(buildSeriesRegistryMasterRow_(
      seriesId,
      displayName,
      ['', '', '', '', ''],
      group.count,
      'ACTIVE',
      timestamp,
      key,
      ['', ''],
      registry.masterColumnCount
    ));
    newAliasRows.push([
      key,
      seriesId,
      'CATALOG_SYNC',
      buildSeriesAliasSignature_(key),
      count,
      timestamp
    ]);
    added += 1;
  });

  newMasterBySignature.forEach(group => {
    const row = newMasterRows.find(item => item[0] === group.seriesId);
    if (row) row[7] = group.count;
  });

  if (newMasterRows.length) {
    ensureSeriesRegistryRowCapacity_(
      registry.masterSheet,
      getNextSeriesRegistryRow_(registry.masterSheet),
      newMasterRows.length
    );
  }
  if (newAliasRows.length) {
    ensureSeriesRegistryRowCapacity_(
      registry.aliasSheet,
      getNextSeriesRegistryRow_(registry.aliasSheet),
      newAliasRows.length
    );
  }
  if (newMasterRows.length) {
    appendSeriesRegistryRows_(
      registry.masterSheet,
      newMasterRows,
      registry.masterColumnCount,
      true
    );
  }
  if (newAliasRows.length) {
    appendSeriesRegistryRows_(registry.aliasSheet, newAliasRows, 6, true);
  }
  const usage = refreshSeriesRegistryUsageCountsFromCatalog_(sheet);
  return {
    active: true,
    added,
    aliasesAdded: newAliasRows.length,
    keys: counts.size,
    masterCountsChanged: usage.masterCountsChanged,
    aliasCountsChanged: usage.aliasCountsChanged
  };
}

/**
 * 目録X列を正本として、V2マスタとaliasの蔵書数を再集計する。
 * X列の手修正、タイトル訂正、新刊追加のいずれから呼ばれても同じ状態へ収束させる。
 */
function refreshSeriesRegistryUsageCountsFromCatalog_(catalogSheet) {
  if (!isSeriesRegistryV2Active_()) {
    return { active: false, masterCountsChanged: 0, aliasCountsChanged: 0 };
  }
  const sheet = catalogSheet || getSheet(CONFIG.SHEETS.MAIN);
  const registry = loadSeriesRegistryLookup_();
  if (!registry) {
    return { active: true, masterCountsChanged: 0, aliasCountsChanged: 0 };
  }
  const lastRow = getLastDataRow(sheet, CONFIG.COL.TITLE);
  const keyCounts = new Map();
  const seriesCounts = new Map();
  if (lastRow >= 2) {
    sheet
      .getRange(2, CONFIG.COL.SERIES_KEY_AUTO, lastRow - 1, 1)
      .getDisplayValues()
      .forEach(row => {
        const key = normalizeSeriesAliasKey_(row[0]);
        if (!key) return;
        keyCounts.set(key, (keyCounts.get(key) || 0) + 1);
        const resolved = resolveSeriesRegistryKey_(key, registry);
        if (!resolved) return;
        seriesCounts.set(
          resolved.seriesId,
          (seriesCounts.get(resolved.seriesId) || 0) + 1
        );
      });
  }

  const masterLastRow = getLastDataRow(registry.masterSheet, 1);
  let masterCountsChanged = 0;
  if (masterLastRow >= 2) {
    const idValues = registry.masterSheet
      .getRange(2, 1, masterLastRow - 1, 1)
      .getDisplayValues();
    const countRange = registry.masterSheet.getRange(2, 8, masterLastRow - 1, 1);
    const countValues = countRange.getValues();
    idValues.forEach((row, index) => {
      const desired = seriesCounts.get(String(row[0] || '').trim()) || 0;
      if (Number(countValues[index][0] || 0) === desired) return;
      countValues[index][0] = desired;
      masterCountsChanged += 1;
    });
    if (masterCountsChanged) countRange.setValues(countValues);
  }

  const aliasLastRow = getLastDataRow(registry.aliasSheet, 1);
  let aliasCountsChanged = 0;
  if (aliasLastRow >= 2) {
    const aliasValues = registry.aliasSheet
      .getRange(2, 1, aliasLastRow - 1, 1)
      .getDisplayValues();
    const countRange = registry.aliasSheet.getRange(2, 5, aliasLastRow - 1, 1);
    const countValues = countRange.getValues();
    aliasValues.forEach((row, index) => {
      const desired = keyCounts.get(normalizeSeriesAliasKey_(row[0])) || 0;
      if (Number(countValues[index][0] || 0) === desired) return;
      countValues[index][0] = desired;
      aliasCountsChanged += 1;
    });
    if (aliasCountsChanged) countRange.setValues(countValues);
  }

  return { active: true, masterCountsChanged, aliasCountsChanged };
}

/**
 * X列の手修正を、元の自動判定キーから修正先series_idへの明示aliasとして保存する。
 * これにより、後日タイトル編集でX列を再生成しても同じシリーズへ戻る。
 */
function syncSeriesRegistryAfterManualKeyEdit_(sheet, startRow, rowCount) {
  if (!isSeriesRegistryV2Active_() || rowCount <= 0) {
    return { active: false, aliasesMerged: 0, masterCountsChanged: 0 };
  }
  const manualKeys = sheet
    .getRange(startRow, CONFIG.COL.SERIES_KEY_AUTO, rowCount, 1)
    .getDisplayValues();
  const titles = sheet
    .getRange(startRow, CONFIG.COL.TITLE, rowCount, 1)
    .getValues();
  const genres = sheet
    .getRange(startRow, CONFIG.COL.GENRE, rowCount, 1)
    .getDisplayValues();
  const automaticPlan = buildSeriesKeyAutoRepairPlan_(
    titles,
    genres,
    manualKeys,
    loadSeriesRegistryExtraLookup_()
  );

  const initialRegistry = loadSeriesRegistryLookup_();
  const blankKeyRows = initialRegistry && initialRegistry.catalogUsage
    ? initialRegistry.catalogUsage.blankKeyRows || []
    : [];
  if (blankKeyRows.length) {
    throw new Error(
      `Series registry merge preflight failed: ${describeSeriesRegistryUnresolvedCatalogKeys_(blankKeyRows)}`
    );
  }

  // Xの変更先だけを先に確定し、後段のalias移動は全行の競合を検査してから行う。
  syncSeriesRegistryFromCatalog_();
  const registry = loadSeriesRegistryLookup_();
  if (!registry) return { active: true, aliasesMerged: 0, masterCountsChanged: 0 };

  const review = readSeriesRegistryReviewReferenceIds_(registry);
  const external = readSeriesRegistryExternalReferenceIds_(registry);
  const preflight = buildSeriesRegistryLifecyclePlan_(registry, {
    reviewReferencedIds: review.references,
    reviewScanComplete: review.complete,
    externalReferencedIds: external.references,
    externalScanComplete: external.complete
  });
  if (preflight.blockers.length) {
    throw new Error(`Series registry merge preflight failed: ${preflight.blockers[0]}`);
  }

  const timestamp = new Date();
  const targetBySourceSeriesId = new Map();
  const newAliasesByKey = new Map();
  const skippedLiveSources = new Set();
  const skippedProtectedSources = new Set();
  manualKeys.forEach((row, index) => {
    const manualKey = normalizeSeriesAliasKey_(row[0]);
    const automaticKey = normalizeSeriesAliasKey_(
      automaticPlan.values[index] ? automaticPlan.values[index][0] : ''
    );
    if (!manualKey || !automaticKey || manualKey === automaticKey) return;

    const target = resolveSeriesRegistryKey_(manualKey, registry);
    if (!target) return;
    const existing = registry.aliasByKey.get(automaticKey);
    if (existing && existing.seriesId === target.seriesId) return;
    const exactOwners = registry.allAliasOwnersByKey.get(automaticKey);
    if (exactOwners && (!existing || exactOwners.size !== 1)) return;

    const automaticResolved = existing
      ? { seriesId: existing.seriesId }
      : resolveSeriesRegistryKey_(automaticKey, registry);
    if (automaticResolved && automaticResolved.seriesId !== target.seriesId) {
      const sourceSeriesId = automaticResolved.seriesId;
      const actualReferences = registry.catalogUsage.refsBySeriesId.get(sourceSeriesId) || 0;
      if (actualReferences > 0) {
        skippedLiveSources.add(sourceSeriesId);
        return;
      }
      if (review.references.has(sourceSeriesId) || external.references.has(sourceSeriesId)) {
        skippedProtectedSources.add(sourceSeriesId);
        return;
      }
      const previousTarget = targetBySourceSeriesId.get(sourceSeriesId);
      if (previousTarget && previousTarget !== target.seriesId) {
        throw new Error(`Manual series merge has multiple targets for ${sourceSeriesId}`);
      }
      targetBySourceSeriesId.set(sourceSeriesId, target.seriesId);
      return;
    }
    if (automaticResolved && automaticResolved.seriesId === target.seriesId) {
      if (!existing) newAliasesByKey.set(automaticKey, target.seriesId);
      return;
    }
    if (registry.allAliasOwnersByKey.has(automaticKey)) return;
    const signature = buildSeriesAliasSignature_(automaticKey);
    const owners = registry.signatureOwners.get(signature);
    if (owners && owners.size > 1) return;
    const plannedTarget = newAliasesByKey.get(automaticKey);
    if (plannedTarget && plannedTarget !== target.seriesId) {
      throw new Error(`Manual series alias has multiple targets: ${automaticKey}`);
    }
    newAliasesByKey.set(automaticKey, target.seriesId);
  });

  const aliasRowsToRehome = [];
  targetBySourceSeriesId.forEach((targetSeriesId, sourceSeriesId) => {
    const aliases = registry.allAliasRowsBySeriesId.get(sourceSeriesId) || [];
    aliases.forEach(alias => {
      const owners = registry.aliasOwnersByKey.get(alias.aliasKey);
      if (!owners || owners.size !== 1 || !owners.has(sourceSeriesId)) {
        throw new Error(`Manual series merge alias conflict: ${alias.aliasKey}`);
      }
      const signatureOwners = registry.allSignatureOwners.get(alias.signature);
      if (signatureOwners && [...signatureOwners].some(ownerId =>
        ownerId !== sourceSeriesId && ownerId !== targetSeriesId
      )) {
        throw new Error(`Manual series merge signature conflict: ${alias.aliasKey}`);
      }
      const targetAlias = registry.aliasByKey.get(alias.aliasKey);
      if (targetAlias && targetAlias.seriesId !== sourceSeriesId) {
        throw new Error(`Manual series merge target already owns alias: ${alias.aliasKey}`);
      }
      aliasRowsToRehome.push({
        row: alias.row,
        aliasKey: alias.aliasKey,
        sourceSeriesId,
        targetSeriesId
      });
    });
  });

  const metadataPlan = buildSeriesRegistryMetadataMergePlan_(
    registry,
    [...targetBySourceSeriesId].map(([sourceSeriesId, targetSeriesId]) => ({
      sourceSeriesId,
      destinationSeriesId: targetSeriesId
    }))
  );
  if (metadataPlan.blockers.length) {
    persistSeriesRegistryMetadataMergeHolds_(
      registry,
      metadataPlan.pairs,
      metadataPlan.blockers
    );
    throw new Error(`Manual series metadata merge blocked: ${metadataPlan.blockers[0]}`);
  }
  const metadataMerge = applySeriesRegistryMetadataMergePlan_(registry, metadataPlan);
  if (!metadataMerge.ok) {
    persistSeriesRegistryMetadataMergeHolds_(
      registry,
      metadataPlan.pairs,
      metadataMerge.blockers
    );
    throw new Error(`Manual series metadata merge blocked: ${metadataMerge.blockers[0]}`);
  }

  if (newAliasesByKey.size) {
    ensureSeriesRegistryRowCapacity_(
      registry.aliasSheet,
      getNextSeriesRegistryRow_(registry.aliasSheet),
      newAliasesByKey.size
    );
  }
  aliasRowsToRehome.forEach(item => {
    registry.aliasSheet.getRange(item.row, 2).setValue(item.targetSeriesId);
    registry.aliasSheet.getRange(item.row, 3).setValue('MANUAL_X_MERGE');
    registry.aliasSheet.getRange(item.row, 6).setValue(timestamp);
  });
  if (newAliasesByKey.size) {
    appendSeriesRegistryRows_(
      registry.aliasSheet,
      [...newAliasesByKey].map(([aliasKey, seriesId]) => [
        aliasKey,
        seriesId,
        'MANUAL_X_MERGE',
        buildSeriesAliasSignature_(aliasKey),
        0,
        timestamp
      ]),
      6,
      true
    );
  }
  const usage = refreshSeriesRegistryUsageCountsFromCatalog_(sheet);
  const cleanup = cleanupSeriesRegistryLifecycleCore_();
  const finalUsage = cleanup.changed
    ? refreshSeriesRegistryUsageCountsFromCatalog_(sheet)
    : usage;
  return {
    active: true,
    aliasesMerged: aliasRowsToRehome.length + newAliasesByKey.size,
    preservedLiveSources: skippedLiveSources.size,
    preservedProtectedSources: skippedProtectedSources.size,
    metadataSlotsMerged: metadataPlan.changedSlots,
    masterCountsChanged: finalUsage.masterCountsChanged,
    aliasCountsChanged: finalUsage.aliasCountsChanged,
    cleanup
  };
}

function activateSeriesRegistryV2_() {
  const spreadsheet = SpreadsheetApp.getActive();
  const masterSheet = spreadsheet.getSheetByName(SERIES_REGISTRY_CONFIG_.MASTER_SHEET);
  const aliasSheet = spreadsheet.getSheetByName(SERIES_REGISTRY_CONFIG_.ALIAS_SHEET);
  if (!masterSheet || !aliasSheet) {
    throw new Error('series_master_v2 / series_alias_v2 is missing');
  }
  // 移行前A:Kと移行後A:Mのどちらも有効。部分的なL/Mだけは拒否する。
  getSeriesRegistryMasterColumnCount_(masterSheet);
  const aliasHeaders = aliasSheet.getRange(1, 1, 1, 6).getDisplayValues()[0];
  if (aliasHeaders.join('\u0000') !== SERIES_REGISTRY_CONFIG_.ALIAS_HEADERS.join('\u0000')) {
    throw new Error('series_alias_v2 headers do not match');
  }
  PropertiesService.getScriptProperties().setProperty(
    SERIES_REGISTRY_CONFIG_.ACTIVE_PROPERTY,
    '1'
  );
  clearLibrarySearchCache_();
  return auditSeriesRegistryV2_();
}

function deactivateSeriesRegistryV2_() {
  PropertiesService.getScriptProperties().deleteProperty(
    SERIES_REGISTRY_CONFIG_.ACTIVE_PROPERTY
  );
  clearLibrarySearchCache_();
  return { active: false };
}

function auditSeriesRegistryV2_() {
  const active = isSeriesRegistryV2Active_();
  if (!active) return { active: false };
  const lookup = loadSeriesRegistryLookup_();
  if (!lookup) return { active: true, ready: false };
  const sheet = getSheet(CONFIG.SHEETS.MAIN);
  const lastRow = getLastDataRow(sheet, CONFIG.COL.TITLE);
  const keys = lastRow >= 2
    ? sheet.getRange(2, CONFIG.COL.SERIES_KEY_AUTO, lastRow - 1, 1).getDisplayValues()
    : [];
  const unresolved = [];
  keys.forEach((row, index) => {
    const key = normalizeSeriesAliasKey_(row[0]);
    if (key && !resolveSeriesRegistryKey_(key, lookup)) {
      unresolved.push({ row: index + 2, key });
    }
  });
  return {
    active: true,
    ready: true,
    masterCount: lookup.masterById.size,
    aliasCount: lookup.aliasByKey.size,
    checkedBooks: keys.length,
    unresolvedCount: unresolved.length,
    unresolved: unresolved.slice(0, 100)
  };
}
