/** Server-only Google Sheets repository. Callable APIs must authorize first. */
var MP_EXECUTION_DATABASE_ID_ = null;

/**
 * Test-only execution context. This is process-local state, never persisted in
 * Script Properties, so isolated tests cannot change the live database binding.
 */
function mpWithDatabaseContext_(spreadsheetId, callback) {
  const previous = MP_EXECUTION_DATABASE_ID_;
  MP_EXECUTION_DATABASE_ID_ = spreadsheetId;
  try { return callback(); }
  finally { MP_EXECUTION_DATABASE_ID_ = previous; }
}

function mpCurrentDatabaseId_() {
  const id = MP_EXECUTION_DATABASE_ID_ || PropertiesService.getScriptProperties().getProperty(MP_CONFIG.DATABASE_ID_PROPERTY);
  if (!id) throw new Error('Database is not initialized. Bind a compatible spreadsheet or run setupDatabase().');
  return id;
}

function mpGetDatabase_() {
  const id = mpCurrentDatabaseId_();
  if (!MP_SPREADSHEET_CACHE_[id]) MP_SPREADSHEET_CACHE_[id] = SpreadsheetApp.openById(id);
  return MP_SPREADSHEET_CACHE_[id];
}

function mpExpectedSettings_() {
  const expected = {};
  Object.keys(MP_DEFAULT_SETTINGS).forEach(function(key) { expected[key] = MP_DEFAULT_SETTINGS[key]; });
  return expected;
}

function mpParseSettingValue_(value) {
  if (typeof value === 'boolean' || typeof value === 'number') return value;
  const text = String(value).trim();
  try { return JSON.parse(text); }
  catch (error) {
    // A converted spreadsheet may coerce JSON false/true into uppercase text.
    if (text.toUpperCase() === 'TRUE') return true;
    if (text.toUpperCase() === 'FALSE') return false;
    throw new Error('SettingValue is not valid JSON.');
  }
}

function mpJsonEquivalent_(left, right) { return JSON.stringify(left) === JSON.stringify(right); }

/** Editable settings need only the right JSON shape; fixed ones must equal the code default. */
function mpSettingCompatible_(key, actual, expected) {
  if (MP_EDITABLE_SETTINGS.indexOf(key) === -1) return mpJsonEquivalent_(actual, expected);
  if (Array.isArray(expected)) return Array.isArray(actual) && actual.length > 0;
  if (expected && typeof expected === 'object') return !!actual && typeof actual === 'object' && !Array.isArray(actual);
  return typeof actual === typeof expected;
}

function mpCompareHeaders_(actual, expected) {
  const duplicates = actual.filter(function(header, index) { return header && actual.indexOf(header) !== index; });
  const missing = expected.filter(function(header) { return actual.indexOf(header) === -1; });
  const unexpected = actual.filter(function(header) { return expected.indexOf(header) === -1; });
  const orderMatches = actual.length === expected.length && actual.every(function(header, index) { return header === expected[index]; });
  return { compatible: !duplicates.length && !missing.length && !unexpected.length && orderMatches, duplicates: duplicates, missing: missing, unexpected: unexpected, orderMatches: orderMatches };
}

/** Read-only compatibility report. It never changes a spreadsheet. */
function mpInspectDatabaseCompatibility_(spreadsheet) {
  const report = { compatible: true, spreadsheetName: spreadsheet.getName(), sheets: {}, issues: [] };
  Object.keys(MP_SCHEMAS).forEach(function(name) {
    const sheet = spreadsheet.getSheetByName(name);
    if (!sheet) {
      report.compatible = false;
      report.sheets[name] = { compatible: false, issues: ['Missing required worksheet.'] };
      report.issues.push(name + ': missing required worksheet.');
      return;
    }
    const actual = sheet.getLastColumn() ? sheet.getRange(1, 1, 1, sheet.getLastColumn()).getDisplayValues()[0] : [];
    const compared = mpCompareHeaders_(actual, MP_SCHEMAS[name]);
    const issues = [];
    if (compared.duplicates.length) issues.push('Duplicate header(s): ' + compared.duplicates.join(', ') + '.');
    if (compared.missing.length) issues.push('Missing header(s): ' + compared.missing.join(', ') + '.');
    if (compared.unexpected.length) issues.push('Unexpected header(s): ' + compared.unexpected.join(', ') + '.');
    if (!compared.orderMatches) issues.push('Headers are not in the exact MP_SCHEMAS order.');
    report.sheets[name] = { compatible: compared.compatible, issues: issues };
    if (issues.length) { report.compatible = false; report.issues.push(name + ': ' + issues.join(' ')); }
  });
  if (report.sheets.Settings && report.sheets.Settings.compatible) {
    const settings = spreadsheet.getSheetByName('Settings');
    const values = settings.getLastRow() < 2 ? [] : settings.getRange(2, 1, settings.getLastRow() - 1, 2).getValues();
    const found = {};
    values.forEach(function(row) {
      if (!row[0]) return;
      if (found[row[0]] !== undefined) report.issues.push('Settings: duplicate SettingKey ' + row[0] + '.');
      found[row[0]] = row[1];
    });
    const expected = mpExpectedSettings_();
    Object.keys(expected).forEach(function(key) {
      if (found[key] === undefined) report.issues.push('Settings: missing required default ' + key + '.');
      else {
        try {
          if (!mpSettingCompatible_(key, mpParseSettingValue_(found[key]), expected[key])) report.issues.push('Settings: incompatible value for ' + key + '.');
        } catch (error) { report.issues.push('Settings: invalid JSON value for ' + key + '.'); }
      }
    });
    const settingIssues = report.issues.filter(function(issue) { return issue.indexOf('Settings:') === 0; });
    if (settingIssues.length) {
      report.compatible = false;
      report.sheets.Settings.compatible = false;
      report.sheets.Settings.issues = report.sheets.Settings.issues.concat(settingIssues);
    }
  }
  return report;
}

