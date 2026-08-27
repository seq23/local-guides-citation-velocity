#!/usr/bin/env node
'use strict';
// HARD GATE on the demand-unit contract.
//
// The defect this exists to prevent: one field named `volume` held TWO incompatible
// quantities -- modelled monthly search volume on semrush_keyword_magic rows, and this
// domain's OWN 90-day impression count on gsc_search_analytics rows. rank_score was
// computed straight off it, so a query with 40 real monthly searches was scored off a
// single impression and the content queue was silently inverted.
//
// The fix is only durable if nothing can reintroduce the ambiguity, so this validator
// fails the build on ANY of:
//   1. an atlas or evidence row carrying a `volume` key at all
//   2. a GSC-sourced row with a non-null search_volume that did not come from a
//      keyword-tool join (i.e. no keyword-tool provenance recorded)
//   3. demand_basis disagreeing with which fields are actually populated
//   4. rank_score comparing across units (missing/incorrect rank_band)
//   5. source code still reading the removed `volume` field off an atlas/evidence row
//
// Check 5 matters because a stale consumer using `q.volume ?? null` would read the
// removed key as null and silently produce a wrong answer rather than throwing.

const fs = require('node:fs');
const path = require('node:path');

const ROOT = process.cwd();
const errors = [];
const read = (p) => { try { return JSON.parse(fs.readFileSync(path.join(ROOT, p), 'utf8')); } catch { return null; } };

const ATLAS = 'data/authority_scale/query_atlas.json';
const EVIDENCE = 'data/queries/evidence/evidence_queries.json';

// Provenance strings that count as a real keyword-tool join.
const KEYWORD_TOOL = /semrush|keyword_magic|keyword_compare|keyword tool|portfolio_demand|blue.?ocean|owner_supplied_semrush|bing_keyword/i;
const GSC_SOURCES = new Set(['gsc_search_analytics']);

function checkRows(label, rows) {
  for (const q of rows) {
    const id = q.query || '<unnamed>';

    // 1. the ambiguous field must be gone entirely
    if (Object.prototype.hasOwnProperty.call(q, 'volume')) {
      errors.push(`${label}: row still carries the ambiguous \`volume\` key: ${id}`);
    }

    const sv = q.search_volume ?? null;
    const imp = q.impressions_90d ?? null;

    for (const f of ['search_volume', 'impressions_90d', 'demand_basis']) {
      if (!Object.prototype.hasOwnProperty.call(q, f)) {
        errors.push(`${label}: row missing required field \`${f}\`: ${id}`);
      }
    }

    // 2. a GSC row may only carry search_volume via a keyword-tool join
    if (GSC_SOURCES.has(q.source_type) && sv !== null) {
      const prov = q.search_volume_source || '';
      if (!KEYWORD_TOOL.test(prov)) {
        errors.push(
          `${label}: gsc-sourced row has search_volume=${sv} without keyword-tool provenance `
          + `(search_volume_source=${JSON.stringify(prov)}): ${id}. A GSC row measures impressions, `
          + `not market volume -- this is the exact overwrite that caused the defect.`
        );
      }
    }

    // a keyword-tool row must never claim this domain's own impressions
    if (q.source_type === 'semrush_keyword_magic' && imp !== null) {
      errors.push(`${label}: keyword-tool row carries impressions_90d=${imp}: ${id}`);
    }

    // 3. demand_basis must match what is actually populated
    const expected = sv !== null ? 'search_volume' : imp !== null ? 'impressions_90d' : 'none';
    if (q.demand_basis !== expected) {
      errors.push(
        `${label}: demand_basis=${JSON.stringify(q.demand_basis)} disagrees with populated fields `
        + `(search_volume=${sv}, impressions_90d=${imp}); expected ${expected}: ${id}`
      );
    }

    // conflicting packet volumes must be recorded, never averaged away
    if (q.volume_conflict === true) {
      const n = Object.keys(q.volume_sources || {}).length;
      if (n < 2) errors.push(`${label}: volume_conflict=true but volume_sources has ${n} entries: ${id}`);
    }
  }
}

