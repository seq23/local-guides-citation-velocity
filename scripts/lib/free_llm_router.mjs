#!/usr/bin/env node
/**
 * The ONLY door to a language model in this repo, and it opens on $0 models only.
 *
 * Owner policy, 11 Oct 2026, verbatim: "nothing should be paid ... cut the probes
 * and make them free." Before this router the citation probes called OpenRouter
 * every day with paid models and the billed web plugin (see docs/cost/zero-paid-llm.md).
 *
 * What this enforces, read from config/llm_routing.json:
 *   - policy.max_cost_usd is 0. Anything else and the router refuses to load.
 *   - Only models listed in the config, and only if every pricing field in the
 *     committed snapshot is 0. No other model id is ever sent.
 *   - No web plugin, no ":online" suffix: those bill per request whatever the model.
 *   - Every response's reported cost (usage.cost, with usage accounting on) must be
 *     0. A non-zero cost throws CostViolation and the caller exits non-zero: a paid
 *     call is a loud failure, never a quiet line in a log.
 *   - If no listed model answers, the result is a NAMED STOP and nothing is
 *     generated. There is no paid fallback, by construction: the only ids this
 *     module can send are the ids in the config.
 *   - A refused credential (401, 402, a key-shaped error message, or a 403 the
 *     key-info check confirms) is its own named stop, distinct from "no free model
 *     answered", so a receipt never confuses a dead key with a model outage.
 *   - A 403/404 for ONE model is that model's refusal, not the key's: OpenRouter
 *     403s some :free models per model (e.g. "only available on agentic harnesses")
 *     while the key answers GET /api/v1/auth/key 200 and other $0 models answer.
 *     The router records the attempt and tries the next listed model; only if
 *     auth/key itself refuses the key does a 403 become the credential stop.
 *   - An answer is non-empty text. A body read that fails (a timeout that fires
 *     after OpenRouter sent the headers of a slow answer) is an error with its
 *     elapsed ms, a reply with no choices is `no_choices`, and an empty answer is
 *     never an answer: chatFree tries the next $0 model (16 Oct 2026, WPP-llm
 *     #42/#43: a swallowed body timeout and nemotron's reasoning trace eating
 *     max_tokens both looked like empty answers and stopped the route).
 *   - Reasoning models (nemotron :free) are asked for low reasoning effort; an
 *     empty answer cut off by length is retried once with reasoning switched off.
 *   - A 429's Retry-After (<= 30 s) is waited out once per model, inside one
 *     bounded total route budget (DEFAULT_TOTAL_BUDGET_MS).
 *
 * CLI:
 *   node scripts/lib/free_llm_router.mjs --receipt   policy receipt, no network
 *   node scripts/lib/free_llm_router.mjs --ping      key identity (label/limit/usage, never the key) + one tiny $0 call
 *   node scripts/lib/free_llm_router.mjs --refresh   re-snapshot the $0 model list (keyless)
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROUTING_REL = 'config/llm_routing.json';
export const KEY_REFUSED_STOP = 'OpenRouter key disabled or invalid; free routing needs an enabled key with a $0 limit';
export const NO_KEY_STOP = 'OPENROUTER_API_KEY is not set; free routing needs an enabled key with a $0 limit';
export const NO_FREE_MODEL_STOP = 'no free model answered; nothing generated (the router never falls back to a paid model)';

export class PolicyError extends Error { constructor(m) { super(m); this.name = 'PolicyError'; } }
export class PaidCallRefused extends Error { constructor(m) { super(m); this.name = 'PaidCallRefused'; } }
export class CostViolation extends Error { constructor(m) { super(m); this.name = 'CostViolation'; } }

const isZero = (v) => v === undefined || v === null || Number(v) === 0;

export function loadRouting(root = process.cwd()) {
  const abs = path.join(root, ROUTING_REL);
  if (!fs.existsSync(abs)) throw new PolicyError(`${ROUTING_REL} is missing; no model may be called without the routing policy`);
  const cfg = JSON.parse(fs.readFileSync(abs, 'utf8'));
  const p = cfg.policy || {};
  if (p.max_cost_usd !== 0) throw new PolicyError(`${ROUTING_REL} policy.max_cost_usd is ${JSON.stringify(p.max_cost_usd)}; owner policy is a hard 0`);
  if (p.paid_fallback !== false) throw new PolicyError(`${ROUTING_REL} policy.paid_fallback must be false`);
  if (p.web_plugin_allowed !== false) throw new PolicyError(`${ROUTING_REL} policy.web_plugin_allowed must be false (the web plugin bills per request)`);
  const models = Array.isArray(cfg.models) ? cfg.models : [];
  if (!models.length) throw new PolicyError(`${ROUTING_REL} lists no models`);
  for (const m of models) {
    const nonZero = Object.entries(m.pricing || {}).filter(([, v]) => !isZero(v));
    if (!m.pricing || !('prompt' in m.pricing) || !('completion' in m.pricing) || nonZero.length) {
      throw new PolicyError(`${ROUTING_REL} model ${m.id} is not a $0 model (${nonZero.map(([k, v]) => `${k}=${v}`).join(', ') || 'no pricing snapshot'})`);
    }
    if (String(m.id).endsWith(':online')) throw new PolicyError(`${ROUTING_REL} model ${m.id} carries the billed :online suffix`);
  }
  return cfg;
}

export function freeModelIds(cfg) { return cfg.models.map((m) => m.id); }

export function receipt(cfg, extra = {}) {
  return {
    router: 'scripts/lib/free_llm_router.mjs',
    policy: { max_cost_usd: cfg.policy.max_cost_usd, paid_fallback: cfg.policy.paid_fallback, web_plugin_allowed: cfg.policy.web_plugin_allowed, probes_scheduled: cfg.policy.probes_scheduled },
    free_models: freeModelIds(cfg),
    snapshot_date: cfg.snapshot_date,
    ...extra,
  };
}

/** Refuse anything that would bill, before a request exists. */
export function assertFreeRequest(cfg, { model, plugins } = {}) {
  if (plugins && plugins.length) throw new PaidCallRefused(`web/plugin calls bill per request; refused by ${ROUTING_REL} (max_cost_usd 0)`);
  if (!model || String(model).endsWith(':online')) throw new PaidCallRefused(`model "${model}" is a billed :online/grounded call; refused (max_cost_usd 0)`);
  if (!freeModelIds(cfg).includes(model)) throw new PaidCallRefused(`model "${model}" is not in the $0 list in ${ROUTING_REL}; refused (max_cost_usd 0)`);
}

