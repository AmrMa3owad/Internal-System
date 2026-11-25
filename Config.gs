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
  // External lawyers and law firms the firm refers work to (they never sign in).
  PARTNER_TYPES: ['LAWYER', 'FIRM'],
  PARTNER_STATUSES: ['ACTIVE', 'INACTIVE'],
  // FULL: the partner handles everything. SHARED: our team does part (e.g. administrative work) for a bigger share plus per-task fees.
  // ADMIN_ONLY: the partner hires our team for administrative work only (agreed fee per task, they reimburse expenses); no profit share.
  REFERRAL_SCOPES: ['FULL', 'SHARED', 'ADMIN_ONLY'],
  PROFIT_SHARE_SCOPES: ['FULL', 'SHARED'],
  REFERRAL_WORK_TYPES: ['COURT_HEARINGS', 'WHOLE_CASE', 'PART_OF_CASE'],
  REFERRAL_STATUSES: ['PROPOSED', 'ACTIVE', 'COMPLETED', 'SETTLED', 'CANCELLED'],
  CLOSED_REFERRAL_STATUSES: ['COMPLETED', 'SETTLED', 'CANCELLED'],
  // Statuses that mean the partner accepted the work (AcceptedAt/AcceptedBy are recorded the first time).
  ACCEPTED_REFERRAL_STATUSES: ['ACTIVE', 'COMPLETED', 'SETTLED'],
  // Payment statuses a person may set by hand, only owners/partners and only with a written reason.
  MANUAL_PAYMENT_STATUSES: ['PAID', 'WAIVED'],
  BACKUP_FOLDER_PROPERTY: 'MP_BACKUP_FOLDER_ID',
  BACKUP_FOLDER_NAME: 'MOHAMY PLUS - BACKUPS',
  BACKUP_KEEP: 30,
  BACKUP_HOUR: 2,
  INTAKE_KEY_PROPERTY: 'MP_INTAKE_KEY',
  // Messaging channels (see Channels.gs and relay/). Conversations are per person per channel.
  CHANNELS: ['WHATSAPP', 'MESSENGER', 'INSTAGRAM'],
  CONVERSATION_STATUSES: ['OPEN', 'CLOSED'],
  MESSAGE_DIRECTIONS: ['IN', 'OUT'],
  MESSAGE_KINDS: ['TEXT', 'MEDIA', 'COMMENT', 'LEAD_FORM', 'AUTO_REPLY', 'TEMPLATE', 'NOTE'],
  MESSAGE_STATUSES: ['RECEIVED', 'SENT', 'DELIVERED', 'READ', 'FAILED'],
  WEBHOOK_STATUSES: ['PROCESSED', 'IGNORED', 'FAILED'],
  ADMIN_ROLES: ['OWNER'],
  // Roles that only see records assigned to them (see Access.gs).
  RECORD_RESTRICTED_ROLES: ['LAWYER', 'ASSISTANT'],
  ASSIGNABLE_ENTITIES: ['Leads', 'Clients', 'Cases', 'Referrals'],
  DOCUMENT_ENTITY_TYPES: ['LEAD', 'CLIENT', 'CASE'],
  ENTITY_ID_PREFIXES: {
    Users: 'USR', Leads: 'LED', Clients: 'CLT', Companies: 'CMP', Cases: 'CAS',
    Consultations: 'CON', Transactions: 'TRX', FollowUps: 'FLW', Activities: 'ACT',
    Documents: 'DOC', Assignments: 'ASG', AccessLog: 'LOG',
    ExternalPartners: 'PTN', Referrals: 'REF', ReferralWork: 'RWK', ReferralPayments: 'RPY',
    Conversations: 'CNV', Messages: 'MSG', WebhookEvents: 'WHE'
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
  AccessLog: ['LogID', 'Timestamp', 'Event', 'Email', 'UserID', 'Detail'],
  ExternalPartners: ['PartnerID', 'CreatedAt', 'IsArchived', 'ArchivedAt', 'Version'],
  Referrals: ['ReferralID', 'ClientID', 'AcceptedAt', 'AcceptedBy', 'ExpectedShare', 'AdminFeesTotal', 'ExpensesTotal', 'TotalDue', 'TotalReceived', 'Balance', 'CreatedBy', 'CreatedAt', 'UpdatedAt', 'ClosedAt', 'IsArchived', 'ArchivedAt', 'Version'],
  ReferralWork: ['WorkID', 'CreatedAt', 'IsArchived', 'ArchivedAt', 'Version'],
  ReferralPayments: ['PaymentID', 'RecordedBy', 'CreatedAt', 'IsArchived', 'ArchivedAt', 'Version'],
  Conversations: ['ConversationID', 'Channel', 'ExternalThreadID', 'ContactName', 'ContactHandle', 'LastMessageAt', 'LastInboundAt', 'LastMessagePreview', 'UnreadCount', 'CreatedAt', 'UpdatedAt', 'IsArchived', 'ArchivedAt', 'Version'],
  Messages: ['MessageID', 'ConversationID', 'ExternalMessageID', 'Direction', 'Kind', 'Body', 'SentBy', 'SentAt', 'Status', 'Error', 'CreatedAt'],
  WebhookEvents: ['WebhookEventID', 'Channel', 'ExternalEventID', 'EventType', 'ReceivedAt', 'ProcessingStatus', 'Detail'],
  Settings: ['SettingKey', 'UpdatedAt', 'UpdatedBy', 'Version']
});

