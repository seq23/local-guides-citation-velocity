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
 * Every model call goes through scripts/lib/free_llm_router.mjs, which only
 * reaches the $0 models in config/llm_routing.json and fails the run if a
 * provider ever reports a non-zero cost. Owner policy 11 Oct 2026: nothing paid.
 * Grounded (web-plugin) runs bill per request and are refused.
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
import { loadRouting, freeModelIds, chatOnce, assertFreeRequest, receipt, CostViolation, PaidCallRefused, KEY_REFUSED_STOP, NO_KEY_STOP } from './lib/free_llm_router.mjs';

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

// Two modes, kept distinct because they measure different things.
//
//   knowledge (default) - ask without tools and see whether a model names us
//     unprompted. Weaker than a citation and never reported as one. Runs on the
//     $0 models in config/llm_routing.json, through the free router.
//   grounded - read the pages an answer was built from. Every grounded channel
//     (OpenRouter's web plugin / :online, Gemini search grounding) bills per
//     request whatever the model, so under the owner's zero-spend policy
//     (11 Oct 2026: "nothing should be paid ... cut the probes and make them
//     free") grounded mode is REFUSED by the router as a named stop.
//
// Before 11 Oct 2026 this ran daily in query-evidence-refresh.yml in grounded
// mode on openai/gpt-4o-mini + the parallel web plugin - paid every day. It is
// now dispatch-only (query-class-occupancy-probe.yml, confirm_paid) and cannot
// spend at all.

const queries = loadQueries();
if (!queries.length) { console.error('citation probe: no queries found'); process.exit(1); }

const now = new Date().toISOString();
const routing = loadRouting(ROOT);
function namedStop(reason) {
  console.log(`citation probe: NAMED STOP - ${reason}; mode=${MODE}; ${queries.length} queries ready, owned domains: ${OWNED.join(', ')}. Nothing generated, nothing spent, nothing recorded.`);
  console.log(`LLM ROUTER RECEIPT ${JSON.stringify(receipt(routing, { outcome: `NAMED STOP: ${reason}` }))}`);
  process.exit(0);
}
if (process.env.CONFIRM_PAID !== 'true') namedStop(routing.policy.probes_disabled_reason + ' - dispatch .github/workflows/query-class-occupancy-probe.yml with confirm_paid: true to run it on $0 models');
if (DRY) namedStop('dry_run');
if (GROUNDED) {
  try { assertFreeRequest(routing, { model: freeModelIds(routing)[0], plugins: [{ id: 'web' }] }); } catch (e) { namedStop(`grounded mode refused: ${e.message}`); }
}
const orKey = process.env.OPENROUTER_API_KEY || '';
if (!orKey) namedStop(NO_KEY_STOP);

const PROVIDER = 'openrouter';
const REQUEST_TIMEOUT_MS = Number(process.env.PROBE_TIMEOUT_MS || 25000);
async function askFree(query, model) {
  const r = await chatOnce(routing, { model, messages: [{ role: 'user', content: query }], max_tokens: 400, temperature: 0, key: orKey, timeoutMs: REQUEST_TIMEOUT_MS });
  if (!r.ok) return r;
  return { ok: true, answer: r.content, uris: [] };
}

const observations = [];
// Several $0 models, each reported separately: one model's idiosyncrasies are
// not a measurement. The list is config/llm_routing.json, nothing else.
const engines = freeModelIds(routing);
for (const q of queries) {
 for (const engineModel of engines) {
  let r;
  try {
    r = await askFree(q, engineModel);
  } catch (e) {
    if (e instanceof CostViolation || e instanceof PaidCallRefused) { console.error(`citation probe: ${e.message}`); process.exit(1); }
    r = { ok: false, error: String(e.message || e) };
  }
  if (!r.ok && r.credential_refused) namedStop(r.error === NO_KEY_STOP ? NO_KEY_STOP : KEY_REFUSED_STOP);
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
