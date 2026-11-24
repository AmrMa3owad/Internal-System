/**
 * Stage 2 application API.
 *
 * These top-level functions (no trailing underscore) are the ONLY data entry
 * points a future HTML Service UI may call through google.script.run. Each one
 * resolves the caller to an active Users record, checks MP_PERMISSIONS for the
 * caller's role, applies document-confidentiality and financial-field rules,
 * and only then delegates to the server-only repository in Database.gs.
 *
 * Every function returns { ok: true, data } or { ok: false, error: { message,
 * code?, duplicates? } } and never throws to the client.
 *
 * The mpApi*_ internals take an explicit actor so the isolated test suite can
 * exercise every role without a real Google identity.
 */

/** Entities exposed through the generic list/get/create/update/archive API. */
const MP_API_ENTITIES_ = ['Users', 'Leads', 'Clients', 'Companies', 'Cases', 'Consultations', 'Transactions', 'FollowUps', 'Documents', 'ExternalPartners', 'Referrals', 'ReferralWork', 'ReferralPayments'];

function mpApiRespond_(callback) {
  try { return mpSuccess_(callback()); }
  catch (error) { console.error(error); return mpFailure_(error); }
}

function mpApiEntity_(entity) {
  if (MP_API_ENTITIES_.indexOf(entity) === -1) throw new Error('Unknown or unsupported entity: ' + entity + '.');
  return entity;
}

function mpHiddenFields_(actor, entity) {
  return mpCanSeeFinancials_(actor.role) ? [] : (MP_FINANCIAL_FIELDS[entity] || []);
}

function mpNotFound_() {
  const error = new Error('Record was not found.');
  error.code = 'NOT_FOUND';
  return error;
}

/** Reads an existing record the actor is allowed to see, or throws NOT_FOUND. */
function mpApiVisibleRecord_(actor, entity, id) {
  const record = mpDbGetById_(entity, String(id || ''), false);
  if (!record) throw mpNotFound_();
  // Hide existence of documents above the caller's clearance and of records outside their assignments.
  if (entity === 'Documents' && !mpCanViewDocument_(actor.role, record)) throw mpNotFound_();
  if (!mpRecordInScope_(mpAccessScope_(actor), entity, record)) throw mpNotFound_();
  return record;
}

function mpApiAssertDocumentInput_(actor, input) {
  const level = mpIsBlank_(input.ConfidentialityLevel) ? 'CONFIDENTIAL' : String(input.ConfidentialityLevel).trim().toUpperCase();
  if (!mpCanViewDocument_(actor.role, { ConfidentialityLevel: level })) {
    const error = new Error('Your role (' + actor.role + ') cannot file documents at confidentiality level ' + level + '.');
    error.code = 'FORBIDDEN';
    throw error;
  }
}

function mpApiGetCurrentUser_(actor) {
  const permissions = {};
  Object.keys(MP_PERMISSIONS).forEach(function(entity) {
    permissions[entity] = Object.keys(MP_PERMISSIONS[entity]).filter(function(action) { return mpCan_(actor.role, entity, action); });
  });
  const settings = mpGetSettings_();
  return {
    userId: actor.userId,
    email: actor.email,
    fullName: actor.fullName,
    role: actor.role,
    permissions: permissions,
    canSeeFinancials: mpCanSeeFinancials_(actor.role),
    business: {
      name: settings.BUSINESS_NAME || MP_DEFAULT_SETTINGS.BUSINESS_NAME,
      currency: MP_DEFAULT_SETTINGS.CURRENCY,
      timezone: MP_DEFAULT_SETTINGS.TIMEZONE,
      practiceAreas: settings.PRACTICE_AREAS || MP_DEFAULT_SETTINGS.PRACTICE_AREAS
    },
    enums: {
      roles: MP_CONFIG.ROLES, userStatuses: MP_CONFIG.USER_STATUSES, clientTypes: MP_CONFIG.CLIENT_TYPES,
      clientStatuses: MP_CONFIG.CLIENT_STATUSES, priorities: MP_CONFIG.PRIORITIES, leadStatuses: MP_CONFIG.LEAD_STATUSES,
      leadSources: MP_CONFIG.LEAD_SOURCES, caseStatuses: MP_CONFIG.CASE_STATUSES, followUpStatuses: MP_CONFIG.FOLLOW_UP_STATUSES,
      consultationStatuses: MP_CONFIG.CONSULTATION_STATUSES, paymentStatuses: MP_CONFIG.PAYMENT_STATUSES,
      transactionTypes: MP_CONFIG.TRANSACTION_TYPES, paymentMethods: MP_CONFIG.PAYMENT_METHODS,
      confidentialityLevels: MP_CONFIG.CONFIDENTIALITY_LEVELS, documentEntityTypes: MP_CONFIG.DOCUMENT_ENTITY_TYPES
    }
  };
}

