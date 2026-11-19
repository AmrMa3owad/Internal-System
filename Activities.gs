/** Activities are append-only; correction is an additional activity, not an edit. */
function mpLogActivity_(entityType, entityId, action, description, performedBy) {
  const sheet = mpSheet_('Activities');
  const headers = mpHeaders_(sheet);
  const record = {
    ActivityID: mpNewId_('Activities'), EntityType: mpCleanText_(entityType, 50),
    EntityID: mpCleanText_(entityId, 100), Action: mpCleanText_(action, 80),
    Description: mpCleanText_(description, 1000), PerformedBy: mpCleanText_(performedBy || 'SYSTEM', 320), Timestamp: mpNowIso_()
  };
  sheet.getRange(sheet.getLastRow() + 1, 1, 1, headers.length).setValues([mpRecordValues_(headers, record)]);
}

function mpListActivities_(entityType, entityId, limit) {
  return mpDbList_('Activities', { query: entityId, limit: Math.min(Number(limit || 50), MP_CONFIG.MAX_PAGE_SIZE) }).records
    .filter(function(activity) { return activity.EntityType === entityType && activity.EntityID === entityId; });
}
