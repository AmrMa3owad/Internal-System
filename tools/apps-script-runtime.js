'use strict';
/**
 * In-memory fakes of the Apps Script services this project uses, plus a
 * loader that evaluates every .gs file in one VM context. Shared by the local
 * test harness and the local preview server. Approximates Google Sheets; it is
 * not a substitute for running the suite in the real Apps Script project.
 */
// Apps Script evaluates local-time Dates in the project time zone (appsscript.json).
process.env.TZ = 'Africa/Cairo';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '..');

function formatDate(date, timeZone, pattern) {
  const parts = {};
  new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' })
    .formatToParts(date).forEach((part) => { parts[part.type] = part.value; });
  if (pattern === 'yyyy-MM-dd') return `${parts.year}-${parts.month}-${parts.day}`;
  if (pattern === 'yyyy-MM-dd HH:mm') return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}`;
  if (pattern !== "yyyy-MM-dd'T'HH:mm:ssXXX") throw new Error('Fake formatDate does not support pattern ' + pattern);
  const localAsUtc = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute, +parts.second);
  const offset = Math.round((localAsUtc - Math.floor(date.getTime() / 1000) * 1000) / 60000);
  const sign = offset < 0 ? '-' : '+';
  const pad = (n) => String(Math.abs(n)).padStart(2, '0');
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}${sign}${pad(Math.trunc(offset / 60))}:${pad(offset % 60)}`;
}

/** Counts of the slow Google calls, so performance changes can be measured locally. */
const STATS = { openById: 0, reads: 0, writes: 0, sheetInfo: 0, locks: 0 };
function resetStats() { Object.keys(STATS).forEach((key) => { STATS[key] = 0; }); }

function displayValue(value) {
  if (value === true) return 'TRUE';
  if (value === false) return 'FALSE';
  if (value instanceof Date) return value.toISOString();
  return value === null || value === undefined ? '' : String(value);
}

class FakeSheet {
  constructor(name) { this.name = name; this.rows = []; this.formats = {}; this.validations = {}; this.filter = null; this.maxRows = 1000; }
  getName() { return this.name; }
  getLastRow() {
    STATS.sheetInfo += 1;
    for (let r = this.rows.length - 1; r >= 0; r -= 1) if ((this.rows[r] || []).some((v) => v !== '' && v !== undefined)) return r + 1;
    return 0;
  }
  getLastColumn() {
    STATS.sheetInfo += 1;
    let last = 0;
    this.rows.forEach((row) => { (row || []).forEach((v, c) => { if (v !== '' && v !== undefined) last = Math.max(last, c + 1); }); });
    return last;
  }
  getMaxRows() { return Math.max(this.maxRows, this.rows.length); }
  getDataRange() {
    STATS.sheetInfo += 1;
    let rows = 0; let cols = 0;
    this.rows.forEach((row, r) => { (row || []).forEach((v, c) => { if (v !== '' && v !== undefined) { rows = Math.max(rows, r + 1); cols = Math.max(cols, c + 1); } }); });
    return new FakeRange(this, 1, 1, rows || 1, cols || 1);
  }
  getRange(row, column, numRows, numColumns) { return new FakeRange(this, row, column, numRows || 1, numColumns || 1); }
  setFrozenRows() { return this; }
  setRowHeight() { return this; }
  setColumnWidths() { return this; }
  getFilter() { return this.filter; }
  /** Inserts an empty column after column `after` (1-based); cells, formats, and dropdowns to the right shift. */
  insertColumnAfter(after) {
    this.rows.forEach((row) => { if (row && row.length > after) row.splice(after, 0, ''); });
    const shift = (map) => { const next = {}; Object.keys(map).forEach((key) => { const c = Number(key); next[c > after ? c + 1 : c] = map[key]; }); next[after + 1] = map[after]; return next; };
    this.formats = shift(this.formats); this.validations = shift(this.validations);
    return this;
  }
  insertColumnBefore(before) { return this.insertColumnAfter(before - 1); }
  cell(r, c) { return (this.rows[r - 1] || [])[c - 1]; }
  write(r, c, value) {
    const rule = this.validations[c];
    if (rule && r >= 2 && value !== '' && value !== null && value !== undefined && rule.indexOf(displayValue(value)) === -1) {
      throw new Error(`The data you entered in cell ${this.name}!R${r}C${c} (${displayValue(value)}) violates the data validation rules set on this cell.`);
    }
    // Sheets treats a leading apostrophe as a "store as text" marker and drops it.
    if (typeof value === 'string' && value.charAt(0) === "'") value = value.substring(1);
    while (this.rows.length < r) this.rows.push([]);
    this.rows[r - 1][c - 1] = value === null || value === undefined ? '' : value;
  }
}

