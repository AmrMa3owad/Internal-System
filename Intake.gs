/**
 * Lead intake: the firm's website form (or an automation tool such as Make or
 * Zapier relaying WhatsApp / Instagram / Facebook messages) sends each inquiry
 * straight into Leads, so none are lost between channels.
 *
 *   POST <web app URL>?key=<intake key>
 *   fields (form-encoded or JSON): name, phone, email, message,
 *           source (WEBSITE, WHATSAPP, INSTAGRAM, FACEBOOK, TIKTOK, ...), campaign
 *
 * The key is a long random secret the owner turns on (Settings -> Website
 * leads) and can replace at any time. Without the right key nothing is saved.
 * A hidden "website" field catches simple spam bots, and a firm-wide limit
 * stops floods. Possible duplicates are still saved (never lose an inquiry)
 * and flagged in the lead's history. Owners and partners get an email.
 */

const MP_INTAKE_FLOOD_KEY_ = 'mp:intake:flood';
const MP_INTAKE_FLOOD_LIMIT_ = 40;
const MP_INTAKE_FLOOD_SECONDS_ = 600;

function mpIntakeKey_() { return PropertiesService.getScriptProperties().getProperty(MP_CONFIG.INTAKE_KEY_PROPERTY) || ''; }

function mpSafeEqual_(left, right) {
  const a = String(left || ''); const b = String(right || '');
  if (!a || a.length !== b.length) return false;
  let diff = 0;
  for (let index = 0; index < a.length; index += 1) diff |= a.charCodeAt(index) ^ b.charCodeAt(index);
  return diff === 0;
}

function mpIntakeJson_(body) {
  return ContentService.createTextOutput(JSON.stringify(body)).setMimeType(ContentService.MimeType.JSON);
}

function mpIntakeFields_(event) {
  const fields = Object.assign({}, (event && event.parameter) || {});
  const post = event && event.postData;
  if (post && /json/i.test(String(post.type || '')) && post.contents) {
    try { Object.assign(fields, JSON.parse(post.contents)); } catch (error) { throw new Error('The request body is not valid JSON.'); }
  }
  return fields;
}

function mpIntakeFlooded_() {
  try {
    const cache = CacheService.getScriptCache();
    const count = Number(cache.get(MP_INTAKE_FLOOD_KEY_) || 0) + 1;
    cache.put(MP_INTAKE_FLOOD_KEY_, String(count), MP_INTAKE_FLOOD_SECONDS_);
    return count > MP_INTAKE_FLOOD_LIMIT_;
  } catch (error) { return false; }
}

/** The user the intake acts as in the history: the first active owner. */
function mpIntakeActorId_() {
  const owner = mpRows_('Users').records.filter(function(user) { return user.IsArchived !== true && user.Status === 'ACTIVE' && user.Role === 'OWNER'; })[0];
  if (!owner) throw new Error('No active owner.');
  return owner.UserID;
}

// The website's consultation categories -> CRM practice areas (used only when the firm still has that area).
const MP_WEBSITE_AREAS_ = Object.freeze({
  'corporate & m&a': 'CORPORATE', 'capital markets': 'CORPORATE', 'arbitration & dispute': 'COMMERCIAL',
  'criminal defense': 'CRIMINAL', 'real estate law': 'REAL_ESTATE', 'family & estate': 'FAMILY', 'other service': 'OTHER'
});
// The website's priority choices -> CRM lead priority.
const MP_WEBSITE_PRIORITIES_ = Object.freeze({ standard: 'MEDIUM', urgent: 'HIGH', 'time-sensitive': 'URGENT' });
const MP_INTAKE_FORMS_ = Object.freeze({ consultation: 'Website consultation request', contact: 'Website contact form' });
const MP_INTAKE_REPEAT_SECONDS_ = 600;

function mpIntakePracticeArea_(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  const code = MP_WEBSITE_AREAS_[raw.toLowerCase()] || raw.toUpperCase().replace(/[^A-Z_]/g, '_');
  try { return mpValidatePracticeArea_(code); } catch (error) { return ''; }
}

