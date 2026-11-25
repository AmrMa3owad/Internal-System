function mpValidateEmail_(email, fieldName, required) {
  const normalized = mpNormalizeEmail_(email);
  if (!normalized && !required) return '';
  if (normalized.length > 320) throw new Error((fieldName || 'Email') + ' exceeds the allowed length.');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) throw new Error((fieldName || 'Email') + ' is invalid.');
  return normalized;
}

function mpValidateRecord_(sheetName, input, isCreate) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('A record object is required.');
  const record = {};
  Object.keys(input).forEach(function(key) {
    if (MP_SCHEMAS[sheetName].indexOf(key) === -1) throw new Error('Unknown field for ' + sheetName + ': ' + key + '.');
    record[key] = input[key];
  });

  switch (sheetName) {
    case 'Users':
      record.FullName = mpRequiredText_(record.FullName, 'FullName', 200);
      record.Email = mpValidateEmail_(record.Email, 'Email', true);
      record.Role = mpAssertEnum_(record.Role, MP_CONFIG.ROLES, 'Role', true);
      record.Status = mpAssertEnum_(record.Status || 'ACTIVE', MP_CONFIG.USER_STATUSES, 'Status', true);
      record.Language = mpAssertEnum_(record.Language || 'EN', MP_CONFIG.LANGUAGES, 'Language', true);
      break;
    case 'Leads':
      record.FullName = mpRequiredText_(record.FullName, 'FullName', 200);
      record.Email = mpValidateEmail_(record.Email, 'Email', false);
      record.Phone = mpValidatePhone_(record.Phone, false);
      record.SocialProfile = mpIsBlank_(record.SocialProfile) ? '' : mpRequiredText_(record.SocialProfile, 'SocialProfile', 200);
      if (!record.Email && !record.Phone && !record.SocialProfile) throw new Error('A lead needs a phone number, email address, or social profile.');
      record.ClientType = mpAssertEnum_(record.ClientType || 'INDIVIDUAL', MP_CONFIG.CLIENT_TYPES, 'ClientType', true);
      record.Source = mpAssertEnum_(record.Source, MP_CONFIG.LEAD_SOURCES, 'Source', true);
      record.Priority = mpAssertEnum_(record.Priority || 'MEDIUM', MP_CONFIG.PRIORITIES, 'Priority', true);
      record.Status = mpAssertEnum_(record.Status || 'NEW', MP_CONFIG.LEAD_STATUSES, 'Status', true);
      mpValidateOptionalDateFields_(record, ['LastContactAt', 'NextFollowUpAt']);
      record.PracticeArea = mpValidatePracticeArea_(record.PracticeArea);
      break;
    case 'Clients':
      record.ClientType = mpAssertEnum_(record.ClientType || 'INDIVIDUAL', MP_CONFIG.CLIENT_TYPES, 'ClientType', true);
      record.FullName = mpRequiredText_(record.FullName, 'FullName', 200);
      record.Email = mpValidateEmail_(record.Email, 'Email', false);
      record.Phone = mpValidatePhone_(record.Phone, false);
      if (!record.Email && !record.Phone) throw new Error('A client needs a phone number or email address.');
      record.Status = mpAssertEnum_(record.Status || 'ACTIVE', MP_CONFIG.CLIENT_STATUSES, 'Status', true);
      if (record.ClientType === 'COMPANY' && mpIsBlank_(record.CompanyID)) throw new Error('CompanyID is required when ClientType is COMPANY.');
      break;
    case 'Companies':
      record.CompanyName = mpRequiredText_(record.CompanyName, 'CompanyName', 250);
      record.Email = mpValidateEmail_(record.Email, 'Email', false);
      record.Phone = mpValidatePhone_(record.Phone, false);
      break;
    case 'Cases':
      record.CaseTitle = mpRequiredText_(record.CaseTitle, 'CaseTitle', 300);
      record.ClientID = mpRequiredText_(record.ClientID, 'ClientID', 80);
      record.Priority = mpAssertEnum_(record.Priority || 'MEDIUM', MP_CONFIG.PRIORITIES, 'Priority', true);
      record.Status = mpAssertEnum_(record.Status || 'INITIAL_REVIEW', MP_CONFIG.CASE_STATUSES, 'Status', true);
      record.AgreedFee = mpToNumber_(record.AgreedFee || 0, 'AgreedFee', true);
      if (record.AgreedFee < 0) throw new Error('AgreedFee cannot be negative.');
      mpValidateOptionalDateFields_(record, ['StartDate', 'Deadline', 'ClosedAt']);
      record.PracticeArea = mpValidatePracticeArea_(record.PracticeArea);
      break;
    case 'Consultations':
      if (mpIsBlank_(record.LeadID) && mpIsBlank_(record.ClientID)) throw new Error('A consultation must be linked to a lead or client.');
      record.ConsultationDate = mpDateIso_(record.ConsultationDate, 'ConsultationDate', true);
      record.Duration = mpToNumber_(record.Duration, 'Duration', true);
      if (record.Duration <= 0) throw new Error('Duration must be greater than zero.');
      record.Fee = mpToNumber_(record.Fee || 0, 'Fee', true);
      if (record.Fee < 0) throw new Error('Fee cannot be negative.');
      // PaymentStatus is authoritative; IsPaid is kept consistent with it.
      if (mpIsBlank_(record.PaymentStatus)) {
        record.PaymentStatus = mpIsBlank_(record.IsPaid) ? 'UNPAID' : (mpBoolean_(record.IsPaid) ? 'PAID' : 'UNPAID');
      } else if (!mpIsBlank_(record.IsPaid)) {
        mpBoolean_(record.IsPaid);
      }
      record.PaymentStatus = mpAssertEnum_(record.PaymentStatus, MP_CONFIG.PAYMENT_STATUSES, 'PaymentStatus', true);
      record.IsPaid = record.PaymentStatus === 'PAID';
      record.PaymentNote = mpIsBlank_(record.PaymentNote) ? '' : mpRequiredText_(record.PaymentNote, 'PaymentNote', 500);
      record.Status = mpAssertEnum_(record.Status || 'SCHEDULED', MP_CONFIG.CONSULTATION_STATUSES, 'Status', true);
      break;
    case 'Transactions':
      record.Type = mpAssertEnum_(record.Type, MP_CONFIG.TRANSACTION_TYPES, 'Type', true);
      record.Amount = mpToNumber_(record.Amount, 'Amount', true);
      if (record.Amount <= 0) throw new Error('Amount must be greater than zero.');
      record.PaymentMethod = mpAssertEnum_(record.PaymentMethod, MP_CONFIG.PAYMENT_METHODS, 'PaymentMethod', true);
      record.PaymentDate = mpDateIso_(record.PaymentDate, 'PaymentDate', true);
      break;
    case 'FollowUps':
      record.Title = mpRequiredText_(record.Title, 'Title', 250);
      if (mpIsBlank_(record.LeadID) && mpIsBlank_(record.ClientID) && mpIsBlank_(record.CaseID)) throw new Error('A follow-up must be linked to a lead, client, or case.');
      record.DueDate = mpDateIso_(record.DueDate, 'DueDate', true);
      record.Priority = mpAssertEnum_(record.Priority || 'MEDIUM', MP_CONFIG.PRIORITIES, 'Priority', true);
      record.Status = mpAssertEnum_(record.Status || 'OPEN', MP_CONFIG.FOLLOW_UP_STATUSES, 'Status', true);
      if (!mpIsBlank_(record.CompletedAt)) record.CompletedAt = mpDateIso_(record.CompletedAt, 'CompletedAt', false);
      break;
    case 'ExternalPartners':
      record.Name = mpRequiredText_(record.Name, 'Name', 200);
      record.PartnerType = mpAssertEnum_(record.PartnerType || 'LAWYER', MP_CONFIG.PARTNER_TYPES, 'PartnerType', true);
      record.Status = mpAssertEnum_(record.Status || 'ACTIVE', MP_CONFIG.PARTNER_STATUSES, 'Status', true);
      record.Email = mpValidateEmail_(record.Email, 'Email', false);
      record.Phone = mpValidatePhone_(record.Phone, false);
      record.FullShareRate = mpValidatePercent_(record.FullShareRate, 'FullShareRate');
      record.SharedShareRate = mpValidatePercent_(record.SharedShareRate, 'SharedShareRate');
      break;
    case 'Referrals':
      record.PartnerID = mpRequiredText_(record.PartnerID, 'PartnerID', 80);
      record.Scope = mpAssertEnum_(record.Scope, MP_CONFIG.REFERRAL_SCOPES, 'Scope', true);
      if (record.Scope === 'ADMIN_ONLY') {
        // Administrative work for the partner: say what the job is; linking one of our cases is optional.
        record.Title = mpRequiredText_(record.Title, 'Title', 250);
        record.CaseID = mpIsBlank_(record.CaseID) ? '' : mpRequiredText_(record.CaseID, 'CaseID', 80);
        record.ExternalWork = '';
      } else {
        record.CaseID = mpRequiredText_(record.CaseID, 'CaseID', 80);
        record.Title = mpIsBlank_(record.Title) ? '' : mpRequiredText_(record.Title, 'Title', 250);
        record.ExternalWork = mpAssertEnum_(record.ExternalWork || 'WHOLE_CASE', MP_CONFIG.REFERRAL_WORK_TYPES, 'ExternalWork', true);
      }
      record.Status = mpAssertEnum_(record.Status || 'ACTIVE', MP_CONFIG.REFERRAL_STATUSES, 'Status', true);
      record.SharePercent = mpValidatePercent_(record.SharePercent, 'SharePercent');
      record.ReferredAt = mpDateIso_(mpIsBlank_(record.ReferredAt) ? mpNowIso_().slice(0, 10) : record.ReferredAt, 'ReferredAt', true);
      if (!mpIsBlank_(record.FinalProfit)) {
        record.FinalProfit = mpToNumber_(record.FinalProfit, 'FinalProfit', true);
        if (record.FinalProfit < 0) throw new Error('FinalProfit cannot be negative.');
      }
      break;
    case 'ReferralWork':
      record.ReferralID = mpRequiredText_(record.ReferralID, 'ReferralID', 80);
      record.Title = mpRequiredText_(record.Title, 'Title', 250);
      record.WorkDate = mpDateIso_(mpIsBlank_(record.WorkDate) ? mpNowIso_().slice(0, 10) : record.WorkDate, 'WorkDate', true);
      record.Fee = mpIsBlank_(record.Fee) ? '' : mpToNumber_(record.Fee, 'Fee', true);
      if (record.Fee !== '' && record.Fee < 0) throw new Error('Fee cannot be negative.');
      // Money our team spent for the task (transport, institution fees) that the partner reimburses.
      record.Expenses = mpIsBlank_(record.Expenses) ? '' : mpToNumber_(record.Expenses, 'Expenses', true);
      if (record.Expenses !== '' && record.Expenses < 0) throw new Error('Expenses cannot be negative.');
      break;
    case 'ReferralPayments':
      record.ReferralID = mpRequiredText_(record.ReferralID, 'ReferralID', 80);
      record.Amount = mpToNumber_(record.Amount, 'Amount', true);
      if (record.Amount <= 0) throw new Error('Amount must be greater than zero.');
      record.PaymentMethod = mpAssertEnum_(record.PaymentMethod || 'BANK_TRANSFER', MP_CONFIG.PAYMENT_METHODS, 'PaymentMethod', true);
      record.PaymentDate = mpDateIso_(mpIsBlank_(record.PaymentDate) ? mpNowIso_().slice(0, 10) : record.PaymentDate, 'PaymentDate', true);
      break;
    case 'Documents':
      record.EntityType = mpAssertEnum_(record.EntityType, MP_CONFIG.DOCUMENT_ENTITY_TYPES, 'EntityType', true);
      record.EntityID = mpRequiredText_(record.EntityID, 'EntityID', 80);
      record.FileName = mpRequiredText_(record.FileName, 'FileName', 500);
      record.DriveFileID = mpRequiredText_(record.DriveFileID, 'DriveFileID', 200);
      record.ConfidentialityLevel = mpAssertEnum_(record.ConfidentialityLevel || 'CONFIDENTIAL', MP_CONFIG.CONFIDENTIALITY_LEVELS, 'ConfidentialityLevel', true);
      break;
    default:
      if (!isCreate) return record;
  }
  return mpSanitizeRecordText_(record);
}

