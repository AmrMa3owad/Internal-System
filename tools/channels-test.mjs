#!/usr/bin/env node
/**
 * End-to-end test of messaging automation, locally:
 *   signed Meta / TikTok webhook -> relay/worker.js -> doPost -> Channels.gs
 *   -> leads, conversations, messages, auto-replies, Inbox API, reminders.
 * Meta's Graph API is the stand-in from apps-script-runtime.js (runtime.graph).
 *
 * Usage: node tools/channels-test.mjs
 */
import { createRequire } from 'node:module';
import crypto from 'node:crypto';
import worker from '../relay/worker.js';

const require = createRequire(import.meta.url);
const { createRuntime } = require('./apps-script-runtime.js');
const runtime = createRuntime({ ownerEmail: 'owner@example.test', verbose: !!process.env.VERBOSE });
const fn = runtime.fn;
const OWNER = runtime.ownerEmail;
const LAWYER = 'lawyer.inbox@example.test';
const ASSISTANT = 'assistant.inbox@example.test';

let failures = 0;
function check(name, ok, detail) {
  if (!ok) failures += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok || detail === undefined ? '' : '  -> ' + (typeof detail === 'string' ? detail : JSON.stringify(detail))}`);
}
function as(email, name, ...args) { runtime.setActiveEmail(email); fn('mpResetExecutionCaches_')(); return fn(name)(...args); }
const must = (r, label) => { if (!r || r.ok !== true) throw new Error(label + ': ' + JSON.stringify(r && r.error)); return r.data; };

// ------------------------------------------------------------ Setup
must(fn('installMohamyPlus')(), 'install');
const lawyer = must(as(OWNER, 'apiCreate', 'Users', { FullName: 'Inbox Lawyer', Email: LAWYER, Role: 'LAWYER' }), 'lawyer');
must(as(OWNER, 'apiCreate', 'Users', { FullName: 'Inbox Assistant', Email: ASSISTANT, Role: 'ASSISTANT' }), 'assistant');
const existingClient = must(as(OWNER, 'apiCreate', 'Clients', { FullName: 'Hoda Kamal', Phone: '01005551234', ClientType: 'INDIVIDUAL' }), 'client');

// Owner connects channels and turns on the automation.
for (const [name, value] of [['WHATSAPP_TOKEN', 'EAAwhatsapp-token-1234'], ['WHATSAPP_PHONE_NUMBER_ID', '1098765432'], ['META_PAGE_TOKEN', 'EAApage-token-5678'], ['META_PAGE_ID', '5550001']]) {
  must(as(OWNER, 'apiSetChannelSecret', name, value), 'secret ' + name);
}
const settings = must(as(OWNER, 'apiGetChannelSettings'), 'settings');
check('settings: tokens are write-only (only the last 4 characters are shown)', settings.secrets.WHATSAPP_TOKEN.set && settings.secrets.WHATSAPP_TOKEN.hint === '…1234' && JSON.stringify(settings).indexOf('EAAwhatsapp') === -1);
check('settings: staff cannot read or change channel settings', as(LAWYER, 'apiGetChannelSettings').ok === false && as(ASSISTANT, 'apiSetChannelSecret', 'META_PAGE_ID', '1').ok === false);
const config = settings.config;
config.autoReply.enabled = true;
config.templates = [{ name: 'consultation_reminder', language: 'ar', label: 'Consultation reminder', params: 3 }, { name: 'payment_reminder', language: 'ar', label: 'Payment reminder', params: 2 }];
config.reminders = { enabled: true, template: 'consultation_reminder', language: 'ar' };
must(as(OWNER, 'apiSaveChannelSettings', config), 'save config');
const relay = must(as(OWNER, 'apiRotateRelayKey'), 'relay');
check('settings: owner gets a private relay link', /\?relay=[a-f0-9]{64}$/.test(relay.relayUrl), relay.relayUrl);

// ------------------------------------------------------------ Relay wiring
const env = { CRM_RELAY_URL: relay.relayUrl, META_APP_SECRET: 'meta-app-secret', META_VERIFY_TOKEN: 'verify-me-please', TIKTOK_TOKEN: 'tiktok-token-xyz' };
let crmCalls = 0;
globalThis.fetch = async (url, init) => {
  // The worker forwards to the CRM: hand it to the Apps Script doPost.
  const target = new URL(url);
  const parameter = Object.fromEntries(target.searchParams);
  crmCalls += 1;
  runtime.setActiveEmail('');
  fn('mpResetExecutionCaches_')();
  const out = fn('doPost')({ parameter, postData: { type: 'application/json', contents: init.body } });
  return new Response(out.getContent(), { status: 200, headers: { 'content-type': 'application/json' } });
};
const sign = (raw, secret = env.META_APP_SECRET) => 'sha256=' + crypto.createHmac('sha256', secret).update(raw).digest('hex');
async function meta(body, signature) {
  const raw = JSON.stringify(body);
  const response = await worker.fetch(new Request('https://relay.example/meta', { method: 'POST', body: raw, headers: { 'x-hub-signature-256': signature || sign(raw) } }), env);
  return { status: response.status, text: await response.text() };
}
const graphCalls = (predicate) => runtime.graph.calls.filter(predicate);
const sentTexts = () => graphCalls((c) => c.method === 'post').map((c) => (c.payload.text && c.payload.text.body) || (c.payload.message && c.payload.message.text) || (c.payload.template && 'TEMPLATE:' + c.payload.template.name));
const leadBy = (query) => (as(OWNER, 'apiListView', 'Leads', { query }).data || { records: [] }).records;
const conversations = (email, options = {}) => as(email, 'apiListConversations', options);
const now = () => Math.floor(Date.now() / 1000);

const verifyOk = await worker.fetch(new Request('https://relay.example/meta?hub.mode=subscribe&hub.verify_token=verify-me-please&hub.challenge=12345'), env);
const verifyBad = await worker.fetch(new Request('https://relay.example/meta?hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=12345'), env);
check('relay: answers Meta\'s verification only with the right verify token', verifyOk.status === 200 && (await verifyOk.text()) === '12345' && verifyBad.status === 403);

const waMessage = (from, id, text, name) => ({ object: 'whatsapp_business_account', entry: [{ id: 'WABA', changes: [{ field: 'messages', value: {
  messaging_product: 'whatsapp', metadata: { phone_number_id: '1098765432' }, contacts: [{ wa_id: from, profile: { name } }],
  messages: [{ from, id, timestamp: String(now()), type: 'text', text: { body: text } }] } }] }] });

const before = crmCalls;
const forged = await meta(waMessage('201001112222', 'wamid.FORGED', 'fake', 'Forger'), 'sha256=' + '0'.repeat(64));
check('relay: a forged signature is refused and never reaches the CRM', forged.status === 403 && crmCalls === before);

// ------------------------------------------------------------ WhatsApp
const mailsBefore = runtime.outbox.length;
const first = await meta(waMessage('201001112222', 'wamid.A1', 'السلام عليكم، عندي مشكلة في عقد إيجار', 'Mostafa Ali'));
const waLead = leadBy('Mostafa Ali')[0];
let ownerInbox = conversations(OWNER).data;
const waChat = ownerInbox.records.find((c) => c.Channel === 'WHATSAPP' && c.ExternalThreadID === '201001112222');
check('whatsapp: a new number becomes a NEW lead (source WhatsApp, phone, first message)', first.status === 200 && !!waLead && waLead.Source === 'WHATSAPP' && waLead.Phone === '+201001112222' && waLead.InquiryType === 'WhatsApp chat' && /عقد إيجار/.test(waLead.Description), waLead);
check('whatsapp: the chat is in the Inbox, linked to the lead, unread', !!waChat && waChat.LeadID === waLead.LeadID && waChat.UnreadCount === 1 && waChat.Status === 'OPEN', waChat);
check('whatsapp: the instant auto-reply goes out in Arabic for an Arabic message', sentTexts().some((t) => /شكرًا لتواصلك/.test(t || '')), sentTexts());
check('whatsapp: owners and partners are emailed about the new lead', runtime.outbox.slice(mailsBefore).some((m) => /New lead: Mostafa Ali/.test(m.subject)));
const callsBefore = runtime.graph.calls.length;
await meta(waMessage('201001112222', 'wamid.A1', 'السلام عليكم، عندي مشكلة في عقد إيجار', 'Mostafa Ali'));
await meta(waMessage('201001112222', 'wamid.A2', 'Hello again', 'Mostafa Ali'));
ownerInbox = conversations(OWNER).data;
check('whatsapp: Meta retries are saved once; a second message does not trigger another auto-reply', leadBy('Mostafa Ali').length === 1 && ownerInbox.records.find((c) => c.ConversationID === waChat.ConversationID).UnreadCount === 2 && runtime.graph.calls.length === callsBefore);

await meta(waMessage('201005551234', 'wamid.B1', 'Any update on my case?', 'Hoda'));
const hodaChat = conversations(OWNER).data.records.find((c) => c.ExternalThreadID === '201005551234');
check('whatsapp: a known client (saved as 0100…) is recognised; no new lead', !!hodaChat && hodaChat.ClientID === existingClient.ClientID && !hodaChat.LeadID && leadBy('Hoda').length === 0, hodaChat);

const injected = await meta(waMessage('201007778888', 'wamid.C1', '=HYPERLINK("http://evil.example","click")', 'Formula Person'));
const injectedChat = conversations(OWNER).data.records.find((c) => c.ExternalThreadID === '201007778888');
const injectedThread = as(OWNER, 'apiGetConversation', injectedChat.ConversationID).data;
check('safety: a message that looks like a spreadsheet formula is stored as plain text', injected.status === 200 && injectedThread.messages[0].Body.indexOf('=HYPERLINK') === 0
  // What is written to the sheet starts with an apostrophe, which Sheets keeps as text (never a formula).
  && fn('mpRecordValues_')(['Body'], { Body: '=HYPERLINK("x")' })[0] === "'=HYPERLINK(\"x\")");

// Status updates for a message we sent.
const outgoing = as(OWNER, 'apiGetConversation', waChat.ConversationID).data.messages.find((m) => m.Direction === 'OUT');
await meta({ object: 'whatsapp_business_account', entry: [{ changes: [{ field: 'messages', value: { statuses: [{ id: outgoing.ExternalMessageID, status: 'delivered' }, { id: outgoing.ExternalMessageID, status: 'read' }] } }] }] });
await meta({ object: 'whatsapp_business_account', entry: [{ changes: [{ field: 'messages', value: { statuses: [{ id: outgoing.ExternalMessageID, status: 'delivered' }] } }] }] });
check('whatsapp: delivered/read ticks update (and never go backwards)', as(OWNER, 'apiGetConversation', waChat.ConversationID).data.messages.find((m) => m.MessageID === outgoing.MessageID).Status === 'READ');

// ------------------------------------------------------------ Messenger, Instagram, comments
runtime.graph.profiles['PSID-777'] = { first_name: 'Rania', last_name: 'Fouad' };
await meta({ object: 'page', entry: [{ id: '5550001', time: Date.now(), messaging: [{ sender: { id: 'PSID-777' }, recipient: { id: '5550001' }, timestamp: Date.now(), message: { mid: 'm_msgr1', text: 'Hi, I need a divorce lawyer' } }] }] });
const rania = leadBy('Rania Fouad')[0];
check('messenger: a new message becomes a lead with the person\'s name and a social profile (no phone needed)', !!rania && rania.Source === 'FACEBOOK' && rania.SocialProfile === 'Messenger: Rania Fouad' && !rania.Phone, rania);
await meta({ object: 'page', entry: [{ id: '5550001', time: Date.now(), messaging: [{ sender: { id: '5550001' }, recipient: { id: 'PSID-777' }, timestamp: Date.now(), message: { mid: 'm_echo1', text: 'Replied from Meta Business Suite', is_echo: true } }] }] });
const raniaChat = conversations(OWNER).data.records.find((c) => c.ExternalThreadID === 'PSID-777');
const raniaThread = as(OWNER, 'apiGetConversation', raniaChat.ConversationID).data;
check('messenger: replies typed in Meta Business Suite also appear in the Inbox', raniaThread.messages.some((m) => m.Direction === 'OUT' && m.Body === 'Replied from Meta Business Suite'));

runtime.graph.profiles['IGSID-42'] = { name: 'Youssef Adel', username: 'youssef.adel' };
await meta({ object: 'instagram', entry: [{ id: 'IG-ME', time: Date.now(), messaging: [{ sender: { id: 'IGSID-42' }, recipient: { id: 'IG-ME' }, timestamp: Date.now(), message: { mid: 'ig_m1', text: 'How much is a consultation?' } }] }] });
const youssef = leadBy('Youssef Adel')[0];
check('instagram: a direct message becomes a lead (source Instagram, @handle)', !!youssef && youssef.Source === 'INSTAGRAM' && youssef.SocialProfile === 'Instagram @youssef.adel', youssef);

await meta({ object: 'page', entry: [{ id: '5550001', time: Date.now(), changes: [{ field: 'feed', value: { item: 'comment', verb: 'add', comment_id: 'C_1', post_id: 'P_1', message: 'How can I contact you?', from: { id: 'U-9', name: 'Karim Said' }, created_time: now() } }] }] });
await meta({ object: 'page', entry: [{ id: '5550001', time: Date.now(), changes: [{ field: 'feed', value: { item: 'comment', verb: 'add', comment_id: 'C_OWN', post_id: 'P_1', message: 'Our own comment', from: { id: '5550001', name: 'Mohamy Plus' }, created_time: now() } }] }] });
const karimChat = conversations(OWNER).data.records.find((c) => c.ContactName === 'Karim Said');
check('comments: a Facebook comment becomes a lead and a chat; the page\'s own comments are ignored', !!karimChat && !!leadBy('Karim Said')[0] && leadBy('Mohamy Plus').length === 0 && !sentTexts().some((t) => false));
const privateReply = as(OWNER, 'apiSendMessage', karimChat.ConversationID, 'Hi Karim, we sent you the details privately.');
const replyCall = graphCalls((c) => c.method === 'post' && c.payload.recipient && c.payload.recipient.comment_id === 'C_1');
const secondReply = as(OWNER, 'apiSendMessage', karimChat.ConversationID, 'One more?');
check('comments: staff send one private reply to the comment (Meta\'s rule), a second is refused', privateReply.ok && replyCall.length === 1 && secondReply.ok === false && /one private reply/.test(secondReply.error.message), secondReply.error);

// ------------------------------------------------------------ Lead-ad forms (Facebook, Instagram, TikTok)
runtime.graph.leads['LG-1'] = { field_data: [{ name: 'full_name', values: ['Nour Hassan'] }, { name: 'phone_number', values: ['+201112223344'] }, { name: 'email', values: ['nour@example.com'] }, { name: 'what_do_you_need_help_with?', values: ['Company registration'] }], campaign_name: 'Corporate Nov', platform: 'ig' };
const leadgen = { object: 'page', entry: [{ id: '5550001', time: now(), changes: [{ field: 'leadgen', value: { leadgen_id: 'LG-1', page_id: '5550001', form_id: 'F1', created_time: now() } }] }] };
await meta(leadgen); await meta(leadgen);
const nour = leadBy('Nour Hassan');
check('lead ads: the form answers are fetched and saved (Instagram ad, campaign, extra answers); a repeat is ignored', nour.length === 1 && nour[0].Source === 'INSTAGRAM' && nour[0].CampaignID === 'Corporate Nov' && nour[0].Phone === '+201112223344' && /Company registration/.test(nour[0].Description), nour);

// Without the Page token the lead is kept as a failed event and can be retried.
must(as(OWNER, 'apiSetChannelSecret', 'META_PAGE_TOKEN', ''), 'remove token');
runtime.graph.leads['LG-2'] = { field_data: [{ name: 'full_name', values: ['Late Lead'] }, { name: 'phone_number', values: ['01223334455'] }], campaign_name: 'Family Dec' };
await meta({ object: 'page', entry: [{ id: '5550001', changes: [{ field: 'leadgen', value: { leadgen_id: 'LG-2' } }] }] });
let failed = must(as(OWNER, 'apiGetChannelSettings'), 'status').events.find((e) => e.ExternalEventID === 'LG-2' && e.ProcessingStatus === 'FAILED');
must(as(OWNER, 'apiSetChannelSecret', 'META_PAGE_TOKEN', 'EAApage-token-5678'), 'restore token');
const retried = as(OWNER, 'apiRetryWebhookEvent', failed && failed.WebhookEventID);
check('lead ads: a form that could not be fetched is logged and saved later with Retry', !!failed && retried.ok && leadBy('Late Lead').length === 1, retried.error);

const tiktokBody = { lead_id: 'TT-9', campaign_name: 'TikTok Labour', data: { fields: [{ name: 'name', value: 'Omar Tarek' }, { name: 'phone_number', value: '+201066677788' }, { name: 'city', value: 'Giza' }] } };
const tiktokBad = await worker.fetch(new Request('https://relay.example/tiktok?token=wrong', { method: 'POST', body: JSON.stringify(tiktokBody) }), env);
const tiktokOk = await worker.fetch(new Request('https://relay.example/tiktok?token=tiktok-token-xyz', { method: 'POST', body: JSON.stringify(tiktokBody) }), env);
const omar = leadBy('Omar Tarek')[0];
check('tiktok: lead forms with the right token become leads (source TikTok, campaign, answers)', tiktokBad.status === 403 && tiktokOk.status === 200 && !!omar && omar.Source === 'TIKTOK' && omar.CampaignID === 'TikTok Labour' && /Giza/.test(omar.Description), omar);

// ------------------------------------------------------------ Inbox: access, replies, 24-hour window, templates
check('inbox: a lawyer sees no chats that are not theirs', conversations(LAWYER).data.records.length === 0);
const assign = as(OWNER, 'apiUpdateConversation', waChat.ConversationID, { AssignedTo: lawyer.UserID });
check('inbox: only owners/partners reassign chats', assign.ok && as(LAWYER, 'apiUpdateConversation', waChat.ConversationID, { AssignedTo: '' }).ok === false);
const lawyerInbox = conversations(LAWYER).data;
check('inbox: the assigned lawyer now sees the chat (and only it)', lawyerInbox.records.length === 1 && lawyerInbox.records[0].ConversationID === waChat.ConversationID);
check('inbox: assigning a chat also gives the lawyer its lead', as(LAWYER, 'apiGet', 'Leads', waLead.LeadID).ok === true);
const reply = as(LAWYER, 'apiSendMessage', waChat.ConversationID, 'Please send a photo of the contract.');
const lastCall = runtime.graph.calls[runtime.graph.calls.length - 1];
check('inbox: the lawyer replies on WhatsApp from the CRM', reply.ok && lastCall.payload.to === '201001112222' && lastCall.payload.text.body === 'Please send a photo of the contract.' && lastCall.auth === 'Bearer EAAwhatsapp-token-1234');
const opened = as(LAWYER, 'apiGetConversation', waChat.ConversationID).data;
check('inbox: opening a chat marks it read', conversations(LAWYER).data.records[0].UnreadCount === 0 && opened.window.open === true);

const ageChat = (id, hours) => fn('mpWithLock_')(() => {
  const rows = fn('mpRows_')('Conversations');
  const row = rows.records.find((r) => r.ConversationID === id);
  row.LastInboundAt = new Date(Date.now() - hours * 3600000).toISOString();
  fn('mpWriteRecordChecked_')(rows.sheet, rows.headers, row._rowNumber, row);
});
ageChat(waChat.ConversationID, 30);
const late = as(LAWYER, 'apiSendMessage', waChat.ConversationID, 'Are you there?');
const template = as(LAWYER, 'apiSendTemplate', waChat.ConversationID, 'payment_reminder', ['Mostafa', '1,500 EGP']);
const tCall = runtime.graph.calls[runtime.graph.calls.length - 1];
check('inbox: after 24 hours WhatsApp free text is blocked and an approved template is used instead', late.ok === false && /template/.test(late.error.message) && template.ok && tCall.payload.type === 'template' && tCall.payload.template.name === 'payment_reminder' && tCall.payload.template.components[0].parameters[1].text === '1,500 EGP', late.error);
check('inbox: templates need every value filled in', as(LAWYER, 'apiSendTemplate', waChat.ConversationID, 'payment_reminder', ['Only one']).ok === false);
ageChat(raniaChat.ConversationID, 30);
check('inbox: Messenger replies are blocked after 24 hours (Meta\'s rule)', as(OWNER, 'apiSendMessage', raniaChat.ConversationID, 'Hello?').ok === false);
runtime.graph.fail = 'Message failed to send because the user is unreachable.';
ageChat(hodaChat.ConversationID, 1);
const failedSend = as(OWNER, 'apiSendMessage', hodaChat.ConversationID, 'We filed the papers today.');
runtime.graph.fail = '';
const hodaThread = as(OWNER, 'apiGetConversation', hodaChat.ConversationID).data;
check('inbox: a message Meta refuses is shown as failed with the reason', failedSend.ok === false && hodaThread.messages.some((m) => m.Status === 'FAILED' && /unreachable/.test(m.Error)));

// Start a WhatsApp chat from a client's page.
const started = as(OWNER, 'apiStartWhatsApp', 'Clients', existingClient.ClientID);
check('inbox: "WhatsApp" on a client opens their existing chat instead of a duplicate', started.ok && started.data.ConversationID === hodaChat.ConversationID);
const client2 = must(as(OWNER, 'apiCreate', 'Clients', { FullName: 'Sara Mahmoud', Phone: '+20 122 000 1111' }), 'client2');
const fresh = as(OWNER, 'apiStartWhatsApp', 'Clients', client2.ClientID);
check('inbox: a client without a chat gets a new WhatsApp chat (template first)', fresh.ok && fresh.data.ExternalThreadID === '201220001111' && fresh.data.ClientID === client2.ClientID && as(OWNER, 'apiGetConversation', fresh.data.ConversationID).data.window.reason === 'USE_TEMPLATE');
const detail = as(OWNER, 'apiGetDetail', 'Clients', existingClient.ClientID).data;
check('inbox: chats are listed on the client\'s page', detail.related.Conversations && detail.related.Conversations.total === 1);
const dash = as(OWNER, 'apiGetDashboard').data;
check('inbox: the home page knows how many messages are unread', dash.sections.inbox && dash.sections.inbox.unread >= 1, dash.sections.inbox);

// ------------------------------------------------------------ Consultation reminders
const tomorrow = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Cairo' }).format(new Date(Date.now() + 86400000));
must(as(OWNER, 'apiCreate', 'Consultations', { ClientID: client2.ClientID, ConsultationDate: tomorrow + 'T11:30', Duration: 30, Fee: 0 }), 'consultation');
const remindersBefore = graphCalls((c) => c.payload && c.payload.type === 'template' && c.payload.template.name === 'consultation_reminder').length;
runtime.setActiveEmail(OWNER);
const run1 = fn('mpSendWhatsAppReminders_')();
const run2 = fn('mpSendWhatsAppReminders_')();
const reminderCalls = graphCalls((c) => c.payload && c.payload.type === 'template' && c.payload.template.name === 'consultation_reminder');
const params = reminderCalls.length ? reminderCalls[reminderCalls.length - 1].payload.template.components[0].parameters.map((p) => p.text) : [];
check('reminders: tomorrow\'s consultation gets one WhatsApp template reminder (name, date, time), never twice', run1.sent === 1 && run2.sent === 0 && reminderCalls.length - remindersBefore === 1 && params[0] === 'Sara Mahmoud' && params[1] === tomorrow && params[2] === '11:30', { run1, run2, params });

// ------------------------------------------------------------ Relay key rotation and CRM failures
const rotated = must(as(OWNER, 'apiRotateRelayKey'), 'rotate');
const stale = await meta(waMessage('201009990000', 'wamid.Z1', 'after rotation', 'Stale'));
env.CRM_RELAY_URL = rotated.relayUrl;
const freshRelay = await meta(waMessage('201009990000', 'wamid.Z1', 'after rotation', 'Stale'));
check('relay: with an old link the CRM refuses and the relay asks Meta to retry (500); with the new link it is saved', stale.status === 500 && freshRelay.status === 200 && leadBy('Stale').length === 1);
const generic = as(OWNER, 'apiCreate', 'Conversations', { Channel: 'WHATSAPP' });
check('safety: chats cannot be created or edited through the generic record API', generic.ok === false);

console.log(failures ? `\n${failures} failure(s).` : '\nAll channel checks passed.');
process.exit(failures ? 1 : 0);
