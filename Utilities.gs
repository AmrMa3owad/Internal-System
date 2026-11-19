function mpNowIso_() {
  return Utilities.formatDate(new Date(), MP_CONFIG.DATE_TIMEZONE, "yyyy-MM-dd'T'HH:mm:ssXXX");
}

function mpDateIso_(value, fieldName, required) {
  if (mpIsBlank_(value)) {
    if (required) throw new Error(fieldName + ' is required.');
    return '';
  }
  const date = value instanceof Date ? value : new Date(String(value));
  if (isNaN(date.getTime())) throw new Error(fieldName + ' must be a valid ISO-compatible date.');
  return Utilities.formatDate(date, MP_CONFIG.DATE_TIMEZONE, "yyyy-MM-dd'T'HH:mm:ssXXX");
}

function mpNewId_(sheetName) {
  const prefix = MP_CONFIG.ENTITY_ID_PREFIXES[sheetName];
  if (!prefix) throw new Error('No ID prefix is configured for ' + sheetName + '.');
  return prefix + '-' + Utilities.getUuid().replace(/-/g, '').toUpperCase();
}

function mpIsBlank_(value) {
  return value === null || value === undefined || String(value).trim() === '';
}

function mpCleanText_(value, maxLength) {
  if (value === null || value === undefined) return '';
  const text = String(value).trim();
  if (text.length > (maxLength || MP_CONFIG.MAX_TEXT_LENGTH)) throw new Error('Text exceeds the allowed length.');
  // A leading apostrophe stores spreadsheet formula-looking text literally.
  return /^[=+\-@]/.test(text) ? "'" + text : text;
}

function mpPlainText_(value) {
  const text = String(value || '');
  return text.charAt(0) === "'" && /^[=+\-@]/.test(text.substring(1)) ? text.substring(1) : text;
}

function mpNormalizeEmail_(email) {
  return mpIsBlank_(email) ? '' : String(email).trim().toLowerCase();
}

function mpNormalizePhone_(phone) {
  return mpIsBlank_(phone) ? '' : String(phone).replace(/[^0-9]/g, '');
}

function mpToNumber_(value, fieldName, required) {
  if (mpIsBlank_(value)) {
    if (required) throw new Error(fieldName + ' is required.');
    return '';
  }
  const number = Number(value);
  if (!isFinite(number)) throw new Error(fieldName + ' must be a valid number.');
  return number;
}

function mpAssertEnum_(value, allowed, fieldName, required) {
  if (mpIsBlank_(value)) {
    if (required) throw new Error(fieldName + ' is required.');
    return '';
  }
  const normalized = String(value).trim().toUpperCase();
  if (allowed.indexOf(normalized) === -1) throw new Error(fieldName + ' has an invalid value.');
  return normalized;
}

function mpSuccess_(data) { return { ok: true, data: data === undefined ? null : data }; }
function mpFailure_(error) {
  return { ok: false, error: { message: error && error.message ? error.message : String(error) } };
}

function mpDeepClone_(value) { return JSON.parse(JSON.stringify(value)); }
