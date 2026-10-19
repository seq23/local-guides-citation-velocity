#!/usr/bin/env node
'use strict';
// RETIRED STATE AND FEDERAL AUTHORITY URLS MAY NOT COME BACK.
//
// Every page family here cites a state licensing board or a federal programme page by URL, and
// those publishers move their pages without redirecting. On 2026-10-16 Danielle's site-audit crawl
// of theindustryguides.com found nine such links serving 404 — a licensing board per state page, a
// CMS marketplace list, a Georgia Medicaid fee schedule — each reached from a live guide page. They
// were repaired at source in the evidence registries and the page-family specs.
//
// A repair like that reverts in two ordinary ways, neither of which any other check would notice:
// a baseline ZIP lands with the old registry, or a regenerating script (for the Georgia row,
// scripts/apply_medicaid_dental_fee_data.js, which upserts source_registry entries from
// data/evidence/medicaid_dental_fee_schedules.json) writes the dead URL back. So this is a pin, not
// a crawl: it needs no network, runs in milliseconds, and names the evidence behind each pair.
//
// A LIBRARY, NOT A VALIDATOR OF ITS OWN, and it lives in scripts/lib/ for both reasons that matter:
// the repository caps blocking validators at 40 on purpose
// (every blocker is a way for main to go red), and this pin belongs to a blocker that already
// governs these files: `evidence-registry`, whose hard_fail_basis is
// user_safety_or_false_public_claim — a claim sourced to a dead URL is the root of one.
// scripts/validators/validate_evidence_registry.js calls `run()` and `selfTest()` below and fails
// on what they return; and every `scripts/**/validate*.js` file must be a registered validator
// (validation-registry's admission check), which this is deliberately not. Running this file
// directly still works, for a fast local check.
//
// FAILS when, across the source-of-truth data
// files AND the rendered HTML:
//   - a retired URL reappears anywhere;
//   - a replacement URL is absent from the data files, which is how "fixed to nothing" would look.
//   - a retired URL appears in any GENERATOR under scripts/ (every .js/.mjs/.cjs except this file).
//     2026-10-17 the CMS repair above was undone by the nightly "velocity content release": its
//     scripts/content/self_heal_programmatic_content.js hard-coded the dead URL in SOURCE_DEFS and
//     re-upserted it into source_registry.json on every run. The data-file pin only saw that a day
//     later, on main; scanning the generators fails the PR that leaves (or puts) a dead URL in one.
// Both directions, because a one-sided check passes a registry whose row was deleted rather than
// repaired. Self-tests prove each direction on synthetic text every run.
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..', '..');

/**
 * Each pair: the URL that 404'd, the URL that answered 200, and how that was established.
 * `host_control` records the status of the publisher's own root at the same moment, because a
 * blanket 404 or 403 to our egress is not a dead page — ftc.gov and medicaid.ms.gov both looked
 * "broken" on 2026-10-16 and were not (ftc.gov 404s its own root from here; medicaid.ms.gov was
 * serving a "temporary site" notice during a hosting outage). Those are deliberately NOT pinned.
 */
