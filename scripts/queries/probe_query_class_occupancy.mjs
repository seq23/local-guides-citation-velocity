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
 * One call per query, openai/gpt-4o-mini with plugins:[{id:'web', engine: WEB_ENGINE, mode: WEB_MODE,max_results:10}].
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
 * Measuring a query that is NOT in the panel
 * ------------------------------------------
 * data/signals/query_class_probe_panel.json carries its own invariant: every
 * non-control row is a query the property actually received Search Console
 * impressions for. That is what makes the panel a demand-backed sample, and it
 * is not weakened here. A query with no impressions - a T3 "real phrasing, no
 * volume" row, for instance - therefore may not be written into the panel just
 * to get it probed.
 *
 * --evidence-set <provenance_set_id> is the supported path for those. It appends
 * every row in data/queries/evidence/evidence_queries.json whose `provenance`
 * names that set, after checking the set is declared in provenance_sets. The
 * panel is read unchanged and its invariant is untouched; nothing is invented,
 * because every appended row is an evidence row that already landed in the
 * repo's own evidence file under a reviewed provenance set.
 *
 * --merge carries forward the probes already recorded in the output file for
 * queries this run did not target. Without it a narrow run would silently
 * DELETE the readings a wider earlier run took, and the atlas would lose
 * winnability it had already paid to measure. Re-measured queries always take
 * the new reading; a query carried forward keeps its own measured_on.
 *
 * Usage: node probe_query_class_occupancy.mjs [panel.json] [out.json] [--atlas-top N] [--evidence-set ID] [--merge]
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
const flag = (name, dflt) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : dflt; };
const positional = argv.filter((a, i) => !a.startsWith('--') && !(i > 0 && argv[i - 1].startsWith('--')));

const NATIONAL = /^(www\.)?(yelp|zocdoc|healthline|mayoclinic|clevelandclinic|webmd|findlaw|justia|nolo|avvo|angi|thumbtack|houzz|theknot|weddingwire|indeed|glassdoor|amazon|walmart|etsy|pinterest|quora|wikipedia|forbes|nerdwallet|investopedia|bankrate|experian|equifax|transunion|deltadental|unitedhealthcare|cigna|aetna|verywellhealth|medicalnewstoday|drugs|eventbrite|hubspot|salesforce|g2|capterra|trustpilot)\./i;
// Public-sector and academic hosts, in ANY country. The previous pattern matched
// only bare .gov/.edu, so england.nhs.uk, ico.org.uk (the UK information
// regulator), cqc.org.uk, novascotia.ca, moh.gov.sa and nslhd.health.nsw.gov.au
// all fell through to "unbranded" - i.e. were counted as a citation slot an
// independent microsite could take. They are not. "dentist guide" scored a
// maximal citation_occupancy of 1.00 out of exactly those hosts, and the release
// join ranks publishing candidates by that number.
const GOV_EDU = /(^|\.)((gov|edu|mil)|(gov|edu|ac|nhs|health)\.[a-z]{2})$|\.(nhs\.uk|police\.uk)$/i;
const PUBLIC_BODY = /^(www\.)?(ico|cqc|rcseng|sdcep|nice|gmc-uk|hse)\.org\.uk$|\.(who|europa|oecd)\.int$/i;
// Canada publishes government at bare provincial/federal domains with no .gov.
const CA_GOV = /(^|\.)(canada|novascotia|ontario|alberta|quebec|manitoba|saskatchewan|newfoundland|princeedwardisland)\.ca$|\.gc\.ca$/i;
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
  if (NATIONAL.test(h) || GOV_EDU.test(h) || PUBLIC_BODY.test(h) || CA_GOV.test(h)) return { kind: 'national', name: h };
  return { kind: 'unbranded', name: h };
}


