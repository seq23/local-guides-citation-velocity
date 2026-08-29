#!/usr/bin/env node
/**
 * Ask an answer engine a real question and record whether it cites us.
 *
 * This is the measurement the portfolio did not have. The existing
 * query:test:zero-cost task makes no network calls at all - it prints a
 * worksheet and a CSV for a human to fill in by hand - so nothing has ever
 * observed whether these pages are cited. Every statement about AEO progress up
 * to now has been inference from proxies.
 *
 * Grounded runs go through OpenRouter's web plugin, and the response carries the
 * url_citation annotations the answer was actually built from. That is a citation
 * observation: the query, the engine, the domains it cited, and whether any of
 * them are ours.
 *
 * Gemini grounding is NOT usable here and is not selected automatically. Plain
 * generateContent returns 200; the same call with tools:[{google_search:{}}]
 * returns 429 RESOURCE_EXHAUSTED on this project across every model tried.
 *
 * What this does not claim: one engine is not all engines, grounding metadata is
 * not identical to what a user sees in an AI Overview, and absence on a given
 * day is weak evidence. Runs are recorded individually with timestamps so a
 * trend can be read later rather than a single run being treated as a verdict.
 *
 * Without an API key it exits 0 and records that it was skipped. A measurement
 * tool that fails the build when it cannot measure teaches people to remove it.
 *
 * Usage: node llm_citation_probe.mjs [--queries file] [--limit N] [--dry-run]
 */
import fs from 'node:fs';
import path from 'node:path';
// OpenRouter bills the web plugin per REQUEST on the parallel engine with 10
// results included - measured at $0.00127/call on this account against ~$0.04
// on the default engine's per-result billing. Identical url_citation schema.
const WEB_ENGINE = process.env.OPENROUTER_WEB_ENGINE || 'parallel';
const WEB_MODE = process.env.OPENROUTER_WEB_MODE || 'turbo';

const ROOT = process.cwd();
const argv = process.argv.slice(2);
const arg = (name, dflt) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : dflt; };
const DRY = argv.includes('--dry-run');
const MODE = arg('--mode', process.env.CITATION_PROBE_MODE || 'knowledge');
const GROUNDED = MODE === 'grounded';
const LIMIT = Number(arg('--limit', '25'));
const OUT = 'data/signals/llm_citation_observations.json';

const CONFIG_PATH = 'data/signals/citation_probe_config.json';
const config = fs.existsSync(path.join(ROOT, CONFIG_PATH))
  ? JSON.parse(fs.readFileSync(path.join(ROOT, CONFIG_PATH), 'utf8'))
  : {};
const OWNED = (config.owned_domains || []).map((d) => d.toLowerCase().replace(/^www\./, ''));
if (!OWNED.length) {
  console.error(`citation probe: no owned_domains in ${CONFIG_PATH} - cannot tell a citation of ours from anyone else's`);
  process.exit(1);
}

function loadQueries() {
  const file = arg('--queries', config.queries_file || 'data/seo/priority_queries.json');
  const full = path.join(ROOT, file);
  if (!fs.existsSync(full)) return [];
  const raw = JSON.parse(fs.readFileSync(full, 'utf8'));
  const rows = Array.isArray(raw) ? raw : (raw.queries || raw.priority_queries || raw.entries || []);
  return rows.map((r) => (typeof r === 'string' ? r : r.query || r.text || '')).filter(Boolean).slice(0, LIMIT);
}

const hostOf = (u) => { try { return new URL(u).hostname.toLowerCase().replace(/^www\./, ''); } catch { return ''; } };

// Two modes, kept distinct because they measure different things and conflating
// them would overstate what is known.
//
//   knowledge (default) - ask without tools and see whether the model names us
//     unprompted. This measures whether we exist in the model's answer at all.
//     It is free.
//   grounded - ask with Google Search grounding and read the sources the answer
//     was actually built from. This is a real citation observation, and it is
//     the stronger signal, but grounding is not free-tier eligible: it returns
//     quota errors on this key today.
//
// Default is knowledge, because a probe that cannot run costs more than a weaker
// probe that does.
async function ask(query, key, model, grounded) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(key)}`;
  const body = {
    contents: [{ role: 'user', parts: [{ text: query }] }],
    ...(grounded ? { tools: [{ google_search: {} }] } : {}),
    generationConfig: { temperature: 0 },
  };
  const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) return { ok: false, error: data?.error?.message || `HTTP ${res.status}` };
  const cand = data?.candidates?.[0] || {};
  const meta = cand.groundingMetadata || {};
  // Grounding chunks carry the pages the answer was actually built from. The
  // redirect wrapper Google returns is resolved where a real URI is present.
  const uris = [];
  for (const c of meta.groundingChunks || []) {
    const w = c.web || {};
    if (w.uri) uris.push(w.uri);
    if (w.domain) uris.push(`https://${w.domain}`);
  }
  for (const q of meta.webSearchQueries || []) void q;
  const answer = (cand.content?.parts || []).map((p) => p.text || '').join('\n');
  return { ok: true, answer, uris };
}

