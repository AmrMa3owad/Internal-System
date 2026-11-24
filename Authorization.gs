/**
 * Authorization boundary for callable administrative entry points.
 *
 * Apps Script HTML Service makes a top-level server function callable through
 * google.script.run unless its name ends in an underscore. All data services
 * in this project use a trailing underscore. The small public administrative
 * wrappers in Code.gs must call these checks and fail closed when Apps Script
 * cannot disclose the active user's Google account email.
 */
function mpGetActiveUserEmail_() {
  const email = mpNormalizeEmail_(Session.getActiveUser().getEmail());
  if (!email) {
    throw new Error('Cannot verify your Google account identity. This operation is denied. Use a Google Workspace deployment that exposes active-user email, or run this administrative action from the Apps Script editor as the project owner.');
  }
  return email;
}

/**
 * The account allowed to bootstrap. Preferred source is the Drive owner of the
 * script file. Some projects (created through clasp/the Apps Script API, or kept
 * in a shared drive) cannot be looked up in Drive, so we fall back to the
 * effective user: in the editor that is the person pressing Run (who can already
 * edit the code), and in the deployed web app it is the deploying owner, so a
 * visitor can never match it.
 */
function mpGetProjectOwnerEmail_() {
  try {
    const owner = DriveApp.getFileById(ScriptApp.getScriptId()).getOwner();
    const email = owner ? mpNormalizeEmail_(owner.getEmail()) : '';
    if (email) return email;
  } catch (error) {
    console.warn('Project owner lookup through Drive failed; using the effective user instead. ' + error.message);
  }
  const effective = mpNormalizeEmail_(Session.getEffectiveUser().getEmail());
  if (!effective) throw new Error('Cannot verify the Apps Script project owner. Administrative bootstrap is denied.');
  return effective;
}

function mpRequireProjectOwner_() {
  const activeEmail = mpGetActiveUserEmail_();
  const ownerEmail = mpGetProjectOwnerEmail_();
  if (activeEmail !== ownerEmail) throw new Error('Only the Apps Script project owner may perform this bootstrap operation.');
  return { email: activeEmail, userId: 'SYSTEM' };
}

function mpFindActiveUserByEmail_(email) {
  const users = mpRows_('Users').records;
  return users.filter(function(user) {
    return user.IsArchived !== true && user.Status === 'ACTIVE' && mpNormalizeEmail_(user.Email) === email;
  })[0] || null;
}

function mpRequireAdministrator_() {
  const activeEmail = mpGetActiveUserEmail_();
  const user = mpFindActiveUserByEmail_(activeEmail);
  if (!user || MP_CONFIG.ADMIN_ROLES.indexOf(user.Role) === -1) {
    throw new Error('You are not authorized to perform this administrative operation.');
  }
  return { email: activeEmail, userId: user.UserID };
}

/** Allows only the project owner to initialize a still-empty Users sheet. */
function mpRequireAdministratorOrBootstrapOwner_() {
  const spreadsheetId = PropertiesService.getScriptProperties().getProperty(MP_CONFIG.DATABASE_ID_PROPERTY);
  if (!spreadsheetId) return mpRequireProjectOwner_();
  try {
    if (mpRows_('Users').records.filter(function(user) { return user.IsArchived !== true; }).length === 0) return mpRequireProjectOwner_();
  } catch (error) {
    return mpRequireProjectOwner_();
  }
  return mpRequireAdministrator_();
}

function mpAssertNoSystemManagedInput_(sheetName, input, operation) {
  const protectedFields = MP_SYSTEM_MANAGED_FIELDS[sheetName] || [];
  const supplied = Object.keys(input || {}).filter(function(field) {
    return protectedFields.indexOf(field) !== -1;
  });
  if (supplied.length) {
    throw new Error((operation || 'This operation') + ' cannot set system-managed field(s): ' + supplied.join(', ') + '.');
  }
}

function mpAssertGenericOperationAllowed_(sheetName, operation) {
  if (!MP_SCHEMAS[sheetName]) throw new Error('Unknown entity: ' + sheetName + '.');
  if (sheetName === 'Activities') throw new Error('Activities are append-only and may only be created by trusted server workflows.');
  if (sheetName === 'Settings') throw new Error('Settings cannot be changed through generic ' + operation + ' operations.');
  if (sheetName === 'Assignments') throw new Error('Team assignments are managed only through the assignment workflow.');
  if (sheetName === 'Documents' && operation === 'create') throw new Error('Documents are created only by uploading a file.');
}

/**
 * Resolves the caller to an active, unarchived Users record. Every Stage 2
 * API call goes through this; it fails closed like the administrative checks.
 */
function mpRequireActiveUser_() {
  const email = mpGetActiveUserEmail_();
  const user = mpFindActiveUserByEmail_(email);
  if (!user) throw new Error('Your Google account is not an active Mohamy Plus user. Ask an owner to add you.');
  if (MP_CONFIG.ROLES.indexOf(user.Role) === -1) throw new Error('Your user record has an invalid role. Ask an owner to correct it.');
  return { email: email, userId: user.UserID, role: user.Role, fullName: user.FullName };
}

function mpCan_(role, entity, action) {
  const rules = MP_PERMISSIONS[entity];
  return !!rules && Array.isArray(rules[action]) && rules[action].indexOf(role) !== -1;
}

function mpRequirePermission_(actor, entity, action) {
  if (!actor || !actor.role) throw new Error('An authenticated user is required.');
  if (!MP_PERMISSIONS[entity]) throw new Error('Unknown entity: ' + entity + '.');
  if (!mpCan_(actor.role, entity, action)) {
    const error = new Error('Your role (' + actor.role + ') is not allowed to ' + action + ' ' + entity + '.');
    error.code = 'FORBIDDEN';
    throw error;
  }
}

function mpCanViewDocument_(role, document) {
  const allowed = MP_DOCUMENT_ACCESS[document.ConfidentialityLevel || 'CONFIDENTIAL'] || MP_DOCUMENT_ACCESS.RESTRICTED;
  return allowed.indexOf(role) !== -1;
}

function mpCanSeeFinancials_(role) { return mpCan_(role, 'Transactions', 'read'); }

/** Removes financial fields a role may not see. Returns a new object. */
function mpRedactRecord_(actor, entity, record) {
  if (!record) return record;
  const hidden = mpCanSeeFinancials_(actor.role) ? [] : (MP_FINANCIAL_FIELDS[entity] || []);
  if (!hidden.length) return record;
  const copy = mpDeepClone_(record);
  hidden.forEach(function(field) { delete copy[field]; });
  return copy;
}

function mpAssertFinancialInputAllowed_(actor, entity, input) {
  if (mpCanSeeFinancials_(actor.role)) return;
  const supplied = (MP_FINANCIAL_FIELDS[entity] || []).filter(function(field) { return mpHas_(input, field); });
  if (supplied.length) {
    const error = new Error('Your role (' + actor.role + ') cannot set financial field(s): ' + supplied.join(', ') + '.');
    error.code = 'FORBIDDEN';
    throw error;
  }
}
