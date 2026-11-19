/**
 * Data access service. Only server-side module code may call these underscore
 * functions. Stage 2 API wrappers will authorize the current user before use.
 */
function mpGetDatabase_() {
  const id = PropertiesService.getScriptProperties().getProperty(MP_CONFIG.DATABASE_ID_PROPERTY);
  if (!id) throw new Error('Database is not initialized. Run setupDatabase() from the Apps Script editor.');
  return SpreadsheetApp.openById(id);
}

function mpSetupDatabase_() {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const properties = PropertiesService.getScriptProperties();
    let spreadsheetId = properties.getProperty(MP_CONFIG.DATABASE_ID_PROPERTY);
    let spreadsheet;
    if (spreadsheetId) {
      spreadsheet = SpreadsheetApp.openById(spreadsheetId);
    } else {
      spreadsheet = SpreadsheetApp.create(MP_CONFIG.DATABASE_NAME);
      spreadsheetId = spreadsheet.getId();
      properties.setProperty(MP_CONFIG.DATABASE_ID_PROPERTY, spreadsheetId);
    }
    Object.keys(MP_SCHEMAS).forEach(function(name) { mpEnsureSheet_(spreadsheet, name, MP_SCHEMAS[name]); });
    mpSeedSettings_();
    mpBootstrapOwner_();
    return { spreadsheetName: spreadsheet.getName(), sheetNames: Object.keys(MP_SCHEMAS), ownerProvisioned: !!properties.getProperty(MP_CONFIG.INITIAL_OWNER_PROPERTY) };
  } finally { lock.releaseLock(); }
}

function mpEnsureSheet_(spreadsheet, name, requiredHeaders) {
  let sheet = spreadsheet.getSheetByName(name);
  if (!sheet) sheet = spreadsheet.insertSheet(name);
  const lastColumn = Math.max(sheet.getLastColumn(), requiredHeaders.length);
  const existing = lastColumn && sheet.getLastRow() ? sheet.getRange(1, 1, 1, lastColumn).getValues()[0] : [];
  const headers = existing.filter(String);
  requiredHeaders.forEach(function(header) { if (headers.indexOf(header) === -1) headers.push(header); });
  sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  sheet.setFrozenRows(1);
  sheet.getRange(1, 1, 1, headers.length)
    .setFontWeight('bold').setFontColor('#ffffff').setBackground('#102a43').setHorizontalAlignment('center');
  sheet.setRowHeight(1, 28);
  if (sheet.getFilter()) sheet.getFilter().remove();
  sheet.getRange(1, 1, Math.max(sheet.getLastRow(), 2), headers.length).createFilter();
  sheet.autoResizeColumns(1, headers.length);
  sheet.setColumnWidths(1, headers.length, 140);
  mpApplySheetValidation_(sheet, headers);
  return sheet;
}

/** Convenience dropdowns for direct sheet administrators. Server-side
 * validation remains authoritative because a sheet editor can bypass a rule. */
function mpApplySheetValidation_(sheet, headers) {
  const validations = {
    Users: { Role: MP_CONFIG.ROLES, Status: MP_CONFIG.USER_STATUSES },
    Leads: { ClientType: MP_CONFIG.CLIENT_TYPES, Source: MP_CONFIG.LEAD_SOURCES, Priority: MP_CONFIG.PRIORITIES, Status: MP_CONFIG.LEAD_STATUSES },
    Clients: { ClientType: MP_CONFIG.CLIENT_TYPES },
    Cases: { Priority: MP_CONFIG.PRIORITIES, Status: MP_CONFIG.CASE_STATUSES },
    Consultations: { PaymentStatus: MP_CONFIG.PAYMENT_STATUSES, Status: MP_CONFIG.CONSULTATION_STATUSES },
    Transactions: { Type: MP_CONFIG.TRANSACTION_TYPES, PaymentMethod: MP_CONFIG.PAYMENT_METHODS },
    FollowUps: { Priority: MP_CONFIG.PRIORITIES, Status: MP_CONFIG.FOLLOW_UP_STATUSES },
    Documents: { ConfidentialityLevel: MP_CONFIG.CONFIDENTIALITY_LEVELS }
  }[sheet.getName()] || {};
  Object.keys(validations).forEach(function(header) {
    const column = headers.indexOf(header) + 1;
    if (!column) return;
    const rule = SpreadsheetApp.newDataValidation().requireValueInList(validations[header], true).setAllowInvalid(false).build();
    sheet.getRange(2, column, Math.max(sheet.getMaxRows() - 1, 1), 1).setDataValidation(rule);
  });
}

