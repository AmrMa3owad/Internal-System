# Connecting WhatsApp, Facebook, Instagram, and TikTok

This guide connects Mohamy Plus to your messaging channels so that:

- every WhatsApp chat, Messenger and Instagram message, comment, and lead-ad form becomes a **lead** (or joins the existing client) automatically;
- the first message gets an **instant auto-reply** in Arabic or English;
- your team reads and answers every chat in the CRM **Inbox**;
- clients get a **WhatsApp reminder** the day before their consultation.

Plan about two hours for the first setup, plus Meta's own review and verification time, which can take a few days.

Meta renames its menus often. If a button below has a slightly different name, look for the closest match.

```
WhatsApp / Messenger / Instagram / Lead ads ──► Meta ──┐
TikTok lead forms ─────────────────────────────────────┤  webhooks
                                                        ▼
                    Cloudflare relay (free): checks the signature
                                                        │
                                                        ▼
               Mohamy Plus (Apps Script) ──► Leads · Inbox · auto-reply
               Mohamy Plus ──────────────────────► Meta: replies, templates, reminders
```

**Why the relay is needed:** Meta signs every delivery so that nobody can send fake messages to your CRM. Google Apps Script cannot read that signature, so a tiny free Cloudflare Worker checks it and passes on only genuine deliveries. The relay holds no customer data; it only checks and forwards.

---

## Step 0: Check what you have today

1. **WhatsApp:** open WhatsApp on the firm's phone.
   - If it shows **WhatsApp Business** with a shop icon, you use the *WhatsApp Business app*.
   - To connect the CRM, the number must also be connected to the **WhatsApp Business Platform (Cloud API)**.
   - Meta lets many Business-app numbers keep working in the app at the same time ("coexistence"), so you can still answer on the phone. If your number is not eligible, use a second number for the API.
2. **Meta Business:** go to **business.facebook.com**.
   - If you see a business portfolio with your Facebook Page, it exists.
   - If not, Step 1 creates one.
3. **Instagram:** the account must be a **Professional (Business)** account, linked to the Facebook Page. Check this in Instagram → Settings → Account type and tools.

## Step 1: Business portfolio, Page, and Instagram

1. At **business.facebook.com**, create a business portfolio for *Mohamy Plus*, if you don't have one.
2. Go to **Settings → Accounts → Pages** and add your Facebook Page.
3. Go to **Settings → Accounts → Instagram accounts** and add your Instagram account. Link it to the Page.
4. Start **Business verification** (Settings → Security center). Meta asks for the firm's documents. Verification unlocks higher WhatsApp limits and App Review.

## Step 2: Create the Meta app

1. At **developers.facebook.com**, go to **My Apps → Create app**, choose the **Business** type, and connect it to your business portfolio.
2. Add these products: **WhatsApp**, **Messenger**, **Instagram** (messaging), and **Webhooks**.
3. In **App settings → Basic**, copy the **App secret**. You'll need it in Step 4.

## Step 3: WhatsApp number and token

1. **Add your number:** in the app, go to **WhatsApp → API Setup** (or **WhatsApp Manager → Phone numbers**). Add your business number and verify it with the code Meta sends.
2. **Copy the Phone number ID:** it's a long number shown next to your phone number, not the phone number itself.
3. **Create a permanent token.** Temporary tokens expire after 24 hours, so don't use those.
   1. In **Business settings → Users → System users**, add a system user with the **Admin** role.
   2. Go to **Assign assets**. Give it your **app**, your **WhatsApp account**, and your **Facebook Page** (full control).
   3. Choose **Generate new token**, select your app, set the expiry to **Never**, and tick the permissions:

      `whatsapp_business_messaging`, `whatsapp_business_management`, `pages_messaging`, `pages_manage_metadata`, `pages_read_engagement`, `pages_show_list`, `pages_read_user_content`, `pages_manage_engagement`, `instagram_basic`, `instagram_manage_messages`, `instagram_manage_comments`, `leads_retrieval`, `business_management`
   4. Copy the token. Treat it like a password.
