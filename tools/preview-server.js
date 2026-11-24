#!/usr/bin/env node
/**
 * Local preview of the web app against the in-memory Apps Script fakes.
 *
 *   node tools/preview-server.js            -> http://127.0.0.1:8787
 *   PORT=9000 node tools/preview-server.js
 *
 * Seeds demo data (fictional people only) and lets you switch between the
 * OWNER, PARTNER, LAWYER, and ASSISTANT roles with the bar at the top of the
 * page. google.script.run is replaced by a shim that POSTs to /rpc; only
 * top-level functions named api* are callable, mirroring what a UI should use.
 * Data lives in memory and resets when the server restarts. Binds to
 * localhost only. This is a development aid, never a deployment.
 */
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const { createRuntime, ROOT } = require('./apps-script-runtime');

const PORT = Number(process.env.PORT || 8787);
const runtime = createRuntime({ ownerEmail: 'owner@demo.test', verbose: !!process.env.VERBOSE });
const fn = runtime.fn;

// ------------------------------------------------------------------ Seed
function must(response, label) {
  if (!response || response.ok !== true) throw new Error(label + ' failed: ' + JSON.stringify(response && response.error));
  return response.data;
}
must(fn('setInitialOwnerEmail')(runtime.ownerEmail), 'setInitialOwnerEmail');
must(fn('setupDatabase')(), 'setupDatabase');

const insert = fn('mpDbInsert_');
const update = fn('mpDbUpdate_');
const owner = fn('mpRows_')('Users').records[0];
const ownerId = owner.UserID;
update('Users', ownerId, { FullName: 'Amira Hassan' }, owner.Version, ownerId);

const cairo = (offsetDays, time) => {
  const parts = {};
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Cairo', year: 'numeric', month: '2-digit', day: '2-digit' })
    .formatToParts(new Date(Date.now() + offsetDays * 86400000)).forEach((p) => { parts[p.type] = p.value; });
  const day = `${parts.year}-${parts.month}-${parts.day}`;
  return time ? `${day}T${time}` : day;
};

const partner = insert('Users', { FullName: 'Karim Mostafa', Email: 'partner@demo.test', Role: 'PARTNER' }, ownerId);
const lawyer = insert('Users', { FullName: 'Nour El-Sayed', Email: 'lawyer@demo.test', Role: 'LAWYER' }, ownerId);
const assistant = insert('Users', { FullName: 'Omar Fathy', Email: 'assistant@demo.test', Role: 'ASSISTANT' }, ownerId);

const nile = insert('Companies', { CompanyName: 'Nile Delta Logistics', CommercialRegistrationNumber: '0012345', TaxNumber: '458-221-907', ContactPerson: 'Hany Adel', Phone: '0225550101', Email: 'legal@niledelta.example' }, ownerId);
const clientA = insert('Clients', { ClientType: 'COMPANY', FullName: 'Hany Adel', CompanyID: nile.CompanyID, Phone: '+201001110001', Email: 'hany@niledelta.example' }, ownerId);
const clientB = insert('Clients', { FullName: 'سارة محمود', Phone: '+201001110002', Address: 'المعادي، القاهرة', Nationality: 'Egyptian' }, ownerId);
const clientC = insert('Clients', { FullName: 'Youssef Ibrahim', Phone: '+201001110003', Email: 'youssef@example.test' }, ownerId);

const case1 = insert('Cases', { CaseNumber: '2026/114', CaseTitle: 'Warehouse lease dispute', ClientID: clientA.ClientID, PracticeArea: 'COMMERCIAL', AssignedLawyer: lawyer.UserID, Priority: 'HIGH', Status: 'IN_PROGRESS', StartDate: cairo(-40), Deadline: cairo(5), AgreedFee: 60000, OpposingParties: 'Delta Properties SAE' }, ownerId);
const case2 = insert('Cases', { CaseNumber: '2026/131', CaseTitle: 'قضية نفقة', ClientID: clientB.ClientID, PracticeArea: 'FAMILY', AssignedLawyer: lawyer.UserID, Priority: 'MEDIUM', Status: 'DOCUMENTS_REQUIRED', StartDate: cairo(-12), Deadline: cairo(12), AgreedFee: 15000 }, ownerId);
insert('Cases', { CaseNumber: '2026/090', CaseTitle: 'Unfair dismissal claim', ClientID: clientC.ClientID, PracticeArea: 'LABOR', AssignedLawyer: partner.UserID, Priority: 'LOW', Status: 'AWAITING_EXTERNAL_ACTION', StartDate: cairo(-75), AgreedFee: 20000 }, ownerId);