function mpSheet_(sheetName) {
  if (!MP_SCHEMAS[sheetName]) throw new Error('Unknown entity: ' + sheetName + '.');
  const sheet = mpGetDatabase_().getSheetByName(sheetName);
  if (!sheet) throw new Error('Missing database sheet: ' + sheetName + '. Run setupDatabase().');
  return sheet;
}

function mpHeaders_(sheet) {
  const count = sheet.getLastColumn();
  if (!count) throw new Error('Missing headers in ' + sheet.getName() + '.');
  return sheet.getRange(1, 1, 1, count).getDisplayValues()[0];
}

function mpRows_(sheetName) {
  const sheet = mpSheet_(sheetName);
  const headers = mpHeaders_(sheet);
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return { sheet: sheet, headers: headers, records: [] };
  const values = sheet.getRange(2, 1, lastRow - 1, headers.length).getValues();
  const records = values.map(function(row, index) {
    if (!row.some(function(value) { return value !== ''; })) return null;
    const record = {};
    headers.forEach(function(header, column) {
      const value = row[column];
      record[header] = value instanceof Date ? mpDateIso_(value, header, false) : value;
    });
    record._rowNumber = index + 2; // Transient locator only; never returned by public services.
    return record;
  }).filter(function(record) { return record !== null; });
  return { sheet: sheet, headers: headers, records: records };
}

function mpRecordValues_(headers, record) {
  return headers.map(function(header) {
    const value = record[header];
    if (value === undefined || value === null) return '';
    return typeof value === 'string' ? mpCleanText_(value) : value;
  });
}

function mpPublicRecord_(record) {
  const clone = mpDeepClone_(record);
  delete clone._rowNumber;
  Object.keys(clone).forEach(function(key) { if (typeof clone[key] === 'string') clone[key] = mpPlainText_(clone[key]); });
  return clone;
}

function mpDbList_(sheetName, options) {
  options = options || {};
  const result = mpRows_(sheetName);
  const includeArchived = options.includeArchived === true;
  const requestedLimit = Number(options.limit || MP_CONFIG.PAGE_SIZE);
  const limit = Math.min(Math.max(requestedLimit, 1), MP_CONFIG.MAX_PAGE_SIZE);
  const offset = Math.max(Number(options.offset || 0), 0);
  let records = result.records.filter(function(record) { return includeArchived || record.IsArchived !== true; });
  if (options.query) {
    const needle = String(options.query).toLowerCase();
    records = records.filter(function(record) { return Object.keys(record).some(function(key) { return String(record[key] || '').toLowerCase().indexOf(needle) !== -1; }); });
  }
  const total = records.length;
  return { records: records.slice(offset, offset + limit).map(mpPublicRecord_), total: total, offset: offset, limit: limit };
}

function mpDbGetById_(sheetName, id, includeArchived) {
  const idColumn = MP_SCHEMAS[sheetName][0];
  const found = mpRows_(sheetName).records.filter(function(record) { return record[idColumn] === id; })[0];
  if (!found || (!includeArchived && found.IsArchived === true)) return null;
  return mpPublicRecord_(found);
}