const queries = loadQueries();
if (!queries.length) { console.error('citation probe: no queries found'); process.exit(1); }

// OpenRouter is preferred when a key is present: its :free models cost nothing
// and asking several of them is a better sample than asking one. Gemini remains
// supported because it is the only one of the two that can ground an answer in
// live search, which is the stronger measurement when its quota allows.
const orKey = process.env.OPENROUTER_API_KEY || '';
const key = process.env.GEMINI_API_KEY || process.env.GOOGLE_GEMINI_API_KEY || '';
// Grounded mode is PINNED to OpenRouter. It is not a preference.
//
// Gemini grounded search is hard-blocked on this project. A plain
// generateContent call returns 200, but the same call carrying
// tools:[{google_search:{}}] returns 429 RESOURCE_EXHAUSTED - reproduced across
// three models, persistently, not a transient quota blip. The previous routing
// preferred Gemini whenever GEMINI_API_KEY happened to be present, so setting
// that key would have turned every grounded run into a wall of provider errors
// and, with the old summary arithmetic below, a recorded 0% citation rate. A
// false zero here is worse than no measurement: it reads as "no answer engine
// cites us" when in fact nothing was asked.
//
// --provider is still honoured so the block can be re-tested by hand, but
// nothing picks Gemini for grounded work on its own.
const PROVIDER = arg('--provider', GROUNDED
  ? 'openrouter'
  : (orKey ? 'openrouter' : 'gemini'));
if (GROUNDED && PROVIDER === 'gemini') {
  console.error('citation probe: grounded mode was pointed at gemini explicitly. Google Search grounding returns 429 RESOURCE_EXHAUSTED on this project; expect provider errors, not citations.');
}
// Three small models rather than one, because a single model's idiosyncrasies
// are not a measurement.
//
// These are the cheapest tier that actually answers, around two to three cents
// per million tokens - a full portfolio run costs roughly a cent. The genuinely
// free tier was tried first and is not usable for this: several :free models are
// agentic-harness only, others return upstream provider errors or hang with no
// response. A probe that silently reports zero because every model failed is
// worse than one that costs a cent and runs, so reliability wins here. Set
// OPENROUTER_MODELS to override, including back to :free variants.
const OR_MODELS = (process.env.OPENROUTER_MODELS || (config.openrouter_models || []).join(',') ||
  'ibm-granite/granite-4.0-h-micro,inclusionai/ling-3.0-flash,mistralai/mistral-nemo')
  .split(',').map((m) => m.trim()).filter(Boolean);

// Free models are heavily shared and some hang. Without a deadline one slow
// model stalls the whole run, which is how a measurement quietly stops being
// taken. A timed-out model is recorded as an error against that model, not as
// an absence of citations.
const REQUEST_TIMEOUT_MS = Number(process.env.PROBE_TIMEOUT_MS || 25000);
async function withTimeout(fn) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT_MS);
  try { return await fn(ctrl.signal); }
  finally { clearTimeout(t); }
}

// The web plugin runs the model against live web results. The pages it actually
// used come back as url_citation annotations, which is the retrieval observation
// the knowledge-mode call cannot produce - that one only shows whether the model
// memorised us during training, which is not a citation.
//
// Declared as an explicit plugin rather than the ":online" model suffix. The two
// are the same feature, but the plugin form takes max_results, and the number of
// slots read has to be a stated constant for occupancy shares to mean anything:
// "2 of our pages out of an unknown number of citations" is not a share.
const WEB_PLUGIN_MAX_RESULTS = Number(process.env.PROBE_WEB_MAX_RESULTS || 10);
const WEB_PLUGIN = [{ id: 'web', engine: WEB_ENGINE, mode: WEB_MODE, max_results: WEB_PLUGIN_MAX_RESULTS }];

function openRouterCitations(data) {
  const message = data?.choices?.[0]?.message || {};
  const urls = [];
  for (const annotation of message.annotations || []) {
    const url = annotation?.url_citation?.url;
    if (url) urls.push(url);
  }
  return [...new Set(urls)];
}

async function askOpenRouter(query, model, grounded = false) {
  const res = await withTimeout((signal) => fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    signal,
    headers: { 'content-type': 'application/json', authorization: `Bearer ${orKey}` },
    body: JSON.stringify({
      model, temperature: 0, max_tokens: 400,
      ...(grounded ? { plugins: WEB_PLUGIN } : {}),
      messages: [{ role: 'user', content: query }],
    }),
  }));
  const data = await res.json().catch(() => ({}));
  if (!res.ok) return { ok: false, error: data?.error?.message || `HTTP ${res.status}` };
  const answer = data?.choices?.[0]?.message?.content || '';
  return { ok: true, answer, uris: grounded ? openRouterCitations(data) : [] };
}
const model = process.env.GEMINI_MODEL || 'gemini-3.6-flash';
const now = new Date().toISOString();

