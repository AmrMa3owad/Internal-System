/**
 * Messaging channels: WhatsApp, Facebook Messenger, Instagram, and lead-ad
 * forms (Facebook, Instagram, TikTok).
 *
 *   Meta / TikTok --webhook--> relay (Cloudflare Worker, relay/worker.js)
 *     checks the platform's signature, then POSTs the raw payload to
 *     <web app URL>?relay=<relay key>  -> doPost -> mpProcessRelay_
 *
 * Apps Script cannot read request headers, so it cannot check Meta's
 * signature itself; the relay does that and holds only the app secret.
 * Tokens for sending (WhatsApp, Page) live in Script Properties and are set by
 * an owner on the Settings page; they are never returned to the browser.
 *
 * Every incoming chat, direct message, comment, and lead form becomes (or is
 * linked to) a lead or client, and chats appear in the Inbox where staff
 * reply. Optional: an automatic first reply, and WhatsApp template reminders
 * the day before a consultation.
 */

const MP_GRAPH_VERSION_ = 'v23.0';
const MP_RELAY_KEY_PROPERTY_ = 'MP_RELAY_KEY';
const MP_RELAY_LAST_PROPERTY_ = 'MP_RELAY_LAST_EVENT';
const MP_CHANNEL_CONFIG_PROPERTY_ = 'MP_CHANNELS_CONFIG';
const MP_CHANNEL_SECRET_PREFIX_ = 'MP_SECRET_';
// What an owner can store (all write-only from the browser).
const MP_CHANNEL_SECRETS_ = ['WHATSAPP_TOKEN', 'WHATSAPP_PHONE_NUMBER_ID', 'META_PAGE_TOKEN', 'META_PAGE_ID'];
const MP_REPLY_WINDOW_HOURS_ = 24;
const MP_COMMENT_REPLY_DAYS_ = 7;
const MP_CHANNEL_SOURCES_ = { WHATSAPP: 'WHATSAPP', MESSENGER: 'FACEBOOK', INSTAGRAM: 'INSTAGRAM' };
const MP_COMMENT_THREAD_PREFIX_ = 'c:';

const MP_DEFAULT_CHANNEL_CONFIG_ = Object.freeze({
  autoReply: {
    enabled: false,
    channels: { WHATSAPP: true, MESSENGER: true, INSTAGRAM: true, COMMENTS: false },
    // Sent again only if the person has been quiet for this many days.
    quietDays: 7,
    textEn: 'Thank you for contacting Mohamy Plus. Your message has reached our team and a lawyer will contact you shortly. For urgent matters, please call +20 108 050 9733.',
    textAr: 'شكرًا لتواصلك مع محامي بلس. وصلت رسالتك إلى فريقنا وسيتواصل معك أحد المحامين قريبًا. للأمور العاجلة يُرجى الاتصال على ‎+20 108 050 9733.'
  },
  reminders: { enabled: false, template: '', language: 'ar' },
  // WhatsApp message templates approved in Meta (name + language + how many {{n}} variables).
  templates: []
});

// ------------------------------------------------------------ Configuration
function mpChannelConfig_() {
  let stored = {};
  try { stored = JSON.parse(PropertiesService.getScriptProperties().getProperty(MP_CHANNEL_CONFIG_PROPERTY_) || '{}'); } catch (error) { stored = {}; }
  const defaults = mpDeepClone_(MP_DEFAULT_CHANNEL_CONFIG_);
  const autoReply = Object.assign(defaults.autoReply, stored.autoReply || {});
  autoReply.channels = Object.assign(mpDeepClone_(MP_DEFAULT_CHANNEL_CONFIG_.autoReply.channels), (stored.autoReply || {}).channels || {});
  return { autoReply: autoReply, reminders: Object.assign(defaults.reminders, stored.reminders || {}), templates: Array.isArray(stored.templates) ? stored.templates : [] };
}

function mpValidateChannelConfig_(input) {
  if (!input || typeof input !== 'object') throw new Error('Channel settings are required.');
  const current = mpChannelConfig_();
  const auto = input.autoReply || current.autoReply;
  const text = function(value, max, label) { const clean = String(value || '').trim(); if (clean.length > max) throw new Error(label + ' is too long.'); return clean; };
  const templates = (Array.isArray(input.templates) ? input.templates : current.templates).map(function(template) {
    const name = String(template.name || '').trim();
    if (!/^[a-z0-9_]{1,512}$/.test(name)) throw new Error('Template names use lowercase letters, numbers, and underscores, exactly as in Meta.');
    const params = Number(template.params || 0);
    if (!Number.isInteger(params) || params < 0 || params > 10) throw new Error('A template has 0 to 10 variables.');
    return { name: name, language: text(template.language || 'ar', 10, 'Language') || 'ar', label: text(template.label || name, 80, 'Label'), params: params };
  });
  const reminders = input.reminders || current.reminders;
  if (reminders.enabled === true && !templates.some(function(template) { return template.name === reminders.template; })) throw new Error('Choose one of your WhatsApp templates for consultation reminders.');
  const days = Number(auto.quietDays === undefined ? 7 : auto.quietDays);
  if (!Number.isInteger(days) || days < 0 || days > 90) throw new Error('Quiet days must be between 0 and 90.');
  return {
    autoReply: {
      enabled: auto.enabled === true,
      channels: { WHATSAPP: auto.channels.WHATSAPP !== false, MESSENGER: auto.channels.MESSENGER !== false, INSTAGRAM: auto.channels.INSTAGRAM !== false, COMMENTS: auto.channels.COMMENTS === true },
      quietDays: days,
      textEn: text(auto.textEn, 1000, 'English reply'),
      textAr: text(auto.textAr, 1000, 'Arabic reply')
    },
    reminders: { enabled: reminders.enabled === true, template: String(reminders.template || ''), language: text(reminders.language || 'ar', 10, 'Language') || 'ar' },
    templates: templates
  };
}

function mpChannelSecret_(name) { return PropertiesService.getScriptProperties().getProperty(MP_CHANNEL_SECRET_PREFIX_ + name) || ''; }

function mpRelayKey_() { return PropertiesService.getScriptProperties().getProperty(MP_RELAY_KEY_PROPERTY_) || ''; }

/** Which channels can send right now. */
function mpChannelsConnected_() {
  const whatsapp = !!(mpChannelSecret_('WHATSAPP_TOKEN') && mpChannelSecret_('WHATSAPP_PHONE_NUMBER_ID'));
  const page = !!(mpChannelSecret_('META_PAGE_TOKEN') && mpChannelSecret_('META_PAGE_ID'));
  return { WHATSAPP: whatsapp, MESSENGER: page, INSTAGRAM: page, LEAD_FORMS: !!mpChannelSecret_('META_PAGE_TOKEN') };
}

