/**
 * Append-only audit service. There is intentionally no generic insert, update,
 * archive, or delete route for Activities. Timestamps and actors are assigned
 * only when a trusted server workflow emits an event.
 */
function mpAppendActivityToSheet_(sheet, entityType, entityId, action, description, performedBy) {
  const headers = mpHeaders_(sheet);
  const record = {
    ActivityID: mpNewId_('Activities'),
    EntityType: mpCleanText_(entityType, 50),
    EntityID: mpCleanText_(entityId, 100),
    Action: mpCleanText_(action, 80),
    Description: mpCleanText_(description, 1000),
    PerformedBy: mpCleanText_(performedBy || 'SYSTEM', 320),
    Timestamp: mpNowIso_()
  };
  mpAppendRecordChecked_(sheet, headers, record);
  return mpPublicRecord_(record);
}

function mpLogActivity_(entityType, entityId, action, description, performedBy) {
  return mpAppendActivityToSheet_(mpSheet_('Activities'), entityType, entityId, action, description, performedBy);
}

function mpListActivities_(entityType, entityId, limit) {
  const maximum = Math.min(Math.max(Number(limit || 50), 1), MP_CONFIG.MAX_PAGE_SIZE);
  return mpRows_('Activities').records
    .filter(function(activity) { return activity.EntityType === entityType && activity.EntityID === entityId; })
    .slice(-maximum).reverse().map(mpPublicRecord_);
}