/** LastLogin is session metadata: written without a Version bump so it never causes edit conflicts. */
function mpTouchLastLogin_(userId) {
  // Recording it on every page load cost a locked write; every 6 hours is plenty.
  const known = mpRows_('Users').records.filter(function(item) { return item.UserID === userId; })[0];
  const last = known && !mpIsBlank_(known.LastLogin) ? new Date(known.LastLogin).getTime() : 0;
  if (last && Date.now() - last < 6 * 3600 * 1000) return;
  mpWithLock_(function() {
    const rows = mpRows_('Users');
    const user = rows.records.filter(function(item) { return item.UserID === userId; })[0];
    if (!user) return;
    const column = rows.headers.indexOf('LastLogin') + 1;
    rows.sheet.getRange(user._rowNumber, column).setValue(mpNowIso_());
    mpInvalidateRows_('Users');
  });
}

function mpApiList_(actor, entity, options) {
  mpApiEntity_(entity);
  mpRequirePermission_(actor, entity, 'read');
  options = options || {};
  if (typeof options !== 'object' || Array.isArray(options)) throw new Error('List options must be an object.');
  const hidden = mpHiddenFields_(actor, entity);
  const filters = options.filters || null;
  if (filters && typeof filters === 'object') {
    const blocked = Object.keys(filters).filter(function(field) { return hidden.indexOf(field) !== -1; });
    if (blocked.length) throw new Error('Cannot filter by restricted field(s): ' + blocked.join(', ') + '.');
  }
  if (options.sortBy && hidden.indexOf(options.sortBy) !== -1) throw new Error('Cannot sort by restricted field: ' + options.sortBy + '.');
  if (options.includeArchived === true && MP_SENIOR_ROLES_.indexOf(actor.role) === -1) throw new Error('Only owners and partners may list archived records.');
  const scope = mpAccessScope_(actor);
  // Cases and clients can be listed by who handles them: 'internal' or 'external' (referred to a partner).
  const external = (options.handling === 'internal' || options.handling === 'external') && (entity === 'Cases' || entity === 'Clients') ? mpExternallyHandledIds_(entity) : null;
  const idField = MP_SCHEMAS[entity][0];
  const result = mpDbList_(entity, {
    limit: options.limit,
    offset: options.offset,
    query: options.query,
    filters: filters,
    sortBy: options.sortBy,
    sortDirection: options.sortDirection,
    includeArchived: options.includeArchived === true,
    searchExclude: hidden,
    predicate: function(record) {
      if (external && (options.handling === 'external') !== !!external[record[idField]]) return false;
      return (entity !== 'Documents' || mpCanViewDocument_(actor.role, record)) && mpRecordInScope_(scope, entity, record);
    }
  });
  result.records = result.records.map(function(record) { return mpRedactRecord_(actor, entity, record); });
  return result;
}

function mpApiGet_(actor, entity, id) {
  mpApiEntity_(entity);
  mpRequirePermission_(actor, entity, 'read');
  return mpRedactRecord_(actor, entity, mpApiVisibleRecord_(actor, entity, id));
}

function mpApiCreate_(actor, entity, input) {
  mpApiEntity_(entity);
  mpRequirePermission_(actor, entity, 'create');
  input = input || {};
  mpAssertFinancialInputAllowed_(actor, entity, input);
  const scope = mpAccessScope_(actor);
  mpAssertLinksInScope_(scope, entity, input);
  let created;
  try { created = mpDbInsert_(entity, input, actor.userId); }
  catch (error) { throw mpRedactDuplicateMatches_(scope, entity, error); }
  mpApiKeepCreatorOnTeam_(actor, entity, created);
  return mpRedactRecord_(actor, entity, created);
}

/** A restricted creator who is not the main assignee joins the record's team so they keep access. */
function mpApiKeepCreatorOnTeam_(actor, entity, record) {
  const field = MP_ASSIGNEE_FIELDS[entity];
  if (!field || !mpIsRecordRestricted_(actor) || record[field] === actor.userId) return;
  try { mpAddAssignment_(entity, record[MP_SCHEMAS[entity][0]], actor.userId, actor.userId); }
  catch (error) { throw new Error('Record was saved but you could not be added to its team; ask an owner to assign it to you. ' + error.message); }
}

