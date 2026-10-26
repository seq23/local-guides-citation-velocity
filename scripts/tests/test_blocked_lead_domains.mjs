#!/usr/bin/env node
// Proves functions/api/request-assistance.js drops submissions from domains in
// BLOCKED_LEAD_DOMAINS quietly (no Airtable write, no relay email, the same
// { ok: true } the honeypot returns, one BLOCKED_LEAD log line) and leaves
// every other submission untouched. Only fake *.test domains appear here: the
// real list lives in the Pages env var and never in this public repo.
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
  LEAD_TO: 'owner@example.test'
};

async function submit(email, env) {
  const calls = [];
  const logs = [];
  const realFetch = globalThis.fetch;
  const realLog = console.log;
  globalThis.fetch = async (url) => {
    calls.push(String(url));
    return new Response(JSON.stringify({ id: 'rec1' }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  console.log = (...a) => logs.push(a.join(' '));
  try {
    const request = new Request('https://guide.example.test/api/request-assistance', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
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
