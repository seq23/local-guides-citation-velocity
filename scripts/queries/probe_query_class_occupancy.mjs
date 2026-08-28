#!/usr/bin/env node
/**
 * Citation occupancy probe: who holds the citation slots an answer engine builds
 * its answer from, per query class.
 *
 * What changed and why
 * --------------------
 * The first version of this probe read the top ten organic hosts off a Bing SERP.
 * That was wrong twice over.
 *
 *   1. Bing blocks this. It serves a JavaScript shell - one b_algo node, no
 *      outbound links - to residential clients AND to GitHub Actions egress. The
 *      only run this probe ever had discarded 16 of 16 probes, including both
 *      controls, and still exited 0. A probe whose single run measured nothing and
 *      reported success is not a measurement channel, it is a silence generator.
 *   2. Even working, a SERP slot is the wrong unit. What this repo publishes
 *      against is answer-engine citation, and a page can only win a citation slot
 *      that is open. The question is who the answer engine actually cites, not who
 *      ranks.
 *
 * So the channel is now the same OpenRouter web-plugin call the citation probe
 * uses: ask the query, read back the url_citation annotations the answer was
 * actually built from, and classify each cited host. That channel is verified
 * working from both residential and Actions egress, which Bing is not.
 *
 * Method
 * ------
 * One call per query, openai/gpt-4o-mini with plugins:[{id:'web',max_results:10}].
 * Read the cited hosts in the order the annotations arrive. Classify each slot:
 *   owned     - one of our own domains; we already hold it
 *   social    - reddit/youtube/tiktok/instagram/x/facebook/linkedin/medium
 *   national  - a national consumer brand, marketplace, publisher, or .gov/.edu
 *   unbranded - anything else, i.e. a slot an independent microsite can hold
 *
 * citation_occupancy is unbranded_share: the fraction of the citation slots on
 * this query that an independent page could plausibly take. That is the
 * winnability signal the atlas and the release join consume.
 *
 * Honesty rules
 * -------------
 *   - A probe whose provider errored, or that returned no citation annotations at
 *     all, is DISCARDED. It is never recorded as zero occupancy. A degraded
 *     channel is not a measurement, and a false zero here would read as "nothing
 *     is winnable" and quietly stop publishing.
 *   - cited_hosts_in_order is always recorded so any share can be re-derived.
 *   - The run EXITS NON-ZERO if it measured nothing, or if it could not measure
 *     the controls. The previous version exited 0 on a total wipeout.
 *   - The two dentistry controls are carried so a run can be checked against a
 *     known result. Their priors were taken on Bing SERP slots; this probe reads
 *     answer-engine citations, so the prior is recorded alongside but the run is
 *     NOT failed on divergence - it is flagged as a channel change, not drift.
 *
 * Not measured: the egress IP is not pinned, so "near me" classes resolve against
 * whatever region the runner sits in. Same caveat the original carried.
 *
 * Usage: node probe_query_class_occupancy.mjs [panel.json] [out.json] [--atlas-top N]
 */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const argv = process.argv.slice(2);
const flag = (name, dflt) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : dflt; };
const positional = argv.filter((a, i) => !a.startsWith('--') && !(i > 0 && argv[i - 1].startsWith('--')));

const NATIONAL = /^(www\.)?(yelp|zocdoc|healthline|mayoclinic|clevelandclinic|webmd|findlaw|justia|nolo|avvo|angi|thumbtack|houzz|theknot|weddingwire|indeed|glassdoor|amazon|walmart|etsy|pinterest|quora|wikipedia|forbes|nerdwallet|investopedia|bankrate|experian|equifax|transunion|deltadental|unitedhealthcare|cigna|aetna|verywellhealth|medicalnewstoday|drugs|eventbrite|hubspot|salesforce|g2|capterra|trustpilot)\./i;
const GOV_EDU = /\.(gov|edu)$/i;
const SOCIAL = {
  'reddit.com': 'reddit', 'youtube.com': 'youtube', 'm.youtube.com': 'youtube',
  'tiktok.com': 'tiktok', 'instagram.com': 'instagram', 'facebook.com': 'facebook',
  'x.com': 'x', 'twitter.com': 'x', 'linkedin.com': 'linkedin', 'medium.com': 'medium',
};

const readJson = (rel, fb) => { try { return JSON.parse(fs.readFileSync(path.join(ROOT, rel), 'utf8')); } catch { return fb; } };