// Reasoning models spend completion tokens on a hidden trace; ask for little of it,
// and switch it off for the one retry of an empty, length-cut answer.
export const REASONING_FIRST = Object.freeze({ effort: 'low', exclude: true });
export const REASONING_OFF = Object.freeze({ enabled: false });
export const MAX_RETRY_AFTER_MS = 30000;
export const DEFAULT_TOTAL_BUDGET_MS = 300000;
export const NO_CHOICES = 'no_choices';
export const EMPTY_ANSWER = 'empty';

/**
 * fetch + JSON body inside ONE timeout. OpenRouter sends headers early on a slow
 * answer, so the abort often lands while the body downloads: that is a timeout
 * (thrown, with elapsed ms), never an empty answer. A 2xx whose body cannot be
 * read is thrown too; a non-2xx with an unreadable body keeps its status.
 */
async function fetchJson(url, init, timeoutMs) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  const t0 = Date.now();
  try {
    let res;
    try { res = await fetch(url, { ...init, signal: ctrl.signal }); } catch (e) {
      if (ctrl.signal.aborted || e?.name === 'AbortError') throw new Error(`timeout after ${Date.now() - t0} ms waiting for headers (limit ${timeoutMs} ms)`);
      throw new Error(`request failed after ${Date.now() - t0} ms: ${String(e?.message || e)}`);
    }
    let data;
    try { data = await res.json(); } catch (e) {
      const ms = Date.now() - t0;
      if (ctrl.signal.aborted || e?.name === 'AbortError' || /abort|timeout/i.test(String(e?.message))) throw new Error(`timeout after ${ms} ms reading the response body (HTTP ${res.status} headers arrived; limit ${timeoutMs} ms)`);
      if (res.ok) throw new Error(`unreadable response body after ${ms} ms (HTTP ${res.status}): ${String(e?.message || e)}`);
      data = {};
    }
    return { res, data, elapsed_ms: Date.now() - t0 };
  } finally { clearTimeout(t); }
}