/** A share percentage: blank, or a number from 0 to 100. */
function mpValidatePercent_(value, fieldName) {
  if (mpIsBlank_(value)) return '';
  const number = mpToNumber_(value, fieldName, true);
  if (number < 0 || number > 100) throw new Error(fieldName + ' must be between 0 and 100.');
  return number;
}

/** PracticeArea is optional, but when supplied must be a configured value. */
function mpValidatePracticeArea_(value) {
  if (mpIsBlank_(value)) return '';
  const allowed = mpGetSettingValue_('PRACTICE_AREAS');
  return mpAssertEnum_(value, Array.isArray(allowed) ? allowed : MP_DEFAULT_SETTINGS.PRACTICE_AREAS, 'PracticeArea', true);
}

function mpRequiredText_(value, fieldName, maxLength) {
  const text = mpCleanText_(value, maxLength);
  if (!text) throw new Error(fieldName + ' is required.');
  return text;
}

function mpValidatePhone_(phone, required) {
  if (mpIsBlank_(phone)) {
    if (required) throw new Error('Phone is required.');
    return '';
  }
  const normalized = mpNormalizePhone_(phone);
  if (normalized.length < 7 || normalized.length > 20) throw new Error('Phone is invalid.');
  return mpCleanText_(String(phone), 30);
}