// ------------------------------------------------------------ Meta Graph API
function mpGraph_(method, path, payload, tokenName) {
  const token = mpChannelSecret_(tokenName);
  if (!token) throw mpChannelError_('This channel is not connected yet. An owner adds its token in Settings → Channels.');
  const options = { method: method, muteHttpExceptions: true, headers: { Authorization: 'Bearer ' + token } };
  if (payload) { options.contentType = 'application/json'; options.payload = JSON.stringify(payload); }
  const response = UrlFetchApp.fetch('https://graph.facebook.com/' + MP_GRAPH_VERSION_ + '/' + path, options);
  let body = {};
  try { body = JSON.parse(response.getContentText() || '{}'); } catch (error) { body = {}; }
  if (response.getResponseCode() >= 300 || body.error) throw mpChannelError_('Meta refused the request: ' + ((body.error && body.error.message) || ('HTTP ' + response.getResponseCode())));
  return body;
}

function mpChannelError_(message) { const error = new Error(message); error.code = 'CHANNEL_ERROR'; return error; }

/** WhatsApp ID for a phone: digits with the country code (local Egyptian 01… numbers get 20). */
function mpWhatsAppId_(phone) {
  let digits = mpNormalizePhone_(phone);
  if (digits.indexOf('00') === 0) digits = digits.slice(2);
  if (digits.length === 11 && digits.charAt(0) === '0') digits = '20' + digits.slice(1);
  return digits;
}

function mpSamePhone_(left, right) {
  const a = mpWhatsAppId_(left); const b = mpWhatsAppId_(right);
  return !!a && a.length >= 7 && a === b;
}

// ------------------------------------------------------------ Normalizing platform payloads
function mpMetaMessageBody_(message) {
  if (!message) return { kind: 'TEXT', body: '' };
  if (message.text && typeof message.text === 'object') return { kind: 'TEXT', body: String(message.text.body || '') };
  if (typeof message.text === 'string') return { kind: 'TEXT', body: message.text };
  if (message.button) return { kind: 'TEXT', body: String(message.button.text || '') };
  if (message.interactive) {
    const reply = message.interactive.button_reply || message.interactive.list_reply || {};
    return { kind: 'TEXT', body: String(reply.title || '') };
  }
  const type = message.type || (message.attachments && message.attachments[0] && message.attachments[0].type) || 'attachment';
  const media = message[type] || {};
  if (type === 'location') return { kind: 'MEDIA', body: '[Location] ' + (media.name || '') + ' ' + [media.latitude, media.longitude].filter(function(v) { return v !== undefined; }).join(', ') };
  if (type === 'reaction') return { kind: 'MEDIA', body: '[Reaction] ' + (media.emoji || '') };
  const label = { image: 'Image', video: 'Video', audio: 'Voice note', voice: 'Voice note', document: 'Document', sticker: 'Sticker', file: 'File', contacts: 'Contact card' }[type] || 'Attachment';
  return { kind: 'MEDIA', body: ('[' + label + '] ' + String(media.caption || media.filename || '')).trim() };
}

/** Turns a relay delivery into simple events. Unknown shapes become one 'unknown' event so nothing is lost silently. */
function mpNormalizeRelayPayload_(delivery) {
  const events = [];
  const body = (delivery && delivery.body) || {};
  if (delivery && delivery.source === 'tiktok') return [mpNormalizeTikTokLead_(body)];
  (body.entry || []).forEach(function(entry) {
    // WhatsApp Business Platform
    (entry.changes || []).forEach(function(change) {
      const value = change.value || {};
      if (body.object === 'whatsapp_business_account') {
        const names = {};
        (value.contacts || []).forEach(function(contact) { names[contact.wa_id] = contact.profile && contact.profile.name; });
        (value.messages || []).forEach(function(message) {
          const content = mpMetaMessageBody_(message);
          events.push({ type: 'message', channel: 'WHATSAPP', direction: 'IN', threadId: String(message.from), externalId: message.id, kind: content.kind, body: content.body,
            name: names[message.from] || '', phone: '+' + message.from, at: mpEpochIso_(message.timestamp) });
        });
        (value.message_echoes || []).forEach(function(message) {
          const content = mpMetaMessageBody_(message);
          events.push({ type: 'message', channel: 'WHATSAPP', direction: 'OUT', threadId: String(message.to), externalId: message.id, kind: content.kind, body: content.body, at: mpEpochIso_(message.timestamp) });
        });
        (value.statuses || []).forEach(function(status) {
          events.push({ type: 'status', channel: 'WHATSAPP', externalId: status.id, status: String(status.status || '').toUpperCase(),
            error: status.errors && status.errors[0] ? String(status.errors[0].title || status.errors[0].message || '') : '' });
        });
        return;
      }
      // Facebook Page: comments on posts, and lead-ad forms.
      if (body.object === 'page' && change.field === 'feed' && value.item === 'comment' && value.verb === 'add' && value.from && String(value.from.id) !== String(entry.id)) {
        events.push({ type: 'comment', channel: 'MESSENGER', threadId: MP_COMMENT_THREAD_PREFIX_ + value.from.id, externalId: value.comment_id, body: String(value.message || ''),
          name: value.from.name || '', handle: 'Facebook: ' + (value.from.name || value.from.id), postId: value.post_id || '', at: mpEpochIso_(value.created_time) });
        return;
      }
      if (body.object === 'page' && change.field === 'leadgen') {
        events.push({ type: 'leadgen', channel: 'FACEBOOK', externalId: String(value.leadgen_id), formId: value.form_id || '', adId: value.ad_id || '', at: mpEpochIso_(value.created_time) });
        return;
      }
      // Instagram: comments on posts and reels.
      if (body.object === 'instagram' && change.field === 'comments' && value.from && String(value.from.id) !== String(entry.id)) {
        events.push({ type: 'comment', channel: 'INSTAGRAM', threadId: MP_COMMENT_THREAD_PREFIX_ + value.from.id, externalId: value.id, body: String(value.text || ''),
          name: value.from.username || '', handle: 'Instagram @' + (value.from.username || value.from.id), postId: (value.media && value.media.id) || '', at: mpNowIso_() });
        return;
      }
      events.push({ type: 'unknown', channel: body.object === 'instagram' ? 'INSTAGRAM' : 'MESSENGER', externalId: '', detail: (change.field || 'change') + ' on ' + (body.object || 'unknown object') });
    });
    // Messenger and Instagram direct messages (including echoes of what the page sent).
    (entry.messaging || []).forEach(function(event) {
      const channel = body.object === 'instagram' ? 'INSTAGRAM' : 'MESSENGER';
      if (!event.message || !event.message.mid) {
        if (event.read || event.delivery) return;
        if (event.postback) events.push({ type: 'message', channel: channel, direction: 'IN', threadId: String(event.sender.id), externalId: 'pb:' + event.sender.id + ':' + event.timestamp, kind: 'TEXT', body: String(event.postback.title || ''), at: mpEpochIso_(event.timestamp) });
        return;
      }
      const echo = event.message.is_echo === true;
      const content = mpMetaMessageBody_(event.message);
      events.push({ type: 'message', channel: channel, direction: echo ? 'OUT' : 'IN', threadId: String(echo ? event.recipient.id : event.sender.id), externalId: event.message.mid,
        kind: content.kind, body: content.body, at: mpEpochIso_(event.timestamp) });
    });
  });
  if (!events.length && body.object) events.push({ type: 'unknown', channel: body.object === 'whatsapp_business_account' ? 'WHATSAPP' : 'MESSENGER', externalId: '', detail: 'Nothing to process in ' + body.object });
  return events;
}

