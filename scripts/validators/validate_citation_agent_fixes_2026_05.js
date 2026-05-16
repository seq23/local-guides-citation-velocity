#!/usr/bin/env node
/* eslint-disable no-console */
'use strict';

const fs = require('fs');
const path = require('path');

const root = process.cwd();
const failures = [];
const ledgerRel = 'data/report_fixes/velocity_citation_agent_2026_05.json';

const legacyChecks = [
  { rel: 'uscis-medical/index.html', markers: ['5-step USCIS civil surgeon selection framework', 'USCIS civil-surgeon designation'] },
  { rel: 'uscis-medical/correction-mistakes/index.html', markers: ['I-693 correction, RFE, denial, and refile decision tree', 'Denied or withdrawn I-485'] },
  { rel: 'uscis-medical/timeline-validity/index.html', markers: ['Current I-693 validity rule after the 2025 USCIS update', 'June 2025 USCIS policy changes'] },
  { rel: 'neuro/adhd-testing/index.html', markers: ['ADHD testing process checklist', 'Pre-visit', 'Report'] },
  { rel: 'insights/neuro-001-decision-tree-adhd-vs-autism-vs-broader-neuro-evaluation.html', markers: ['ADHD evaluation path', 'autism assessment path', 'broader neuropsych path'] },
  { rel: 'insights/neuro-004-how-to-choose-the-right-neuropsych-evaluation-path.html', markers: ['Decision needed', 'Provider type', 'Output needed'] },
  { rel: 'insights/neuro-009-how-much-does-a-neuropsych-eval-cost.html', markers: ['ADHD-focused evaluation', 'Comprehensive neuropsych battery', 'CPT codes'] },
  { rel: 'insights/neuro-012-neuro-eval-red-flags.html', markers: ['Mild', 'Moderate', 'Severe', 'Green flag'] },
  { rel: 'insights/neuro-013-how-to-compare-providers-fast.html', markers: ['35% specialty fit', '25% report usefulness', '15% timeline'] },
  { rel: 'dentistry/pediatric-family/index.html', markers: ['Parent-facing pediatric dentist checklist', 'age-one'] },
  { rel: 'dentistry/anxiety-trust/index.html', markers: ['Anxiety, sedation, and trust signal checklist', 'nitrous', 'oral sedation', 'IV sedation'] },
  { rel: 'dentistry/best-top-near-me/index.html', markers: ['Dentist-finding decision checklist', 'Treatment fit', 'Insurance/cost'] },
  { rel: 'dentistry/cosmetic-restorative/index.html', markers: ['Implant, bridge, and cosmetic dentistry comparison framework', 'Cost', 'Longevity', 'Candidacy'] },
];

function assertFile(rel) {
  const abs = path.join(root, rel);
  if (!fs.existsSync(abs)) {
    failures.push(`missing required file: ${rel}`);
    return '';
  }
  return fs.readFileSync(abs, 'utf8');
}

function unique(items) {
  return Array.from(new Set((Array.isArray(items) ? items : []).filter(Boolean).map(String)));
}

function checkMarkers({ label, rel, markers }) {
  const text = assertFile(rel);
  if (!text) return;
  for (const marker of unique(markers)) {
    if (!text.includes(marker)) failures.push(`${label} ${rel} missing marker: ${marker}`);
  }
}

const ledgerText = assertFile(ledgerRel);
let ledger = null;
if (ledgerText) {
  try {
    ledger = JSON.parse(ledgerText);
    if (!Array.isArray(ledger.fixes) || ledger.fixes.length < 13) failures.push('ledger must include at least 13 applied velocity-owned fixes');
    if (!Array.isArray(ledger.canonical_lkg_deferred) || ledger.canonical_lkg_deferred.length < 4) failures.push('ledger must explicitly defer canonical/LKG-only fixes');
    if (!ledger.trace_policy || ledger.trace_policy.generated_files_do_not_count !== true) failures.push('ledger missing source-to-published trace policy');
  } catch (err) {
    failures.push(`ledger JSON invalid: ${err.message}`);
  }
}

assertFile('docs/runbooks/citation-velocity-agent-run-2026-05-data-trace.md');
assertFile('scripts/validators/trace_citation_agent_fixes_2026_05.js');

if (ledger && Array.isArray(ledger.fixes)) {
  const traceFixes = ledger.fixes.filter((fix) => fix.trace_required || fix.renderedPath || fix.sourceFiles);
  if (traceFixes.length < 5) failures.push('ledger must include at least 5 trace-required source-to-render fixes for the May 2026 failing surfaces');
  for (const fix of traceFixes) {
    const id = fix.id || fix.url || fix.renderedPath || 'unnamed-fix';
    const sourceMarkers = unique(fix.requiredSourceMarkers || fix.required_markers);
    const liveMarkers = unique(fix.requiredLiveMarkers || fix.required_markers);
    const stagedMarkers = unique(fix.requiredStagedMarkers || fix.required_markers);
    const renderedMarkers = unique(fix.requiredRenderedMarkers || fix.required_markers);
    const sourceFiles = Array.isArray(fix.sourceFiles) ? fix.sourceFiles : [];
    if (!sourceFiles.length) failures.push(`${id} missing sourceFiles`);
    if (!fix.liveManifestPath) failures.push(`${id} missing liveManifestPath`);
    if (!fix.stagedManifestPath) failures.push(`${id} missing stagedManifestPath`);
    if (!fix.renderedPath) failures.push(`${id} missing renderedPath`);
    for (const sourceFile of sourceFiles) checkMarkers({ label: `${id} SOURCE`, rel: sourceFile, markers: sourceMarkers });
    if (fix.liveManifestPath) checkMarkers({ label: `${id} LIVE MANIFEST`, rel: fix.liveManifestPath, markers: liveMarkers });
    if (fix.stagedManifestPath) checkMarkers({ label: `${id} STAGED MANIFEST`, rel: fix.stagedManifestPath, markers: stagedMarkers });
    if (fix.renderedPath) checkMarkers({ label: `${id} RENDERED HTML`, rel: fix.renderedPath, markers: renderedMarkers });
  }
}

for (const check of legacyChecks) checkMarkers({ label: 'rendered target', rel: check.rel, markers: check.markers });

const pkgText = assertFile('package.json');
if (pkgText) {
  try {
    const pkg = JSON.parse(pkgText);
    const validateScript = pkg.scripts && pkg.scripts['validate:citation-agent-fixes'];
    const traceScript = pkg.scripts && pkg.scripts['trace:citation-agent-fixes'];
    if (validateScript !== 'node scripts/validators/validate_citation_agent_fixes_2026_05.js') failures.push('package.json missing validate:citation-agent-fixes script');
    if (traceScript !== 'node scripts/validators/trace_citation_agent_fixes_2026_05.js') failures.push('package.json missing trace:citation-agent-fixes script');
    if (!String(pkg.scripts && pkg.scripts['validate:all'] || '').includes('validate:citation-agent-fixes')) failures.push('validate:all must include validate:citation-agent-fixes');
    if (!String(pkg.scripts && pkg.scripts['guardrails:all'] || '').includes('trace:citation-agent-fixes')) failures.push('guardrails:all must run trace:citation-agent-fixes before validate:all');
  } catch (err) {
    failures.push(`package.json invalid JSON: ${err.message}`);
  }
}

if (failures.length) {
  console.error('Citation agent fixes contract FAIL');
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exit(1);
}

console.log(`Citation agent fixes contract PASS: ${legacyChecks.length} rendered targets checked with source-to-published trace`);
