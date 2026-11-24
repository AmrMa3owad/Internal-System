/**
 * Administrative wrappers are intentionally the only public Stage 1 functions.
 * Every wrapper independently checks identity and an OWNER role (or project
 * owner during bootstrap). Internal functions end in _ and cannot be invoked
 * through google.script.run.
 */
function setInitialOwnerEmail(email) {
  try {
    mpRequireProjectOwner_();
    const properties = PropertiesService.getScriptProperties();
    if (properties.getProperty(MP_CONFIG.DATABASE_ID_PROPERTY)) throw new Error('The database is already bound. The initial owner cannot be changed through bootstrap setup.');
    const normalized = mpValidateEmail_(email, 'Owner email', true);
    properties.setProperty(MP_CONFIG.INITIAL_OWNER_PROPERTY, normalized);
    return mpSuccess_({ message: 'Initial owner saved. Run setupDatabase() next.' });
  } catch (error) { console.error(error); return mpFailure_(error); }
}

function setupDatabase() {
  try {
    mpRequireAdministratorOrBootstrapOwner_();
    return mpSuccess_(mpSetupDatabase_());
  } catch (error) { console.error(error); return mpFailure_(error); }
}

function mpBindExistingDatabase_(spreadsheetId, persistBinding) {
  if (!spreadsheetId || !/^[a-zA-Z0-9_-]{20,}$/.test(String(spreadsheetId))) throw new Error('A valid Google Sheets spreadsheet ID is required.');
  const spreadsheet = SpreadsheetApp.openById(String(spreadsheetId));
  const report = mpInspectDatabaseCompatibility_(spreadsheet);
  if (!report.compatible) {
    throw new Error('Spreadsheet is incompatible and was not bound. ' + report.issues.join(' '));
  }
  if (persistBinding !== false) PropertiesService.getScriptProperties().setProperty(MP_CONFIG.DATABASE_ID_PROPERTY, String(spreadsheetId));
  return report;
}

/** Validates first; never changes an incompatible spreadsheet or its data. */
function bindExistingDatabase(spreadsheetId) {
  try {
    mpRequireAdministratorOrBootstrapOwner_();
    return mpSuccess_(mpBindExistingDatabase_(spreadsheetId));
  } catch (error) { console.error(error); return mpFailure_(error); }
}

function getStage1DatabaseStatus() {
  try {
    mpRequireAdministrator_();
    const database = mpGetDatabase_();
    return mpSuccess_({ name: database.getName(), initialized: true, sheetNames: Object.keys(MP_SCHEMAS) });
  } catch (error) { return mpFailure_(error); }
}

function mpTestAssert_(condition, message) { if (!condition) throw new Error(message); }
function mpTestExpectError_(callback, message) {
  try { callback(); } catch (error) { return error.message; }
  throw new Error(message || 'Expected operation to fail.');
}

function mpTestRun_(results, name, callback) {
  try { callback(); results.push({ name: name, passed: true }); }
  catch (error) { results.push({ name: name, passed: false, error: error.message }); }
}

function mpTestSeedCompaniesBeyondPage_(count) {
  const result = mpRows_('Companies');
  const rows = [];
  const now = mpNowIso_();
  for (let index = 0; index < count; index += 1) {
    const email = 'stage1-duplicate-' + index + '@example.test';
    const record = { CompanyID: mpNewId_('Companies'), CompanyName: 'Stage 1 Bulk ' + index, CommercialRegistrationNumber: '', TaxNumber: '', ContactPerson: '', Phone: '', Email: email, Address: '', Notes: '', CreatedAt: now, IsArchived: false, ArchivedAt: '', Version: 1 };
    rows.push(mpRecordValues_(result.headers, record));
  }
  mpInvalidateRows_('Companies');
  result.sheet.getRange(result.sheet.getLastRow() + 1, 1, rows.length, result.headers.length).setValues(rows);
  SpreadsheetApp.flush();
}

/**
 * Runs entirely in a newly-created temporary spreadsheet selected through an
 * execution-local context. It never changes MP_DATABASE_SPREADSHEET_ID.
 */