const haveKey = PROVIDER === 'openrouter' ? Boolean(orKey) : Boolean(key);
if (!haveKey || DRY) {
  const reason = DRY ? 'dry_run' : 'no_api_key';
  console.log(`citation probe: skipped (${reason}); mode=${MODE}; ${queries.length} queries ready, owned domains: ${OWNED.join(', ')}`);
  process.exit(0);
}

const observations = [];
// One model can be idiosyncratic. Asking several and reporting each separately
// says more than averaging them into a single number would.
// Knowledge mode asks several cheap models because one model's idiosyncrasies
// are not a measurement. Grounded mode bills per search - around $0.007 a query
// - and the thing being measured is which pages the retrieval layer returns,
// which does not vary much by model. One model keeps a portfolio-wide run in
// cents. Override with OPENROUTER_GROUNDED_MODELS.
//
// openai/gpt-4o-mini is the default because it is the model this call shape was
// actually verified against end to end: it returned ten url_citation annotations
// carrying real URLs. Cheaper models answer, but the citation annotations are the
// thing being measured, and a model that answers without them measures nothing.
const GROUNDED_MODELS = (process.env.OPENROUTER_GROUNDED_MODELS || 'openai/gpt-4o-mini')
  .split(',').map((m) => m.trim()).filter(Boolean);
const engines = PROVIDER === 'openrouter' ? (GROUNDED ? GROUNDED_MODELS : OR_MODELS) : [model];
for (const q of queries) {
 for (const engineModel of engines) {
  let r;
  try {
    r = PROVIDER === 'openrouter' ? await askOpenRouter(q, engineModel, GROUNDED) : await ask(q, key, engineModel, GROUNDED);
  } catch (e) { r = { ok: false, error: String(e.message || e) }; }
  if (!r.ok) {
    observations.push({ query: q, engine: `${PROVIDER}:${engineModel}`, mode: MODE, observed_at: now, status: 'provider_error', error: r.error });
    console.log(`  ERROR  ${engineModel} :: ${q} :: ${String(r.error).slice(0, 70)}`);
    continue;
  }
  const domains = [...new Set(r.uris.map(hostOf).filter(Boolean))];
  const ours = domains.filter((d) => OWNED.some((o) => d === o || d.endsWith(`.${o}`)));
  // In knowledge mode there are no grounded sources, so presence means the model
  // named the brand or domain in its own answer.
  const answerLower = (r.answer || '').toLowerCase();
  const named = OWNED.filter((o) => answerLower.includes(o) || answerLower.includes(o.split('.')[0]));
  observations.push({
    query: q, engine: `${PROVIDER}:${engineModel}`, mode: MODE, observed_at: now,
    status: 'observed',
    slots_read: domains.length,
    cited_domains: domains,
    cited_ours: ours,
    self_cited: GROUNDED ? ours.length > 0 : named.length > 0,
    named_in_answer: named,
    answer_mentions_brand: named.length > 0,
  });
  const hit = GROUNDED ? ours.length > 0 : named.length > 0;
  console.log(`  ${hit ? 'PRESENT' : '   --  '} ${engineModel.split('/').pop()} :: ${q}${hit ? ` (${(GROUNDED ? ours : named).join(', ')})` : ''}`);
 }
}

const prior = fs.existsSync(path.join(ROOT, OUT))
  ? JSON.parse(fs.readFileSync(path.join(ROOT, OUT), 'utf8'))
  : { schema_version: '1.0', runs: [] };
// The rolling window truncates loudly or not at all.
//
// This was a bare `prior.runs = (prior.runs || []).slice(-49);` - no constant, no
// comment, no counter. At one run a day the oldest reading would start silently
// falling off the end around 2026-10-15, and nothing in the file or the repo would
// ever say a reading had existed. That is the same shape as the occupancy
// truncation that deleted 170 paid grounded measurements on 2026-08-29 and exited
// 0: a rolling-window file whose only record of its own depth is the file itself
// cannot notice it has been truncated. So the window keeps a running total of what
// it has dropped and the run_at stamp of every dropped run, and a validator checks
// that total against a high-water mark.
const MAX_RETAINED_RUNS = 50;
const allRuns = [...(prior.runs || []), { run_at: now, provider: PROVIDER, engines, mode: MODE, queries: queries.length, observations }];
const overflow = allRuns.length > MAX_RETAINED_RUNS ? allRuns.slice(0, allRuns.length - MAX_RETAINED_RUNS) : [];
prior.runs = overflow.length ? allRuns.slice(-MAX_RETAINED_RUNS) : allRuns;
prior.max_retained_runs = MAX_RETAINED_RUNS;
prior.runs_discarded_total = Number(prior.runs_discarded_total || 0) + overflow.length;
prior.runs_discarded_at = [...(prior.runs_discarded_at || []), ...overflow.map((r) => r.run_at)];
if (overflow.length) {
  console.error(`citation probe: the rolling window dropped ${overflow.length} run(s) (${overflow.map((r) => r.run_at).join(', ')}); ${prior.runs_discarded_total} run(s) discarded in total. These readings are gone from this file - they are only recoverable from git history.`);
}