/** Requested business fields are retained; operational metadata is appended. */
const MP_SCHEMAS = Object.freeze({
  Users: ['UserID', 'FullName', 'Email', 'Role', 'Status', 'Language', 'CreatedAt', 'LastLogin', 'IsArchived', 'ArchivedAt', 'Version'],
  // SocialProfile: how to reach someone who wrote on Messenger/Instagram/TikTok without a phone or email.
  Leads: ['LeadID', 'FullName', 'Phone', 'Email', 'SocialProfile', 'ClientType', 'CompanyID', 'Source', 'CampaignID', 'PracticeArea', 'InquiryType', 'Description', 'Priority', 'Status', 'AssignedTo', 'CreatedAt', 'UpdatedAt', 'LastContactAt', 'NextFollowUpAt', 'LostReason', 'ConvertedClientID', 'IsArchived', 'ArchivedAt', 'Version'],
  Clients: ['ClientID', 'ClientType', 'FullName', 'CompanyID', 'Phone', 'Email', 'Address', 'Nationality', 'Notes', 'AssignedTo', 'CreatedAt', 'CreatedFromLeadID', 'Status', 'IsArchived', 'ArchivedAt', 'Version'],
  Companies: ['CompanyID', 'CompanyName', 'CommercialRegistrationNumber', 'TaxNumber', 'ContactPerson', 'Phone', 'Email', 'Address', 'Notes', 'CreatedAt', 'IsArchived', 'ArchivedAt', 'Version'],
  // OpposingParties is an intentional Stage 1 extension for conflict checks.
  Cases: ['CaseID', 'CaseNumber', 'CaseTitle', 'ClientID', 'PracticeArea', 'CaseType', 'Description', 'OpposingParties', 'AssignedLawyer', 'Priority', 'Status', 'StartDate', 'Deadline', 'AgreedFee', 'TotalPaid', 'OutstandingBalance', 'CreatedAt', 'UpdatedAt', 'ClosedAt', 'IsArchived', 'ArchivedAt', 'Version'],
  // PaymentNote: the required reason when an owner/partner sets PAID or WAIVED without matching payments.
  Consultations: ['ConsultationID', 'LeadID', 'ClientID', 'AssignedLawyer', 'ConsultationType', 'ConsultationDate', 'Duration', 'IsPaid', 'Fee', 'PaymentStatus', 'PaymentNote', 'Status', 'MeetingLocation', 'Notes', 'Outcome', 'CreatedAt', 'IsArchived', 'ArchivedAt', 'Version'],
  Transactions: ['TransactionID', 'ClientID', 'CaseID', 'ConsultationID', 'Type', 'Amount', 'PaymentMethod', 'PaymentDate', 'Description', 'RecordedBy', 'CreatedAt', 'IsArchived', 'ArchivedAt', 'Version'],
  FollowUps: ['FollowUpID', 'LeadID', 'ClientID', 'CaseID', 'AssignedTo', 'Title', 'Description', 'DueDate', 'Priority', 'Status', 'CreatedAt', 'CompletedAt', 'IsArchived', 'ArchivedAt', 'Version'],
  Activities: ['ActivityID', 'EntityType', 'EntityID', 'Action', 'Description', 'PerformedBy', 'Timestamp'],
  Documents: ['DocumentID', 'EntityType', 'EntityID', 'FileName', 'DriveFileID', 'FileType', 'UploadedBy', 'UploadedAt', 'Description', 'ConfidentialityLevel', 'IsArchived', 'ArchivedAt', 'Version'],
  Settings: ['SettingKey', 'SettingValue', 'UpdatedAt', 'UpdatedBy', 'Version'],
  // Extra team members per Lead/Client/Case, in addition to the record's main assignee.
  Assignments: ['AssignmentID', 'EntityType', 'EntityID', 'UserID', 'AddedBy', 'AddedAt', 'IsArchived', 'ArchivedAt', 'Version'],
  // Every sign-in attempt (owners read it on the Security page).
  AccessLog: ['LogID', 'Timestamp', 'Event', 'Email', 'UserID', 'Detail'],
  // Referral partners: external lawyers and law firms (tracking only; no sign-in).
  ExternalPartners: ['PartnerID', 'PartnerType', 'Name', 'FirmName', 'ContactPerson', 'Phone', 'Email', 'City', 'PracticeAreas', 'FullShareRate', 'SharedShareRate', 'Notes', 'Status', 'CreatedAt', 'IsArchived', 'ArchivedAt', 'Version'],
  // Work with a partner. FULL/SHARED: our case referred out, we receive a share of their final profit.
  // ADMIN_ONLY: the partner hired our team for administrative work (no case of ours needed).
  Referrals: ['ReferralID', 'PartnerID', 'CaseID', 'ClientID', 'Scope', 'ExternalWork', 'Title', 'AssignedTo', 'SharePercent', 'Status', 'ReferredAt', 'AcceptedAt', 'AcceptedBy', 'FinalProfit', 'ExpectedShare', 'AdminFeesTotal', 'ExpensesTotal', 'TotalDue', 'TotalReceived', 'Balance', 'Notes', 'CreatedBy', 'CreatedAt', 'UpdatedAt', 'ClosedAt', 'IsArchived', 'ArchivedAt', 'Version'],
  // Work our team does for the partner; each task has its agreed fee plus expenses we paid that the partner reimburses.
  ReferralWork: ['WorkID', 'ReferralID', 'Title', 'WorkDate', 'Fee', 'Expenses', 'DoneBy', 'Notes', 'CreatedAt', 'IsArchived', 'ArchivedAt', 'Version'],
  // Money received from a partner for a referral.
  ReferralPayments: ['PaymentID', 'ReferralID', 'Amount', 'PaymentDate', 'PaymentMethod', 'Description', 'RecordedBy', 'CreatedAt', 'IsArchived', 'ArchivedAt', 'Version'],
  // One chat per person per channel (WhatsApp number, Messenger PSID, Instagram ID), linked to a lead or client.
  Conversations: ['ConversationID', 'Channel', 'ExternalThreadID', 'ContactName', 'ContactHandle', 'LeadID', 'ClientID', 'AssignedTo', 'Status', 'LastMessageAt', 'LastInboundAt', 'LastMessagePreview', 'UnreadCount', 'CreatedAt', 'UpdatedAt', 'IsArchived', 'ArchivedAt', 'Version'],
  // Every message in and out, including auto-replies, templates, comments, and lead-form answers.
  Messages: ['MessageID', 'ConversationID', 'ExternalMessageID', 'Direction', 'Kind', 'Body', 'SentBy', 'SentAt', 'Status', 'Error', 'CreatedAt'],
  // What the relay delivered and what happened to it (owners see it on the Channels settings card).
  WebhookEvents: ['WebhookEventID', 'Channel', 'ExternalEventID', 'EventType', 'ReceivedAt', 'ProcessingStatus', 'Detail']
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
 * Entity-level permissions per role. Record-level limits for lawyers and
 * assistants are applied on top of these (see Access.gs).
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
  Assignments: { read: MP_ALL_ROLES_, create: MP_SENIOR_ROLES_, archive: MP_SENIOR_ROLES_ },
  // Sign-in activity, retry limits, and signed-in devices.
  AccessLog: { read: ['OWNER'], update: ['OWNER'] },
  ExternalPartners: { read: MP_ALL_ROLES_, create: MP_SENIOR_ROLES_, update: MP_SENIOR_ROLES_, archive: MP_SENIOR_ROLES_ },
  Referrals: { read: MP_ALL_ROLES_, create: MP_SENIOR_ROLES_, update: MP_SENIOR_ROLES_, archive: MP_SENIOR_ROLES_ },
  ReferralWork: { read: MP_ALL_ROLES_, create: MP_ALL_ROLES_, update: MP_ALL_ROLES_, archive: MP_SENIOR_ROLES_ },
  ReferralPayments: { read: MP_FINANCE_ROLES_, create: MP_FINANCE_ROLES_, update: MP_FINANCE_ROLES_, archive: MP_SENIOR_ROLES_ },
  // Chats: everyone reads and replies within their record scope; seniors reassign and close for others.
  Conversations: { read: MP_ALL_ROLES_, update: MP_ALL_ROLES_ },
  Messages: { read: MP_ALL_ROLES_, create: MP_ALL_ROLES_ },
  WebhookEvents: { read: ['OWNER'] },
  // Channel tokens, auto-replies, and WhatsApp templates.
  Channels: { read: ['OWNER'], update: ['OWNER'] }
});