/** Creates only missing/blank schema sheets; never repairs nonblank schemas. */
function mpSetupDatabase_(options) {
  options = options || {};
  return mpWithLock_(function() {
    const properties = PropertiesService.getScriptProperties();
    const boundId = MP_EXECUTION_DATABASE_ID_ || properties.getProperty(MP_CONFIG.DATABASE_ID_PROPERTY);
    const created = [];
    const configured = [];
    let spreadsheet;
    let isNew = false;
    if (options.spreadsheet) {
      spreadsheet = options.spreadsheet;
      isNew = true;
    } else if (boundId) {
      spreadsheet = SpreadsheetApp.openById(boundId);
      const preflight = mpInspectDatabaseCompatibility_(spreadsheet);
      const nonblankIssues = preflight.issues.filter(function(issue) { return issue.indexOf('missing required worksheet') === -1; });
      if (nonblankIssues.length) throw new Error('Database schema is incompatible; no changes were made. ' + nonblankIssues.join(' '));
    } else {
      if (!properties.getProperty(MP_CONFIG.INITIAL_OWNER_PROPERTY)) throw new Error('Set the initial owner email before creating the database.');
      spreadsheet = SpreadsheetApp.create(MP_CONFIG.DATABASE_NAME);
      isNew = true;
    }
    spreadsheet.setSpreadsheetTimeZone(MP_CONFIG.DATE_TIMEZONE);
    Object.keys(MP_SCHEMAS).forEach(function(name) {
      let sheet = spreadsheet.getSheetByName(name);
      if (!sheet) {
        sheet = spreadsheet.insertSheet(name);
        sheet.getRange(1, 1, 1, MP_SCHEMAS[name].length).setValues([MP_SCHEMAS[name]]);
        created.push(name);
      } else if (mpSheetIsBlank_(sheet)) {
        sheet.getRange(1, 1, 1, MP_SCHEMAS[name].length).setValues([MP_SCHEMAS[name]]);
        created.push(name + ' (headers added to blank sheet)');
      } else if (!mpCompareHeaders_(mpHeaders_(sheet), MP_SCHEMAS[name]).compatible) {
        throw new Error(name + ' has an incompatible schema; no changes were made to it.');
      }
      mpConfigureSheetPresentation_(sheet, MP_SCHEMAS[name]);
      configured.push(name);
    });
    if (isNew) {
      const defaultSheet = spreadsheet.getSheetByName('Sheet1');
      if (defaultSheet && mpSheetIsBlank_(defaultSheet) && spreadsheet.getSheets().length > 1) spreadsheet.deleteSheet(defaultSheet);
    }
    const settingsResult = mpSeedSettings_(spreadsheet);
    const bootstrap = mpBootstrapOwner_(spreadsheet);
    if (!boundId && !options.spreadsheet) properties.setProperty(MP_CONFIG.DATABASE_ID_PROPERTY, spreadsheet.getId());
    const documents = (options.spreadsheet || MP_EXECUTION_DATABASE_ID_) ? { created: false } : mpEnsureDocumentsFolder_();
    if (!options.spreadsheet) Object.keys(MP_SCHEMAS).forEach(function(name) { mpInvalidateRows_(name); });
    mpInvalidateRows_();
    return { spreadsheetName: spreadsheet.getName(), created: created, configured: configured, settingsAdded: settingsResult.added, ownerProvisioned: bootstrap.provisioned, documentsFolderCreated: documents.created, rerunnable: true };
  });
}

function mpSheetIsBlank_(sheet) { return sheet.getLastRow() === 0 || (sheet.getLastRow() === 1 && sheet.getLastColumn() === 0); }

function mpConfigureSheetPresentation_(sheet, headers) {
  sheet.setFrozenRows(1);
  sheet.getRange(1, 1, 1, headers.length).setFontWeight('bold').setFontColor('#ffffff').setBackground('#102a43').setHorizontalAlignment('center');
  sheet.setRowHeight(1, 28);
  if (!sheet.getFilter()) sheet.getRange(1, 1, Math.max(sheet.getLastRow(), 2), headers.length).createFilter();
  sheet.setColumnWidths(1, headers.length, 140);
  const textHeaders = headers.filter(function(header) {
    return header.indexOf('ID') !== -1 || ['Phone', 'CommercialRegistrationNumber', 'TaxNumber', 'SettingValue'].indexOf(header) !== -1;
  });
  textHeaders.forEach(function(header) {
    const column = headers.indexOf(header) + 1;
    sheet.getRange(2, column, Math.max(sheet.getMaxRows() - 1, 1), 1).setNumberFormat('@');
  });
  mpApplySheetValidation_(sheet, headers);
}

function mpApplySheetValidation_(sheet, headers) {
  const validations = {
    Users: { Role: MP_CONFIG.ROLES, Status: MP_CONFIG.USER_STATUSES, Language: MP_CONFIG.LANGUAGES },
    Leads: { ClientType: MP_CONFIG.CLIENT_TYPES, Source: MP_CONFIG.LEAD_SOURCES, Priority: MP_CONFIG.PRIORITIES, Status: MP_CONFIG.LEAD_STATUSES },
    Clients: { ClientType: MP_CONFIG.CLIENT_TYPES, Status: MP_CONFIG.CLIENT_STATUSES }, Cases: { Priority: MP_CONFIG.PRIORITIES, Status: MP_CONFIG.CASE_STATUSES },
    Consultations: { PaymentStatus: MP_CONFIG.PAYMENT_STATUSES, Status: MP_CONFIG.CONSULTATION_STATUSES, IsPaid: ['TRUE', 'FALSE'] }, Transactions: { Type: MP_CONFIG.TRANSACTION_TYPES, PaymentMethod: MP_CONFIG.PAYMENT_METHODS },
    FollowUps: { Priority: MP_CONFIG.PRIORITIES, Status: MP_CONFIG.FOLLOW_UP_STATUSES }, Documents: { ConfidentialityLevel: MP_CONFIG.CONFIDENTIALITY_LEVELS }
  }[sheet.getName()] || {};
  Object.keys(validations).forEach(function(header) {
    const column = headers.indexOf(header) + 1;
    if (!column) return;
    const rule = SpreadsheetApp.newDataValidation().requireValueInList(validations[header], true).setAllowInvalid(false).build();
    sheet.getRange(2, column, Math.max(sheet.getMaxRows() - 1, 1), 1).setDataValidation(rule);
  });
}

/**
 * Per-execution caches. Row snapshots are cleared whenever the script lock is
 * acquired or released and whenever a sheet is written, so locked
 * read-modify-write sequences always work from current data.
 */
var MP_ROWS_CACHE_ = {};
var MP_SPREADSHEET_CACHE_ = {};
var MP_SCOPE_CACHE_ = {};
var MP_LOCK_DEPTH_ = 0;

/**
 * Shared sheet snapshots (CacheService) so a new request does not have to
 * re-read every sheet. Each sheet has a version stamp that every app write
 * replaces, so readers never get a snapshot older than the latest app change.
 * Writes always read the sheet itself while holding the lock. Edits made by
 * hand directly in the spreadsheet appear within MP_SHARED_CACHE_SECONDS_.
 */
const MP_SHARED_CACHE_SECONDS_ = 15 * 60;
const MP_SHARED_CACHE_CHUNK_ = 40000;
const MP_SHARED_CACHE_MAX_CHUNKS_ = 40;

