/**
 * Server-only configuration. Spreadsheet identifiers and folder identifiers
 * belong in Script Properties, never in HTML or client-side JavaScript.
 */
const MP_CONFIG = Object.freeze({
  DATABASE_NAME: 'MOHAMY PLUS - DATABASE',
  DATABASE_ID_PROPERTY: 'MP_DATABASE_SPREADSHEET_ID',
  INITIAL_OWNER_PROPERTY: 'MP_INITIAL_OWNER_EMAIL',
  DOCUMENTS_FOLDER_PROPERTY: 'MP_DOCUMENTS_FOLDER_ID',
  DOCUMENTS_FOLDER_NAME: 'MOHAMY PLUS - DOCUMENTS',
  MAX_UPLOAD_BYTES: 10 * 1024 * 1024,
  UPLOAD_EXTENSIONS: ['pdf', 'png', 'jpg', 'jpeg', 'gif', 'webp', 'heic', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'txt', 'csv', 'rtf', 'odt', 'ods', 'zip'],
  REMINDER_HOUR: 7,
  LANGUAGES: ['EN', 'AR'],
  DATE_TIMEZONE: 'Africa/Cairo',
  PAGE_SIZE: 50,
  MAX_PAGE_SIZE: 100,
  MAX_TEXT_LENGTH: 10000,
  ARCHIVE_COLUMNS: ['IsArchived', 'ArchivedAt', 'Version'],
  ROLES: ['OWNER', 'PARTNER', 'LAWYER', 'ASSISTANT'],
  USER_STATUSES: ['ACTIVE', 'INACTIVE'],
  CLIENT_TYPES: ['INDIVIDUAL', 'COMPANY'],
  CLIENT_STATUSES: ['ACTIVE', 'INACTIVE'],
  PRIORITIES: ['LOW', 'MEDIUM', 'HIGH', 'URGENT'],
  LEAD_STATUSES: [
    'NEW', 'CONTACTED', 'AWAITING_RESPONSE', 'QUALIFIED',
    'CONSULTATION_SCHEDULED', 'PROPOSAL_SENT', 'NEGOTIATION',
    'CONVERTED', 'LOST', 'NOT_QUALIFIED'
  ],
  LEAD_SOURCES: ['WEBSITE', 'FACEBOOK', 'INSTAGRAM', 'TIKTOK', 'WHATSAPP', 'REFERRAL', 'PHONE', 'OTHER'],
  CASE_STATUSES: [
    'INITIAL_REVIEW', 'DOCUMENTS_REQUIRED', 'UNDER_PREPARATION', 'IN_PROGRESS',
    'AWAITING_CLIENT', 'AWAITING_EXTERNAL_ACTION', 'COMPLETED', 'CANCELLED'
  ],
  CLOSED_CASE_STATUSES: ['COMPLETED', 'CANCELLED'],
  FOLLOW_UP_STATUSES: ['OPEN', 'COMPLETED', 'CANCELLED'],
  CONSULTATION_STATUSES: ['SCHEDULED', 'COMPLETED', 'CANCELLED', 'NO_SHOW'],
  PAYMENT_STATUSES: ['UNPAID', 'PARTIALLY_PAID', 'PAID', 'WAIVED'],
  TRANSACTION_TYPES: ['INCOME', 'EXPENSE'],
  PAYMENT_METHODS: ['CASH', 'BANK_TRANSFER', 'CARD', 'VODAFONE_CASH', 'INSTAPAY', 'CHEQUE', 'OTHER'],
  CONFIDENTIALITY_LEVELS: ['STANDARD', 'CONFIDENTIAL', 'RESTRICTED'],
  ADMIN_ROLES: ['OWNER'],
  // Roles that only see records assigned to them (see Access.gs).
  RECORD_RESTRICTED_ROLES: ['LAWYER', 'ASSISTANT'],
  ASSIGNABLE_ENTITIES: ['Leads', 'Clients', 'Cases'],
  DOCUMENT_ENTITY_TYPES: ['LEAD', 'CLIENT', 'CASE'],
  ENTITY_ID_PREFIXES: {
    Users: 'USR', Leads: 'LED', Clients: 'CLT', Companies: 'CMP', Cases: 'CAS',
    Consultations: 'CON', Transactions: 'TRX', FollowUps: 'FLW', Activities: 'ACT',
    Documents: 'DOC', Assignments: 'ASG'
  }
});