/** Foreign keys per entity (field -> target entity). Documents.EntityID is polymorphic via EntityType. */
const MP_REFERENCE_FIELDS = Object.freeze({
  Leads: { CompanyID: 'Companies', AssignedTo: 'Users', ConvertedClientID: 'Clients' },
  Clients: { CompanyID: 'Companies', CreatedFromLeadID: 'Leads', AssignedTo: 'Users' },
  Cases: { ClientID: 'Clients', AssignedLawyer: 'Users' },
  Consultations: { LeadID: 'Leads', ClientID: 'Clients', AssignedLawyer: 'Users' },
  Transactions: { ClientID: 'Clients', CaseID: 'Cases', ConsultationID: 'Consultations', RecordedBy: 'Users' },
  FollowUps: { LeadID: 'Leads', ClientID: 'Clients', CaseID: 'Cases', AssignedTo: 'Users' },
  Documents: { UploadedBy: 'Users' },
  Referrals: { PartnerID: 'ExternalPartners', CaseID: 'Cases', ClientID: 'Clients', AssignedTo: 'Users', AcceptedBy: 'Users', CreatedBy: 'Users' },
  ReferralWork: { ReferralID: 'Referrals', DoneBy: 'Users' },
  ReferralPayments: { ReferralID: 'Referrals', RecordedBy: 'Users' },
  Conversations: { LeadID: 'Leads', ClientID: 'Clients', AssignedTo: 'Users' },
  Messages: { ConversationID: 'Conversations', SentBy: 'Users' }
});

/** Roles allowed to view a document of each confidentiality level. */
const MP_DOCUMENT_ACCESS = Object.freeze({
  STANDARD: MP_ALL_ROLES_,
  CONFIDENTIAL: ['OWNER', 'PARTNER', 'LAWYER'],
  RESTRICTED: MP_SENIOR_ROLES_
});

/** Fields hidden from, and not writable by, roles without Transactions read access. */
const MP_FINANCIAL_FIELDS = Object.freeze({
  Cases: ['AgreedFee', 'TotalPaid', 'OutstandingBalance'],
  ExternalPartners: ['FullShareRate', 'SharedShareRate'],
  Referrals: ['SharePercent', 'FinalProfit', 'ExpectedShare', 'AdminFeesTotal', 'ExpensesTotal', 'TotalDue', 'TotalReceived', 'Balance'],
  ReferralWork: ['Fee']
});

/** Reserved for later integrations (not created). Conversations, Messages, and WebhookEvents are live. */
const MP_FUTURE_SCHEMAS = Object.freeze({
  ChannelAccounts: ['ChannelAccountID', 'Channel', 'DisplayName', 'Status', 'CreatedAt']
});