const evidence = read(EVIDENCE);
if (!evidence) errors.push(`missing ${EVIDENCE}`);
else checkRows('evidence_queries', evidence.queries || []);

const atlas = read(ATLAS);
if (!atlas) errors.push(`missing ${ATLAS} - run the atlas build first`);
else {
  const rows = atlas.queries || [];
  checkRows('query_atlas', rows);

  // 4. rank_score must be banded so units cannot sort as peers
  const BANDS = { search_volume: 'measured_search_volume', impressions_90d: 'own_impressions_only', none: 'unscored' };
  for (const q of rows) {
    const want = BANDS[q.demand_basis];
    if (!q.rank_band) errors.push(`query_atlas: row missing rank_band: ${q.query}`);
    else if (q.rank_band !== want) {
      errors.push(`query_atlas: rank_band=${q.rank_band} but demand_basis=${q.demand_basis} implies ${want}: ${q.query}`);
    }
    if (q.demand_basis === 'none' && q.rank_score !== null) {
      errors.push(`query_atlas: rank_score must be null with no demand evidence: ${q.query}`);
    }
  }
  // ordering must be band-major, so a cross-unit comparison never decides position
  const order = ['measured_search_volume', 'own_impressions_only', 'unscored'];
  let seen = -1;
  for (const q of rows) {
    const i = order.indexOf(q.rank_band);
    if (i < seen) { errors.push(`query_atlas: rows are not ordered band-major; ${q.query} (${q.rank_band}) appears after a later band`); break; }
    seen = Math.max(seen, i);
  }
  if (!atlas.rank_scoring || !atlas.rank_scoring.formula) errors.push('query_atlas: rank_scoring.formula must be recorded in the file');
  if (!atlas.unit_contract) errors.push('query_atlas: unit_contract must be recorded in the file');
}

// 5. tripwire: no source file may still read the removed field off an atlas row.
const SCAN_DIRS = ['scripts', '_ops', 'src', 'lib', 'tools', 'functions'];
const SKIP = /node_modules|[/\\]\.git[/\\]|[/\\]dist[/\\]|[/\\]build[/\\]/;
const FORBIDDEN = /(\bq|\brow|\bentry|\bquery|\bitem)\s*(\.volume\b|\[['"]volume['"]\])/;
function walk(dir, out = []) {
  let ents = [];
  try { ents = fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true }); } catch { return out; }
  for (const e of ents) {
    const rel = path.join(dir, e.name);
    if (SKIP.test(rel)) continue;
    if (e.isDirectory()) walk(rel, out);
    else if (/\.(mjs|cjs|js|ts|py)$/.test(e.name)) out.push(rel);
  }
  return out;
}
for (const dir of SCAN_DIRS) {
  for (const rel of walk(dir)) {
    const txt = fs.readFileSync(path.join(ROOT, rel), 'utf8');
    txt.split('\n').forEach((line, i) => {
      const t = line.trim();
      if (t.startsWith('//') || t.startsWith('#') || t.startsWith('*')) return;
      if (/pop\(["']volume["']/.test(line)) return; // removing it is the fix, not a use
      if (FORBIDDEN.test(line)) {
        errors.push(`${rel}:${i + 1}: reads the removed \`volume\` field off a query row -> ${t}`);
      }
    });
  }
}

if (errors.length) {
  console.error('ATLAS UNIT CONTRACT: HARD_FAIL');
  for (const e of errors) console.error(`- ${e}`);
  process.exit(1);
}

const rows = atlas.queries || [];
const byBand = rows.reduce((a, q) => { a[q.rank_band] = (a[q.rank_band] || 0) + 1; return a; }, {});
const withVol = rows.filter((q) => q.search_volume !== null).length;
const conflicts = rows.filter((q) => q.volume_conflict).length;
console.log(
  `atlas unit contract: PASS (${rows.length} rows, no \`volume\` key, ${withVol} with keyword-tool search_volume, `
  + `${conflicts} volume_conflict recorded, bands ${JSON.stringify(byBand)})`
);