const cited = observations.filter((o) => o.self_cited).length;
const errored = observations.filter((o) => o.status === 'provider_error').length;
// A rate is only a rate over the observations the provider actually answered.
//
// The old denominator was every observation attempted, so a run in which the
// provider errored on all 25 queries divided 0 by 25 and recorded 0% - a number
// that reads as "no answer engine cites us" when nothing was ever asked. That is
// the false-zero failure mode this repo keeps having to undo. The rate is now
// computed over answered observations only and is null when there are none, and
// the run carries an explicit measurement_status so a consumer cannot mistake an
// unanswered run for a measured absence.
const answered = observations.filter((o) => o.status === 'observed').length;
const measurementStatus = answered > 0
  ? 'MEASURED'
  : (observations.length ? 'NOT_MEASURED_PROVIDER_ERROR' : 'NOT_MEASURED_NO_QUERIES');
const thisRunSummary = {
  run_at: now, provider: PROVIDER, engines, mode: MODE,
  queries: queries.length, observations: observations.length,
  answered, self_cited: cited, errored,
  measurement_status: measurementStatus,
  _mode_note: GROUNDED
    ? 'grounded: counted when the answer was built from one of our pages'
    : 'knowledge: counted when the model named us unprompted, with no retrieval. Weaker than a citation and must not be reported as one.',
  _rate_denominator: 'answered observations only; a provider error is not a measured absence of citations',
  self_cited_rate_pct: answered ? Number(((100 * cited) / answered).toFixed(1)) : null,
};

// A failed run must not overwrite the last real measurement.
//
// `prior.latest_summary` used to be assigned unconditionally. Reproduced with an
// invalid API key: one run of provider errors replaced a MEASURED summary
// (25 answered, a real rate) with
// {"answered":0,"measurement_status":"NOT_MEASURED_PROVIDER_ERROR","self_cited_rate_pct":null}
// stamped with today's timestamp. The per-run history in runs[] survived, so the
// reading was technically recoverable - but latest_summary is the field a reader,
// a dashboard or a downstream script reaches for first, and it had been replaced by
// a null wearing today's date. One bad key day erases the last known citation rate.
//
// So: latest_summary now holds only MEASURED runs. Every run, measured or not, is
// stamped into latest_attempt, and a non-measured attempt is named there rather
// than presented as a measurement of zero.
prior.latest_attempt = thisRunSummary;
if (measurementStatus === 'MEASURED') {
  prior.latest_summary = thisRunSummary;
} else if (!prior.latest_summary) {
  // Nothing has ever been measured. Say that, rather than leaving a shape that
  // looks like a summary with nulls in it.
  prior.latest_summary = null;
}
prior._latest_summary_contract = 'latest_summary is the most recent MEASURED run and is never overwritten by a failed one; latest_attempt is the most recent run of any kind. If latest_attempt.measurement_status is not MEASURED, latest_summary is older than latest_attempt.run_at and must be read with that date, not today\'s.';

fs.mkdirSync(path.join(ROOT, path.dirname(OUT)), { recursive: true });
fs.writeFileSync(path.join(ROOT, OUT), JSON.stringify(prior, null, 2) + '\n');
const rate = thisRunSummary.self_cited_rate_pct;
console.log(`citation probe [${PROVIDER}/${MODE}]: ${measurementStatus}; ${cited}/${answered} answered observations named one of our domains (${rate === null ? 'no rate - nothing was answered' : `${rate}%`}); ${errored} provider error(s). Recorded in ${OUT}`);
if (measurementStatus !== 'MEASURED' && prior.latest_summary) {
  console.log(`citation probe: latest_summary is UNCHANGED and still carries the last measured run (${prior.latest_summary.run_at}, ${prior.latest_summary.self_cited_rate_pct}%). A failed run does not replace a measurement.`);
}
// Rule: a probe that measured nothing must say so loudly rather than leaving a
// zero behind. It still records the error state above before exiting.
if (measurementStatus !== 'MEASURED') {
  console.error(`citation probe: ${measurementStatus} - ${errored} provider error(s) across ${observations.length} attempt(s). No citation rate was recorded.`);
  process.exit(1);
}
