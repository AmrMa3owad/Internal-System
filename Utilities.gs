function mpNowIso_() {
  return Utilities.formatDate(new Date(), MP_CONFIG.DATE_TIMEZONE, "yyyy-MM-dd'T'HH:mm:ssXXX");
}

function mpDateIso_(value, fieldName, required) {
  if (mpIsBlank_(value)) {
    if (required) throw new Error(fieldName + ' is required.');
    return '';
  }
  let date;
  if (value instanceof Date) {
    date = value;
  } else {
    const text = String(value).trim();
    // Accept ISO date or ISO timestamp only. Reject locale-dependent strings
    // and invalid calendar dates such as 2026-02-30 instead of normalizing them.
    // Without an explicit offset the value is wall-clock time in the script
    // time zone (appsscript.json: Africa/Cairo), which is what forms submit.
    const match = text.match(/^(\d{4})-(\d{2})-(\d{2})(?:T([01]\d|2[0-3]):([0-5]\d)(?::([0-5]\d)(?:\.\d{1,3})?)?(Z|[+-](?:0\d|1\d|2[0-3]):[0-5]\d)?)?$/);
    if (!match) throw new Error(fieldName + ' must be an ISO date (YYYY-MM-DD) or ISO timestamp.');
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    const calendarDate = new Date(Date.UTC(year, month - 1, day));
    if (calendarDate.getUTCFullYear() !== year || calendarDate.getUTCMonth() !== month - 1 || calendarDate.getUTCDate() !== day) {
      throw new Error(fieldName + ' is not a valid calendar date.');
    }
    date = match[7] ? new Date(text) : new Date(year, month - 1, day, Number(match[4] || 0), Number(match[5] || 0), Number(match[6] || 0));
  }
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

/**
 * Digit-only search keys for a phone query, so "010 0999 0001", "01009990001"
 * and "+20 100 999 0001" all find the same Egyptian number.
 */
function mpPhoneSearchNeedles_(query) {
  let digits = mpNormalizePhone_(query);
  if (digits.length < 5) return [];
  if (digits.indexOf('00') === 0) digits = digits.slice(2);
  const needles = [digits];
  if (digits.charAt(0) === '0') needles.push('20' + digits.slice(1));
  if (digits.indexOf('20') === 0 && digits.length > 7) needles.push('0' + digits.slice(2));
  return needles;
}

function mpToNumber_(value, fieldName, required) {
  if (mpIsBlank_(value)) {
    if (required) throw new Error(fieldName + ' is required.');
    return '';
  }
  if (typeof value === 'boolean' || (typeof value === 'string' && String(value).trim() === '')) throw new Error(fieldName + ' must be a valid number.');
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
  const detail = { message: error && error.message ? error.message : String(error) };
  if (error && error.code) detail.code = error.code;
  if (error && error.duplicates) detail.duplicates = error.duplicates;
  return { ok: false, error: detail };
}

function mpDeepClone_(value) { return JSON.parse(JSON.stringify(value)); }

function mpAssertEntityId_(entityName, value, fieldName, required) {
  if (mpIsBlank_(value)) {
    if (required) throw new Error(fieldName + ' is required.');
    return '';
  }
  const prefix = MP_CONFIG.ENTITY_ID_PREFIXES[entityName];
  const id = String(value).trim();
  if (!prefix || !new RegExp('^' + prefix + '-[A-F0-9]{32}$').test(id)) {
    throw new Error(fieldName + ' must be a valid ' + entityName.slice(0, -1) + ' ID.');
  }
  return id;
}
