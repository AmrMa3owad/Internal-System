/**
 * Daily email reminders. One digest per active user (in their Language),
 * sent by a time-driven trigger installed with installDailyReminders().
 * NOTIFICATION_PREFERENCES controls what is included; email=false stops all.
 * Users with nothing due receive nothing.
 */
const MP_REMINDER_HANDLER_ = 'dailyReminderTrigger';

const MP_REMINDER_TEXT_ = {
  EN: {
    subject: function(name, count) { return name + ': ' + count + ' item(s) need your attention today'; },
    greeting: function(name) { return 'Good morning ' + name + ','; },
    intro: 'Here is what needs your attention today.',
    overdue: 'Overdue follow-ups', dueSoon: 'Follow-ups due today or tomorrow', consultations: 'Consultations today and tomorrow',
    deadlines: 'Case deadlines in the next 3 days', leads: 'Leads to contact', firm: 'Firm overview',
    firmOverdue: function(n) { return n + ' overdue follow-up(s) across the firm'; },
    firmUnassigned: function(n) { return n + ' open lead(s) with no one assigned'; },
    open: 'Open Mohamy Plus', footer: 'You receive this because email reminders are enabled in Mohamy Plus settings.'
  },
  AR: {
    subject: function(name, count) { return name + ': ' + count + ' بند يحتاج إلى متابعتك اليوم'; },
    greeting: function(name) { return 'صباح الخير ' + name + '،'; },
    intro: 'إليك ما يحتاج إلى متابعتك اليوم.',
    overdue: 'متابعات متأخرة', dueSoon: 'متابعات مستحقة اليوم أو غدًا', consultations: 'استشارات اليوم وغدًا',
    deadlines: 'مواعيد نهائية للقضايا خلال ٣ أيام', leads: 'عملاء محتملون يجب التواصل معهم', firm: 'نظرة عامة على المكتب',
    firmOverdue: function(n) { return n + ' متابعة متأخرة على مستوى المكتب'; },
    firmUnassigned: function(n) { return n + ' عميل محتمل مفتوح غير مسند لأحد'; },
    open: 'فتح محامي بلس', footer: 'تصلك هذه الرسالة لأن تذكيرات البريد مفعّلة في إعدادات محامي بلس.'
  }
};

function mpWebAppUrl_() {
  try { return ScriptApp.getService().getUrl() || ''; } catch (error) { return ''; }
}