/** TikTok lead forms: tolerant of field-list and flat shapes. */
function mpNormalizeTikTokLead_(body) {
  const fields = {};
  const collect = function(node, depth) {
    if (!node || depth > 4) return;
    if (Array.isArray(node)) {
      node.forEach(function(item) {
        if (item && typeof item === 'object' && (item.name || item.field_name || item.key || item.question) && (item.value !== undefined || item.field_value !== undefined || item.values || item.answer !== undefined)) {
          const key = String(item.name || item.field_name || item.key || item.question);
          const value = item.value !== undefined ? item.value : item.field_value !== undefined ? item.field_value : item.answer !== undefined ? item.answer : (item.values || []).join(', ');
          fields[key] = String(value);
        } else collect(item, depth + 1);
      });
      return;
    }
    if (typeof node === 'object') Object.keys(node).forEach(function(key) {
      const value = node[key];
      if (value !== null && typeof value === 'object') collect(value, depth + 1);
      else if (/name|phone|mobile|email|mail|message|question|city/i.test(key)) fields[key] = String(value);
    });
  };
  collect(body, 0);
  const id = body.lead_id || body.leadId || (body.data && (body.data.lead_id || body.data.id)) || body.id || '';
  const campaign = body.campaign_name || body.ad_name || body.form_name || (body.data && (body.data.campaign_name || body.data.ad_name || body.data.form_name)) || '';
  return { type: 'lead', channel: 'TIKTOK', externalId: String(id || mpSha256Hex_(JSON.stringify(body)).slice(0, 32)), fields: fields, campaign: String(campaign), at: mpNowIso_() };
}

function mpEpochIso_(value) {
  const number = Number(value);
  if (!number) return mpNowIso_();
  const ms = number < 1e12 ? number * 1000 : number;
  return Utilities.formatDate(new Date(ms), MP_CONFIG.DATE_TIMEZONE, "yyyy-MM-dd'T'HH:mm:ssXXX");
}

/** Lead-form answers (Meta field_data or TikTok fields) -> lead fields + readable extra answers. */
function mpLeadFromFormFields_(fields) {
  const pick = function(patterns) {
    const key = Object.keys(fields).filter(function(name) { return patterns.some(function(re) { return re.test(name); }); })[0];
    return key ? { key: key, value: String(fields[key] || '').trim() } : { key: '', value: '' };
  };
  const full = pick([/^full_?name$/i, /^name$/i]);
  const first = pick([/first_?name/i]);
  const last = pick([/last_?name/i]);
  const phone = pick([/phone/i, /mobile/i, /whats/i]);
  const email = pick([/e-?mail/i]);
  const used = [full.key, first.key, last.key, phone.key, email.key];
  const extras = Object.keys(fields).filter(function(key) { return used.indexOf(key) === -1 && String(fields[key]).trim(); })
    .map(function(key) { return key.replace(/_/g, ' ') + ': ' + fields[key]; });
  return { name: full.value || [first.value, last.value].filter(Boolean).join(' '), phone: phone.value, email: email.value, extras: extras };
}

// ------------------------------------------------------------ Processing
/** Entry point from doPost (relay). Returns a short summary for the relay's log. */
function mpProcessRelay_(delivery) {
  const events = mpNormalizeRelayPayload_(delivery);
  PropertiesService.getScriptProperties().setProperty(MP_RELAY_LAST_PROPERTY_, mpNowIso_());
  const after = [];
  const summary = { received: events.length, processed: 0, ignored: 0, failed: 0 };
  events.forEach(function(event) {
    try {
      const outcome = mpWithLock_(function() { return mpProcessEventLocked_(event, after); });
      summary[outcome === 'IGNORED' ? 'ignored' : 'processed'] += 1;
    } catch (error) {
      summary.failed += 1;
      console.error('Channel event failed: ' + error.message);
      try { mpWithLock_(function() { mpRecordWebhookEvent_(event, 'FAILED', error.message); }); } catch (ignored) { /* best effort */ }
    }
  });
  // Network calls (auto-replies, notification emails) run after the lock is released.
  after.forEach(function(task) { try { task(); } catch (error) { console.warn('Follow-up action failed: ' + error.message); } });
  return summary;
}

function mpProcessEventLocked_(event, after) {
  if (event.type === 'status') return mpApplyMessageStatus_(event);
  if (event.type === 'unknown') { mpRecordWebhookEvent_(event, 'IGNORED', event.detail); return 'IGNORED'; }
  if (event.type === 'leadgen' || event.type === 'lead') return mpCaptureFormLead_(event, after);
  return mpCaptureChatMessage_(event, after);
}

function mpRecordWebhookEvent_(event, status, detail) {
  const sheet = mpSheet_('WebhookEvents');
  const record = {
    WebhookEventID: mpNewId_('WebhookEvents'), Channel: event.channel || '', ExternalEventID: String(event.externalId || ''), EventType: String(event.type || '').toUpperCase(),
    ReceivedAt: mpNowIso_(), ProcessingStatus: status, Detail: String(detail || '').slice(0, 4000)
  };
  mpAppendRecordChecked_(sheet, mpHeaders_(sheet), record);
  return record;
}

function mpWebhookEventDone_(externalId) {
  return mpRows_('WebhookEvents').records.some(function(row) { return String(row.ExternalEventID) === String(externalId) && row.ProcessingStatus === 'PROCESSED'; });
}

function mpMessageExists_(externalId) {
  return !!externalId && mpRows_('Messages').records.some(function(row) { return String(row.ExternalMessageID) === String(externalId); });
}

function mpConversationByThread_(channel, threadId) {
  return mpRows_('Conversations').records.filter(function(row) { return row.IsArchived !== true && row.Channel === channel && String(row.ExternalThreadID) === String(threadId); })[0] || null;
}

/** Name and handle for a Messenger/Instagram sender (best effort; needs the Page token). */
function mpLookupProfile_(channel, threadId) {
  try {
    if (channel === 'INSTAGRAM') { const p = mpGraph_('get', encodeURIComponent(threadId) + '?fields=name,username', null, 'META_PAGE_TOKEN'); return { name: p.name || p.username || '', handle: p.username ? 'Instagram @' + p.username : '' }; }
    if (channel === 'MESSENGER') { const p = mpGraph_('get', encodeURIComponent(threadId) + '?fields=first_name,last_name', null, 'META_PAGE_TOKEN'); const name = [p.first_name, p.last_name].filter(Boolean).join(' '); return { name: name, handle: name ? 'Messenger: ' + name : '' }; }
  } catch (error) { /* not connected or not permitted: keep the ID */ }
  return { name: '', handle: '' };
}

