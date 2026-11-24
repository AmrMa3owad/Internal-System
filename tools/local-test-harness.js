#!/usr/bin/env node
/**
 * Local test harness for the Mohamy Plus Apps Script sources.
 *
 * Runs the real bootstrap path (setInitialOwnerEmail -> setupDatabase), the
 * full runStage1DatabaseTests() suite, and public API identity smoke tests
 * against the in-memory fakes in apps-script-runtime.js.
 *
 * It is a fast regression check, NOT a substitute for running the suite in
 * the real Apps Script project.
 *
 * Usage: node tools/local-test-harness.js   (VERBOSE=1 to see server error logs)
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { createRuntime, ROOT } = require('./apps-script-runtime');

const runtime = createRuntime({ verbose: !!process.env.VERBOSE });
const fn = runtime.fn;

let failures = 0;
function check(name, passed, detail) {
  if (!passed) failures += 1;
  console.log(`${passed ? 'PASS' : 'FAIL'}  ${name}${passed || !detail ? '' : '  -> ' + detail}`);
}
function step(name, response) {
  check(name, response && response.ok === true, JSON.stringify(response && response.error));
  return response;
}

// Reproduce projects whose script file Drive cannot find (seen with clasp-created projects).
const driveApp = fn('DriveApp');
const realGetFileById = driveApp.getFileById;
driveApp.getFileById = (id) => { if (id === 'script-id') throw new Error('No item with the given ID could be found.'); return realGetFileById(id); };
runtime.setActiveEmail('visitor@example.test');
check('bootstrap refuses a non-owner when Drive cannot find the script', fn('installMohamyPlus')().ok === false);
runtime.setActiveEmail(runtime.ownerEmail);
step('installMohamyPlus (first run, Drive lookup failing)', fn('installMohamyPlus')());
driveApp.getFileById = realGetFileById;

step('installMohamyPlus (rerun is safe)', fn('installMohamyPlus')());
step('setupDatabase (rerun)', fn('setupDatabase')());
step('getStage1DatabaseStatus', fn('getStage1DatabaseStatus')());

const tests = step('runStage1DatabaseTests', fn('runStage1DatabaseTests')());
if (tests.ok) {
  tests.data.results.forEach((r) => {
    if (!r.passed) failures += 1;
    console.log(`  ${r.passed ? 'pass' : 'FAIL'}  ${r.name}${r.passed ? '' : '  -> ' + r.error}`);
  });
  console.log(`  ${tests.data.passedCount} passed, ${tests.data.failedCount} failed; globalBindingUnchanged=${tests.data.globalBindingUnchanged}`);
}

// Public API through the real identity path.
const me = step('apiGetAppBootstrap (owner)', fn('apiGetAppBootstrap')());
check('owner role reported', me.ok && me.data.role === 'OWNER');
step('apiCreate Companies (owner)', fn('apiCreate')('Companies', { CompanyName: 'Smoke Co', Email: 'smoke@example.test' }));
step('apiListView Companies (owner)', fn('apiListView')('Companies', { query: 'smoke' }));
step('apiGetDashboard (owner)', fn('apiGetDashboard')());
runtime.setActiveEmail('stranger@example.test');
check('unknown user is denied', fn('apiList')('Companies', {}).ok === false);
runtime.setActiveEmail('');
check('blank identity fails closed', fn('apiGetAppBootstrap')().ok === false);
runtime.setActiveEmail(runtime.ownerEmail);

// UI flow: the same payload shapes App.html sends, through the public API, per role.
function as(email, name) {
  runtime.setActiveEmail(email);
  const args = Array.prototype.slice.call(arguments, 2);
  return fn(name).apply(null, args);
}
const OWNER = runtime.ownerEmail;
const flowLawyer = as(OWNER, 'apiCreate', 'Users', { FullName: 'Flow Lawyer', Email: 'flow.lawyer@example.test', Role: 'LAWYER' });
const flowAssistant = as(OWNER, 'apiCreate', 'Users', { FullName: 'Flow Assistant', Email: 'flow.assistant@example.test', Role: 'ASSISTANT' });
check('flow: owner creates staff users', flowLawyer.ok && flowAssistant.ok, JSON.stringify(flowLawyer.error || flowAssistant.error));
const LAWYER = 'flow.lawyer@example.test';
const ASSISTANT = 'flow.assistant@example.test';
const lead = as(ASSISTANT, 'apiCreate', 'Leads', { FullName: 'Flow Lead', Phone: '+201009990001', Source: 'WHATSAPP', Priority: 'MEDIUM', Status: 'NEW', ClientType: 'INDIVIDUAL', AssignedTo: flowLawyer.data && flowLawyer.data.UserID });
check('flow: assistant creates a lead from form values', lead.ok, JSON.stringify(lead.error));
const consult = as(ASSISTANT, 'apiCreate', 'Consultations', { LeadID: lead.data.LeadID, ConsultationDate: '2026-12-01T11:30', Duration: 45, Fee: 600, Status: 'SCHEDULED', PaymentStatus: 'UNPAID' });
check('flow: datetime-local value accepted as Cairo time', consult.ok && consult.data.ConsultationDate === '2026-12-01T11:30:00+02:00', JSON.stringify(consult.error || consult.data && consult.data.ConsultationDate));
const converted = as(ASSISTANT, 'apiConvertLead', lead.data.LeadID, lead.data.Version, { Email: 'flow.lead@example.test' });
check('flow: assistant converts the lead', converted.ok && converted.data.relinked.consultations === 1, JSON.stringify(converted.error));
const clientId = converted.ok ? converted.data.client.ClientID : '';
const payment = as(ASSISTANT, 'apiCreate', 'Transactions', { ClientID: clientId, ConsultationID: consult.data.ConsultationID, Type: 'INCOME', Amount: 600, PaymentMethod: 'CASH', PaymentDate: '2026-12-01T12:00' });
const clientDetail = as(ASSISTANT, 'apiGetDetail', 'Clients', clientId);
const paidConsult = clientDetail.ok && clientDetail.data.related.Consultations.records[0];
check('flow: consultation payment marks it PAID and shows on client detail', payment.ok && paidConsult && paidConsult.PaymentStatus === 'PAID', JSON.stringify(payment.error || clientDetail.error));
const dup = as(ASSISTANT, 'apiCreate', 'Clients', { FullName: 'Flow Lead Twin', Phone: '+20 100 999 0001' });
check('flow: duplicate phone returns DUPLICATE with matches', !dup.ok && dup.error.code === 'DUPLICATE' && dup.error.duplicates.length === 1, JSON.stringify(dup));
const dupConfirmed = as(ASSISTANT, 'apiCreate', 'Clients', { FullName: 'Flow Lead Twin', Phone: '+20 100 999 0001', confirmDuplicate: true });
check('flow: reviewed duplicate can be saved', dupConfirmed.ok, JSON.stringify(dupConfirmed.error));
const feeCase = as(LAWYER, 'apiCreate', 'Cases', { CaseTitle: 'Flow case', ClientID: clientId, AgreedFee: 1000 });
check('flow: lawyer cannot set AgreedFee', !feeCase.ok && feeCase.error.code === 'FORBIDDEN', JSON.stringify(feeCase));
const lawyerCase = as(LAWYER, 'apiCreate', 'Cases', { CaseTitle: 'Flow case', ClientID: clientId, Priority: 'MEDIUM', Status: 'INITIAL_REVIEW', Deadline: '2026-12-20' });
const edited = lawyerCase.ok && as(LAWYER, 'apiUpdate', 'Cases', lawyerCase.data.CaseID, { Status: 'COMPLETED' }, lawyerCase.data.Version);
check('flow: lawyer creates and completes a case (ClosedAt set, no fee leak)', edited && edited.ok && !!edited.data.ClosedAt && edited.data.AgreedFee === undefined, JSON.stringify(lawyerCase.error || (edited && edited.error)));
const stale = lawyerCase.ok && as(LAWYER, 'apiUpdate', 'Cases', lawyerCase.data.CaseID, { Description: 'stale' }, lawyerCase.data.Version);
check('flow: stale edit is rejected', stale && !stale.ok && /changed by another user/.test(stale.error.message));
const boot = as(LAWYER, 'apiGetAppBootstrap');
const priority = boot.ok && boot.data.forms.Cases.fields.filter((f) => f.name === 'Priority')[0];
check('flow: form metadata carries defaults', priority && priority.defaultValue === 'MEDIUM');

// Uploads, downloads, team access, bulk assignment, language, and reminders through the public API.
const fileText = 'Power of attorney scan';
const up = as(ASSISTANT, 'apiUploadDocument', { EntityType: 'CLIENT', EntityID: clientId, ConfidentialityLevel: 'STANDARD' }, { name: 'poa.pdf', base64: Buffer.from(fileText).toString('base64') });
check('flow: assistant uploads a file for a client they converted', up.ok && up.data.FileType === 'PDF', JSON.stringify(up.error));
const down = up.ok && as(LAWYER, 'apiDownloadDocument', up.data.DocumentID);
check('flow: the client\'s assigned lawyer downloads the same bytes', down && down.ok && Buffer.from(down.data.base64, 'base64').toString() === fileText, JSON.stringify(down && down.error));
const outsider = as(OWNER, 'apiCreate', 'Users', { FullName: 'Outside Lawyer', Email: 'outside@example.test', Role: 'LAWYER' });
const outsiderDown = up.ok && as('outside@example.test', 'apiDownloadDocument', up.data.DocumentID);
check('flow: unassigned lawyer cannot download it', outsider.ok && outsiderDown && !outsiderDown.ok && outsiderDown.error.code === 'NOT_FOUND', JSON.stringify(outsiderDown));
const bulkAssign = as(OWNER, 'apiBulkAssign', 'Clients', [clientId], outsider.data.UserID, 'team');
const nowVisible = as('outside@example.test', 'apiDownloadDocument', up.data.DocumentID);
check('flow: owner bulk-adds them to the team and access follows', bulkAssign.ok && bulkAssign.data.assigned === 1 && nowVisible.ok, JSON.stringify(bulkAssign.error || nowVisible.error));
const localPhone = as(LAWYER, 'apiSearch', '0100 999 0001');
const foundClient = localPhone.ok && localPhone.data.groups.filter((g) => g.entity === 'Clients')[0];
check('flow: global search finds +201009990001 from a local-format number', !!foundClient && foundClient.records.some((r) => r.ClientID === clientId), JSON.stringify(localPhone));
as(OWNER, 'apiCreate', 'Users', { FullName: 'Unassigned Lawyer', Email: 'unassigned@example.test', Role: 'LAWYER' });
const outsiderSearch = as('unassigned@example.test', 'apiSearch', 'Flow Lead');
check('flow: global search respects assignments', outsiderSearch.ok && outsiderSearch.data.groups.every((g) => g.entity !== 'Leads' && g.entity !== 'Clients'), JSON.stringify(outsiderSearch.data));
const lang = as(LAWYER, 'apiSetMyLanguage', 'AR');
const langBoot = as(LAWYER, 'apiGetAppBootstrap');
check('flow: language preference persists for the user', lang.ok && langBoot.ok && langBoot.data.language === 'AR' && langBoot.data.restricted === true);
const reminderStatus = as(OWNER, 'apiSetDailyReminders', true);
check('flow: owner turns on daily reminders (07:00 Cairo trigger)', reminderStatus.ok && runtime.triggers.length === 1 && runtime.triggers[0].spec.hour === 7 && runtime.triggers[0].spec.timeZone === 'Africa/Cairo');
check('flow: lawyer cannot change reminders', as(LAWYER, 'apiSetDailyReminders', false).ok === false);
const todayCairo = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Cairo' }).format(new Date());
const dueToday = as(LAWYER, 'apiCreate', 'FollowUps', { ClientID: clientId, AssignedTo: flowLawyer.data.UserID, Title: 'Call client about hearing', DueDate: todayCairo });
const sendResult = fn('dailyReminderTrigger')({ triggerUid: runtime.triggers[0].getUniqueId() });
const lawyerMail = runtime.outbox.filter((mail) => mail.to === LAWYER)[0];
check('flow: the genuine trigger emails the lawyer an Arabic digest with their task', dueToday.ok && sendResult.ok && !!lawyerMail && lawyerMail.body.indexOf('Call client about hearing') !== -1 && lawyerMail.htmlBody.indexOf('dir="rtl"') !== -1, JSON.stringify(dueToday.error || sendResult));
runtime.setActiveEmail(OWNER);

// Shared cache across requests: each browser call is a fresh Apps Script execution.
const newRequest = () => fn('mpResetExecutionCaches_')();
runtime.setActiveEmail(OWNER);
newRequest();
const cacheClient = as(OWNER, 'apiCreate', 'Clients', { FullName: 'Cache Client', Phone: '+201007770001' });
newRequest();
as(OWNER, 'apiGet', 'Clients', cacheClient.data.ClientID); // warms the shared snapshot
newRequest();
const cacheEdit = as(OWNER, 'apiUpdate', 'Clients', cacheClient.data.ClientID, { Notes: 'edited in request B' }, cacheClient.data.Version);
newRequest();
const afterEdit = as(OWNER, 'apiGet', 'Clients', cacheClient.data.ClientID);
check('cache: a change made in one request is seen by the next request', cacheEdit.ok && afterEdit.ok && afterEdit.data.Notes === 'edited in request B', JSON.stringify(afterEdit));
// A hand edit straight in the spreadsheet (bypassing the app) is not announced to the cache...
const sheetRows = fn('mpRows_')('Clients');
const handRow = sheetRows.records.filter((r) => r.ClientID === cacheClient.data.ClientID)[0];
sheetRows.sheet.getRange(handRow._rowNumber, sheetRows.headers.indexOf('Notes') + 1).setValue('typed in the sheet');
newRequest();
const staleRead = as(OWNER, 'apiGet', 'Clients', cacheClient.data.ClientID);
// ...but saves always read the real sheet under the lock, so the version check still protects the data.
newRequest();
const saveAfterHandEdit = as(OWNER, 'apiUpdate', 'Clients', cacheClient.data.ClientID, { Address: 'Zamalek' }, staleRead.data.Version);
newRequest();
const afterSave = as(OWNER, 'apiGet', 'Clients', cacheClient.data.ClientID);
check('cache: saves work from the real sheet, never from the cache', saveAfterHandEdit.ok && afterSave.data.Notes === 'typed in the sheet' && afterSave.data.Address === 'Zamalek', JSON.stringify(afterSave.data));
sheetRows.sheet.getRange(handRow._rowNumber, sheetRows.headers.indexOf('Nationality') + 1).setValue('Egyptian');
runtime.advanceCacheClock(16 * 60 * 1000);
newRequest();
check('cache: hand edits in the sheet appear after the 15-minute cache window', as(OWNER, 'apiGet', 'Clients', cacheClient.data.ClientID).data.Nationality === 'Egyptian');

// Email-code sign-in for personal Gmail accounts (Google does not identify them).
runtime.setActiveEmail('');
const viaCall = (token, name, args) => fn('apiCall')(token, name, args || []);
check('sign-in: no identity and no token is told to sign in', viaCall('', 'apiGetAppBootstrap').error.code === 'AUTH_REQUIRED');
const before = runtime.outbox.length;
const unknownReq = fn('apiRequestSignInCode')('stranger@gmail.com');
check('sign-in: unknown email gets the same answer and no email', unknownReq.ok && unknownReq.data.sent === true && runtime.outbox.length === before);
const knownReq = fn('apiRequestSignInCode')(LAWYER.toUpperCase());
const codeMail = runtime.outbox[runtime.outbox.length - 1];
const code = codeMail && (codeMail.subject.match(/(\d{6})/) || [])[1];
check('sign-in: active user is emailed a 6-digit code in their language', knownReq.ok && runtime.outbox.length === before + 1 && codeMail.to === LAWYER && !!code && codeMail.htmlBody.indexOf('dir="rtl"') !== -1);
const wrongCode = code === '000000' ? '111111' : '000000';
check('sign-in: wrong code is refused', fn('apiVerifySignInCode')(LAWYER, wrongCode).error.code === 'INVALID_CODE');
const verified = fn('apiVerifySignInCode')(LAWYER, code);
check('sign-in: right code returns a session token', verified.ok && /^[a-f0-9]{64}$/.test(verified.data.token));
check('sign-in: a code works only once', fn('apiVerifySignInCode')(LAWYER, code).ok === false);
const token = verified.ok ? verified.data.token : '';
const signedBoot = viaCall(token, 'apiGetAppBootstrap');
check('sign-in: token identifies the user through apiCall', signedBoot.ok && signedBoot.data.email === LAWYER && signedBoot.data.signedInWith === 'code', JSON.stringify(signedBoot.error));
check('sign-in: record rules still apply to signed-in users', viaCall(token, 'apiList', ['Transactions', {}]).ok === false);
check('sign-in: forged token is refused', viaCall('a'.repeat(64), 'apiGetAppBootstrap').error.code === 'AUTH_REQUIRED');
check('sign-in: unknown actions are refused', viaCall(token, 'setupDatabase').ok === false && viaCall(token, 'mpDbInsert_').ok === false);
fn('apiRequestSignInCode')(ASSISTANT);
const lockMail = runtime.outbox[runtime.outbox.length - 1];
const lockCode = (lockMail.subject.match(/(\d{6})/) || [])[1];
const bad = lockCode === '222222' ? '333333' : '222222';
for (let i = 0; i < 5; i += 1) fn('apiVerifySignInCode')(ASSISTANT, bad);
check('sign-in: five wrong tries burn the code', fn('apiVerifySignInCode')(ASSISTANT, lockCode).ok === false);
fn('apiRequestSignInCode')(ASSISTANT);
const lateMail = runtime.outbox[runtime.outbox.length - 1];
runtime.advanceCacheClock(11 * 60 * 1000);
check('sign-in: codes expire after 10 minutes', fn('apiVerifySignInCode')(ASSISTANT, (lateMail.subject.match(/(\d{6})/) || [])[1]).ok === false);
let limited = null;
for (let i = 0; i < 6; i += 1) limited = fn('apiRequestSignInCode')('rate@gmail.com');
check('sign-in: code requests are rate limited', limited.ok === false && limited.error.code === 'RATE_LIMITED');
runtime.setActiveEmail(OWNER);
const lawyerUser = fn('mpRows_')('Users').records.filter((u) => u.Email === LAWYER)[0];
fn('mpDbUpdate_')('Users', lawyerUser.UserID, { Status: 'INACTIVE' }, lawyerUser.Version, fn('mpRows_')('Users').records.filter((u) => u.Role === 'OWNER')[0].UserID);
runtime.setActiveEmail('');
const secretStored = fn('PropertiesService').getScriptProperties().getProperties();
check('sign-in: tokens are stored only as hashes', Object.keys(secretStored).every((key) => key.indexOf(token) === -1 && String(secretStored[key]).indexOf(token) === -1));
check('sign-in: deactivating a user ends their session immediately', viaCall(token, 'apiGetAppBootstrap').error.code === 'AUTH_REQUIRED');
runtime.setActiveEmail(OWNER);
check('sign-in: the owner is still recognised by Google without a code', viaCall('', 'apiGetAppBootstrap').ok === true);

// Codes belong to one user, every attempt is logged, and owners control limits and devices.
runtime.setActiveEmail('');
const otherEmail = 'unassigned@example.test';
fn('apiRequestSignInCode')(otherEmail);
fn('apiRequestSignInCode')(ASSISTANT);
const assistantMail = runtime.outbox[runtime.outbox.length - 1];
const assistantCode = (assistantMail.subject.match(/(\d{6})/) || [])[1];
check('codes: a code sent to one user does not work for another user', fn('apiVerifySignInCode')(otherEmail, assistantCode).ok === false);
check('codes: a code does not work for an email that is not a user', fn('apiVerifySignInCode')('intruder@gmail.com', assistantCode).ok === false);
const assistantSession = fn('apiVerifySignInCode')(ASSISTANT, assistantCode);
const assistantBoot = assistantSession.ok && fn('apiCall')(assistantSession.data.token, 'apiGetAppBootstrap', []);
check('codes: the code signs in exactly the user it was sent to', assistantBoot && assistantBoot.ok && assistantBoot.data.email === ASSISTANT, JSON.stringify(assistantSession.error));
check('security: non-owners cannot read the access log', fn('apiCall')(assistantSession.data.token, 'apiListAccessLog', [{}]).ok === false);
check('security: non-owners cannot clear limits or see devices', fn('apiCall')(assistantSession.data.token, 'apiClearSignInLimit', ['rate@gmail.com']).ok === false && fn('apiCall')(assistantSession.data.token, 'apiListSessions', []).ok === false);
runtime.setActiveEmail(OWNER);
const log = fn('apiCall')('', 'apiListAccessLog', [{ limit: 100 }]);
const events = log.ok ? log.data.records.map((r) => r.Event) : [];
check('security: the log shows unknown emails, wrong codes, lockouts, limits, sign-ins', ['CODE_UNKNOWN_EMAIL', 'CODE_WRONG', 'CODE_LOCKED', 'CODE_RATE_LIMITED', 'CODE_SENT', 'SIGNED_IN', 'CODE_MISSING', 'SESSION_REJECTED'].every((e) => events.indexOf(e) !== -1), JSON.stringify(Array.from(new Set(events))));
const intruder = log.ok && log.data.records.filter((r) => r.Email === 'intruder@gmail.com')[0];
check('security: attempts by people with no access are recorded with their email', !!intruder && intruder.Event === 'CODE_MISSING');
const problems = fn('apiCall')('', 'apiListAccessLog', [{ filter: 'problems' }]);
check('security: the problems filter hides normal sign-ins', problems.ok && problems.data.records.every((r) => r.Problem === true) && problems.data.total > 0);
runtime.setActiveEmail('');
check('security: the rate-limited email is still blocked', fn('apiRequestSignInCode')('rate@gmail.com').error.code === 'RATE_LIMITED');
runtime.setActiveEmail(OWNER);
const cleared = fn('apiCall')('', 'apiClearSignInLimit', ['rate@gmail.com']);
runtime.setActiveEmail('');
check('security: an owner can allow an immediate retry', cleared.ok && fn('apiRequestSignInCode')('rate@gmail.com').ok === true);
runtime.setActiveEmail(OWNER);
const sessions = fn('apiCall')('', 'apiListSessions', []);
const assistantDevice = sessions.ok && sessions.data.filter((s) => s.email === ASSISTANT)[0];
check('security: owners see signed-in devices', !!assistantDevice && !!assistantDevice.created && !!assistantDevice.expires && JSON.stringify(sessions.data).indexOf(assistantSession.data.token) === -1);
const revoked = fn('apiCall')('', 'apiRevokeSession', [assistantDevice.id]);
runtime.setActiveEmail('');
check('security: an owner can sign a device out remotely', revoked.ok && fn('apiCall')(assistantSession.data.token, 'apiGetAppBootstrap', []).error.code === 'AUTH_REQUIRED');
let flooded = null;
for (let i = 0; i < 70; i += 1) flooded = fn('apiRequestSignInCode')('random' + i + '@gmail.com');
runtime.setActiveEmail(OWNER);
const floodLog = fn('apiCall')('', 'apiListAccessLog', [{ limit: 100 }]).data.records.filter((r) => r.Event === 'FLOOD_PROTECTION');
check('security: scripted floods are paused and logged once', flooded.ok === false && flooded.error.code === 'RATE_LIMITED' && floodLog.length === 1);

// An existing database from before referrals existed: the new sheets appear on first use.
runtime.setActiveEmail(OWNER);
const liveDb = fn('mpGetDatabase_')();
['ExternalPartners', 'Referrals', 'ReferralWork', 'ReferralPayments'].forEach((name) => { const sheet = liveDb.getSheetByName(name); if (sheet) liveDb.deleteSheet(sheet); });
fn('mpResetExecutionCaches_')();
runtime.advanceCacheClock(60 * 60 * 1000);
const lawyerAfterUpdate = as('unassigned@example.test', 'apiStart');
const ownerReferrals = ['ExternalPartners', 'Referrals', 'ReferralWork', 'ReferralPayments'].map((name) => as(OWNER, 'apiListView', name, {})).filter((r) => !r.ok)[0] || { ok: true };
check('update: an older database gains the referral sheets automatically', lawyerAfterUpdate.ok && ownerReferrals.ok && ['ExternalPartners', 'Referrals', 'ReferralWork', 'ReferralPayments'].every((name) => !!liveDb.getSheetByName(name)), JSON.stringify({ lawyer: lawyerAfterUpdate.ok || lawyerAfterUpdate.error, owner: ownerReferrals.ok || ownerReferrals.error, sheets: ['ExternalPartners', 'Referrals', 'ReferralWork', 'ReferralPayments'].map((name) => !!liveDb.getSheetByName(name)) }));
runtime.setActiveEmail(OWNER);

// Static checks on the HTML Service files.
const app = fs.readFileSync(path.join(ROOT, 'App.html'), 'utf8');
const script = (app.match(/<script>([\s\S]*)<\/script>/) || [])[1] || '';
check('App.html has a script block', script.length > 0);
check('App.html script has no template scriptlet markers', script.indexOf('<?') === -1);
check('App.html never assigns innerHTML', !/\.innerHTML\s*=/.test(script) && !/insertAdjacentHTML/.test(script));
try { new Function(script); check('App.html script parses', true); } catch (error) { check('App.html script parses', false, error.message); }
const calledApis = Array.from(new Set((script.match(/call\('([A-Za-z]+)'/g) || []).map((m) => m.slice(6, -1))));
calledApis.forEach((name) => check(`client calls existing public function ${name}`, typeof fn(name) === 'function' && !name.endsWith('_')));
const i18n = fs.readFileSync(path.join(ROOT, 'I18n.html'), 'utf8');
const i18nScript = (i18n.match(/<script>([\s\S]*)<\/script>/) || [])[1] || '';
try {
  const win = {};
  new Function('window', i18nScript)(win);
  const ui = win.MP_I18N.ui;
  const missing = Object.keys(ui.en).filter((key) => !ui.ar[key]);
  check('I18n.html parses and every English UI string has Arabic', missing.length === 0, missing.join(', '));
  const usedKeys = Array.from(new Set((script.match(/\bt\('([A-Za-z.]+)'/g) || []).map((m) => m.slice(3, -1))));
  const unknown = usedKeys.filter((key) => !key.endsWith('.') && !ui.en[key]);
  check('App.html only uses defined UI strings', unknown.length === 0, unknown.join(', '));
  const enumValues = [].concat.apply([], ['ROLES', 'USER_STATUSES', 'CLIENT_TYPES', 'CLIENT_STATUSES', 'PRIORITIES', 'LEAD_STATUSES', 'LEAD_SOURCES', 'CASE_STATUSES',
    'FOLLOW_UP_STATUSES', 'CONSULTATION_STATUSES', 'PAYMENT_STATUSES', 'TRANSACTION_TYPES', 'PAYMENT_METHODS', 'CONFIDENTIALITY_LEVELS', 'DOCUMENT_ENTITY_TYPES', 'LANGUAGES']
    .map((name) => fn('MP_CONFIG')[name])).concat(fn('MP_DEFAULT_SETTINGS').PRACTICE_AREAS);
  const untranslated = Array.from(new Set(enumValues)).filter((value) => !win.MP_I18N.enums.ar[value]);
  check('every controlled value has an Arabic label', untranslated.length === 0, untranslated.join(', '));
  const schemaFields = Array.from(new Set([].concat.apply([], Object.values(fn('MP_SCHEMAS'))))).filter((f) => !/ID$/.test(f) || ['CaseID', 'ClientID', 'LeadID', 'CompanyID', 'ConsultationID', 'EntityID', 'ConvertedClientID', 'CreatedFromLeadID'].indexOf(f) !== -1);
  const ignore = ['IsArchived', 'Version', 'SettingKey', 'SettingValue', 'UpdatedBy', 'Action', 'PerformedBy', 'Timestamp', 'AddedBy', 'AddedAt', 'UserID', 'DriveFileID'];
  const noArabic = schemaFields.filter((f) => ignore.indexOf(f) === -1 && !win.MP_I18N.fields.ar[f]);
  check('every displayed field has an Arabic label', noArabic.length === 0, noArabic.join(', '));
} catch (error) { check('I18n.html parses', false, error.message); }
const index = fs.readFileSync(path.join(ROOT, 'Index.html'), 'utf8');
(index.match(/mpInclude_\('([A-Za-z0-9]+)'\)/g) || []).forEach((m) => {
  const file = m.slice(12, -2) + '.html';
  check(`Index.html include ${file} exists`, fs.existsSync(path.join(ROOT, file)));
});

console.log(failures ? `\n${failures} failure(s).` : '\nAll checks passed.');
process.exit(failures ? 1 : 0);