function mpIntakePriority_(value) {
  const raw = String(value || '').trim();
  // The website's own words first ("Urgent" there is HIGH here; "Time-sensitive" is URGENT), then CRM codes.
  if (MP_WEBSITE_PRIORITIES_[raw.toLowerCase()]) return MP_WEBSITE_PRIORITIES_[raw.toLowerCase()];
  return MP_CONFIG.PRIORITIES.indexOf(raw.toUpperCase()) !== -1 ? raw.toUpperCase() : 'MEDIUM';
}

/** The same submission twice within 10 minutes (double click, resend) is saved once. */
function mpIntakeIsRepeat_(input) {
  try {
    const cache = CacheService.getScriptCache();
    const key = 'mp:intake:seen:' + mpSha256Hex_([input.FullName, input.Phone, input.Email, input.Description].join('|').toLowerCase());
    if (cache.get(key)) return true;
    cache.put(key, '1', MP_INTAKE_REPEAT_SECONDS_);
    return false;
  } catch (error) { return false; }
}

/**
 * fields: name, phone, email, message (or summary), subject, practiceArea,
 * priority, form ('consultation' | 'contact'), language ('en' | 'ar'),
 * source, campaign, page. Unknown fields are ignored.
 */
function mpCaptureLead_(fields) {
  // Over-long input is cut to size instead of losing the whole inquiry.
  const text = function(name, max) { return mpCleanText_(fields[name] === undefined || fields[name] === null ? '' : String(fields[name]).slice(0, max), max); };
  const name = text('name', 200) || text('fullName', 200) || text('FullName', 200);
  const phone = text('phone', 30) || text('Phone', 30);
  const email = text('email', 254) || text('Email', 254);
  const message = text('message', 4000) || text('summary', 4000) || text('Description', 4000);
  if (!name) throw new Error('Please include your name.');
  if (!phone && !email) throw new Error('Please include a phone number or an email address.');
  const source = String(fields.source || 'WEBSITE').trim().toUpperCase();
  const form = String(fields.form || '').trim().toLowerCase();
  const area = text('practiceArea', 120);
  const subject = text('subject', 250);
  const language = String(fields.language || '').trim().toLowerCase() === 'ar' ? 'Arabic' : (fields.language ? 'English' : '');
  // Everything the visitor chose stays readable in the lead, even when it has no CRM field.
  const details = [];
  if (subject) details.push('Subject: ' + subject);
  if (area) details.push('Area chosen on the website: ' + area);
  if (fields.priority) details.push('Priority chosen: ' + text('priority', 40));
  if (language) details.push('Wrote in: ' + language);
  if (fields.page) details.push('Page: ' + text('page', 300));
  const input = {
    FullName: name, Phone: phone, Email: email,
    Description: [message].concat(details.length ? ['', details.join('\n')] : []).join('\n').trim().slice(0, MP_CONFIG.MAX_TEXT_LENGTH),
    Source: MP_CONFIG.LEAD_SOURCES.indexOf(source) !== -1 ? source : 'OTHER',
    CampaignID: text('campaign', 120), InquiryType: MP_INTAKE_FORMS_[form] || '',
    PracticeArea: mpIntakePracticeArea_(area), Priority: mpIntakePriority_(fields.priority),
    Status: 'NEW', ClientType: 'INDIVIDUAL'
  };
  if (mpIntakeIsRepeat_(input)) return null;
  const actorId = mpIntakeActorId_();
  // Saved even when it looks like a duplicate; the history then notes the possible duplicate for review.
  const lead = mpWithLock_(function() {
    const created = mpInsertRecordLocked_('Leads', input, true, actorId, null);
    mpLogActivity_('Leads', created.LeadID, 'CAPTURED_AUTOMATICALLY', 'Received automatically from ' + input.Source + (input.InquiryType ? ' (' + input.InquiryType + ')' : '') + '.', actorId);
    return created;
  });
  mpNotifyNewLead_(lead);
  return lead;
}

