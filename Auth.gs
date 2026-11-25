/**
 * Email-code sign-in for people whose Google account Apps Script will not
 * identify (personal @gmail.com accounts visiting a web app that executes as
 * the owner). The script keeps running as the owner, so the database stays
 * private and every Api.gs rule still applies.
 *
 * Flow: apiRequestSignInCode(email) emails a 6-digit code to an active user;
 * apiVerifySignInCode(email, code) returns a session token; the browser sends
 * that token with every call through apiCall(token, name, args).
 *
 * Protections: codes expire after 10 minutes and allow 5 attempts; at most 5
 * codes per email per hour; responses never reveal whether an email is a
 * user; codes and tokens are stored only as salted SHA-256 hashes; sessions
 * last MP_SESSION_DAYS_ (7) days and are re-checked against an ACTIVE Users record on every call.
 */
const MP_SESSION_DAYS_ = 7;
const MP_CODE_MINUTES_ = 10;
const MP_CODE_ATTEMPTS_ = 5;
const MP_CODES_PER_HOUR_ = 5;
const MP_SESSION_PREFIX_ = 'mpsess:';
var MP_SESSION_TOKEN_ = null;

function mpSha256Hex_(text) {
  return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, String(text), Utilities.Charset.UTF_8)
    .map(function(byte) { const value = (byte + 256) % 256; return (value < 16 ? '0' : '') + value.toString(16); }).join('');
}

function mpAuthSecret_() {
  const properties = PropertiesService.getScriptProperties();
  let secret = properties.getProperty('MP_AUTH_SECRET');
  if (!secret) {
    secret = mpRandomHex_();
    properties.setProperty('MP_AUTH_SECRET', secret);
  }
  return secret;
}

function mpRandomHex_() { return (Utilities.getUuid() + Utilities.getUuid()).replace(/-/g, '').toLowerCase(); }

function mpNewSignInCode_() {
  const hex = Utilities.getUuid().replace(/-/g, '');
  return ('000000' + (parseInt(hex.slice(0, 12), 16) % 1000000)).slice(-6);
}

function mpAuthError_(message, code) {
  const error = new Error(message);
  error.code = code;
  return error;
}

/** Google identity when Apps Script provides it, otherwise a valid sign-in session. */
function mpCurrentIdentity_() {
  let googleEmail = '';
  try { googleEmail = mpNormalizeEmail_(Session.getActiveUser().getEmail()); } catch (error) { googleEmail = ''; }
  if (googleEmail) return { email: googleEmail, via: 'google' };
  if (MP_SESSION_TOKEN_) {
    const email = mpSessionEmail_(MP_SESSION_TOKEN_);
    if (email) return { email: email, via: 'code' };
  }
  throw mpAuthError_('Please sign in.', 'AUTH_REQUIRED');
}

function mpSessionKey_(token) { return MP_SESSION_PREFIX_ + mpSha256Hex_(mpAuthSecret_() + ':session:' + token); }

function mpSessionEmail_(token) {
  if (!/^[a-f0-9]{64}$/.test(String(token || ''))) return '';
  const properties = PropertiesService.getScriptProperties();
  const key = mpSessionKey_(token);
  const raw = properties.getProperty(key);
  if (!raw) return '';
  try {
    const session = JSON.parse(raw);
    // The created time also caps sessions issued under an older, longer limit.
    const limit = Math.min(Number(session.expires || 0), Number(session.created || 0) + MP_SESSION_DAYS_ * 86400000);
    if (!session.expires || !session.created || Date.now() > limit) { properties.deleteProperty(key); return ''; }
    return mpNormalizeEmail_(session.email);
  } catch (error) {
    properties.deleteProperty(key);
    return '';
  }
}

function mpPruneSessions_(properties) {
  const all = properties.getProperties();
  Object.keys(all).forEach(function(key) {
    if (key.indexOf(MP_SESSION_PREFIX_) !== 0) return;
    try { if (Date.now() > Number(JSON.parse(all[key]).expires)) properties.deleteProperty(key); }
    catch (error) { properties.deleteProperty(key); }
  });
}

