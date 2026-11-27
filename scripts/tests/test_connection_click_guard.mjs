#!/usr/bin/env node
// Abuse gate for POST /api/track-connection-click (security sweep, 27 Nov 2026; audit row
// "unlimited Airtable Lead Clicks writes"). Runs the real handler (functions/api/
// track-connection-click.js) and the real gate (lib/abuse_guard.mjs) against a KV fake and a
// stubbed Airtable: one IP replaying a click writes it once, per-IP and per-site daily caps
// bound what a script can push through, a cap-store or Airtable outage writes nothing and
// answers 'unknown', and every answer is a 200 so a real visitor's page never breaks.
// Copied from: seq23/local-guides-generator tests/request_form/abuse_guard.test.mjs (click
// cases, commit 7e1b188b), plus the 1,000-click and first-click cases this repo's brief asks for.
// Run by the merge gate (.github/workflows/validate-repo.yml).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const LIB = pathToFileURL(path.join(ROOT, 'lib')).href;
const { CAPS, CLICK_DEDUPE_SECONDS, MAX_BODY_BYTES } = await import(`${LIB}/abuse_guard.mjs`);

// package.json is "type": "commonjs", so Node reads the ES-module handler as CommonJS; load a
// copy under .mjs with its ../../lib/ imports pointed at the real lib/ (the code Pages bundles).
async function loadHandler() {
  const src = fs.readFileSync(path.join(ROOT, 'functions/api/track-connection-click.js'), 'utf8');
  const tmp = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'click-guard-')), 'track-connection-click.mjs');
  fs.writeFileSync(tmp, src.replace(/(['"])\.\.\/\.\.\/lib\//g, `$1${LIB}/`));
  return import(pathToFileURL(tmp).href);
}
const mod = await loadHandler();

const AIRTABLE_ENV = { AIRTABLE_BASE_ID: 'appTEST', AIRTABLE_CLICKS_TABLE_NAME: 'Lead Clicks', AIRTABLE_API_TOKEN: 'patTEST' };
const CLICK = { provider_type: 'cta:dentistry-get-listed', button_source: 'dentistry-get-listed', page_slug: '/dentistry/', source_domain: 'theindustryguides.com', intent_type: 'cta_ref', page_kind: 'hub' };

/** KV fake with expiry on a clock the test moves; `fail` makes get or put throw. */
function makeKV(clock) {
  const m = new Map();
  const kv = {
    map: m,
    fail: { get: false, put: false },
    async get(k) {
      if (kv.fail.get) throw new Error('kv get down');
      const e = m.get(k);
      if (!e) return null;
      if (e.exp && clock.now >= e.exp) { m.delete(k); return null; }
      return e.v;
    },
    async put(k, v, opts = {}) {
      if (kv.fail.put) throw new Error('kv put down');
      m.set(k, { v: String(v), exp: opts.expirationTtl ? clock.now + opts.expirationTtl * 1000 : 0 });
    }
  };
  return kv;
}

function world({ airtable = 'ok' } = {}) {
  const clock = { now: Date.parse('2026-11-27T15:00:00Z') };
  const w = { clock, kv: makeKV(clock), writes: [], airtableCalls: 0 };
  w.fetch = async (url, init) => {
    const u = String(url);
    if (!u.startsWith('https://api.airtable.com/')) throw new Error(`unexpected fetch ${u}`);
    w.airtableCalls += 1;
    if (airtable === 'down') throw new Error('connect ECONNREFUSED');
    if (airtable === '500') return new Response('{"error":"SERVER_ERROR"}', { status: 500 });
    w.writes.push(JSON.parse(init.body).records[0].fields);
    return new Response(JSON.stringify({ records: [{ id: `rec${w.writes.length}` }] }), { status: 200 });
  };
  return w;
}

async function click(w, { ip = '198.51.100.1', host = 'theindustryguides.com', body = CLICK, env = {}, raw, headers = {} } = {}) {
  const realFetch = globalThis.fetch;
  const realNow = Date.now;
  globalThis.fetch = w.fetch;
  Date.now = () => w.clock.now;
  try {
    const req = new Request(`https://${host}/api/track-connection-click`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'cf-connecting-ip': ip, ...headers },
      body: raw !== undefined ? raw : JSON.stringify(body),
      ...(raw instanceof ReadableStream ? { duplex: 'half' } : {})
    });
    const res = await mod.onRequestPost({ request: req, env: { ...AIRTABLE_ENV, LEAD_LIMITS: w.kv, ...env } });
    return { status: res.status, body: await res.json() };
  } finally {
    globalThis.fetch = realFetch;
    Date.now = realNow;
  }
}

test('a real visitor\'s first click is recorded once, as the click itself', async () => {
  const w = world();
  const r = await click(w);
  assert.equal(r.status, 200);
  assert.deepEqual(r.body, { ok: true, stored: true, state: 'stored' });
  assert.equal(w.writes.length, 1);
  assert.equal(w.writes[0].provider_type, CLICK.provider_type);
  assert.equal(w.writes[0].page_slug, CLICK.page_slug);
});

test('one IP clicking the same ref 1,000 times records it once; every answer is still 200', async () => {
  const w = world();
  for (let i = 0; i < 1000; i += 1) {
    const r = await click(w);
    assert.equal(r.status, 200);
    assert.equal(r.body.ok, true, 'the page never sees a failure');
    assert.equal(r.body.state, i === 0 ? 'stored' : 'duplicate', `click ${i + 1}`);
  }
  assert.equal(w.writes.length, 1, 'one Airtable record for 1,000 replays');
});

test('one IP is capped at CAPS perIp writes a day; a forged x-forwarded-for does not reset it', async () => {
  const w = world();
  const { perIp } = CAPS['connection-click'];
  for (let i = 0; i < perIp + 5; i += 1) {
    const r = await click(w, { body: { ...CLICK, page_slug: `/page-${i}/` }, headers: { 'x-forwarded-for': `10.0.0.${i}` } });
    assert.equal(r.status, 200);
    assert.equal(r.body.ok, true);
    assert.equal(r.body.state, i < perIp ? 'stored' : 'over', `click ${i + 1}`);
  }
  assert.equal(w.writes.length, perIp, 'never more Airtable writes than the per-IP cap');
});

test('rotating IPs stop quietly at the per-site daily cap; another site and the next day still record', async () => {
  const w = world();
  const { daily } = CAPS['connection-click'];
  for (let i = 0; i < daily + 10; i += 1) {
    const r = await click(w, { ip: `203.0.${Math.floor(i / 250)}.${i % 250}` });
    assert.equal(r.status, 200, 'over the cap is still a 200 for the visitor');
    assert.equal(r.body.ok, true);
  }
  assert.equal(w.writes.length, daily, 'never more Airtable writes than the daily cap');
  assert.equal((await click(w, { ip: '192.0.2.200', host: 'uscisexam.com' })).body.state, 'stored', 'the cap is per site');
  w.clock.now += 24 * 3600 * 1000;
  assert.equal((await click(w, { ip: '192.0.2.201' })).body.state, 'stored', 'a new day starts a new count');
});

test('dedupe is per ref per IP: other people, pages and CTAs are other clicks; after the window it counts again', async () => {
  const w = world();
  assert.equal((await click(w)).body.state, 'stored');
  assert.equal((await click(w)).body.state, 'duplicate');
  assert.equal((await click(w, { ip: '198.51.100.2' })).body.state, 'stored', 'a second person');
  assert.equal((await click(w, { body: { ...CLICK, page_slug: '/trt/' } })).body.state, 'stored', 'another page');
  assert.equal((await click(w, { body: { ...CLICK, provider_type: 'cta:trt-get-listed', button_source: 'trt-get-listed' } })).body.state, 'stored', 'another CTA');
  w.clock.now += (CLICK_DEDUPE_SECONDS + 1) * 1000;
  assert.equal((await click(w)).body.state, 'stored', 'the same person after the window');
  assert.equal(w.writes.length, 5);
});

test('cap store unbound or failing: nothing written, state unknown, the visitor still gets 200', async () => {
  for (const mode of ['unbound', 'get', 'put']) {
    const w = world();
    const env = mode === 'unbound' ? { LEAD_LIMITS: undefined } : {};
    if (mode !== 'unbound') w.kv.fail[mode] = true;
    const r = await click(w, { env });
    assert.equal(r.status, 200, mode);
    assert.deepEqual(r.body, { ok: true, stored: false, state: 'unknown' }, mode);
    assert.equal(w.airtableCalls, 0, `${mode}: no Airtable write without a counted slot`);
  }
});

test('Airtable down or refusing is unknown, never stored; no Airtable config spends no slot', async () => {
  for (const airtable of ['down', '500']) {
    const r = await click(world({ airtable }));
    assert.equal(r.status, 200, airtable);
    assert.deepEqual(r.body, { ok: true, stored: false, state: 'unknown' }, airtable);
  }
  const w = world();
  assert.deepEqual((await click(w, { env: { AIRTABLE_API_TOKEN: '' } })).body, { ok: true, stored: false, state: 'not_configured' });
  assert.equal(w.kv.map.size, 0);
});

test('a body over the limit is refused unread, whatever length it claims; an empty click is ignored', async () => {
  const w = world();
  const max = MAX_BODY_BYTES['connection-click'];
  assert.equal((await click(w, { raw: JSON.stringify({ ...CLICK, pad: 'x'.repeat(max) }) })).status, 413);
  const chunk = new TextEncoder().encode('x'.repeat(1024));
  let sent = 0;
  const stream = new ReadableStream({ pull(c) { if (sent >= max * 4) { c.close(); return; } sent += chunk.byteLength; c.enqueue(chunk); } });
  assert.equal((await click(w, { raw: stream })).status, 413, 'a streamed body with no content-length is cut off');
  assert.ok(sent <= max + 2 * chunk.byteLength, `stopped reading early (read ${sent} bytes)`);
  assert.equal((await click(w, { body: {} })).body.state, 'ignored');
  assert.equal(w.airtableCalls, 0);
});