class FakeRange {
  constructor(sheet, row, column, numRows, numColumns) { Object.assign(this, { sheet, row, column, numRows, numColumns }); }
  grid(mapper) {
    const out = [];
    for (let r = 0; r < this.numRows; r += 1) {
      const line = [];
      for (let c = 0; c < this.numColumns; c += 1) {
        const v = this.sheet.cell(this.row + r, this.column + c);
        line.push(mapper(v === undefined ? '' : v));
      }
      out.push(line);
    }
    return out;
  }
  getValues() { STATS.reads += 1; return this.grid((v) => v); }
  getDisplayValues() { STATS.reads += 1; return this.grid(displayValue); }
  setValues(values) {
    STATS.writes += 1;
    if (values.length !== this.numRows || values.some((line) => line.length !== this.numColumns)) throw new Error('setValues dimensions do not match the range.');
    values.forEach((line, r) => line.forEach((v, c) => this.sheet.write(this.row + r, this.column + c, v)));
    return this;
  }
  setValue(value) { STATS.writes += 1; this.sheet.write(this.row, this.column, value); return this; }
  setNumberFormat(format) { for (let c = 0; c < this.numColumns; c += 1) this.sheet.formats[this.column + c] = format; return this; }
  getNumberFormat() { return this.sheet.formats[this.column] || 'General'; }
  clearDataValidations() { for (let c = 0; c < this.numColumns; c += 1) this.sheet.validations[this.column + c] = null; return this; }
  setDataValidation(rule) { for (let c = 0; c < this.numColumns; c += 1) this.sheet.validations[this.column + c] = rule.allowInvalid ? null : rule.list; return this; }
  setFontWeight() { return this; }
  setFontColor() { return this; }
  setBackground() { return this; }
  setHorizontalAlignment() { return this; }
  createFilter() { this.sheet.filter = {}; return this.sheet.filter; }
}

class FakeSpreadsheet {
  constructor(name) { this.id = 'sheet' + crypto.randomBytes(16).toString('hex'); this.name = name; this.sheets = [new FakeSheet('Sheet1')]; this.timeZone = 'America/Los_Angeles'; }
  getId() { return this.id; }
  getName() { return this.name; }
  getUrl() { return 'https://docs.google.com/spreadsheets/d/' + this.id + '/edit'; }
  getSheetByName(name) { return this.sheets.find((s) => s.name === name) || null; }
  getSheets() { return this.sheets.slice(); }
  insertSheet(name) { if (this.getSheetByName(name)) throw new Error('Sheet exists: ' + name); const sheet = new FakeSheet(name); this.sheets.push(sheet); return sheet; }
  deleteSheet(sheet) { this.sheets = this.sheets.filter((s) => s !== sheet); }
  setSpreadsheetTimeZone(tz) { this.timeZone = tz; }
  getSpreadsheetTimeZone() { return this.timeZone; }
}

/**
 * Creates an isolated runtime. Returns { context, setActiveEmail, ownerEmail }.
 * context exposes every top-level function and const from the .gs files.
 */
