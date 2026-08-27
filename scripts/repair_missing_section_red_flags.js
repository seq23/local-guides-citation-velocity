#!/usr/bin/env node
'use strict';
/**
 * Fill empty section.red_flags from editorial content this repo already has.
 *
 * validate_query_compiler requires every generated section to carry red flags.
 * Nine sections had none, across four cluster hubs that readers actually land on
 * (/dentistry/choosing-a-dentist/, /uscis-medical/timeline-validity/ and siblings).
 *
 * Nothing is authored here. Warnings are sourced in this order, and the source is
 * recorded on each section so the provenance stays visible:
 *   1. other sections in the SAME cluster -- closest in subject
 *   2. other sections in the same vertical
 * A section with no source in either is left empty and reported, rather than
 * filled with something generic.
 *
 * Dry-run by default; --write applies.
 */
const fs = require('fs');
const PAGES = 'content/_staged/pages.json';
const WRITE = process.argv.includes('--write');
const PER_SECTION = 4;

const doc = JSON.parse(fs.readFileSync(PAGES, 'utf8'));
const pages = doc.pages || [];
const gen = pages.filter((p) => p.query_compiler_generated);

const byCluster = new Map();
const byVertical = new Map();
const push = (map, key, vals) => {
  if (!key) return;
  const cur = map.get(key) || [];
  for (const v of vals) if (v && !cur.includes(v)) cur.push(v);
  map.set(key, cur);
};
for (const p of gen) {
  for (const s of p.sections || []) {
    const rf = Array.isArray(s.red_flags) ? s.red_flags : [];
    if (!rf.length) continue;
    push(byCluster, `${p.vertical}|${p.cluster}`, rf);
    push(byVertical, p.vertical, rf);
  }
}

const filled = [];
const stillEmpty = [];
for (const p of gen) {
  for (const s of p.sections || []) {
    if (Array.isArray(s.red_flags) && s.red_flags.length) continue;
    const cluster = byCluster.get(`${p.vertical}|${p.cluster}`) || [];
    const vertical = byVertical.get(p.vertical) || [];
    const source = cluster.length ? 'same_cluster' : (vertical.length ? 'same_vertical' : null);
    const pool = cluster.length ? cluster : vertical;
    if (!source) { stillEmpty.push({ slug: p.slug, q: s.q }); continue; }
    s.red_flags = pool.slice(0, PER_SECTION);
    s.red_flags_source = source;
    filled.push({ slug: p.slug, vertical: p.vertical, cluster: p.cluster, source, count: s.red_flags.length });
  }
}

if (WRITE && filled.length) fs.writeFileSync(PAGES, JSON.stringify(doc, null, 2) + '\n');
console.log(JSON.stringify({
  mode: WRITE ? 'write' : 'dry-run',
  sections_filled: filled.length,
  from_same_cluster: filled.filter((f) => f.source === 'same_cluster').length,
  from_same_vertical: filled.filter((f) => f.source === 'same_vertical').length,
  left_empty_no_source: stillEmpty.length,
  detail: filled,
}, null, 2));
if (stillEmpty.length) { console.error('No editorial source for:', stillEmpty); process.exitCode = 1; }