function mpBoolean_(value) {
  if (value === true || String(value).toLowerCase() === 'true') return true;
  if (value === false || String(value).toLowerCase() === 'false') return false;
  throw new Error('IsPaid must be a boolean value (true or false).');
}

function mpValidateOptionalDateFields_(record, fields) {
  fields.forEach(function(field) {
    if (!mpIsBlank_(record[field])) record[field] = mpDateIso_(record[field], field, false);
  });
}

function mpSanitizeRecordText_(record) {
  Object.keys(record).forEach(function(key) {
    if (typeof record[key] === 'string' && key !== 'Email') record[key] = mpCleanText_(record[key]);
  });
  return record;
}

/** Foreign-key checks prevent orphaned records through the application API. */
function mpValidateReferences_(sheetName, record) {
  const checks = {
    Leads: [['CompanyID', 'Companies'], ['AssignedTo', 'Users']],
    Referrals: [['PartnerID', 'ExternalPartners'], ['CaseID', 'Cases'], ['AssignedTo', 'Users']],
    ReferralWork: [['ReferralID', 'Referrals'], ['DoneBy', 'Users']],
    ReferralPayments: [['ReferralID', 'Referrals']],
    Clients: [['CompanyID', 'Companies'], ['AssignedTo', 'Users']],
    Cases: [['ClientID', 'Clients'], ['AssignedLawyer', 'Users']],
    Consultations: [['LeadID', 'Leads'], ['ClientID', 'Clients'], ['AssignedLawyer', 'Users']],
    Transactions: [['ClientID', 'Clients'], ['CaseID', 'Cases'], ['ConsultationID', 'Consultations'], ['RecordedBy', 'Users']],
    FollowUps: [['LeadID', 'Leads'], ['ClientID', 'Clients'], ['CaseID', 'Cases'], ['AssignedTo', 'Users']],
    Documents: []
  }[sheetName] || [];
  checks.forEach(function(check) {
    const field = check[0];
    const entity = check[1];
    if (mpIsBlank_(record[field])) return;
    record[field] = mpAssertEntityId_(entity, record[field], field, false);
    if (!mpDbGetById_(entity, record[field], false)) throw new Error(field + ' does not reference an active ' + entity.slice(0, -1) + '.');
  });
  if (sheetName === 'Documents') {
    const entityMap = { LEAD: 'Leads', CLIENT: 'Clients', CASE: 'Cases' };
    const entity = entityMap[record.EntityType];
    record.EntityID = mpAssertEntityId_(entity, record.EntityID, 'EntityID', true);
    if (!mpDbGetById_(entity, record.EntityID, false)) throw new Error('EntityID does not reference an active ' + entity.slice(0, -1) + '.');
  }
  if (sheetName === 'Transactions' && !mpIsBlank_(record.CaseID)) {
    if (mpIsBlank_(record.ClientID)) throw new Error('ClientID is required when CaseID is supplied.');
    const caseRecord = mpDbGetById_('Cases', record.CaseID, false);
    if (!caseRecord || caseRecord.ClientID !== record.ClientID) throw new Error('Transaction ClientID must match the client associated with CaseID.');
  }
  if (sheetName === 'Transactions' && !mpIsBlank_(record.ConsultationID)) {
    const consultation = mpDbGetById_('Consultations', record.ConsultationID, false);
    if (consultation && !mpIsBlank_(consultation.ClientID)) {
      if (mpIsBlank_(record.ClientID) || consultation.ClientID !== record.ClientID) throw new Error('Transaction ClientID must match the client associated with ConsultationID.');
    }
  }
}
