/**
 * Abuse guard for the public endpoints that take anonymous posts (security sweep, 23 Nov 2026).
 * Self-contained on purpose (no imports): local-guides-citation-velocity carries the same file.
 *
 *   checkCaps   per-IP and per-site daily caps, counted server-side in the LEAD_LIMITS KV
 *               namespace (an IP is stored only as a salted day hash). Never trusts a client
 *               value: the IP is cf-connecting-ip, the site is the request host.
 *   guardClick  the click-tracking gate: a repeat of the same click from the same IP inside
 *               CLICK_DEDUPE_SECONDS is not written again, and each write first reserves a slot
 *               under the caps. No KV, or a KV read or write that fails, is 'unknown' and the
 *               click is not written: the guard fails closed, never open.
 *   readCapped  reads a request body up to a byte limit; a longer body is refused (413)
 *               without reading the rest, whatever content-length the client claims.
 *   safeEqual   constant-time compare for shared secrets (HMAC both sides, compare digests).
 *
 * KV is eventually consistent: a counter written in one Cloudflare location can take up to
 * 60 seconds to be read in another, and two requests in the same instant can read the same
 * count. A burst spread across locations can therefore pass a cap by the number of requests
 * in flight before the counter propagates; sequential traffic, which is what one script
 * sends, stops exactly at the cap.
 */

// One table of caps for every guarded endpoint. Real volume is a handful a day per site;
// each cap leaves a wide margin for people while bounding what a script can push through.
export const CAPS = {
  'request-assistance': { perIp: 6, daily: 150 },
  'senior-lead': { perIp: 8, daily: 60 },
  'connection-click': { perIp: 30, daily: 500 },
  'senior-event': { perIp: 300, daily: 5000 },
  'seat-checkout': { perIp: 5, daily: 20 }
};

// The same click (same IP, same CTA or sponsor, same page) inside this window is one click.
export const CLICK_DEDUPE_SECONDS = 1800;

export const MAX_BODY_BYTES = {
  'connection-click': 4096,
  'senior-event': 2048,
  'seat-checkout': 2048
};

const COUNTER_TTL = { expirationTtl: 60 * 60 * 48 };

export function clientIp(request) {
  const h = request.headers;
  return String(h.get('cf-connecting-ip') || String(h.get('x-forwarded-for') || '').split(',')[0] || '').trim() || 'unknown';
}

export function hostOf(request) {
  try { return new URL(request.url).host.toLowerCase().replace(/^www\./, ''); } catch (_) { return 'unknown'; }
}

export function dayOf(nowMs) {
  return new Date(nowMs).toISOString().slice(0, 10);
}

export async function hash(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf), (x) => x.toString(16).padStart(2, '0')).join('').slice(0, 32);
}

function hasKv(kv) {
  return Boolean(kv && typeof kv.get === 'function' && typeof kv.put === 'function');
}

async function readCount(kv, key) {
  return Number((await kv.get(key)) || 0) || 0;
}

/**
 * Check one request against the scope's caps.
 * Returns { state: 'ok', take } | { state: 'over', which } | { state: 'unknown', reason }.
 * take() records one use and resolves true when it was written, false when the write failed.
 */
export async function checkCaps({ kv, scope, request, now = Date.now() }) {
  const caps = CAPS[scope];
  if (!caps) throw new Error(`abuse_guard: unknown scope ${scope}`);
  if (!hasKv(kv)) return { state: 'unknown', reason: 'LEAD_LIMITS_UNBOUND' };
  const d = dayOf(now);
  const ip = clientIp(request);
  const host = hostOf(request);
  const ipKey = `ip:${scope}:${d}:${await hash(`${d}|${ip}|${scope}`)}`;
  const dayKey = `day:${scope}:${host}:${d}`;
  let ipN;
  let dayN;
  try {
    [ipN, dayN] = await Promise.all([readCount(kv, ipKey), readCount(kv, dayKey)]);
  } catch (err) {
    console.error(`abuse_guard ${scope}: LEAD_LIMITS read failed`, String((err && err.message) || err));
    return { state: 'unknown', reason: 'LEAD_LIMITS_READ_FAILED' };
  }
  if (dayN >= caps.daily) {
    console.error(`abuse_guard ${scope}: daily cap ${caps.daily} reached on ${host}`);
    return { state: 'over', which: 'daily' };
  }
  if (ipN >= caps.perIp) return { state: 'over', which: 'perIp' };
  let taken = null;
  const take = async () => {
    if (taken) return taken;
    taken = Promise.all([kv.put(ipKey, String(ipN + 1), COUNTER_TTL), kv.put(dayKey, String(dayN + 1), COUNTER_TTL)])
      .then(() => true, (err) => {
        console.error(`abuse_guard ${scope}: LEAD_LIMITS write failed`, String((err && err.message) || err));
        return false;
      });
    return taken;
  };
  return { state: 'ok', take };
}