/** Clears every per-request cache (Apps Script starts each request empty; tests simulate that). */
function mpResetExecutionCaches_() { MP_ROWS_CACHE_ = {}; MP_SPREADSHEET_CACHE_ = {}; MP_SCOPE_CACHE_ = {}; }

/** Call after (never before) writing to a sheet. With no name, only this request's copies are dropped. */
function mpInvalidateRows_(sheetName) {
  MP_SCOPE_CACHE_ = {};
  if (!sheetName) { MP_ROWS_CACHE_ = {}; return; }
  Object.keys(MP_ROWS_CACHE_).forEach(function(key) {
    if (key.split('|')[1] === sheetName) delete MP_ROWS_CACHE_[key];
  });
  mpBumpSheetVersion_(sheetName);
}

function mpSharedCache_() {
  try { return CacheService.getScriptCache(); } catch (error) { return null; }
}

function mpSheetVersionKey_(sheetName) { return 'mpv:' + mpCurrentDatabaseId_() + ':' + sheetName; }

function mpBumpSheetVersion_(sheetName) {
  const cache = mpSharedCache_();
  if (!cache) return;
  try { cache.put(mpSheetVersionKey_(sheetName), Utilities.getUuid(), 21600); } catch (error) { /* cache is an optimisation only */ }
}

/** Where this sheet's snapshot lives for its current version. */
function mpSnapshotTarget_(sheetName) {
  const cache = mpSharedCache_();
  if (!cache) return null;
  try {
    const key = mpSheetVersionKey_(sheetName);
    let version = cache.get(key);
    if (!version) { version = Utilities.getUuid(); cache.put(key, version, 21600); }
    return { cache: cache, base: 'mps:' + mpCurrentDatabaseId_() + ':' + sheetName + ':' + version };
  } catch (error) { return null; }
}

function mpReadSnapshot_(target) {
  if (!target) return null;
  try {
    const count = Number(target.cache.get(target.base));
    if (!count) return null;
    const keys = [];
    for (let index = 0; index < count; index += 1) keys.push(target.base + ':' + index);
    const parts = target.cache.getAll(keys);
    let text = '';
    for (let index = 0; index < keys.length; index += 1) {
      if (parts[keys[index]] === undefined || parts[keys[index]] === null) return null;
      text += parts[keys[index]];
    }
    return JSON.parse(text);
  } catch (error) { return null; }
}

function mpWriteSnapshot_(target, snapshot) {
  if (!target) return;
  try {
    const text = JSON.stringify(snapshot);
    const count = Math.ceil(text.length / MP_SHARED_CACHE_CHUNK_) || 1;
    if (count > MP_SHARED_CACHE_MAX_CHUNKS_) return;
    const values = {};
    for (let index = 0; index < count; index += 1) values[target.base + ':' + index] = text.substr(index * MP_SHARED_CACHE_CHUNK_, MP_SHARED_CACHE_CHUNK_);
    target.cache.putAll(values, MP_SHARED_CACHE_SECONDS_);
    target.cache.put(target.base, String(count), MP_SHARED_CACHE_SECONDS_);
  } catch (error) { /* too large or cache unavailable: just read the sheet next time */ }
}

/** One call reads the headers and every row. */
function mpReadSheetRecords_(sheetName) {
  const values = mpSheet_(sheetName).getDataRange().getValues();
  const headers = (values[0] || []).map(function(value) { return String(value); });
  if (!headers.length || !headers[0]) throw new Error('Missing headers in ' + sheetName + '.');
  const records = [];
  for (let index = 1; index < values.length; index += 1) {
    const row = values[index];
    if (!row.some(function(value) { return value !== ''; })) continue;
    const record = {};
    headers.forEach(function(header, column) { record[header] = row[column] instanceof Date ? mpDateIso_(row[column], header, false) : row[column]; });
    record._rowNumber = index + 1;
    records.push(record);
  }
  return { headers: headers, records: records };
}

/** Re-entrant script lock: a nested workflow reuses the lock already held. */
function mpWithLock_(callback) {
  if (MP_LOCK_DEPTH_ > 0) {
    MP_LOCK_DEPTH_ += 1;
    try { return callback(); } finally { MP_LOCK_DEPTH_ -= 1; }
  }
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  MP_LOCK_DEPTH_ = 1;
  mpInvalidateRows_();
  try { return callback(); }
  finally {
    MP_LOCK_DEPTH_ = 0;
    mpInvalidateRows_();
    lock.releaseLock();
  }
}

function mpHas_(object, key) { return !!object && Object.prototype.hasOwnProperty.call(object, key); }

function mpSheet_(sheetName) {
  if (!MP_SCHEMAS[sheetName]) throw new Error('Unknown entity: ' + sheetName + '.');
  const sheet = mpGetDatabase_().getSheetByName(sheetName);
  if (!sheet) throw new Error('Missing database sheet: ' + sheetName + '.');
  return sheet;
}

function mpHeaders_(sheet) {
  if (!sheet.getLastColumn()) throw new Error('Missing headers in ' + sheet.getName() + '.');
  return sheet.getRange(1, 1, 1, sheet.getLastColumn()).getDisplayValues()[0];
}

/**
 * Returns a private copy of the sheet's records; callers may mutate it.
 * Outside the write lock a shared snapshot may be used; inside it the sheet is
 * always read, so read-modify-write workflows see the latest data.
 */
function mpRows_(sheetName) {
  if (!MP_SCHEMAS[sheetName]) throw new Error('Unknown entity: ' + sheetName + '.');
  const key = mpCurrentDatabaseId_() + '|' + sheetName;
  let cached = MP_ROWS_CACHE_[key];
  if (!cached) {
    const target = mpSnapshotTarget_(sheetName);
    if (MP_LOCK_DEPTH_ === 0) cached = mpReadSnapshot_(target);
    if (!cached) {
      cached = mpReadSheetRecords_(sheetName);
      mpWriteSnapshot_(target, cached);
    }
    MP_ROWS_CACHE_[key] = cached;
  }
  const result = { headers: cached.headers.slice(), records: mpDeepClone_(cached.records) };
  // The spreadsheet is opened only when a caller actually writes.
  Object.defineProperty(result, 'sheet', { enumerable: true, get: function() { return mpSheet_(sheetName); } });
  return result;
}

function mpRecordValues_(headers, record) {
  return headers.map(function(header) { const value = record[header]; return value === undefined || value === null ? '' : (typeof value === 'string' ? mpCleanText_(value) : value); });
}

