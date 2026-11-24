/**
 * Record-level access for roles in MP_CONFIG.RECORD_RESTRICTED_ROLES
 * (lawyers and assistants by default). Owners and partners are unrestricted.
 *
 * A restricted user reaches a Lead, Client, or Case when they are its main
 * assignee (Leads.AssignedTo, Clients.AssignedTo, Cases.AssignedLawyer) or a
 * team member in the Assignments sheet. Access then flows:
 *   - client team  -> all of that client's cases
 *   - case access  -> that case's client
 *   - lead access  -> the client it was converted into (and back)
 *   - consultations, follow-ups, transactions, documents -> through their
 *     linked lead/client/case (and follow-ups/consultations assigned to them)
 * Companies are a shared directory and stay visible to every role.
 *
 * When a restricted user creates a lead, client, or case they are added to its
 * team automatically, so they never lose access to their own work.
 */

function mpIsRecordRestricted_(actor) {
  return !!actor && MP_CONFIG.RECORD_RESTRICTED_ROLES.indexOf(actor.role) !== -1;
}

function mpActiveAssignments_() {
  return mpRows_('Assignments').records.filter(function(row) { return row.IsArchived !== true; });
}

/** Returns null (unrestricted) or { userId, Leads, Clients, Cases, Consultations } ID sets. */
function mpAccessScope_(actor) {
  if (!mpIsRecordRestricted_(actor)) return null;
  if (MP_SCOPE_CACHE_[actor.userId]) return MP_SCOPE_CACHE_[actor.userId];
  const me = actor.userId;
  const scope = { userId: me, Leads: {}, Clients: {}, Cases: {}, Consultations: {} };
  const team = { Leads: {}, Clients: {}, Cases: {} };
  mpActiveAssignments_().forEach(function(row) { if (row.UserID === me && team[row.EntityType]) team[row.EntityType][row.EntityID] = true; });

  const leads = mpRows_('Leads').records;
  const clients = mpRows_('Clients').records;
  const cases = mpRows_('Cases').records;
  const directClients = {};
  leads.forEach(function(lead) { if (lead.AssignedTo === me || team.Leads[lead.LeadID]) scope.Leads[lead.LeadID] = true; });
  clients.forEach(function(client) { if (client.AssignedTo === me || team.Clients[client.ClientID]) { directClients[client.ClientID] = true; scope.Clients[client.ClientID] = true; } });
  cases.forEach(function(item) {
    if (item.AssignedLawyer === me || team.Cases[item.CaseID] || directClients[item.ClientID]) {
      scope.Cases[item.CaseID] = true;
      if (item.ClientID) scope.Clients[item.ClientID] = true;
    }
  });
  leads.forEach(function(lead) {
    if (scope.Leads[lead.LeadID] && lead.ConvertedClientID) scope.Clients[lead.ConvertedClientID] = true;
    if (lead.ConvertedClientID && directClients[lead.ConvertedClientID]) scope.Leads[lead.LeadID] = true;
  });
  clients.forEach(function(client) { if (client.CreatedFromLeadID && scope.Clients[client.ClientID]) scope.Leads[client.CreatedFromLeadID] = true; });
  mpRows_('Consultations').records.forEach(function(item) {
    if (item.AssignedLawyer === me || scope.Leads[item.LeadID] || scope.Clients[item.ClientID]) scope.Consultations[item.ConsultationID] = true;
  });
  // A referral (and its work items and payments) is visible with its case.
  scope.Referrals = {};
  mpRows_('Referrals').records.forEach(function(item) { if (scope.Cases[item.CaseID]) scope.Referrals[item.ReferralID] = true; });
  MP_SCOPE_CACHE_[me] = scope;
  return scope;
}

const MP_DOCUMENT_ENTITY_SHEETS_ = { LEAD: 'Leads', CLIENT: 'Clients', CASE: 'Cases' };