insert('Transactions', { ClientID: clientA.ClientID, CaseID: case1.CaseID, Type: 'INCOME', Amount: 25000, PaymentMethod: 'BANK_TRANSFER', PaymentDate: cairo(-30, '11:00'), Description: 'Retainer' }, assistant.UserID);
insert('Transactions', { ClientID: clientA.ClientID, CaseID: case1.CaseID, Type: 'INCOME', Amount: 10000, PaymentMethod: 'INSTAPAY', PaymentDate: cairo(-2, '15:30'), Description: 'Second instalment' }, assistant.UserID);
insert('Transactions', { ClientID: clientB.ClientID, CaseID: case2.CaseID, Type: 'INCOME', Amount: 5000, PaymentMethod: 'VODAFONE_CASH', PaymentDate: cairo(-1, '12:00') }, assistant.UserID);
insert('Transactions', { ClientID: clientA.ClientID, CaseID: case1.CaseID, Type: 'EXPENSE', Amount: 1200, PaymentMethod: 'CASH', PaymentDate: cairo(-1, '09:00'), Description: 'Court filing fees' }, assistant.UserID);

const leadNew = insert('Leads', { FullName: 'Mona Saleh', Phone: '+201001110010', Source: 'WHATSAPP', PracticeArea: 'REAL_ESTATE', Description: 'Disputed apartment title in Nasr City.', Priority: 'HIGH', AssignedTo: lawyer.UserID, NextFollowUpAt: cairo(0, '13:00') }, ownerId);
insert('Leads', { FullName: 'Tarek Nabil', Phone: '+201001110011', Source: 'FACEBOOK', PracticeArea: 'CRIMINAL', Status: 'CONTACTED', AssignedTo: partner.UserID, NextFollowUpAt: cairo(-1, '10:00') }, ownerId);
insert('Leads', { FullName: 'Laila Fouad', Email: 'laila@example.test', Source: 'WEBSITE', PracticeArea: 'CORPORATE', Status: 'CONSULTATION_SCHEDULED' }, ownerId);
insert('Leads', { FullName: 'Hossam Gaber', Phone: '+201001110013', Source: 'REFERRAL', Status: 'LOST', LostReason: 'Chose another firm' }, ownerId);

insert('Consultations', { LeadID: leadNew.LeadID, AssignedLawyer: lawyer.UserID, ConsultationType: 'In person', ConsultationDate: cairo(2, '11:00'), Duration: 45, Fee: 800, MeetingLocation: 'Main office' }, ownerId);
insert('Consultations', { ClientID: clientC.ClientID, AssignedLawyer: partner.UserID, ConsultationType: 'Video call', ConsultationDate: cairo(4, '17:00'), Duration: 30, Fee: 0, PaymentStatus: 'WAIVED' }, ownerId);

insert('FollowUps', { CaseID: case1.CaseID, ClientID: clientA.ClientID, AssignedTo: lawyer.UserID, Title: 'Prepare hearing memo', DueDate: cairo(1), Priority: 'HIGH' }, ownerId);
insert('FollowUps', { CaseID: case2.CaseID, ClientID: clientB.ClientID, AssignedTo: assistant.UserID, Title: 'Collect marriage certificate copy', DueDate: cairo(-2), Priority: 'MEDIUM' }, ownerId);
insert('FollowUps', { LeadID: leadNew.LeadID, AssignedTo: lawyer.UserID, Title: 'Send engagement proposal', DueDate: cairo(3) }, ownerId);

const ownerActor = { userId: ownerId, role: 'OWNER', email: runtime.ownerEmail, fullName: 'Amira Hassan' };
const upload = fn('mpUploadDocument_');
const b64 = (text) => Buffer.from(text, 'utf8').toString('base64');
upload(ownerActor, { EntityType: 'CASE', EntityID: case1.CaseID, ConfidentialityLevel: 'CONFIDENTIAL', Description: 'Signed lease, 2023' }, { name: 'Lease agreement.pdf', base64: b64('%PDF-1.4 demo lease agreement') });
upload(ownerActor, { EntityType: 'CASE', EntityID: case1.CaseID, ConfidentialityLevel: 'RESTRICTED' }, { name: 'Fee agreement (signed).pdf', base64: b64('%PDF-1.4 demo fee agreement') });
upload(ownerActor, { EntityType: 'CLIENT', EntityID: clientB.ClientID, ConfidentialityLevel: 'STANDARD' }, { name: 'National ID copy.txt', base64: b64('Demo national ID copy') });

// Assignments: the assistant handles the family client; the partner joins the lease case.
const addMember = fn('mpAddAssignment_');
addMember('Clients', clientB.ClientID, assistant.UserID, ownerId);
addMember('Cases', case1.CaseID, partner.UserID, ownerId);
const clientRow = fn('mpDbGetById_')('Clients', clientA.ClientID, false);
update('Clients', clientA.ClientID, { AssignedTo: lawyer.UserID }, clientRow.Version, ownerId);
const assistantRow = fn('mpDbGetById_')('Users', assistant.UserID, false);
update('Users', assistant.UserID, { Language: 'AR' }, assistantRow.Version, ownerId);

const IDENTITIES = { owner: runtime.ownerEmail, partner: 'partner@demo.test', lawyer: 'lawyer@demo.test', assistant: 'assistant@demo.test' };