/** Retry-After (seconds or HTTP date), OpenRouter's error metadata, or X-RateLimit-Reset (epoch ms). */
export function retryAfterMs(res, data) {
  const h = (n) => (typeof res?.headers?.get === 'function' ? res.headers.get(n) : null);
  const meta = data?.error?.metadata?.headers || {};
  const ra = h('retry-after') ?? meta['Retry-After'] ?? meta['retry-after'] ?? null;
  if (ra !== null && ra !== undefined && String(ra).trim() !== '') {
    const secs = Number(ra);
    if (Number.isFinite(secs)) return Math.max(0, secs * 1000);
    const at = Date.parse(String(ra));
    if (Number.isFinite(at)) return Math.max(0, at - Date.now());
  }
  const reset = Number(h('x-ratelimit-reset') ?? meta['X-RateLimit-Reset'] ?? NaN);
  if (Number.isFinite(reset) && reset > 0) return Math.max(0, reset - Date.now());
  return null;
}
const realSleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Credential-shaped message: about the KEY, never a model ("model disabled" is per model).
const KEY_MESSAGE = /\bkey\b[^.]*\b(disabled|invalid|limit)|\b(disabled|invalid)\b[^.]*\bkey\b|no auth|user not found|unauthori[sz]ed/i;
/** True only when the CREDENTIAL is refused. 403/404 alone are per-model (see header). */
export const keyRefused = (status, msg) => status === 401 || status === 402 || KEY_MESSAGE.test(String(msg || ''));
/** A per-model refusal that might still hide a dead key; confirmed against auth/key. */
const perModelRefusal = (status) => status === 403 || status === 404;

/**
 * One call to one listed $0 model. Returns { ok, model, content, data, cost,
 * finish_reason } or { ok:false, error, credential_refused }. ok:true may carry
 * empty content (finish_reason says why); chatFree never counts that as an answer.
 * An empty answer cut off by length (a reasoning trace that ate max_tokens) is
 * retried once on the same model with reasoning off. Throws PaidCallRefused
 * before sending anything billable and CostViolation on a non-zero cost.
 */
