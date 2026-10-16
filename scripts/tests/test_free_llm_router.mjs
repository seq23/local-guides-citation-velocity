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

if (n === 0) { console.error('free_llm_router tests: zero cases ran'); process.exit(1); }
console.log(`free_llm_router: ${n} behaviour pins pass`);