const probeConfig = readJson('data/signals/citation_probe_config.json', {});
const OWNED = (probeConfig.owned_domains || []).map((d) => d.toLowerCase().replace(/^www\./, ''));
if (!OWNED.length) {
  console.error('occupancy probe: no owned_domains in data/signals/citation_probe_config.json - an owned slot could not be told from an open one');
  process.exit(1);
}

const isOwned = (h) => OWNED.some((o) => h === o || h.endsWith(`.${o}`));
function classify(h) {
  if (isOwned(h)) return { kind: 'owned', name: h };
  for (const k in SOCIAL) if (h === k || h.endsWith('.' + k)) return { kind: 'social', name: SOCIAL[k] };
  if (NATIONAL.test(h) || GOV_EDU.test(h)) return { kind: 'national', name: h };
  return { kind: 'unbranded', name: h };
}

const MODEL = process.env.OCCUPANCY_PROBE_MODEL || 'openai/gpt-4o-mini';
const MAX_RESULTS = Number(process.env.PROBE_WEB_MAX_RESULTS || 10);
const TIMEOUT_MS = Number(process.env.PROBE_TIMEOUT_MS || 45000);
const orKey = process.env.OPENROUTER_API_KEY || '';

const hostOf = (u) => { try { return new URL(u).hostname.toLowerCase().replace(/^www\./, ''); } catch { return ''; } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function citedHosts(query) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      signal: ctrl.signal,
      headers: { 'content-type': 'application/json', authorization: `Bearer ${orKey}` },
      body: JSON.stringify({
        model: MODEL,
        temperature: 0,
        max_tokens: 400,
        plugins: [{ id: 'web', max_results: MAX_RESULTS }],
        messages: [{ role: 'user', content: query }],
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, error: data?.error?.message || `HTTP ${res.status}` };
    const message = data?.choices?.[0]?.message || {};
    const hosts = [];
    const seen = new Set();
    for (const a of message.annotations || []) {
      const h = hostOf(a?.url_citation?.url || '');
      if (h && !seen.has(h)) { seen.add(h); hosts.push(h); }
    }
    return { ok: true, hosts };
  } catch (e) {
    return { ok: false, error: String(e?.message || e).slice(0, 120) };
  } finally {
    clearTimeout(timer);
  }
}

const inFile = positional[0] || 'data/signals/query_class_probe_panel.json';
const outFile = positional[1] || 'data/signals/query_class_occupancy.json';
const atlasTop = Number(flag('--atlas-top', '0'));

const panel = readJson(inFile, null);
if (!panel || !Array.isArray(panel.queries) || !panel.queries.length) {
  console.error(`occupancy probe: panel ${inFile} has no queries - nothing to measure`);
  process.exit(1);
}

// The panel is the declared, reviewed input. Atlas rows are appended only on
// request, and only measured T1 rows: the queries the publishing join actually
// needs an occupancy reading for. Nothing here is invented - every appended row
// is a query this portfolio received impressions for.
const targets = [...panel.queries];
if (atlasTop > 0) {
  const atlas = readJson('data/authority_scale/query_atlas.json', { queries: [] });
  const seen = new Set(targets.map((t) => String(t.query).toLowerCase()));
  const t1 = (atlas.queries || [])
    .filter((q) => q.evidence_tier === 'T1' && q.demand_basis !== 'none')
    .filter((q) => !seen.has(String(q.query).toLowerCase()))
    .sort((a, b) => (b.rank_score ?? 0) - (a.rank_score ?? 0))
    .slice(0, atlasTop);
  for (const q of t1) {
    targets.push({ query: q.query, role: 'atlas_t1', property: q.target_domain || null, evidence_tier: 'T1' });
  }
}

if (!orKey) {
  // A named stop, not a silent success. Nothing measured means nothing recorded,
  // and the caller is told exactly which credential is missing.
  console.error(`occupancy probe: OPENROUTER_API_KEY is not set. ${targets.length} queries were ready and NONE were measured. No file written; nothing recorded as zero occupancy.`);
  process.exit(1);
}

const probes = [];
const discarded = [];
for (const q of targets) {
  let r = null;
  for (let attempt = 1; attempt <= 2; attempt++) {
    r = await citedHosts(q.query);
    if (r.ok && r.hosts.length) break;
    await sleep(2000 * attempt);
  }
  if (!r.ok || !r.hosts.length) {
    discarded.push({
      ...q,
      reason: r.ok ? 'answer returned no citation annotations' : r.error,
      consequence: 'recorded as discarded, not as zero occupancy',
    });
    continue;
  }
  const marks = r.hosts.map(classify);
  const n = (k) => marks.filter((m) => m.kind === k).length;
  const social = {};
  for (const m of marks) if (m.kind === 'social') social[m.name] = (social[m.name] || 0) + 1;
  const slots = r.hosts.length;
  probes.push({
    ...q,
    slots_read: slots,
    cited_hosts_in_order: r.hosts,
    owned_slots: n('owned'),
    social_slots: n('social'),
    social_by_surface: social,
    national_slots: n('national'),
    unbranded_slots: n('unbranded'),
    owned_share: +(n('owned') / slots).toFixed(2),
    social_share: +(n('social') / slots).toFixed(2),
    national_share: +(n('national') / slots).toFixed(2),
    unbranded_share: +(n('unbranded') / slots).toFixed(2),
    citation_occupancy: +(n('unbranded') / slots).toFixed(2),
  });
  await sleep(1200);
}

