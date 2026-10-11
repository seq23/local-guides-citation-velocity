#!/usr/bin/env node
'use strict';
// Reads data/workflows/workflow_contract_registry.json and proves the harm it
// can see: a registered workflow, or a script a registered workflow runs, that
// is missing from the tree (build_integrity: "a workflow command pointing at
// nothing"). It also pins the GSC portfolio entry's contract so a later build
// cannot silently drop it or turn it into a repo writer: the entry exists, its
// workflow and script exist, it commits nothing, and the dispatch modes the
// workflow offers are exactly the modes the script accepts.
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
    if (!opts.length || JSON.stringify(opts) !== JSON.stringify(modes)) errors.push(`${GSC} dispatch modes [${opts}] differ from script modes [${modes}]`);
    if (JSON.stringify([...(gsc.modes || [])].sort()) !== JSON.stringify(opts)) errors.push(`${GSC} registry modes ${JSON.stringify(gsc.modes)} differ from workflow options [${opts}]`);
  }
}

const result = { id: 'workflow-contract-registry', status: errors.length ? 'FAIL' : 'PASS',
  workflows_checked: entries.length, scripts_checked: scriptsChecked, errors };
fs.mkdirSync(path.join(ROOT, path.dirname(OUT)), { recursive: true });
fs.writeFileSync(path.join(ROOT, OUT), JSON.stringify(result, null, 2) + '\n');
if (errors.length) { console.error(`workflow-contract-registry FAIL\n  ${errors.join('\n  ')}`); process.exit(1); }
console.log(`workflow-contract-registry PASS (${entries.length} workflows, ${scriptsChecked} scripts)`);