// ------------------------------------------------------- blue-ocean gate
//
// "Not cited" is NOT "open ground". citation_occupancy answers WHO holds the
// citation slots; it does not answer whether those slots are on this property's
// competitive ground at all. Three ways the number lies, all observed in live
// data on this repo:
//
//   - Brand/navigational queries. Whoever the engine cites for the property's
//     own name is not ground to win.
//   - No service or location anchor. "is 693" - a truncated fragment carried as
//     an atlas T1 row - was scored 0.33 against US state-legislature bill-status
//     pages. The engine had nothing to anchor to.
//   - A citation set anchored to another market. "dentist guide" scored a
//     maximal 1.00 out of england.nhs.uk, ico.org.uk, novascotia.ca and
//     moredent.com.au. Those slots are real, and no US microsite can take them.
//
// The gate is ADDITIVE: it writes blue_ocean_eligible and changes no
// citation_occupancy value. scripts/queries/join_atlas_to_release_queue.mjs
// ranks publishing candidates by that occupancy, so what the gate records is
// what a reader needs to know before trusting the ordering.
const FOREIGN_TLD = /\.(uk|au|nz|ie|za|in|sg|de|fr|es|it|nl|se|no|dk|fi|pl|sa|ae)$|\.(co|com|org|net|gov|ac)\.[a-z]{2}$/i;

// The anchor vocabulary is NOT invented here. It is the repo's own governed
// topic_terms from data/strategy/page_strategy_registry.json - the same
// authority scripts/queries/join_atlas_to_release_queue.mjs matches verticals
// on. A hardcoded list would have been wrong the moment the portfolio added a
// vertical, and this portfolio spans dentistry, personal injury, TRT, neuro and
// USCIS at least.
const strategyRegistry = readJson('data/strategy/page_strategy_registry.json', {});
const GOVERNED_TERMS = [...new Set(
  Object.values(strategyRegistry.allowed_verticals || {})
    .flatMap((cfg) => cfg.topic_terms || [])
    .map((t) => String(t).toLowerCase())
)];
const LOCATION_ANCHOR = /\bnear me\b|\b(in|near)\s+[a-z]|\b(al|ak|az|ar|ca|co|ct|de|fl|ga|hi|id|il|in|ia|ks|ky|la|me|md|ma|mi|mn|ms|mo|mt|ne|nv|nh|nj|nm|ny|nc|nd|oh|ok|or|pa|ri|sc|sd|tn|tx|ut|vt|va|wa|wv|wi|wy)\b/i;

