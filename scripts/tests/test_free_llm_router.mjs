#!/usr/bin/env node
/**
 * Behaviour pins for scripts/lib/free_llm_router.mjs credential handling, on a
 * stubbed fetch (no network, no key). Run by validate_site_hygiene (zero_paid_llm).
 *
 * Origin (16 Oct 2026): OpenRouter 403s some :free models PER MODEL
 * ("only available on agentic harnesses") while the key is fine. The router used
 * to read any 403 as a refused credential and stopped the whole route.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadRouting, chatFree, keyRefused, KEY_REFUSED_STOP, NO_FREE_MODEL_STOP, PaidCallRefused, CostViolation, chatOnce } from '../lib/free_llm_router.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const cfg = loadRouting(ROOT);
const ids = cfg.models.map((m) => m.id);
assert.ok(ids.length >= 2, 'need at least two $0 models to prove fall-through');
assert.ok(ids.every((id) => id.endsWith(':free')), 'roster must be :free only');
assert.ok(!ids.some((id) => /inkling/.test(id)), 'thinkingmachines/inkling:free (agentic-harness only) must not be in the roster');

const json = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body });
const HARNESS = 'This model is only available on agentic harnesses';
let calls;
function stub({ chat, auth }) {
  calls = { chat: [], auth: 0 };
  globalThis.fetch = async (url, init) => {
    if (String(url).endsWith('/auth/key')) { calls.auth += 1; return auth(); }
    const model = JSON.parse(init.body).model;
    calls.chat.push(model);
    return chat(model, calls.chat.length);
  };
}
const opts = { messages: [{ role: 'user', content: 'ok' }], key: 'sk-test' };
let n = 0;
const t = async (name, fn) => { await fn(); n += 1; console.log(`  ok ${name}`); };

await t('pure: 403 with a model message is not a credential refusal', () => {
  assert.equal(keyRefused(403, HARNESS), false);
  assert.equal(keyRefused(404, 'No endpoints found for this model'), false);
  assert.equal(keyRefused(403, 'model disabled by provider'), false);
  assert.equal(keyRefused(401, 'whatever'), true);
  assert.equal(keyRefused(402, 'Insufficient credits'), true);
  for (const m of ['API key is disabled', 'Invalid API key', 'Key limit exceeded', 'Unauthorized', 'User not found.']) assert.equal(keyRefused(403, m), true, m);
});

await t('403 with a model message falls through and the next model answers', async () => {
  stub({
    chat: (model, i) => (i === 1 ? json(403, { error: { code: 403, message: HARNESS } }) : json(200, { choices: [{ message: { content: 'ok' } }], usage: { cost: 0 } })),
    auth: () => json(200, { data: { label: 'x', limit: 0, usage: 0 } }),
  });
  const r = await chatFree(cfg, opts);
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.model, ids[1]);
  assert.equal(r.content, 'ok');
  assert.deepEqual(r.attempts, [{ model: ids[0], error: HARNESS, status: 403 }]);
  assert.equal(calls.auth, 1, 'auth/key consulted once on a per-model 403');
});

await t('404 per model also falls through', async () => {
  stub({ chat: (m, i) => (i === 1 ? json(404, { error: { message: 'No endpoints found' } }) : json(200, { choices: [{ message: { content: 'ok' } }], usage: { cost: 0 } })), auth: () => json(200, { data: {} }) });
  assert.equal((await chatFree(cfg, opts)).ok, true);
});

await t('every model 403 with a live key is NO_FREE_MODEL, not a credential stop', async () => {
  stub({ chat: () => json(403, { error: { message: HARNESS } }), auth: () => json(200, { data: {} }) });
  const r = await chatFree(cfg, opts);
  assert.equal(r.ok, false); assert.equal(r.stop, NO_FREE_MODEL_STOP); assert.equal(r.attempts.length, ids.length);
  assert.equal(calls.auth, 1, 'auth/key consulted once per route, not per model');
});

await t('403 when auth/key also refuses is the credential stop', async () => {
  stub({ chat: () => json(403, { error: { message: 'Forbidden' } }), auth: () => json(401, { error: { message: 'No auth credentials found' } }) });
  const r = await chatFree(cfg, opts);
  assert.equal(r.ok, false); assert.equal(r.stop, KEY_REFUSED_STOP); assert.equal(calls.chat.length, 1);
});

await t('401 still stops the whole route at once', async () => {
  stub({ chat: () => json(401, { error: { message: 'No auth credentials found' } }), auth: () => { throw new Error('auth/key must not be needed on a 401'); } });
  const r = await chatFree(cfg, opts);
  assert.equal(r.ok, false); assert.equal(r.stop, KEY_REFUSED_STOP); assert.equal(calls.chat.length, 1);
});

await t('402 and a key-shaped message stop the route', async () => {
  stub({ chat: () => json(402, { error: { message: 'Insufficient credits' } }), auth: () => json(200, { data: {} }) });
  assert.equal((await chatFree(cfg, opts)).stop, KEY_REFUSED_STOP);
  stub({ chat: () => json(403, { error: { message: 'API key is disabled' } }), auth: () => json(200, { data: {} }) });
  const r = await chatFree(cfg, opts);
  assert.equal(r.stop, KEY_REFUSED_STOP); assert.equal(calls.chat.length, 1);
});

await t('$0 guarantees hold: non-zero cost throws, unlisted/:online/plugins refused before a request', async () => {
  stub({ chat: () => json(200, { choices: [{ message: { content: 'x' } }], usage: { cost: 0.0001 } }), auth: () => json(200, { data: {} }) });
  await assert.rejects(chatFree(cfg, opts), CostViolation);
  stub({ chat: () => { throw new Error('no request may be sent'); }, auth: () => json(200, {}) });
  await assert.rejects(chatOnce(cfg, { ...opts, model: 'thinkingmachines/inkling:free' }), PaidCallRefused);
  await assert.rejects(chatOnce(cfg, { ...opts, model: 'openai/gpt-4o-mini' }), PaidCallRefused);
  await assert.rejects(chatOnce(cfg, { ...opts, model: `${ids[0]}:online` }), PaidCallRefused);
  await assert.rejects(chatOnce(cfg, { ...opts, model: ids[0], plugins: [{ id: 'web' }] }), PaidCallRefused);
  assert.equal(calls.chat.length, 0);
});

// --- Empty answers are never answers (16 Oct 2026, WPP-llm #42/#43, same router
// shape): a timeout that fired while the BODY downloaded was swallowed into
// ok:true content '', nemotron :free spent max_tokens on its reasoning trace and
// answered '', and --ping asked with max_tokens 5. Each pin replays one failure
// and fails on the pre-fix router.
const res = (status, body, headers = {}) => ({ ok: status >= 200 && status < 300, status, headers: { get: (k) => headers[k.toLowerCase()] ?? null }, json: async () => body });
const answer = (content, finish_reason = 'stop') => res(200, { choices: [{ message: { content }, finish_reason }], usage: { cost: 0 } });
const bodyHangs = (init) => ({ ok: true, status: 200, headers: { get: () => null }, json: () => new Promise((_, rej) => init.signal.addEventListener('abort', () => rej(Object.assign(new Error('This operation was aborted'), { name: 'AbortError' })))) });
function stubBodies(handler) {
  const bodies = []; const per = new Map();
  globalThis.fetch = async (url, init) => {
    if (String(url).endsWith('/auth/key')) return res(200, { data: { label: 't', limit: 0, usage: 0 } });
    const body = JSON.parse(init.body); bodies.push(body);
    per.set(body.model, (per.get(body.model) || 0) + 1);
    return handler(body.model, body, init, per.get(body.model));
  };
  return bodies;
}
const noSleep = (waits) => async (ms) => { waits.push(ms); };

await t('body read times out after headers: an error with elapsed ms, never an empty answer; next model answers', async () => {
  stubBodies((m, b, init) => (m === ids[0] ? bodyHangs(init) : answer('ok')));
  const r = await chatFree(cfg, { ...opts, timeoutMs: 50 });
  assert.equal(r.ok, true); assert.equal(r.model, ids[1]); assert.equal(r.content, 'ok');
  assert.match(r.attempts[0].error, /^timeout after \d+ ms reading the response body/);
  assert.equal((await chatOnce(cfg, { ...opts, model: ids[0], timeoutMs: 50 })).ok, false, 'a body that never arrived is not ok:true');
});

await t('a 2xx with an unreadable body is an error, not an empty answer', async () => {
  stubBodies((m) => (m === ids[0] ? { ok: true, status: 200, headers: { get: () => null }, json: async () => { throw new SyntaxError('Unexpected end of JSON input'); } } : answer('ok')));
  const r = await chatFree(cfg, opts);
  assert.equal(r.model, ids[1]); assert.match(r.attempts[0].error, /^unreadable response body after \d+ ms/);
});

await t('200 with no choices is no_choices and falls through', async () => {
  stubBodies((m) => (m === ids[0] ? res(200, { usage: { cost: 0 } }) : answer('ok')));
  const r = await chatFree(cfg, opts);
  assert.equal(r.model, ids[1]); assert.deepEqual(r.attempts, [{ model: ids[0], error: 'no_choices', status: 200 }]);
});

await t('reasoning is requested low; an empty length-cut answer is retried once with reasoning off on the same model', async () => {
  const bodies = stubBodies((m, b, init, k) => (m === ids[0] && k === 1 ? answer('', 'length') : answer('ok')));
  const r = await chatFree(cfg, opts);
  assert.equal(r.model, ids[0]); assert.equal(bodies.length, 2);
  assert.equal(bodies[0].reasoning?.effort, 'low'); assert.deepEqual(bodies[1].reasoning, { enabled: false }); assert.equal(bodies[1].model, ids[0]);
});

await t('empty twice on one model: one retry, then the next model; empty without length is not retried', async () => {
  let bodies = stubBodies((m) => (m === ids[0] ? answer('', 'length') : answer('ok')));
  let r = await chatFree(cfg, opts);
  assert.equal(r.model, ids[1]); assert.equal(bodies.filter((b) => b.model === ids[0]).length, 2); assert.equal(r.attempts[0].error, 'empty');
  bodies = stubBodies((m) => (m === ids[0] ? answer('  ', 'stop') : answer('ok')));
  r = await chatFree(cfg, opts);
  assert.equal(r.model, ids[1]); assert.equal(bodies.filter((b) => b.model === ids[0]).length, 1);
});

await t('every model empty is the named stop, never ok:true', async () => {
  stubBodies(() => answer('', 'stop'));
  const r = await chatFree(cfg, opts);
  assert.equal(r.ok, false); assert.equal(r.stop, NO_FREE_MODEL_STOP); assert.equal(r.attempts.length, ids.length);
});

await t('429 Retry-After <= 30 s (header or OpenRouter metadata) is waited out once per model', async () => {
  let waits = [];
  stubBodies((m, b, init, k) => (m === ids[0] && k === 1 ? res(429, { error: { message: 'Rate limit exceeded' } }, { 'retry-after': '2' }) : answer('ok')));
  let r = await chatFree(cfg, { ...opts, sleep: noSleep(waits) });
  assert.equal(r.model, ids[0]); assert.deepEqual(waits, [2000]);
  waits = [];
  const bodies = stubBodies((m) => (m === ids[0] ? res(429, { error: { message: 'rate limited upstream', metadata: { headers: { 'Retry-After': '1' } } } }) : answer('ok')));
  r = await chatFree(cfg, { ...opts, sleep: noSleep(waits) });
  assert.equal(r.model, ids[1]); assert.deepEqual(waits, [1000]); assert.equal(bodies.filter((b) => b.model === ids[0]).length, 2);
});

await t('429 Retry-After over 30 s or past the route budget is not waited; a spent budget sends nothing', async () => {
  const waits = [];
  stubBodies((m) => (m === ids[0] ? res(429, { error: { message: 'Rate limit exceeded' } }, { 'retry-after': '45' }) : answer('ok')));
  assert.equal((await chatFree(cfg, { ...opts, sleep: noSleep(waits) })).model, ids[1]);
  stubBodies((m) => (m === ids[0] ? res(429, { error: { message: 'Rate limit exceeded' } }, { 'retry-after': '20' }) : answer('ok')));
  assert.equal((await chatFree(cfg, { ...opts, totalBudgetMs: 5000, sleep: noSleep(waits) })).model, ids[1]);
  assert.deepEqual(waits, []);
  const bodies = stubBodies(() => answer('ok'));
  const r = await chatFree(cfg, { ...opts, totalBudgetMs: 0 });
  assert.equal(r.ok, false); assert.equal(r.stop, NO_FREE_MODEL_STOP); assert.equal(bodies.length, 0);
});

await t('$0 guarantees hold on the reasoning retry: listed models only, no plugins, non-zero cost throws', async () => {
  const bodies = stubBodies((m, b, init, k) => (k === 1 ? answer('', 'length') : res(200, { choices: [{ message: { content: 'ok' } }], usage: { cost: 0.001 } })));
  await assert.rejects(chatFree(cfg, opts), CostViolation);
  assert.ok(bodies.every((b) => ids.includes(b.model) && !b.plugins));
});

await t('--ping asks with a realistic budget (max_tokens 5 is always empty on a reasoning model)', () => {
  const src = fs.readFileSync(path.join(ROOT, 'scripts/lib/free_llm_router.mjs'), 'utf8');
  const m = src.slice(src.indexOf("argv.includes('--ping')")).match(/chatFree\(cfg, \{[^}]*\}\], max_tokens: (\d+)/);
  assert.ok(m, 'the --ping chatFree call is found'); assert.ok(Number(m[1]) >= 100, `--ping max_tokens is ${m[1]}`);
});

if (n === 0) { console.error('free_llm_router tests: zero cases ran'); process.exit(1); }
console.log(`free_llm_router: ${n} behaviour pins pass`);