export async function chatOnce(cfg, { model, messages, max_tokens = 400, temperature = 0, key = process.env.OPENROUTER_API_KEY || '', timeoutMs = 30000, plugins, reasoning = REASONING_FIRST } = {}) {
  assertFreeRequest(cfg, { model, plugins });
  if (!key) return { ok: false, model, error: NO_KEY_STOP, credential_refused: true };
  const once = async (reasoningOpt) => {
    let res; let data; let elapsed;
    try {
      ({ res, data, elapsed_ms: elapsed } = await fetchJson(cfg.endpoint || 'https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
        body: JSON.stringify({ model, messages, max_tokens, temperature, reasoning: reasoningOpt, usage: { include: true } }),
      }, timeoutMs));
    } catch (e) {
      return { ok: false, model, error: String(e?.message || e).slice(0, 160), credential_refused: false };
    }
    const errMsg = data?.error?.message;
    if (!res.ok || errMsg) {
      return { ok: false, model, status: res.status, error: errMsg || `HTTP ${res.status}`, credential_refused: keyRefused(res.status, errMsg), retry_after_ms: res.status === 429 ? retryAfterMs(res, data) : null };
    }
    const cost = data?.usage?.cost;
    if (cost !== undefined && cost !== null && Number(cost) !== 0) {
      throw new CostViolation(`OpenRouter reported cost ${cost} USD for ${model} (generation ${data?.id || 'unknown'}). max_cost_usd is 0: failing the run.`);
    }
    const choices = Array.isArray(data?.choices) ? data.choices : [];
    if (!choices.length) return { ok: false, model, status: res.status, error: NO_CHOICES, credential_refused: false, elapsed_ms: elapsed };
    const msg = choices[0]?.message || {};
    const content = typeof msg.content === 'string' ? msg.content : '';
    const reasoningChars = typeof msg.reasoning === 'string' ? msg.reasoning.length : 0;
    return { ok: true, model, content, finish_reason: choices[0]?.finish_reason ?? null, reasoning_chars: reasoningChars, reasoning: reasoningOpt === REASONING_OFF ? 'off' : 'low', elapsed_ms: elapsed, data, cost: cost ?? null, cost_reported: cost !== undefined && cost !== null };
  };
  const r = await once(reasoning);
  if (r.ok && !r.content.trim() && reasoning !== REASONING_OFF && (r.finish_reason === 'length' || r.reasoning_chars > 0)) {
    const r2 = await once(REASONING_OFF);
    return { ...r2, first_try: { finish_reason: r.finish_reason, reasoning_chars: r.reasoning_chars } };
  }
  return r;
}

/**
 * Try each listed $0 model in order. First NON-EMPTY answer wins; an empty one,
 * a timeout or `no_choices` falls through to the next model. A 429 with
 * Retry-After <= 30 s is waited out once per model. Everything runs inside one
 * total budget (totalBudgetMs); models past it are recorded as skipped. Never
 * reaches a model outside the list. Returns { ok:true, ... } or { ok:false, stop, attempts }.
 */
export async function chatFree(cfg, opts = {}) {
  const { totalBudgetMs = DEFAULT_TOTAL_BUDGET_MS, sleep = realSleep, ...rest } = opts;
  const deadline = Date.now() + totalBudgetMs;
  const perCall = rest.timeoutMs ?? 30000;
  const attempts = [];
  let keyChecked = null;
  for (const model of freeModelIds(cfg)) {
    let waited = false;
    for (;;) {
      const left = deadline - Date.now();
      if (left <= 0) { attempts.push({ model, error: 'skipped: total route budget spent', status: null }); break; }
      const r = await chatOnce(cfg, { ...rest, model, timeoutMs: Math.min(perCall, left) });
      if (r.ok && r.content.trim()) return { ...r, attempts };
      if (r.ok) { attempts.push({ model, error: EMPTY_ANSWER, status: null, finish_reason: r.finish_reason, reasoning: r.reasoning }); break; }
      attempts.push({ model, error: r.error, status: r.status ?? null });
      if (r.credential_refused) return { ok: false, stop: r.error === NO_KEY_STOP ? NO_KEY_STOP : KEY_REFUSED_STOP, attempts };
      if (perModelRefusal(r.status)) {
        // One model's 403/404 is not the key's. Ask auth/key once: an HTTP refusal
        // there is the credential stop; a live key means try the next model.
        if (keyChecked === null) keyChecked = await keyInfo(rest.key ?? (process.env.OPENROUTER_API_KEY || ''));
        if (keyChecked.status && keyChecked.status >= 400) return { ok: false, stop: KEY_REFUSED_STOP, attempts, key_check: keyChecked.error };
      }
      const wait = r.status === 429 ? r.retry_after_ms : null;
      if (wait !== null && wait !== undefined && !waited && wait <= MAX_RETRY_AFTER_MS && Date.now() + wait < deadline) {
        waited = true;
        await sleep(wait);
        continue;
      }
      break;
    }
  }
  return { ok: false, stop: NO_FREE_MODEL_STOP, attempts };
}