/** Whether a record is inside the actor's scope (entity-level permissions are checked separately). */
function mpRecordInScope_(scope, entity, record) {
  if (!scope || !record) return true;
  switch (entity) {
    case 'Leads': return !!scope.Leads[record.LeadID];
    case 'Clients': return !!scope.Clients[record.ClientID];
    case 'Cases': return !!scope.Cases[record.CaseID];
    case 'Consultations': return !!scope.Consultations[record.ConsultationID];
    case 'FollowUps': return record.AssignedTo === scope.userId || !!scope.Leads[record.LeadID] || !!scope.Clients[record.ClientID] || !!scope.Cases[record.CaseID];
    case 'Transactions': return !!scope.Clients[record.ClientID] || !!scope.Cases[record.CaseID] || !!scope.Consultations[record.ConsultationID];
    case 'Documents': {
      const target = MP_DOCUMENT_ENTITY_SHEETS_[record.EntityType];
      return !!target && !!scope[target][record.EntityID];
    }
    case 'Assignments': return !!(scope[record.EntityType] || {})[record.EntityID];
    case 'Referrals': return !!scope.Referrals[record.ReferralID];
    case 'ReferralWork':
    case 'ReferralPayments': return !!scope.Referrals[record.ReferralID];
    default: return true;
  }
}

function mpScopeHasId_(scope, entity, id) {
  if (!scope || mpIsBlank_(id)) return true;
  if (scope[entity]) return !!scope[entity][id];
  return true;
}

function mpForbidden_(message) {
  const error = new Error(message);
  error.code = 'FORBIDDEN';
  return error;
}

/** Every lead/client/case/consultation a restricted user links to must already be visible to them. */
function mpAssertLinksInScope_(scope, entity, record) {
  if (!scope) return;
  const refs = MP_REFERENCE_FIELDS[entity] || {};
  Object.keys(refs).forEach(function(field) {
    const target = refs[field];
    if (!scope[target] || mpIsBlank_(record[field])) return;
    if (!scope[target][record[field]]) throw mpForbidden_('You can only link records that are assigned to you (' + field + ').');
  });
  if (entity === 'Documents') {
    const target = MP_DOCUMENT_ENTITY_SHEETS_[record.EntityType];
    if (target && !mpIsBlank_(record.EntityID) && !scope[target][record.EntityID]) throw mpForbidden_('You can only attach documents to records assigned to you.');
  }
}

/** Main-assignee fields that decide access; restricted users cannot change them after creation. */
const MP_ASSIGNEE_FIELDS = Object.freeze({ Leads: 'AssignedTo', Clients: 'AssignedTo', Cases: 'AssignedLawyer' });

function mpAssertAssigneeChangeAllowed_(actor, entity, input, existing) {
  const field = MP_ASSIGNEE_FIELDS[entity];
  if (!field || !mpIsRecordRestricted_(actor) || !mpHas_(input, field)) return;
  if (String(input[field] || '') !== String(existing[field] || '')) throw mpForbidden_('Only owners and partners can reassign ' + entity.toLowerCase() + '.');
}

/** Duplicate matches outside the actor's scope are reported without their details. */
function mpRedactDuplicateMatches_(scope, entity, error) {
  if (!scope || !error || !error.duplicates || !scope[entity]) return error;
  error.duplicates = error.duplicates.map(function(match) {
    return scope[entity][match.id] ? match : { id: null, fullName: '', phone: '', email: '', hidden: true };
  });
  return error;
}

// ------------------------------------------------------------- Assignments

function mpAssertAssignableEntity_(entityType) {
  if (MP_CONFIG.ASSIGNABLE_ENTITIES.indexOf(entityType) === -1) throw new Error('Team members can only be added to ' + MP_CONFIG.ASSIGNABLE_ENTITIES.join(', ') + '.');
}

function mpListAssignments_(entityType, entityId) {
  return mpActiveAssignments_().filter(function(row) { return row.EntityType === entityType && row.EntityID === entityId; }).map(mpPublicRecord_);
}

