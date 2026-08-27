// Cloudflare Pages Function
// Endpoint: POST /api/track-connection-click
// Purpose: lightweight intent telemetry (optional). Warning-only if Airtable not configured.

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

async function writeToAirtable({ env, record }) {
  const baseId = String(env.AIRTABLE_BASE_ID || '').trim();
  const tableName = String(env.AIRTABLE_CLICKS_TABLE_NAME || '').trim();
  const token = String(env.AIRTABLE_API_TOKEN || '').trim();
  if (!baseId || !tableName || !token) return { ok: false };

  const url = `https://api.airtable.com/v0/${baseId}/${encodeURIComponent(tableName)}`;
  const fields = { ...record };

  for (let attempt = 0; attempt < MAX_FIELD_PRUNE_ATTEMPTS; attempt += 1) {
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

    const body = await req.json().catch(() => ({}));
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
    const nowIso = new Date().toISOString();

    const at = await writeToAirtable({
      env,
      record: {
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
        created_at: nowIso
      }
    });

    // Always return ok to avoid interfering with navigation.
    return json({ ok: true, stored: !!at.ok });
  } catch (_) {
    return json({ ok: true });
  }
}