/**
 * Which key is this? GET /api/v1/auth/key with the repo secret, returning ONLY
 * label, limit, usage, is_free_tier, limit_remaining - never the key itself. Part
 * of every --ping receipt (key_label) so a report can show which key each repo uses.
 */
export async function keyInfo(key = process.env.OPENROUTER_API_KEY || '') {
  if (!key) return { error: 'no key' };
  try {
    const { res, data } = await fetchJson('https://openrouter.ai/api/v1/auth/key', { headers: { authorization: `Bearer ${key}` } }, 15000);
    if (!res.ok) return { status: res.status, error: `HTTP ${res.status}${data?.error?.message ? ` ${data.error.message}` : ''}`.slice(0, 160) };
    const d = data?.data || {};
    return { key_label: d.label ?? null, limit: d.limit ?? null, usage: d.usage ?? null, is_free_tier: d.is_free_tier ?? null, limit_remaining: d.limit_remaining ?? null };
  } catch (e) {
    return { error: String(e?.message || e).slice(0, 160) };
  }
}

async function refresh(root) {
  const { data } = await fetchJson('https://openrouter.ai/api/v1/models', {}, 30000);
  const all = data?.data || [];
  const free = all.filter((m) => m.pricing && m.pricing.prompt === '0' && m.pricing.completion === '0'
    && Object.values(m.pricing).every(isZero)
    && (m.architecture?.output_modalities || ['text']).join() === 'text' && (m.context_length || 0) >= 32768);
  const cfgPath = path.join(root, ROUTING_REL);
  const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
  const byId = new Map(free.map((m) => [m.id, m]));
  const kept = cfg.models.filter((m) => byId.has(m.id)).map((m) => ({ id: m.id, name: byId.get(m.id).name, context_length: byId.get(m.id).context_length, pricing: byId.get(m.id).pricing }));
  const dropped = cfg.models.filter((m) => !byId.has(m.id)).map((m) => m.id);
  if (!kept.length) { console.error(`refresh: none of the configured models is still $0; ${free.length} $0 models exist - choose replacements by hand. Nothing written.`); process.exit(1); }
  cfg.models = kept;
  cfg.snapshot_date = new Date().toISOString().slice(0, 10);
  cfg.snapshot_free_model_count = free.length;
  fs.writeFileSync(cfgPath, JSON.stringify(cfg, null, 2) + '\n');
  console.log(`refresh: ${kept.length} model(s) kept, dropped ${dropped.join(', ') || 'none'}; ${free.length} $0 text models listed live`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const root = process.cwd();
  const argv = process.argv.slice(2);
  if (argv.includes('--refresh')) { await refresh(root); process.exit(0); }
  const cfg = loadRouting(root);
  if (argv.includes('--ping')) {
    const key = await keyInfo();
    // A realistic budget: a reasoning model given 5 tokens always answers empty.
    const r = await chatFree(cfg, { messages: [{ role: 'user', content: 'Reply with the single word: ok' }], max_tokens: 200, timeoutMs: 60000, totalBudgetMs: 120000 });
    const outcome = r.ok ? `FREE MODEL ANSWERED: ${r.model} (reported cost ${r.cost_reported ? r.cost : 'not reported'})` : `NAMED STOP: ${r.stop}`;
    console.log(`LLM ROUTER KEY ${JSON.stringify(key)}`);
    console.log(`LLM ROUTER RECEIPT ${JSON.stringify(receipt(cfg, { outcome, key, attempts: r.attempts }))}`);
    console.log(outcome);
    process.exit(0);
  }
  console.log(`LLM ROUTER RECEIPT ${JSON.stringify(receipt(cfg))}`);
}
