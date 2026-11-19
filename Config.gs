/**
 * Server-only configuration. Spreadsheet identifiers and folder identifiers
 * belong in Script Properties, never in HTML or client-side JavaScript.
 */
const MP_CONFIG = Object.freeze({
  DATABASE_NAME: 'MOHAMY PLUS - DATABASE',
  DATABASE_ID_PROPERTY: 'MP_DATABASE_SPREADSHEET_ID',
  INITIAL_OWNER_PROPERTY: 'MP_INITIAL_OWNER_EMAIL',
  DATE_TIMEZONE: 'Africa/Cairo',
  PAGE_SIZE: 50,
  MAX_PAGE_SIZE: 100,
  MAX_TEXT_LENGTH: 10000,
  ARCHIVE_COLUMNS: ['IsArchived', 'ArchivedAt', 'Version'],
  ROLES: ['OWNER', 'PARTNER', 'LAWYER', 'ASSISTANT'],
  USER_STATUSES: ['ACTIVE', 'INACTIVE'],
  CLIENT_TYPES: ['INDIVIDUAL', 'COMPANY'],
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
  FOLLOW_UP_STATUSES: ['OPEN', 'COMPLETED', 'CANCELLED'],
  CONSULTATION_STATUSES: ['SCHEDULED', 'COMPLETED', 'CANCELLED', 'NO_SHOW'],
  PAYMENT_STATUSES: ['UNPAID', 'PARTIALLY_PAID', 'PAID', 'WAIVED'],
  TRANSACTION_TYPES: ['INCOME', 'EXPENSE'],
  PAYMENT_METHODS: ['CASH', 'BANK_TRANSFER', 'CARD', 'VODAFONE_CASH', 'INSTAPAY', 'CHEQUE', 'OTHER'],
  CONFIDENTIALITY_LEVELS: ['STANDARD', 'CONFIDENTIAL', 'RESTRICTED'],
  ENTITY_ID_PREFIXES: {
    Users: 'USR', Leads: 'LED', Clients: 'CLT', Companies: 'CMP', Cases: 'CAS',
    Consultations: 'CON', Transactions: 'TRX', FollowUps: 'FLW', Activities: 'ACT',
    Documents: 'DOC'
  }
});

/** Requested business fields are retained; operational metadata is appended. */
const MP_SCHEMAS = Object.freeze({
  Users: ['UserID', 'FullName', 'Email', 'Role', 'Status', 'CreatedAt', 'LastLogin', 'IsArchived', 'ArchivedAt', 'Version'],
  Leads: ['LeadID', 'FullName', 'Phone', 'Email', 'ClientType', 'CompanyID', 'Source', 'CampaignID', 'PracticeArea', 'InquiryType', 'Description', 'Priority', 'Status', 'AssignedTo', 'CreatedAt', 'UpdatedAt', 'LastContactAt', 'NextFollowUpAt', 'LostReason', 'ConvertedClientID', 'IsArchived', 'ArchivedAt', 'Version'],
  Clients: ['ClientID', 'ClientType', 'FullName', 'CompanyID', 'Phone', 'Email', 'Address', 'Nationality', 'Notes', 'CreatedAt', 'CreatedFromLeadID', 'Status', 'IsArchived', 'ArchivedAt', 'Version'],
  Companies: ['CompanyID', 'CompanyName', 'CommercialRegistrationNumber', 'TaxNumber', 'ContactPerson', 'Phone', 'Email', 'Address', 'Notes', 'CreatedAt', 'IsArchived', 'ArchivedAt', 'Version'],
  // OpposingParties is an intentional Stage 1 extension for conflict checks.
  Cases: ['CaseID', 'CaseNumber', 'CaseTitle', 'ClientID', 'PracticeArea', 'CaseType', 'Description', 'OpposingParties', 'AssignedLawyer', 'Priority', 'Status', 'StartDate', 'Deadline', 'AgreedFee', 'TotalPaid', 'OutstandingBalance', 'CreatedAt', 'UpdatedAt', 'ClosedAt', 'IsArchived', 'ArchivedAt', 'Version'],
  Consultations: ['ConsultationID', 'LeadID', 'ClientID', 'AssignedLawyer', 'ConsultationType', 'ConsultationDate', 'Duration', 'IsPaid', 'Fee', 'PaymentStatus', 'Status', 'MeetingLocation', 'Notes', 'Outcome', 'CreatedAt', 'IsArchived', 'ArchivedAt', 'Version'],
  Transactions: ['TransactionID', 'ClientID', 'CaseID', 'ConsultationID', 'Type', 'Amount', 'PaymentMethod', 'PaymentDate', 'Description', 'RecordedBy', 'CreatedAt', 'IsArchived', 'ArchivedAt', 'Version'],
  FollowUps: ['FollowUpID', 'LeadID', 'ClientID', 'CaseID', 'AssignedTo', 'Title', 'Description', 'DueDate', 'Priority', 'Status', 'CreatedAt', 'CompletedAt', 'IsArchived', 'ArchivedAt', 'Version'],
  Activities: ['ActivityID', 'EntityType', 'EntityID', 'Action', 'Description', 'PerformedBy', 'Timestamp'],
  Documents: ['DocumentID', 'EntityType', 'EntityID', 'FileName', 'DriveFileID', 'FileType', 'UploadedBy', 'UploadedAt', 'Description', 'ConfidentialityLevel', 'IsArchived', 'ArchivedAt', 'Version'],
  Settings: ['SettingKey', 'SettingValue', 'UpdatedAt', 'UpdatedBy', 'Version']
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

/** Kept in code (not created yet) to reserve the Stage 1 integration contract. */
const MP_FUTURE_SCHEMAS = Object.freeze({
  ChannelAccounts: ['ChannelAccountID', 'Channel', 'DisplayName', 'Status', 'CreatedAt'],
  Conversations: ['ConversationID', 'ChannelAccountID', 'ExternalConversationID', 'LeadID', 'ClientID', 'AssignedTo', 'Status', 'CreatedAt', 'UpdatedAt'],
  Messages: ['MessageID', 'ConversationID', 'ExternalMessageID', 'Direction', 'Body', 'SentAt', 'Status'],
  WebhookEvents: ['WebhookEventID', 'Channel', 'ExternalEventID', 'EventType', 'ReceivedAt', 'ProcessingStatus']
});
