/**
 * Live updates: screens refresh by themselves when data changes.
 *
 * Every save through the app already replaces a per-sheet version stamp in
 * the shared cache (mpInvalidateRows_ -> mpBumpSheetVersion_). Each open
 * browser asks apiSyncState() every few seconds for those stamps; the call
 * reads only the cache, never the spreadsheet. When a sheet the person is
 * looking at changed, their screen reloads its data quietly.
 *
 * Edits typed directly into the spreadsheet bump the stamps too, through an
 * installable "on change" trigger on the database (databaseChangeTrigger).
 */

// Sheets whose changes matter to screens (sign-in logs, relay logs, and settings do not).
const MP_SYNC_SHEETS_ = Object.keys(MP_SCHEMAS).filter(function(name) { return ['AccessLog', 'WebhookEvents', 'Settings'].indexOf(name) === -1; });
const MP_CHANGE_HANDLER_ = 'databaseChangeTrigger';

/**
 * Short version stamps per sheet. knownChats is the Conversations stamp the
 * browser already has; the unread count is recomputed only when it changed.
 */
function mpSyncState_(actor, knownChats) {
  const cache = mpSharedCache_();
  if (!cache) return { versions: null };
  const keys = MP_SYNC_SHEETS_.map(mpSheetVersionKey_);
  let found = {};
  try { found = cache.getAll(keys) || {}; } catch (error) { return { versions: null }; }
  const missing = {};
  const versions = {};
  MP_SYNC_SHEETS_.forEach(function(name, index) {
    let version = found[keys[index]];
    if (!version) { version = Utilities.getUuid(); missing[keys[index]] = version; }
    versions[name] = String(version).slice(0, 12);
  });
  if (Object.keys(missing).length) { try { cache.putAll(missing, 21600); } catch (error) { /* next call retries */ } }
  const out = { versions: versions, unread: null };
  if (mpCan_(actor.role, 'Conversations', 'read') && knownChats !== versions.Conversations) {
    out.unread = mpRows_('Conversations').records.filter(function(row) {
      return row.IsArchived !== true && row.Status === 'OPEN' && mpConversationInScope_(actor, row);
    }).reduce(function(sum, row) { return sum + Number(row.UnreadCount || 0); }, 0);
  }
  return out;
}

function apiSyncState(knownChats) {
  return mpApiRespond_(function() { return mpSyncState_(mpRequireActiveUser_(), String(knownChats || '')); });
}

// ------------------------------------------------------------ Hand edits in the spreadsheet
function mpChangeTriggers_() {
  return ScriptApp.getProjectTriggers().filter(function(trigger) { return trigger.getHandlerFunction() === MP_CHANGE_HANDLER_; });
}

/** (Re)creates the trigger for the current database; run at install and after a restore. */
function mpInstallChangeTrigger_() {
  mpChangeTriggers_().forEach(function(trigger) { ScriptApp.deleteTrigger(trigger); });
  ScriptApp.newTrigger(MP_CHANGE_HANDLER_).forSpreadsheet(mpCurrentDatabaseId_()).onChange().create();
  return { enabled: true };
}

/** Runs when someone edits the database spreadsheet by hand; marks that sheet as changed. */
function databaseChangeTrigger(event) {
  const uid = event && event.triggerUid;
  const genuine = !!uid && mpChangeTriggers_().some(function(trigger) { return trigger.getUniqueId() === uid; });
  if (!genuine) return mpFailure_(new Error('databaseChangeTrigger only runs from its own trigger.'));
  let name = '';
  try { name = event.source.getActiveSheet().getName(); } catch (error) { name = ''; }
  // An edit we cannot place (e.g. a sheet renamed) refreshes every screen once.
  const sheets = MP_SCHEMAS[name] ? [name] : MP_SYNC_SHEETS_;
  sheets.forEach(function(sheet) { mpBumpSheetVersion_(sheet); });
  return mpSuccess_({ changed: sheets });
}