/** Links a new chat to an existing client or lead with the same WhatsApp number, if there is one. */
function mpMatchRecordByPhone_(phone) {
  if (!phone) return null;
  const client = mpRows_('Clients').records.filter(function(row) { return row.IsArchived !== true && mpSamePhone_(row.Phone, phone); })[0];
  if (client) return { ClientID: client.ClientID, AssignedTo: client.AssignedTo || '' };
  const lead = mpRows_('Leads').records.filter(function(row) { return row.IsArchived !== true && mpSamePhone_(row.Phone, phone); })
    .sort(function(a, b) { return String(b.CreatedAt).localeCompare(String(a.CreatedAt)); })[0];
  if (lead) return lead.ConvertedClientID ? { ClientID: lead.ConvertedClientID, AssignedTo: lead.AssignedTo || '' } : { LeadID: lead.LeadID, AssignedTo: lead.AssignedTo || '' };
  return null;
}

const MP_CHANNEL_INQUIRY_ = { WHATSAPP: 'WhatsApp chat', MESSENGER: 'Facebook message', INSTAGRAM: 'Instagram message' };

function mpCaptureChatMessage_(event, after) {
  if (mpMessageExists_(event.externalId)) return 'IGNORED';
  const isComment = event.type === 'comment';
  let conversation = mpConversationByThread_(event.channel, event.threadId);
  const isNew = !conversation;
  const quietSince = conversation ? conversation.LastInboundAt : '';
  let createdLead = null;
  if (!conversation) {
    if (event.direction === 'OUT' && !isComment) return 'IGNORED'; // an echo for a chat we never saw: nothing to link it to
    const profile = event.channel === 'WHATSAPP' || isComment ? { name: event.name || '', handle: event.handle || '' } : mpLookupProfile_(event.channel, event.threadId);
    const name = profile.name || event.name || '';
    const handle = event.channel === 'WHATSAPP' ? event.phone : (profile.handle || event.handle || (event.channel === 'INSTAGRAM' ? 'Instagram user ' : 'Messenger user ') + event.threadId);
    const link = event.channel === 'WHATSAPP' ? mpMatchRecordByPhone_(event.phone) : null;
    const record = { ConversationID: mpNewId_('Conversations'), Channel: event.channel, ExternalThreadID: String(event.threadId), ContactName: name, ContactHandle: handle,
      LeadID: '', ClientID: '', AssignedTo: '', Status: 'OPEN', LastMessageAt: '', LastInboundAt: '', LastMessagePreview: '', UnreadCount: 0,
      CreatedAt: mpNowIso_(), UpdatedAt: mpNowIso_(), IsArchived: false, ArchivedAt: '', Version: 1 };
    if (link) Object.assign(record, link);
    else {
      const actorId = mpIntakeActorId_();
      const leadInput = { FullName: name || (event.channel === 'WHATSAPP' ? 'WhatsApp ' + event.phone : handle), Source: MP_CHANNEL_SOURCES_[event.channel], Status: 'NEW', Priority: 'MEDIUM', ClientType: 'INDIVIDUAL',
        InquiryType: isComment ? (event.channel === 'INSTAGRAM' ? 'Instagram comment' : 'Facebook comment') : MP_CHANNEL_INQUIRY_[event.channel], Description: String(event.body || '').slice(0, 4000) };
      if (event.channel === 'WHATSAPP') leadInput.Phone = event.phone; else leadInput.SocialProfile = handle.slice(0, 200);
      createdLead = mpInsertRecordLocked_('Leads', leadInput, true, actorId, null);
      mpLogActivity_('Leads', createdLead.LeadID, 'CAPTURED_AUTOMATICALLY', 'Received automatically from ' + leadInput.InquiryType + '.', actorId);
      record.LeadID = createdLead.LeadID;
    }
    const sheet = mpSheet_('Conversations');
    mpAppendRecordChecked_(sheet, mpHeaders_(sheet), record);
    conversation = mpConversationByThread_(event.channel, event.threadId);
  }
  const at = event.at || mpNowIso_();
  mpAppendMessage_({ ConversationID: conversation.ConversationID, ExternalMessageID: String(event.externalId || ''), Direction: event.direction || 'IN',
    Kind: isComment ? 'COMMENT' : event.kind || 'TEXT', Body: event.body, SentBy: '', SentAt: at, Status: event.direction === 'OUT' ? 'SENT' : 'RECEIVED', Error: '' });
  mpTouchConversation_(conversation.ConversationID, event.body, at, event.direction !== 'OUT');
  if (createdLead) after.push(function() { mpNotifyNewLead_(createdLead); });
  if ((event.direction || 'IN') === 'IN' && mpShouldAutoReply_(event, isNew, quietSince)) {
    const conversationId = conversation.ConversationID;
    after.push(function() { mpSendAutoReply_(conversationId, event); });
  }
  return 'PROCESSED';
}

function mpShouldAutoReply_(event, isNew, quietSince) {
  const config = mpChannelConfig_().autoReply;
  if (!config.enabled || !mpChannelsConnected_()[event.channel]) return false;
  if (event.type === 'comment' ? !config.channels.COMMENTS : !config.channels[event.channel]) return false;
  if (isNew || !quietSince) return true;
  return Date.parse(quietSince) < Date.now() - config.quietDays * 86400000;
}

function mpLooksArabic_(text) { return /[؀-ۿ]/.test(String(text || '')); }

function mpSendAutoReply_(conversationId, event) {
  const config = mpChannelConfig_().autoReply;
  const text = mpLooksArabic_(event.body) ? (config.textAr || config.textEn) : (config.textEn || config.textAr);
  if (!text) return;
  mpWithLock_(function() { mpSendOnConversation_(conversationId, text, '', 'AUTO_REPLY', event.type === 'comment' ? event.externalId : ''); });
}

function mpAppendMessage_(message) {
  const sheet = mpSheet_('Messages');
  const record = Object.assign({ MessageID: mpNewId_('Messages'), CreatedAt: mpNowIso_() }, message);
  record.Body = String(record.Body || '').slice(0, 4000);
  record.Error = String(record.Error || '').slice(0, 500);
  mpAppendRecordChecked_(sheet, mpHeaders_(sheet), record);
  return record;
}

function mpTouchConversation_(conversationId, body, at, inbound) {
  const rows = mpRows_('Conversations');
  const record = rows.records.filter(function(row) { return row.ConversationID === conversationId; })[0];
  if (!record) return;
  record.LastMessageAt = at;
  if (body !== null) record.LastMessagePreview = String(body || '').replace(/\s+/g, ' ').slice(0, 140);
  if (inbound) { record.LastInboundAt = at; record.UnreadCount = Number(record.UnreadCount || 0) + 1; record.Status = 'OPEN'; }
  record.UpdatedAt = mpNowIso_();
  record.Version = Number(record.Version || 1) + 1;
  mpWriteRecordChecked_(rows.sheet, rows.headers, record._rowNumber, record);
}

