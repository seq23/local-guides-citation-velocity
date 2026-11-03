#!/usr/bin/env node
// Proves functions/api/request-assistance.js drops submissions from domains in
// BLOCKED_LEAD_DOMAINS quietly (no Airtable write, no relay email, the same
// { ok: true } the honeypot returns, one BLOCKED_LEAD log line) and leaves
// every other submission untouched. Only fake *.test domains appear here: the
// real list lives in the Pages env var and never in this public repo.
// Also proves the lead gate (Turnstile, per-IP and daily limits; 3 Nov 2026) at the end.
// Run by the blocked-lead-domains validator (scripts/validators/validate_blocked_lead_domains.js).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// package.json is "type": "commonjs", so Node reads the ES-module handler as
// CommonJS; load a byte-for-byte copy under .mjs instead (Pages bundles it as ESM).
const HANDLER = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../functions/api/request-assistance.js');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'blocked-lead-'));
const copy = path.join(tmp, 'request-assistance.mjs');
fs.copyFileSync(HANDLER, copy);
const { onRequestPost } = await import(pathToFileURL(copy).href);

const BASE_ENV = {
  AIRTABLE_BASE_ID: 'appTEST',
  AIRTABLE_TABLE_NAME: 'Leads',
  AIRTABLE_API_TOKEN: 'tok',
  RESEND_API_KEY: 'key',
  LEAD_TO: 'owner@example.test',
  LOCAL_GUIDES_TURNSTILE_SECRET_KEY: 'turnstile-fixture-secret'
};