function mpApiUpdate_(actor, entity, id, input, expectedVersion) {
  mpApiEntity_(entity);
  mpRequirePermission_(actor, entity, 'update');
  input = input || {};
  mpAssertFinancialInputAllowed_(actor, entity, input);
  const existing = mpApiVisibleRecord_(actor, entity, id);
  if (entity === 'Documents' && mpHas_(input, 'ConfidentialityLevel')) mpApiAssertDocumentInput_(actor, input);
  mpAssertAssigneeChangeAllowed_(actor, entity, input, existing);
  const scope = mpAccessScope_(actor);
  mpAssertLinksInScope_(scope, entity, Object.assign({}, existing, input));
  try { return mpRedactRecord_(actor, entity, mpDbUpdate_(entity, String(id), input, expectedVersion, actor.userId)); }
  catch (error) { throw mpRedactDuplicateMatches_(scope, entity, error); }
}

function mpApiArchive_(actor, entity, id, expectedVersion) {
  mpApiEntity_(entity);
  mpRequirePermission_(actor, entity, 'archive');
  mpApiVisibleRecord_(actor, entity, id);
  return mpRedactRecord_(actor, entity, mpDbArchive_(entity, String(id), expectedVersion, actor.userId));
}

function mpApiConvertLead_(actor, leadId, expectedVersion, clientInput) {
  mpRequirePermission_(actor, 'LeadConversion', 'create');
  mpRequirePermission_(actor, 'Leads', 'update');
  mpRequirePermission_(actor, 'Clients', 'create');
  mpApiVisibleRecord_(actor, 'Leads', leadId);
  if (clientInput && mpHas_(clientInput, 'AssignedTo') && mpIsRecordRestricted_(actor)) throw mpForbidden_('Only owners and partners can choose the client assignee.');
  let result;
  try { result = mpConvertLead_(String(leadId || ''), expectedVersion, clientInput || {}, actor.userId); }
  catch (error) { throw mpRedactDuplicateMatches_(mpAccessScope_(actor), 'Clients', error); }
  mpApiKeepCreatorOnTeam_(actor, 'Clients', result.client);
  return result;
}

function mpApiListActivities_(actor, entity, id, limit) {
  mpRequirePermission_(actor, 'Activities', 'read');
  if (entity !== 'Settings') {
    mpApiEntity_(entity);
    mpRequirePermission_(actor, entity, 'read');
    mpApiVisibleRecord_(actor, entity, id);
  }
  return mpListActivities_(entity, String(id || ''), limit);
}

function mpApiGetSettings_(actor) {
  mpRequirePermission_(actor, 'Settings', 'read');
  return mpListSettings_();
}

function mpApiUpdateSetting_(actor, key, value, expectedVersion) {
  mpRequirePermission_(actor, 'Settings', 'update');
  return mpUpdateSetting_(String(key || ''), value, expectedVersion, actor.userId);
}

function mpApiGetTeam_(actor, entityType, id) {
  mpAssertAssignableEntity_(entityType);
  mpRequirePermission_(actor, 'Assignments', 'read');
  const record = mpApiVisibleRecord_(actor, entityType, id);
  const names = {};
  mpRows_('Users').records.forEach(function(user) { names[user.UserID] = mpPlainText_(user.FullName); });
  const mainId = record[MP_ASSIGNEE_FIELDS[entityType]] || '';
  return {
    mainAssignee: mainId ? { UserID: mainId, FullName: names[mainId] || mainId } : null,
    members: mpListAssignments_(entityType, String(id)).map(function(row) {
      return { AssignmentID: row.AssignmentID, UserID: row.UserID, FullName: names[row.UserID] || row.UserID, AddedAt: row.AddedAt };
    }),
    canManage: mpCan_(actor.role, 'Assignments', 'create')
  };
}

function mpApiAddTeamMember_(actor, entityType, id, userId) {
  mpAssertAssignableEntity_(entityType);
  mpRequirePermission_(actor, 'Assignments', 'create');
  mpApiVisibleRecord_(actor, entityType, id);
  mpAddAssignment_(entityType, String(id), userId, actor.userId);
  return mpApiGetTeam_(actor, entityType, id);
}

