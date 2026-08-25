#!/usr/bin/env node
// Publishing gate for the query atlas.
//
// Full taxonomy coverage is safe as an INDEX. It becomes scaled content abuse the
// moment pages are generated from permutations carrying no demand evidence. This
// validator is the line between the two.

import fs from 'node:fs';
const errors = [];
const read = (p) => { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; } };

const VALID_TIERS = new Set(['T1', 'T2a', 'T2b', 'T3', 'T4']);
const PUBLISHABLE = new Set(['T1', 'T2a', 'T2b', 'T3']);

const evidence = read('data/queries/evidence/evidence_queries.json');
if (!evidence) errors.push('missing data/queries/evidence/evidence_queries.json');
else {
  const qs = evidence.queries || [];
  if (!qs.length) errors.push('evidence_queries.json contains no queries');
  qs.forEach((q, i) => {
    const id = q.query || `#${i}`;
    if (!q.evidence_tier) errors.push(`missing evidence_tier: ${id}`);
    else if (!VALID_TIERS.has(q.evidence_tier)) errors.push(`invalid evidence_tier ${q.evidence_tier}: ${id}`);
    if (!q.source_type) errors.push(`missing source_type: ${id}`);
    // intent is derived from modifier syntax and CPC, never observed.
    if (q.intent && !q.intent_method) errors.push(`intent without intent_method: ${id}`);
  });
}

const atlas = read('data/authority_scale/query_atlas.json');
if (!atlas) errors.push('missing data/authority_scale/query_atlas.json - run the atlas build first');
else {
  for (const q of atlas.queries || []) {
    if (!q.publishable) continue;
    if (!PUBLISHABLE.has(q.evidence_tier)) errors.push(`publishable entry on non-publishable tier ${q.evidence_tier}: ${q.query}`);
    if (!q.volume && q.evidence_tier !== 'T3') errors.push(`publishable entry with no volume on tier ${q.evidence_tier}: ${q.query}`);
  }
  if (!String(atlas.policy || '').includes('never publish')) errors.push('atlas policy must state that T4 permutations never publish on their own');
  if (atlas.coverage?.clusters_with_evidence === 0) errors.push('no cluster has evidence - the atlas would be a pure hypothesis pool');
}

if (errors.length) {
  console.error('QUERY ATLAS VALIDATION FAIL');
  for (const e of errors) console.error(`- ${e}`);
  process.exit(1);
}
console.log(`query atlas: PASS (${atlas.evidence_backed_count} evidence-backed, ${atlas.coverage.clusters_with_evidence}/${atlas.coverage.clusters_total} clusters, ${atlas.taxonomy.materialized_reserve} reserve permutations held back)`);