function mpWriteRecordChecked_(sheet, headers, rowNumber, record) {
  sheet.getRange(rowNumber, 1, 1, headers.length).setValues([mpRecordValues_(headers, record)]);
  SpreadsheetApp.flush();
  mpInvalidateRows_(sheet.getName());
  const versionIndex = headers.indexOf('Version');
  const persisted = sheet.getRange(rowNumber, 1, 1, headers.length).getValues()[0];
  if (String(persisted[0]) !== String(record[headers[0]]) || (versionIndex !== -1 && Number(persisted[versionIndex]) !== Number(record.Version))) throw new Error('Spreadsheet write verification failed for ' + sheet.getName() + '.');
}

function mpAppendRecordChecked_(sheet, headers, record) { const row = sheet.getLastRow() + 1; mpWriteRecordChecked_(sheet, headers, row, record); return row; }

function mpPublicRecord_(record) {
  const clone = mpDeepClone_(record); delete clone._rowNumber;
  Object.keys(clone).forEach(function(key) { if (typeof clone[key] === 'string') clone[key] = mpPlainText_(clone[key]); });
  return clone;
}

/**
 * options: limit, offset, includeArchived, query (free text), filters
 * ({field: exactValue}), sortBy, sortDirection ('asc'|'desc'), and the
 * server-only predicate / searchExclude used by the authorization layer.
 */
function mpDbList_(sheetName, options) {
  options = options || {};
  const schema = MP_SCHEMAS[sheetName];
  const result = mpRows_(sheetName);
  const limit = Math.min(Math.max(Number(options.limit || MP_CONFIG.PAGE_SIZE), 1), MP_CONFIG.MAX_PAGE_SIZE);
  const offset = Math.max(Number(options.offset || 0), 0);
  let records = result.records.filter(function(record) { return options.includeArchived === true || record.IsArchived !== true; });
  if (options.filters) {
    if (typeof options.filters !== 'object' || Array.isArray(options.filters)) throw new Error('filters must be an object.');
    Object.keys(options.filters).forEach(function(field) {
      if (schema.indexOf(field) === -1) throw new Error('Unknown filter field for ' + sheetName + ': ' + field + '.');
    });
    records = records.filter(function(record) {
      return Object.keys(options.filters).every(function(field) { return String(record[field]) === String(options.filters[field]); });
    });
  }
  if (typeof options.predicate === 'function') records = records.filter(options.predicate);
  if (options.query) {
    const needle = String(options.query).trim().toLowerCase();
    const excluded = options.searchExclude || [];
    const phoneNeedles = mpPhoneSearchNeedles_(options.query);
    const hasPhone = schema.indexOf('Phone') !== -1 && excluded.indexOf('Phone') === -1;
    records = records.filter(function(record) {
      const text = schema.some(function(key) { return excluded.indexOf(key) === -1 && String(record[key] === undefined ? '' : record[key]).toLowerCase().indexOf(needle) !== -1; });
      if (text || !hasPhone || !phoneNeedles.length) return text;
      const digits = mpNormalizePhone_(record.Phone);
      return phoneNeedles.some(function(candidate) { return digits.indexOf(candidate) !== -1; });
    });
  }
  if (options.sortBy) {
    if (schema.indexOf(options.sortBy) === -1) throw new Error('Unknown sort field for ' + sheetName + ': ' + options.sortBy + '.');
    const direction = String(options.sortDirection || 'asc').toLowerCase() === 'desc' ? -1 : 1;
    records.sort(function(left, right) {
      const a = left[options.sortBy]; const b = right[options.sortBy];
      if (typeof a === 'number' && typeof b === 'number') return (a - b) * direction;
      return String(a === undefined ? '' : a).localeCompare(String(b === undefined ? '' : b)) * direction;
    });
  }
  return { records: records.slice(offset, offset + limit).map(mpPublicRecord_), total: records.length, offset: offset, limit: limit };
}

function mpDbGetById_(sheetName, id, includeArchived) {
  const idColumn = MP_SCHEMAS[sheetName][0];
  const found = mpRows_(sheetName).records.filter(function(record) { return record[idColumn] === id; })[0];
  return !found || (!includeArchived && found.IsArchived === true) ? null : mpPublicRecord_(found);
}

/** confirmDuplicate is an explicit review acknowledgement, never a stored field. */
function mpExtractDuplicateConfirmation_(input) {
  const copy = mpDeepClone_(input || {});
  const supplied = Object.prototype.hasOwnProperty.call(copy, 'confirmDuplicate');
  const confirmed = supplied ? copy.confirmDuplicate : false;
  delete copy.confirmDuplicate;
  if (supplied && confirmed !== true && confirmed !== false) throw new Error('confirmDuplicate must be a boolean value.');
  return { input: copy, confirmed: confirmed === true };
}

/** User emails are identities, so a duplicate can never be confirmed past. */
function mpAssertDuplicateReview_(sheetName, duplicates, confirmed) {
  if (!duplicates.length) return;
  let error;
  if (sheetName === 'Users') {
    error = new Error('An active user with this email address already exists. User emails must be unique.');
    error.code = 'DUPLICATE_USER';
  } else if (!confirmed) {
    error = new Error('Possible duplicate record found. Review the supplied matches and resubmit with confirmDuplicate: true only after review.');
    error.code = 'DUPLICATE';
  } else {
    return;
  }
  error.duplicates = duplicates;
  throw error;
}

function mpAssertVersion_(expectedVersion, action) {
  if (!Number.isInteger(Number(expectedVersion)) || Number(expectedVersion) < 1) throw new Error('expectedVersion is required to ' + action + ' a record.');
}

function mpDbInsert_(sheetName, input, actorId) {
  const duplicateReview = mpExtractDuplicateConfirmation_(input);
  mpAssertGenericOperationAllowed_(sheetName, 'create'); mpAssertNoSystemManagedInput_(sheetName, duplicateReview.input, 'Create');
  return mpWithLock_(function() {
    return mpInsertRecordLocked_(sheetName, duplicateReview.input, duplicateReview.confirmed, actorId, null);
  });
}

