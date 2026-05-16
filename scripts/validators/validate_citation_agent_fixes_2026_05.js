#!/usr/bin/env node
/* eslint-disable no-console */
'use strict';

const fs = require('fs');
const path = require('path');

const root = process.cwd();
const checks = [
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

const failures = [];
function assertFile(rel) {
  const abs = path.join(root, rel);
  if (!fs.existsSync(abs)) {
    failures.push(`missing required file: ${rel}`);
    return '';
  }
  return fs.readFileSync(abs, 'utf8');
}

const ledgerText = assertFile('data/report_fixes/velocity_citation_agent_2026_05.json');
if (ledgerText) {
  try {
    const ledger = JSON.parse(ledgerText);
    if (!Array.isArray(ledger.fixes) || ledger.fixes.length < 13) failures.push('ledger must include at least 13 applied velocity-owned fixes');
    if (!Array.isArray(ledger.canonical_lkg_deferred) || ledger.canonical_lkg_deferred.length < 4) failures.push('ledger must explicitly defer canonical/LKG-only fixes');
  } catch (err) {
    failures.push(`ledger JSON invalid: ${err.message}`);
  }
}

assertFile('docs/runbooks/citation-velocity-agent-run-2026-05-data-trace.md');

for (const sourceRel of ['content/_live/pages.json', 'content/_staged/pages.json']) {
  const text = assertFile(sourceRel);
  if (!text) continue;
  for (const marker of [
    '5-step USCIS civil surgeon selection framework',
    'I-693 correction, RFE, denial, and refile decision tree',
    'Current I-693 validity rule after the 2025 USCIS update',
    'ADHD testing process checklist',
    'Parent-facing pediatric dentist checklist',
    'Implant, bridge, and cosmetic dentistry comparison framework'
  ]) {
    if (!text.includes(marker)) failures.push(`${sourceRel} missing source marker: ${marker}`);
  }
}

for (const check of checks) {
  const html = assertFile(check.rel);
  if (!html) continue;
  for (const marker of check.markers) {
    if (!html.includes(marker)) failures.push(`${check.rel} missing marker: ${marker}`);
  }
}

const pkgText = assertFile('package.json');
if (pkgText) {
  try {
    const pkg = JSON.parse(pkgText);
    const script = pkg.scripts && pkg.scripts['validate:citation-agent-fixes'];
    if (script !== 'node scripts/validators/validate_citation_agent_fixes_2026_05.js') failures.push('package.json missing validate:citation-agent-fixes script');
    if (!String(pkg.scripts && pkg.scripts['validate:all'] || '').includes('validate:citation-agent-fixes')) failures.push('validate:all must include validate:citation-agent-fixes');
  } catch (err) {
    failures.push(`package.json invalid JSON: ${err.message}`);
  }
}

if (failures.length) {
  console.error('Citation agent fixes contract FAIL');
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exit(1);
}

console.log(`Citation agent fixes contract PASS: ${checks.length} rendered targets checked`);