4. **Payment:** add a payment method in **WhatsApp Manager**.
   - Replies within 24 hours of a customer's message are free or very cheap.
   - Template messages, such as reminders, are charged per message at Meta's rate for Egypt.

## Step 4: Deploy the relay (Cloudflare, free)

1. Create a free account at **dash.cloudflare.com**.
2. Go to **Workers & Pages → Create → Create Worker**. Name it `mohamy-plus-relay` and choose **Deploy**.
3. Choose **Edit code**, delete the sample, paste the whole of `relay/worker.js` from this project, and choose **Deploy**.
4. Get the CRM's relay link: in the CRM, go to **Settings → Channels → Relay link → Create relay link**, then **Copy link**.
5. In the Worker, open **Settings → Variables and Secrets** and add these as **Secret** values:

   | Name | Value |
   |---|---|
   | `CRM_RELAY_URL` | the relay link from the CRM (step 4 above) |
   | `META_APP_SECRET` | the App secret from Step 2 |
   | `META_VERIFY_TOKEN` | make up a long random phrase, e.g. `mp-verify-7f3k-29xq-…` |
   | `TIKTOK_TOKEN` | another long random phrase (only if you use TikTok lead forms) |

6. Your relay address is shown on the Worker page, like `https://mohamy-plus-relay.<your-name>.workers.dev`. Open `…workers.dev/health` in a browser. It should say `ok`.

## Step 5: Point Meta's webhooks at the relay

Use the same **Callback URL** everywhere: `https://mohamy-plus-relay.<your-name>.workers.dev/meta`. The **Verify token** is your `META_VERIFY_TOKEN`.

1. **WhatsApp:**
   1. Go to **WhatsApp → Configuration → Webhook → Edit**, enter the URL and the token, and choose **Verify and save**.
   2. Subscribe to **messages**.
   3. If you use the Business app on the same number, also subscribe to **smb_message_echoes**, so replies typed on the phone appear in the Inbox.
2. **Messenger:**
   1. Go to **Messenger → Settings → Webhooks** and enter the same URL and token.
   2. Under your Page, subscribe to **messages, message_echoes, messaging_postbacks, feed, leadgen**.
3. **Instagram:** go to **Instagram → Webhooks** (or Messenger → Instagram settings) and subscribe to **messages** and **comments**.
4. **Allow the CRM to receive lead-ad forms:** go to **Business settings → Integrations → Leads access**, select your Page, and allow your app.
5. **Go live:**
   1. Switch the app from **Development** to **Live** (top of the app dashboard).
   2. Submit **App Review** for `pages_messaging`, `instagram_manage_messages`, `instagram_manage_comments`, and `leads_retrieval`, asking for advanced access. Explain: "Our law firm's CRM receives and answers our own customers' messages and lead forms".
   3. Until approved, Meta only delivers messages from people who have a role on the app, which is enough for testing.

## Step 6: Connect the CRM

In the CRM, go to **Settings → Channels**:

1. **Fill in the connections:**
   - **WhatsApp phone number ID** and **WhatsApp access token**, from Step 3.
   - **Facebook Page ID**: Page → About → Page transparency, or in Business settings.
   - **Facebook Page access token**: the same system-user token works, because the Page is assigned to it.
2. **Test them:** press **Test WhatsApp** and **Test Facebook/Instagram**. Each should show your business name, and the Instagram account if one is linked.
3. **Auto-reply:** switch it on and choose which channels get it. Edit the Arabic and English texts if you like. Private replies to comments are off by default; turn them on if you want commenters to get a private message.
4. **WhatsApp templates:**
   1. Create these in **WhatsApp Manager → Message templates**, category **Utility**, language **Arabic**:

      | Name | Body (example) |
      |---|---|
      | `consultation_reminder` | مرحبًا {{1}}، نذكّرك بموعد استشارتك مع محامي بلس يوم {{2}} الساعة {{3}}. للتعديل يُرجى الرد على هذه الرسالة. |
      | `payment_reminder` | مرحبًا {{1}}، نذكّرك بسداد مبلغ {{2}} المستحق لمحامي بلس. شكرًا لك. |
      | `documents_request` | مرحبًا {{1}}، نرجو إرسال المستندات المطلوبة لملفك في أقرب وقت. شكرًا لك. |
   2. After Meta approves them, add each one in the CRM exactly as named, with language `ar` and the number of `{{n}}` values: 3, 2 and 1.