/** Builds every digest without sending. Returns [{ userId, email, language, subject, text, html, count }]. */
function mpBuildReminderDigests_() {
  const prefs = mpGetSettingValue_('NOTIFICATION_PREFERENCES') || {};
  if (prefs.email === false) return [];
  const businessName = mpGetSettingValue_('BUSINESS_NAME') || MP_DEFAULT_SETTINGS.BUSINESS_NAME;
  const today = mpCairoDate_(mpNowIso_());
  const tomorrow = mpAddDaysIso_(1);
  const inThreeDays = mpAddDaysIso_(3);
  const active = function(entity) { return mpRows_(entity).records.filter(function(record) { return record.IsArchived !== true; }).map(mpPublicRecord_); };
  const followUps = active('FollowUps').filter(MP_OPEN_WORK_.FollowUps);
  const consultations = active('Consultations').filter(function(item) { const day = mpCairoDate_(item.ConsultationDate); return item.Status === 'SCHEDULED' && day >= today && day <= tomorrow; });
  const cases = active('Cases').filter(MP_OPEN_WORK_.Cases);
  const leads = active('Leads').filter(MP_OPEN_WORK_.Leads);
  const url = mpWebAppUrl_();

  return mpRows_('Users').records.filter(function(user) { return user.IsArchived !== true && user.Status === 'ACTIVE' && !mpIsBlank_(user.Email); }).map(function(user) {
    const language = user.Language === 'AR' ? 'AR' : 'EN';
    const text = MP_REMINDER_TEXT_[language];
    const sections = [];
    const mine = function(field) { return function(record) { return record[field] === user.UserID; }; };
    if (prefs.overdueFollowUps !== false) {
      sections.push({ title: text.overdue, items: followUps.filter(mine('AssignedTo')).filter(function(task) { return mpCairoDate_(task.DueDate) < today; }).map(function(task) { return [task.Title, mpCairoDate_(task.DueDate)]; }) });
    }
    sections.push({ title: text.dueSoon, items: followUps.filter(mine('AssignedTo')).filter(function(task) { const day = mpCairoDate_(task.DueDate); return day >= today && day <= tomorrow; }).map(function(task) { return [task.Title, mpCairoDate_(task.DueDate)]; }) });
    if (prefs.upcomingConsultations !== false) {
      sections.push({ title: text.consultations, items: consultations.filter(mine('AssignedLawyer')).map(function(item) { return [item.ConsultationType || 'Consultation', String(item.ConsultationDate).slice(0, 16).replace('T', ' ')]; }) });
    }
    sections.push({ title: text.deadlines, items: cases.filter(mine('AssignedLawyer')).filter(function(item) { const day = mpCairoDate_(item.Deadline); return !mpIsBlank_(item.Deadline) && day <= inThreeDays; }).map(function(item) { return [item.CaseTitle, mpCairoDate_(item.Deadline)]; }) });
    sections.push({ title: text.leads, items: leads.filter(mine('AssignedTo')).filter(function(lead) { return !mpIsBlank_(lead.NextFollowUpAt) && mpCairoDate_(lead.NextFollowUpAt) <= today; }).map(function(lead) { return [lead.FullName, String(lead.NextFollowUpAt).slice(0, 16).replace('T', ' ')]; }) });
    const personal = sections.filter(function(section) { return section.items.length; });
    const count = personal.reduce(function(total, section) { return total + section.items.length; }, 0);
    if (MP_SENIOR_ROLES_.indexOf(user.Role) !== -1) {
      const firmOverdue = followUps.filter(function(task) { return mpCairoDate_(task.DueDate) < today; }).length;
      const unassigned = leads.filter(function(lead) { return mpIsBlank_(lead.AssignedTo); }).length;
      const firmItems = [];
      if (firmOverdue) firmItems.push([text.firmOverdue(firmOverdue), '']);
      if (unassigned) firmItems.push([text.firmUnassigned(unassigned), '']);
      if (firmItems.length) personal.push({ title: text.firm, items: firmItems });
    }
    if (!personal.length) return null;
    const total = count || personal[personal.length - 1].items.length;
    const name = mpPlainText_(user.FullName);
    const dir = language === 'AR' ? 'rtl' : 'ltr';
    const plain = [text.greeting(name), '', text.intro, ''].concat(personal.map(function(section) {
      return section.title + '\n' + section.items.map(function(item) { return '  - ' + mpPlainText_(item[0]) + (item[1] ? ' (' + item[1] + ')' : ''); }).join('\n');
    })).concat(url ? ['', url] : []).concat(['', text.footer]).join('\n');
    const html = '<div dir="' + dir + '" style="font-family:Segoe UI,Tahoma,Arial,sans-serif;color:#102a43;max-width:560px">' +
      '<p>' + mpEscapeHtml_(text.greeting(name)) + '</p><p>' + mpEscapeHtml_(text.intro) + '</p>' +
      personal.map(function(section) {
        return '<h3 style="font-size:15px;margin:18px 0 6px">' + mpEscapeHtml_(section.title) + '</h3><ul style="margin:0;padding-inline-start:20px">' +
          section.items.map(function(item) { return '<li>' + mpEscapeHtml_(mpPlainText_(item[0])) + (item[1] ? ' <span style="color:#627d98">(' + mpEscapeHtml_(item[1]) + ')</span>' : '') + '</li>'; }).join('') + '</ul>';
      }).join('') +
      (url ? '<p style="margin-top:20px"><a href="' + mpEscapeHtml_(url) + '" style="background:#2f6fde;color:#fff;padding:8px 14px;border-radius:6px;text-decoration:none">' + mpEscapeHtml_(text.open) + '</a></p>' : '') +
      '<p style="color:#829ab1;font-size:12px;margin-top:24px">' + mpEscapeHtml_(text.footer) + '</p></div>';
    return { userId: user.UserID, email: mpNormalizeEmail_(user.Email), language: language, subject: text.subject(businessName, total), text: plain, html: html, count: total };
  }).filter(function(digest) { return digest !== null; });
}

