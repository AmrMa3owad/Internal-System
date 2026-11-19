/** Run these administrative functions only from the Apps Script editor. */
function setInitialOwnerEmail(email) {
  const normalized = mpValidateEmail_(email, 'Owner email', true);
  PropertiesService.getScriptProperties().setProperty(MP_CONFIG.INITIAL_OWNER_PROPERTY, normalized);
  return mpSuccess_({ message: 'Initial owner saved. Run setupDatabase() next.' });
}

function setupDatabase() {
  try { return mpSuccess_(mpSetupDatabase_()); }
  catch (error) { console.error(error); return mpFailure_(error); }
}

/** Bind this project to a pre-existing spreadsheet that you own. */
function bindExistingDatabase(spreadsheetId) {
  try {
    if (!spreadsheetId || !/^[a-zA-Z0-9_-]+$/.test(String(spreadsheetId))) throw new Error('A valid spreadsheet ID is required.');
    SpreadsheetApp.openById(String(spreadsheetId)); // Confirms access before saving.
    PropertiesService.getScriptProperties().setProperty(MP_CONFIG.DATABASE_ID_PROPERTY, String(spreadsheetId));
    return setupDatabase();
  } catch (error) { return mpFailure_(error); }
}

function getStage1DatabaseStatus() {
  try {
    const database = mpGetDatabase_();
    return mpSuccess_({ name: database.getName(), sheets: Object.keys(MP_SCHEMAS), initialized: true });
  } catch (error) { return mpFailure_(error); }
}

/**
 * Creates and then archives test data. It never deletes or alters existing
 * records. Run only after setupDatabase() succeeds.
 */
function runStage1DatabaseTests() {
  const actor = 'SYSTEM_TEST';
  const suffix = Utilities.getUuid().slice(0, 8);
  const results = [];
  try {
    const company = mpDbInsert_('Companies', { CompanyName: 'Stage 1 Test ' + suffix, Phone: '+201000000000', Email: 'stage1-' + suffix + '@example.test' }, actor);
    results.push('Company create');
    const client = mpDbInsert_('Clients', { ClientType: 'COMPANY', FullName: 'Stage 1 Client ' + suffix, CompanyID: company.CompanyID, Phone: '+201000000001', Email: 'client-' + suffix + '@example.test' }, actor);
    results.push('Client create');
    const updated = mpDbUpdate_('Clients', client.ClientID, { Notes: 'Versioned update verification.' }, client.Version, actor);
    if (updated.Version !== 2) throw new Error('Version control test failed.');
    results.push('Versioned update');
    const caseRecord = mpDbInsert_('Cases', { CaseTitle: 'Stage 1 Case ' + suffix, ClientID: client.ClientID, Priority: 'MEDIUM', Status: 'INITIAL_REVIEW', AgreedFee: 1000, OpposingParties: 'Test opposing party' }, actor);
    results.push('Case create');
    const transaction = mpDbInsert_('Transactions', { ClientID: client.ClientID, CaseID: caseRecord.CaseID, Type: 'INCOME', Amount: 250, PaymentMethod: 'CASH', PaymentDate: mpNowIso_(), Description: 'Test payment' }, actor);
    const refreshedCase = mpDbGetById_('Cases', caseRecord.CaseID, false);
    if (Number(refreshedCase.TotalPaid) !== 250 || Number(refreshedCase.OutstandingBalance) !== 750) throw new Error('Case payment reconciliation test failed.');
    results.push('Payment reconciliation');
    mpDbArchive_('Transactions', transaction.TransactionID, transaction.Version, actor);
    const caseAfterTransactionArchive = mpDbGetById_('Cases', caseRecord.CaseID, false);
    mpDbArchive_('Cases', caseAfterTransactionArchive.CaseID, caseAfterTransactionArchive.Version, actor);
    mpDbArchive_('Clients', updated.ClientID, updated.Version, actor);
    mpDbArchive_('Companies', company.CompanyID, company.Version, actor);
    results.push('Soft archive');
    return mpSuccess_({ passed: true, checks: results });
  } catch (error) {
    console.error(error);
    return mpFailure_(error);
  }
}