/** Fields owned by trusted server workflows, never by generic user updates. */
const MP_SYSTEM_MANAGED_FIELDS = Object.freeze({
  Users: ['UserID', 'CreatedAt', 'LastLogin', 'IsArchived', 'ArchivedAt', 'Version'],
  Leads: ['LeadID', 'CreatedAt', 'UpdatedAt', 'ConvertedClientID', 'IsArchived', 'ArchivedAt', 'Version'],
  Clients: ['ClientID', 'CreatedAt', 'CreatedFromLeadID', 'IsArchived', 'ArchivedAt', 'Version'],
  Companies: ['CompanyID', 'CreatedAt', 'IsArchived', 'ArchivedAt', 'Version'],
  Cases: ['CaseID', 'TotalPaid', 'OutstandingBalance', 'CreatedAt', 'UpdatedAt', 'ClosedAt', 'IsArchived', 'ArchivedAt', 'Version'],
  Consultations: ['ConsultationID', 'CreatedAt', 'IsArchived', 'ArchivedAt', 'Version'],
  Transactions: ['TransactionID', 'RecordedBy', 'CreatedAt', 'IsArchived', 'ArchivedAt', 'Version'],
  FollowUps: ['FollowUpID', 'CreatedAt', 'CompletedAt', 'IsArchived', 'ArchivedAt', 'Version'],
  Activities: ['ActivityID', 'EntityType', 'EntityID', 'Action', 'Description', 'PerformedBy', 'Timestamp'],
  Documents: ['DocumentID', 'DriveFileID', 'FileType', 'UploadedBy', 'UploadedAt', 'IsArchived', 'ArchivedAt', 'Version'],
  Assignments: ['AssignmentID', 'EntityType', 'EntityID', 'UserID', 'AddedBy', 'AddedAt', 'IsArchived', 'ArchivedAt', 'Version'],
  Settings: ['SettingKey', 'UpdatedAt', 'UpdatedBy', 'Version']
});

