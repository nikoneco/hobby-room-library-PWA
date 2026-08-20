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
  ]
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

  const masterLastRow = getLastDataRow(masterSheet, 1);
  const aliasLastRow = getLastDataRow(aliasSheet, 1);
  const masterColumnCount = getSeriesRegistryMasterColumnCount_(masterSheet);
  const masterRows = masterLastRow >= 2
    ? masterSheet.getRange(
        2,
        1,
        masterLastRow - 1,
        masterColumnCount
      ).getDisplayValues()
    : [];
  const aliasRows = aliasLastRow >= 2
    ? aliasSheet.getRange(2, 1, aliasLastRow - 1, 6).getDisplayValues()
    : [];

  const masterById = new Map();
  masterRows.forEach((row, index) => {
    const seriesId = String(row[0] || '').trim();
    if (!seriesId || masterById.has(seriesId)) return;
    const genres = row.slice(2, 7).map(value => String(value || '').trim());
    const media = masterColumnCount > SERIES_REGISTRY_CONFIG_.LEGACY_MASTER_HEADERS.length
      ? row.slice(11, 13).map(value => String(value || '').trim())
      : ['', ''];
    masterById.set(seriesId, {
      seriesId,
      displayName: String(row[1] || '').trim(),
      canonicalKey: normalizeSeriesAliasKey_(row[10] || row[1]),
      genres,
      media,
      isExtra: isSeriesRegistryExtraClassification_(
        genres,
        media,
        row[10] || row[1]
      ),
      row: index + 2
    });
  });

  const aliasByKey = new Map();
  const signatureOwners = new Map();
  aliasRows.forEach((row, index) => {
    const aliasKey = normalizeSeriesAliasKey_(row[0]);
    const seriesId = String(row[1] || '').trim();
    const signature = String(row[3] || buildSeriesAliasSignature_(aliasKey));
    if (!aliasKey || !seriesId || !masterById.has(seriesId)) return;
    if (!aliasByKey.has(aliasKey)) {
      aliasByKey.set(aliasKey, { aliasKey, seriesId, row: index + 2 });
    }
    if (signature) {
      if (!signatureOwners.has(signature)) signatureOwners.set(signature, new Set());
      signatureOwners.get(signature).add(seriesId);
    }
  });

  const uniqueSeriesIdBySignature = new Map();
  signatureOwners.forEach((seriesIds, signature) => {
    if (seriesIds.size === 1) uniqueSeriesIdBySignature.set(signature, [...seriesIds][0]);
  });

  return {
    masterById,
    aliasByKey,
    uniqueSeriesIdBySignature,
    masterColumnCount,
    masterSheet,
    aliasSheet
  };
}