const MP_SIGN_IN_TEXT_ = {
  EN: {
    subject: function(code) { return 'Your Mohamy Plus sign-in code: ' + code; },
    body: function(name, code) { return 'Hello ' + name + ',\n\nYour sign-in code is ' + code + '. It expires in ' + MP_CODE_MINUTES_ + ' minutes.\n\nIf you did not try to sign in, you can ignore this email.'; },
    line: 'Your sign-in code', expiry: 'Expires in ' + MP_CODE_MINUTES_ + ' minutes. If you did not try to sign in, ignore this email.'
  },
  AR: {
    subject: function(code) { return 'رمز الدخول إلى محامي بلس: ' + code; },
    body: function(name, code) { return 'مرحبًا ' + name + '،\n\nرمز الدخول الخاص بك هو ' + code + '، وتنتهي صلاحيته خلال ' + MP_CODE_MINUTES_ + ' دقائق.\n\nإذا لم تحاول تسجيل الدخول، يمكنك تجاهل هذه الرسالة.'; },
    line: 'رمز الدخول الخاص بك', expiry: 'تنتهي صلاحيته خلال ' + MP_CODE_MINUTES_ + ' دقائق. إذا لم تحاول تسجيل الدخول، تجاهل هذه الرسالة.'
  }
};

// ------------------------------------------------------------- Access log
/**
 * Every sign-in attempt is written to the AccessLog sheet so owners can see
 * who is trying to get in, including emails that are not users. Apps Script
 * does not reveal a visitor's IP address or device, so an attempt is visible
 * once the person types an email (or arrives signed in to an unknown Google
 * account).
 */
const MP_ACCESS_PROBLEMS_ = ['CODE_UNKNOWN_EMAIL', 'CODE_RATE_LIMITED', 'CODE_WRONG', 'CODE_LOCKED', 'CODE_MISSING', 'GOOGLE_DENIED', 'SESSION_REJECTED', 'FLOOD_PROTECTION'];
const MP_ACCESS_SUCCESS_ = ['CODE_SENT', 'SIGNED_IN'];
const MP_FLOOD_LIMIT_ = 60;

function mpEnsureAccessLogSheet_() {
  const spreadsheet = mpGetDatabase_();
  let sheet = spreadsheet.getSheetByName('AccessLog');
  if (!sheet) {
    // Databases created before the access log existed get the sheet on first use.
    sheet = spreadsheet.insertSheet('AccessLog');
    sheet.getRange(1, 1, 1, MP_SCHEMAS.AccessLog.length).setValues([MP_SCHEMAS.AccessLog]);
    mpConfigureSheetPresentation_(sheet, MP_SCHEMAS.AccessLog);
  }
  return sheet;
}

/** Never blocks sign-in: a failed log write is reported in the execution log only. */
function mpLogAccess_(event, email, userId, detail) {
  try {
    mpWithLock_(function() {
      const sheet = mpEnsureAccessLogSheet_();
      mpAppendRecordChecked_(sheet, MP_SCHEMAS.AccessLog, {
        LogID: mpNewId_('AccessLog'), Timestamp: mpNowIso_(), Event: event,
        Email: mpCleanText_(String(email || '').slice(0, 320), 320), UserID: userId || '', Detail: mpCleanText_(String(detail || '').slice(0, 500), 500)
      });
    });
  } catch (error) { console.error('Access log write failed: ' + error.message); }
}

/** For events that can repeat on every page load, write at most one entry per email per 10 minutes. */
function mpLogAccessOnce_(event, email, userId, detail) {
  try {
    const cache = CacheService.getScriptCache();
    const key = 'mplog:' + event + ':' + mpSha256Hex_(String(email || ''));
    if (cache.get(key)) return;
    cache.put(key, '1', 600);
  } catch (error) { /* fall through and log */ }
  mpLogAccess_(event, email, userId, detail);
}