// ---------------------------------------------------------------- Render
function escapeHtml(value) {
  return String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** ?screen=list:Cases | detail:Cases | form:Cases | edit:Cases | convert | upload | settings  (first active record is used). */
function startScreen(screen, actor) {
  if (!screen) return null;
  const [kind, entity] = String(screen).split(':');
  const first = (name) => fn('mpApiList_')(actor, name, { limit: 1, sortBy: fn('mpUiCreatedField_')(name) }).records[0];
  if (kind === 'list') return { route: { view: 'list', entity } };
  if (kind === 'settings') return { route: { view: 'settings' } };
  if (kind === 'detail') return { route: { view: 'detail', entity, id: first(entity)[fn('MP_SCHEMAS')[entity][0]] } };
  if (kind === 'form') return { route: { view: 'list', entity }, form: entity };
  if (kind === 'edit') return { route: { view: 'list', entity }, form: entity, record: first(entity) };
  if (kind === 'convert') return { route: { view: 'list', entity: 'Leads' }, convert: first('Leads') };
  if (kind === 'upload') return { route: { view: 'list', entity: 'Documents' }, upload: true };
  return null;
}

function renderIndex(as, screen) {
  runtime.setActiveEmail(IDENTITIES[as]);
  const user = fn('mpRequireActiveUser_')();
  const vars = { businessName: fn('mpGetSettingValue_')('BUSINESS_NAME'), userName: user.fullName };
  let html = fs.readFileSync(path.join(ROOT, 'Index.html'), 'utf8');
  html = html.replace(/<\?!=\s*mpInclude_\('([A-Za-z0-9]+)'\);?\s*\?>/g, (match, name) => {
    const file = fs.readFileSync(path.join(ROOT, name + '.html'), 'utf8');
    if (name !== 'App') return file;
    const start = JSON.stringify(startScreen(screen, user)).split('<').join('\\u003c');
    return SHIM + '<script>window.__MP_START__ = ' + start + ';</script>' + file;
  });
  html = html.replace(/<\?=\s*([A-Za-z]+)\s*\?>/g, (match, name) => escapeHtml(vars[name]));
  if (/<\?/.test(html)) throw new Error('Unrendered scriptlet left in Index.html');
  const bar = '<div style="position:fixed;top:0;left:50%;transform:translateX(-50%);z-index:100;background:#fff4e0;color:#a15c07;font:12px system-ui;padding:4px 10px;border-radius:0 0 8px 8px;box-shadow:0 2px 6px rgba(0,0,0,.15)">' +
    'Local preview (demo data) · view as: ' + Object.keys(IDENTITIES).map((role) => role === as ? `<strong>${role}</strong>` : `<a href="/?as=${role}">${role}</a>`).join(' · ') + '</div>';
  html = html.replace('<head>', '<head><meta name="viewport" content="width=device-width, initial-scale=1">');
  return html.replace('<body>', '<body>' + bar);
}

const SHIM = `<script>
(function () {
  var as = new URLSearchParams(location.search).get('as') || 'owner';
  function runner(handlers) {
    return new Proxy({}, { get: function (_, prop) {
      if (prop === 'withSuccessHandler') return function (f) { return runner(Object.assign({}, handlers, { ok: f })); };
      if (prop === 'withFailureHandler') return function (f) { return runner(Object.assign({}, handlers, { fail: f })); };
      return function () {
        var args = JSON.parse(JSON.stringify(Array.prototype.slice.call(arguments)));
        fetch('/rpc', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ fn: prop, args: args, as: as }) })
          .then(function (r) { return r.json(); })
          .then(function (body) { if (body.thrown) { if (handlers.fail) handlers.fail(new Error(body.thrown)); } else if (handlers.ok) handlers.ok(body.result); })
          .catch(function (e) { if (handlers.fail) handlers.fail(e); });
      };
    } });
  }
  window.google = { script: { run: runner({}) } };
})();
</script>
`;

// ---------------------------------------------------------------- Server
const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (req.method === 'GET' && url.pathname === '/') {
    const as = IDENTITIES[url.searchParams.get('as')] ? url.searchParams.get('as') : 'owner';
    try {
      const html = renderIndex(as, url.searchParams.get('screen'));
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(html);
    } catch (error) {
      res.writeHead(500, { 'Content-Type': 'text/plain' });
      res.end(String(error.stack || error));
    }
    return;
  }
  if (req.method === 'POST' && url.pathname === '/rpc') {
    let body = '';
    req.on('data', (chunk) => { body += chunk; if (body.length > 1e6) req.destroy(); });
    req.on('end', () => {
      let payload;
      try { payload = JSON.parse(body); } catch (error) { res.writeHead(400); res.end(); return; }
      const name = String(payload.fn || '');
      let result;
      let thrown = null;
      try {
        if (!/^api[A-Z]\w*$/.test(name) || typeof fn(name) !== 'function') throw new Error('Not an exposed API function: ' + name);
        runtime.setActiveEmail(IDENTITIES[payload.as] || IDENTITIES.owner);
        result = fn(name).apply(null, Array.isArray(payload.args) ? payload.args : []);
      } catch (error) { thrown = error.message; }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(thrown ? { thrown } : { result: result === undefined ? null : result }));
    });
    return;
  }
  res.writeHead(404); res.end();
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`Mohamy Plus preview on http://127.0.0.1:${PORT}/  (roles: ${Object.keys(IDENTITIES).map((r) => '?as=' + r).join(', ')})`);
});