const MP_STATUS_RANK_ = { RECEIVED: 0, SENT: 1, DELIVERED: 2, READ: 3 };

function mpApplyMessageStatus_(event) {
  const rows = mpRows_('Messages');
  const record = rows.records.filter(function(row) { return String(row.ExternalMessageID) === String(event.externalId); })[0];
  if (!record) return 'IGNORED';
  const status = event.status === 'FAILED' ? 'FAILED' : (MP_STATUS_RANK_[event.status] !== undefined ? event.status : '');
  if (!status || (status !== 'FAILED' && MP_STATUS_RANK_[status] <= (MP_STATUS_RANK_[record.Status] || 0))) return 'IGNORED';
  record.Status = status;
  if (status === 'FAILED') record.Error = String(event.error || 'Not delivered').slice(0, 500);
  mpWriteRecordChecked_(rows.sheet, rows.headers, record._rowNumber, record);
  return 'PROCESSED';
}

function mpCaptureFormLead_(event, after) {
  if (mpWebhookEventDone_(event.externalId)) return 'IGNORED';
  let fields = event.fields || {};
  let source = event.channel === 'TIKTOK' ? 'TIKTOK' : 'FACEBOOK';
  let campaign = event.campaign || '';
  if (event.type === 'leadgen') {
    // Meta sends only the lead ID; the answers are fetched with the Page token.
    const lead = mpGraph_('get', encodeURIComponent(event.externalId) + '?fields=field_data,ad_name,campaign_name,form_id,platform,created_time', null, 'META_PAGE_TOKEN');
    fields = {};
    (lead.field_data || []).forEach(function(field) { fields[field.name] = (field.values || []).join(', '); });
    if (String(lead.platform || '').toLowerCase() === 'ig') source = 'INSTAGRAM';
    campaign = lead.campaign_name || lead.ad_name || '';
  }
  const parsed = mpLeadFromFormFields_(fields);
  const inquiry = { FACEBOOK: 'Facebook lead form', INSTAGRAM: 'Instagram lead form', TIKTOK: 'TikTok lead form' }[source];
  const input = { FullName: parsed.name || inquiry, Phone: parsed.phone, Email: parsed.email, Source: source, CampaignID: String(campaign).slice(0, 120), InquiryType: inquiry,
    Status: 'NEW', Priority: 'MEDIUM', ClientType: 'INDIVIDUAL', Description: parsed.extras.join('\n').slice(0, 4000) };
  if (!input.Phone && !input.Email) input.SocialProfile = inquiry + ' ' + event.externalId;
  // A number the form did not accept is kept in the description instead of losing the lead.
  try { mpValidatePhone_(input.Phone, false); } catch (error) { input.Description = ('Phone as entered: ' + input.Phone + '\n' + input.Description).trim(); input.Phone = ''; if (!input.Email) input.SocialProfile = inquiry + ' ' + event.externalId; }
  const actorId = mpIntakeActorId_();
  const created = mpInsertRecordLocked_('Leads', input, true, actorId, null);
  mpLogActivity_('Leads', created.LeadID, 'CAPTURED_AUTOMATICALLY', 'Received automatically from ' + inquiry + (campaign ? ' (' + campaign + ')' : '') + '.', actorId);
  mpRecordWebhookEvent_(event, 'PROCESSED', inquiry + ' → ' + created.LeadID);
  after.push(function() { mpNotifyNewLead_(created); });
  return 'PROCESSED';
}

// ------------------------------------------------------------ Sending
function mpHoursSince_(iso) { return iso ? (Date.now() - Date.parse(iso)) / 3600000 : Infinity; }

/** Whether free text may be sent now, and why not. */
function mpReplyWindow_(conversation) {
  const isComment = String(conversation.ExternalThreadID).indexOf(MP_COMMENT_THREAD_PREFIX_) === 0;
  if (isComment) {
    const last = mpLastComment_(conversation.ConversationID);
    if (!last) return { open: false, reason: 'NO_COMMENT' };
    if (mpHoursSince_(last.SentAt) > MP_COMMENT_REPLY_DAYS_ * 24) return { open: false, reason: 'COMMENT_EXPIRED' };
    if (last.replied) return { open: false, reason: 'COMMENT_REPLIED' };
    return { open: true, commentId: last.ExternalMessageID };
  }
  const hours = mpHoursSince_(conversation.LastInboundAt);
  if (hours <= MP_REPLY_WINDOW_HOURS_) return { open: true, closesAt: Utilities.formatDate(new Date(Date.parse(conversation.LastInboundAt) + MP_REPLY_WINDOW_HOURS_ * 3600000), MP_CONFIG.DATE_TIMEZONE, "yyyy-MM-dd'T'HH:mm:ssXXX") };
  return { open: false, reason: conversation.Channel === 'WHATSAPP' ? 'USE_TEMPLATE' : 'WINDOW_CLOSED' };
}

/** The newest comment and whether we already replied privately to it (Meta allows one private reply per comment). */
function mpLastComment_(conversationId) {
  const messages = mpRows_('Messages').records.filter(function(row) { return row.ConversationID === conversationId; })
    .sort(function(a, b) { return String(a.SentAt).localeCompare(String(b.SentAt)); });
  let last = null;
  messages.forEach(function(row) {
    if (row.Kind === 'COMMENT' && row.Direction === 'IN') last = { ExternalMessageID: row.ExternalMessageID, SentAt: row.SentAt, replied: false };
    else if (last && row.Direction === 'OUT' && row.Status !== 'FAILED') last.replied = true;
  });
  return last;
}