/** Adds a team member; idempotent for an existing active membership. Caller must hold the lock or this takes it. */
function mpAddAssignment_(entityType, entityId, userId, actorId) {
  mpAssertAssignableEntity_(entityType);
  return mpWithLock_(function() {
    if (!mpDbGetById_(entityType, String(entityId || ''), false)) throw new Error('The record to assign was not found or is archived.');
    const user = mpDbGetById_('Users', mpAssertEntityId_('Users', userId, 'UserID', true), false);
    if (!user || user.Status !== 'ACTIVE') throw new Error('Team members must be active users.');
    const existing = mpActiveAssignments_().filter(function(row) { return row.EntityType === entityType && row.EntityID === entityId && row.UserID === user.UserID; })[0];
    if (existing) return mpPublicRecord_(existing);
    const sheet = mpSheet_('Assignments');
    const now = mpNowIso_();
    const record = { AssignmentID: mpNewId_('Assignments'), EntityType: entityType, EntityID: entityId, UserID: user.UserID, AddedBy: actorId, AddedAt: now, IsArchived: false, ArchivedAt: '', Version: 1 };
    mpAppendRecordChecked_(sheet, mpHeaders_(sheet), record);
    mpLogActivity_(entityType, entityId, 'TEAM_MEMBER_ADDED', 'Added ' + user.FullName + ' to the team.', actorId);
    return mpPublicRecord_(record);
  });
}

function mpRemoveAssignment_(assignmentId, actorId) {
  return mpWithLock_(function() {
    const rows = mpRows_('Assignments');
    const record = rows.records.filter(function(row) { return row.AssignmentID === assignmentId && row.IsArchived !== true; })[0];
    if (!record) throw new Error('Team membership was not found.');
    record.IsArchived = true; record.ArchivedAt = mpNowIso_(); record.Version = Number(record.Version || 1) + 1;
    mpWriteRecordChecked_(rows.sheet, rows.headers, record._rowNumber, record);
    const user = mpDbGetById_('Users', record.UserID, true);
    mpLogActivity_(record.EntityType, record.EntityID, 'TEAM_MEMBER_REMOVED', 'Removed ' + (user ? user.FullName : record.UserID) + ' from the team.', actorId);
    return mpPublicRecord_(record);
  });
}

/**
 * Assigns many records to one staff member. mode 'main' replaces the main
 * assignee (the owner's deliberate override, so the current Version is used);
 * mode 'team' adds them as a team member. Returns per-record results.
 */
function mpBulkAssign_(entityType, ids, userId, mode, actorId) {
  mpAssertAssignableEntity_(entityType);
  if (!Array.isArray(ids) || !ids.length) throw new Error('Select at least one record.');
  if (ids.length > MP_CONFIG.MAX_PAGE_SIZE) throw new Error('Assign at most ' + MP_CONFIG.MAX_PAGE_SIZE + ' records at a time.');
  if (mode !== 'main' && mode !== 'team') throw new Error('mode must be "main" or "team".');
  const user = mpDbGetById_('Users', mpAssertEntityId_('Users', userId, 'UserID', true), false);
  if (!user || user.Status !== 'ACTIVE') throw new Error('Records can only be assigned to active users.');
  const field = MP_ASSIGNEE_FIELDS[entityType];
  return mpWithLock_(function() {
    const results = [];
    ids.forEach(function(id) {
      try {
        if (mode === 'team') { mpAddAssignment_(entityType, String(id), user.UserID, actorId); }
        else {
          const current = mpDbGetById_(entityType, String(id), false);
          if (!current) throw new Error('Not found or archived.');
          if (current[field] !== user.UserID) {
            const change = {}; change[field] = user.UserID;
            mpDbUpdate_(entityType, String(id), change, current.Version, actorId);
          }
        }
        results.push({ id: id, ok: true });
      } catch (error) { results.push({ id: id, ok: false, message: error.message }); }
    });
    return { assigned: results.filter(function(item) { return item.ok; }).length, results: results };
  });
}