5. **Reminders:** switch on **WhatsApp reminder the day before each consultation** and choose `consultation_reminder`. It's sent with the morning email reminders and fills in name, date and time.
6. **Save:** press **Save channel settings**.

## Step 7: TikTok lead forms

TikTok direct messages cannot be connected; TikTok does not offer that to businesses here. **Lead-generation forms** can:

1. **Easiest option:** in **Make** or **Zapier**, create a scenario: *TikTok Lead Generation → New lead* then *HTTP → POST*.
   - URL: `https://mohamy-plus-relay.<your-name>.workers.dev/tiktok?token=<your TIKTOK_TOKEN>`
   - Body: the lead as **JSON**.
2. **If TikTok offers a webhook directly** in Ads Manager (CRM / lead integration settings), use the same URL.

The CRM reads name, phone, email, and any other answers. The campaign or form name becomes the lead's Campaign.

## Step 8: Test everything

1. **WhatsApp:**
   - From a personal phone, send the business number "السلام عليكم، عايز استشارة".
   - Within seconds: a **New lead** (source WhatsApp), the chat in **Inbox**, the Arabic auto-reply on the phone, and an email to owners and partners.
   - Reply from the Inbox. The reply arrives on the phone, and ticks show delivered and read.
2. **Messenger and Instagram:** send a message to the Page and to the Instagram account. Each one gives a lead and a chat.
3. **Comments:** comment on a Facebook post. It appears as a lead and chat, and you can send one private reply.
4. **Lead forms:** use Meta's **Lead Ads Testing Tool** (developers.facebook.com/tools/lead-ads-testing). The lead appears with its answers.
5. **The 24-hour rule:** open a chat whose last message is over 24 hours old.
   - WhatsApp offers **Use a template**.
   - Messenger and Instagram wait until the person writes again. These are Meta's rules, not the CRM's.
6. **Delivery log:** **Settings → Channels → Recent deliveries** lists lead forms and anything that failed, with **Retry** for lead forms.

## Good to know

- **Who sees what:**
  - Owners and partners see every chat.
  - Lawyers and assistants see chats assigned to them, or linked to leads and clients they work on.
  - Assigning a chat to someone also adds them to that lead's or client's team.
- **Matching numbers:** a WhatsApp number that matches an existing client or lead (in any format, e.g. `0100…` or `+20 100…`) joins that record instead of creating a new lead.
- **Media:** photos, voice notes and documents show as "[Image]", "[Voice note]" and so on, with their caption. Open them on the phone or in Meta Business Suite; the CRM doesn't download media yet.
- **Replies outside the CRM:** messages your team sends from Meta Business Suite or the WhatsApp Business app also appear in the Inbox (via `message_echoes` / `smb_message_echoes`).
- **Security:**
  - Tokens are stored only on the server (Apps Script properties) and are never shown again. The page shows only the last 4 characters.
  - **Issue a new link** on the relay link stops the old one; then update `CRM_RELAY_URL` in Cloudflare.
  - Every change to channel settings is in **Security → Sign-in activity**.
- **Limits:**
  - Cloudflare's free plan allows 100,000 deliveries a day, far more than you need.
  - A personal Gmail account can send about 100 notification emails a day. That's ample for new-lead emails at your size; if you outgrow it, the firm can move to Google Workspace.
- **If something doesn't arrive:**
  1. Open `…workers.dev/health`.
  2. In Cloudflare, open **Workers → mohamy-plus-relay → Logs**: a `403` means the App secret or verify token doesn't match, and `CRM did not confirm` means the relay link is wrong or old.
  3. In the CRM, check **Settings → Channels → Last delivery**.