/** Sends free text on a conversation and records it. Caller holds the lock. */
function mpSendOnConversation_(conversationId, text, actorId, kind, commentId) {
  const rows = mpRows_('Conversations');
  const conversation = rows.records.filter(function(row) { return row.ConversationID === conversationId && row.IsArchived !== true; })[0];
  if (!conversation) throw new Error('Conversation was not found.');
  const body = String(text || '').trim();
  if (!body) throw new Error('Write a message first.');
  if (body.length > 4000) throw new Error('Text exceeds the allowed length.');
  const window = mpReplyWindow_(conversation);
  if (!window.open) throw mpChannelError_({
    USE_TEMPLATE: 'More than 24 hours since their last message: WhatsApp only allows an approved template now.',
    WINDOW_CLOSED: 'More than 24 hours since their last message: Meta only allows a reply after they write again.',
    COMMENT_EXPIRED: 'Meta allows a private reply to a comment only within 7 days.',
    COMMENT_REPLIED: 'Meta allows one private reply per comment. Continue in their Messenger/Instagram chat once they answer.',
    NO_COMMENT: 'There is no comment to reply to.'
  }[window.reason]);
  let externalId = '';
  let status = 'SENT';
  let error = '';
  try {
    if (conversation.Channel === 'WHATSAPP') {
      const result = mpGraph_('post', mpChannelSecret_('WHATSAPP_PHONE_NUMBER_ID') + '/messages', { messaging_product: 'whatsapp', recipient_type: 'individual', to: String(conversation.ExternalThreadID), type: 'text', text: { preview_url: false, body: body } }, 'WHATSAPP_TOKEN');
      externalId = result.messages && result.messages[0] ? result.messages[0].id : '';
    } else {
      const recipient = window.commentId || commentId ? { comment_id: String(window.commentId || commentId) } : { id: String(conversation.ExternalThreadID) };
      const result = mpGraph_('post', mpChannelSecret_('META_PAGE_ID') + '/messages', { recipient: recipient, messaging_type: 'RESPONSE', message: { text: body } }, 'META_PAGE_TOKEN');
      externalId = result.message_id || '';
    }
  } catch (sendError) { status = 'FAILED'; error = sendError.message; }
  const now = mpNowIso_();
  const message = mpAppendMessage_({ ConversationID: conversationId, ExternalMessageID: externalId, Direction: 'OUT', Kind: kind || 'TEXT', Body: body, SentBy: actorId || '', SentAt: now, Status: status, Error: error });
  // The list keeps showing what the person wrote, not our automatic reply.
  mpTouchConversation_(conversationId, kind === 'AUTO_REPLY' ? null : body, now, false);
  if (status === 'FAILED') throw mpChannelError_(error);
  return mpPublicRecord_(message);
}

/** Sends an approved WhatsApp template (allowed at any time). Caller holds the lock. */
function mpSendTemplate_(conversationId, templateName, params, actorId) {
  const conversation = mpRows_('Conversations').records.filter(function(row) { return row.ConversationID === conversationId && row.IsArchived !== true; })[0];
  if (!conversation) throw new Error('Conversation was not found.');
  if (conversation.Channel !== 'WHATSAPP') throw new Error('Templates are for WhatsApp chats.');
  const template = mpChannelConfig_().templates.filter(function(item) { return item.name === templateName; })[0];
  if (!template) throw new Error('Unknown WhatsApp template. An owner adds templates in Settings → Channels.');
  const values = (Array.isArray(params) ? params : []).map(function(value) { return String(value || '').trim(); });
  if (values.length !== template.params || values.some(function(value) { return !value; })) throw new Error('Fill in all ' + template.params + ' template value(s).');
  if (values.some(function(value) { return value.length > 500 || /[\n\t]|\s{5,}/.test(value); })) throw new Error('Template values must be short, single-line text.');
  const payload = { messaging_product: 'whatsapp', to: String(conversation.ExternalThreadID), type: 'template', template: { name: template.name, language: { code: template.language } } };
  if (values.length) payload.template.components = [{ type: 'body', parameters: values.map(function(value) { return { type: 'text', text: value }; }) }];
  let externalId = ''; let status = 'SENT'; let error = '';
  try {
    const result = mpGraph_('post', mpChannelSecret_('WHATSAPP_PHONE_NUMBER_ID') + '/messages', payload, 'WHATSAPP_TOKEN');
    externalId = result.messages && result.messages[0] ? result.messages[0].id : '';
  } catch (sendError) { status = 'FAILED'; error = sendError.message; }
  const body = (template.label || template.name) + (values.length ? ': ' + values.join(' · ') : '');
  const now = mpNowIso_();
  const message = mpAppendMessage_({ ConversationID: conversationId, ExternalMessageID: externalId, Direction: 'OUT', Kind: 'TEMPLATE', Body: body, SentBy: actorId || '', SentAt: now, Status: status, Error: error });
  mpTouchConversation_(conversationId, body, now, false);
  if (status === 'FAILED') throw mpChannelError_(error);
  return mpPublicRecord_(message);
}

/** Finds or creates the WhatsApp chat for a lead's or client's phone. Caller holds the lock. */
function mpWhatsAppConversationFor_(entity, record) {
  const waId = mpWhatsAppId_(record.Phone);
  if (!waId || waId.length < 8) throw new Error('This record has no usable phone number for WhatsApp.');
  const existing = mpConversationByThread_('WHATSAPP', waId);
  if (existing) return existing;
  const conversation = { ConversationID: mpNewId_('Conversations'), Channel: 'WHATSAPP', ExternalThreadID: waId, ContactName: mpPlainText_(record.FullName || ''), ContactHandle: '+' + waId,
    LeadID: entity === 'Leads' ? record.LeadID : '', ClientID: entity === 'Clients' ? record.ClientID : '', AssignedTo: record.AssignedTo || '', Status: 'OPEN',
    LastMessageAt: '', LastInboundAt: '', LastMessagePreview: '', UnreadCount: 0, CreatedAt: mpNowIso_(), UpdatedAt: mpNowIso_(), IsArchived: false, ArchivedAt: '', Version: 1 };
  const sheet = mpSheet_('Conversations');
  mpAppendRecordChecked_(sheet, mpHeaders_(sheet), conversation);
  return mpConversationByThread_('WHATSAPP', waId);
}

// ------------------------------------------------------------ Consultation reminders (daily trigger)
function mpSendWhatsAppReminders_() {
  const config = mpChannelConfig_();
  if (!config.reminders.enabled || !mpChannelsConnected_().WHATSAPP) return { sent: 0, skipped: 0 };
  const template = config.templates.filter(function(item) { return item.name === config.reminders.template; })[0];
  if (!template) return { sent: 0, skipped: 0 };
  const tomorrow = mpAddDaysIso_(1);
  let sent = 0; let skipped = 0;
  mpRows_('Consultations').records.filter(function(row) { return row.IsArchived !== true && row.Status === 'SCHEDULED' && mpCairoDate_(row.ConsultationDate) === tomorrow; }).forEach(function(consultation) {
    try {
      if (mpListActivities_('Consultations', consultation.ConsultationID, 100).some(function(item) { return item.Action === 'WHATSAPP_REMINDER_SENT'; })) { skipped += 1; return; }
      const entity = consultation.ClientID ? 'Clients' : 'Leads';
      const person = mpDbGetById_(entity, consultation.ClientID || consultation.LeadID, false);
      if (!person || !person.Phone) { skipped += 1; return; }
      const date = Utilities.formatDate(new Date(Date.parse(consultation.ConsultationDate)), MP_CONFIG.DATE_TIMEZONE, 'yyyy-MM-dd');
      const time = Utilities.formatDate(new Date(Date.parse(consultation.ConsultationDate)), MP_CONFIG.DATE_TIMEZONE, 'HH:mm');
      const values = [mpPlainText_(person.FullName), date, time].slice(0, template.params);
      while (values.length < template.params) values.push('-');
      mpWithLock_(function() {
        const conversation = mpWhatsAppConversationFor_(entity, person);
        mpSendTemplate_(conversation.ConversationID, template.name, values, '');
        mpLogActivity_('Consultations', consultation.ConsultationID, 'WHATSAPP_REMINDER_SENT', 'WhatsApp reminder sent (' + template.name + ').', '');
      });
      sent += 1;
    } catch (error) { skipped += 1; console.warn('WhatsApp reminder not sent for ' + consultation.ConsultationID + ': ' + error.message); }
  });
  return { sent: sent, skipped: skipped };
}

