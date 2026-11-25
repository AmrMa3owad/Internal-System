/**
 * Work with external lawyers and law firms (partners). Three kinds:
 *
 *   FULL        our case is referred out; the partner handles everything.
 *   SHARED      our case is referred out; our team does part of it (e.g.
 *               administrative work) for a bigger share plus per-task fees.
 *   ADMIN_ONLY  the partner hires our team for administrative work only
 *               (no case of ours needed): an agreed fee per task, and the
 *               partner reimburses the expenses (transport, institution fees).
 *
 *   ExpectedShare  = FinalProfit × SharePercent ÷ 100   (0 for ADMIN_ONLY)
 *   AdminFeesTotal = Σ fees for our team's tasks (ReferralWork.Fee)
 *   ExpensesTotal  = Σ expenses we paid for those tasks (ReferralWork.Expenses)
 *   TotalDue       = ExpectedShare + AdminFeesTotal + ExpensesTotal
 *   TotalReceived  = Σ payments received from the partner (ReferralPayments)
 *   Balance        = TotalDue − TotalReceived
 *
 * SharePercent defaults from the partner: FullShareRate for FULL,
 * SharedShareRate for SHARED. A referral is SETTLED only when the amount owed
 * is known (final profit and share entered, or, for ADMIN_ONLY, at least one
 * priced task) and fully received. A COMPLETED referral that meets this
 * becomes SETTLED automatically and goes back to COMPLETED if a payment is
 * removed. An unknown profit is never treated as zero.
 */

function mpRound2_(value) { return Math.round(Number(value || 0) * 100) / 100; }

function mpIsProfitShare_(referral) { return MP_CONFIG.PROFIT_SHARE_SCOPES.indexOf(referral.Scope) !== -1; }

function mpReferralWorkFor_(referralId, rows) {
  return (rows || mpRows_('ReferralWork').records).filter(function(item) { return item.IsArchived !== true && item.ReferralID === referralId; });
}

function mpReferralPaymentsFor_(referralId, rows) {
  return (rows || mpRows_('ReferralPayments').records).filter(function(item) { return item.IsArchived !== true && item.ReferralID === referralId; });
}

/** Whether everything the partner owes is known (so a zero or paid balance really means settled). */
function mpReferralAmountKnown_(referral) {
  if (mpIsProfitShare_(referral)) return !mpIsBlank_(referral.FinalProfit) && !mpIsBlank_(referral.SharePercent);
  return Number(referral.TotalDue || 0) > 0;
}

function mpRefreshReferralTotals_(referral, workRows, paymentRows) {
  const shareBased = mpIsProfitShare_(referral);
  const profit = !shareBased || mpIsBlank_(referral.FinalProfit) ? 0 : Number(referral.FinalProfit);
  const share = !shareBased || mpIsBlank_(referral.SharePercent) ? 0 : Number(referral.SharePercent);
  const work = mpReferralWorkFor_(referral.ReferralID, workRows);
  referral.ExpectedShare = mpRound2_(profit * share / 100);
  referral.AdminFeesTotal = mpRound2_(work.reduce(function(sum, item) { return sum + Number(item.Fee || 0); }, 0));
  referral.ExpensesTotal = mpRound2_(work.reduce(function(sum, item) { return sum + Number(item.Expenses || 0); }, 0));
  referral.TotalDue = mpRound2_(referral.ExpectedShare + referral.AdminFeesTotal + referral.ExpensesTotal);
  referral.TotalReceived = mpRound2_(mpReferralPaymentsFor_(referral.ReferralID, paymentRows).reduce(function(sum, item) { return sum + Number(item.Amount || 0); }, 0));
  referral.Balance = mpRound2_(referral.TotalDue - referral.TotalReceived);
  const settleable = mpReferralAmountKnown_(referral) && referral.Balance <= 0;
  if (referral.Status === 'COMPLETED' && settleable) referral.Status = 'SETTLED';
  else if (referral.Status === 'SETTLED' && !settleable) referral.Status = 'COMPLETED';
}