/** Requested business fields are retained; operational metadata is appended. */
const MP_SCHEMAS = Object.freeze({
  Users: ['UserID', 'FullName', 'Email', 'Role', 'Status', 'Language', 'CreatedAt', 'LastLogin', 'IsArchived', 'ArchivedAt', 'Version'],
  Leads: ['LeadID', 'FullName', 'Phone', 'Email', 'ClientType', 'CompanyID', 'Source', 'CampaignID', 'PracticeArea', 'InquiryType', 'Description', 'Priority', 'Status', 'AssignedTo', 'CreatedAt', 'UpdatedAt', 'LastContactAt', 'NextFollowUpAt', 'LostReason', 'ConvertedClientID', 'IsArchived', 'ArchivedAt', 'Version'],
  Clients: ['ClientID', 'ClientType', 'FullName', 'CompanyID', 'Phone', 'Email', 'Address', 'Nationality', 'Notes', 'AssignedTo', 'CreatedAt', 'CreatedFromLeadID', 'Status', 'IsArchived', 'ArchivedAt', 'Version'],
  Companies: ['CompanyID', 'CompanyName', 'CommercialRegistrationNumber', 'TaxNumber', 'ContactPerson', 'Phone', 'Email', 'Address', 'Notes', 'CreatedAt', 'IsArchived', 'ArchivedAt', 'Version'],
  // OpposingParties is an intentional Stage 1 extension for conflict checks.
  Cases: ['CaseID', 'CaseNumber', 'CaseTitle', 'ClientID', 'PracticeArea', 'CaseType', 'Description', 'OpposingParties', 'AssignedLawyer', 'Priority', 'Status', 'StartDate', 'Deadline', 'AgreedFee', 'TotalPaid', 'OutstandingBalance', 'CreatedAt', 'UpdatedAt', 'ClosedAt', 'IsArchived', 'ArchivedAt', 'Version'],
  Consultations: ['ConsultationID', 'LeadID', 'ClientID', 'AssignedLawyer', 'ConsultationType', 'ConsultationDate', 'Duration', 'IsPaid', 'Fee', 'PaymentStatus', 'Status', 'MeetingLocation', 'Notes', 'Outcome', 'CreatedAt', 'IsArchived', 'ArchivedAt', 'Version'],
  Transactions: ['TransactionID', 'ClientID', 'CaseID', 'ConsultationID', 'Type', 'Amount', 'PaymentMethod', 'PaymentDate', 'Description', 'RecordedBy', 'CreatedAt', 'IsArchived', 'ArchivedAt', 'Version'],
  FollowUps: ['FollowUpID', 'LeadID', 'ClientID', 'CaseID', 'AssignedTo', 'Title', 'Description', 'DueDate', 'Priority', 'Status', 'CreatedAt', 'CompletedAt', 'IsArchived', 'ArchivedAt', 'Version'],
  Activities: ['ActivityID', 'EntityType', 'EntityID', 'Action', 'Description', 'PerformedBy', 'Timestamp'],
  Documents: ['DocumentID', 'EntityType', 'EntityID', 'FileName', 'DriveFileID', 'FileType', 'UploadedBy', 'UploadedAt', 'Description', 'ConfidentialityLevel', 'IsArchived', 'ArchivedAt', 'Version'],
  Settings: ['SettingKey', 'SettingValue', 'UpdatedAt', 'UpdatedBy', 'Version'],
  // Extra team members per Lead/Client/Case, in addition to the record's main assignee.
  Assignments: ['AssignmentID', 'EntityType', 'EntityID', 'UserID', 'AddedBy', 'AddedAt', 'IsArchived', 'ArchivedAt', 'Version']
});

const MP_DEFAULT_SETTINGS = Object.freeze({
  BUSINESS_NAME: 'Mohamy Plus',
  CURRENCY: 'EGP',
  TIMEZONE: 'Africa/Cairo',
  LEAD_STATUSES: MP_CONFIG.LEAD_STATUSES,
  CASE_STATUSES: MP_CONFIG.CASE_STATUSES,
  PRACTICE_AREAS: ['CRIMINAL', 'CIVIL', 'LABOR', 'CORPORATE', 'COMMERCIAL', 'FAMILY', 'REAL_ESTATE', 'ADMINISTRATIVE', 'OTHER'],
  PAYMENT_METHODS: MP_CONFIG.PAYMENT_METHODS,
  NOTIFICATION_PREFERENCES: { email: true, overdueFollowUps: true, upcomingConsultations: true },
  FUTURE_INTEGRATIONS_ENABLED: false
});

/**
 * Settings an OWNER may change at runtime. Every other setting mirrors a code
 * constant and must keep its default value, because the code enforces it.
 */
const MP_EDITABLE_SETTINGS = Object.freeze(['BUSINESS_NAME', 'PRACTICE_AREAS', 'NOTIFICATION_PREFERENCES', 'FUTURE_INTEGRATIONS_ENABLED']);

/**
 * Entity-level permissions per role. Review with the firm before go-live.
 * There is no row-level (per-assignment) restriction yet.
 */