const RETIRED = [
  { retired: 'https://boards.bsd.dli.mt.gov/psychology/',
    live: 'https://boards.bsd.dli.mt.gov/psychologists/',
    publisher: 'Montana Board of Psychologists', host_control: '200',
    evidence: 'retired 404, replacement 200, host root 200, browser UA, 2026-10-16' },
  { retired: 'https://dial.iowa.gov/licenses/health/psychology',
    live: 'https://dial.iowa.gov/licenses/medical/mental-health/psychology',
    publisher: 'Iowa DIAL Board of Psychology', host_control: '200',
    evidence: 'retired 404 (a nonsense path on the same host also 404s, so the host returns real 404s), replacement 200, 2026-10-16' },
  { retired: 'https://dss.sd.gov/licensingboards/examiners_psychologists/',
    live: 'https://dss.sd.gov/licensingboards/psych/psych.aspx',
    publisher: 'South Dakota Board of Examiners of Psychologists', host_control: '200',
    evidence: 'retired 404, replacement 200, 2026-10-16' },
  { retired: 'https://portal.ct.gov/dph/practitioner-licensing--investigations/psychology/psychologist-licensing',
    live: 'https://portal.ct.gov/dph/practitioner-licensing--investigations/psychology/psychologist-licensure',
    publisher: 'Connecticut DPH psychologist licensure', host_control: '200',
    evidence: 'retired 404 ("-licensing" renamed to "-licensure"), replacement 200, 2026-10-16' },
  { retired: 'https://www.tn.gov/health/health-program-areas/health-professional-boards/psychology-board/psych-board.html',
    live: 'https://www.tn.gov/health/licensure/psy.html',
    publisher: 'Tennessee Board of Examiners in Psychology', host_control: '200',
    evidence: 'the whole /health-program-areas/health-professional-boards/ branch 404s; /health/licensure/psy.html 200, 2026-10-16' },
  { retired: 'https://www.tn.gov/health/health-program-areas/health-professional-boards/me-board.html',
    live: 'https://www.tn.gov/health/licensure/me.html',
    publisher: 'Tennessee Board of Medical Examiners', host_control: '200',
    evidence: 'same retired branch; /health/licensure/me.html 200, 2026-10-16' },
  { retired: 'https://www.cms.gov/marketplace/about/state-based-marketplaces',
    live: 'https://www.cms.gov/CCIIO/Resources/Fact-Sheets-and-FAQs/state-marketplaces',
    publisher: 'CMS state-based exchanges list', host_control: '200',
    evidence: 'retired 404, replacement 200 and carries the same per-state list, 2026-10-16' },
  { retired: 'https://www.mmis.georgia.gov/portal/Portals/0/StaticContent/Public/ALL/Handbooks/Dental%20Services%20Q3%20July%202026%2020260630183845.pdf',
    live: 'https://www.mmis.georgia.gov/portal/PubAccess.Provider%20Information/Fee%20Schedules/tabId/19/Default.aspx',
    publisher: 'Georgia DCH dental fee schedule (GAMMIS)', host_control: '200',
    evidence: 'the quarterly PDF filename carries a publication timestamp GAMMIS rotates, so a direct link rots; retired URL 404 (same body length as a control 404 on that host), portal Fee Schedules page 200, 2026-10-16' },
];

// Where the URLs live: durable source first, then what the build renders from it.
const DATA_FILES = [
  'data/evidence/state_direct_authorities.json',
  'data/evidence/state_source_registry.json',
  'data/evidence/source_registry.json',
  'data/evidence/medicaid_dental_fee_schedules.json',
  'data/page_families/velocity_page_specs.json',
];

function renderedFiles() {
  const out = [];
  const skip = new Set(['node_modules', '.git', 'dist', 'artifacts', 'releases', 'data']);
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.name.startsWith('.') || skip.has(e.name)) continue;
      const abs = path.join(dir, e.name);
      if (e.isDirectory()) walk(abs);
      else if (e.name.endsWith('.html')) out.push(abs);
    }
  };
  walk(ROOT);
  const dist = path.join(ROOT, 'dist');
  if (fs.existsSync(dist)) walk(dist);
  return out;
}

// Generators that write the files above. Scanned for retired URLs only (a replacement need not
// appear in every script). This file is excluded because it names every retired URL on purpose.
function generatorFiles() {
  const out = [];
  const self = path.resolve(__filename);
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.name.startsWith('.') || e.name === 'node_modules') continue;
      const abs = path.join(dir, e.name);
      if (e.isDirectory()) walk(abs);
      else if (/\.(c|m)?js$/.test(e.name) && path.resolve(abs) !== self) out.push(abs);
    }
  };
  const scripts = path.join(ROOT, 'scripts');
  if (fs.existsSync(scripts)) walk(scripts);
  return out;
}

/** The pin, run over one haystack of {label -> text}. Returned so the self-test can drive it. */
function check(texts, { requireLive = true } = {}) {
  const errors = [];
  for (const row of RETIRED) {
    for (const [label, text] of texts) {
      if (text.includes(row.retired)) {
        errors.push(`${label}: retired URL is back: ${row.retired} (${row.publisher}; use ${row.live} — ${row.evidence})`);
      }
    }
    if (requireLive && !texts.some(([, text]) => text.includes(row.live))) {
      errors.push(`replacement URL absent everywhere: ${row.live} (${row.publisher}) — the repair was reverted or the row was dropped rather than fixed`);
    }
  }
  return errors;
}

