#!/usr/bin/env node
/**
 * Counts the slow Google calls (opening the spreadsheet, sheet reads/writes,
 * row/column lookups, locks) for the app's main screens. Each new browser
 * request runs in a fresh Apps Script execution, so it is measured as one.
 *
 * Usage: node tools/perf-check.js
 */
'use strict';
const { createRuntime, STATS, resetStats } = require('./apps-script-runtime');

const runtime = createRuntime();
const fn = runtime.fn;
const exists = (name) => { try { return typeof fn(name) === 'function'; } catch (error) { return false; } };
fn('installMohamyPlus')();
const owner = fn('mpRows_')('Users').records[0];
const actor = owner.UserID;
const insert = fn('mpDbInsert_');
const lawyer = insert('Users', { FullName: 'Lawyer', Email: 'lawyer@perf.test', Role: 'LAWYER' }, actor);
for (let i = 0; i < 40; i += 1) {
  const client = insert('Clients', { FullName: 'Client ' + i, Phone: '+2010000' + String(10000 + i), AssignedTo: i % 2 ? lawyer.UserID : '' }, actor);
  const kase = insert('Cases', { CaseTitle: 'Case ' + i, ClientID: client.ClientID, AssignedLawyer: lawyer.UserID, AgreedFee: 1000 }, actor);
  insert('FollowUps', { CaseID: kase.CaseID, Title: 'Task ' + i, DueDate: '2026-12-0' + (1 + (i % 9)), AssignedTo: lawyer.UserID }, actor);
  insert('Leads', { FullName: 'Lead ' + i, Phone: '+2011000' + String(10000 + i), Source: 'PHONE', AssignedTo: lawyer.UserID }, actor);
}
const someCase = fn('mpRows_')('Cases').records[3].CaseID;

/** A fresh execution: Apps Script keeps no globals between browser requests. */
function freshExecution() { fn('mpInvalidateRows_')(); if (exists('mpResetExecutionCaches_')) fn('mpResetExecutionCaches_')(); }

function measure(label, who, work) {
  runtime.setActiveEmail(who);
  const rows = [];
  work.forEach((step) => {
    freshExecution();
    resetStats();
    const started = process.hrtime.bigint();
    const result = step[1]();
    if (result && result.ok === false) throw new Error(step[0] + ': ' + JSON.stringify(result.error));
    rows.push({ step: step[0], ...STATS, ms: Number(process.hrtime.bigint() - started) / 1e6 });
  });
  console.log('\n' + label);
  console.table(rows.map((row) => ({ step: row.step, 'open sheet': row.openById, 'sheet reads': row.reads, 'sheet writes': row.writes, 'row/col lookups': row.sheetInfo, locks: row.locks })));
  const total = rows.reduce((sum, row) => sum + row.openById * 600 + row.reads * 120 + row.writes * 250 + row.sheetInfo * 60 + row.locks * 80, 0);
  console.log('Estimated Google time for this sequence: ~' + (total / 1000).toFixed(1) + ' s (rough: open 0.6 s, read 0.12 s, write 0.25 s, lookup 0.06 s, lock 0.08 s)');
}

// Opening the app. Owner: the page arrives with its data (doGet does the work). Staff signed in by code: one apiStart call.
const pageWithData = () => {
  const actor = fn('mpRequireActiveUser_')();
  fn('mpGetSettingValue_')('BUSINESS_NAME');
  fn('mpTouchLastLogin_')(actor.userId);
  return fn('mpSuccess_')(fn('mpApiStart_')(actor));
};
const coldCache = () => runtime.advanceCacheClock(60 * 60 * 1000);
coldCache();
measure('Owner opens the app — first visit of the day (cache empty)', runtime.ownerEmail, [['page + data, one trip', pageWithData]]);
measure('Owner opens the app again (cache warm)', runtime.ownerEmail, [['page + data, one trip', pageWithData]]);
coldCache();
measure('Lawyer opens the app — first visit (cache empty)', 'lawyer@perf.test', [['apiStart, one trip', () => fn('apiStart')()]]);
measure('Lawyer opens the app again (cache warm)', 'lawyer@perf.test', [['apiStart, one trip', () => fn('apiStart')()]]);
measure('Owner opens a case (cache warm)', runtime.ownerEmail, [['case detail', () => fn('apiGetDetail')('Cases', someCase)]]);
measure('Owner lists clients (cache warm)', runtime.ownerEmail, [['clients list', () => fn('apiListView')('Clients', { limit: 30 })]]);
measure('Owner searches (cache warm)', runtime.ownerEmail, [['search', () => fn('apiSearch')('Client 1')]]);