const controls = probes.filter((p) => String(p.role || '').startsWith('control_'));
const controlsAttempted = targets.filter((t) => String(t.role || '').startsWith('control_')).length;

const out = {
  $schema: 'lkg-citation-occupancy-probe-v3',
  measured_on: new Date().toISOString().slice(0, 10),
  measured_at: new Date().toISOString(),
  purpose: 'Measure who holds the citation slots an answer engine builds its answer from, per query. A page can only win an open slot, so unbranded_share is the winnability signal the query atlas and the page release join consume.',
  method: {
    channel: `OpenRouter chat/completions, model ${MODEL}, plugins:[{id:'web',max_results:${MAX_RESULTS}}]. Cited hosts are read from message.annotations[].url_citation.url in the order returned.`,
    why_not_serp: 'The previous version read Bing SERP slots. Bing blocks both residential and GitHub Actions egress with a JavaScript shell, so its only run discarded 16 of 16 probes including both controls and still exited 0. A SERP slot is also the wrong unit: this repo competes for answer-engine citations, not organic rank.',
    classification: 'owned = one of our own domains; social = reddit/youtube/tiktok/instagram/x/facebook/linkedin/medium; national = national consumer brand, marketplace, publisher, or a .gov/.edu; unbranded = a slot an independent microsite can hold.',
    citation_occupancy: 'unbranded_share = unbranded_slots / slots_read. Comparable across queries because slots_read is bounded by a declared max_results.',
    honesty_note: 'Probes whose provider errored or that returned no citation annotations are listed under discarded_probes and are NOT recorded as zero occupancy. A degraded channel is not a measurement.',
    egress_caveat: 'The egress IP is not pinned, so "near me" classes resolve against the runner region rather than a chosen market.',
  },
  control_check: {
    attempted: controlsAttempted,
    measured: controls.length,
    results: controls.map((c) => ({
      query: c.query, role: c.role,
      measured_unbranded_share: c.unbranded_share,
      prior_unbranded_share: c.prior_unbranded_share ?? null,
      prior_channel: 'bing_serp_top10',
    })),
    comparable_to_prior: false,
    why: 'The priors were taken on Bing SERP slots and this probe reads answer-engine citation slots. The two are different populations, so a divergence is a channel change, not drift, and the run is not failed on it. The controls are still run so a human can see whether the known-open and known-closed classes still separate in the same direction.',
  },
  summary: {
    attempted: targets.length,
    measured: probes.length,
    discarded: discarded.length,
    mean_citation_occupancy: probes.length
      ? +(probes.reduce((a, p) => a + p.unbranded_share, 0) / probes.length).toFixed(3)
      : null,
  },
  probes,
  discarded_probes: discarded,
  reproduce: 'npm run probe:occupancy - requires OPENROUTER_API_KEY. Re-runs every query in the panel and rewrites this file. Add --atlas-top N to also measure the top N measured T1 atlas queries.',
};

fs.mkdirSync(path.join(ROOT, path.dirname(outFile)), { recursive: true });
fs.writeFileSync(path.join(ROOT, outFile), JSON.stringify(out, null, 2) + '\n');
console.log(`occupancy probe: ${probes.length} measured, ${discarded.length} discarded -> ${outFile}`);
if (discarded.length) console.log(`  discarded: ${discarded.map((d) => `${d.query} (${d.reason})`).join(' | ')}`);

// Rule 0: a stage may not exit 0 having done nothing.
if (!probes.length) {
  console.error(`occupancy probe: MEASURED NOTHING. ${targets.length} attempted, all ${discarded.length} discarded. Nothing was recorded as zero occupancy; the run fails instead.`);
  process.exit(1);
}
if (controlsAttempted && !controls.length) {
  console.error(`occupancy probe: no control measured (${controlsAttempted} attempted). The run cannot be checked against a known result, so its new numbers are not trustworthy.`);
  process.exit(1);
}
