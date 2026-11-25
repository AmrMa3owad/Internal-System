# MOHAMY PLUS — internal legal CRM backend

This repository contains the internal Mohamy Plus legal CRM: the Stage 1 database foundation, the Stage 2 authorized application API, and the Stage 3 HTML Service web app. It contains no client data or credentials.

## Files

- `Config.gs` — schemas, controlled values, defaults, and system-managed fields.
- `Authorization.gs` — fail-closed identity and administrative authorization.
- `Database.gs` — schema inspection, safe setup, repository operations, duplicate detection, and financial reconciliation.
- `Validation.gs`, `Utilities.gs` — strict server-side validation, IDs, dates, and formula protection.
- `Activities.gs` — append-only audit service.
- `Api.gs` — Stage 2 application API: the only data entry points a UI may call.
- `WebApp.gs` — `doGet()`, plus the UI read models: form metadata, dashboard, record detail, and reference labels.
- `Access.gs` — record-level access for lawyers and assistants, record teams (`Assignments`), and bulk assignment.
- `Documents.gs` — file upload from the user's computer into the private documents folder, and checked downloads.
- `Reminders.gs` — daily email digests and their trigger.
- `Referrals.gs` — referral and partner-job money: shares, task fees, reimbursed expenses, settlement.
- `Backup.gs` — nightly copies of the database, and `restoreFromBackup()`.
- `Intake.gs` — `doPost()`: website and channel inquiries arrive as new leads.
- `LiveSync.gs` — live updates: the cache-only "what changed?" check (`apiSyncState`) and the trigger that notices hand edits in the spreadsheet.
- `Channels.gs` — WhatsApp, Messenger, Instagram, and lead-ad automation: incoming messages to leads and chats, the Inbox, replies, templates, auto-replies, and WhatsApp reminders.
- `relay/worker.js` — the Cloudflare Worker that checks Meta/TikTok signatures and forwards deliveries to the CRM (not uploaded to Apps Script).
- `CHANNELS_SETUP.md` — step-by-step setup for Meta, WhatsApp, Instagram, TikTok, and the relay.
- `I18n.html` — English and Arabic interface text.
- `Index.html`, `Styles.html`, `App.html` — the single-page web app (vanilla JS, no external libraries or CDNs).
- `Code.gs` — protected administrative wrappers and isolated runtime tests.
- `tools/apps-script-runtime.js` — in-memory fakes of the Apps Script services, shared by the local tools.
- `tools/preview-server.js` — local preview of the web app with demo data and a role switcher.
- `tools/local-test-harness.js` — runs the test suite locally against in-memory Apps Script fakes (not uploaded to Apps Script).
- `appsscript.json` — Apps Script V8 manifest with the `Africa/Cairo` project timezone.
- `Mohamy_Plus_Database_Template.xlsx` and `DATABASE_SETUP_GUIDE.md` — empty import template and conversion guide.

## Create and initialize the Apps Script project

1. Create a standalone Apps Script project owned by the Mohamy Plus Google Workspace owner account.
2. Add every `.gs` source file, including `Authorization.gs`.
3. In the Apps Script editor, as project owner, run `setInitialOwnerEmail('owner@your-workspace-domain.example')`.
4. Run `setupDatabase()` to create a new database, or convert the supplied Excel template and run `bindExistingDatabase('SPREADSHEET_ID')`.
5. After binding, run `setupDatabase()` and then `getStage1DatabaseStatus()`.

Use the Apps Script editor for these administrative actions. Do not make frontend buttons for them before the Stage 2 authorization review.

## Binding and rerunnable setup

`bindExistingDatabase()` opens the nominated spreadsheet and performs a read-only compatibility check before storing its ID in Script Properties. It rejects a sheet with missing worksheets, duplicate/missing/unexpected/out-of-order headers, or missing/incompatible default Settings. It does not bind or alter an incompatible spreadsheet.

`setupDatabase()` creates only missing sheets or headers in genuinely blank sheets. It refuses nonblank incompatible schemas, never clears operational data, never duplicates records, and never resets existing setting values. Its response lists created/configured sheets and added setting keys.