function mpRunStage1DatabaseTests_() {
  const properties = PropertiesService.getScriptProperties();
  const originalDatabaseId = properties.getProperty(MP_CONFIG.DATABASE_ID_PROPERTY);
  const results = [];
  let sandbox = null;
  let documentsFolder = null;
  const previousDocumentsFolder = MP_EXECUTION_DOCUMENTS_FOLDER_ID_;
  try {
    sandbox = SpreadsheetApp.create('MOHAMY PLUS - STAGE 1 TEST - ' + Utilities.getUuid());
    documentsFolder = DriveApp.createFolder('MOHAMY PLUS - TEST DOCUMENTS - ' + Utilities.getUuid());
    MP_EXECUTION_DOCUMENTS_FOLDER_ID_ = documentsFolder.getId();
    mpWithDatabaseContext_(sandbox.getId(), function() {
    mpSetupDatabase_({ spreadsheet: sandbox });
    const owner = mpRows_('Users').records.filter(function(user) { return user.Role === 'OWNER' && user.IsArchived !== true; })[0];
    mpTestAssert_(!!owner, 'Temporary database did not provision an owner.');
    const actor = owner.UserID;
    let company, client, caseRecord, transaction;

    mpTestRun_(results, 'setup rerun preserves schema and data', function() {
      const first = mpSetupDatabase_();
      const second = mpSetupDatabase_();
      mpTestAssert_(first.rerunnable && second.rerunnable && mpGetDatabase_().getSpreadsheetTimeZone() === MP_CONFIG.DATE_TIMEZONE && mpInspectDatabaseCompatibility_(mpGetDatabase_()).compatible, 'Setup rerun, timezone, or compatibility failed.');
    });
    mpTestRun_(results, 'Settings JSON comparison accepts converted FALSE text', function() {
      const settings = mpRows_('Settings');
      const record = settings.records.filter(function(item) { return item.SettingKey === 'FUTURE_INTEGRATIONS_ENABLED'; })[0];
      const column = settings.headers.indexOf('SettingValue') + 1;
      settings.sheet.getRange(record._rowNumber, column).setValue('FALSE');
      mpTestAssert_(mpInspectDatabaseCompatibility_(mpGetDatabase_()).compatible, 'Converted FALSE setting was treated as incompatible.');
    });
    mpTestRun_(results, 'create, read, update, UUID uniqueness, and archive', function() {
      company = mpDbInsert_('Companies', { CompanyName: 'Stage 1 Test Company', Email: 'company@example.test', Phone: '01012345678' }, actor);
      client = mpDbInsert_('Clients', { ClientType: 'COMPANY', FullName: 'Stage 1 Test Client', CompanyID: company.CompanyID, Email: 'client@example.test', Phone: '+201000000002' }, actor);
      const read = mpDbGetById_('Clients', client.ClientID, false);
      const companyRead = mpDbGetById_('Companies', company.CompanyID, false);
      const companySheet = mpSheet_('Companies');
      const phoneColumn = mpHeaders_(companySheet).indexOf('Phone') + 1;
      mpTestAssert_(read && read.ClientID === client.ClientID && company.CompanyID !== client.ClientID && companyRead.Phone === '01012345678' && companySheet.getRange(2, phoneColumn).getNumberFormat() === '@', 'Create/read, UUID uniqueness, or plain-text phone round-trip failed.');
      client = mpDbUpdate_('Clients', client.ClientID, { Notes: 'Updated safely.' }, client.Version, actor);
      const disposable = mpDbInsert_('Clients', { ClientType: 'INDIVIDUAL', FullName: 'Disposable Test Client', Email: 'dispose@example.test', Phone: '+201000000003' }, actor);
      const archived = mpDbArchive_('Clients', disposable.ClientID, disposable.Version, actor);
      mpTestAssert_(archived.IsArchived === true && !mpDbGetById_('Clients', disposable.ClientID, false), 'Archive behavior failed.');
    });
    mpTestRun_(results, 'optimistic concurrency and protected fields', function() {
      mpTestExpectError_(function() { mpDbUpdate_('Clients', client.ClientID, { Notes: 'stale' }, 1, actor); }, 'Stale version update was accepted.');
      mpTestExpectError_(function() { mpDbUpdate_('Clients', client.ClientID, { CreatedAt: mpNowIso_() }, client.Version, actor); }, 'Protected CreatedAt update was accepted.');
      mpTestExpectError_(function() { mpDbInsert_('Cases', { CaseID: mpNewId_('Cases') }, actor); }, 'Protected ID input was accepted.');
    });
    mpTestRun_(results, 'activity log is append-only', function() {
      const activity = mpRows_('Activities').records[0];
      mpTestAssert_(!!activity, 'Expected an activity record.');
      mpTestExpectError_(function() { mpDbUpdate_('Activities', activity.ActivityID, { Description: 'tamper' }, 1, actor); }, 'Activity update was accepted.');
      mpTestExpectError_(function() { mpDbArchive_('Activities', activity.ActivityID, 1, actor); }, 'Activity archive was accepted.');
      mpTestExpectError_(function() { mpDbInsert_('Activities', {}, actor); }, 'Generic activity insert was accepted.');
    });
    mpTestRun_(results, 'duplicate detection covers more than 100 records', function() {
      mpTestSeedCompaniesBeyondPage_(101);
      const matches = mpFindDuplicates_('Companies', { Email: 'stage1-duplicate-100@example.test' }, '');
      mpTestAssert_(matches.length === 1, 'Duplicate in record 101 was not detected.');
      let duplicateError;
      try { mpDbInsert_('Companies', { CompanyName: 'Unreviewed Duplicate', Email: 'stage1-duplicate-100@example.test' }, actor); }
      catch (error) { duplicateError = error; }
      const response = mpFailure_(duplicateError);
      mpTestAssert_(response.error.code === 'DUPLICATE' && response.error.duplicates.length === 1, 'Duplicate failure details were not preserved.');
      const confirmed = mpDbInsert_('Companies', { CompanyName: 'Reviewed Duplicate', Email: 'stage1-duplicate-100@example.test', confirmDuplicate: true }, actor);
      const activity = mpListActivities_('Companies', confirmed.CompanyID, 10).filter(function(item) { return item.Action === 'DUPLICATE_REVIEW_CONFIRMED'; })[0];
      mpTestAssert_(!!activity, 'Confirmed duplicate was not logged.');
    });
    mpTestRun_(results, 'strict boolean, date, foreign-key, and company relationship validation', function() {
      mpTestExpectError_(function() { mpDbInsert_('Consultations', { ClientID: client.ClientID, ConsultationDate: '2026-01-01T10:00:00+02:00', Duration: 30, IsPaid: 'maybe', Fee: 0 }, actor); }, 'Invalid boolean was accepted.');
      mpTestExpectError_(function() { mpDbInsert_('Consultations', { ClientID: client.ClientID, ConsultationDate: '2026-02-30', Duration: 30, IsPaid: true, Fee: 0 }, actor); }, 'Invalid date was accepted.');
      mpTestExpectError_(function() { mpDbInsert_('Clients', { ClientType: 'COMPANY', FullName: 'Invalid Company Client', Email: 'badcompany@example.test' }, actor); }, 'Company client without CompanyID was accepted.');
      mpTestExpectError_(function() { mpDbInsert_('Clients', { ClientType: 'INDIVIDUAL', FullName: 'Invalid Relationship', CompanyID: 'CMP-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA', Email: 'invalidrelationship@example.test' }, actor); }, 'Invalid company foreign key was accepted.');
      mpTestExpectError_(function() { mpDbInsert_('Cases', { CaseTitle: 'Invalid Foreign Key', ClientID: 'CLT-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA', Priority: 'MEDIUM', Status: 'INITIAL_REVIEW', AgreedFee: 1 }, actor); }, 'Invalid case client foreign key was accepted.');
    });
    mpTestRun_(results, 'transaction relationship and financial recalculation', function() {
      caseRecord = mpDbInsert_('Cases', { CaseTitle: 'Stage 1 Financial Case', ClientID: client.ClientID, Priority: 'MEDIUM', Status: 'INITIAL_REVIEW', AgreedFee: 1000, OpposingParties: 'Test Opponent' }, actor);
      const otherClient = mpDbInsert_('Clients', { ClientType: 'INDIVIDUAL', FullName: 'Other Client', Email: 'other@example.test', Phone: '+201000000004' }, actor);
      mpTestExpectError_(function() { mpDbInsert_('Transactions', { ClientID: otherClient.ClientID, CaseID: caseRecord.CaseID, Type: 'INCOME', Amount: 10, PaymentMethod: 'CASH', PaymentDate: '2026-01-01T10:00:00+02:00' }, actor); }, 'Mismatched transaction client/case was accepted.');
      transaction = mpDbInsert_('Transactions', { ClientID: client.ClientID, CaseID: caseRecord.CaseID, Type: 'INCOME', Amount: 250, PaymentMethod: 'CASH', PaymentDate: '2026-01-01T10:00:00+02:00' }, actor);
      const consultation = mpDbInsert_('Consultations', { ClientID: client.ClientID, ConsultationDate: '2026-01-02T10:00:00+02:00', Duration: 30, IsPaid: false, Fee: 0 }, actor);
      mpTestExpectError_(function() { mpDbInsert_('Transactions', { ClientID: otherClient.ClientID, ConsultationID: consultation.ConsultationID, Type: 'INCOME', Amount: 10, PaymentMethod: 'CASH', PaymentDate: '2026-01-02T10:00:00+02:00' }, actor); }, 'Mismatched transaction client/consultation was accepted.');
      const protectedCase = mpDbGetById_('Cases', caseRecord.CaseID, false);
      mpTestExpectError_(function() { mpDbUpdate_('Cases', caseRecord.CaseID, { ClientID: otherClient.ClientID }, protectedCase.Version, actor); }, 'Case client changed despite active transactions.');
      mpTestExpectError_(function() { mpDbArchive_('Cases', caseRecord.CaseID, protectedCase.Version, actor); }, 'Case archived despite active transactions.');
      mpTestExpectError_(function() { mpDbArchive_('Clients', client.ClientID, client.Version, actor); }, 'Client archived despite active cases.');
      mpTestExpectError_(function() { mpDbArchive_('Companies', company.CompanyID, company.Version, actor); }, 'Company archived despite active clients.');
      let refreshed = mpDbGetById_('Cases', caseRecord.CaseID, false);
      mpTestAssert_(Number(refreshed.TotalPaid) === 250 && Number(refreshed.OutstandingBalance) === 750, 'Initial transaction totals are wrong.');
      transaction = mpDbUpdate_('Transactions', transaction.TransactionID, { Amount: 1200 }, transaction.Version, actor);
      refreshed = mpDbGetById_('Cases', caseRecord.CaseID, false);
      mpTestAssert_(Number(refreshed.TotalPaid) === 1200 && Number(refreshed.OutstandingBalance) === -200, 'Overpayment balance is wrong.');
      transaction = mpDbUpdate_('Transactions', transaction.TransactionID, { Type: 'EXPENSE' }, transaction.Version, actor);
      refreshed = mpDbGetById_('Cases', caseRecord.CaseID, false);
      mpTestAssert_(Number(refreshed.TotalPaid) === 0 && Number(refreshed.OutstandingBalance) === 1000, 'Type-change totals are wrong.');
      transaction = mpDbArchive_('Transactions', transaction.TransactionID, transaction.Version, actor);
      refreshed = mpDbGetById_('Cases', caseRecord.CaseID, false);
      mpTestAssert_(Number(refreshed.TotalPaid) === 0 && Number(refreshed.OutstandingBalance) === 1000, 'Archived transaction totals are wrong.');
    });
    mpTestRun_(results, 'user emails are unique without override and the last owner is protected', function() {
      mpTestExpectError_(function() { mpDbInsert_('Users', { FullName: 'Duplicate Owner', Email: String(owner.Email).toUpperCase(), Role: 'LAWYER', confirmDuplicate: true }, actor); }, 'Duplicate user email was accepted with confirmDuplicate.');
      const current = mpDbGetById_('Users', actor, false);
      mpTestExpectError_(function() { mpDbUpdate_('Users', actor, { Role: 'PARTNER' }, current.Version, actor); }, 'The last owner was demoted.');
      mpTestExpectError_(function() { mpDbUpdate_('Users', actor, { Status: 'INACTIVE' }, current.Version, actor); }, 'The last owner was deactivated.');
      mpTestExpectError_(function() { mpDbArchive_('Users', actor, current.Version, actor); }, 'The last owner was archived.');
    });
    mpTestRun_(results, 'case ClosedAt and follow-up CompletedAt are server-managed lifecycle dates', function() {
      let lifecycle = mpDbInsert_('Cases', { CaseTitle: 'Lifecycle Case', ClientID: client.ClientID, AgreedFee: 0 }, actor);
      mpTestAssert_(!lifecycle.ClosedAt, 'New open case has ClosedAt.');
      lifecycle = mpDbUpdate_('Cases', lifecycle.CaseID, { Status: 'COMPLETED' }, lifecycle.Version, actor);
      mpTestAssert_(!!lifecycle.ClosedAt, 'Completed case has no ClosedAt.');
      lifecycle = mpDbUpdate_('Cases', lifecycle.CaseID, { Status: 'IN_PROGRESS' }, lifecycle.Version, actor);
      mpTestAssert_(!lifecycle.ClosedAt, 'Reopened case kept ClosedAt.');
      let task = mpDbInsert_('FollowUps', { CaseID: lifecycle.CaseID, Title: 'Lifecycle task', DueDate: '2026-03-01' }, actor);
      mpTestAssert_(!task.CompletedAt, 'Open follow-up has CompletedAt.');
      task = mpDbUpdate_('FollowUps', task.FollowUpID, { Status: 'COMPLETED' }, task.Version, actor);
      mpTestAssert_(!!task.CompletedAt, 'Completed follow-up has no CompletedAt.');
      mpTestExpectError_(function() { mpDbUpdate_('Cases', lifecycle.CaseID, { ClosedAt: '2026-01-01' }, lifecycle.Version, actor); }, 'Manual ClosedAt was accepted.');
    });
    mpTestRun_(results, 'client status is a controlled value', function() {
      mpTestExpectError_(function() { mpDbInsert_('Clients', { FullName: 'Bad Status', Email: 'badstatus@example.test', Status: 'MAYBE' }, actor); }, 'Invalid client status was accepted.');
    });
    mpTestRun_(results, 'consultation payment status follows linked transactions', function() {
      let consultation = mpDbInsert_('Consultations', { ClientID: client.ClientID, ConsultationDate: '2026-01-05T10:00:00+02:00', Duration: 60, Fee: 500 }, actor);
      mpTestAssert_(consultation.PaymentStatus === 'UNPAID' && consultation.IsPaid === false, 'New consultation is not UNPAID.');
      mpDbInsert_('Transactions', { ClientID: client.ClientID, ConsultationID: consultation.ConsultationID, Type: 'INCOME', Amount: 200, PaymentMethod: 'INSTAPAY', PaymentDate: '2026-01-05T11:00:00+02:00' }, actor);
      consultation = mpDbGetById_('Consultations', consultation.ConsultationID, false);
      mpTestAssert_(consultation.PaymentStatus === 'PARTIALLY_PAID' && consultation.IsPaid === false, 'Partial payment not reflected.');
      const second = mpDbInsert_('Transactions', { ClientID: client.ClientID, ConsultationID: consultation.ConsultationID, Type: 'INCOME', Amount: 300, PaymentMethod: 'CASH', PaymentDate: '2026-01-05T12:00:00+02:00' }, actor);
      consultation = mpDbGetById_('Consultations', consultation.ConsultationID, false);
      mpTestAssert_(consultation.PaymentStatus === 'PAID' && consultation.IsPaid === true, 'Full payment not reflected.');
      mpDbArchive_('Transactions', second.TransactionID, second.Version, actor);
      consultation = mpDbGetById_('Consultations', consultation.ConsultationID, false);
      mpTestAssert_(consultation.PaymentStatus === 'PARTIALLY_PAID', 'Archived payment not reflected.');
      mpTestExpectError_(function() { mpDbArchive_('Consultations', consultation.ConsultationID, consultation.Version, actor); }, 'Consultation archived despite active transactions.');
      let manual = mpDbInsert_('Consultations', { ClientID: client.ClientID, ConsultationDate: '2026-01-06T10:00:00+02:00', Duration: 30, Fee: 100, IsPaid: false }, actor);
      manual = mpDbUpdate_('Consultations', manual.ConsultationID, { IsPaid: true }, manual.Version, actor);
      mpTestAssert_(manual.PaymentStatus === 'PAID' && manual.IsPaid === true, 'IsPaid-only update did not re-derive PaymentStatus.');
    });
    let convertedLead;
    mpTestRun_(results, 'lead conversion, practice areas, and lead archive protection', function() {
      mpTestExpectError_(function() { mpDbInsert_('Leads', { FullName: 'Bad Area', Phone: '+201000000011', Source: 'WEBSITE', PracticeArea: 'ASTROLOGY' }, actor); }, 'Unknown practice area was accepted.');
      mpTestExpectError_(function() { mpDbInsert_('Leads', { FullName: 'Pre-converted', Phone: '+201000000012', Source: 'WEBSITE', Status: 'CONVERTED' }, actor); }, 'Lead created as CONVERTED.');
      const lead = mpDbInsert_('Leads', { FullName: 'Lead Person', Phone: '+201000000010', Source: 'REFERRAL', PracticeArea: 'civil', Description: 'Needs help with a contract.' }, actor);
      mpTestAssert_(lead.PracticeArea === 'CIVIL', 'Practice area was not normalized.');
      const leadConsultation = mpDbInsert_('Consultations', { LeadID: lead.LeadID, ConsultationDate: '2026-01-07T10:00:00+02:00', Duration: 30, Fee: 0 }, actor);
      mpDbInsert_('FollowUps', { LeadID: lead.LeadID, Title: 'Call back lead', DueDate: '2026-01-08' }, actor);
      mpTestExpectError_(function() { mpDbArchive_('Leads', lead.LeadID, lead.Version, actor); }, 'Lead archived despite an active consultation.');
      mpTestExpectError_(function() { mpDbUpdate_('Leads', lead.LeadID, { Status: 'CONVERTED' }, lead.Version, actor); }, 'Generic update converted a lead.');
      const converted = mpConvertLead_(lead.LeadID, lead.Version, { Email: 'leadperson@example.test' }, actor);
      convertedLead = converted.lead;
      mpTestAssert_(converted.lead.Status === 'CONVERTED' && converted.lead.ConvertedClientID === converted.client.ClientID && converted.client.CreatedFromLeadID === lead.LeadID, 'Conversion did not link lead and client.');
      mpTestAssert_(converted.client.Notes === 'Needs help with a contract.' && converted.client.Email === 'leadperson@example.test', 'Conversion did not carry over lead details.');
      mpTestAssert_(converted.relinked.consultations === 1 && converted.relinked.followUps === 1, 'Lead work was not relinked to the client.');
      mpTestAssert_(mpDbGetById_('Consultations', leadConsultation.ConsultationID, false).ClientID === converted.client.ClientID, 'Consultation ClientID was not set.');
      mpTestExpectError_(function() { mpConvertLead_(lead.LeadID, converted.lead.Version, {}, actor); }, 'Lead converted twice.');
      mpTestExpectError_(function() { mpDbUpdate_('Leads', lead.LeadID, { Status: 'NEW' }, converted.lead.Version, actor); }, 'Converted lead status was reverted.');
    });
    mpTestRun_(results, 'editable settings validate input and keep the database compatible', function() {
      const byKey = {};
      mpListSettings_().forEach(function(setting) { byKey[setting.key] = setting; });
      mpUpdateSetting_('BUSINESS_NAME', 'Mohamy Plus Test Office', byKey.BUSINESS_NAME.version, actor);
      mpTestAssert_(mpGetSettingValue_('BUSINESS_NAME') === 'Mohamy Plus Test Office', 'Business name did not update.');
      mpTestAssert_(mpInspectDatabaseCompatibility_(mpGetDatabase_()).compatible, 'Edited setting made the database incompatible.');
      mpSetupDatabase_();
      mpTestExpectError_(function() { mpUpdateSetting_('CURRENCY', 'USD', byKey.CURRENCY.version, actor); }, 'Fixed setting was changed.');
      mpTestExpectError_(function() { mpUpdateSetting_('PRACTICE_AREAS', ['CRIMINAL'], byKey.PRACTICE_AREAS.version, actor); }, 'An in-use practice area was removed.');
      mpTestExpectError_(function() { mpUpdateSetting_('FUTURE_INTEGRATIONS_ENABLED', 'yes', byKey.FUTURE_INTEGRATIONS_ENABLED.version, actor); }, 'Non-boolean setting was accepted.');
      mpTestExpectError_(function() { mpUpdateSetting_('BUSINESS_NAME', 'Stale', byKey.BUSINESS_NAME.version, actor); }, 'Stale setting version was accepted.');
    });
    mpTestRun_(results, 'role permissions, financial redaction, and document confidentiality', function() {
      const ownerActor = { userId: actor, role: 'OWNER', email: owner.Email, fullName: owner.FullName };
      const lawyer = mpApiCreate_(ownerActor, 'Users', { FullName: 'Test Lawyer', Email: 'lawyer@example.test', Role: 'LAWYER' });
      const assistant = mpApiCreate_(ownerActor, 'Users', { FullName: 'Test Assistant', Email: 'assistant@example.test', Role: 'ASSISTANT' });
      const lawyerActor = { userId: lawyer.UserID, role: 'LAWYER', email: lawyer.Email, fullName: lawyer.FullName };
      const assistantActor = { userId: assistant.UserID, role: 'ASSISTANT', email: assistant.Email, fullName: assistant.FullName };
      // Record-level access: the lawyer is on the case team, the assistant on the client team.
      mpTestExpectError_(function() { mpApiGet_(lawyerActor, 'Cases', caseRecord.CaseID); }, 'Unassigned lawyer opened a case.');
      mpApiAddTeamMember_(ownerActor, 'Cases', caseRecord.CaseID, lawyer.UserID);
      mpApiAddTeamMember_(ownerActor, 'Clients', client.ClientID, assistant.UserID);
      mpTestExpectError_(function() { mpApiCreate_(lawyerActor, 'Users', { FullName: 'Escalation', Email: 'escalate@example.test', Role: 'OWNER' }); }, 'Lawyer created a user.');
      mpTestExpectError_(function() { mpApiList_(lawyerActor, 'Transactions', {}); }, 'Lawyer listed transactions.');
      mpTestExpectError_(function() { mpApiCreate_(assistantActor, 'Cases', { CaseTitle: 'No', ClientID: client.ClientID }); }, 'Assistant created a case.');
      mpTestExpectError_(function() { mpApiList_(lawyerActor, 'Activities', {}); }, 'Generic API exposed Activities.');
      const lawyerView = mpApiGet_(lawyerActor, 'Cases', caseRecord.CaseID);
      mpTestAssert_(lawyerView.CaseTitle && lawyerView.AgreedFee === undefined && lawyerView.TotalPaid === undefined && lawyerView.OutstandingBalance === undefined, 'Lawyer saw case financials.');
      mpTestAssert_(mpApiGet_(assistantActor, 'Cases', caseRecord.CaseID).AgreedFee !== undefined, 'Finance role could not see case financials.');
      mpTestExpectError_(function() { mpApiUpdate_(lawyerActor, 'Cases', caseRecord.CaseID, { AgreedFee: 5 }, lawyerView.Version); }, 'Lawyer changed AgreedFee.');
      mpTestExpectError_(function() { mpApiList_(lawyerActor, 'Cases', { sortBy: 'AgreedFee' }); }, 'Lawyer sorted by a financial field.');
      mpTestExpectError_(function() { mpApiList_(lawyerActor, 'Cases', { includeArchived: true }); }, 'Lawyer listed archived records.');
      const updated = mpApiUpdate_(lawyerActor, 'Cases', caseRecord.CaseID, { Description: 'Lawyer note' }, lawyerView.Version);
      mpTestAssert_(updated.Description === 'Lawyer note' && updated.AgreedFee === undefined, 'Lawyer update failed or leaked financials.');
      const pdf = Utilities.base64Encode('%PDF-1.4 test');
      const restricted = mpUploadDocument_(ownerActor, { EntityType: 'CASE', EntityID: caseRecord.CaseID, ConfidentialityLevel: 'RESTRICTED' }, { name: 'restricted.pdf', base64: pdf });
      mpUploadDocument_(ownerActor, { EntityType: 'CASE', EntityID: caseRecord.CaseID, ConfidentialityLevel: 'STANDARD' }, { name: 'standard.pdf', base64: pdf });
      const visible = mpApiList_(assistantActor, 'Documents', { filters: { EntityID: caseRecord.CaseID } });
      mpTestAssert_(visible.total === 1 && visible.records[0].FileName === 'standard.pdf', 'Assistant saw a restricted document.');
      const hidden = mpTestExpectError_(function() { mpApiGet_(assistantActor, 'Documents', restricted.DocumentID); }, 'Assistant opened a restricted document.');
      mpTestAssert_(hidden === 'Record was not found.', 'Restricted document existence was disclosed.');
      mpTestExpectError_(function() { mpUploadDocument_(assistantActor, { EntityType: 'CASE', EntityID: caseRecord.CaseID, ConfidentialityLevel: 'CONFIDENTIAL' }, { name: 'x.pdf', base64: pdf }); }, 'Assistant filed above their clearance.');
      const payment = mpApiCreate_(assistantActor, 'Transactions', { ClientID: client.ClientID, CaseID: caseRecord.CaseID, Type: 'INCOME', Amount: 100, PaymentMethod: 'VODAFONE_CASH', PaymentDate: '2026-01-10T10:00:00+02:00' });
      mpTestAssert_(payment.RecordedBy === assistant.UserID, 'RecordedBy is not the acting user.');
      const profile = mpApiGetCurrentUser_(lawyerActor);
      mpTestAssert_(profile.canSeeFinancials === false && profile.permissions.Cases.indexOf('archive') === -1 && profile.business.name === 'Mohamy Plus Test Office', 'Current-user profile is wrong.');
      const history = mpApiListActivities_(ownerActor, 'Leads', convertedLead.LeadID, 10);
      mpTestAssert_(history.some(function(item) { return item.Action === 'CONVERTED'; }), 'Conversion activity is missing.');
      mpTestExpectError_(function() { mpApiConvertLead_(assistantActor, convertedLead.LeadID, convertedLead.Version, {}); }, 'Converted lead was converted again through the API.');
    });
    mpTestRun_(results, 'users with open work cannot be archived', function() {
      const busy = mpDbInsert_('Users', { FullName: 'Busy Lawyer', Email: 'busy@example.test', Role: 'LAWYER' }, actor);
      mpDbInsert_('FollowUps', { ClientID: client.ClientID, AssignedTo: busy.UserID, Title: 'Open work', DueDate: '2026-02-01' }, actor);
      mpTestExpectError_(function() { mpDbArchive_('Users', busy.UserID, busy.Version, actor); }, 'User with open work was archived.');
    });
    mpTestRun_(results, 'form-submitted local date-times are read as Cairo wall time', function() {
      const winter = mpDateIso_('2026-01-05T10:00', 'ConsultationDate', true);
      const summer = mpDateIso_('2026-07-05T10:00', 'ConsultationDate', true);
      mpTestAssert_(winter === '2026-01-05T10:00:00+02:00', 'Winter local time parsed as ' + winter + '.');
      mpTestAssert_(summer.indexOf('2026-07-05T10:00:00') === 0, 'Summer local time parsed as ' + summer + '.');
      mpTestAssert_(mpDateIso_('2026-03-01', 'DueDate', true).indexOf('2026-03-01T00:00:00') === 0, 'Date-only value did not map to local midnight.');
      mpTestExpectError_(function() { mpDbInsert_('Leads', { FullName: 'Bad Assignee', Phone: '+201000000013', Source: 'PHONE', AssignedTo: 'USR-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' }, actor); }, 'Lead assigned to a missing user.');
    });
    mpTestRun_(results, 'web read models respect roles: forms, dashboard, detail, labels', function() {
      const ownerActor = { userId: actor, role: 'OWNER', email: owner.Email, fullName: owner.FullName };
      const lawyerUser = mpRows_('Users').records.filter(function(user) { return user.Email === 'lawyer@example.test'; })[0];
      const lawyerActor = { userId: lawyerUser.UserID, role: 'LAWYER', email: lawyerUser.Email, fullName: lawyerUser.FullName };
      const ownerBoot = mpApiBootstrap_(ownerActor);
      const lawyerBoot = mpApiBootstrap_(lawyerActor);
      const fieldNames = function(boot, entity) { return boot.forms[entity].fields.map(function(field) { return field.name; }); };
      mpTestAssert_(fieldNames(ownerBoot, 'Cases').indexOf('AgreedFee') !== -1, 'Owner case form lacks AgreedFee.');
      mpTestAssert_(fieldNames(lawyerBoot, 'Cases').indexOf('AgreedFee') === -1, 'Lawyer case form exposes AgreedFee.');
      mpTestAssert_(!lawyerBoot.forms.Transactions && !lawyerBoot.forms.Users, 'Lawyer received forms for unreadable entities.');
      mpTestAssert_(fieldNames(ownerBoot, 'Cases').indexOf('TotalPaid') === -1 && fieldNames(ownerBoot, 'Consultations').indexOf('IsPaid') === -1, 'System-managed or derived fields are in forms.');
      const caseClient = lawyerBoot.forms.Cases.fields.filter(function(field) { return field.name === 'ClientID'; })[0];
      mpTestAssert_(caseClient.type === 'reference' && caseClient.ref === 'Clients' && caseClient.required === true, 'Case ClientID metadata is wrong.');
      mpTestAssert_(lawyerBoot.users.some(function(user) { return user.UserID === actor; }), 'Assignable users missing for lawyer.');
      const ownerDashboard = mpApiDashboard_(ownerActor);
      const lawyerDashboard = mpApiDashboard_(lawyerActor);
      mpTestAssert_(!!ownerDashboard.sections.finance && !lawyerDashboard.sections.finance, 'Finance section visibility is wrong.');
      mpTestAssert_(lawyerDashboard.sections.cases.open >= 1 && lawyerDashboard.sections.followUps.open >= 1, 'Dashboard counts are missing.');
      const detail = mpApiDetail_(lawyerActor, 'Clients', client.ClientID);
      mpTestAssert_(detail.related.Cases.total >= 1 && !detail.related.Transactions, 'Client detail related records are wrong for a lawyer.');
      mpTestAssert_(detail.activities === null, 'Lawyer received activity history.');
      mpTestAssert_(detail.labels[company.CompanyID] === 'Stage 1 Test Company', 'Company label was not resolved.');
      mpTestAssert_(detail.related.Cases.records.every(function(item) { return item.AgreedFee === undefined; }), 'Related cases leaked financials.');
      const ownerDetail = mpApiDetail_(ownerActor, 'Cases', caseRecord.CaseID);
      mpTestAssert_(ownerDetail.related.Transactions.total >= 1 && Array.isArray(ownerDetail.activities) && ownerDetail.labels[client.ClientID] === 'Stage 1 Test Client', 'Owner case detail is incomplete.');
      const documents = ownerDetail.related.Documents.records;
      mpTestAssert_(documents.length === 2 && documents.every(function(item) { return item.UploadedBy === actor && !!item.UploadedAt; }), 'Documents lack uploader metadata.');
      const view = mpApiListWithLabels_(lawyerActor, 'Cases', { filters: { ClientID: client.ClientID } });
      mpTestAssert_(view.labels[client.ClientID] === 'Stage 1 Test Client', 'List labels were not resolved.');
    });
    mpTestRun_(results, 'record-level access: assignment, teams, creator access, links, reassignment, bulk', function() {
      const ownerActor = { userId: actor, role: 'OWNER', email: owner.Email, fullName: owner.FullName };
      const findUser = function(email) { return mpRows_('Users').records.filter(function(user) { return user.Email === email; })[0]; };
      const lawyerUser = findUser('lawyer@example.test');
      const lawyerActor = { userId: lawyerUser.UserID, role: 'LAWYER', email: lawyerUser.Email, fullName: lawyerUser.FullName };
      const other = mpApiCreate_(ownerActor, 'Users', { FullName: 'Second Lawyer', Email: 'second@example.test', Role: 'LAWYER' });
      const otherActor = { userId: other.UserID, role: 'LAWYER', email: other.Email, fullName: other.FullName };
      const theirs = mpApiCreate_(ownerActor, 'Leads', { FullName: 'Their Lead', Phone: '+201000000020', Source: 'PHONE', AssignedTo: other.UserID });
      mpTestAssert_(mpApiGet_(otherActor, 'Leads', theirs.LeadID).LeadID === theirs.LeadID, 'Assignee cannot open their lead.');
      const notMine = mpTestExpectError_(function() { mpApiGet_(lawyerActor, 'Leads', theirs.LeadID); }, 'Lawyer opened a lead assigned to someone else.');
      mpTestAssert_(notMine === 'Record was not found.', 'Unassigned lead existence was disclosed.');
      mpTestAssert_(!mpApiList_(lawyerActor, 'Leads', {}).records.some(function(lead) { return lead.LeadID === theirs.LeadID; }), 'Unassigned lead appeared in a list.');
      mpTestAssert_(!mpApiList_(lawyerActor, 'Leads', { query: 'Their Lead' }).total, 'Search revealed an unassigned lead.');
      const mine = mpApiCreate_(lawyerActor, 'Leads', { FullName: 'Self Lead', Phone: '+201000000021', Source: 'REFERRAL' });
      mpTestAssert_(mpApiGet_(lawyerActor, 'Leads', mine.LeadID).LeadID === mine.LeadID, 'Creator lost access to an unassigned lead.');
      mpTestAssert_(mpApiGetTeam_(ownerActor, 'Leads', mine.LeadID).members.some(function(member) { return member.UserID === lawyerUser.UserID; }), 'Creator was not added to the team.');
      mpTestExpectError_(function() { mpApiUpdate_(lawyerActor, 'Leads', mine.LeadID, { AssignedTo: other.UserID }, mine.Version); }, 'Restricted user reassigned a lead.');
      mpTestExpectError_(function() { mpApiCreate_(lawyerActor, 'FollowUps', { LeadID: theirs.LeadID, Title: 'Sneaky', DueDate: '2026-03-01' }); }, 'Restricted user linked to an unassigned lead.');
      const dup = mpTestExpectError_(function() { mpApiCreate_(lawyerActor, 'Leads', { FullName: 'Copy', Phone: '+201000000020', Source: 'PHONE' }); }, 'Duplicate lead not reported.');
      mpTestAssert_(/duplicate/i.test(dup), 'Duplicate error missing.');
      let duplicateError;
      try { mpApiCreate_(lawyerActor, 'Leads', { FullName: 'Copy', Phone: '+201000000020', Source: 'PHONE' }); } catch (error) { duplicateError = error; }
      mpTestAssert_(duplicateError.duplicates.length === 1 && duplicateError.duplicates[0].hidden === true && duplicateError.duplicates[0].fullName === '', 'Duplicate match outside scope leaked details.');
      const team = mpApiAddTeamMember_(ownerActor, 'Leads', theirs.LeadID, lawyerUser.UserID);
      mpTestAssert_(mpApiGet_(lawyerActor, 'Leads', theirs.LeadID).LeadID === theirs.LeadID, 'Team member cannot open the lead.');
      const membership = team.members.filter(function(member) { return member.UserID === lawyerUser.UserID; })[0];
      mpApiRemoveTeamMember_(ownerActor, membership.AssignmentID);
      mpTestExpectError_(function() { mpApiGet_(lawyerActor, 'Leads', theirs.LeadID); }, 'Removed team member kept access.');
      mpTestExpectError_(function() { mpApiAddTeamMember_(lawyerActor, 'Leads', mine.LeadID, other.UserID); }, 'Lawyer managed a team.');
      mpTestExpectError_(function() { mpApiBulkAssign_(lawyerActor, 'Leads', [mine.LeadID], other.UserID, 'main'); }, 'Lawyer bulk-assigned.');
      const bulkLead = mpApiCreate_(ownerActor, 'Leads', { FullName: 'Bulk Lead', Phone: '+201000000022', Source: 'PHONE' });
      const bulk = mpApiBulkAssign_(ownerActor, 'Leads', [bulkLead.LeadID, theirs.LeadID], lawyerUser.UserID, 'main');
      mpTestAssert_(bulk.assigned === 2 && mpApiGet_(lawyerActor, 'Leads', bulkLead.LeadID).AssignedTo === lawyerUser.UserID, 'Bulk main assignment failed.');
      mpTestExpectError_(function() { mpApiGet_(otherActor, 'Leads', theirs.LeadID); }, 'Previous assignee kept access after reassignment.');
      const bulkTeam = mpApiBulkAssign_(ownerActor, 'Cases', [caseRecord.CaseID], other.UserID, 'team');
      mpTestAssert_(bulkTeam.assigned === 1 && mpApiGet_(otherActor, 'Cases', caseRecord.CaseID).CaseID === caseRecord.CaseID, 'Bulk team assignment failed.');
      mpTestAssert_(mpApiGet_(otherActor, 'Clients', client.ClientID).ClientID === client.ClientID, 'Case access did not extend to its client.');
      mpTestExpectError_(function() { mpApiList_(otherActor, 'Transactions', {}); }, 'Lawyer listed transactions.');
      const convertLead = mpApiCreate_(ownerActor, 'Leads', { FullName: 'Team Lead', Phone: '+201000000023', Source: 'PHONE', AssignedTo: other.UserID });
      mpApiAddTeamMember_(ownerActor, 'Leads', convertLead.LeadID, lawyerUser.UserID);
      const converted = mpApiConvertLead_(otherActor, convertLead.LeadID, convertLead.Version, {});
      mpTestAssert_(converted.client.AssignedTo === other.UserID, 'Converted client did not keep the lead assignee.');
      mpTestAssert_(mpApiGet_(lawyerActor, 'Clients', converted.client.ClientID).ClientID === converted.client.ClientID, 'Lead team did not follow conversion.');
      const scopedDashboard = mpApiDashboard_(otherActor);
      mpTestAssert_(scopedDashboard.sections.leads.unassigned === null && mpApiDashboard_(ownerActor).sections.leads.unassigned >= 0, 'Unassigned-leads count visibility is wrong.');
    });
    mpTestRun_(results, 'document upload, download, type and folder checks', function() {
      const ownerActor = { userId: actor, role: 'OWNER', email: owner.Email, fullName: owner.FullName };
      const assistantUser = mpRows_('Users').records.filter(function(user) { return user.Email === 'assistant@example.test'; })[0];
      const assistantActor = { userId: assistantUser.UserID, role: 'ASSISTANT', email: assistantUser.Email, fullName: assistantUser.FullName };
      const content = Utilities.base64Encode('hello from the office PC');
      const uploaded = mpUploadDocument_(assistantActor, { EntityType: 'CLIENT', EntityID: client.ClientID, ConfidentialityLevel: 'STANDARD', Description: 'ID copy' }, { name: 'id copy.txt', base64: content });
      mpTestAssert_(uploaded.FileType === 'TXT' && !!uploaded.DriveFileID && uploaded.UploadedBy === assistantUser.UserID && uploaded.FileName === 'id copy.txt', 'Upload metadata is wrong.');
      const downloaded = mpDownloadDocument_(assistantActor, uploaded.DocumentID);
      mpTestAssert_(downloaded.base64 === content && downloaded.mimeType === 'text/plain' && downloaded.fileName === 'id copy.txt', 'Download content differs from upload.');
      mpTestAssert_(mpListActivities_('Documents', uploaded.DocumentID, 10).some(function(item) { return item.Action === 'DOWNLOADED'; }), 'Download was not audited.');
      mpTestExpectError_(function() { mpUploadDocument_(ownerActor, { EntityType: 'CLIENT', EntityID: client.ClientID }, { name: 'page.html', base64: content }); }, 'HTML upload was accepted.');
      mpTestExpectError_(function() { mpUploadDocument_(ownerActor, { EntityType: 'CLIENT', EntityID: client.ClientID }, { name: 'empty.pdf', base64: '' }); }, 'Empty upload was accepted.');
      mpTestExpectError_(function() { mpUploadDocument_(ownerActor, { EntityType: 'CASE', EntityID: 'CAS-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' }, { name: 'a.pdf', base64: content }); }, 'Upload to a missing record was accepted.');
      mpTestExpectError_(function() { mpApiCreate_(ownerActor, 'Documents', { EntityType: 'CLIENT', EntityID: client.ClientID, FileName: 'x', DriveFileID: 'any-drive-file' }); }, 'Generic document create bypassed upload.');
      mpTestExpectError_(function() { mpApiUpdate_(ownerActor, 'Documents', uploaded.DocumentID, { DriveFileID: 'any-drive-file' }, uploaded.Version); }, 'DriveFileID was editable.');
      const rows = mpRows_('Documents');
      const row = rows.records.filter(function(item) { return item.DocumentID === uploaded.DocumentID; })[0];
      const outsideFolder = DriveApp.createFolder('MOHAMY PLUS - TEST OUTSIDE - ' + Utilities.getUuid());
      try {
        const outsideFile = outsideFolder.createFile(Utilities.newBlob('not a case file', 'text/plain', 'outside.txt'));
        rows.sheet.getRange(row._rowNumber, rows.headers.indexOf('DriveFileID') + 1).setValue(outsideFile.getId());
        mpInvalidateRows_('Documents');
        const refused = mpTestExpectError_(function() { mpDownloadDocument_(ownerActor, uploaded.DocumentID); }, 'A file outside the documents folder was downloaded.');
        mpTestAssert_(/not stored in the Mohamy Plus documents folder/.test(refused), 'Outside file refused for the wrong reason: ' + refused);
      } finally { outsideFolder.setTrashed(true); }
    });
    mpTestRun_(results, 'daily reminder digests: content, language, escaping, preferences', function() {
      const lawyerUser = mpRows_('Users').records.filter(function(user) { return user.Email === 'lawyer@example.test'; })[0];
      const today = mpCairoDate_(mpNowIso_());
      mpDbInsert_('FollowUps', { CaseID: caseRecord.CaseID, AssignedTo: lawyerUser.UserID, Title: 'File <b>appeal</b>', DueDate: today }, actor);
      mpDbInsert_('FollowUps', { CaseID: caseRecord.CaseID, AssignedTo: lawyerUser.UserID, Title: 'Late brief', DueDate: '2026-01-02' }, actor);
      let digest = mpBuildReminderDigests_().filter(function(item) { return item.userId === lawyerUser.UserID; })[0];
      mpTestAssert_(!!digest && digest.text.indexOf('File <b>appeal</b>') !== -1 && digest.text.indexOf('Late brief') !== -1, 'Lawyer digest is missing items.');
      mpTestAssert_(digest.html.indexOf('&lt;b&gt;appeal&lt;/b&gt;') !== -1 && digest.html.indexOf('<b>appeal') === -1, 'Digest HTML is not escaped.');
      mpApiSetMyLanguage_({ userId: lawyerUser.UserID, role: 'LAWYER' }, 'AR');
      mpTestExpectError_(function() { mpApiSetMyLanguage_({ userId: lawyerUser.UserID, role: 'LAWYER' }, 'FR'); }, 'Unsupported language accepted.');
      digest = mpBuildReminderDigests_().filter(function(item) { return item.userId === lawyerUser.UserID; })[0];
      mpTestAssert_(digest.language === 'AR' && digest.html.indexOf('dir="rtl"') !== -1 && digest.text.indexOf('متابعات متأخرة') !== -1, 'Arabic digest was not produced.');
      const prefs = mpListSettings_().filter(function(setting) { return setting.key === 'NOTIFICATION_PREFERENCES'; })[0];
      mpUpdateSetting_('NOTIFICATION_PREFERENCES', { email: false, overdueFollowUps: true, upcomingConsultations: true }, prefs.version, actor);
      mpTestAssert_(mpBuildReminderDigests_().length === 0, 'Digests were built while email reminders are off.');
      mpUpdateSetting_('NOTIFICATION_PREFERENCES', { email: true, overdueFollowUps: true, upcomingConsultations: true }, prefs.version + 1, actor);
      mpTestAssert_(dailyReminderTrigger({ triggerUid: 'forged' }).ok === false && dailyReminderTrigger().ok === false, 'Reminder handler ran without its trigger.');
    });
    mpTestRun_(results, 'compatible binding and incompatible-schema rejection', function() {
      const compatibleReport = mpBindExistingDatabase_(sandbox.getId(), false);
      mpTestAssert_(compatibleReport.compatible === true, 'Compatible sandbox did not bind.');
      const incompatible = SpreadsheetApp.create('MOHAMY PLUS - INCOMPATIBLE TEST - ' + Utilities.getUuid());
      try {
        mpTestExpectError_(function() { mpBindExistingDatabase_(incompatible.getId(), false); }, 'Incompatible spreadsheet was bound.');
        mpTestAssert_(PropertiesService.getScriptProperties().getProperty(MP_CONFIG.DATABASE_ID_PROPERTY) === originalDatabaseId, 'Test binding changed the active database binding.');
      } finally { DriveApp.getFileById(incompatible.getId()).setTrashed(true); }
    });
    });
  } catch (error) {
    results.push({ name: 'test harness', passed: false, error: error.message });
  } finally {
    if (sandbox) DriveApp.getFileById(sandbox.getId()).setTrashed(true);
    if (documentsFolder) documentsFolder.setTrashed(true);
    MP_EXECUTION_DOCUMENTS_FOLDER_ID_ = previousDocumentsFolder;
  }
  const propertyUnchanged = PropertiesService.getScriptProperties().getProperty(MP_CONFIG.DATABASE_ID_PROPERTY) === originalDatabaseId;
  if (!propertyUnchanged) results.push({ name: 'global binding preservation', passed: false, error: 'MP_DATABASE_SPREADSHEET_ID changed during isolated tests.' });
  const finalFailed = results.filter(function(result) { return !result.passed; });
  return { passed: finalFailed.length === 0, passedCount: results.length - finalFailed.length, failedCount: finalFailed.length, results: results, isolated: true, globalBindingUnchanged: propertyUnchanged };
}