function mpApiRemoveTeamMember_(actor, assignmentId) {
  mpRequirePermission_(actor, 'Assignments', 'archive');
  const removed = mpRemoveAssignment_(String(assignmentId || ''), actor.userId);
  return mpApiGetTeam_(actor, removed.EntityType, removed.EntityID);
}

function mpApiBulkAssign_(actor, entityType, ids, userId, mode) {
  mpAssertAssignableEntity_(entityType);
  mpRequirePermission_(actor, 'Assignments', 'create');
  mpRequirePermission_(actor, entityType, 'update');
  return mpBulkAssign_(entityType, ids, userId, mode, actor.userId);
}

/** Self-service language preference; metadata write without a Version bump, like LastLogin. */
function mpApiSetMyLanguage_(actor, language) {
  const value = mpAssertEnum_(language, MP_CONFIG.LANGUAGES, 'Language', true);
  mpWithLock_(function() {
    const rows = mpRows_('Users');
    const user = rows.records.filter(function(item) { return item.UserID === actor.userId; })[0];
    if (!user) throw new Error('User not found.');
    rows.sheet.getRange(user._rowNumber, rows.headers.indexOf('Language') + 1).setValue(value);
    mpInvalidateRows_('Users');
  });
  return { language: value };
}

// ---------------------------------------------------------------------------
// Public entry points (callable through google.script.run).
// ---------------------------------------------------------------------------

/** Call once when the UI loads: identity, role, permissions, enums, business settings. */
function apiGetCurrentUser() {
  return mpApiRespond_(function() {
    const actor = mpRequireActiveUser_();
    mpTouchLastLogin_(actor.userId);
    return mpApiGetCurrentUser_(actor);
  });
}

/** options: { limit, offset, query, filters: {Field: value}, sortBy, sortDirection, includeArchived } */
function apiList(entity, options) {
  return mpApiRespond_(function() { return mpApiList_(mpRequireActiveUser_(), entity, options); });
}

function apiGet(entity, id) {
  return mpApiRespond_(function() { return mpApiGet_(mpRequireActiveUser_(), entity, id); });
}

/** Add confirmDuplicate: true only after the user has reviewed a DUPLICATE response. */
function apiCreate(entity, input) {
  return mpApiRespond_(function() { return mpApiCreate_(mpRequireActiveUser_(), entity, input); });
}

function apiUpdate(entity, id, input, expectedVersion) {
  return mpApiRespond_(function() { return mpApiUpdate_(mpRequireActiveUser_(), entity, id, input, expectedVersion); });
}

function apiArchive(entity, id, expectedVersion) {
  return mpApiRespond_(function() { return mpApiArchive_(mpRequireActiveUser_(), entity, id, expectedVersion); });
}

/** Returns { lead, client, relinked: { consultations, followUps } }. */
function apiConvertLead(leadId, expectedVersion, clientInput) {
  return mpApiRespond_(function() { return mpApiConvertLead_(mpRequireActiveUser_(), leadId, expectedVersion, clientInput); });
}

function apiListActivities(entity, id, limit) {
  return mpApiRespond_(function() { return mpApiListActivities_(mpRequireActiveUser_(), entity, id, limit); });
}

function apiGetSettings() {
  return mpApiRespond_(function() { return mpApiGetSettings_(mpRequireActiveUser_()); });
}

function apiUpdateSetting(key, value, expectedVersion) {
  return mpApiRespond_(function() { return mpApiUpdateSetting_(mpRequireActiveUser_(), key, value, expectedVersion); });
}

/** Team (main assignee plus extra members) of a lead, client, or case. */
function apiGetTeam(entityType, id) {
  return mpApiRespond_(function() { return mpApiGetTeam_(mpRequireActiveUser_(), entityType, id); });
}

function apiAddTeamMember(entityType, id, userId) {
  return mpApiRespond_(function() { return mpApiAddTeamMember_(mpRequireActiveUser_(), entityType, id, userId); });
}

function apiRemoveTeamMember(assignmentId) {
  return mpApiRespond_(function() { return mpApiRemoveTeamMember_(mpRequireActiveUser_(), assignmentId); });
}

/** mode: 'main' (replace main assignee) or 'team' (add as team member). */
function apiBulkAssign(entityType, ids, userId, mode) {
  return mpApiRespond_(function() { return mpApiBulkAssign_(mpRequireActiveUser_(), entityType, ids, userId, mode); });
}

/** 'EN' or 'AR'. */
function apiSetMyLanguage(language) {
  return mpApiRespond_(function() { return mpApiSetMyLanguage_(mpRequireActiveUser_(), language); });
}
