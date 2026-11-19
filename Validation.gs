function mpValidateEmail_(email, fieldName, required) {
  const normalized = mpNormalizeEmail_(email);
  if (!normalized && !required) return '';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) throw new Error((fieldName || 'Email') + ' is invalid.');
  return normalized;
}

function mpValidateRecord_(sheetName, input, isCreate) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('A record object is required.');
  const record = {};
  Object.keys(input).forEach(function(key) {
    if (MP_SCHEMAS[sheetName].indexOf(key) !== -1) record[key] = input[key];
  });

  switch (sheetName) {
    case 'Users':
      record.FullName = mpRequiredText_(record.FullName, 'FullName', 200);
      record.Email = mpValidateEmail_(record.Email, 'Email', true);
      record.Role = mpAssertEnum_(record.Role, MP_CONFIG.ROLES, 'Role', true);
      record.Status = mpAssertEnum_(record.Status || 'ACTIVE', MP_CONFIG.USER_STATUSES, 'Status', true);
      break;
    case 'Leads':
      record.FullName = mpRequiredText_(record.FullName, 'FullName', 200);
      record.Email = mpValidateEmail_(record.Email, 'Email', false);
      record.Phone = mpValidatePhone_(record.Phone, false);
      if (!record.Email && !record.Phone) throw new Error('A lead needs a phone number or email address.');
      record.ClientType = mpAssertEnum_(record.ClientType || 'INDIVIDUAL', MP_CONFIG.CLIENT_TYPES, 'ClientType', true);
      record.Source = mpAssertEnum_(record.Source, MP_CONFIG.LEAD_SOURCES, 'Source', true);
      record.Priority = mpAssertEnum_(record.Priority || 'MEDIUM', MP_CONFIG.PRIORITIES, 'Priority', true);
      record.Status = mpAssertEnum_(record.Status || 'NEW', MP_CONFIG.LEAD_STATUSES, 'Status', true);
      mpValidateOptionalDateFields_(record, ['LastContactAt', 'NextFollowUpAt']);
      break;
    case 'Clients':
      record.ClientType = mpAssertEnum_(record.ClientType || 'INDIVIDUAL', MP_CONFIG.CLIENT_TYPES, 'ClientType', true);
      record.FullName = mpRequiredText_(record.FullName, 'FullName', 200);
      record.Email = mpValidateEmail_(record.Email, 'Email', false);
      record.Phone = mpValidatePhone_(record.Phone, false);
      if (!record.Email && !record.Phone) throw new Error('A client needs a phone number or email address.');
      record.Status = mpCleanText_(record.Status || 'ACTIVE', 30).toUpperCase();
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
      break;
    case 'Consultations':
      if (mpIsBlank_(record.LeadID) && mpIsBlank_(record.ClientID)) throw new Error('A consultation must be linked to a lead or client.');
      record.ConsultationDate = mpDateIso_(record.ConsultationDate, 'ConsultationDate', true);
      record.Duration = mpToNumber_(record.Duration, 'Duration', true);
      if (record.Duration <= 0) throw new Error('Duration must be greater than zero.');
      record.IsPaid = mpBoolean_(record.IsPaid);
      record.Fee = mpToNumber_(record.Fee || 0, 'Fee', true);
      if (record.Fee < 0) throw new Error('Fee cannot be negative.');
      record.PaymentStatus = mpAssertEnum_(record.PaymentStatus || (record.IsPaid ? 'PAID' : 'UNPAID'), MP_CONFIG.PAYMENT_STATUSES, 'PaymentStatus', true);
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
    case 'Documents':
      record.EntityType = mpRequiredText_(record.EntityType, 'EntityType', 50).toUpperCase();
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
  return value === true || String(value).toLowerCase() === 'true';
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

function mpFindDuplicates_(sheetName, input, excludeId) {
  if (['Users', 'Leads', 'Clients', 'Companies'].indexOf(sheetName) === -1) return [];
  const phone = mpNormalizePhone_(input.Phone);
  const email = mpNormalizeEmail_(input.Email);
  const registration = String(input.CommercialRegistrationNumber || '').trim().toLowerCase();
  const taxNumber = String(input.TaxNumber || '').trim().toLowerCase();
  if (!phone && !email && !registration && !taxNumber) return [];
  const idColumn = MP_SCHEMAS[sheetName][0];
  return mpDbList_(sheetName, { includeArchived: false, limit: MP_CONFIG.MAX_PAGE_SIZE }).records
    .filter(function(record) {
      if (record[idColumn] === excludeId) return false;
      return (phone && mpNormalizePhone_(record.Phone) === phone) ||
        (email && mpNormalizeEmail_(record.Email) === email) ||
        (registration && String(record.CommercialRegistrationNumber || '').trim().toLowerCase() === registration) ||
        (taxNumber && String(record.TaxNumber || '').trim().toLowerCase() === taxNumber);
    })
    .map(function(record) {
      return { id: record[idColumn], fullName: record.FullName || record.CompanyName, phone: record.Phone || '', email: record.Email || '' };
    });
}

/** Foreign-key checks prevent orphaned records through the application API. */
function mpValidateReferences_(sheetName, record) {
  const checks = {
    Leads: [['CompanyID', 'Companies']],
    Clients: [['CompanyID', 'Companies']],
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
    if (!mpDbGetById_(entity, record[field], false)) throw new Error(field + ' does not reference an active ' + entity.slice(0, -1) + '.');
  });
}
