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
 * Read the cited hosts in the order the annotations arrive, and classify each
 * slot with scripts/queries/host_occupancy_classifier.js:
 *   owned          - one of our own domains; we already hold it            CLOSED
 *   social         - a social surface, not a page slot                     CLOSED
 *   incumbent      - a competing service provider: a practice/firm/clinic
 *                    site, a provider directory or marketplace, or a
 *                    lead-gen aggregator on the same intent                CLOSED
 *   institutional  - government, health service, academic, regulator,
 *                    journal or reference work. Not a competitor, but a
 *                    slot these properties cannot take either             CLOSED
 *   open_unheld    - nothing durable holds it: content farm, free-blog
 *                    subdomain, CDN/asset host, parked or dead domain       OPEN
 *   unclassifiable - we could not determine what it is                    CLOSED
 *
 * open_share = open_unheld slots / slots read. THERE IS NO FALLTHROUGH INTO
 * OPEN. The bucket this replaced, "unbranded", was a blind else-branch, so
 * "unbranded" meant "a host this file did not recognise" while being read as "a
 * slot an independent microsite can hold". Every incumbent local practice and
 * provider directory landed there. The panel's KNOWN-CLOSED control - a query
 * whose citation set is seven competing dental practices - scored a maximal
 * 1.00 because of it.
 *
 * WHETHER open_share IS PUBLISHED AS citation_occupancy DEPENDS ON THE CONTROLS.
 * A control pair exists to prove the instrument works. If the known-open control
 * does not measure materially more open than the known-closed one, the number is
 * WITHHELD: every probe carries citation_occupancy: null and the file carries a
 * named signal_status stop. The observation (the cited hosts, the buckets, the
 * shares) is still recorded in full, because it is real. What is refused is
 * publishing a winnability number the controls say is not measuring winnability.
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
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
// OpenRouter bills the web plugin per REQUEST on the parallel engine with 10
// results included - measured at $0.00127/call on this account against ~$0.04
// on the default engine's per-result billing. Identical url_citation schema.
const WEB_ENGINE = process.env.OPENROUTER_WEB_ENGINE || 'parallel';
const WEB_MODE = process.env.OPENROUTER_WEB_MODE || 'turbo';

const ROOT = process.cwd();
const argv = process.argv.slice(2);
const flag = (name, dflt) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : dflt; };
const positional = argv.filter((a, i) => !a.startsWith('--') && !(i > 0 && argv[i - 1].startsWith('--')));

const readJson = (rel, fb) => { try { return JSON.parse(fs.readFileSync(path.join(ROOT, rel), 'utf8')); } catch { return fb; } };

const probeConfig = readJson('data/signals/citation_probe_config.json', {});
const OWNED = (probeConfig.owned_domains || []).map((d) => d.toLowerCase().replace(/^www\./, ''));
if (!OWNED.length) {
  console.error('occupancy probe: no owned_domains in data/signals/citation_probe_config.json - an owned slot could not be told from an open one');
  process.exit(1);
}

// Who holds a slot is decided by scripts/queries/host_occupancy_classifier.js,
// shared with the validator that guards this file so the two can never drift.
// There is no fallthrough into the open bucket: a host reaches "open" only by
// being positively recognised as holding nothing durable, and an unrecognised
// host is recorded as unclassifiable and counted as CLOSED.
const strategyRegistry = readJson('data/strategy/page_strategy_registry.json', {});
const { createClassifier, KINDS } = require('./host_occupancy_classifier.js');
const { classify, vocabularyAvailable } = createClassifier({ owned: OWNED, strategyRegistry });
if (!vocabularyAvailable) {
  console.error('occupancy probe: data/strategy/page_strategy_registry.json declared no allowed_verticals topic_terms, so an incumbent service provider could not be told from an unrecognised host. Refusing to classify rather than guessing - guessing is the defect this file exists to remove.');
  process.exit(1);
}