function runStage1DatabaseTests() {
  try {
    mpRequireAdministrator_();
    const report = mpRunStage1DatabaseTests_();
    // The editor's Run button shows only logs, so print a readable summary.
    console.log((report.passed ? 'ALL TESTS PASSED' : 'SOME TESTS FAILED') + ': ' + report.passedCount + ' passed, ' + report.failedCount + ' failed.');
    report.results.filter(function(item) { return !item.passed; }).forEach(function(item) { console.log('FAILED: ' + item.name + ' -> ' + item.error); });
    return mpSuccess_(report);
  } catch (error) { console.error(error); return mpFailure_(error); }
}

/**
 * One-click first-time installer for the Apps Script editor (select it and press Run).
 * Uses the signed-in project owner as the initial OWNER, creates the database
 * spreadsheet and documents folder, and logs the spreadsheet link.
 * Safe to run again: it never overwrites data.
 */
function installMohamyPlus() {
  const log = function(line) { console.log(line); };
  const properties = PropertiesService.getScriptProperties();
  if (!properties.getProperty(MP_CONFIG.DATABASE_ID_PROPERTY)) {
    const owner = setInitialOwnerEmail(Session.getActiveUser().getEmail());
    if (!owner.ok) { log('INSTALL STOPPED: ' + owner.error.message); return owner; }
    log('Initial owner: ' + Session.getActiveUser().getEmail());
  }
  const setup = setupDatabase();
  if (!setup.ok) { log('INSTALL STOPPED: ' + setup.error.message); return setup; }
  const database = SpreadsheetApp.openById(properties.getProperty(MP_CONFIG.DATABASE_ID_PROPERTY));
  log('Database spreadsheet: ' + database.getUrl());
  log('Documents folder created this run: ' + (setup.data.documentsFolderCreated ? 'yes' : 'no (already exists)'));
  log('INSTALL COMPLETE. Next: run runStage1DatabaseTests, then Deploy > New deployment > Web app.');
  return mpSuccess_({ databaseUrl: database.getUrl(), setup: setup.data });
}
