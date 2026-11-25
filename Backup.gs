/**
 * Daily backups. A full copy of the database spreadsheet is saved each night
 * in a private Drive folder owned by the deploying owner; the newest
 * MP_CONFIG.BACKUP_KEEP copies are kept and older ones go to Drive's trash.
 *
 * Restore: open the backup copy you want, check it, then in the Apps Script
 * editor run restoreFromBackup('<backup spreadsheet id>'). The app switches to
 * that copy (after checking it is a compatible Mohamy Plus database); the
 * damaged spreadsheet is left untouched so nothing is lost.
 */

const MP_BACKUP_HANDLER_ = 'dailyBackupTrigger';
const MP_LAST_BACKUP_PROPERTY_ = 'MP_LAST_BACKUP';

function mpBackupPrefix_() { return MP_CONFIG.DATABASE_NAME + ' - BACKUP '; }

function mpEnsureBackupFolder_() {
  const properties = PropertiesService.getScriptProperties();
  const id = properties.getProperty(MP_CONFIG.BACKUP_FOLDER_PROPERTY);
  if (id) {
    try { return DriveApp.getFolderById(id); } catch (error) { /* deleted: make a new one */ }
  }
  const folder = DriveApp.createFolder(MP_CONFIG.BACKUP_FOLDER_NAME);
  properties.setProperty(MP_CONFIG.BACKUP_FOLDER_PROPERTY, folder.getId());
  return folder;
}

/** Copies the database now. Holds the lock so the copy never catches a half-finished save. */
function mpBackupDatabase_() {
  return mpWithLock_(function() {
    const database = mpGetDatabase_();
    const folder = mpEnsureBackupFolder_();
    const stamp = Utilities.formatDate(new Date(), MP_CONFIG.DATE_TIMEZONE, 'yyyy-MM-dd HH:mm');
    const copy = DriveApp.getFileById(database.getId()).makeCopy(mpBackupPrefix_() + stamp, folder);
    const removed = mpPruneBackups_(folder);
    const info = { at: mpNowIso_(), id: copy.getId(), name: copy.getName(), kept: MP_CONFIG.BACKUP_KEEP, removed: removed };
    PropertiesService.getScriptProperties().setProperty(MP_LAST_BACKUP_PROPERTY_, JSON.stringify(info));
    return info;
  });
}

function mpPruneBackups_(folder) {
  const files = [];
  const iterator = folder.getFiles();
  while (iterator.hasNext()) {
    const file = iterator.next();
    if (String(file.getName()).indexOf(mpBackupPrefix_()) === 0) files.push(file);
  }
  files.sort(function(left, right) { return right.getDateCreated().getTime() - left.getDateCreated().getTime(); });
  const old = files.slice(MP_CONFIG.BACKUP_KEEP);
  old.forEach(function(file) { file.setTrashed(true); });
  return old.length;
}

function mpBackupTriggers_() {
  return ScriptApp.getProjectTriggers().filter(function(trigger) { return trigger.getHandlerFunction() === MP_BACKUP_HANDLER_; });
}

function mpInstallDailyBackups_() {
  mpBackupTriggers_().forEach(function(trigger) { ScriptApp.deleteTrigger(trigger); });
  ScriptApp.newTrigger(MP_BACKUP_HANDLER_).timeBased().everyDays(1).atHour(MP_CONFIG.BACKUP_HOUR).inTimezone(MP_CONFIG.DATE_TIMEZONE).create();
  return mpBackupStatus_();
}

function mpRemoveDailyBackups_() {
  mpBackupTriggers_().forEach(function(trigger) { ScriptApp.deleteTrigger(trigger); });
  return mpBackupStatus_();
}

function mpBackupStatus_() {
  let last = null;
  try { last = JSON.parse(PropertiesService.getScriptProperties().getProperty(MP_LAST_BACKUP_PROPERTY_) || 'null'); } catch (error) { last = null; }
  const folderId = PropertiesService.getScriptProperties().getProperty(MP_CONFIG.BACKUP_FOLDER_PROPERTY);
  return { enabled: mpBackupTriggers_().length > 0, hour: MP_CONFIG.BACKUP_HOUR, keep: MP_CONFIG.BACKUP_KEEP, last: last, folderUrl: folderId ? 'https://drive.google.com/drive/folders/' + folderId : '' };
}

/** Trigger handler; refuses any call that does not carry this project's own backup trigger uid. */
function dailyBackupTrigger(event) {
  const uid = event && event.triggerUid;
  const genuine = !!uid && mpBackupTriggers_().some(function(trigger) { return trigger.getUniqueId() === uid; });
  if (!genuine) return mpFailure_(new Error('dailyBackupTrigger only runs from its scheduled trigger.'));
  try { return mpSuccess_(mpBackupDatabase_()); }
  catch (error) { console.error(error); return mpFailure_(error); }
}

/** Owner (Apps Script editor): switch the app to a backup copy after checking it. */
function restoreFromBackup(spreadsheetId) {
  try {
    mpRequireAdministrator_();
    const previous = PropertiesService.getScriptProperties().getProperty(MP_CONFIG.DATABASE_ID_PROPERTY);
    const report = mpBindExistingDatabase_(spreadsheetId);
    Object.keys(MP_SCHEMAS).forEach(function(name) { mpInvalidateRows_(name); });
    try { mpInstallChangeTrigger_(); } catch (error) { console.warn('Hand-edit trigger not moved: ' + error.message); }
    console.log('Restored. The app now uses backup ' + spreadsheetId + '. The previous database (' + previous + ') was not changed.');
    return mpSuccess_({ restored: spreadsheetId, previous: previous, report: report });
  } catch (error) { console.error(error); return mpFailure_(error); }
}

/** Owner (Apps Script editor): take a backup right now. */
function backupDatabaseNow() {
  try { mpRequireAdministrator_(); return mpSuccess_(mpBackupDatabase_()); }
  catch (error) { console.error(error); return mpFailure_(error); }
}

// Owner controls on the Settings page.
function apiGetBackupStatus() {
  return mpApiRespond_(function() { mpRequireReminderAdmin_(); return mpBackupStatus_(); });
}

function apiSetDailyBackups(enabled) {
  return mpApiRespond_(function() { mpRequireReminderAdmin_(); return enabled === true ? mpInstallDailyBackups_() : mpRemoveDailyBackups_(); });
}

function apiBackupNow() {
  return mpApiRespond_(function() { mpRequireReminderAdmin_(); mpBackupDatabase_(); return mpBackupStatus_(); });
}