/** Caller must hold the lock. trustedFields are server-set values (e.g. CreatedFromLeadID). */
function mpInsertRecordLocked_(sheetName, input, confirmed, actorId, trustedFields) {
  const record = mpValidateRecord_(sheetName, input, true);
  if (sheetName === 'Transactions') record.RecordedBy = mpAssertEntityId_('Users', actorId, 'RecordedBy', true);
  if (sheetName === 'Documents') { record.UploadedBy = mpAssertEntityId_('Users', actorId, 'UploadedBy', true); record.UploadedAt = mpNowIso_(); }
  if (sheetName === 'Leads' && record.Status === 'CONVERTED') throw new Error('Use the lead conversion workflow to mark a lead CONVERTED.');
  Object.keys(trustedFields || {}).forEach(function(key) { record[key] = trustedFields[key]; });
  mpValidateReferences_(sheetName, record);
  const duplicates = mpFindDuplicates_(sheetName, record, '');
  mpAssertDuplicateReview_(sheetName, duplicates, confirmed);
  const sheet = mpSheet_(sheetName); const headers = mpHeaders_(sheet); const idColumn = MP_SCHEMAS[sheetName][0];
  record[idColumn] = mpNewId_(sheetName); mpApplyCreateDefaults_(sheetName, record, mpNowIso_()); mpAppendRecordChecked_(sheet, headers, record);
  try {
    if (sheetName === 'Transactions') mpSyncTransactionDependents_([record], actorId);
    mpLogActivity_(sheetName, record[idColumn], 'CREATED', 'Created ' + sheetName.slice(0, -1) + '.', actorId);
    if (duplicates.length) mpLogActivity_(sheetName, record[idColumn], 'DUPLICATE_REVIEW_CONFIRMED', 'Created after reviewing ' + duplicates.length + ' possible duplicate(s).', actorId);
  }
  catch (error) { throw new Error('Record was saved but a dependent write failed. Reconciliation is required: ' + error.message); }
  return mpPublicRecord_(record);
}

function mpDbUpdate_(sheetName, id, input, expectedVersion, actorId) {
  const duplicateReview = mpExtractDuplicateConfirmation_(input);
  mpAssertGenericOperationAllowed_(sheetName, 'update'); mpAssertNoSystemManagedInput_(sheetName, duplicateReview.input, 'Update');
  if (!Number.isInteger(Number(expectedVersion)) || Number(expectedVersion) < 1) throw new Error('expectedVersion is required to prevent overwriting another user\'s change.');
  const changes = duplicateReview.input;
  return mpWithLock_(function() {
    const result = mpRows_(sheetName); const idColumn = MP_SCHEMAS[sheetName][0]; const record = result.records.filter(function(item) { return item[idColumn] === id; })[0];
    if (!record || record.IsArchived === true) throw new Error('Record was not found or is archived.');
    if (Number(record.Version || 1) !== Number(expectedVersion)) throw new Error('This record was changed by another user. Reload it before saving.');
    if (sheetName === 'Cases' && changes.ClientID && changes.ClientID !== record.ClientID) mpAssertCaseClientChangeAllowed_(record.CaseID);
    if (sheetName === 'Leads') mpAssertLeadStatusChangeAllowed_(record, changes);
    if (sheetName === 'Users') mpAssertOwnerRetained_(record, changes);
    const prior = mpDeepClone_(record);
    delete prior._rowNumber;
    const candidateRecord = mpDeepClone_(prior);
    // Changing only IsPaid re-derives PaymentStatus instead of conflicting with the stored one.
    if (sheetName === 'Consultations' && mpHas_(changes, 'IsPaid') && !mpHas_(changes, 'PaymentStatus')) candidateRecord.PaymentStatus = '';
    const validated = mpValidateRecord_(sheetName, Object.assign(candidateRecord, changes), false);
    Object.keys(validated).forEach(function(key) { if (key !== idColumn) record[key] = validated[key]; });
    mpValidateReferences_(sheetName, record);
    const duplicates = mpFindDuplicates_(sheetName, record, id);
    mpAssertDuplicateReview_(sheetName, duplicates, duplicateReview.confirmed);
    mpApplyUpdateDefaults_(sheetName, record); record.Version = Number(record.Version || 1) + 1; mpWriteRecordChecked_(result.sheet, result.headers, record._rowNumber, record);
    try {
      if (sheetName === 'Transactions') mpSyncTransactionDependents_([prior, record], actorId);
      mpLogActivity_(sheetName, id, 'UPDATED', 'Updated ' + sheetName.slice(0, -1) + '.', actorId);
      if (duplicates.length) mpLogActivity_(sheetName, id, 'DUPLICATE_REVIEW_CONFIRMED', 'Updated after reviewing ' + duplicates.length + ' possible duplicate(s).', actorId);
    }
    catch (error) { throw new Error('Record was saved but a dependent write failed. Reconciliation is required: ' + error.message); }
    return mpPublicRecord_(record);
  });
}

function mpDbArchive_(sheetName, id, expectedVersion, actorId) {
  mpAssertGenericOperationAllowed_(sheetName, 'archive');
  if (MP_SCHEMAS[sheetName].indexOf('IsArchived') === -1) throw new Error(sheetName + ' cannot be archived.');
  mpAssertVersion_(expectedVersion, 'archive');
  return mpWithLock_(function() {
    const result = mpRows_(sheetName); const idColumn = MP_SCHEMAS[sheetName][0]; const record = result.records.filter(function(item) { return item[idColumn] === id; })[0];
    if (!record || record.IsArchived === true) throw new Error('Record was not found or is already archived.');
    if (Number(record.Version || 1) !== Number(expectedVersion)) throw new Error('This record was changed by another user. Reload it before archiving.');
    mpAssertNoActiveChildrenBeforeArchive_(sheetName, id);
    if (sheetName === 'Users') mpAssertOwnerRetained_(record, { IsArchived: true });
    record.IsArchived = true; record.ArchivedAt = mpNowIso_(); record.Version = Number(record.Version || 1) + 1; mpWriteRecordChecked_(result.sheet, result.headers, record._rowNumber, record);
    try { if (sheetName === 'Transactions') mpSyncTransactionDependents_([record], actorId); mpLogActivity_(sheetName, id, 'ARCHIVED', 'Archived ' + sheetName.slice(0, -1) + '.', actorId); }
    catch (error) { throw new Error('Record was archived but a dependent write failed. Reconciliation is required: ' + error.message); }
    return mpPublicRecord_(record);
  });
}

function mpAssertLeadStatusChangeAllowed_(lead, changes) {
  if (!mpHas_(changes, 'Status')) return;
  const next = String(changes.Status || '').trim().toUpperCase();
  if (lead.Status === 'CONVERTED' && next !== 'CONVERTED') throw new Error('A converted lead cannot change status.');
  if (lead.Status !== 'CONVERTED' && next === 'CONVERTED') throw new Error('Use the lead conversion workflow to mark a lead CONVERTED.');
}