/**
 * The click-tracking gate. `click` is the record about to be written; the dedupe identity is
 * who clicked (IP) on what (provider/CTA, button, sponsor) on which page.
 * Returns { state: 'write' } only after a slot was reserved; otherwise
 * { state: 'duplicate' | 'over' | 'unknown' } and the caller writes nothing.
 */
export async function guardClick({ request, env, click, now = Date.now() }) {
  const kv = (env || {}).LEAD_LIMITS;
  if (!hasKv(kv)) {
    console.error('LEAD_LIMITS_UNBOUND connection-click: no LEAD_LIMITS KV binding; clicks are not written until it is bound (scripts/bind_lead_guard.sh).');
    return { state: 'unknown' };
  }
  const c = click || {};
  const who = [dayOf(now), clientIp(request), c.provider_type, c.button_source, c.sponsor_slug, c.page_slug].map((v) => String(v || '')).join('|');
  const dupKey = `dup:connection-click:${await hash(who)}`;
  try {
    if (await kv.get(dupKey)) return { state: 'duplicate' };
  } catch (err) {
    console.error('abuse_guard connection-click: LEAD_LIMITS read failed', String((err && err.message) || err));
    return { state: 'unknown' };
  }
  const caps = await checkCaps({ kv, scope: 'connection-click', request, now });
  if (caps.state !== 'ok') return { state: caps.state };
  let marked = true;
  try {
    await kv.put(dupKey, '1', { expirationTtl: CLICK_DEDUPE_SECONDS });
  } catch (err) {
    console.error('abuse_guard connection-click: LEAD_LIMITS write failed', String((err && err.message) || err));
    marked = false;
  }
  if (!marked || !(await caps.take())) return { state: 'unknown' };
  return { state: 'write' };
}

/**
 * Read at most maxBytes of the body. Returns { ok: true, text } or { ok: false, status: 413 }.
 * A content-length over the limit is refused before reading; a body that is longer than it
 * claims is cut off at the limit and refused.
 */
export async function readCapped(request, maxBytes) {
  const claimed = Number(request.headers.get('content-length') || 0);
  if (Number.isFinite(claimed) && claimed > maxBytes) return { ok: false, status: 413 };
  if (!request.body) return { ok: true, text: '' };
  const reader = request.body.getReader();
  const chunks = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) {
      reader.cancel().catch(() => {});
      return { ok: false, status: 413 };
    }
    chunks.push(value);
  }
  const all = new Uint8Array(size);
  let at = 0;
  for (const c of chunks) { all.set(c, at); at += c.byteLength; }
  return { ok: true, text: new TextDecoder().decode(all) };
}

/** Parse a capped JSON body; anything unparseable is {}. */
export function parseJson(text) {
  try {
    const v = JSON.parse(text || '{}');
    return v && typeof v === 'object' && !Array.isArray(v) ? v : {};
  } catch (_) {
    return {};
  }
}

/**
 * Constant-time string compare: both sides are HMAC-ed under a fresh random key and the
 * fixed-length digests are compared without an early exit, so neither the content nor the
 * length of the secret leaks through timing.
 */
export async function safeEqual(a, b) {
  const key = await crypto.subtle.generateKey({ name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const enc = new TextEncoder();
  const [x, y] = await Promise.all([
    crypto.subtle.sign('HMAC', key, enc.encode(String(a))),
    crypto.subtle.sign('HMAC', key, enc.encode(String(b)))
  ]);
  const u = new Uint8Array(x);
  const v = new Uint8Array(y);
  let diff = 0;
  for (let i = 0; i < u.length; i += 1) diff |= u[i] ^ v[i];
  return diff === 0;
}

/** True only when a secret is configured and the presented value equals it. */
export async function secretMatches(expected, presented) {
  const e = String(expected || '');
  const p = String(presented || '');
  if (!e || !p) return false;
  return safeEqual(e, p);
}
