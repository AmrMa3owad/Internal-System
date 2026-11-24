/**
 * Document storage. Staff upload files from their computer through the web
 * app; the server stores them in one private Drive folder owned by the
 * deploying OWNER account (never shared with staff). Staff download files only
 * through the app, so confidentiality and record-assignment rules apply.
 *
 * DriveFileID and FileType are system-managed: a document row can only point
 * at a file this workflow stored, and downloads re-check that the file lives
 * in the documents folder so no other Drive file can be exposed.
 */
var MP_EXECUTION_DOCUMENTS_FOLDER_ID_ = null;

const MP_MIME_TYPES_ = Object.freeze({
  pdf: 'application/pdf', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', heic: 'image/heic',
  doc: 'application/msword', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ppt: 'application/vnd.ms-powerpoint', pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  txt: 'text/plain', csv: 'text/csv', rtf: 'application/rtf', odt: 'application/vnd.oasis.opendocument.text',
  ods: 'application/vnd.oasis.opendocument.spreadsheet', zip: 'application/zip'
});

function mpDocumentsFolderId_() {
  const id = MP_EXECUTION_DOCUMENTS_FOLDER_ID_ || PropertiesService.getScriptProperties().getProperty(MP_CONFIG.DOCUMENTS_FOLDER_PROPERTY);
  if (!id) throw new Error('The documents folder is not set up. Run setupDatabase().');
  return id;
}

/** Creates the private documents folder once; called by setupDatabase(). */
function mpEnsureDocumentsFolder_() {
  const properties = PropertiesService.getScriptProperties();
  const existing = properties.getProperty(MP_CONFIG.DOCUMENTS_FOLDER_PROPERTY);
  if (existing) {
    DriveApp.getFolderById(existing);
    return { created: false };
  }
  const folder = DriveApp.createFolder(MP_CONFIG.DOCUMENTS_FOLDER_NAME);
  properties.setProperty(MP_CONFIG.DOCUMENTS_FOLDER_PROPERTY, folder.getId());
  return { created: true };
}

function mpUploadFileName_(name) {
  const cleaned = String(name || '').replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').trim();
  if (!cleaned) throw new Error('The file needs a name.');
  if (cleaned.length > 200) throw new Error('The file name is too long (200 characters maximum).');
  return cleaned;
}

function mpUploadExtension_(name) {
  const match = String(name).match(/\.([A-Za-z0-9]+)$/);
  const extension = match ? match[1].toLowerCase() : '';
  if (MP_CONFIG.UPLOAD_EXTENSIONS.indexOf(extension) === -1) {
    const error = new Error('This file type is not allowed. Allowed: ' + MP_CONFIG.UPLOAD_EXTENSIONS.join(', ') + '.');
    error.code = 'FILE_TYPE';
    throw error;
  }
  return extension;
}

/**
 * meta: { EntityType, EntityID, ConfidentialityLevel, Description, FileName? }
 * file: { name, base64 } — the browser's FileReader output without the data: prefix.
 */
function mpUploadDocument_(actor, meta, file) {
  mpRequirePermission_(actor, 'Documents', 'create');
  meta = meta || {};
  file = file || {};
  const originalName = mpUploadFileName_(file.name);
  const extension = mpUploadExtension_(originalName);
  if (typeof file.base64 !== 'string' || !file.base64) throw new Error('No file content was received.');
  if (file.base64.length > Math.ceil(MP_CONFIG.MAX_UPLOAD_BYTES * 4 / 3) + 8) throw mpFileTooLarge_();
  const bytes = Utilities.base64Decode(file.base64);
  if (!bytes.length) throw new Error('The file is empty.');
  if (bytes.length > MP_CONFIG.MAX_UPLOAD_BYTES) throw mpFileTooLarge_();

  const input = {
    EntityType: meta.EntityType, EntityID: meta.EntityID, ConfidentialityLevel: meta.ConfidentialityLevel,
    Description: meta.Description, FileName: mpIsBlank_(meta.FileName) ? originalName : mpUploadFileName_(meta.FileName)
  };
  Object.keys(input).forEach(function(key) { if (input[key] === undefined) delete input[key]; });
  mpApiAssertDocumentInput_(actor, input);
  // Validate everything before any file is stored.
  const probe = mpValidateRecord_('Documents', Object.assign({ DriveFileID: 'pending' }, input), true);
  mpValidateReferences_('Documents', probe);
  mpAssertLinksInScope_(mpAccessScope_(actor), 'Documents', probe);

  const blob = Utilities.newBlob(bytes, MP_MIME_TYPES_[extension], originalName);
  const driveFile = DriveApp.getFolderById(mpDocumentsFolderId_()).createFile(blob);
  try {
    return mpWithLock_(function() {
      return mpInsertRecordLocked_('Documents', Object.assign({}, input, { DriveFileID: driveFile.getId(), FileType: extension.toUpperCase() }), true, actor.userId, null);
    });
  } catch (error) {
    driveFile.setTrashed(true);
    throw error;
  }
}

function mpFileTooLarge_() {
  const error = new Error('The file is larger than ' + Math.round(MP_CONFIG.MAX_UPLOAD_BYTES / 1048576) + ' MB.');
  error.code = 'FILE_TOO_LARGE';
  return error;
}

function mpFileIsInFolder_(file, folderId) {
  const parents = file.getParents();
  while (parents.hasNext()) if (parents.next().getId() === folderId) return true;
  return false;
}

/** Returns { fileName, mimeType, base64 } after permission, confidentiality, scope, and folder checks. */
function mpDownloadDocument_(actor, documentId) {
  mpRequirePermission_(actor, 'Documents', 'read');
  const record = mpApiVisibleRecord_(actor, 'Documents', documentId);
  const file = DriveApp.getFileById(record.DriveFileID);
  if (!mpFileIsInFolder_(file, mpDocumentsFolderId_())) throw new Error('This document is not stored in the Mohamy Plus documents folder and cannot be downloaded.');
  const blob = file.getBlob();
  const bytes = blob.getBytes();
  if (bytes.length > MP_CONFIG.MAX_UPLOAD_BYTES * 2) throw mpFileTooLarge_();
  mpWithLock_(function() { mpLogActivity_('Documents', record.DocumentID, 'DOWNLOADED', 'Downloaded ' + record.FileName + '.', actor.userId); });
  return { fileName: record.FileName, mimeType: blob.getContentType(), base64: Utilities.base64Encode(bytes) };
}

/** Upload a file from the user's computer. Returns the new Documents record. */
function apiUploadDocument(meta, file) {
  return mpApiRespond_(function() { return mpUploadDocument_(mpRequireActiveUser_(), meta, file); });
}

function apiDownloadDocument(documentId) {
  return mpApiRespond_(function() { return mpDownloadDocument_(mpRequireActiveUser_(), documentId); });
}
