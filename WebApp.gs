/**
 * Stage 3 web application: HTML Service entry point plus the read models the
 * UI needs (form metadata, dashboard, record detail, reference labels).
 *
 * Deployment model (see README): execute as the deploying OWNER account,
 * access restricted to the Workspace domain. Staff never get direct access to
 * the database spreadsheet; every read and write goes through Api.gs checks.
 */

/** Page entry point. Unauthorized visitors get a static access-denied page. */
function doGet() {
  let actor;
  try {
    actor = mpRequireActiveUser_();
  } catch (error) {
    return HtmlService.createHtmlOutput(mpAccessDeniedHtml_(error.message)).setTitle('Mohamy Plus — access denied');
  }
  const template = HtmlService.createTemplateFromFile('Index');
  template.businessName = mpGetSettingValue_('BUSINESS_NAME') || MP_DEFAULT_SETTINGS.BUSINESS_NAME;
  template.userName = actor.fullName || actor.email;
  return template.evaluate()
    .setTitle(String(template.businessName))
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

/** Used by template scriptlets only; the trailing underscore keeps it off google.script.run. */
function mpInclude_(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}

function mpEscapeHtml_(value) {
  return String(value === undefined || value === null ? '' : value)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function mpAccessDeniedHtml_(message) {
  return '<!DOCTYPE html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"><style>' +
    'body{font-family:system-ui,-apple-system,"Segoe UI",sans-serif;background:#f4f6fa;color:#102a43;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0}' +
    '.card{background:#fff;border-radius:12px;box-shadow:0 4px 24px rgba(16,42,67,.08);padding:32px;max-width:440px}h1{font-size:20px;margin:0 0 12px}p{color:#486581;line-height:1.5}' +
    '</style></head><body><div class="card"><h1>Access denied</h1><p>' + mpEscapeHtml_(message) + '</p>' +
    '<h1 dir="rtl" style="margin-top:20px">تم رفض الوصول</h1><p dir="rtl">لا يمكن التحقق من حسابك أو أنه غير مضاف كمستخدم نشط في محامي بلس. اطلب من المالك إضافتك.</p></div></body></html>';
}

// --------------------------------------------------------------- Metadata

const MP_UI_LABEL_FIELDS_ = { Users: 'FullName', Leads: 'FullName', Clients: 'FullName', Companies: 'CompanyName', Cases: 'CaseTitle', Consultations: 'ConsultationDate', Transactions: 'Amount', FollowUps: 'Title', Documents: 'FileName' };

const MP_UI_REQUIRED_ = {
  Users: ['FullName', 'Email', 'Role'], Leads: ['FullName', 'Source'], Clients: ['FullName'], Companies: ['CompanyName'],
  Cases: ['CaseTitle', 'ClientID'], Consultations: ['ConsultationDate', 'Duration'],
  Transactions: ['Type', 'Amount', 'PaymentMethod', 'PaymentDate'], FollowUps: ['Title', 'DueDate'],
  Documents: ['EntityType', 'EntityID']
};

/** Defaults the server applies when a field is omitted on create; forms preselect them. */
const MP_UI_DEFAULTS_ = {
  Users: { Status: 'ACTIVE', Language: 'EN' }, Leads: { ClientType: 'INDIVIDUAL', Priority: 'MEDIUM', Status: 'NEW' }, Clients: { ClientType: 'INDIVIDUAL', Status: 'ACTIVE' },
  Cases: { Priority: 'MEDIUM', Status: 'INITIAL_REVIEW' }, Consultations: { PaymentStatus: 'UNPAID', Status: 'SCHEDULED' },
  FollowUps: { Priority: 'MEDIUM', Status: 'OPEN' }, Documents: { ConfidentialityLevel: 'CONFIDENTIAL' }
};

/** Fields kept out of forms because the server derives them. */
const MP_UI_DERIVED_ = ['Consultations.IsPaid'];

const MP_UI_TYPES_ = {
  datetime: ['ConsultationDate', 'PaymentDate', 'LastContactAt', 'NextFollowUpAt'],
  date: ['StartDate', 'Deadline', 'DueDate'],
  number: ['AgreedFee', 'Fee', 'Amount', 'Duration'],
  longtext: ['Description', 'Notes', 'Outcome', 'Address', 'OpposingParties'],
  email: ['Email'],
  phone: ['Phone']
};

function mpUiEnumOptions_(actor, entity, field, settings) {
  const map = {
    Users: { Role: MP_CONFIG.ROLES, Status: MP_CONFIG.USER_STATUSES, Language: MP_CONFIG.LANGUAGES },
    Leads: { ClientType: MP_CONFIG.CLIENT_TYPES, Source: MP_CONFIG.LEAD_SOURCES, Priority: MP_CONFIG.PRIORITIES, Status: MP_CONFIG.LEAD_STATUSES.filter(function(status) { return status !== 'CONVERTED'; }) },
    Clients: { ClientType: MP_CONFIG.CLIENT_TYPES, Status: MP_CONFIG.CLIENT_STATUSES },
    Cases: { Priority: MP_CONFIG.PRIORITIES, Status: MP_CONFIG.CASE_STATUSES },
    Consultations: { PaymentStatus: MP_CONFIG.PAYMENT_STATUSES, Status: MP_CONFIG.CONSULTATION_STATUSES },
    Transactions: { Type: MP_CONFIG.TRANSACTION_TYPES, PaymentMethod: MP_CONFIG.PAYMENT_METHODS },
    FollowUps: { Priority: MP_CONFIG.PRIORITIES, Status: MP_CONFIG.FOLLOW_UP_STATUSES },
    Documents: {
      EntityType: MP_CONFIG.DOCUMENT_ENTITY_TYPES,
      ConfidentialityLevel: MP_CONFIG.CONFIDENTIALITY_LEVELS.filter(function(level) { return mpCanViewDocument_(actor.role, { ConfidentialityLevel: level }); })
    }
  };
  if (field === 'PracticeArea') return settings.PRACTICE_AREAS || MP_DEFAULT_SETTINGS.PRACTICE_AREAS;
  return (map[entity] || {})[field] || null;
}

function mpUiFieldType_(field) {
  const types = Object.keys(MP_UI_TYPES_);
  for (let index = 0; index < types.length; index += 1) if (MP_UI_TYPES_[types[index]].indexOf(field) !== -1) return types[index];
  return 'text';
}

/** Form field descriptions per readable entity, already filtered for the actor's role. */
function mpApiFormMeta_(actor) {
  const settings = mpGetSettings_();
  const forms = {};
  MP_API_ENTITIES_.forEach(function(entity) {
    if (!mpCan_(actor.role, entity, 'read')) return;
    const hidden = mpHiddenFields_(actor, entity);
    const system = MP_SYSTEM_MANAGED_FIELDS[entity] || [];
    const refs = MP_REFERENCE_FIELDS[entity] || {};
    const fields = MP_SCHEMAS[entity].filter(function(field) {
      return system.indexOf(field) === -1 && hidden.indexOf(field) === -1 && MP_UI_DERIVED_.indexOf(entity + '.' + field) === -1;
    }).map(function(field) {
      const options = mpUiEnumOptions_(actor, entity, field, settings);
      let type = options ? 'enum' : mpUiFieldType_(field);
      if (refs[field]) type = 'reference';
      if (entity === 'Documents' && field === 'EntityID') type = 'entityReference';
      let defaultValue = (MP_UI_DEFAULTS_[entity] || {})[field];
      if (options && options.indexOf(defaultValue) === -1) defaultValue = undefined;
      const lockedOnEdit = mpIsRecordRestricted_(actor) && MP_ASSIGNEE_FIELDS[entity] === field;
      return { name: field, type: type, required: (MP_UI_REQUIRED_[entity] || []).indexOf(field) !== -1, options: options, ref: refs[field] || null, defaultValue: defaultValue === undefined ? null : defaultValue, lockedOnEdit: lockedOnEdit };
    });
    forms[entity] = { idField: MP_SCHEMAS[entity][0], labelField: MP_UI_LABEL_FIELDS_[entity], createdField: mpUiCreatedField_(entity), fields: fields, hiddenFields: hidden };
  });
  return forms;
}

/** Active users for assignment pickers. Names are visible to every role. */
function mpApiAssignableUsers_() {
  return mpRows_('Users').records.filter(function(user) { return user.IsArchived !== true && user.Status === 'ACTIVE'; })
    .map(function(user) { return { UserID: user.UserID, FullName: mpPlainText_(user.FullName), Role: user.Role }; });
}

function mpUiRecordLabel_(entity, record) {
  if (entity === 'Consultations') return 'Consultation ' + String(record.ConsultationDate || '').slice(0, 16).replace('T', ' ');
  if (entity === 'Transactions') return record.Type + ' ' + record.Amount;
  return mpPlainText_(record[MP_UI_LABEL_FIELDS_[entity]] || record[MP_SCHEMAS[entity][0]]);
}

/**
 * Resolves display labels for every ID referenced by the given records.
 * Labels are only returned for entities the actor may read (user names are
 * always resolvable). Transactions are never labelled for non-finance roles.
 */
function mpApiLabels_(actor, entity, records) {
  const wanted = {};
  const add = function(target, id) {
    if (!target || mpIsBlank_(id)) return;
    wanted[target] = wanted[target] || {};
    wanted[target][id] = true;
  };
  const refs = MP_REFERENCE_FIELDS[entity] || {};
  const documentTargets = { LEAD: 'Leads', CLIENT: 'Clients', CASE: 'Cases' };
  records.forEach(function(record) {
    Object.keys(refs).forEach(function(field) { add(refs[field], record[field]); });
    if (entity === 'Documents') add(documentTargets[record.EntityType], record.EntityID);
  });
  const labels = {};
  const scope = mpAccessScope_(actor);
  Object.keys(wanted).forEach(function(target) {
    if (target !== 'Users' && !mpCan_(actor.role, target, 'read')) return;
    const idField = MP_SCHEMAS[target][0];
    mpRows_(target).records.forEach(function(record) {
      if (wanted[target][record[idField]] && mpRecordInScope_(scope, target, record)) labels[record[idField]] = mpUiRecordLabel_(target, record);
    });
  });
  return labels;
}

// -------------------------------------------------------------- Read models

function mpApiBootstrap_(actor) {
  const profile = mpApiGetCurrentUser_(actor);
  profile.forms = mpApiFormMeta_(actor);
  profile.users = mpApiAssignableUsers_();
  profile.financialFields = MP_FINANCIAL_FIELDS;
  const me = mpDbGetById_('Users', actor.userId, false);
  profile.language = me && me.Language === 'AR' ? 'AR' : 'EN';
  profile.restricted = mpIsRecordRestricted_(actor);
  profile.assignable = MP_CONFIG.ASSIGNABLE_ENTITIES;
  profile.assigneeFields = MP_ASSIGNEE_FIELDS;
  profile.upload = { maxBytes: MP_CONFIG.MAX_UPLOAD_BYTES, extensions: MP_CONFIG.UPLOAD_EXTENSIONS };
  return profile;
}

function mpApiListWithLabels_(actor, entity, options) {
  const result = mpApiList_(actor, entity, options);
  result.labels = mpApiLabels_(actor, entity, result.records);
  return result;
}

const MP_UI_RELATED_ = {
  Leads: [['Consultations', 'LeadID'], ['FollowUps', 'LeadID'], ['Documents', 'EntityID', 'LEAD']],
  Clients: [['Cases', 'ClientID'], ['Consultations', 'ClientID'], ['Transactions', 'ClientID'], ['FollowUps', 'ClientID'], ['Documents', 'EntityID', 'CLIENT']],
  Companies: [['Clients', 'CompanyID'], ['Leads', 'CompanyID']],
  Cases: [['Transactions', 'CaseID'], ['FollowUps', 'CaseID'], ['Documents', 'EntityID', 'CASE']],
  Consultations: [['Transactions', 'ConsultationID']],
  Users: [['Leads', 'AssignedTo'], ['Clients', 'AssignedTo'], ['Cases', 'AssignedLawyer'], ['Consultations', 'AssignedLawyer'], ['FollowUps', 'AssignedTo']]
};

/** One record plus its related records (where readable), labels, and history (seniors). */
function mpApiDetail_(actor, entity, id) {
  const record = mpApiGet_(actor, entity, id);
  const related = {};
  let allRecords = [record];
  const labels = mpApiLabels_(actor, entity, [record]);
  (MP_UI_RELATED_[entity] || []).forEach(function(relation) {
    const target = relation[0];
    if (!mpCan_(actor.role, target, 'read')) return;
    const filters = {};
    filters[relation[1]] = record[MP_SCHEMAS[entity][0]];
    if (relation[2]) filters.EntityType = relation[2];
    const list = mpApiList_(actor, target, { filters: filters, limit: MP_CONFIG.MAX_PAGE_SIZE, sortBy: mpUiCreatedField_(target), sortDirection: 'desc' });
    related[target] = { records: list.records, total: list.total, linkField: relation[1], entityType: relation[2] || null };
    Object.assign(labels, mpApiLabels_(actor, target, list.records));
    allRecords = allRecords.concat(list.records);
  });
  const team = MP_CONFIG.ASSIGNABLE_ENTITIES.indexOf(entity) !== -1 && mpCan_(actor.role, 'Assignments', 'read') ? mpApiGetTeam_(actor, entity, id) : null;
  let memberships = null;
  if (entity === 'Users') {
    memberships = mpActiveAssignments_().filter(function(row) { return row.UserID === record.UserID; }).map(mpPublicRecord_);
    MP_CONFIG.ASSIGNABLE_ENTITIES.forEach(function(target) {
      const idField = MP_SCHEMAS[target][0];
      const wanted = {};
      memberships.forEach(function(row) { if (row.EntityType === target) wanted[row.EntityID] = true; });
      mpRows_(target).records.forEach(function(item) { if (wanted[item[idField]]) labels[item[idField]] = mpUiRecordLabel_(target, item); });
    });
  }
  const activities = mpCan_(actor.role, 'Activities', 'read') ? mpListActivities_(entity, String(id), 25) : null;
  if (activities) {
    const userIds = activities.map(function(activity) { return activity.PerformedBy; });
    mpRows_('Users').records.forEach(function(user) { if (userIds.indexOf(user.UserID) !== -1) labels[user.UserID] = mpPlainText_(user.FullName); });
  }
  return { record: record, related: related, labels: labels, activities: activities, team: team, memberships: memberships };
}

/** Creation timestamp column (Documents use UploadedAt). */
function mpUiCreatedField_(entity) { return MP_SCHEMAS[entity].indexOf('CreatedAt') !== -1 ? 'CreatedAt' : 'UploadedAt'; }

function mpCairoDate_(iso) { return String(iso || '').slice(0, 10); }

function mpAddDaysIso_(days) {
  return Utilities.formatDate(new Date(Date.now() + days * 86400000), MP_CONFIG.DATE_TIMEZONE, 'yyyy-MM-dd');
}

/** Dashboard summary limited to what the actor's role may read. */
function mpApiDashboard_(actor) {
  const today = mpCairoDate_(mpNowIso_());
  const month = today.slice(0, 7);
  const soon = mpAddDaysIso_(7);
  const out = { today: today, sections: {} };
  const scope = mpAccessScope_(actor);
  const active = function(entity) { return mpRows_(entity).records.filter(function(record) { return record.IsArchived !== true && mpRecordInScope_(scope, entity, record); }).map(mpPublicRecord_); };
  const countBy = function(records, field) {
    const counts = {};
    records.forEach(function(record) { counts[record[field]] = (counts[record[field]] || 0) + 1; });
    return counts;
  };
  const byDate = function(field) { return function(left, right) { return String(left[field]).localeCompare(String(right[field])); }; };
  const labelled = [];

  if (mpCan_(actor.role, 'Leads', 'read')) {
    const leads = active('Leads');
    const open = leads.filter(MP_OPEN_WORK_.Leads);
    out.sections.leads = {
      open: open.length,
      byStatus: countBy(open, 'Status'),
      newThisMonth: leads.filter(function(lead) { return String(lead.CreatedAt).slice(0, 7) === month; }).length,
      unassigned: scope ? null : open.filter(function(lead) { return mpIsBlank_(lead.AssignedTo); }).length,
      followUpDue: open.filter(function(lead) { return !mpIsBlank_(lead.NextFollowUpAt) && mpCairoDate_(lead.NextFollowUpAt) <= today; }).sort(byDate('NextFollowUpAt')).slice(0, 10)
    };
    labelled.push(['Leads', out.sections.leads.followUpDue]);
  }
  if (mpCan_(actor.role, 'Cases', 'read')) {
    const cases = active('Cases').filter(MP_OPEN_WORK_.Cases);
    out.sections.cases = {
      open: cases.length,
      mine: cases.filter(function(item) { return item.AssignedLawyer === actor.userId; }).length,
      byStatus: countBy(cases, 'Status'),
      deadlines: cases.filter(function(item) { return !mpIsBlank_(item.Deadline) && mpCairoDate_(item.Deadline) <= mpAddDaysIso_(14); }).sort(byDate('Deadline')).slice(0, 10)
        .map(function(item) { return mpRedactRecord_(actor, 'Cases', item); })
    };
    labelled.push(['Cases', out.sections.cases.deadlines]);
  }
  if (mpCan_(actor.role, 'FollowUps', 'read')) {
    const tasks = active('FollowUps').filter(MP_OPEN_WORK_.FollowUps);
    const due = tasks.filter(function(task) { return mpCairoDate_(task.DueDate) <= soon; }).sort(byDate('DueDate'));
    out.sections.followUps = {
      open: tasks.length,
      overdue: tasks.filter(function(task) { return mpCairoDate_(task.DueDate) < today; }).length,
      mine: due.filter(function(task) { return task.AssignedTo === actor.userId; }).slice(0, 10),
      due: due.slice(0, 10)
    };
    labelled.push(['FollowUps', out.sections.followUps.due.concat(out.sections.followUps.mine)]);
  }
  if (mpCan_(actor.role, 'Consultations', 'read')) {
    const upcoming = active('Consultations').filter(function(item) {
      const day = mpCairoDate_(item.ConsultationDate);
      return item.Status === 'SCHEDULED' && day >= today && day <= soon;
    }).sort(byDate('ConsultationDate'));
    out.sections.consultations = { upcoming: upcoming.slice(0, 10), upcomingCount: upcoming.length };
    labelled.push(['Consultations', out.sections.consultations.upcoming]);
  }
  if (mpCanSeeFinancials_(actor.role)) {
    const transactions = active('Transactions').filter(function(item) { return String(item.PaymentDate).slice(0, 7) === month; });
    const sum = function(type) { return transactions.filter(function(item) { return item.Type === type; }).reduce(function(total, item) { return total + Number(item.Amount || 0); }, 0); };
    const openCases = active('Cases').filter(MP_OPEN_WORK_.Cases);
    out.sections.finance = {
      month: month,
      incomeThisMonth: sum('INCOME'),
      expenseThisMonth: sum('EXPENSE'),
      outstanding: openCases.reduce(function(total, item) { return total + Math.max(Number(item.OutstandingBalance || 0), 0); }, 0),
      currency: MP_DEFAULT_SETTINGS.CURRENCY
    };
  }
  out.labels = {};
  labelled.forEach(function(pair) { Object.assign(out.labels, mpApiLabels_(actor, pair[0], pair[1])); });
  return out;
}

// --------------------------------------------------------- Public entry points

/** UI bootstrap: profile, permissions, enums, form metadata, assignable users. Records LastLogin. */
function apiGetAppBootstrap() {
  return mpApiRespond_(function() {
    const actor = mpRequireActiveUser_();
    mpTouchLastLogin_(actor.userId);
    return mpApiBootstrap_(actor);
  });
}

function apiGetDashboard() {
  return mpApiRespond_(function() { return mpApiDashboard_(mpRequireActiveUser_()); });
}

/** Like apiList, plus a labels map for referenced IDs. */
function apiListView(entity, options) {
  return mpApiRespond_(function() { return mpApiListWithLabels_(mpRequireActiveUser_(), entity, options); });
}

function apiGetDetail(entity, id) {
  return mpApiRespond_(function() { return mpApiDetail_(mpRequireActiveUser_(), entity, id); });
}

const MP_SEARCH_ENTITIES_ = ['Clients', 'Cases', 'Leads', 'Companies', 'Consultations', 'FollowUps'];

/** One search box for the whole app: up to 5 matches per readable entity, scoped like every list. */
function mpApiSearch_(actor, query) {
  const text = String(query || '').trim();
  if (text.length < 2) return { query: text, groups: [] };
  const groups = [];
  MP_SEARCH_ENTITIES_.forEach(function(entity) {
    if (!mpCan_(actor.role, entity, 'read')) return;
    const list = mpApiList_(actor, entity, { query: text, limit: 5, sortBy: mpUiCreatedField_(entity), sortDirection: 'desc' });
    if (!list.records.length) return;
    groups.push({ entity: entity, total: list.total, records: list.records, labels: mpApiLabels_(actor, entity, list.records) });
  });
  return { query: text, groups: groups };
}

/** Global search across clients, cases, leads, companies, consultations, and tasks. */
function apiSearch(query) {
  return mpApiRespond_(function() { return mpApiSearch_(mpRequireActiveUser_(), query); });
}