/** The system must always keep at least one active, unarchived OWNER. */
function mpAssertOwnerRetained_(user, changes) {
  const isActiveOwner = user.Role === 'OWNER' && user.Status === 'ACTIVE' && user.IsArchived !== true;
  if (!isActiveOwner) return;
  const next = Object.assign({}, user, changes);
  if (String(next.Role || '').trim().toUpperCase() === 'OWNER' && String(next.Status || '').trim().toUpperCase() === 'ACTIVE' && next.IsArchived !== true) return;
  const others = mpRows_('Users').records.filter(function(other) {
    return other.UserID !== user.UserID && other.Role === 'OWNER' && other.Status === 'ACTIVE' && other.IsArchived !== true;
  });
  if (!others.length) throw new Error('At least one active OWNER must remain. Add another owner before demoting, deactivating, or archiving this one.');
}

function mpApplyLifecycleFields_(sheetName, record, now) {
  if (sheetName === 'Cases') {
    const closed = MP_CONFIG.CLOSED_CASE_STATUSES.indexOf(record.Status) !== -1;
    if (closed && mpIsBlank_(record.ClosedAt)) record.ClosedAt = now;
    if (!closed) record.ClosedAt = '';
  }
  if (sheetName === 'FollowUps') {
    const completed = record.Status === 'COMPLETED';
    if (completed && mpIsBlank_(record.CompletedAt)) record.CompletedAt = now;
    if (!completed) record.CompletedAt = '';
  }
}

function mpApplyCreateDefaults_(sheetName, record, now) {
  if (MP_SCHEMAS[sheetName].indexOf('IsArchived') !== -1) { record.IsArchived = false; record.ArchivedAt = ''; record.Version = 1; }
  if (MP_SCHEMAS[sheetName].indexOf('CreatedAt') !== -1) record.CreatedAt = now;
  if (MP_SCHEMAS[sheetName].indexOf('UpdatedAt') !== -1) record.UpdatedAt = now;
  if (sheetName === 'Cases') { record.TotalPaid = 0; record.OutstandingBalance = Number(record.AgreedFee || 0); }
  mpApplyLifecycleFields_(sheetName, record, now);
}

function mpApplyUpdateDefaults_(sheetName, record) {
  const now = mpNowIso_();
  if (MP_SCHEMAS[sheetName].indexOf('UpdatedAt') !== -1) record.UpdatedAt = now;
  if (sheetName === 'Cases') mpRefreshCaseFinancials_(record);
  if (sheetName === 'Consultations') mpDeriveConsultationPayment_(record, mpRows_('Transactions').records, false);
  mpApplyLifecycleFields_(sheetName, record, now);
}

function mpRefreshCaseFinancials_(caseRecord, transactions) {
  const rows = transactions || mpRows_('Transactions').records;
  const paid = rows.filter(function(transaction) { return transaction.IsArchived !== true && transaction.CaseID === caseRecord.CaseID && transaction.Type === 'INCOME'; }).reduce(function(sum, transaction) { return sum + Number(transaction.Amount || 0); }, 0);
  caseRecord.TotalPaid = paid; caseRecord.OutstandingBalance = Number(caseRecord.AgreedFee || 0) - paid;
}

/**
 * Derives PaymentStatus from active INCOME transactions linked to the
 * consultation. WAIVED is a deliberate decision and is never overridden.
 * Without force, a consultation with no linked income keeps its manual status.
 */
function mpDeriveConsultationPayment_(consultation, transactions, force) {
  if (consultation.PaymentStatus === 'WAIVED') { consultation.IsPaid = false; return; }
  const income = transactions.filter(function(transaction) { return transaction.IsArchived !== true && transaction.ConsultationID === consultation.ConsultationID && transaction.Type === 'INCOME'; });
  if (!income.length && !force) return;
  const paid = income.reduce(function(sum, transaction) { return sum + Number(transaction.Amount || 0); }, 0);
  const fee = Number(consultation.Fee || 0);
  consultation.PaymentStatus = paid <= 0 ? 'UNPAID' : (fee > 0 && paid < fee ? 'PARTIALLY_PAID' : 'PAID');
  consultation.IsPaid = consultation.PaymentStatus === 'PAID';
}

function mpHasActiveReference_(sheetName, fieldName, value, optionalEntityType, predicate) {
  return mpRows_(sheetName).records.some(function(record) {
    return record.IsArchived !== true && record[fieldName] === value && (!optionalEntityType || record.EntityType === optionalEntityType) && (!predicate || predicate(record));
  });
}

function mpAssertCaseClientChangeAllowed_(caseId) {
  if (mpHasActiveReference_('Transactions', 'CaseID', caseId)) throw new Error('Cases.ClientID cannot change while active transactions exist. Archive or correct those transactions first.');
}

/** Open work only: a user's completed history never blocks archiving them. */
const MP_OPEN_WORK_ = Object.freeze({
  Leads: function(record) { return ['CONVERTED', 'LOST', 'NOT_QUALIFIED'].indexOf(record.Status) === -1; },
  Cases: function(record) { return MP_CONFIG.CLOSED_CASE_STATUSES.indexOf(record.Status) === -1; },
  Consultations: function(record) { return record.Status === 'SCHEDULED'; },
  FollowUps: function(record) { return record.Status === 'OPEN'; }
});

function mpAssertNoActiveChildrenBeforeArchive_(sheetName, id) {
  const relationships = {
    Users: [['Leads', 'AssignedTo', null, MP_OPEN_WORK_.Leads], ['Cases', 'AssignedLawyer', null, MP_OPEN_WORK_.Cases], ['Consultations', 'AssignedLawyer', null, MP_OPEN_WORK_.Consultations], ['FollowUps', 'AssignedTo', null, MP_OPEN_WORK_.FollowUps]],
    Leads: [['Consultations', 'LeadID'], ['FollowUps', 'LeadID'], ['Documents', 'EntityID', 'LEAD']],
    Companies: [['Clients', 'CompanyID'], ['Leads', 'CompanyID']],
    Clients: [['Cases', 'ClientID'], ['Consultations', 'ClientID'], ['Transactions', 'ClientID'], ['FollowUps', 'ClientID'], ['Documents', 'EntityID', 'CLIENT']],
    Cases: [['Transactions', 'CaseID'], ['FollowUps', 'CaseID'], ['Documents', 'EntityID', 'CASE']],
    Consultations: [['Transactions', 'ConsultationID']]
  }[sheetName] || [];
  const activeChild = relationships.filter(function(relationship) { return mpHasActiveReference_(relationship[0], relationship[1], id, relationship[2], relationship[3]); })[0];
  if (!activeChild) return;
  if (sheetName === 'Users') throw new Error('User cannot be archived while open ' + activeChild[0] + ' are assigned to them. Reassign or close that work first.');
  throw new Error(sheetName.slice(0, -1) + ' cannot be archived while active ' + activeChild[0] + ' records reference it.');
}