function mpNotifyNewLead_(lead) {
  try {
    const prefs = mpGetSettings_().NOTIFICATION_PREFERENCES || {};
    if (prefs.email === false) return;
    const recipients = mpRows_('Users').records.filter(function(user) { return user.IsArchived !== true && user.Status === 'ACTIVE' && MP_SENIOR_ROLES_.indexOf(user.Role) !== -1 && user.Email; })
      .map(function(user) { return user.Email; });
    if (!recipients.length || MailApp.getRemainingDailyQuota() < recipients.length) return;
    const link = mpWebAppUrl_();
    const lines = ['New inquiry from ' + lead.Source + (lead.InquiryType ? ' · ' + lead.InquiryType : '') + ':', '', 'Name: ' + mpPlainText_(lead.FullName), 'Phone: ' + (lead.Phone || '—'), 'Email: ' + (lead.Email || '—'),
      'Priority: ' + lead.Priority + (lead.PracticeArea ? ' · ' + lead.PracticeArea : ''), '', mpPlainText_(lead.Description || ''), '', 'Open Mohamy Plus to assign it: ' + link];
    MailApp.sendEmail({ to: recipients.join(','), subject: (lead.Priority === 'URGENT' || lead.Priority === 'HIGH' ? '[' + lead.Priority + '] ' : '') + 'New lead: ' + mpPlainText_(lead.FullName), body: lines.join('\n'), name: mpGetSettings_().BUSINESS_NAME || MP_DEFAULT_SETTINGS.BUSINESS_NAME });
  } catch (error) { console.warn('New-lead email not sent: ' + error.message); }
}

/** Public web endpoint for lead intake. Everything else in the app goes through doGet/apiCall. */
function doPost(event) {
  // Messaging relay (relay/worker.js): it has already checked Meta's / TikTok's signature.
  if (event && event.parameter && event.parameter.relay !== undefined) {
    try {
      const key = mpRelayKey_();
      if (!key || !mpSafeEqual_(event.parameter.relay, key)) return mpIntakeJson_({ ok: false, error: 'Not accepted.' });
      let delivery;
      try { delivery = JSON.parse((event.postData && event.postData.contents) || '{}'); } catch (error) { return mpIntakeJson_({ ok: false, error: 'Body is not JSON.' }); }
      return mpIntakeJson_({ ok: true, summary: mpProcessRelay_(delivery) });
    } catch (error) {
      console.error(error);
      return mpIntakeJson_({ ok: false, error: 'Could not process the delivery.' });
    }
  }
  try {
    const fields = mpIntakeFields_(event);
    const key = mpIntakeKey_();
    if (!key || !mpSafeEqual_(fields.key, key)) return mpIntakeJson_({ ok: false, error: 'Not accepted.' });
    if (!mpIsBlank_(fields.website)) return mpIntakeJson_({ ok: true });
    if (mpIntakeFlooded_()) return mpIntakeJson_({ ok: false, error: 'Too many requests. Please try again later.' });
    mpCaptureLead_(fields);
    return mpIntakeJson_({ ok: true, message: 'Thank you. We will contact you shortly.' });
  } catch (error) {
    console.error(error);
    return mpIntakeJson_({ ok: false, error: /required|invalid|Please include/i.test(error.message) ? error.message : 'Could not save your message. Please call us instead.' });
  }
}

function mpIntakeStatus_() {
  const key = mpIntakeKey_();
  return { enabled: !!key, url: key ? mpWebAppUrl_() + '?key=' + key : '', sources: MP_CONFIG.LEAD_SOURCES };
}

// Owner controls on the Settings page. Turning it on (again) issues a new key; the old one stops working.
function apiGetIntakeStatus() {
  return mpApiRespond_(function() { mpRequireReminderAdmin_(); return mpIntakeStatus_(); });
}

function apiSetLeadIntake(enabled) {
  return mpApiRespond_(function() {
    const actor = mpRequireReminderAdmin_();
    const properties = PropertiesService.getScriptProperties();
    if (enabled === true) properties.setProperty(MP_CONFIG.INTAKE_KEY_PROPERTY, mpRandomHex_());
    else properties.deleteProperty(MP_CONFIG.INTAKE_KEY_PROPERTY);
    mpLogAccess_(enabled === true ? 'LEAD_INTAKE_KEY_ISSUED' : 'LEAD_INTAKE_DISABLED', '', actor.userId, enabled === true ? 'A new website-lead key was issued; any previous key stopped working.' : 'Website lead intake was turned off.');
    return mpIntakeStatus_();
  });
}
