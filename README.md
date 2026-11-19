# MOHAMY PLUS — Stage 1 Database Foundation

This folder contains Google Apps Script source files for Stage 1 of the internal
Mohamy Plus legal CRM. Copy the `.gs` files into a standalone Apps Script
project, or use `clasp` if your team already uses it. No web application should
be deployed until Stage 2 authentication and authorization are in place.

## Initial setup

1. Create a **standalone** Google Apps Script project owned by the Mohamy Plus
   Google Workspace account.
2. Add `Code.gs`, `Config.gs`, `Database.gs`, `Validation.gs`, `Utilities.gs`,
   and `Activities.gs` from this folder.
3. In the Apps Script editor, run `setInitialOwnerEmail('owner@your-domain.com')`.
   Replace the example with the real approved Google account.
4. Run `setupDatabase()` and approve the requested Google Sheets permissions.
5. Run `runStage1DatabaseTests()`; it creates short-lived records and archives
   them after verification.

`setupDatabase()` creates and remembers a spreadsheet named
`MOHAMY PLUS - DATABASE`. It is idempotent: rerunning it adds missing sheets,
headers, formatting, filters, and default settings while preserving existing
rows. The spreadsheet ID is intentionally stored only in Script Properties.

## Stage 1 source files

- `Code.gs` — setup and maintenance entry points.
- `Config.gs` — schema, controlled vocabularies, and defaults.
- `Database.gs` — repository/data-access service layer.
- `Validation.gs` — server-side validation and duplicate detection.
- `Utilities.gs` — IDs, date handling, safe cell text, response helpers.
- `Activities.gs` — immutable activity logging service.

The Stage 2 web UI must call only role-checked API wrappers; it must never
expose the spreadsheet ID or call the data layer directly from the browser.