function mpDbInsert_(sheetName, input, actorEmail) {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const record = mpValidateRecord_(sheetName, input, true);
    mpValidateReferences_(sheetName, record);
    const duplicates = mpFindDuplicates_(sheetName, record, '');
    if (duplicates.length) {
      const error = new Error('Possible duplicate record found. Review the supplied matches.');
      error.code = 'DUPLICATE'; error.duplicates = duplicates; throw error;
    }
    const sheet = mpSheet_(sheetName);
    const headers = mpHeaders_(sheet);
    const idColumn = MP_SCHEMAS[sheetName][0];
    record[idColumn] = mpNewId_(sheetName);
    const now = mpNowIso_();
    mpApplyCreateDefaults_(sheetName, record, now);
    sheet.getRange(sheet.getLastRow() + 1, 1, 1, headers.length).setValues([mpRecordValues_(headers, record)]);
    const publicRecord = mpPublicRecord_(record);
    if (sheetName !== 'Activities' && sheetName !== 'Settings') mpLogActivity_(sheetName, record[idColumn], 'CREATED', 'Created ' + sheetName.slice(0, -1) + '.', actorEmail);
    if (sheetName === 'Transactions' && record.CaseID) mpRecalculateCaseFinanceById_(record.CaseID, actorEmail);
    return publicRecord;
  } finally { lock.releaseLock(); }
}

function mpDbUpdate_(sheetName, id, input, expectedVersion, actorEmail) {
  if (!Number.isInteger(Number(expectedVersion)) || Number(expectedVersion) < 1) throw new Error('expectedVersion is required to prevent overwriting another user\'s change.');
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const result = mpRows_(sheetName);
    const idColumn = MP_SCHEMAS[sheetName][0];
    const record = result.records.filter(function(item) { return item[idColumn] === id; })[0];
    if (!record || record.IsArchived === true) throw new Error('Record was not found or is archived.');
    if (Number(record.Version || 1) !== Number(expectedVersion)) throw new Error('This record was changed by another user. Reload it before saving.');
    const previousCaseId = sheetName === 'Transactions' ? record.CaseID : '';
    const candidate = {};
    Object.keys(input || {}).forEach(function(key) { if (key !== idColumn && key !== 'Version' && key !== 'IsArchived' && key !== 'ArchivedAt') candidate[key] = input[key]; });
    const validated = mpValidateRecord_(sheetName, Object.assign({}, record, candidate), false);
    Object.keys(validated).forEach(function(key) { if (key !== idColumn) record[key] = validated[key]; });
    mpValidateReferences_(sheetName, record);
    const duplicates = mpFindDuplicates_(sheetName, record, id);
    if (duplicates.length) { const error = new Error('Possible duplicate record found. Review the supplied matches.'); error.code = 'DUPLICATE'; error.duplicates = duplicates; throw error; }
    mpApplyUpdateDefaults_(sheetName, record);
    record.Version = Number(record.Version || 1) + 1;
    result.sheet.getRange(record._rowNumber, 1, 1, result.headers.length).setValues([mpRecordValues_(result.headers, record)]);
    if (sheetName !== 'Activities' && sheetName !== 'Settings') mpLogActivity_(sheetName, id, 'UPDATED', 'Updated ' + sheetName.slice(0, -1) + '.', actorEmail);
    if (sheetName === 'Transactions') {
      if (previousCaseId) mpRecalculateCaseFinanceById_(previousCaseId, actorEmail);
      if (record.CaseID && record.CaseID !== previousCaseId) mpRecalculateCaseFinanceById_(record.CaseID, actorEmail);
    }
    return mpPublicRecord_(record);
  } finally { lock.releaseLock(); }
}

function mpDbArchive_(sheetName, id, expectedVersion, actorEmail) {
  if (MP_SCHEMAS[sheetName].indexOf('IsArchived') === -1) throw new Error(sheetName + ' cannot be archived.');
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const result = mpRows_(sheetName);
    const idColumn = MP_SCHEMAS[sheetName][0];
    const record = result.records.filter(function(item) { return item[idColumn] === id; })[0];
    if (!record || record.IsArchived === true) throw new Error('Record was not found or is already archived.');
    if (Number(record.Version || 1) !== Number(expectedVersion)) throw new Error('This record was changed by another user. Reload it before archiving.');
    record.IsArchived = true; record.ArchivedAt = mpNowIso_(); record.Version = Number(record.Version || 1) + 1;
    result.sheet.getRange(record._rowNumber, 1, 1, result.headers.length).setValues([mpRecordValues_(result.headers, record)]);
    mpLogActivity_(sheetName, id, 'ARCHIVED', 'Archived ' + sheetName.slice(0, -1) + '.', actorEmail);
    if (sheetName === 'Transactions' && record.CaseID) mpRecalculateCaseFinanceById_(record.CaseID, actorEmail);
    return mpPublicRecord_(record);
  } finally { lock.releaseLock(); }
}