async function submit(email, env) {
  const calls = [];
  const logs = [];
  const realFetch = globalThis.fetch;
  const realLog = console.log;
  globalThis.fetch = async (url) => {
    // The lead gate's Turnstile check passes (test_lead_guard.mjs covers it); calls
    // records only what stores or sends the lead.
    if (String(url).startsWith('https://challenges.cloudflare.com/')) return new Response(JSON.stringify({ success: true }), { status: 200 });
    calls.push(String(url));
    return new Response(JSON.stringify({ id: 'rec1' }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  console.log = (...a) => logs.push(a.join(' '));
  try {
    const request = new Request('https://guide.example.test/api/request-assistance', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-turnstile-token': 'turnstile-pass-fixture' },
      body: JSON.stringify({ provider_type: 'Dentist (Cosmetic, Implant, or General Care)', email, consent: 'yes' })
    });
    const res = await onRequestPost({ request, env: { ...BASE_ENV, ...env } });
    return { status: res.status, body: await res.json(), calls, logs };
  } finally {
    globalThis.fetch = realFetch;
    console.log = realLog;
  }
}

const LIST = 'blocked.test, Other-Blocked.TEST ';
const blockedCases = [
  ['exact domain', 'a@blocked.test', 'blocked.test'],
  ['upper-case address', 'A@BLOCKED.TEST', 'blocked.test'],
  ['subdomain', 'a@mail.blocked.test', 'mail.blocked.test'],
  ['second list entry, list padded and mixed case', 'a@other-blocked.test', 'other-blocked.test']
];
const passCases = [
  ['unlisted domain', 'a@fine.test', LIST],
  ['look-alike suffix is not a subdomain', 'a@notblocked.test', LIST],
  ['listed domain as a label, not the suffix', 'a@blocked.test.fine.test', LIST],
  ['env unset', 'a@blocked.test', undefined],
  ['env empty', 'a@blocked.test', ''],
  ['env only separators', 'a@blocked.test', ' , ,']
];

let n = 0;
for (const [name, email, domain] of blockedCases) {
  const r = await submit(email, { BLOCKED_LEAD_DOMAINS: LIST });
  assert.equal(r.status, 200, `${name}: status`);
  assert.deepEqual(r.body, { ok: true }, `${name}: must return the honeypot's bare success`);
  assert.equal(r.calls.length, 0, `${name}: blocked lead reached ${r.calls.join(', ')}`);
  assert.deepEqual(r.logs, [`BLOCKED_LEAD domain=${domain} source=guide.example.test`], `${name}: log line`);
  n += 1;
}
for (const [name, email, list] of passCases) {
  const env = list === undefined ? {} : { BLOCKED_LEAD_DOMAINS: list };
  const r = await submit(email, env);
  assert.equal(r.status, 200, `${name}: status`);
  assert.equal(r.body.storage, 'airtable', `${name}: lead must be stored, got ${JSON.stringify(r.body)}`);
  assert.ok(r.calls.some((u) => u.startsWith('https://api.airtable.com/')), `${name}: no Airtable write`);
  assert.ok(r.calls.some((u) => u.startsWith('https://api.resend.com/')), `${name}: no relay email`);
  assert.ok(!r.logs.some((l) => l.startsWith('BLOCKED_LEAD')), `${name}: logged as blocked`);
  n += 1;
}
if (n !== blockedCases.length + passCases.length || n === 0) throw new Error('blocked-lead-domains: cases did not all run');
console.log(`blocked-lead-domains: ${n} cases passed`);

// ---- Lead gate (security sweep, 3 Nov 2026): Turnstile + per-IP/day + per-site daily
// ceiling, checked before anything is stored or sent. Run by the same validator, since
// this file is the endpoint's behaviour test.
const { LEAD_LIMITS_PER_IP, LEAD_LIMITS_DAILY } = await import(pathToFileURL(copy).href);
const PASS = 'turnstile-pass-fixture';
function kvFake() { const m = new Map(); return { m, async get(k) { return m.has(k) ? m.get(k) : null; }, async put(k, v) { m.set(k, String(v)); } }; }
async function gated({ token = PASS, env = {}, ip = '203.0.113.7', host = 'theindustryguides.com', body = { provider_type: 'Dentist (Cosmetic, Implant, or General Care)', email: 'a@fine.test', consent: 'yes' } } = {}) {
  const calls = [];
  const realFetch = globalThis.fetch;
  const realErr = console.error;
  globalThis.fetch = async (url, init) => {
    if (String(url).startsWith('https://challenges.cloudflare.com/turnstile/v0/siteverify')) {
      const f = new URLSearchParams(String(init.body));
      const ok = f.get('secret') === BASE_ENV.LOCAL_GUIDES_TURNSTILE_SECRET_KEY && f.get('response') === PASS;
      return new Response(JSON.stringify({ success: ok }), { status: 200 });
    }
    calls.push(String(url));
    return new Response(JSON.stringify({ id: 'rec1' }), { status: 200 });
  };
  console.error = () => {};
  try {
    const headers = { 'content-type': 'application/json', 'cf-connecting-ip': ip };
    if (token !== null) headers['x-turnstile-token'] = token;
    const res = await onRequestPost({ request: new Request(`https://${host}/api/request-assistance`, { method: 'POST', headers, body: JSON.stringify(body) }), env: { ...BASE_ENV, ...env } });
    return { status: res.status, body: await res.json(), calls };
  } finally {
    globalThis.fetch = realFetch;
    console.error = realErr;
  }
}
let g = 0;
const none = await gated({ token: null });
assert.equal(none.status, 400, 'no token -> 400'); assert.equal(none.calls.length, 0); g += 1;
assert.equal((await gated({ token: null, body: {} })).status, 400, 'an empty probe still reads 400'); g += 1;
const forged = await gated({ token: 'forged' });
assert.equal(forged.status, 403, 'rejected token -> 403'); assert.equal(forged.calls.length, 0); g += 1;
const unset = await gated({ env: { LOCAL_GUIDES_TURNSTILE_SECRET_KEY: '' } });
assert.equal(unset.status, 503, 'no secret -> fails closed'); assert.equal(unset.calls.length, 0); g += 1;
const kv = kvFake();
for (let i = 0; i < LEAD_LIMITS_PER_IP; i += 1) {
  const ok = await gated({ env: { LEAD_LIMITS: kv } });
  assert.equal(ok.status, 200, `valid lead ${i + 1}`);
  assert.equal(ok.body.storage, 'airtable');
  assert.ok(ok.calls.some((u) => u.startsWith('https://api.airtable.com/')) && ok.calls.some((u) => u.startsWith('https://api.resend.com/')));
}
g += 1;
const over = await gated({ env: { LEAD_LIMITS: kv } });
assert.equal(over.status, 429, 'over the per-IP limit -> 429'); assert.equal(over.calls.length, 0); assert.match(over.body.message, /hello@theindustryguides\.com/); g += 1;
assert.equal((await gated({ env: { LEAD_LIMITS: kv }, ip: '198.51.100.9' })).status, 200, 'another IP still passes'); g += 1;
const kv2 = kvFake();
for (let i = 0; i < LEAD_LIMITS_PER_IP + 2; i += 1) assert.equal((await gated({ env: { LEAD_LIMITS: kv2 }, body: { provider_type: 'Dentist (Cosmetic, Implant, or General Care)', email: 'a@fine.test', consent: '' } })).status, 400);
assert.equal((await gated({ env: { LEAD_LIMITS: kv2 } })).status, 200, 'a refused typo does not use up the allowance'); g += 1;
const kv3 = kvFake();
await kv3.put(`day:request-assistance:theindustryguides.com:${new Date().toISOString().slice(0, 10)}`, String(LEAD_LIMITS_DAILY));
const ceiling = await gated({ env: { LEAD_LIMITS: kv3 }, ip: '192.0.2.44' });
assert.equal(ceiling.status, 429, 'per-site daily ceiling -> 429'); assert.equal(ceiling.calls.length, 0); g += 1;
if (g !== 9) throw new Error('lead-gate: cases did not all run');
console.log(`lead-gate: ${g} cases passed`);
