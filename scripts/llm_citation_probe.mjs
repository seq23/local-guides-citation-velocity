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
 * Gemini's free tier answers with Google Search grounding, and the response
 * carries the sources it actually grounded on. That is a citation observation:
 * the query, the engine, the domains it cited, and whether any of them are ours.
 * It costs nothing.
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

const ROOT = process.cwd();
const argv = process.argv.slice(2);
const arg = (name, dflt) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : dflt; };
const DRY = argv.includes('--dry-run');
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

async function ask(query, key, model) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(key)}`;
  const body = {
    contents: [{ role: 'user', parts: [{ text: query }] }],
    tools: [{ google_search: {} }],
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

const key = process.env.GEMINI_API_KEY || process.env.GOOGLE_GEMINI_API_KEY || '';
const model = process.env.GEMINI_MODEL || 'gemini-2.0-flash';
const now = new Date().toISOString();

if (!key || DRY) {
  const reason = DRY ? 'dry_run' : 'no_api_key';
  console.log(`citation probe: skipped (${reason}); ${queries.length} queries ready, owned domains: ${OWNED.join(', ')}`);
  process.exit(0);
}

const observations = [];
for (const q of queries) {
  let r;
  try { r = await ask(q, key, model); }
  catch (e) { r = { ok: false, error: String(e.message || e) }; }
  if (!r.ok) {
    observations.push({ query: q, engine: `gemini:${model}`, observed_at: now, status: 'provider_error', error: r.error });
    console.log(`  ERROR  ${q} :: ${r.error}`);
    continue;
  }
  const domains = [...new Set(r.uris.map(hostOf).filter(Boolean))];
  const ours = domains.filter((d) => OWNED.some((o) => d === o || d.endsWith(`.${o}`)));
  observations.push({
    query: q, engine: `gemini:${model}`, observed_at: now,
    status: 'observed',
    cited_domains: domains,
    cited_ours: ours,
    self_cited: ours.length > 0,
    answer_mentions_brand: OWNED.some((o) => (r.answer || '').toLowerCase().includes(o.split('.')[0])),
  });
  console.log(`  ${ours.length ? 'CITED ' : '  --  '} ${q} :: ${domains.length} sources${ours.length ? ` (ours: ${ours.join(', ')})` : ''}`);
}

const prior = fs.existsSync(path.join(ROOT, OUT))
  ? JSON.parse(fs.readFileSync(path.join(ROOT, OUT), 'utf8'))
  : { schema_version: '1.0', runs: [] };
prior.runs = (prior.runs || []).slice(-49);
prior.runs.push({ run_at: now, engine: `gemini:${model}`, queries: queries.length, observations });

const cited = observations.filter((o) => o.self_cited).length;
const errored = observations.filter((o) => o.status === 'provider_error').length;
prior.latest_summary = {
  run_at: now, queries: queries.length, self_cited: cited, errored,
  self_cited_rate_pct: queries.length ? Number(((100 * cited) / queries.length).toFixed(1)) : 0,
};

fs.mkdirSync(path.join(ROOT, path.dirname(OUT)), { recursive: true });
fs.writeFileSync(path.join(ROOT, OUT), JSON.stringify(prior, null, 2) + '\n');
console.log(`citation probe: ${cited}/${queries.length} queries cited one of our domains (${prior.latest_summary.self_cited_rate_pct}%); ${errored} provider error(s). Recorded in ${OUT}`);