function resolveSeriesRegistryKey_(rawKey, lookup) {
  const registry = lookup || loadSeriesRegistryLookup_();
  const key = normalizeSeriesAliasKey_(rawKey);
  if (!registry || !key) return null;
  const exact = registry.aliasByKey.get(key);
  let seriesId = exact ? exact.seriesId : '';
  let matchedBy = exact ? 'EXACT_ALIAS' : '';

  if (!seriesId) {
    const signature = buildSeriesAliasSignature_(key);
    seriesId = registry.uniqueSeriesIdBySignature.get(signature) || '';
    if (seriesId) matchedBy = 'UNIQUE_SIGNATURE';
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
  registry.aliasByKey.forEach((alias, aliasKey) => {
    const master = registry.masterById.get(alias.seriesId);
    if (master) result.set(aliasKey, Boolean(master.isExtra || hasExtraSeriesPrefix_(aliasKey)));
  });
  return result;
}

function ensureSeriesRegistryExtraAliases_() {
  if (!isSeriesRegistryV2Active_()) return { added: 0 };
  const registry = loadSeriesRegistryLookup_();
  if (!registry) return { added: 0 };
  const additions = [];

  registry.aliasByKey.forEach((alias, aliasKey) => {
    const master = registry.masterById.get(alias.seriesId);
    if (!master) return;
    const baseKey = stripExtraSeriesPrefix_(aliasKey);
    const desiredKey = master.isExtra
      ? `${SERIES_REGISTRY_CONFIG_.EXTRA_PREFIX}${baseKey}`
      : baseKey;
    if (!desiredKey || desiredKey === aliasKey) return;
    const existing = registry.aliasByKey.get(desiredKey);
    if (existing && existing.seriesId !== alias.seriesId) {
      throw new Error(`Series extra alias conflict: ${desiredKey}`);
    }
    if (!existing) {
      additions.push({
        aliasKey: desiredKey,
        seriesId: alias.seriesId,
        source: master.isExtra ? 'EXTRA_DERIVED' : 'NORMAL_DERIVED'
      });
      registry.aliasByKey.set(desiredKey, {
        aliasKey: desiredKey,
        seriesId: alias.seriesId,
        row: 0
      });
    }
  });

  additions.forEach(item => {
    appendSeriesAliasRow_(
      registry.aliasSheet,
      item.aliasKey,
      item.seriesId,
      item.source,
      0,
      new Date()
    );
  });
  return { added: additions.length };
}

function appendSeriesAliasRow_(aliasSheet, aliasKey, seriesId, source, count, timestamp) {
  const key = normalizeSeriesAliasKey_(aliasKey);
  if (!key || !seriesId) return false;
  aliasSheet.appendRow([
    key,
    seriesId,
    source || 'AUTO',
    buildSeriesAliasSignature_(key),
    Number(count || 0),
    timestamp || new Date()
  ]);
  return true;
}

function appendSeriesReviewRow_(candidateKey, candidateSeriesId, comparisonKey, comparisonSeriesId, reason) {
  const reviewSheet = SpreadsheetApp.getActive().getSheetByName(
    SERIES_REGISTRY_CONFIG_.REVIEW_SHEET
  );
  if (!reviewSheet) return false;
  reviewSheet.appendRow([
    normalizeSeriesAliasKey_(candidateKey),
    String(candidateSeriesId || ''),
    normalizeSeriesAliasKey_(comparisonKey),
    String(comparisonSeriesId || ''),
    reason || 'TITLE_EDIT_CONFLICT',
    '要確認',
    new Date()
  ]);
  return true;
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
  masterSheet.appendRow(buildSeriesRegistryMasterRow_(
    seriesId,
    buildSeriesRegistryDisplayName_(displayName, canonicalKey),
    genreSlots,
    Number(count || 0),
    'ACTIVE',
    timestamp || new Date(),
    canonicalKey,
    mediaSlots,
    masterColumnCount
  ));
  return seriesId;
}

function ensureSeriesRegistryAlias_(rawKey, options) {
  const key = normalizeSeriesAliasKey_(rawKey);
  if (!key || !isSeriesRegistryV2Active_()) return null;
  const registry = loadSeriesRegistryLookup_();
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
    return ensureSeriesRegistryAlias_(newNormalized, { source: 'TITLE_EDIT_SIGNATURE' });
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
  const timestamp = new Date();
  const newMasterRows = [];
  const newAliasRows = [];
  let added = 0;
  counts.forEach((item, key) => {
    const count = item.count;
    const resolved = resolveSeriesRegistryKey_(key, registry);
    if (resolved) {
      if (resolved.matchedBy === 'UNIQUE_SIGNATURE' && !registry.aliasByKey.has(key)) {
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

    const seriesId = `series_${Utilities.getUuid()}`;
    const displayName = chooseSeriesRegistryDisplayName_(item.titles, key);
    newMasterRows.push(buildSeriesRegistryMasterRow_(
      seriesId,
      displayName,
      ['', '', '', '', ''],
      count,
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
    registry.masterById.set(seriesId, {
      seriesId,
      displayName,
      canonicalKey: key,
      genres: ['', '', '', '', ''],
      media: ['', ''],
      isExtra: hasExtraSeriesPrefix_(key),
      row: 0
    });
    registry.aliasByKey.set(key, { aliasKey: key, seriesId, row: 0 });
    added += 1;
  });

  if (newMasterRows.length) {
    const startRow = getLastDataRow(registry.masterSheet, 1) + 1;
    const target = registry.masterSheet.getRange(
      startRow,
      1,
      newMasterRows.length,
      registry.masterColumnCount
    );
    if (startRow > 2) {
      const template = registry.masterSheet.getRange(
        startRow - 1,
        1,
        1,
        registry.masterColumnCount
      );
      template.copyTo(target, SpreadsheetApp.CopyPasteType.PASTE_FORMAT, false);
      template.copyTo(target, SpreadsheetApp.CopyPasteType.PASTE_DATA_VALIDATION, false);
    }
    target.setValues(newMasterRows);
  }
  if (newAliasRows.length) {
    const startRow = getLastDataRow(registry.aliasSheet, 1) + 1;
    registry.aliasSheet
      .getRange(startRow, 1, newAliasRows.length, 6)
      .setValues(newAliasRows);
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

  // 修正先キーが未知なら、先に通常の同期で新しいseries_idを作る。
  syncSeriesRegistryFromCatalog_();
  let registry = loadSeriesRegistryLookup_();
  if (!registry) return { active: true, aliasesMerged: 0, masterCountsChanged: 0 };

  const timestamp = new Date();
  const sourceSeriesIds = new Set();
  const targetSeriesIds = new Set();
  let aliasesMerged = 0;
  manualKeys.forEach((row, index) => {
    const manualKey = normalizeSeriesAliasKey_(row[0]);
    const automaticKey = normalizeSeriesAliasKey_(
      automaticPlan.values[index] ? automaticPlan.values[index][0] : ''
    );
    if (!manualKey || !automaticKey || manualKey === automaticKey) return;

    const target = resolveSeriesRegistryKey_(manualKey, registry);
    if (!target) return;
    targetSeriesIds.add(target.seriesId);
    const existing = registry.aliasByKey.get(automaticKey);
    if (existing && existing.seriesId === target.seriesId) return;
    if (existing) {
      sourceSeriesIds.add(existing.seriesId);
      registry.aliasSheet.getRange(existing.row, 2).setValue(target.seriesId);
      registry.aliasSheet.getRange(existing.row, 3).setValue('MANUAL_X_MERGE');
      registry.aliasSheet.getRange(existing.row, 6).setValue(timestamp);
    } else {
      appendSeriesAliasRow_(
        registry.aliasSheet,
        automaticKey,
        target.seriesId,
        'MANUAL_X_MERGE',
        0,
        timestamp
      );
    }
    aliasesMerged += 1;
  });

  if (aliasesMerged) registry = loadSeriesRegistryLookup_();
  const usage = refreshSeriesRegistryUsageCountsFromCatalog_(sheet);
  if (sourceSeriesIds.size) {
    const masterLastRow = getLastDataRow(registry.masterSheet, 1);
    const rows = masterLastRow >= 2
      ? registry.masterSheet.getRange(2, 1, masterLastRow - 1, 10).getValues()
      : [];
    rows.forEach((row, index) => {
      const seriesId = String(row[0] || '').trim();
      const count = Number(row[7] || 0);
      if (targetSeriesIds.has(seriesId) && count > 0) {
        registry.masterSheet.getRange(index + 2, 9).setValue('ACTIVE');
        registry.masterSheet.getRange(index + 2, 10).setValue(timestamp);
      } else if (sourceSeriesIds.has(seriesId) && count === 0) {
        registry.masterSheet.getRange(index + 2, 9).setValue('MERGED');
        registry.masterSheet.getRange(index + 2, 10).setValue(timestamp);
      }
    });
  }
  return {
    active: true,
    aliasesMerged,
    masterCountsChanged: usage.masterCountsChanged,
    aliasCountsChanged: usage.aliasCountsChanged
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