function mpEmailKey_(normalized) { return mpSha256Hex_(mpAuthSecret_() + ':email:' + normalized); }

/** Always answers the same way, so it cannot be used to discover who is a user. */
function mpRequestSignInCode_(email) {
  const normalized = mpValidateEmail_(email, 'Email', true);
  const cache = CacheService.getScriptCache();
  // Flood protection across all emails (e.g. someone scripting random addresses).
  const flood = Number(cache.get('mpauth:flood') || 0);
  cache.put('mpauth:flood', String(flood + 1), 600);
  if (flood >= MP_FLOOD_LIMIT_) {
    if (flood === MP_FLOOD_LIMIT_) mpLogAccess_('FLOOD_PROTECTION', normalized, '', 'Over ' + MP_FLOOD_LIMIT_ + ' code requests in 10 minutes; new requests are paused.');
    throw mpAuthError_('Too many sign-in requests right now. Try again in a few minutes.', 'RATE_LIMITED');
  }
  const emailKey = mpEmailKey_(normalized);
  const rateKey = 'mpauth:rate:' + emailKey;
  const sent = Number(cache.get(rateKey) || 0);
  if (sent >= MP_CODES_PER_HOUR_) {
    if (sent === MP_CODES_PER_HOUR_) {
      cache.put(rateKey, String(sent + 1), 3600);
      mpLogAccess_('CODE_RATE_LIMITED', normalized, '', MP_CODES_PER_HOUR_ + ' codes in the last hour. An owner can allow a retry from Security.');
    }
    throw mpAuthError_('Too many codes were requested for this email. Try again in an hour.', 'RATE_LIMITED');
  }
  cache.put(rateKey, String(sent + 1), 3600);
  const user = mpFindActiveUserByEmail_(normalized);
  if (!user) {
    mpLogAccess_('CODE_UNKNOWN_EMAIL', normalized, '', 'Not an active user; no email was sent.');
    return { sent: true, minutes: MP_CODE_MINUTES_ };
  }
  const code = mpNewSignInCode_();
  // The code is stored against this one email: it cannot sign in anyone else.
  cache.put('mpauth:code:' + emailKey, JSON.stringify({ hash: mpSha256Hex_(mpAuthSecret_() + ':code:' + normalized + ':' + code), attempts: 0 }), MP_CODE_MINUTES_ * 60);
  const text = MP_SIGN_IN_TEXT_[user.Language === 'AR' ? 'AR' : 'EN'];
  const dir = user.Language === 'AR' ? 'rtl' : 'ltr';
  const name = mpPlainText_(user.FullName) || normalized;
  MailApp.sendEmail({
    to: normalized,
    subject: text.subject(code),
    body: text.body(name, code),
    htmlBody: '<div dir="' + dir + '" style="font-family:Segoe UI,Tahoma,Arial,sans-serif;color:#17212d;max-width:460px">' +
      '<p style="color:#7a7366;margin:0 0 6px">' + mpEscapeHtml_(text.line) + '</p>' +
      '<p style="font:600 34px/1.2 Georgia,serif;letter-spacing:6px;margin:0 0 14px">' + code + '</p>' +
      '<p style="color:#7a7366;font-size:13px">' + mpEscapeHtml_(text.expiry) + '</p></div>',
    name: mpGetSettingValue_('BUSINESS_NAME') || MP_DEFAULT_SETTINGS.BUSINESS_NAME
  });
  mpLogAccess_('CODE_SENT', normalized, user.UserID, 'Code emailed (request ' + (sent + 1) + ' of ' + MP_CODES_PER_HOUR_ + ' this hour).');
  return { sent: true, minutes: MP_CODE_MINUTES_ };
}

