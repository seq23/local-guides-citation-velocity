#!/usr/bin/env node
/**
 * Query-class occupancy probe, extended to third-party surfaces.
 *
 * Why this exists
 * ---------------
 * data/signals/dentistry_query_class_openness_2026-08-27.json overturned a
 * standing conclusion ("dentistry is a closed vertical") by measuring two query
 * classes in the same vertical with opposite shapes. That probe was run by hand
 * and only its output was kept, so its own file has to explain how to reproduce
 * it in prose. This is that method as code.
 *
 * It also answers the question Phase 6 turns on, which the original could not:
 * a page can only win an OPEN slot, so the case for publishing on Reddit or
 * YouTube rests on whether those surfaces already HOLD slots in classes our
 * domains cannot enter. That is measurable, and nobody has measured it.
 *
 * Method (unchanged from the original where it overlaps)
 * -----------------------------------------------------
 * One fetch per query. Read the top 10 organic hosts in document order.
 * Classify each slot as:
 *   social    - reddit/youtube/tiktok/instagram/x/facebook/linkedin
 *   national  - a national consumer brand, marketplace or publisher
 *   unbranded - anything else, i.e. a slot an independent microsite can hold
 *
 * Honesty rules, also carried over:
 *   - A probe that does not return a distinct, on-topic result set is DISCARDED,
 *     not recorded as zero. A degraded channel is not a measurement.
 *   - hosts_in_order is always recorded so any figure can be re-derived.
 *   - This must run from a server egress. A residential/AI-agent client gets a
 *     JS shell from Bing with one b_algo node and no outbound links, which parses
 *     as an empty result set and would silently read as "nothing holds this
 *     query". That failure is why the probe lives in a workflow.
 *
 * Not measured: the egress IP is not pinned, so "near me" classes resolve
 * against whatever region the runner sits in. Same caveat the original carried.
 */
import fs from 'node:fs';

const NATIONAL = /^(www\.)?(yelp|zocdoc|healthline|mayoclinic|clevelandclinic|webmd|findlaw|justia|nolo|avvo|angi|thumbtack|houzz|theknot|weddingwire|indeed|glassdoor|amazon|walmart|etsy|pinterest|quora|wikipedia|forbes|nerdwallet|investopedia|bankrate|experian|equifax|transunion|deltadental|unitedhealthcare|cigna|aetna|verywellhealth|medicalnewstoday|drugs|eventbrite|hubspot|salesforce|g2|capterra|trustpilot)\./i;
const GOV_EDU = /\.(gov|edu)$/i;
const SOCIAL = {
  'reddit.com': 'reddit', 'youtube.com': 'youtube', 'm.youtube.com': 'youtube',
  'tiktok.com': 'tiktok', 'instagram.com': 'instagram', 'facebook.com': 'facebook',
  'x.com': 'x', 'twitter.com': 'x', 'linkedin.com': 'linkedin', 'medium.com': 'medium',
};
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

function hosts(html) {
  const out = [];
  const push = (u) => { try { out.push(new URL(u).hostname.replace(/^www\./, '')); } catch { /* not a url */ } };
  let m;
  const algo = /<li class="b_algo"[\s\S]*?<h2>\s*<a[^>]+href="(https?:\/\/[^"]+)"/g;
  while ((m = algo.exec(html)) !== null) push(m[1]);
  if (!out.length) { const h2 = /<h2>\s*<a[^>]+href="(https?:\/\/[^"]+)"/g; while ((m = h2.exec(html)) !== null) push(m[1]); }
  const seen = new Set();
  return out.filter((h) => !/bing\.com|microsoft\.com|msn\.com/.test(h)).filter((h) => (seen.has(h) ? false : seen.add(h))).slice(0, 10);
}
function classify(h) {
  for (const k in SOCIAL) if (h === k || h.endsWith('.' + k)) return { kind: 'social', name: SOCIAL[k] };
  if (NATIONAL.test(h) || GOV_EDU.test(h)) return { kind: 'national', name: h };
  return { kind: 'unbranded', name: h };
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const inFile = process.argv[2] || 'data/signals/query_class_probe_panel.json';
const outFile = process.argv[3] || `data/signals/query_class_occupancy_${new Date().toISOString().slice(0, 10)}.json`;
const panel = JSON.parse(fs.readFileSync(inFile, 'utf8'));

const probes = [], discarded = [];
for (const q of panel.queries) {
  let list = [], error = null;
  for (let attempt = 1; attempt <= 2 && !list.length; attempt++) {
    try {
      const r = await fetch(`https://www.bing.com/search?q=${encodeURIComponent(q.query)}&count=20&setlang=en-US`,
        { headers: { 'user-agent': UA, 'accept-language': 'en-US,en;q=0.9' }, signal: AbortSignal.timeout(20000) });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      list = hosts(await r.text());
    } catch (e) { error = String(e.message).slice(0, 80); }
    if (!list.length) await sleep(3000);
  }
  if (!list.length) { discarded.push({ ...q, reason: error || 'channel returned no parseable organic result set', consequence: 'recorded as discarded, not as zero occupancy' }); await sleep(2000); continue; }
  const marks = list.map(classify);
  const social = {}; for (const m of marks) if (m.kind === 'social') social[m.name] = (social[m.name] || 0) + 1;
  const n = (k) => marks.filter((m) => m.kind === k).length;
  probes.push({
    ...q, slots_read: list.length, hosts_in_order: list,
    social_slots: n('social'), social_by_surface: social,
    national_slots: n('national'), unbranded_slots: n('unbranded'),
    social_share: +(n('social') / list.length).toFixed(2),
    unbranded_share: +(n('unbranded') / list.length).toFixed(2),
    national_share: +(n('national') / list.length).toFixed(2),
  });
  await sleep(2500);
}
const out = {
  $schema: 'lkg-query-class-occupancy-probe-v2',
  measured_on: new Date().toISOString().slice(0, 10),
  purpose: 'Measure who holds each query class, including whether Reddit and YouTube hold slots our own domains cannot take. Phase 6 channel choice depends on this and nothing had measured it.',
  method: {
    channel: 'Bing web results, fetched server-side as HTML and read back as an ordered host list. One fetch per query, top 10 organic slots.',
    classification: 'social = reddit/youtube/tiktok/instagram/x/facebook/linkedin/medium; national = national consumer brand, marketplace, publisher, or a .gov/.edu that ranks for itself; unbranded = a slot an independent microsite can hold.',
    honesty_note: 'Probes that returned no parseable organic result set are listed under discarded_probes and are NOT recorded as zero. A degraded channel is not a measurement.',
    egress_caveat: 'The egress IP is not pinned, so "near me" classes resolve against the runner region rather than a chosen market.',
  },
  probes, discarded_probes: discarded,
  reproduce: 'npm run probe:occupancy - re-runs every query in data/signals/query_class_probe_panel.json and rewrites this file.',
};
fs.mkdirSync('data/signals', { recursive: true });
fs.writeFileSync(outFile, JSON.stringify(out, null, 2) + '\n');
console.log(`occupancy probe: ${probes.length} measured, ${discarded.length} discarded -> ${outFile}`);