function blueOceanEligibility(probe) {
  const q = String(probe.query || '').toLowerCase().trim();
  if (!q) return { eligible: false, reason: 'EMPTY_QUERY' };
  if (OWNED.some((o) => q.includes(o.split('.')[0]))) {
    return { eligible: false, reason: 'BRAND_OR_PERSON_NAME_NAVIGATIONAL', note: 'Navigational query for one of our own properties. Whoever the engine cites for it is not competitive ground.' };
  }
  if (!GOVERNED_TERMS.length) {
    // Refusing to guess. Without the governed vocabulary this gate cannot tell
    // an anchored query from an unanchored one, and saying "eligible" would be
    // the same false confidence it exists to prevent.
    return { eligible: false, reason: 'ANCHOR_VOCABULARY_UNAVAILABLE', note: 'data/strategy/page_strategy_registry.json declared no allowed_verticals topic_terms, so no query could be checked for an anchor.' };
  }
  const hasService = GOVERNED_TERMS.some((t) => q.includes(t));
  if (!hasService && !LOCATION_ANCHOR.test(q)) {
    return { eligible: false, reason: 'NO_SERVICE_OR_LOCATION_ANCHOR', note: 'The query carries no governed vertical topic term and no location term, so the engine has nothing to anchor retrieval to and its citation set does not describe this property\'s ground.' };
  }
  const unbrandedHosts = (probe.cited_hosts_in_order || []).filter((h) => classify(h).kind === 'unbranded');
  const foreign = unbrandedHosts.filter((h) => FOREIGN_TLD.test(h)).length;
  if (unbrandedHosts.length && foreign / unbrandedHosts.length >= 0.5) {
    return { eligible: false, reason: 'CITATION_SET_ANCHORED_TO_ANOTHER_MARKET', note: `${foreign} of ${unbrandedHosts.length} open slots are on non-US hosts. Those slots are real and no US page can take them, so this occupancy does not describe winnable ground.` };
  }
  return { eligible: true, reason: 'ANCHORED_CITATION_SET' };
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
        plugins: [{ id: 'web', engine: WEB_ENGINE, mode: WEB_MODE, max_results: MAX_RESULTS }],
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
const evidenceSet = String(flag('--evidence-set', '') || '');
// --rescore-only re-derives the shares and the blue-ocean gate for every row
// already recorded, from the hosts recorded with it, and calls no provider. It
// exists because the classifier changed: rows measured under the old one counted
// foreign public-sector hosts as open ground. The cited hosts are the
// observation; the shares are a derivation from them, so re-deriving invents
// nothing and measures nothing new. It implies --merge, since every row it works
// on is a carried-forward one.
const rescoreOnly = argv.includes('--rescore-only');
const merge = rescoreOnly || argv.includes('--merge');

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

// Evidence-set rows. The panel may not hold a query with no GSC impressions
// without breaking its own stated invariant, so a demand-less evidence tier
// (T3: real phrasing, no volume) reaches the probe through here instead. The
// set must be declared in provenance_sets, otherwise this would be a way to
// probe an arbitrary string and record it as evidence-backed.
if (evidenceSet) {
  const evidence = readJson('data/queries/evidence/evidence_queries.json', null);
  if (!evidence || !Array.isArray(evidence.queries)) {
    console.error('occupancy probe: --evidence-set given but data/queries/evidence/evidence_queries.json has no queries');
    process.exit(1);
  }
  const declared = evidence.provenance_sets || {};
  if (!declared[evidenceSet]) {
    console.error(`occupancy probe: --evidence-set ${evidenceSet} is not declared in evidence_queries.json provenance_sets. Only a reviewed set may be probed as evidence.`);
    process.exit(1);
  }
  const seen = new Set(targets.map((t) => String(t.query).toLowerCase().trim()));
  let added = 0;
  for (const q of evidence.queries) {
    if (q.provenance !== evidenceSet) continue;
    const key = String(q.query).toLowerCase().trim();
    if (seen.has(key)) continue;
    seen.add(key);
    targets.push({
      query: q.query,
      role: `evidence_set:${evidenceSet}`,
      property: q.target_domain || null,
      evidence_tier: q.evidence_tier || null,
      vertical: q.vertical || null,
      demand_basis: q.demand_basis ?? null,
    });
    added += 1;
  }
  if (!added) {
    console.error(`occupancy probe: --evidence-set ${evidenceSet} matched no rows in evidence_queries.json`);
    process.exit(1);
  }
  console.log(`occupancy probe: appended ${added} row(s) from evidence set ${evidenceSet}`);
}

if (!orKey && !rescoreOnly) {
  // A named stop, not a silent success. Nothing measured means nothing recorded,
  // and the caller is told exactly which credential is missing.
  console.error(`occupancy probe: OPENROUTER_API_KEY is not set. ${targets.length} queries were ready and NONE were measured. No file written; nothing recorded as zero occupancy.`);
  process.exit(1);
}

const probes = [];
const discarded = [];
for (const q of (rescoreOnly ? [] : targets)) {
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

// Merge. A narrow run must not delete readings a wider run already took, so
// every query this run did NOT target keeps its previous record, stamped with
// the run that actually measured it. Anything this run targeted is replaced by
// what this run saw, including a fresh discard replacing an old measurement.
const runProbes = probes.length;
const runDiscarded = discarded.length;
let carriedProbes = 0;
let carriedDiscards = 0;
if (merge) {
  const prior = readJson(outFile, null);
  // In --rescore-only nothing was targeted, so every recorded row must carry
  // forward. Using the panel here would silently drop the 16 rows the panel
  // names but this run never measured.
  const targeted = rescoreOnly ? new Set() : new Set(targets.map((t) => String(t.query).toLowerCase().trim()));
  const priorOn = prior?.measured_on ?? null;
  for (const p of prior?.probes || []) {
    if (targeted.has(String(p.query).toLowerCase().trim())) continue;
    probes.push({ ...p, measured_on: p.measured_on ?? priorOn, carried_forward: true });
    carriedProbes += 1;
  }
  for (const d of prior?.discarded_probes || []) {
    if (targeted.has(String(d.query).toLowerCase().trim())) continue;
    discarded.push({ ...d, measured_on: d.measured_on ?? priorOn, carried_forward: true });
    carriedDiscards += 1;
  }
}

// Re-derive every row from the hosts actually recorded for it, then gate it.
// A carried-forward row was classified by whatever version of classify() was
// current when it was measured; leaving it untouched would silently mix two
// classifier generations in one file. The cited hosts are the observation - the
// shares are a derivation from it, and re-deriving invents nothing.
function rederive(p) {
  const hosts = p.cited_hosts_in_order || [];
  if (!hosts.length) return p;
  const marks = hosts.map(classify);
  const n = (k) => marks.filter((m) => m.kind === k).length;
  const social = {};
  for (const m of marks) if (m.kind === 'social') social[m.name] = (social[m.name] || 0) + 1;
  const slots = hosts.length;
  return {
    ...p,
    slots_read: slots,
    owned_slots: n('owned'), social_slots: n('social'), social_by_surface: social,
    national_slots: n('national'), unbranded_slots: n('unbranded'),
    owned_share: +(n('owned') / slots).toFixed(2),
    social_share: +(n('social') / slots).toFixed(2),
    national_share: +(n('national') / slots).toFixed(2),
    unbranded_share: +(n('unbranded') / slots).toFixed(2),
    citation_occupancy: +(n('unbranded') / slots).toFixed(2),
  };
}
for (let i = 0; i < probes.length; i += 1) {
  probes[i] = rederive(probes[i]);
  probes[i].blue_ocean_eligible = blueOceanEligibility(probes[i]);
}

const controls = probes.filter((p) => String(p.role || '').startsWith('control_'));
const controlsAttempted = targets.filter((t) => String(t.role || '').startsWith('control_')).length;

// The controls exist, in this file's own words, "so a human can see whether the
// known-open and known-closed classes still separate in the same direction".
// Nothing computed that, so nobody could see it. On the last run they did not
// separate - control_known_closed measured 1.00, MORE open than
// control_known_open at 0.50 - and the run passed in silence.
const openCtl = controls.find((c) => c.role === 'control_known_open');
const closedCtl = controls.find((c) => c.role === 'control_known_closed');
const controlSeparation = (openCtl && closedCtl)
  ? {
      known_open: openCtl.unbranded_share,
      known_closed: closedCtl.unbranded_share,
      expected: 'known_open > known_closed',
      separated: openCtl.unbranded_share > closedCtl.unbranded_share,
      note: openCtl.unbranded_share > closedCtl.unbranded_share
        ? 'The two control classes separate in the expected direction.'
        : 'INVERTED: the query known to be closed measured at least as open as the one known to be open. citation_occupancy is not measuring what it claims on this channel, and every number in this file inherits that.',
    }
  : { known_open: null, known_closed: null, expected: 'known_open > known_closed', separated: null, note: 'Both controls were not measured, so the direction could not be checked.' };

const out = {
  $schema: 'lkg-citation-occupancy-probe-v3',
  measured_on: new Date().toISOString().slice(0, 10),
  measured_at: new Date().toISOString(),
  purpose: 'Measure who holds the citation slots an answer engine builds its answer from, per query. A page can only win an open slot, so unbranded_share is the winnability signal the query atlas and the page release join consume.',
  method: {
    channel: `OpenRouter chat/completions, model ${MODEL}, plugins:[{id:'web', engine: WEB_ENGINE, mode: WEB_MODE,max_results:${MAX_RESULTS}}]. Cited hosts are read from message.annotations[].url_citation.url in the order returned.`,
    why_not_serp: 'The previous version read Bing SERP slots. Bing blocks both residential and GitHub Actions egress with a JavaScript shell, so its only run discarded 16 of 16 probes including both controls and still exited 0. A SERP slot is also the wrong unit: this repo competes for answer-engine citations, not organic rank.',
    classification: 'owned = one of our own domains; social = reddit/youtube/tiktok/instagram/x/facebook/linkedin/medium; national = national consumer brand, marketplace, publisher, or a public-sector/academic host in ANY country (.gov/.edu/.mil, .gov.uk/.nhs.uk/.ac.uk and equivalents, Canadian provincial domains, named regulators, WHO/OECD/EU); unbranded = a slot an independent microsite can hold.',
    blue_ocean_gate: 'blue_ocean_eligible on each probe records whether the occupancy reading describes ground this property can actually contest. It refuses BRAND_OR_PERSON_NAME_NAVIGATIONAL, NO_SERVICE_OR_LOCATION_ANCHOR and CITATION_SET_ANCHORED_TO_ANOTHER_MARKET. It is additive and changes no citation_occupancy value. "Not cited" is not "open ground".',
    citation_occupancy: 'unbranded_share = unbranded_slots / slots_read. Comparable across queries because slots_read is bounded by a declared max_results.',
    honesty_note: 'Probes whose provider errored or that returned no citation annotations are listed under discarded_probes and are NOT recorded as zero occupancy. A degraded channel is not a measurement.',
    egress_caveat: 'The egress IP is not pinned, so "near me" classes resolve against the runner region rather than a chosen market.',
    evidence_set_note: evidenceSet
      ? `Rows tagged role=evidence_set:${evidenceSet} were appended from data/queries/evidence/evidence_queries.json under the reviewed provenance set of that name. They are NOT in data/signals/query_class_probe_panel.json, because that panel requires every non-control row to be a query the property received Search Console impressions for and these rows have no impressions. Probing them here measures who holds their citation slots; it does not give them demand evidence and does not change their evidence tier.`
      : null,
    merge_policy: merge
      ? 'Queries this run did not target kept their previous reading (carried_forward=true). Targeted queries were replaced by what this run saw.'
      : 'No merge: this file records only what this run targeted. Any previous reading for an untargeted query was dropped.',
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
    separation: controlSeparation,
    why: 'The priors were taken on Bing SERP slots and this probe reads answer-engine citation slots. The two are different populations, so a divergence is a channel change, not drift, and the run is not failed on it. The controls are still run so a human can see whether the known-open and known-closed classes still separate in the same direction.',
  },
  summary: {
    attempted: targets.length,
    measured_this_run: runProbes,
    discarded_this_run: runDiscarded,
    carried_forward_from_previous_run: merge ? carriedProbes + carriedDiscards : 0,
    measured: probes.length,
    discarded: discarded.length,
    blue_ocean_eligible: probes.filter((p) => p.blue_ocean_eligible && p.blue_ocean_eligible.eligible).length,
    blue_ocean_refused: probes.filter((p) => p.blue_ocean_eligible && !p.blue_ocean_eligible.eligible).length,
    control_separation_ok: controlSeparation.separated,
    mean_citation_occupancy: probes.length
      ? +(probes.reduce((a, p) => a + p.unbranded_share, 0) / probes.length).toFixed(3)
      : null,
  },
  probes,
  discarded_probes: discarded,
  reproduce: 'npm run probe:occupancy - requires OPENROUTER_API_KEY. Re-runs every query in the panel and rewrites this file. Add --atlas-top N to also measure the top N measured T1 atlas queries, --evidence-set ID to also measure every evidence_queries.json row carrying that provenance set, and --merge to keep readings for queries the run did not target. --rescore-only re-derives every recorded row with the current classifier and gate without calling the provider.',
};

fs.mkdirSync(path.join(ROOT, path.dirname(outFile)), { recursive: true });
fs.writeFileSync(path.join(ROOT, outFile), JSON.stringify(out, null, 2) + '\n');
console.log(`occupancy probe: ${probes.length} measured, ${discarded.length} discarded -> ${outFile}`);
if (discarded.length) console.log(`  discarded: ${discarded.map((d) => `${d.query} (${d.reason})`).join(' | ')}`);

// Rule 0: a stage may not exit 0 having done nothing.
// Carried-forward rows are a previous run's work and cannot stand in for this
// run having done any, so this is checked on what THIS run measured.
if (!runProbes && !rescoreOnly) {
  console.error(`occupancy probe: MEASURED NOTHING. ${targets.length} attempted, all ${runDiscarded} discarded. Nothing was recorded as zero occupancy; the run fails instead.`);
  process.exit(1);
}
if (rescoreOnly && !probes.length) {
  // Rule 0 for this mode: re-deriving zero rows is not work done.
  console.error(`occupancy probe: --rescore-only found no recorded probes in ${outFile}. Nothing was re-derived; the run fails rather than writing an empty file.`);
  process.exit(1);
}
if (rescoreOnly) {
  console.log(`occupancy probe: --rescore-only re-derived ${probes.length} recorded rows with the current classifier and blue-ocean gate. No provider was called.`);
}
if (!rescoreOnly && controlsAttempted && !controls.length) {
  console.error(`occupancy probe: no control measured (${controlsAttempted} attempted). The run cannot be checked against a known result, so its new numbers are not trustworthy.`);
  process.exit(1);
}