const MP_ALL_ROLES_ = ['OWNER', 'PARTNER', 'LAWYER', 'ASSISTANT'];
const MP_SENIOR_ROLES_ = ['OWNER', 'PARTNER'];
const MP_FINANCE_ROLES_ = ['OWNER', 'PARTNER', 'ASSISTANT'];
const MP_PERMISSIONS = Object.freeze({
  Users: { read: MP_SENIOR_ROLES_, create: ['OWNER'], update: ['OWNER'], archive: ['OWNER'] },
  Leads: { read: MP_ALL_ROLES_, create: MP_ALL_ROLES_, update: MP_ALL_ROLES_, archive: MP_SENIOR_ROLES_ },
  Clients: { read: MP_ALL_ROLES_, create: MP_ALL_ROLES_, update: MP_ALL_ROLES_, archive: MP_SENIOR_ROLES_ },
  Companies: { read: MP_ALL_ROLES_, create: MP_ALL_ROLES_, update: MP_ALL_ROLES_, archive: MP_SENIOR_ROLES_ },
  Cases: { read: MP_ALL_ROLES_, create: ['OWNER', 'PARTNER', 'LAWYER'], update: ['OWNER', 'PARTNER', 'LAWYER'], archive: MP_SENIOR_ROLES_ },
  Consultations: { read: MP_ALL_ROLES_, create: MP_ALL_ROLES_, update: MP_ALL_ROLES_, archive: MP_SENIOR_ROLES_ },
  Transactions: { read: MP_FINANCE_ROLES_, create: MP_FINANCE_ROLES_, update: MP_FINANCE_ROLES_, archive: MP_SENIOR_ROLES_ },
  FollowUps: { read: MP_ALL_ROLES_, create: MP_ALL_ROLES_, update: MP_ALL_ROLES_, archive: MP_SENIOR_ROLES_ },
  Documents: { read: MP_ALL_ROLES_, create: MP_ALL_ROLES_, update: MP_SENIOR_ROLES_, archive: MP_SENIOR_ROLES_ },
  Activities: { read: MP_SENIOR_ROLES_ },
  Settings: { read: MP_ALL_ROLES_, update: ['OWNER'] },
  LeadConversion: { create: MP_ALL_ROLES_ },
  // Team membership and bulk assignment: who may grant staff access to records.
  Assignments: { read: MP_ALL_ROLES_, create: MP_SENIOR_ROLES_, archive: MP_SENIOR_ROLES_ }
});

/** Foreign keys per entity (field -> target entity). Documents.EntityID is polymorphic via EntityType. */
const MP_REFERENCE_FIELDS = Object.freeze({
  Leads: { CompanyID: 'Companies', AssignedTo: 'Users', ConvertedClientID: 'Clients' },
  Clients: { CompanyID: 'Companies', CreatedFromLeadID: 'Leads', AssignedTo: 'Users' },
  Cases: { ClientID: 'Clients', AssignedLawyer: 'Users' },
  Consultations: { LeadID: 'Leads', ClientID: 'Clients', AssignedLawyer: 'Users' },
  Transactions: { ClientID: 'Clients', CaseID: 'Cases', ConsultationID: 'Consultations', RecordedBy: 'Users' },
  FollowUps: { LeadID: 'Leads', ClientID: 'Clients', CaseID: 'Cases', AssignedTo: 'Users' },
  Documents: { UploadedBy: 'Users' }
});

/** Roles allowed to view a document of each confidentiality level. */
const MP_DOCUMENT_ACCESS = Object.freeze({
  STANDARD: MP_ALL_ROLES_,
  CONFIDENTIAL: ['OWNER', 'PARTNER', 'LAWYER'],
  RESTRICTED: MP_SENIOR_ROLES_
});

/** Fields hidden from, and not writable by, roles without Transactions read access. */
const MP_FINANCIAL_FIELDS = Object.freeze({
  Cases: ['AgreedFee', 'TotalPaid', 'OutstandingBalance']
});

/** Kept in code (not created yet) to reserve the Stage 1 integration contract. */
const MP_FUTURE_SCHEMAS = Object.freeze({
  ChannelAccounts: ['ChannelAccountID', 'Channel', 'DisplayName', 'Status', 'CreatedAt'],
  Conversations: ['ConversationID', 'ChannelAccountID', 'ExternalConversationID', 'LeadID', 'ClientID', 'AssignedTo', 'Status', 'CreatedAt', 'UpdatedAt'],
  Messages: ['MessageID', 'ConversationID', 'ExternalMessageID', 'Direction', 'Body', 'SentAt', 'Status'],
  WebhookEvents: ['WebhookEventID', 'Channel', 'ExternalEventID', 'EventType', 'ReceivedAt', 'ProcessingStatus']
});
