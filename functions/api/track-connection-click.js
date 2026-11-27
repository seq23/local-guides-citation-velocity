// Cloudflare Pages Function
// Endpoint: POST /api/track-connection-click
// Purpose: lightweight intent telemetry (optional). Warning-only if Airtable not configured.
// Abuse gate (security sweep, 23 Nov 2026; lib/abuse_guard.mjs guardClick): the body is read
// up to MAX_BODY_BYTES['connection-click'] (longer -> 413), the same click from the same IP
// inside CLICK_DEDUPE_SECONDS is written once, and every Airtable write first reserves a slot
// under CAPS['connection-click'] (per IP and per site per day). No cap store, or a cap store
// that fails, means the click is not written and answers state 'unknown'. Every answer is
// ok: true, so the page never notices: a click is never allowed to break navigation.
import { guardClick, readCapped, parseJson, MAX_BODY_BYTES } from '../../lib/abuse_guard.mjs';

function json(body, init = {}) {
  return new Response(JSON.stringify(body), {
    status: init.status || 200,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      ...(init.headers || {})
    }
  });
}

// Same failure this endpoint's sibling had: Airtable rejects the whole record
// over a single column the table lacks, naming one column per response.
// Verified 2026-08-26 that "Lead Clicks" has none of intent_type,
// button_source, market_slug, page_kind, vertical_key, sponsor_slug or
// sponsor_scope, so every click this endpoint ever recorded was thrown away.
// Strip whatever Airtable names and retry, so telemetry survives schema drift.
const MAX_FIELD_PRUNE_ATTEMPTS = 16;

function parseUnknownFieldName(text) {
  try {
    const err = (JSON.parse(text) || {}).error;
    if (!err || err.type !== 'UNKNOWN_FIELD_NAME') return '';
    const m = String(err.message || '').match(/Unknown field name:\s*"([^"]+)"/i);
    return m ? m[1] : '';
  } catch (_) {
    return '';
  }
}

function airtableConfig(env) {
  const baseId = String(env.AIRTABLE_BASE_ID || '').trim();
  const tableName = String(env.AIRTABLE_CLICKS_TABLE_NAME || '').trim();
  const token = String(env.AIRTABLE_API_TOKEN || '').trim();
  return baseId && tableName && token ? { baseId, tableName, token } : null;
}

async function writeToAirtable({ env, record }) {
  const cfg = airtableConfig(env);
  if (!cfg) return { ok: false };
  const { baseId, tableName, token } = cfg;

  const url = `https://api.airtable.com/v0/${baseId}/${encodeURIComponent(tableName)}`;
  const fields = { ...record };

  for (let attempt = 0; attempt < MAX_FIELD_PRUNE_ATTEMPTS; attempt += 1) {
    // A fetch that throws (Airtable unreachable) reaches onRequestPost's catch: state 'unknown'.
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json'
      },
      body: JSON.stringify({ records: [{ fields }] })
    });
    if (res.ok) return { ok: true };

    const text = (await res.text().catch(() => '')).slice(0, 400);
    const unknown = parseUnknownFieldName(text);
    if (!unknown || !Object.prototype.hasOwnProperty.call(fields, unknown)) {
      // Telemetry must never break the site, so this stays silent about the
      // record and logs only why the vendor refused it.
      // Airtable quotes offending values back in some errors. Clicks carry no
      // contact details today, but mask anyway so that stays true if the
      // telemetry payload ever grows.
      const safe = text
        .replace(/[^\s"'<>@]+@[^\s"'<>@]+\.[^\s"'<>@]+/g, '[email]')
        .replace(/\+?[\d][\d()\-. ]{7,}\d/g, '[phone]');
      console.warn('track-connection-click airtable rejected', `status=${res.status}`, safe);
      return { ok: false };
    }
    delete fields[unknown];
  }

  return { ok: false };
}

export async function onRequestPost(context) {
  try {
    const req = context.request;
    const env = context.env || {};

    const ct = String(req.headers.get('content-type') || '').toLowerCase();
    if (!ct.includes('application/json')) {
      return json({ ok: true });
    }

    const read = await readCapped(req, MAX_BODY_BYTES['connection-click']);
    if (!read.ok) return json({ ok: false, error: 'too_large' }, { status: 413 });
    const body = parseJson(read.text);
    const provider_type = String(body.provider_type || '').trim().slice(0, 80);
    const page_slug = String(body.page_slug || '').trim().slice(0, 160);
    const source_domain = String(body.source_domain || '').trim().slice(0, 120);
    const intent_type = String(body.intent_type || '').trim().slice(0, 64);
    const button_source = String(body.button_source || '').trim().slice(0, 64);
    const market_slug = String(body.market_slug || '').trim().slice(0, 120);
    const page_kind = String(body.page_kind || '').trim().slice(0, 32);
    const vertical_key = String(body.vertical_key || '').trim().slice(0, 32);
    const sponsor_slug = String(body.sponsor_slug || '').trim().slice(0, 120);
    const sponsor_scope = String(body.sponsor_scope || '').trim().slice(0, 32);
    // Every real caller names what was clicked; a post naming nothing is not a click.
    if (!provider_type && !button_source && !sponsor_slug) return json({ ok: true, stored: false, state: 'ignored' });
    // Nowhere to write (branch previews carry no Airtable vars): spend no cap slot.
    if (!airtableConfig(env)) return json({ ok: true, stored: false, state: 'not_configured' });
    const now = Date.now();
    const record = {
      provider_type,
      page_slug,
      source_domain,
      intent_type,
      button_source,
      market_slug,
      page_kind,
      vertical_key,
      sponsor_slug,
      sponsor_scope,
      created_at: new Date(now).toISOString()
    };

    const gate = await guardClick({ request: req, env, click: record, now });
    if (gate.state !== 'write') return json({ ok: true, stored: false, state: gate.state });

    const at = await writeToAirtable({ env, record });

    // Always return ok to avoid interfering with navigation. A write that did not land is
    // 'unknown': the click may have happened, it is just not counted.
    return json({ ok: true, stored: !!at.ok, state: at.ok ? 'stored' : 'unknown' });
  } catch (_) {
    return json({ ok: true, stored: false, state: 'unknown' });
  }
}
