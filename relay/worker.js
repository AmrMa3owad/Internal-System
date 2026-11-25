/**
 * Mohamy Plus messaging relay (Cloudflare Worker).
 *
 * Meta (WhatsApp, Messenger, Instagram, lead ads) and TikTok send webhooks
 * here. The relay proves each delivery is genuine, then forwards it to the
 * CRM. Apps Script cannot read request headers, so it cannot check Meta's
 * signature itself; that is the only reason this relay exists.
 *
 *   GET  /meta     Meta's one-time verification (hub.challenge)
 *   POST /meta     Meta webhooks, checked with X-Hub-Signature-256 (app secret)
 *   POST /tiktok   TikTok lead webhooks, checked with ?token=TIKTOK_TOKEN
 *   GET  /health   "ok" (for your own checks)
 *
 * Settings (Cloudflare → Worker → Settings → Variables and Secrets):
 *   CRM_RELAY_URL       the relay link from the CRM (Settings → Channels)   [secret]
 *   META_APP_SECRET     Meta app → App settings → Basic → App secret         [secret]
 *   META_VERIFY_TOKEN   any long random text; paste the same in Meta          [secret]
 *   TIKTOK_TOKEN        any long random text; add ?token=… to the TikTok URL  [secret, optional]
 *   INSTAGRAM_APP_SECRET  only if Instagram webhooks use a separate app secret [optional]
 *
 * If the CRM does not confirm a delivery, the relay answers 500 so Meta and
 * TikTok retry later; the CRM ignores anything it has already saved.
 */

const MAX_BODY_BYTES = 1024 * 1024;
const CRM_TIMEOUT_MS = 25000;

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    try {
      if (url.pathname === '/health') return text('ok');
      if (url.pathname === '/meta' && request.method === 'GET') return verifyMeta(url, env);
      if (url.pathname === '/meta' && request.method === 'POST') return await receiveMeta(request, env);
      if (url.pathname === '/tiktok' && request.method === 'POST') return await receiveTikTok(request, url, env);
      return text('Not found', 404);
    } catch (error) {
      console.error('relay error', error && error.message);
      return text('Error', 500);
    }
  }
};

function text(body, status = 200) {
  return new Response(body, { status, headers: { 'content-type': 'text/plain; charset=utf-8' } });
}

/** Meta calls this once when you save the webhook URL. */
function verifyMeta(url, env) {
  const mode = url.searchParams.get('hub.mode');
  const token = url.searchParams.get('hub.verify_token') || '';
  const challenge = url.searchParams.get('hub.challenge') || '';
  if (mode === 'subscribe' && env.META_VERIFY_TOKEN && safeEqual(token, env.META_VERIFY_TOKEN)) return text(challenge);
  return text('Forbidden', 403);
}

async function readBody(request) {
  const declared = Number(request.headers.get('content-length') || 0);
  if (declared > MAX_BODY_BYTES) throw new Error('too large');
  const raw = await request.text();
  if (raw.length > MAX_BODY_BYTES) throw new Error('too large');
  return raw;
}

async function receiveMeta(request, env) {
  const raw = await readBody(request);
  const signature = request.headers.get('x-hub-signature-256') || '';
  const secrets = [env.META_APP_SECRET, env.INSTAGRAM_APP_SECRET].filter(Boolean);
  let genuine = false;
  for (const secret of secrets) if (await signatureMatches(raw, signature, secret)) { genuine = true; break; }
  if (!genuine) return text('Forbidden', 403);
  let body;
  try { body = JSON.parse(raw); } catch (error) { return text('Bad request', 400); }
  return forward(env, { source: 'meta', body });
}

async function receiveTikTok(request, url, env) {
  if (!env.TIKTOK_TOKEN || !safeEqual(url.searchParams.get('token') || '', env.TIKTOK_TOKEN)) return text('Forbidden', 403);
  const raw = await readBody(request);
  let body;
  try { body = JSON.parse(raw); } catch (error) { return text('Bad request', 400); }
  return forward(env, { source: 'tiktok', body });
}

/** Hands the delivery to the CRM; only a confirmed save is acknowledged to the platform. */
async function forward(env, delivery) {
  if (!env.CRM_RELAY_URL) return text('Relay is not configured', 500);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), CRM_TIMEOUT_MS);
  try {
    const response = await fetch(env.CRM_RELAY_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(delivery),
      redirect: 'follow',
      signal: controller.signal
    });
    const result = await response.json().catch(() => null);
    if (response.ok && result && result.ok) return text('EVENT_RECEIVED');
    console.error('CRM did not confirm', response.status, result && result.error);
    return text('Retry later', 500);
  } catch (error) {
    console.error('CRM unreachable', error && error.message);
    return text('Retry later', 500);
  } finally {
    clearTimeout(timer);
  }
}

async function signatureMatches(raw, header, secret) {
  if (!header.startsWith('sha256=')) return false;
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const digest = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(raw));
  const expected = 'sha256=' + [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
  return safeEqual(header.toLowerCase(), expected);
}

function safeEqual(a, b) {
  a = String(a); b = String(b);
  if (a.length !== b.length || !a.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