/** Runs before every referral save: kind-specific fields, client from the case, default share, totals. */
function mpReferralDerive_(referral) {
  if (!mpIsProfitShare_(referral)) {
    // Administrative work for the partner: no profit share and no external-work type.
    referral.SharePercent = '';
    referral.FinalProfit = '';
    referral.ExternalWork = '';
  }
  const kase = mpIsBlank_(referral.CaseID) ? null : mpDbGetById_('Cases', referral.CaseID, true);
  referral.ClientID = kase ? kase.ClientID : '';
  if (mpIsProfitShare_(referral) && mpIsBlank_(referral.SharePercent)) {
    const partner = mpDbGetById_('ExternalPartners', referral.PartnerID, true);
    const rate = partner ? (referral.Scope === 'SHARED' ? partner.SharedShareRate : partner.FullShareRate) : '';
    referral.SharePercent = mpIsBlank_(rate) ? '' : Number(rate);
  }
  const requested = referral.Status;
  mpRefreshReferralTotals_(referral);
  if (requested === 'SETTLED' && referral.Status !== 'SETTLED') {
    throw new Error(mpIsProfitShare_(referral) && !mpReferralAmountKnown_(referral)
      ? 'A referral can be marked settled only after their final profit and our share are entered.'
      : 'A referral can be marked settled only when everything owed has been received.');
  }
}

/** Records who confirmed the partner accepted, the first time the referral becomes active. */
function mpStampReferralAcceptance_(referral, actorId) {
  if (MP_CONFIG.ACCEPTED_REFERRAL_STATUSES.indexOf(referral.Status) === -1 || !mpIsBlank_(referral.AcceptedAt)) return false;
  referral.AcceptedAt = mpNowIso_();
  referral.AcceptedBy = actorId || '';
  return true;
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
    const snapshot = function() { return JSON.stringify([record.AdminFeesTotal, record.ExpensesTotal, record.TotalDue, record.TotalReceived, record.Balance, record.Status]); };
    const before = snapshot();
    const statusBefore = record.Status;
    mpRefreshReferralTotals_(record, work, payments);
    if (before === snapshot()) return;
    if (MP_CONFIG.CLOSED_REFERRAL_STATUSES.indexOf(record.Status) !== -1 && mpIsBlank_(record.ClosedAt)) record.ClosedAt = mpNowIso_();
    record.UpdatedAt = mpNowIso_();
    record.Version = Number(record.Version || 1) + 1;
    mpWriteRecordChecked_(rows.sheet, rows.headers, record._rowNumber, record);
    mpLogActivity_('Referrals', referralId, 'REFERRAL_TOTALS_RECALCULATED', 'Recalculated amounts owed by the partner.', actorId);
    if (statusBefore !== record.Status) mpLogActivity_('Referrals', referralId, record.Status === 'SETTLED' ? 'REFERRAL_SETTLED' : 'REFERRAL_REOPENED', 'Status changed to ' + record.Status + ' after a payment change.', actorId);
  });
}

/**
 * Active (not cancelled, not archived) referrals of our cases, keyed by case, for
 * "handled externally" labels and filters. Administrative jobs we do for a
 * partner are not "our case handled externally", so they are left out.
 */
function mpActiveReferralsByCase_() {
  const partners = {};
  mpRows_('ExternalPartners').records.forEach(function(partner) { partners[partner.PartnerID] = mpPlainText_(partner.Name); });
  const byCase = {};
  mpRows_('Referrals').records.forEach(function(referral) {
    if (referral.IsArchived === true || referral.Status === 'CANCELLED' || !mpIsProfitShare_(referral) || mpIsBlank_(referral.CaseID)) return;
    (byCase[referral.CaseID] = byCase[referral.CaseID] || []).push({ referralId: referral.ReferralID, scope: referral.Scope, partner: partners[referral.PartnerID] || '', status: referral.Status, clientId: referral.ClientID });
  });
  return byCase;
}