function mpSyncTransactionDependents_(transactions, actorId) {
  mpRecalculateAffectedCases_(transactions.map(function(transaction) { return transaction.CaseID; }), actorId);
  mpRecalculateAffectedConsultations_(transactions.map(function(transaction) { return transaction.ConsultationID; }), actorId);
}

function mpUniqueIds_(ids) { return ids.filter(function(id, index, all) { return !!id && all.indexOf(id) === index; }); }

function mpRecalculateAffectedCases_(caseIds, actorId) {
  const ids = mpUniqueIds_(caseIds);
  if (!ids.length) return;
  const caseRows = mpRows_('Cases'); const transactions = mpRows_('Transactions').records;
  ids.forEach(function(caseId) {
    const record = caseRows.records.filter(function(item) { return item.CaseID === caseId && item.IsArchived !== true; })[0];
    if (!record) return;
    mpRefreshCaseFinancials_(record, transactions); record.UpdatedAt = mpNowIso_(); record.Version = Number(record.Version || 1) + 1;
    mpWriteRecordChecked_(caseRows.sheet, caseRows.headers, record._rowNumber, record);
    mpLogActivity_('Cases', caseId, 'FINANCIALS_RECALCULATED', 'Recalculated paid amount and outstanding balance.', actorId);
  });
}

function mpRecalculateAffectedConsultations_(consultationIds, actorId) {
  const ids = mpUniqueIds_(consultationIds);
  if (!ids.length) return;
  const rows = mpRows_('Consultations'); const transactions = mpRows_('Transactions').records;
  ids.forEach(function(consultationId) {
    const record = rows.records.filter(function(item) { return item.ConsultationID === consultationId && item.IsArchived !== true; })[0];
    if (!record) return;
    const before = record.PaymentStatus + '|' + String(record.IsPaid);
    mpDeriveConsultationPayment_(record, transactions, true);
    if (before === record.PaymentStatus + '|' + String(record.IsPaid)) return;
    record.Version = Number(record.Version || 1) + 1;
    mpWriteRecordChecked_(rows.sheet, rows.headers, record._rowNumber, record);
    mpLogActivity_('Consultations', consultationId, 'PAYMENT_STATUS_RECALCULATED', 'Payment status set to ' + record.PaymentStatus + ' from linked transactions.', actorId);
  });
}

/**
 * Converts a lead into a client in one locked workflow: creates the client
 * (CreatedFromLeadID set by the server), marks the lead CONVERTED, and links
 * the lead's unlinked consultations and follow-ups to the new client.
 * clientInput may override or add client fields; confirmDuplicate applies to
 * the client duplicate check.
 */
function mpConvertLead_(leadId, expectedVersion, clientInput, actorId) {
  const review = mpExtractDuplicateConfirmation_(clientInput || {});
  mpAssertNoSystemManagedInput_('Clients', review.input, 'Lead conversion');
  mpAssertVersion_(expectedVersion, 'convert');
  return mpWithLock_(function() {
    const leads = mpRows_('Leads');
    const lead = leads.records.filter(function(item) { return item.LeadID === leadId; })[0];
    if (!lead || lead.IsArchived === true) throw new Error('Lead was not found or is archived.');
    if (Number(lead.Version || 1) !== Number(expectedVersion)) throw new Error('This lead was changed by another user. Reload it before converting.');
    if (lead.Status === 'CONVERTED' || !mpIsBlank_(lead.ConvertedClientID)) throw new Error('This lead has already been converted.');
    if (['LOST', 'NOT_QUALIFIED'].indexOf(lead.Status) !== -1) throw new Error('Reopen a ' + lead.Status + ' lead before converting it.');
    const draft = { ClientType: lead.ClientType || 'INDIVIDUAL', FullName: lead.FullName, CompanyID: lead.CompanyID, Phone: lead.Phone, Email: lead.Email, Notes: lead.Description, AssignedTo: lead.AssignedTo };
    Object.keys(draft).forEach(function(key) { if (mpIsBlank_(draft[key])) delete draft[key]; });
    Object.keys(review.input).forEach(function(key) { draft[key] = review.input[key]; });
    const client = mpInsertRecordLocked_('Clients', draft, review.confirmed, actorId, { CreatedFromLeadID: lead.LeadID });
    const relinked = { consultations: 0, followUps: 0 };
    try {
      lead.Status = 'CONVERTED'; lead.ConvertedClientID = client.ClientID; lead.UpdatedAt = mpNowIso_(); lead.Version = Number(lead.Version || 1) + 1;
      mpWriteRecordChecked_(leads.sheet, leads.headers, lead._rowNumber, lead);
      mpLogActivity_('Leads', lead.LeadID, 'CONVERTED', 'Converted to client ' + client.ClientID + '.', actorId);
      [['Consultations', 'consultations'], ['FollowUps', 'followUps']].forEach(function(pair) {
        const rows = mpRows_(pair[0]); const idColumn = MP_SCHEMAS[pair[0]][0];
        rows.records.forEach(function(record) {
          if (record.IsArchived === true || record.LeadID !== lead.LeadID || !mpIsBlank_(record.ClientID)) return;
          record.ClientID = client.ClientID; record.Version = Number(record.Version || 1) + 1;
          mpWriteRecordChecked_(rows.sheet, rows.headers, record._rowNumber, record);
          mpLogActivity_(pair[0], record[idColumn], 'LINKED_TO_CLIENT', 'Linked to client ' + client.ClientID + ' on lead conversion.', actorId);
          relinked[pair[1]] += 1;
        });
      });
      // The lead's extra team members follow it to the new client.
      mpActiveAssignments_().filter(function(row) { return row.EntityType === 'Leads' && row.EntityID === lead.LeadID; })
        .forEach(function(row) { mpAddAssignment_('Clients', client.ClientID, row.UserID, actorId); });
    } catch (error) {
      throw new Error('Client ' + client.ClientID + ' was created but the lead update failed. Reconciliation is required: ' + error.message);
    }
    return { lead: mpPublicRecord_(lead), client: client, relinked: relinked };
  });
}

/** Parsed settings map; unknown or unparsable rows are skipped. */
function mpGetSettings_() {
  const settings = {};
  mpRows_('Settings').records.forEach(function(record) {
    try { settings[record.SettingKey] = mpParseSettingValue_(record.SettingValue); } catch (error) { /* reported by compatibility checks */ }
  });
  return settings;
}

function mpGetSettingValue_(key) {
  const value = mpGetSettings_()[key];
  return value === undefined ? MP_DEFAULT_SETTINGS[key] : value;
}