function mpSendDailyReminders_() {
  const digests = mpBuildReminderDigests_();
  const businessName = mpGetSettingValue_('BUSINESS_NAME') || MP_DEFAULT_SETTINGS.BUSINESS_NAME;
  let sent = 0;
  const skipped = [];
  digests.forEach(function(digest) {
    if (MailApp.getRemainingDailyQuota() < 1) { skipped.push(digest.email); return; }
    MailApp.sendEmail({ to: digest.email, subject: digest.subject, body: digest.text, htmlBody: digest.html, name: businessName });
    sent += 1;
  });
  if (skipped.length) console.warn('Daily email quota exhausted; skipped ' + skipped.length + ' reminder(s).');
  return { sent: sent, skippedForQuota: skipped.length, recipients: digests.length };
}

function mpReminderTriggers_() {
  return ScriptApp.getProjectTriggers().filter(function(trigger) { return trigger.getHandlerFunction() === MP_REMINDER_HANDLER_; });
}

function mpInstallDailyReminders_() {
  mpReminderTriggers_().forEach(function(trigger) { ScriptApp.deleteTrigger(trigger); });
  ScriptApp.newTrigger(MP_REMINDER_HANDLER_).timeBased().everyDays(1).atHour(MP_CONFIG.REMINDER_HOUR).inTimezone(MP_CONFIG.DATE_TIMEZONE).create();
  return { enabled: true, hour: MP_CONFIG.REMINDER_HOUR };
}

function mpRemoveDailyReminders_() {
  mpReminderTriggers_().forEach(function(trigger) { ScriptApp.deleteTrigger(trigger); });
  return { enabled: false, hour: MP_CONFIG.REMINDER_HOUR };
}

/**
 * Trigger handler. It must be top-level for the trigger, so it also refuses
 * any call that does not carry the uid of this project's own reminder trigger.
 */
function dailyReminderTrigger(event) {
  const uid = event && event.triggerUid;
  const genuine = !!uid && mpReminderTriggers_().some(function(trigger) { return trigger.getUniqueId() === uid; });
  if (!genuine) return mpFailure_(new Error('dailyReminderTrigger only runs from its scheduled trigger.'));
  try {
    const emails = mpSendDailyReminders_();
    // Tomorrow's consultations get a WhatsApp template reminder when an owner turned that on.
    try { emails.whatsapp = mpSendWhatsAppReminders_(); } catch (error) { console.warn('WhatsApp reminders failed: ' + error.message); }
    return mpSuccess_(emails);
  }
  catch (error) { console.error(error); return mpFailure_(error); }
}

// Owner controls (Settings page and Apps Script editor).
function mpRequireReminderAdmin_() {
  const actor = mpRequireActiveUser_();
  mpRequirePermission_(actor, 'Settings', 'update');
  return actor;
}

function apiGetReminderStatus() {
  return mpApiRespond_(function() { mpRequireReminderAdmin_(); return { enabled: mpReminderTriggers_().length > 0, hour: MP_CONFIG.REMINDER_HOUR }; });
}

function apiSetDailyReminders(enabled) {
  return mpApiRespond_(function() { mpRequireReminderAdmin_(); return enabled === true ? mpInstallDailyReminders_() : mpRemoveDailyReminders_(); });
}

function apiSendRemindersNow() {
  return mpApiRespond_(function() { mpRequireReminderAdmin_(); return mpSendDailyReminders_(); });
}

/** Any user: what today's digest for them would contain (nothing is sent). */
function apiPreviewMyReminder() {
  return mpApiRespond_(function() {
    const actor = mpRequireActiveUser_();
    return mpBuildReminderDigests_().filter(function(digest) { return digest.userId === actor.userId; })[0] || null;
  });
}