function mpVerifySignInCode_(email, code) {
  const normalized = mpValidateEmail_(email, 'Email', true);
  const cleanCode = String(code || '').replace(/\D/g, '');
  const cache = CacheService.getScriptCache();
  const key = 'mpauth:code:' + mpEmailKey_(normalized);
  const wrong = function() { return mpAuthError_('This code is wrong or has expired. Request a new one.', 'INVALID_CODE'); };
  const raw = cache.get(key);
  if (!raw) { mpLogAccess_('CODE_MISSING', normalized, '', 'No valid code for this email (expired, already used, or never sent).'); throw wrong(); }
  if (cleanCode.length !== 6) throw wrong();
  const entry = JSON.parse(raw);
  if (mpSha256Hex_(mpAuthSecret_() + ':code:' + normalized + ':' + cleanCode) !== entry.hash) {
    entry.attempts += 1;
    if (entry.attempts >= MP_CODE_ATTEMPTS_) {
      cache.remove(key);
      mpLogAccess_('CODE_LOCKED', normalized, '', MP_CODE_ATTEMPTS_ + ' wrong codes; this code no longer works.');
    } else {
      cache.put(key, JSON.stringify(entry), MP_CODE_MINUTES_ * 60);
      mpLogAccess_('CODE_WRONG', normalized, '', 'Wrong code (attempt ' + entry.attempts + ' of ' + MP_CODE_ATTEMPTS_ + ').');
    }
    throw wrong();
  }
  cache.remove(key);
  const user = mpFindActiveUserByEmail_(normalized);
  if (!user) { mpLogAccess_('SESSION_REJECTED', normalized, '', 'Correct code but the user is no longer active.'); throw wrong(); }
  const token = mpRandomHex_();
  const now = Date.now();
  const expires = now + MP_SESSION_DAYS_ * 86400000;
  mpWithLock_(function() {
    const properties = PropertiesService.getScriptProperties();
    mpPruneSessions_(properties);
    properties.setProperty(mpSessionKey_(token), JSON.stringify({ email: normalized, expires: expires, created: now }));
  });
  mpLogAccess_('SIGNED_IN', normalized, user.UserID, 'Signed in with an email code for ' + MP_SESSION_DAYS_ + ' days.');
  return { token: token, expiresAt: Utilities.formatDate(new Date(expires), MP_CONFIG.DATE_TIMEZONE, "yyyy-MM-dd'T'HH:mm:ssXXX") };
}

function mpSignOut_() {
  if (MP_SESSION_TOKEN_ && /^[a-f0-9]{64}$/.test(MP_SESSION_TOKEN_)) {
    const email = mpSessionEmail_(MP_SESSION_TOKEN_);
    PropertiesService.getScriptProperties().deleteProperty(mpSessionKey_(MP_SESSION_TOKEN_));
    if (email) mpLogAccess_('SIGNED_OUT', email, '', 'Signed out on their device.');
  }
  return { signedOut: true };
}

// ------------------------------------------------------------- Owner security controls

function mpRequireAccessAdmin_(action) {
  const actor = mpRequireActiveUser_();
  mpRequirePermission_(actor, 'AccessLog', action);
  return actor;
}