// ------------------------------------------------------------ App API (Inbox)
function mpConversationInScope_(actor, conversation) {
  const scope = mpAccessScope_(actor);
  if (!scope) return true;
  return conversation.AssignedTo === actor.userId || (!!conversation.LeadID && !!scope.Leads[conversation.LeadID]) || (!!conversation.ClientID && !!scope.Clients[conversation.ClientID]);
}

function mpVisibleConversation_(actor, id) {
  mpRequirePermission_(actor, 'Conversations', 'read');
  const conversation = mpRows_('Conversations').records.filter(function(row) { return row.ConversationID === String(id || '') && row.IsArchived !== true; })[0];
  if (!conversation || !mpConversationInScope_(actor, conversation)) throw mpNotFound_();
  return conversation;
}

function mpApiListConversations_(actor, options) {
  mpRequirePermission_(actor, 'Conversations', 'read');
  options = options || {};
  const query = String(options.query || '').trim().toLowerCase();
  const rows = mpRows_('Conversations').records.filter(function(row) {
    if (row.IsArchived === true || !mpConversationInScope_(actor, row)) return false;
    if (options.status && row.Status !== options.status) return false;
    if (options.channel && row.Channel !== options.channel) return false;
    if (options.mine === true && row.AssignedTo !== actor.userId) return false;
    if (options.unread === true && !Number(row.UnreadCount)) return false;
    return !query || [row.ContactName, row.ContactHandle, row.LastMessagePreview].join(' ').toLowerCase().indexOf(query) !== -1;
  }).sort(function(a, b) { return String(b.LastMessageAt || b.CreatedAt).localeCompare(String(a.LastMessageAt || a.CreatedAt)); });
  const limit = Math.min(Number(options.limit || 100), 200);
  const records = rows.slice(0, limit).map(mpPublicRecord_);
  return { records: records, total: rows.length, unread: rows.reduce(function(sum, row) { return sum + Number(row.UnreadCount || 0); }, 0), labels: mpApiLabels_(actor, 'Conversations', records), connected: mpChannelsConnected_() };
}

function mpApiGetConversation_(actor, id) {
  const conversation = mpVisibleConversation_(actor, id);
  // Opening a chat marks it read for everyone.
  if (Number(conversation.UnreadCount || 0) > 0) {
    mpWithLock_(function() {
      const rows = mpRows_('Conversations');
      const record = rows.records.filter(function(row) { return row.ConversationID === conversation.ConversationID; })[0];
      record.UnreadCount = 0;
      record.Version = Number(record.Version || 1) + 1;
      mpWriteRecordChecked_(rows.sheet, rows.headers, record._rowNumber, record);
    });
  }
  const messages = mpRows_('Messages').records.filter(function(row) { return row.ConversationID === conversation.ConversationID; })
    .sort(function(a, b) { return String(a.SentAt).localeCompare(String(b.SentAt)); }).slice(-300).map(mpPublicRecord_);
  const record = mpDbGetById_('Conversations', conversation.ConversationID, false);
  const labels = mpApiLabels_(actor, 'Conversations', [record]);
  mpRows_('Users').records.forEach(function(user) { if (messages.some(function(m) { return m.SentBy === user.UserID; })) labels[user.UserID] = mpPlainText_(user.FullName); });
  const config = mpChannelConfig_();
  return {
    conversation: record, messages: messages, labels: labels, window: mpReplyWindow_(conversation), connected: mpChannelsConnected_(),
    templates: config.templates.map(function(t) { return { name: t.name, label: t.label, params: t.params, language: t.language }; }),
    canManage: MP_SENIOR_ROLES_.indexOf(actor.role) !== -1
  };
}

function mpApiSendMessage_(actor, id, text) {
  mpRequirePermission_(actor, 'Messages', 'create');
  mpVisibleConversation_(actor, id);
  return mpWithLock_(function() { return mpSendOnConversation_(String(id), text, actor.userId, 'TEXT', ''); });
}

function mpApiSendTemplate_(actor, id, templateName, params) {
  mpRequirePermission_(actor, 'Messages', 'create');
  mpVisibleConversation_(actor, id);
  return mpWithLock_(function() { return mpSendTemplate_(String(id), String(templateName || ''), params, actor.userId); });
}

/** Status (open/closed) for anyone who can see it; assignee and linking for owners/partners. */
function mpApiUpdateConversation_(actor, id, changes) {
  mpRequirePermission_(actor, 'Conversations', 'update');
  mpVisibleConversation_(actor, id);
  changes = changes || {};
  const allowed = MP_SENIOR_ROLES_.indexOf(actor.role) !== -1 ? ['Status', 'AssignedTo', 'LeadID', 'ClientID'] : ['Status'];
  Object.keys(changes).forEach(function(key) { if (allowed.indexOf(key) === -1) throw mpForbidden_('Only owners and partners can change ' + key + '.'); });
  return mpWithLock_(function() {
    const rows = mpRows_('Conversations');
    const record = rows.records.filter(function(row) { return row.ConversationID === String(id); })[0];
    if (mpHas_(changes, 'Status')) record.Status = mpAssertEnum_(changes.Status, MP_CONFIG.CONVERSATION_STATUSES, 'Status', true);
    if (mpHas_(changes, 'AssignedTo')) {
      record.AssignedTo = mpAssertEntityId_('Users', changes.AssignedTo, 'AssignedTo', false);
      if (record.AssignedTo && !mpDbGetById_('Users', record.AssignedTo, false)) throw new Error('AssignedTo does not reference an active User.');
    }
    ['LeadID', 'ClientID'].forEach(function(field) {
      if (!mpHas_(changes, field)) return;
      const target = field === 'LeadID' ? 'Leads' : 'Clients';
      record[field] = mpAssertEntityId_(target, changes[field], field, false);
      if (record[field] && !mpDbGetById_(target, record[field], false)) throw new Error(field + ' does not reference an active ' + target.slice(0, -1) + '.');
    });
    record.UpdatedAt = mpNowIso_();
    record.Version = Number(record.Version || 1) + 1;
    mpWriteRecordChecked_(rows.sheet, rows.headers, record._rowNumber, record);
    // Whoever answers the chat also needs the lead or client it belongs to.
    if (mpHas_(changes, 'AssignedTo') && record.AssignedTo) {
      if (record.LeadID) mpAddAssignment_('Leads', record.LeadID, record.AssignedTo, actor.userId);
      if (record.ClientID) mpAddAssignment_('Clients', record.ClientID, record.AssignedTo, actor.userId);
    }
    mpLogActivity_('Conversations', record.ConversationID, 'UPDATED', 'Updated conversation (' + Object.keys(changes).join(', ') + ').', actor.userId);
    return mpPublicRecord_(record);
  });
}