## Security boundary and identity limitations

Apps Script HTML Service can invoke a top-level server function through `google.script.run`; hiding a UI control is not authorization. Internal helpers use trailing `_` names, which HTML Service does not expose. The public administrative wrappers independently require a verified active Google account plus an active `OWNER` record; before users exist, bootstrap requires the Apps Script project owner.

`Session.getActiveUser().getEmail()` can be blank for consumer accounts, cross-domain access, or unsuitable deployment identity modes. These operations fail closed in that case. Deploy later only in a Google Workspace model that reliably exposes user identity, and restrict deployment sharing to approved staff. A URL is not access control.

Direct spreadsheet editors can bypass application validation. Restrict direct Sheet access to trusted administrators. Drive permissions, operational role APIs, and web deployment are later stages.

## Data integrity controls

- Permanent UUID IDs; row numbers are transient lookup locations only.
- `LockService`, optimistic `Version` checks, read-back write checks, formula-safe text, and soft archival.
- Activities are append-only. Generic operations cannot modify Activities or Settings.
- Timestamps, archive/version fields, actors, and case financial totals are server-managed.
- Duplicate detection reads the complete relevant sheet in one batch, not a paginated 100-record list.
- Duplicate matches return an error code and match list. A caller may continue only with explicit `confirmDuplicate: true`; that review decision is audit-logged.
- A case-linked transaction must use that case’s client, and a consultation-linked transaction must use that consultation’s client. Clients/cases/companies with active children cannot be archived.
- Case client reassignment is blocked when active transactions exist. Totals recalculate on transaction create, edit, type change, and archive; a negative outstanding balance explicitly represents an overpayment.
- Phone, registration/tax, all ID columns, and `Settings.SettingValue` are formatted as plain text. The spreadsheet timezone is set to `Africa/Cairo` during setup.

Google Sheets is not an ACID relational database. Multi-sheet operations are validated before writes, locked, flushed, read-back checked, and report an explicit reconciliation requirement if a dependent write fails. Crash-proof multi-sheet rollback is not available.

## Web app (Stage 3)

### Deploy

1. Push every `.gs` and `.html` file plus `appsscript.json` (with clasp, `.claspignore` already limits the push to those files).
2. Complete the database setup above and add each person to `Users` with the email address they will sign in with (Gmail or Workspace).
3. **Deploy → New deployment → Web app**: **Execute as: Me (the owner)**, **Who has access: Anyone with a Google account** (the manifest sets both).
4. Share the web app URL. Do **not** share the database spreadsheet or the documents folder.

Why this model: the script always runs with the owner's access, so staff never need, and must never get, direct Sheet access, which would bypass every backend rule.

### Signing in

- **Owner (the deploying account), or anyone in the same Google Workspace domain:** Google identifies them, so they go straight in.
- **Everyone else, including personal @gmail.com accounts:** Google does not tell an "execute as me" web app who the visitor is, so the app shows its own sign-in. The person enters their email, receives a 6-digit code by email, and is signed in on that device for 7 days (sign-ins made before this limit are also cut to 7 days). The **Sign out** button sits next to their name.
- Codes expire after 10 minutes and allow 5 attempts. Each email can request 5 codes per hour, and the answer never reveals whether an email is registered. Session tokens are stored only as salted hashes in Script Properties and are re-checked against an **active** `Users` record on every action, so setting someone `INACTIVE` signs them out immediately.
- Codes are sent with the owner's mail quota (about 100 recipients a day for a personal Gmail account), which reminders share.

### What it does

The interface is designed so a new staff member can use it without training:

- **Today:** a greeting and one "Your day" list of what needs you now (overdue and due tasks, today's consultations, near deadlines, leads to call back), each with a one-tap action: mark a task done, call, or WhatsApp. Owners and partners can switch between *Mine* and *Everyone*.
- **One search box** (Ctrl K) finds clients, cases, leads, companies, consultations, and tasks by name or phone. Egyptian local and international formats match each other (`0100 999 0001` finds `+20 100 999 0001`).
- **Short forms:** only the essential fields show; the rest sit under *More details*. Fields appear only when they apply (a company only for company clients), and new tasks default to today and to you.
- **Record pages:** a header with the status as a one-click menu and quick actions, then tabs (Overview, related records with counts, History). Empty fields are hidden, and cases show a payment progress bar.
- **Drag-and-drop uploads**, friendly dates ("Tomorrow", "2d overdue"), and empty states that say what to do next.

- Dashboard: open leads, cases, and follow-ups; overdue tasks; upcoming consultations and deadlines; the lead pipeline; and, for finance roles, this month's income and expenses and outstanding fees.
- A list per entity with search, status/priority filters, paging, and archived records (owners/partners).
- Record detail with related records and an "Add …" action pre-linked to the parent, plus audit history (owners/partners).
- Create/edit forms generated from server metadata already filtered for the user's role. Edits send only changed fields with the record `Version`, so conflicts are reported instead of overwritten.
- Duplicate review ("I reviewed these, save anyway"), lead → client conversion, archiving with confirmation, and owner settings.
- Every text value is inserted with `textContent` (never `innerHTML`). Inputs use `dir="auto"`, so Arabic text displays right-to-left. Date-time inputs are sent without an offset and interpreted as Cairo time.

### Design

The "Ink & Gold" design comes in **Light**, **Dark**, and **Auto** (follows the device). Switch it with the sun / moon / screen buttons at the bottom of the menu or under Settings → Your preferences. The choice is saved per browser and applied before the page appears, so there is no flash. Every colour comes from one set of tokens in `Styles.html` (`:root` for light, `html[data-theme="dark"]` for dark), so both modes stay consistent.

- The menu can collapse to an icon rail (the « button). Hovering an icon shows its name, and the choice is remembered.
- Glass cards over a soft aurora and blueprint-grid background, gold accents, and glowing status dots.
- Shimmering placeholders show the shape of each screen while it loads, and pages fade in.
- Motion is switched off for people whose device asks for reduced motion.

### Preview locally

```
node tools/preview-server.js     # http://127.0.0.1:8787  (add &theme=dark or &nav=collapsed)
```

This serves the real `Index.html`/`App.html` against the in-memory runtime, seeded with fictional demo data. Switch roles with the bar at the top (`?as=owner|partner|lawyer|assistant`). Data resets on restart. It binds to localhost only and is never a deployment.

## Stage 2 application API

`Api.gs` exposes these functions to `google.script.run`. Each one resolves the caller to an active, unarchived `Users` record (it fails closed if Apps Script cannot disclose the email), checks the caller's role, and returns `{ ok, data }` or `{ ok: false, error: { message, code?, duplicates? } }`.

| Function | Purpose |
| --- | --- |
| `apiGetCurrentUser()` | Identity, role, per-entity permissions, controlled values, and business settings for UI bootstrap; records `LastLogin`. |
| `apiList(entity, options)` | `options`: `limit`, `offset`, `query`, `filters` (`{Field: value}`), `sortBy`, `sortDirection`, `includeArchived` (owners/partners only). |
| `apiGet(entity, id)` / `apiCreate(entity, input)` / `apiUpdate(entity, id, input, expectedVersion)` / `apiArchive(entity, id, expectedVersion)` | Generic operations on Users, Leads, Clients, Companies, Cases, Consultations, Transactions, FollowUps, and Documents. |
| `apiConvertLead(leadId, expectedVersion, clientInput)` | Creates the client, marks the lead `CONVERTED`, and links the lead's unlinked consultations and follow-ups to the client. |
| `apiListActivities(entity, id, limit)` | Audit history for one record (owners/partners). |
| `apiGetAppBootstrap()`, `apiGetDashboard()`, `apiListView(entity, options)`, `apiGetDetail(entity, id)` | UI read models (in `WebApp.gs`): profile plus form metadata, the dashboard, lists with reference labels, and detail with related records and history. |
| `apiGetSettings()` / `apiUpdateSetting(key, value, expectedVersion)` | Read settings; owners may change `BUSINESS_NAME`, `PRACTICE_AREAS`, `NOTIFICATION_PREFERENCES`, and `FUTURE_INTEGRATIONS_ENABLED`. |

### Roles

The matrix lives in `MP_PERMISSIONS` in `Config.gs`. **These defaults are a proposal; confirm them with the firm before go-live.**

| Entity | Read | Create / update | Archive |
| --- | --- | --- | --- |
| Users | Owner, Partner | Owner | Owner |
| Leads, Clients, Companies, Consultations, FollowUps | All roles | All roles | Owner, Partner |
| Cases | All roles | Owner, Partner, Lawyer | Owner, Partner |
| Transactions | Owner, Partner, Assistant | Owner, Partner, Assistant | Owner, Partner |
| Documents | All roles, by confidentiality | Create: all; update: Owner, Partner | Owner, Partner |
| Activities | Owner, Partner | — | — |
| Settings | All roles | Owner | — |

- Roles without Transactions read access (Lawyer by default) do not see, filter, sort, search, or set `Cases.AgreedFee`, `TotalPaid`, or `OutstandingBalance`.
- Documents: `STANDARD` is visible to all roles, `CONFIDENTIAL` to Owner/Partner/Lawyer, and `RESTRICTED` to Owner/Partner. Hidden documents are reported as not found. Nobody can file a document above their own level.
- Lawyers and assistants also have **record-level** limits; see [Assigned records and teams](#assigned-records-and-teams).

### Business rules enforced by the backend

- User emails are unique among active users; this cannot be overridden with `confirmDuplicate`.
- At least one active `OWNER` must always remain.
- A user with open work (open leads/cases/follow-ups, scheduled consultations) cannot be archived. Reassign it first, or set the user `INACTIVE`.
- Leads become `CONVERTED` only through `apiConvertLead`; a converted lead cannot change status. Leads with active consultations, follow-ups, or documents cannot be archived; neither can consultations with active transactions.
- `Cases.ClosedAt` is set when status becomes `COMPLETED`/`CANCELLED` and cleared on reopen. `FollowUps.CompletedAt` behaves the same for `COMPLETED`.
- Consultation `PaymentStatus` is derived from linked INCOME transactions (unpaid, partially paid, paid) whenever they change; `WAIVED` is never overridden. `IsPaid` always equals `PaymentStatus === 'PAID'`.
- `PracticeArea` must be one of the `PRACTICE_AREAS` setting values. An area that active leads or cases still use cannot be removed.
- `Clients.Status` is `ACTIVE` or `INACTIVE`.
- Editable settings only need the right JSON shape to stay compatible. Every other setting must equal its code default.

## Assigned records and teams

Owners and partners see everything. Lawyers and assistants (`MP_CONFIG.RECORD_RESTRICTED_ROLES`) see only:

- leads, clients, and cases where they are the **main assignee** (`Leads.AssignedTo`, `Clients.AssignedTo`, `Cases.AssignedLawyer`) or a **team member** (the `Assignments` sheet)
- all cases of a client they are on, the client of any case they are on, and a lead together with the client it became
- consultations, follow-ups, payments, and documents linked to those records, plus any follow-up or consultation assigned to them

Companies stay a shared directory. Anything outside a user's scope looks "not found" to them: lists, search, record pickers, dashboard counts, reminders, and downloads all respect it, and duplicate warnings do not reveal another person's record. Restricted users can only link new work to records they can see, are added to the team of anything they create, and cannot change the main assignee.

To assign work (owners and partners):

- **One record:** open it, then use the **Team** card to add or remove members, or **Edit** it to change the main assignee.
- **Many records:** in the Leads, Clients, or Cases list, tick the rows, choose a staff member and *As main assignee* or *Add to team*, and click **Assign**.
- **Per person:** a user's page lists everything assigned to them and their team memberships.

Converting a lead keeps its assignee and team on the new client. A user with open assigned work cannot be archived; set them `INACTIVE` or reassign the work first.

## Documents

Staff click **Upload document** and choose a file from their computer (at most 10 MB; PDF, images, Office files, text, CSV, or ZIP). The server stores it in a private Drive folder, `MOHAMY PLUS - DOCUMENTS`, which `setupDatabase()` creates in the owner account. Staff never get Drive access: they download through the app, which checks confidentiality and assignment, confirms that the file is inside that folder, and records every download in the audit history. A document's Drive file ID is server-managed, so no record can point at any other Drive file.

## Email reminders

Under **Settings → Daily email reminders**, an owner can turn reminders on (a trigger runs every day at 07:00 Cairo time), send them immediately, or preview their own digest. Each active user receives one email, in their language, with their overdue follow-ups, follow-ups due today or tomorrow, today's and tomorrow's consultations, case deadlines in the next 3 days, and leads due for contact. Owners and partners also get a firm summary (overdue follow-ups and unassigned leads). Users with nothing due get no email. **Notification preferences** turns categories, or all email, on or off. `dailyReminderTrigger` refuses to run unless the call carries the uid of the project's own trigger. Mail uses the owner's Workspace quota (1,500 recipients a day).

## Arabic

Each user switches between English and العربية with the button at the bottom of the menu. The choice is saved on their user record (`Users.Language`) and also sets the language of their reminder emails. Arabic switches the layout to right-to-left and translates the menus, labels, status values, settings, history entries, and the most common server messages. Less common server messages and the content people type stay as written.

## Updating an existing database

You never need to rebuild the spreadsheet after an update. The first request after `clasp push` and a new deployment version upgrades it once:
missing sheets are created, missing columns are inserted at their place (existing data moves with its column, nothing is overwritten or removed),
and dropdown lists are refreshed. A sheet that has unexpected or reordered columns is left untouched and reported in **Executions**.
`setupDatabase()` and `bindExistingDatabase()` apply the same safe upgrade before checking compatibility.

## Tests

After setup, run `runStage1DatabaseTests()` from the Apps Script editor. It uses a new temporary spreadsheet through an execution-local database context, never changes `MP_DATABASE_SPREADSHEET_ID`, and moves the temporary file to Drive Trash. It does not touch production records.

The structured report covers CRUD/archive, UUIDs, version conflicts, protected fields, activity immutability, duplicates beyond 100 rows, strict booleans/dates, foreign keys, client/company rules, transaction reconciliation, setup reruns, compatible binding, and incompatible-schema rejection.

Run `node tools/local-test-harness.js` for a local check. It loads every `.gs` file with in-memory fakes of the Apps Script services, enforces strict sheet dropdown validation on writes, runs bootstrap, `setupDatabase()`, the full suite, and public API identity smoke tests. It approximates Google Sheets; it does **not** replace running `runStage1DatabaseTests()` in the real Apps Script project before go-live.

When regenerating the template, `python generate_database_template.py` writes only the workbook. The setup guide is hand-maintained; pass `--write-guide` only to deliberately overwrite it with the generator's version.

## External lawyers, referrals, and admin jobs

External lawyers and law firms are **partners**. They never sign in. The app records which work the firm handles itself, which it refers out, the administrative work our team does for partners, and what each partner owes the firm. Partners are listed under **External lawyers**, each with two default share rates (*if they handle everything* and *if we do part of the work*).

**Referrals & jobs** has three kinds (*Who does the work*):

| Kind | Our case? | What the partner owes us |
| --- | --- | --- |
| **They handle everything** (`FULL`) | Yes, referred out | Our share % of their final profit |
| **We do part of the work** (`SHARED`) | Yes, referred out | A bigger share % of their final profit, plus our task fees and expenses |
| **Admin work for them** (`ADMIN_ONLY`) | No — their matter | Our agreed fee for each task, plus the expenses we paid (transport, institution fees) |

- An **admin job** is started from the partner's page (**New admin job**). Give it a title (e.g. *Register a company at GAFI*) and assign a junior lawyer. That lawyer, and anyone added to its team, sees the job and its tasks on their home page, but none of the money.
- **Our tasks & expenses** (`ReferralWork`): each task has a date, who did it, the agreed **fee** (set by finance roles only), and **expenses we paid** that the partner reimburses (lawyers can record these).
- **Partner payments** (`ReferralPayments`): money received from the partner.

`Our share = final profit × share %` (none for admin jobs) · `Total owed = our share + task fees + expenses` · `Still owed = total owed − received`

**Settled** means everything owed is known *and* received. A referral is never settled while their final profit (and our share) is still missing — an unknown profit is not treated as zero — and an admin job is never settled before at least one task is priced. A completed referral that meets this becomes Settled automatically, and goes back to Completed if a payment is removed. Setting *Settled* by hand is refused unless both conditions hold.

**Acceptance:** start a referral as *Proposed* while the partner is deciding. When it becomes *Active*, the app records when, and who confirmed it (`AcceptedAt`, `AcceptedBy`).

Cases and clients referred out show **External · Firm** or **Shared · Firm**, and both lists filter to *Internal* or *External*; admin jobs never mark one of our cases as external. Owners and partners create referrals and jobs; finance roles see amounts and record partner payments; lawyers and assistants see a referral if they can see its case, are assigned to it or on its team, or logged work on it. A partner with active referrals, a referral with payments, or a user with an open assigned job cannot be archived.

## Consultation payments

A consultation's payment status comes from the payments recorded against it: none → *Unpaid*, less than the fee → *Partly paid*, the fee or more → *Paid*. Only owners and partners can mark a consultation *Paid* or *Waived* without matching payments, and they must write the reason (`PaymentNote`); the decision and reason go into its history. Other staff do not see these controls and simply record the payment. A consultation marked *Paid* by hand before this rule existed returns to its real status the next time it is saved.

## Income

**Income this month** on the home page = client payments (`Transactions`, type Income) **+** partner payments (`ReferralPayments`), shown with the split. They are two separate ledgers, so nothing is counted twice.

## Backups and restore

Every night at 02:00 (Cairo) a full copy of the database spreadsheet is saved in the private Drive folder **MOHAMY PLUS - BACKUPS**; the newest 30 are kept. `installMohamyPlus()` turns this on; owners can switch it off, see the last backup, or **Back up now** in **Settings**.

To restore: open the backup copy in Drive and check it, then in the Apps Script editor run `restoreFromBackup('<backup spreadsheet id>')`. The app switches to that copy after confirming it is a compatible database; the damaged spreadsheet is not changed. Practise this once before you rely on it.

## Website and channel leads

So no inquiry is missed, owners can turn on **Settings → Website leads**. This gives a private link. Your website form (or an automation tool such as Make or Zapier relaying WhatsApp, Instagram, or Facebook messages) sends each inquiry there as a `POST` with `name`, `phone` and/or `email`, `message`, and `source` (`WEBSITE`, `WHATSAPP`, `INSTAGRAM`, `FACEBOOK`, `TIKTOK`, …). Each one becomes a **New** lead, possible duplicates are kept and flagged in the lead's history for review, and owners and partners get an email.

**The firm's website ([github.com/AmrMa3owad/Mohamy-Plus](https://github.com/AmrMa3owad/Mohamy-Plus), a separate repository) is connected:** its `crm.intakeUrl` in `src/config.mjs` holds the private link; after issuing a new link, update it there, run `node src/build.mjs`, and publish. Its consultation wizard and contact form then save every request as a lead — with the practice area, priority (*Urgent* → High, *Time-sensitive* → Urgent), form, language, and the ad's `utm_source`/`utm_campaign` — and still open WhatsApp. The same submission sent twice within 10 minutes is saved once. To test locally, `node tools/preview-server.js` prints a local lead link and accepts posts at `/exec`.

Example for any other website form:

```html
<form method="POST" action="PASTE-THE-PRIVATE-LINK-HERE">
  <input name="name" required> <input name="phone"> <input name="email" type="email">
  <textarea name="message"></textarea> <input type="hidden" name="source" value="WEBSITE">
  <input name="website" style="display:none" tabindex="-1" autocomplete="off"> <!-- spam trap: leave empty -->
  <button>Send</button>
</form>
```

Without the right key nothing is saved. **Issue a new link** at any time and the old one stops working. More than 40 submissions in 10 minutes are refused. Reading WhatsApp or Instagram directly needs Meta's business APIs, which this app does not connect to; use an automation tool, or have someone enter those inquiries by hand.

## Messaging channels and the Inbox

WhatsApp chats, Messenger and Instagram messages, Facebook/Instagram comments, and Facebook/Instagram/TikTok lead-ad forms arrive automatically through a small Cloudflare relay (`relay/worker.js`) that checks each platform's signature, because Apps Script cannot. Setup: **[CHANNELS_SETUP.md](CHANNELS_SETUP.md)**.

- A new sender becomes a **New lead** (source WhatsApp / Facebook / Instagram / TikTok; phone, or a social profile when there is no phone), or joins the existing client or lead with the same WhatsApp number. Owners and partners are emailed.
- **Inbox** (menu, with an unread count): every chat with its history, delivery ticks, and a reply box. Owners and partners assign chats; the assignee joins the lead's or client's team. Lawyers and assistants see chats assigned to them or linked to their records.
- Meta's rules are enforced: free replies within 24 hours of the person's last message; after that, WhatsApp uses an approved **template** and Messenger/Instagram wait for them to write; one private reply per comment within 7 days.
- **Instant auto-reply** (Arabic or English, matched to their message) on the first message, and again after a chosen number of quiet days.
- **WhatsApp reminders** the day before each consultation, from an approved template (name, date, time), sent once.
- Lead and client pages have a **WhatsApp chat** button and a Chats tab.
- Owners manage tokens (write-only), the relay link, auto-replies, templates, and reminders in **Settings → Channels**, which also lists recent deliveries and lets failed lead forms be retried.

`node tools/channels-test.mjs` runs the whole path locally: signed webhooks through the real relay code into the CRM, with a stand-in for Meta's API.

## Security page (owners)

**More → Security** shows:

- **Sign-in activity:** every attempt, newest first, filterable to *Problems* (unknown emails, wrong or expired codes, lockouts, hourly limits, Google accounts that are not users, deactivated users trying a saved sign-in, flood protection) or *Successful*. Entries live in the `AccessLog` sheet, which is created automatically on first use.
- **Allow retry now:** clears an email's 1-hour limit (and any half-used code) so they can request a code immediately. This is also offered next to each limit, lockout, and wrong-code entry.
- **Signed-in devices:** everyone signed in with an email code, with when they signed in and when it expires. Owners can sign a device out remotely.

A code is stored against the one email it was sent to and only signs in that user. More than 60 code requests in 10 minutes, across all emails, pauses new requests and logs it once. Apps Script does not reveal a visitor's IP address or device, so an attempt appears in the log once the person types an email, or immediately if they open the app with a Google account that is not a user.

## Speed

- Opening the app is one round trip: owners get the first screen built into the page, and code-signed-in staff make one `apiStart` call.
- Sheet contents are kept in Apps Script's shared cache for 15 minutes, with a version stamp per sheet. Every change made through the app replaces that stamp. Saves always read the real sheet under the lock, so edit-conflict checks never use a cached copy.
- **Live updates, no refresh needed.** Every open screen asks every 5 seconds (15 seconds when the window is in the background, never when the tab is hidden) which sheets changed. That call reads only the cache. If the screen shows changed data (a list, a record, Today, the Inbox), it reloads quietly. It never interrupts someone typing, an open form, an open menu, or selected text; the update waits until they finish. The Inbox badge follows new messages everywhere.
- **Edits typed directly into the spreadsheet** are picked up the same way, through an installable *on change* trigger that `installMohamyPlus()` adds (and `restoreFromBackup()` moves to the restored copy). Without it, hand edits still appear within 15 minutes.
- The browser keeps screens you have visited and shows them instantly, then refreshes them quietly. Any change you make clears them.
- `LastLogin` is written at most every 6 hours instead of on every visit.
- `node tools/perf-check.js` counts the slow Google calls each screen makes. Actions slower than 2.5 s are logged under **Executions** in Apps Script.

## Known platform limits

Google Sheets has quotas, finite execution time, no row-level security, and no full multi-sheet transactions. Full-sheet duplicate scans are correct but must be monitored as data grows. Back up the spreadsheet and Apps Script project regularly and test recovery from a separate copy.