/** options: { limit, offset, filter: 'all'|'problems'|'success', query } — newest first. */
function mpListAccessLog_(options) {
  options = options || {};
  const spreadsheet = mpGetDatabase_();
  if (!spreadsheet.getSheetByName('AccessLog')) return { records: [], total: 0, offset: 0, limit: 0 };
  let records = mpRows_('AccessLog').records.slice().reverse();
  if (options.filter === 'problems') records = records.filter(function(row) { return MP_ACCESS_PROBLEMS_.indexOf(row.Event) !== -1; });
  if (options.filter === 'success') records = records.filter(function(row) { return MP_ACCESS_SUCCESS_.indexOf(row.Event) !== -1; });
  if (options.query) {
    const needle = String(options.query).trim().toLowerCase();
    records = records.filter(function(row) { return String(row.Email).toLowerCase().indexOf(needle) !== -1; });
  }
  const limit = Math.min(Math.max(Number(options.limit || 50), 1), MP_CONFIG.MAX_PAGE_SIZE);
  const offset = Math.max(Number(options.offset || 0), 0);
  const names = {};
  mpRows_('Users').records.forEach(function(user) { names[mpNormalizeEmail_(user.Email)] = mpPlainText_(user.FullName); });
  return {
    records: records.slice(offset, offset + limit).map(function(row) {
      const clean = mpPublicRecord_(row);
      clean.UserName = names[mpNormalizeEmail_(row.Email)] || '';
      clean.Problem = MP_ACCESS_PROBLEMS_.indexOf(row.Event) !== -1;
      return clean;
    }),
    total: records.length, offset: offset, limit: limit,
    problemsToday: records.filter(function(row) { return MP_ACCESS_PROBLEMS_.indexOf(row.Event) !== -1 && String(row.Timestamp).slice(0, 10) === mpNowIso_().slice(0, 10); }).length
  };
}

/** Lets an email request a code again immediately (clears the hourly limit and any half-used code). */
function mpClearSignInLimit_(email, actor) {
  const normalized = mpValidateEmail_(email, 'Email', true);
  const cache = CacheService.getScriptCache();
  const emailKey = mpEmailKey_(normalized);
  cache.remove('mpauth:rate:' + emailKey);
  cache.remove('mpauth:code:' + emailKey);
  mpLogAccess_('LIMIT_CLEARED', normalized, actor.userId, 'Retry allowed by ' + (actor.fullName || actor.email) + '.');
  return { email: normalized, cleared: true };
}

/** Devices signed in with an email code (Google-identified owners have no session to list). */
function mpListSessions_() {
  const properties = PropertiesService.getScriptProperties();
  mpPruneSessions_(properties);
  const all = properties.getProperties();
  const names = {};
  mpRows_('Users').records.forEach(function(user) { names[mpNormalizeEmail_(user.Email)] = { name: mpPlainText_(user.FullName), active: user.Status === 'ACTIVE' && user.IsArchived !== true }; });
  const format = function(ms) { return ms ? Utilities.formatDate(new Date(Number(ms)), MP_CONFIG.DATE_TIMEZONE, "yyyy-MM-dd'T'HH:mm:ssXXX") : ''; };
  return Object.keys(all).filter(function(key) { return key.indexOf(MP_SESSION_PREFIX_) === 0; }).map(function(key) {
    let session = {};
    try { session = JSON.parse(all[key]); } catch (error) { session = {}; }
    const who = names[mpNormalizeEmail_(session.email)] || { name: '', active: false };
    return { id: key.slice(MP_SESSION_PREFIX_.length), email: session.email, name: who.name, active: who.active, created: format(session.created), expires: format(session.expires) };
  }).sort(function(a, b) { return String(b.created).localeCompare(String(a.created)); });
}

function mpRevokeSession_(id, actor) {
  if (!/^[a-f0-9]{64}$/.test(String(id || ''))) throw new Error('Unknown session.');
  const properties = PropertiesService.getScriptProperties();
  const key = MP_SESSION_PREFIX_ + id;
  const raw = properties.getProperty(key);
  if (!raw) throw new Error('This device is already signed out.');
  let email = '';
  try { email = JSON.parse(raw).email; } catch (error) { email = ''; }
  properties.deleteProperty(key);
  mpLogAccess_('SESSION_REVOKED', email, actor.userId, 'Signed out remotely by ' + (actor.fullName || actor.email) + '.');
  return { revoked: true };
}

function apiListAccessLog(options) {
  return mpApiRespond_(function() { mpRequireAccessAdmin_('read'); return mpListAccessLog_(options); });
}

function apiClearSignInLimit(email) {
  return mpApiRespond_(function() { return mpClearSignInLimit_(email, mpRequireAccessAdmin_('update')); });
}

