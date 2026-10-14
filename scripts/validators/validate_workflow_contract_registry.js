#!/usr/bin/env node
'use strict';
// Reads data/workflows/workflow_contract_registry.json and proves the harm it
// can see: a registered workflow, or a script a registered workflow runs, that
// is missing from the tree (build_integrity: "a workflow command pointing at
// nothing"). It also pins the GSC portfolio entry's contract so a later build
// cannot silently drop it or turn it into a repo writer: the entry exists, its
// workflow and script exist, it commits nothing, and the dispatch modes the
// workflow offers are modes the script accepts, and every other script mode is
// run by a registered workflow.
// It does not count workflows and does not fail on a new, unregistered file.
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const REG = 'data/workflows/workflow_contract_registry.json';
const OUT = 'artifacts/validation/workflow-contract-registry.json';
const GSC = 'gsc-portfolio-report.yml';
const GSC_SCRIPT = 'scripts/search_console/gsc_portfolio_report.py';
const errors = [];
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const exists = (rel) => fs.existsSync(path.join(ROOT, rel));

if (!exists(REG)) errors.push(`missing ${REG}`);
const reg = errors.length ? { workflows: [] } : JSON.parse(read(REG));
const entries = Array.isArray(reg.workflows) ? reg.workflows : [];
if (!entries.length) errors.push(`${REG} lists zero workflows`);

let scriptsChecked = 0;
for (const w of entries) {
  if (!exists(`.github/workflows/${w.file}`)) errors.push(`registered workflow missing: .github/workflows/${w.file}`);
  for (const cmd of w.commands || []) {
    const m = String(cmd).match(/^(?:node|python3|bash)\s+(scripts\/\S+)/);
    if (!m) continue;
    scriptsChecked++;
    if (!exists(m[1])) errors.push(`${w.file} runs a script that does not exist: ${m[1]}`);
  }
}

const gsc = entries.find((w) => w.file === GSC);
if (!gsc) {
  errors.push(`${GSC} is not registered in ${REG}`);
} else {
  if (gsc.mutates_repo !== false) errors.push(`${GSC} must be registered with mutates_repo: false`);
  if (JSON.stringify(gsc.permissions) !== JSON.stringify(['contents: read'])) errors.push(`${GSC} must be registered with permissions ["contents: read"]`);
  if (!(gsc.commands || []).some((c) => c.includes(GSC_SCRIPT))) errors.push(`${GSC} registry commands must run ${GSC_SCRIPT}`);
  if (!exists(GSC_SCRIPT)) errors.push(`missing ${GSC_SCRIPT}`);
  if (exists(`.github/workflows/${GSC}`) && exists(GSC_SCRIPT)) {
    const yml = read(`.github/workflows/${GSC}`);
    if (/contents:\s*write/.test(yml) || /git\s+(commit|push)/.test(yml)) errors.push(`${GSC} must not write to the repo`);
    const opts = (yml.match(/options:\s*\[([^\]]*)\]/) || [, ''])[1].split(',').map((s) => s.trim()).filter(Boolean).sort();
    const py = read(GSC_SCRIPT);
    const modes = (py.match(/if mode not in \(([^)]*)\)/) || [, ''])[1].split(',').map((s) => s.trim().replace(/["']/g, '')).filter(Boolean).sort();
    // A dispatch option the script rejects fails at run time: that is the harm.
    // A script mode the dispatch does not offer is legitimate only when another
    // registered workflow invokes it (the daily cycle runs --mode daily), so a
    // mode nothing invokes still fails. Exact equality was the old pin; it broke
    // the moment the daily lane reused this script (11 Oct 2026).
    const invokedElsewhere = (m) => entries.some((e) => e.file !== GSC && (e.commands || []).some((c) => c.includes(GSC_SCRIPT) && new RegExp(`--mode ${m}(\\s|$)`).test(c)));
    if (!opts.length) errors.push(`${GSC} offers no dispatch modes`);
    for (const o of opts) if (!modes.includes(o)) errors.push(`${GSC} dispatch mode ${o} is not accepted by ${GSC_SCRIPT} [${modes}]`);
    for (const m of modes) if (!opts.includes(m) && !invokedElsewhere(m)) errors.push(`${GSC_SCRIPT} mode ${m} is neither a ${GSC} dispatch option nor run by any registered workflow`);
    if (JSON.stringify([...(gsc.modes || [])].sort()) !== JSON.stringify(opts)) errors.push(`${GSC} registry modes ${JSON.stringify(gsc.modes)} differ from workflow options [${opts}]`);
  }
}

// The evidence lane's commit-surface contract (2026-10-14). Query Evidence Refresh
// run 38524268332 made zero repairs, canonical-domains' `npm run build` prepare re-
// rendered 282 pages outside the lane's commit surface, the runner exited 1 and no
// evidence was committed. scripts/tests/test_lane_selfheal_restore.mjs drives the
// settle code the runner uses (scripts/selfheal/lane_surface_settle.mjs) in a
// throwaway git repo and pins the runner's wiring; a workflow running a script whose
// contract is broken is the same harm as one pointing at nothing.
const laneTests = [];
{
  const { spawnSync } = require('child_process');
  const t = spawnSync(process.execPath, [path.join(ROOT, 'scripts/tests/test_lane_selfheal_restore.mjs')], { cwd: ROOT, encoding: 'utf8' });
  laneTests.push({ test: 'scripts/tests/test_lane_selfheal_restore.mjs', exit: t.status });
  if (t.status !== 0) errors.push(`query-evidence-refresh.yml runs scripts/selfheal/run_lane_selfheal.mjs, whose commit-surface contract failed: ${`${t.stdout}${t.stderr}`.trim().split('\n').slice(0, 4).join(' | ')}`);
}

const result = { id: 'workflow-contract-registry', status: errors.length ? 'FAIL' : 'PASS',
  workflows_checked: entries.length, scripts_checked: scriptsChecked, lane_contract_tests: laneTests, errors };
fs.mkdirSync(path.join(ROOT, path.dirname(OUT)), { recursive: true });
fs.writeFileSync(path.join(ROOT, OUT), JSON.stringify(result, null, 2) + '\n');
if (errors.length) { console.error(`workflow-contract-registry FAIL\n  ${errors.join('\n  ')}`); process.exit(1); }
console.log(`workflow-contract-registry PASS (${entries.length} workflows, ${scriptsChecked} scripts, ${laneTests.length} lane contract test(s))`);