function mpListSettings_() {
  return mpRows_('Settings').records.map(function(record) {
    let value;
    try { value = mpParseSettingValue_(record.SettingValue); } catch (error) { value = null; }
    return { key: record.SettingKey, value: value, editable: MP_EDITABLE_SETTINGS.indexOf(record.SettingKey) !== -1, updatedAt: record.UpdatedAt, updatedBy: record.UpdatedBy, version: Number(record.Version || 1) };
  });
}

function mpValidateSettingValue_(key, value) {
  switch (key) {
    case 'BUSINESS_NAME':
      return mpRequiredText_(value, 'BUSINESS_NAME', 200);
    case 'PRACTICE_AREAS': {
      if (!Array.isArray(value) || !value.length) throw new Error('PRACTICE_AREAS must be a non-empty list.');
      const areas = value.map(function(area) {
        const normalized = String(area || '').trim().toUpperCase();
        if (!/^[A-Z0-9_]{1,50}$/.test(normalized)) throw new Error('Practice areas must use letters, digits, or underscores (max 50).');
        return normalized;
      });
      if (areas.some(function(area, index) { return areas.indexOf(area) !== index; })) throw new Error('PRACTICE_AREAS contains duplicates.');
      ['Leads', 'Cases'].forEach(function(sheetName) {
        const inUse = mpRows_(sheetName).records.filter(function(record) { return record.IsArchived !== true && !mpIsBlank_(record.PracticeArea) && areas.indexOf(record.PracticeArea) === -1; })[0];
        if (inUse) throw new Error('Practice area ' + inUse.PracticeArea + ' is still used by active ' + sheetName + ' and cannot be removed.');
      });
      return areas;
    }
    case 'NOTIFICATION_PREFERENCES': {
      const expected = Object.keys(MP_DEFAULT_SETTINGS.NOTIFICATION_PREFERENCES);
      if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('NOTIFICATION_PREFERENCES must be an object.');
      const keys = Object.keys(value);
      if (keys.length !== expected.length || keys.some(function(item) { return expected.indexOf(item) === -1 || typeof value[item] !== 'boolean'; })) throw new Error('NOTIFICATION_PREFERENCES must contain exactly ' + expected.join(', ') + ' as true/false values.');
      const normalized = {};
      expected.forEach(function(item) { normalized[item] = value[item]; });
      return normalized;
    }
    case 'FUTURE_INTEGRATIONS_ENABLED':
      if (typeof value !== 'boolean') throw new Error('FUTURE_INTEGRATIONS_ENABLED must be true or false.');
      return value;
    default:
      throw new Error('Setting ' + key + ' cannot be changed at runtime.');
  }
}

function mpUpdateSetting_(key, value, expectedVersion, actorId) {
  if (MP_EDITABLE_SETTINGS.indexOf(key) === -1) throw new Error('Setting ' + key + ' cannot be changed at runtime.');
  mpAssertVersion_(expectedVersion, 'update');
  return mpWithLock_(function() {
    const normalized = mpValidateSettingValue_(key, value);
    const rows = mpRows_('Settings');
    const record = rows.records.filter(function(item) { return item.SettingKey === key; })[0];
    if (!record) throw new Error('Setting ' + key + ' is missing. Run setupDatabase().');
    if (Number(record.Version || 1) !== Number(expectedVersion)) throw new Error('This setting was changed by another user. Reload it before saving.');
    record.SettingValue = JSON.stringify(normalized); record.UpdatedAt = mpNowIso_(); record.UpdatedBy = actorId; record.Version = Number(record.Version || 1) + 1;
    mpWriteRecordChecked_(rows.sheet, rows.headers, record._rowNumber, record);
    mpLogActivity_('Settings', key, 'UPDATED', 'Updated setting ' + key + '.', actorId);
    return { key: key, value: normalized, version: record.Version };
  });
}

function mpSeedSettings_(spreadsheet) {
  const sheet = spreadsheet.getSheetByName('Settings'); const headers = mpHeaders_(sheet);
  const existing = sheet.getLastRow() < 2 ? [] : sheet.getRange(2, 1, sheet.getLastRow() - 1, headers.length).getValues();
  const known = {}; existing.forEach(function(row) { if (row[0]) known[row[0]] = row[1]; });
  const rows = [];
  Object.keys(MP_DEFAULT_SETTINGS).forEach(function(key) { if (known[key] === undefined) rows.push([key, JSON.stringify(MP_DEFAULT_SETTINGS[key]), mpNowIso_(), 'SYSTEM', 1]); });
  if (rows.length) { sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, headers.length).setValues(rows); mpInvalidateRows_('Settings'); }
  return { added: rows.map(function(row) { return row[0]; }) };
}

function mpBootstrapOwner_(spreadsheet) {
  const email = PropertiesService.getScriptProperties().getProperty(MP_CONFIG.INITIAL_OWNER_PROPERTY); const users = spreadsheet.getSheetByName('Users');
  if (!email || users.getLastRow() > 1) return { provisioned: false };
  const now = mpNowIso_(); const record = { UserID: mpNewId_('Users'), FullName: email, Email: email, Role: 'OWNER', Status: 'ACTIVE', Language: 'EN', CreatedAt: now, LastLogin: '', IsArchived: false, ArchivedAt: '', Version: 1 };
  mpAppendRecordChecked_(users, mpHeaders_(users), record);
  mpAppendActivityToSheet_(spreadsheet.getSheetByName('Activities'), 'Users', record.UserID, 'CREATED', 'Initial owner provisioned.', 'SYSTEM');
  return { provisioned: true };
}

/** Full-sheet batch read prevents the old 100-record duplicate blind spot. */
function mpFindDuplicates_(sheetName, input, excludeId) {
  if (['Users', 'Leads', 'Clients', 'Companies'].indexOf(sheetName) === -1) return [];
  const phone = mpNormalizePhone_(input.Phone); const email = mpNormalizeEmail_(input.Email); const registration = String(input.CommercialRegistrationNumber || '').trim().toLowerCase(); const taxNumber = String(input.TaxNumber || '').trim().toLowerCase();
  if (!phone && !email && !registration && !taxNumber) return [];
  const idColumn = MP_SCHEMAS[sheetName][0];
  return mpRows_(sheetName).records.filter(function(record) {
    if (record.IsArchived === true || record[idColumn] === excludeId) return false;
    return (phone && mpNormalizePhone_(record.Phone) === phone) || (email && mpNormalizeEmail_(record.Email) === email) || (registration && String(record.CommercialRegistrationNumber || '').trim().toLowerCase() === registration) || (taxNumber && String(record.TaxNumber || '').trim().toLowerCase() === taxNumber);
  }).map(function(record) { return { id: record[idColumn], fullName: record.FullName || record.CompanyName, phone: record.Phone || '', email: record.Email || '' }; });
}