function apiListSessions() {
  return mpApiRespond_(function() { mpRequireAccessAdmin_('read'); return mpListSessions_(); });
}

function apiRevokeSession(id) {
  return mpApiRespond_(function() { return mpRevokeSession_(id, mpRequireAccessAdmin_('update')); });
}

/** The UI calls every protected function through apiCall so it can carry the session token. */
function mpRpcHandlers_() {
  return {
    apiGetAppBootstrap: apiGetAppBootstrap, apiGetDashboard: apiGetDashboard, apiListView: apiListView, apiGetDetail: apiGetDetail, apiSearch: apiSearch,
    apiGetCurrentUser: apiGetCurrentUser, apiList: apiList, apiGet: apiGet, apiCreate: apiCreate, apiUpdate: apiUpdate, apiArchive: apiArchive,
    apiConvertLead: apiConvertLead, apiListActivities: apiListActivities, apiGetSettings: apiGetSettings, apiUpdateSetting: apiUpdateSetting,
    apiGetTeam: apiGetTeam, apiAddTeamMember: apiAddTeamMember, apiRemoveTeamMember: apiRemoveTeamMember, apiBulkAssign: apiBulkAssign,
    apiSetMyLanguage: apiSetMyLanguage, apiUploadDocument: apiUploadDocument, apiDownloadDocument: apiDownloadDocument,
    apiGetReminderStatus: apiGetReminderStatus, apiSetDailyReminders: apiSetDailyReminders, apiSendRemindersNow: apiSendRemindersNow,
    apiPreviewMyReminder: apiPreviewMyReminder, apiSignOut: apiSignOut, apiStart: apiStart,
    apiListAccessLog: apiListAccessLog, apiClearSignInLimit: apiClearSignInLimit, apiListSessions: apiListSessions, apiRevokeSession: apiRevokeSession,
    apiGetBackupStatus: apiGetBackupStatus, apiSetDailyBackups: apiSetDailyBackups, apiBackupNow: apiBackupNow,
    apiGetIntakeStatus: apiGetIntakeStatus, apiSetLeadIntake: apiSetLeadIntake,
    apiListConversations: apiListConversations, apiGetConversation: apiGetConversation, apiSendMessage: apiSendMessage, apiSendTemplate: apiSendTemplate,
    apiUpdateConversation: apiUpdateConversation, apiStartWhatsApp: apiStartWhatsApp,
    apiGetChannelSettings: apiGetChannelSettings, apiSaveChannelSettings: apiSaveChannelSettings, apiSetChannelSecret: apiSetChannelSecret,
    apiRotateRelayKey: apiRotateRelayKey, apiTestChannel: apiTestChannel, apiRetryWebhookEvent: apiRetryWebhookEvent,
    apiSyncState: apiSyncState
  };
}

function apiCall(token, name, args) {
  const handlers = mpRpcHandlers_();
  if (typeof name !== 'string' || !Object.prototype.hasOwnProperty.call(handlers, name)) return mpFailure_(new Error('Unknown action.'));
  const previous = MP_SESSION_TOKEN_;
  MP_SESSION_TOKEN_ = typeof token === 'string' && /^[a-f0-9]{64}$/.test(token) ? token : null;
  const started = Date.now();
  try { return handlers[name].apply(null, Array.isArray(args) ? args : []); }
  finally {
    MP_SESSION_TOKEN_ = previous;
    const took = Date.now() - started;
    if (took > 2500) console.log('Slow action ' + name + ': ' + took + ' ms');
  }
}

/** Public: send a sign-in code. */
function apiRequestSignInCode(email) {
  return mpApiRespond_(function() { return mpRequestSignInCode_(email); });
}

/** Public: exchange a code for a session token. */
function apiVerifySignInCode(email, code) {
  return mpApiRespond_(function() { return mpVerifySignInCode_(email, code); });
}

function apiSignOut() {
  return mpApiRespond_(function() { return mpSignOut_(); });
}