function mpApplyCreateDefaults_(sheetName, record, now) {
  record.IsArchived = false; record.ArchivedAt = ''; record.Version = 1;
  if (MP_SCHEMAS[sheetName].indexOf('CreatedAt') !== -1) record.CreatedAt = record.CreatedAt || now;
  if (MP_SCHEMAS[sheetName].indexOf('UpdatedAt') !== -1) record.UpdatedAt = now;
  if (sheetName === 'Cases') { record.TotalPaid = 0; record.OutstandingBalance = Number(record.AgreedFee || 0); }
}

function mpApplyUpdateDefaults_(sheetName, record) {
  if (MP_SCHEMAS[sheetName].indexOf('UpdatedAt') !== -1) record.UpdatedAt = mpNowIso_();
  if (sheetName === 'Cases') mpRefreshCaseFinancials_(record);
}

function mpRefreshCaseFinancials_(caseRecord) {
  const transactions = mpRows_('Transactions').records.filter(function(transaction) { return transaction.IsArchived !== true; });
  const paid = transactions.filter(function(transaction) { return transaction.CaseID === caseRecord.CaseID && transaction.Type === 'INCOME'; })
    .reduce(function(sum, transaction) { return sum + Number(transaction.Amount || 0); }, 0);
  caseRecord.TotalPaid = paid;
  caseRecord.OutstandingBalance = Math.max(0, Number(caseRecord.AgreedFee || 0) - paid);
}

/** Called only while the outer transaction mutation holds the script lock. */
function mpRecalculateCaseFinanceById_(caseId, actorEmail) {
  const result = mpRows_('Cases');
  const record = result.records.filter(function(item) { return item.CaseID === caseId && item.IsArchived !== true; })[0];
  if (!record) return;
  mpRefreshCaseFinancials_(record);
  record.UpdatedAt = mpNowIso_();
  record.Version = Number(record.Version || 1) + 1;
  result.sheet.getRange(record._rowNumber, 1, 1, result.headers.length).setValues([mpRecordValues_(result.headers, record)]);
  mpLogActivity_('Cases', caseId, 'FINANCIALS_RECALCULATED', 'Recalculated paid amount and outstanding balance.', actorEmail);
}

function mpSeedSettings_() {
  const existing = mpRows_('Settings');
  const keys = {};
  existing.records.forEach(function(record) { keys[record.SettingKey] = true; });
  const sheet = existing.sheet;
  const rows = [];
  Object.keys(MP_DEFAULT_SETTINGS).forEach(function(key) {
    if (!keys[key]) rows.push([key, JSON.stringify(MP_DEFAULT_SETTINGS[key]), mpNowIso_(), 'SYSTEM', 1]);
  });
  if (rows.length) sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, MP_SCHEMAS.Settings.length).setValues(rows);
}

function mpBootstrapOwner_() {
  const email = PropertiesService.getScriptProperties().getProperty(MP_CONFIG.INITIAL_OWNER_PROPERTY);
  if (!email || mpDbList_('Users', { includeArchived: false, limit: 1 }).total) return;
  // Called while setup owns the script lock, so do not call mpDbInsert_ here.
  const sheet = mpSheet_('Users');
  const headers = mpHeaders_(sheet);
  const now = mpNowIso_();
  const record = { UserID: mpNewId_('Users'), FullName: email, Email: email, Role: 'OWNER', Status: 'ACTIVE', CreatedAt: now, LastLogin: '', IsArchived: false, ArchivedAt: '', Version: 1 };
  sheet.getRange(sheet.getLastRow() + 1, 1, 1, headers.length).setValues([mpRecordValues_(headers, record)]);
  mpLogActivity_('Users', record.UserID, 'CREATED', 'Initial owner provisioned.', 'SYSTEM');
}
