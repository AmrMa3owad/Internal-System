# Mohamy Plus database template setup

`Mohamy_Plus_Database_Template.xlsx` is an empty import template generated from `MP_SCHEMAS`, `MP_CONFIG`, and `MP_DEFAULT_SETTINGS`. It contains seventeen entity worksheets and hidden `ValidationLists`. Only Settings defaults are populated; there are no users, leads, clients, cases, payments, or documents.

## Entity worksheets and relationships

- `Users` — approved staff accounts and roles.
- `Leads` — potential clients before qualification or conversion.
- `Clients` — individuals and company clients; an individual contact may reference a valid `CompanyID`.
- `Companies` — organization identity and contacts.
- `Cases` — legal matters belonging to a `ClientID`; `OpposingParties` supports review, never automatic conflict decisions.
- `Consultations` — appointments associated with a lead or client.
- `Transactions` — income/expense records; case-linked entries must use the case’s client.
- `FollowUps` — tasks linked to a lead, client, or case.
- `Activities` — append-only backend audit history.
- `Documents` — Drive file metadata linked to a lead, client, or case.
- `Settings` — serialized `MP_DEFAULT_SETTINGS` values.
- `ExternalPartners` — external lawyers and law firms the firm refers work to, with default share rates (they never sign in).
- `Referrals` — a case referred to a partner: scope, what they handle, the firm's share %, their final profit, and the computed amounts owed to the firm.
- `ReferralWork` — work our team does on a referral (e.g. administrative tasks), each with its own fee owed by the partner.
- `ReferralPayments` — money received from partners for a referral.
- `AccessLog` — every sign-in attempt (written only by the app; owners read it on the Security page).
- `Assignments` — extra staff team members on a lead, client, or case (managed only by the app; owners and partners add or remove them).

Relationships are `Companies → Clients`, `Leads → Clients`, `Clients → Cases`, and `Cases → Transactions`. User IDs supply assignment/recording references. Activities and Documents attach by entity type and ID.

## System-managed fields

Do not manually alter IDs, `Assignments` rows, document `DriveFileID`/`FileType`, `CreatedAt`, `UpdatedAt`, `LastLogin`, `UploadedAt`, `RecordedBy`, `IsArchived`, `ArchivedAt`, `Version`, activity rows, case `TotalPaid`/`OutstandingBalance`/`ClosedAt`, follow-up `CompletedAt`, lead `ConvertedClientID`, or client `CreatedFromLeadID`. Consultation `PaymentStatus`/`IsPaid` are recalculated from linked transactions. The backend owns these values. A negative outstanding balance represents an overpayment. IDs, phone numbers, commercial-registration numbers, tax numbers, and Settings JSON are kept in plain-text-formatted columns so leading zeros are preserved. Do not add formulas to database fields. Excel dropdowns are guidance only; they never replace server validation or authorization.

When the backend reports a possible duplicate, review the returned match list. Continuing requires an explicit `confirmDuplicate: true` request through an authorized application workflow; the backend logs that confirmation in Activities. It does not merge records automatically.

## Convert the workbook

1. Generate when needed with `python generate_database_template.py`, then run `python verify_database_template.py`.
2. Upload `Mohamy_Plus_Database_Template.xlsx` to the approved Google Drive account.
3. Choose **Open with → Google Sheets** to convert it.
4. Inspect before binding: all seventeen sheets must exist; headers in row 1 must exactly match `MP_SCHEMAS` in order; Settings must be intact; `ValidationLists` should remain hidden. The backend does not trust a spreadsheet only because its name matches.
5. Copy the spreadsheet ID from the URL between `/d/` and `/edit`.

## Bind and initialize

1. Create a standalone Apps Script project owned by the business Workspace account and add every `.gs` file.
2. As project owner in the Apps Script editor, run `setInitialOwnerEmail('approved-owner@your-domain.example')`.
3. Run `bindExistingDatabase('SPREADSHEET_ID')`. It validates the ID, opens the file, checks every required worksheet, exact header order, duplicate/missing/unexpected columns, and required Settings defaults. An incompatible spreadsheet is not bound and is never changed.
4. On success run `setupDatabase()`. It applies safe presentation/validation configuration and provisions the initial owner. It will not repair a nonblank incompatible schema, clear data, duplicate records, or reset an existing setting.
5. Run `getStage1DatabaseStatus()`.
6. Run `runStage1DatabaseTests()` only from the Apps Script editor after setup. It uses a temporary spreadsheet through an execution-local context, never changes the configured database ID, and moves test storage to Trash. The Apps Script project manifest is configured for `Africa/Cairo`, and setup applies the same timezone to the database spreadsheet.

## Security and platform limits

Do not put real confidential legal information in a template or converted sheet until Google Workspace identity, authorized Users, deployment restrictions, and Drive permissions are configured. Do not grant general staff direct Sheet edit access; direct edits bypass backend rules.

Apps Script may not expose `Session.getActiveUser().getEmail()` for consumer/external accounts or unsuitable deployment options. Administrative functions fail closed when identity cannot be verified. Sheets has no row-level security or ACID multi-sheet transactions; the backend uses locks, validation, write checks, audit logs, and explicit reconciliation errors, but cannot guarantee crash-proof relational transactions. Back up both the Sheet and Apps Script project regularly.