/** Opens (or starts) the WhatsApp chat with a lead or client. */
function mpApiStartWhatsApp_(actor, entity, id) {
  if (['Leads', 'Clients'].indexOf(entity) === -1) throw new Error('WhatsApp chats start from a lead or client.');
  mpRequirePermission_(actor, 'Messages', 'create');
  const record = mpApiVisibleRecord_(actor, entity, id);
  return mpWithLock_(function() { return mpPublicRecord_(mpWhatsAppConversationFor_(entity, record)); });
}

// ------------------------------------------------------------ Owner settings
function mpChannelStatus_() {
  const properties = PropertiesService.getScriptProperties();
  const key = mpRelayKey_();
  const secrets = {};
  MP_CHANNEL_SECRETS_.forEach(function(name) {
    const value = mpChannelSecret_(name);
    // IDs are shown in full; tokens only as "set" with their last 4 characters.
    secrets[name] = { set: !!value, hint: !value ? '' : /TOKEN/.test(name) ? '…' + value.slice(-4) : value };
  });
  const events = mpRows_('WebhookEvents').records.slice(-20).reverse().map(mpPublicRecord_);
  return { config: mpChannelConfig_(), secrets: secrets, connected: mpChannelsConnected_(), relayUrl: key ? mpWebAppUrl_() + '?relay=' + key : '', lastEvent: properties.getProperty(MP_RELAY_LAST_PROPERTY_) || '', events: events };
}

function mpRequireChannelAdmin_() {
  const actor = mpRequireActiveUser_();
  mpRequirePermission_(actor, 'Channels', 'update');
  return actor;
}

/** Checks a token by asking Meta who it belongs to. */
function mpTestChannel_(kind) {
  if (kind === 'WHATSAPP') { const info = mpGraph_('get', encodeURIComponent(mpChannelSecret_('WHATSAPP_PHONE_NUMBER_ID')) + '?fields=display_phone_number,verified_name', null, 'WHATSAPP_TOKEN'); return (info.verified_name || '') + ' ' + (info.display_phone_number || ''); }
  if (kind === 'PAGE') { const info = mpGraph_('get', encodeURIComponent(mpChannelSecret_('META_PAGE_ID')) + '?fields=name,instagram_business_account{username}', null, 'META_PAGE_TOKEN'); return (info.name || '') + (info.instagram_business_account ? ' · Instagram @' + info.instagram_business_account.username : ' · no Instagram account linked'); }
  throw new Error('Unknown channel.');
}

function apiGetChannelSettings() { return mpApiRespond_(function() { mpRequireChannelAdmin_(); return mpChannelStatus_(); }); }

function apiSaveChannelSettings(config) {
  return mpApiRespond_(function() {
    const actor = mpRequireChannelAdmin_();
    const clean = mpValidateChannelConfig_(config);
    PropertiesService.getScriptProperties().setProperty(MP_CHANNEL_CONFIG_PROPERTY_, JSON.stringify(clean));
    mpLogAccess_('CHANNELS_UPDATED', '', actor.userId, 'Channel settings saved (auto-reply ' + (clean.autoReply.enabled ? 'on' : 'off') + ', reminders ' + (clean.reminders.enabled ? 'on' : 'off') + ').');
    return mpChannelStatus_();
  });
}

function apiSetChannelSecret(name, value) {
  return mpApiRespond_(function() {
    const actor = mpRequireChannelAdmin_();
    if (MP_CHANNEL_SECRETS_.indexOf(name) === -1) throw new Error('Unknown setting.');
    const clean = String(value || '').trim();
    if (clean.length > 1000 || /\s/.test(clean)) throw new Error('That does not look like a valid value.');
    if (/_ID$/.test(name) && clean && !/^\d{5,30}$/.test(clean)) throw new Error('IDs are numbers only.');
    const properties = PropertiesService.getScriptProperties();
    if (clean) properties.setProperty(MP_CHANNEL_SECRET_PREFIX_ + name, clean); else properties.deleteProperty(MP_CHANNEL_SECRET_PREFIX_ + name);
    mpLogAccess_('CHANNEL_SECRET_CHANGED', '', actor.userId, name + (clean ? ' was set.' : ' was removed.'));
    return mpChannelStatus_();
  });
}

function apiRotateRelayKey() {
  return mpApiRespond_(function() {
    const actor = mpRequireChannelAdmin_();
    PropertiesService.getScriptProperties().setProperty(MP_RELAY_KEY_PROPERTY_, mpRandomHex_());
    mpLogAccess_('RELAY_KEY_ISSUED', '', actor.userId, 'A new relay link was issued; the previous one stopped working.');
    return mpChannelStatus_();
  });
}

function apiTestChannel(kind) { return mpApiRespond_(function() { mpRequireChannelAdmin_(); return { ok: true, name: mpTestChannel_(kind) }; }); }

/** Re-runs a failed lead-form event (e.g. after the Page token was added). */
function apiRetryWebhookEvent(id) {
  return mpApiRespond_(function() {
    mpRequireChannelAdmin_();
    const row = mpRows_('WebhookEvents').records.filter(function(item) { return item.WebhookEventID === String(id || ''); })[0];
    if (!row || row.ProcessingStatus !== 'FAILED' || row.EventType !== 'LEADGEN') throw new Error('Only failed lead-form events can be retried.');
    const summary = { processed: 0 };
    const after = [];
    mpWithLock_(function() { if (mpCaptureFormLead_({ type: 'leadgen', channel: row.Channel, externalId: String(row.ExternalEventID) }, after) === 'PROCESSED') summary.processed = 1; });
    after.forEach(function(task) { try { task(); } catch (error) { /* notification only */ } });
    return mpChannelStatus_();
  });
}

// ------------------------------------------------------------ Inbox entry points
function apiListConversations(options) { return mpApiRespond_(function() { return mpApiListConversations_(mpRequireActiveUser_(), options); }); }
function apiGetConversation(id) { return mpApiRespond_(function() { return mpApiGetConversation_(mpRequireActiveUser_(), id); }); }
function apiSendMessage(id, text) { return mpApiRespond_(function() { return mpApiSendMessage_(mpRequireActiveUser_(), id, text); }); }
function apiSendTemplate(id, name, params) { return mpApiRespond_(function() { return mpApiSendTemplate_(mpRequireActiveUser_(), id, name, params); }); }
function apiUpdateConversation(id, changes) { return mpApiRespond_(function() { return mpApiUpdateConversation_(mpRequireActiveUser_(), id, changes); }); }
function apiStartWhatsApp(entity, id) { return mpApiRespond_(function() { return mpApiStartWhatsApp_(mpRequireActiveUser_(), entity, id); }); }