function createRuntime(options) {
  options = options || {};
  const ownerEmail = options.ownerEmail || 'owner@example.test';
  const spreadsheets = new Map();
  const trashed = new Set();
  const scriptProperties = new Map();
  let activeEmail = ownerEmail;
  let lockHeld = false;
  const driveItems = new Map();
  const triggers = [];
  const outbox = [];
  const cache = new Map();
  let clockOffset = 0;
  let fileClock = 0;
  const iterator = (items) => { let i = 0; return { hasNext: () => i < items.length, next: () => items[i++] }; };
  class FakeBlob {
    constructor(bytes, contentType, name) { this.bytes = Array.from(bytes || []); this.contentType = contentType; this.name = name; }
    getBytes() { return this.bytes.slice(); }
    getContentType() { return this.contentType; }
    getName() { return this.name; }
  }
  class FakeFolder {
    constructor(name) { this.id = 'folder' + crypto.randomBytes(12).toString('hex'); this.name = name; }
    getId() { return this.id; }
    getName() { return this.name; }
    setTrashed(flag) { if (flag) trashed.add(this.id); }
    createFile(blob) { const file = new FakeFile(blob, this); driveItems.set(file.id, file); return file; }
    getFiles() { return iterator(Array.from(driveItems.values()).filter((item) => item instanceof FakeFile && item.folder === this && !trashed.has(item.id))); }
  }
  class FakeFile {
    constructor(blob, folder) { this.id = 'file' + crypto.randomBytes(12).toString('hex'); this.blob = blob; this.folder = folder; this.created = new Date(Date.now() + (fileClock += 1)); }
    getDateCreated() { return this.created; }
    getId() { return this.id; }
    getName() { return this.blob.getName(); }
    getBlob() { return this.blob; }
    getParents() { return iterator(this.folder ? [this.folder] : []); }
    getOwner() { return { getEmail: () => ownerEmail }; }
    setTrashed(flag) { if (flag) trashed.add(this.id); }
  }
  const quietConsole = { log: console.log, warn: console.warn, info: console.info, error: options.verbose ? console.error : () => {} };

  const globals = {
    console: quietConsole,
    SpreadsheetApp: {
      create(name) { const ss = new FakeSpreadsheet(name); spreadsheets.set(ss.id, ss); return ss; },
      openById(id) { STATS.openById += 1; const ss = spreadsheets.get(id); if (!ss || trashed.has(id)) throw new Error('Spreadsheet not found: ' + id); return ss; },
      flush() {},
      newDataValidation() {
        const rule = { list: null, allowInvalid: true };
        return {
          requireValueInList(list) { rule.list = list.map(String); return this; },
          setAllowInvalid(flag) { rule.allowInvalid = flag; return this; },
          build() { return rule; }
        };
      }
    },
    PropertiesService: {
      getScriptProperties() {
        return {
          getProperty: (key) => (scriptProperties.has(key) ? scriptProperties.get(key) : null),
          setProperty: (key, value) => { scriptProperties.set(key, String(value)); },
          deleteProperty: (key) => { scriptProperties.delete(key); },
          getProperties: () => Object.fromEntries(scriptProperties)
        };
      }
    },
    LockService: {
      getScriptLock() {
        let mine = false;
        return {
          waitLock() { STATS.locks += 1; if (lockHeld) throw new Error('Fake: script lock is already held (a nested waitLock would deadlock).'); lockHeld = true; mine = true; },
          releaseLock() { if (mine) { lockHeld = false; mine = false; } },
          hasLock() { return mine; }
        };
      }
    },
    // The web app executes as the deploying owner, so the effective user is always the owner.
    Session: { getActiveUser() { return { getEmail: () => activeEmail }; }, getEffectiveUser() { return { getEmail: () => ownerEmail }; } },
    ScriptApp: {
      getScriptId() { return 'script-id'; },
      getService() { return { getUrl: () => 'https://script.google.com/a/macros/example.test/s/demo/exec' }; },
      getProjectTriggers() { return triggers.slice(); },
      deleteTrigger(trigger) { const index = triggers.indexOf(trigger); if (index !== -1) triggers.splice(index, 1); },
      newTrigger(handler) {
        const spec = { handler };
        const builder = {
          timeBased() { return builder; }, everyDays(n) { spec.everyDays = n; return builder; }, atHour(h) { spec.hour = h; return builder; },
          inTimezone(tz) { spec.timeZone = tz; return builder; },
          create() {
            const uid = 'trigger-' + crypto.randomBytes(6).toString('hex');
            const trigger = { getHandlerFunction: () => handler, getUniqueId: () => uid, spec };
            triggers.push(trigger);
            return trigger;
          }
        };
        return builder;
      }
    },
    DriveApp: {
      createFolder(name) { const folder = new FakeFolder(name); driveItems.set(folder.id, folder); return folder; },
      getFolderById(id) { const item = driveItems.get(id); if (!(item instanceof FakeFolder) || trashed.has(id)) throw new Error('Folder not found: ' + id); return item; },
      getFileById(id) {
        const item = driveItems.get(id);
        if (item instanceof FakeFile) { if (trashed.has(id)) throw new Error('File is in trash: ' + id); return item; }
        // Spreadsheets, folders, and the script project itself: an owner-owned file outside any folder.
        return {
          getId: () => id, getOwner: () => ({ getEmail: () => ownerEmail }), setTrashed: (flag) => { if (flag) trashed.add(id); }, getParents: () => iterator([]),
          // Copying a spreadsheet: the copy is a real fake spreadsheet (so it can be restored) filed in the folder.
          makeCopy(name, folder) {
            const source = spreadsheets.get(id);
            if (!source) throw new Error('Only spreadsheets can be copied in the fake.');
            const copy = new FakeSpreadsheet(name);
            copy.sheets = source.sheets.map((sheet) => { const clone = new FakeSheet(sheet.name); clone.rows = sheet.rows.map((row) => (row || []).slice()); clone.formats = Object.assign({}, sheet.formats); clone.validations = Object.assign({}, sheet.validations); return clone; });
            spreadsheets.set(copy.id, copy);
            const file = new FakeFile(new FakeBlob([], 'application/vnd.google-apps.spreadsheet', name), folder);
            file.id = copy.id;
            driveItems.set(file.id, file);
            return file;
          }
        };
      }
    },
    ContentService: {
      MimeType: { JSON: 'application/json', TEXT: 'text/plain' },
      createTextOutput(text) { const out = { text: String(text), mime: 'text/plain', getContent: () => out.text, setMimeType(m) { out.mime = m; return out; }, getMimeType: () => out.mime }; return out; }
    },
    MailApp: {
      sendEmail(message) { outbox.push(message); },
      getRemainingDailyQuota() { return 1500 - outbox.length; }
    },
    CacheService: {
      getScriptCache() {
        const now = () => Date.now() + clockOffset;
        return {
          get: (key) => { const entry = cache.get(key); if (!entry || entry.expires <= now()) { cache.delete(key); return null; } return entry.value; },
          put: (key, value, seconds) => { cache.set(key, { value: String(value), expires: now() + 1000 * (seconds || 600) }); },
          remove: (key) => { cache.delete(key); },
          getAll: (keys) => { const out = {}; keys.forEach((key) => { const entry = cache.get(key); if (entry && entry.expires > now()) out[key] = entry.value; }); return out; },
          putAll: (values, seconds) => { Object.keys(values).forEach((key) => { cache.set(key, { value: String(values[key]), expires: now() + 1000 * (seconds || 600) }); }); }
        };
      }
    },
    Utilities: {
      DigestAlgorithm: { SHA_256: 'sha256' },
      Charset: { UTF_8: 'utf8' },
      computeDigest(algorithm, text) { return Array.from(crypto.createHash(algorithm).update(String(text), 'utf8').digest()).map((b) => (b > 127 ? b - 256 : b)); },
      getUuid: () => crypto.randomUUID(),
      formatDate,
      base64Encode(data) { return Buffer.from(typeof data === 'string' ? Buffer.from(data, 'utf8') : Uint8Array.from(data, (b) => b & 255)).toString('base64'); },
      base64Decode(text) { if (!/^[A-Za-z0-9+/=\s]*$/.test(text)) throw new Error('Could not decode string.'); return Array.from(Buffer.from(text, 'base64')).map((b) => (b > 127 ? b - 256 : b)); },
      newBlob(bytes, contentType, name) { return new FakeBlob(bytes, contentType, name); }
    }
  };

  const files = fs.readdirSync(ROOT).filter((f) => f.endsWith('.gs')).sort();
  const source = files.map((f) => `// ---- ${f}\n` + fs.readFileSync(path.join(ROOT, f), 'utf8')).join('\n');
  const context = vm.createContext(globals);
  // Top-level const/function declarations live in the script scope; expose them via a resolver.
  vm.runInContext(source + '\n;globalThis.__resolve = function (name) { return eval(name); };', context, { filename: 'apps-script-bundle.js' });
  const resolve = context.__resolve;

  return {
    ownerEmail,
    fn: (name) => resolve(name),
    setActiveEmail: (email) => { activeEmail = email; },
    outbox,
    /** Moves the cache clock forward (to expire sign-in codes in tests). */
    advanceCacheClock: (ms) => { clockOffset += ms; },
    triggers,
    spreadsheets,
    /** Stores a file outside the documents folder (for the folder-check test). */
    createLooseFile: (name, text) => { const file = new FakeFile(new FakeBlob(Array.from(Buffer.from(text)), 'text/plain', name), null); driveItems.set(file.id, file); return file.id; },
    getActiveEmail: () => activeEmail
  };
}

module.exports = { createRuntime, ROOT, STATS, resetStats };