// Every share this file publishes is derived here, from the hosts recorded with
// the probe, so a live measurement and a --rescore-only re-derivation cannot
// disagree.
function deriveShares(hosts) {
  const marks = hosts.map((h) => classify(h));
  const slots = marks.length;
  const n = (k) => marks.filter((m) => m.kind === k).length;
  const social = {};
  for (const m of marks) if (m.kind === 'social') social[m.name] = (social[m.name] || 0) + 1;
  const openSlots = marks.filter((m) => m.open).length;
  const counts = {};
  const shares = {};
  for (const k of KINDS) { counts[`${k}_slots`] = n(k); shares[`${k}_share`] = +(n(k) / slots).toFixed(2); }
  return {
    slots_read: slots,
    host_classification: marks.map((m, i) => ({ host: hosts[i], kind: m.kind, why: m.why, open: m.open })),
    ...counts,
    ...shares,
    social_by_surface: social,
    open_slots: openSlots,
    open_share: +(openSlots / slots).toFixed(2),
    closed_share: +((slots - openSlots) / slots).toFixed(2),
  };
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
  // Measured across every cited host, not only the open ones. When "unbranded"
  // was a fallthrough this looked at that bucket because that bucket was
  // everything; now that open is a narrow, positively-recognised bucket, testing
  // it would test almost nothing. What the gate needs to know is whether the
  // whole citation set is anchored to another market.
  const cited = probe.cited_hosts_in_order || [];
  const foreign = cited.filter((h) => FOREIGN_TLD.test(h)).length;
  if (cited.length && foreign / cited.length >= 0.5) {
    return { eligible: false, reason: 'CITATION_SET_ANCHORED_TO_ANOTHER_MARKET', note: `${foreign} of ${cited.length} cited slots are on non-US hosts. Those slots are real and no US page can take them, so this occupancy does not describe winnable ground.` };
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
  probes.push({ ...q, cited_hosts_in_order: r.hosts, ...deriveShares(r.hosts) });
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
// The fields the old classifier wrote are deliberately DELETED rather than left
// beside the new ones. "unbranded_share" was the wrong number under a name that
// asserted something false about it, and a stale copy sitting in the file is
// exactly what a downstream reader would pick up.
const RETIRED_FIELDS = ['national_slots', 'national_share', 'unbranded_slots', 'unbranded_share'];
function rederive(p) {
  const hosts = p.cited_hosts_in_order || [];
  if (!hosts.length) return p;
  const next = { ...p, ...deriveShares(hosts) };
  for (const f of RETIRED_FIELDS) delete next[f];
  return next;
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
//
// It now also DECIDES whether the number is published at all. The controls are
// the only evidence that open_share measures openness; if they do not separate,
// nothing here is entitled to be read as winnability, and the honest output is a
// named stop rather than a number that looks meaningful.
const MINIMUM_SEPARATION = Number(process.env.OCCUPANCY_MIN_CONTROL_SEPARATION || 0.10);
const openCtl = controls.find((c) => c.role === 'control_known_open');
const closedCtl = controls.find((c) => c.role === 'control_known_closed');
let controlSeparation;
if (openCtl && closedCtl) {
  const margin = +(openCtl.open_share - closedCtl.open_share).toFixed(2);
  const inverted = closedCtl.open_share > openCtl.open_share;
  const separated = margin >= MINIMUM_SEPARATION;
  controlSeparation = {
    known_open: openCtl.open_share,
    known_closed: closedCtl.open_share,
    margin,
    minimum_separation: MINIMUM_SEPARATION,
    expected: `known_open - known_closed >= ${MINIMUM_SEPARATION}`,
    separated,
    inverted,
    note: separated
      ? 'The two control classes separate in the expected direction by at least the declared margin.'
      : inverted
        ? 'INVERTED: the query known to be CLOSED measured MORE open than the one known to be open. The instrument is reading backwards and nothing derived from it can be trusted.'
        : 'NOT SEPARATED: the known-open and known-closed controls measured the same. The instrument cannot tell the two known classes apart, so it is not measuring openness on this channel.',
  };
} else {
  controlSeparation = { known_open: null, known_closed: null, margin: null, minimum_separation: MINIMUM_SEPARATION, expected: `known_open - known_closed >= ${MINIMUM_SEPARATION}`, separated: false, inverted: null, note: 'Both controls were not measured, so the direction could not be checked and no number may be published on an unchecked instrument.' };
}

// ------------------------------------------------------ the named, visible stop
// Same treatment this repo applies to an unmeasurable weighted input: the number
// is not softened, relabelled or quietly kept - it is withheld, and the reason is
// stated where every consumer reads it.
const totalSlots = probes.reduce((a, p) => a + (p.slots_read || 0), 0);
const unclassifiableSlots = probes.reduce((a, p) => a + (p.unclassifiable_slots || 0), 0);
const openSlots = probes.reduce((a, p) => a + (p.open_slots || 0), 0);

const signalStatus = controlSeparation.separated
  ? {
      published: true,
      reason: 'CONTROL_PAIR_SEPARATES',
      note: `The known-open control measured ${controlSeparation.known_open} against ${controlSeparation.known_closed} for the known-closed control, a margin of ${controlSeparation.margin}. citation_occupancy is published on every probe.`,
    }
  : {
      published: false,
      reason: controlSeparation.inverted ? 'CONTROL_PAIR_INVERTED' : 'CONTROL_PAIR_DOES_NOT_SEPARATE',
      note: `citation_occupancy is WITHHELD. ${controlSeparation.note} known_open=${controlSeparation.known_open}, known_closed=${controlSeparation.known_closed}, required margin ${MINIMUM_SEPARATION}. Every probe therefore carries citation_occupancy: null, scripts/atlas/build_query_atlas.mjs records winnability_basis "unmeasured_neutral" for every query, and scripts/queries/join_atlas_to_release_queue.mjs admits no candidate on this signal. The observation is NOT withheld: cited_hosts_in_order, host_classification and every bucket share are recorded in full and are re-derivable with --rescore-only. What is refused is publishing a winnability number the controls say is not measuring winnability.`,
      what_this_channel_shows: `Across ${probes.length} queries and ${totalSlots} citation slots, ${openSlots} slot(s) are held by nothing durable. On the answer-engine citation channel a slot is held by an incumbent service provider, by an institution, or by a host we cannot identify - and none of those are ground a new page takes by finding them empty. "Who currently holds the slot" is therefore not a measure of whether a page can win it, which is what this metric was being read as.`,
      what_would_lift_it: 'Either a control pair whose two classes are known to differ ON THIS CHANNEL (the current priors were taken on Bing SERP top-10, a different population, which the file already records as comparable_to_prior: false), or a winnability measure that is not "is the slot empty" - for example whether this portfolio has been observed taking a slot from the class of holder that occupies it.',
    };

const publish = signalStatus.published;
for (const p of probes) {
  p.citation_occupancy = publish ? p.open_share : null;
  p.citation_occupancy_withheld = publish ? null : signalStatus.reason;
}

const out = {
  $schema: 'lkg-citation-occupancy-probe-v4',
  measured_on: new Date().toISOString().slice(0, 10),
  measured_at: new Date().toISOString(),
  purpose: 'Measure who holds the citation slots an answer engine builds its answer from, per query. A page can only win an open slot, so unbranded_share is the winnability signal the query atlas and the page release join consume.',
  method: {
    channel: `OpenRouter chat/completions, model ${MODEL}, plugins:[{id:'web', engine: WEB_ENGINE, mode: WEB_MODE,max_results:${MAX_RESULTS}}]. Cited hosts are read from message.annotations[].url_citation.url in the order returned.`,
    why_not_serp: 'The previous version read Bing SERP slots. Bing blocks both residential and GitHub Actions egress with a JavaScript shell, so its only run discarded 16 of 16 probes including both controls and still exited 0. A SERP slot is also the wrong unit: this repo competes for answer-engine citations, not organic rank.',
    classification: 'scripts/queries/host_occupancy_classifier.js, shared with the validator that guards this file. owned = one of our own domains (CLOSED); social = a social surface (CLOSED); incumbent = a competing service provider - an individual practice/firm/clinic site, a provider directory or marketplace, or a lead-gen aggregator on the same intent (CLOSED); institutional = government, health service, academic, regulator, journal or reference work - not a competitor, but not a slot these properties can take either (CLOSED); open_unheld = nothing durable holds it - content farm, free-blog subdomain, CDN/asset host, parked or dead domain (OPEN); unclassifiable = could not be determined (CLOSED, counted separately). THERE IS NO FALLTHROUGH INTO OPEN. The bucket this replaced, "unbranded", was a blind else-branch, so an unrecognised host was counted as open ground; that is why the known-closed control - seven competing dental practices - scored a maximal 1.00.',
    service_vocabulary: 'An incumbent service provider is recognised against the repo\'s own governed topic_terms from data/strategy/page_strategy_registry.json - the same authority join_atlas_to_release_queue.mjs matches verticals on - plus a declared list of provider markers. Not a parallel list invented in the probe.',
    blue_ocean_gate: 'blue_ocean_eligible on each probe records whether the occupancy reading describes ground this property can actually contest. It refuses BRAND_OR_PERSON_NAME_NAVIGATIONAL, NO_SERVICE_OR_LOCATION_ANCHOR and CITATION_SET_ANCHORED_TO_ANOTHER_MARKET. It is additive and changes no citation_occupancy value. "Not cited" is not "open ground".',
    citation_occupancy: 'open_share = open_unheld slots / slots_read, PUBLISHED ONLY IF THE CONTROL PAIR SEPARATES. See signal_status: when the known-open and known-closed controls do not separate, every probe carries citation_occupancy: null and the reason is named rather than a number being left in place that the controls say is wrong.',
    honesty_note: 'Probes whose provider errored or that returned no citation annotations are listed under discarded_probes and are NOT recorded as zero occupancy. A degraded channel is not a measurement.',
    egress_caveat: 'The egress IP is not pinned, so "near me" classes resolve against the runner region rather than a chosen market.',
    evidence_set_note: evidenceSet
      ? `Rows tagged role=evidence_set:${evidenceSet} were appended from data/queries/evidence/evidence_queries.json under the reviewed provenance set of that name. They are NOT in data/signals/query_class_probe_panel.json, because that panel requires every non-control row to be a query the property received Search Console impressions for and these rows have no impressions. Probing them here measures who holds their citation slots; it does not give them demand evidence and does not change their evidence tier.`
      : null,
    merge_policy: merge
      ? 'Queries this run did not target kept their previous reading (carried_forward=true). Targeted queries were replaced by what this run saw.'
      : 'No merge: this file records only what this run targeted. Any previous reading for an untargeted query was dropped.',
  },
  signal_status: signalStatus,
  control_check: {
    attempted: controlsAttempted,
    measured: controls.length,
    results: controls.map((c) => ({
      query: c.query, role: c.role,
      measured_open_share: c.open_share,
      slots_read: c.slots_read,
      host_classification: c.host_classification,
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
    citation_occupancy_published: publish,
    slots_read_total: totalSlots,
    slots_by_kind: Object.fromEntries(KINDS.map((k) => [k, probes.reduce((a, p) => a + (p[`${k}_slots`] || 0), 0)])),
    // Published on EVERY run. An unrecognised host is counted as closed, so a
    // large unrecognised share cannot inflate openness - but it is a finding
    // about how much of the channel this classifier cannot see, and burying it
    // would be the same silence the open fallthrough was.
    unclassifiable_slots: unclassifiableSlots,
    unclassifiable_slot_share: totalSlots ? +(unclassifiableSlots / totalSlots).toFixed(3) : null,
    open_slots: openSlots,
    mean_open_share: probes.length
      ? +(probes.reduce((a, p) => a + p.open_share, 0) / probes.length).toFixed(3)
      : null,
    mean_citation_occupancy: publish && probes.length
      ? +(probes.reduce((a, p) => a + p.open_share, 0) / probes.length).toFixed(3)
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
console.log(`  slots ${totalSlots} = ${KINDS.map((k) => `${k} ${out.summary.slots_by_kind[k]}`).join(', ')}`);
console.log(`  unclassifiable ${unclassifiableSlots}/${totalSlots} slots (${out.summary.unclassifiable_slot_share}) - counted CLOSED, never open`);
console.log(`  controls: known_open=${controlSeparation.known_open} known_closed=${controlSeparation.known_closed} margin=${controlSeparation.margin} separated=${controlSeparation.separated}`);
if (!publish) console.error(`  NAMED STOP ${signalStatus.reason}: citation_occupancy is WITHHELD on all ${probes.length} probes. ${controlSeparation.note}`);

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
// Rule 0 on the control pair itself. A file with no controls in it cannot have
// its instrument checked, and "no controls, therefore nothing failed" is exactly
// the empty-loop pass this repo keeps finding. It applies to --rescore-only too:
// re-deriving 36 rows without a control pair among them proves nothing.
if (!openCtl || !closedCtl) {
  console.error(`occupancy probe: the output carries ${controls.length} control(s) but needs both control_known_open and control_known_closed. Without the pair the instrument cannot be checked against a known result, and a file of unchecked numbers must not be written.`);
  process.exit(1);
}
