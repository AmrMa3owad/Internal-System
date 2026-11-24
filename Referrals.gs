/**
 * External referrals. The firm refers a case (and its client) to an external
 * lawyer or law firm and receives a share of that partner's final profit.
 *
 *   ExpectedShare  = FinalProfit × SharePercent ÷ 100
 *   AdminFeesTotal = Σ fees for work our team did on the referral (ReferralWork)
 *   TotalDue       = ExpectedShare + AdminFeesTotal
 *   TotalReceived  = Σ payments received from the partner (ReferralPayments)
 *   Balance        = TotalDue − TotalReceived
 *
 * SharePercent defaults from the partner: FullShareRate when the partner
 * handles everything (Scope FULL), SharedShareRate when our team does part of
 * the work (Scope SHARED). A COMPLETED referral that is fully paid becomes
 * SETTLED automatically, and goes back to COMPLETED if a payment is removed.
 */

function mpRound2_(value) { return Math.round(Number(value || 0) * 100) / 100; }

function mpReferralWorkFor_(referralId, rows) {
  return (rows || mpRows_('ReferralWork').records).filter(function(item) { return item.IsArchived !== true && item.ReferralID === referralId; });
}

function mpReferralPaymentsFor_(referralId, rows) {
  return (rows || mpRows_('ReferralPayments').records).filter(function(item) { return item.IsArchived !== true && item.ReferralID === referralId; });
}

function mpRefreshReferralTotals_(referral, workRows, paymentRows) {
  const profit = mpIsBlank_(referral.FinalProfit) ? 0 : Number(referral.FinalProfit);
  const share = mpIsBlank_(referral.SharePercent) ? 0 : Number(referral.SharePercent);
  referral.ExpectedShare = mpRound2_(profit * share / 100);
  referral.AdminFeesTotal = mpRound2_(mpReferralWorkFor_(referral.ReferralID, workRows).reduce(function(sum, item) { return sum + Number(item.Fee || 0); }, 0));
  referral.TotalDue = mpRound2_(referral.ExpectedShare + referral.AdminFeesTotal);
  referral.TotalReceived = mpRound2_(mpReferralPaymentsFor_(referral.ReferralID, paymentRows).reduce(function(sum, item) { return sum + Number(item.Amount || 0); }, 0));
  referral.Balance = mpRound2_(referral.TotalDue - referral.TotalReceived);
  if (referral.Status === 'COMPLETED' && referral.TotalDue > 0 && referral.Balance <= 0) referral.Status = 'SETTLED';
  else if (referral.Status === 'SETTLED' && referral.Balance > 0) referral.Status = 'COMPLETED';
}

/** Runs before every referral save: client from the case, default share from the partner, totals. */
function mpReferralDerive_(referral) {
  const kase = mpDbGetById_('Cases', referral.CaseID, true);
  if (kase) referral.ClientID = kase.ClientID;
  if (mpIsBlank_(referral.SharePercent)) {
    const partner = mpDbGetById_('ExternalPartners', referral.PartnerID, true);
    const rate = partner ? (referral.Scope === 'SHARED' ? partner.SharedShareRate : partner.FullShareRate) : '';
    referral.SharePercent = mpIsBlank_(rate) ? '' : Number(rate);
  }
  mpRefreshReferralTotals_(referral);
}

function mpAssertPartnerActiveForNewReferral_(referral) {
  const partner = mpDbGetById_('ExternalPartners', referral.PartnerID, false);
  if (!partner || partner.Status !== 'ACTIVE') throw new Error('New referrals can only go to an active external lawyer or firm.');
}

/** After work or payments change: recompute each affected referral and record settlement. */
function mpRecalculateReferrals_(referralIds, actorId) {
  const ids = mpUniqueIds_(referralIds);
  if (!ids.length) return;
  const rows = mpRows_('Referrals');
  const work = mpRows_('ReferralWork').records;
  const payments = mpRows_('ReferralPayments').records;
  ids.forEach(function(referralId) {
    const record = rows.records.filter(function(item) { return item.ReferralID === referralId && item.IsArchived !== true; })[0];
    if (!record) return;
    const before = JSON.stringify([record.AdminFeesTotal, record.TotalDue, record.TotalReceived, record.Balance, record.Status]);
    const statusBefore = record.Status;
    mpRefreshReferralTotals_(record, work, payments);
    if (before === JSON.stringify([record.AdminFeesTotal, record.TotalDue, record.TotalReceived, record.Balance, record.Status])) return;
    if (MP_CONFIG.CLOSED_REFERRAL_STATUSES.indexOf(record.Status) !== -1 && mpIsBlank_(record.ClosedAt)) record.ClosedAt = mpNowIso_();
    record.UpdatedAt = mpNowIso_();
    record.Version = Number(record.Version || 1) + 1;
    mpWriteRecordChecked_(rows.sheet, rows.headers, record._rowNumber, record);
    mpLogActivity_('Referrals', referralId, 'REFERRAL_TOTALS_RECALCULATED', 'Recalculated amounts owed by the partner.', actorId);
    if (statusBefore !== record.Status) mpLogActivity_('Referrals', referralId, record.Status === 'SETTLED' ? 'REFERRAL_SETTLED' : 'REFERRAL_REOPENED', 'Status changed to ' + record.Status + ' after a payment change.', actorId);
  });
}

/** Active (not cancelled, not archived) referrals keyed by case, for "handled externally" labels and filters. */
function mpActiveReferralsByCase_() {
  const partners = {};
  mpRows_('ExternalPartners').records.forEach(function(partner) { partners[partner.PartnerID] = mpPlainText_(partner.Name); });
  const byCase = {};
  mpRows_('Referrals').records.forEach(function(referral) {
    if (referral.IsArchived === true || referral.Status === 'CANCELLED') return;
    (byCase[referral.CaseID] = byCase[referral.CaseID] || []).push({ referralId: referral.ReferralID, scope: referral.Scope, partner: partners[referral.PartnerID] || '', status: referral.Status, clientId: referral.ClientID });
  });
  return byCase;
}