function selfTest() {
  const row = RETIRED[0];
  const allLive = [['synthetic', RETIRED.map((r) => r.live).join('\n')]];
  const cases = [
    { name: 'every replacement present and no retired URL passes', texts: allLive, pass: true },
    { name: 'a retired URL anywhere fails',
      texts: [['synthetic', RETIRED.map((r) => r.live).join('\n') + '\n' + row.retired]], pass: false },
    { name: 'a missing replacement fails (fixed to nothing)',
      texts: [['synthetic', RETIRED.slice(1).map((r) => r.live).join('\n')]], pass: false },
    { name: 'an empty corpus fails rather than passing vacuously', texts: [['synthetic', '']], pass: false },
    { name: 'a generator holding a retired URL fails even with no replacement required',
      texts: [['scripts/synthetic_generator.js', `const SOURCE_DEFS={x:{url:'${row.retired}'}};`]],
      requireLive: false, pass: false },
    { name: 'a generator holding only live URLs passes',
      texts: [['scripts/synthetic_generator.js', `const SOURCE_DEFS={x:{url:'${row.live}'}};`]],
      requireLive: false, pass: true },
  ];
  const failures = [];
  for (const c of cases) {
    const errs = check(c.texts, { requireLive: c.requireLive !== false });
    if (c.pass && errs.length) failures.push(`expected pass: ${c.name}: ${errs.join('; ')}`);
    if (!c.pass && !errs.length) failures.push(`expected failure: ${c.name}`);
  }
  return { cases: cases.length, failures };
}

function run() {
  const errors = [];
  const data = [];
  for (const rel of DATA_FILES) {
    const abs = path.join(ROOT, rel);
    if (!fs.existsSync(abs)) { errors.push(`required source file missing: ${rel}`); continue; }
    data.push([rel, fs.readFileSync(abs, 'utf8')]);
  }
  if (!data.length) return { errors: [...errors, 'zero source-of-truth files read'], data_files: 0, html_files: 0 };
  // The replacement must be present in the DURABLE source, not merely in rendered output that a
  // frozen restore could be holding from an older build.
  errors.push(...check(data));
  const html = renderedFiles().map((abs) => [path.relative(ROOT, abs), fs.readFileSync(abs, 'utf8')]);
  if (!html.length) errors.push('zero rendered HTML files found: the pin would be inert');
  errors.push(...check(html, { requireLive: false }));
  const gens = generatorFiles().map((abs) => [path.relative(ROOT, abs), fs.readFileSync(abs, 'utf8')]);
  if (!gens.length) errors.push('zero generator scripts found under scripts/: the generator pin would be inert');
  errors.push(...check(gens, { requireLive: false }));
  return { errors, data_files: data.length, html_files: html.length, generator_files: gens.length };
}

module.exports = { RETIRED, check, selfTest, run };

if (require.main === module) {
  const st = selfTest();
  const { errors, data_files, html_files, generator_files } = run();
  const all = [...st.failures.map((f) => `self-test: ${f}`), ...errors];
  const evidence = {
    validator: 'retired-authority-urls',
    status: all.length ? 'FAIL' : 'PASS',
    pinned_pairs: RETIRED.length,
    data_files,
    html_files,
    generator_files,
    self_test_cases: st.cases,
    errors: all,
  };
  fs.mkdirSync(path.join(ROOT, 'artifacts', 'validation'), { recursive: true });
  fs.writeFileSync(path.join(ROOT, 'artifacts', 'validation', 'retired-authority-urls.json'),
    JSON.stringify(evidence, null, 2) + '\n');
  if (all.length) { console.error(`RETIRED AUTHORITY URLS FAIL (${all.length})\n${all.join('\n')}`); process.exit(1); }
  console.log(`retired authority URLs PASS: ${RETIRED.length} retired/live pairs pinned across ${data_files} source file(s), ${html_files} rendered page(s) and ${generator_files} generator script(s), ${st.cases} self-test cases`);
}
