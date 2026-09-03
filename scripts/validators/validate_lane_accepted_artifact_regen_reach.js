#!/usr/bin/env node
/* eslint-disable no-console */
'use strict';
/**
 * A workflow step that publishes new pages must regenerate
 * data/release/accepted_page_artifacts.json - or run the self-heal loop, which
 * does the same thing - before the next raw check of accepted-artifact-recovery.
 *
 * The defect this exists to stop
 * -----------------------------
 * .github/workflows/velocity-content-release.yml runs `npm run release:velocity-intake`
 * (which chains to `release:velocity-content` and can publish new pages), commits
 * that as "velocity content release <date>", then in its next step re-runs
 * `npm run build` and, immediately after, a RAW `npm run validate:release` - with
 * no self-heal wrapper and no call to the accepted-artifact-recovery validator's
 * own registered repair, `npm run recover:accepted-artifacts`.
 *
 * `npm run build` restores data/release/frozen_page_registry.json for every
 * newly-accepted route but does not touch data/release/accepted_page_artifacts.json,
 * which only `recover:accepted-artifacts` derives. So the moment a run actually
 * publishes a page, accepted-artifact-recovery's own --check sees a store that no
 * longer matches the accepted output and HARD_FAILs - on a tree that just did
 * exactly what the lane exists to do. That took Velocity Content Release red on
 * 2026-09-03 at 06:55 (run 33725560369), on a healthy publish.
 *
 * What this asserts
 * -----------------
 * Behaviour, not prose. It walks every workflow's steps in document order (steps
 * in one job share a working tree, so a repair two steps earlier still counts),
 * classifies each top-level `npm run <name>` token it finds as PUBLISH, REPAIR, or
 * CHECK by expanding that script's body (recursively, through other npm scripts)
 * for the literal that makes it one, and fails if a CHECK for
 * accepted-artifact-recovery's profile is reached while a PUBLISH is still
 * outstanding - i.e. no REPAIR (or the self-heal loop, which runs the repair for
 * every failing validator that declares one) landed in between.
 *
 * Rule 0: this hard-fails if it finds zero PUBLISH scripts, zero REPAIR scripts,
 * zero CHECK scripts, or zero (workflow, step) command tokens examined. Any of
 * those means the derivation broke and the check is inspecting nothing, which
 * must never read as a pass.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../..');
const EVIDENCE = 'artifacts/validation/lane-accepted-artifact-regen-reach.json';
const WF_DIR = path.join(ROOT, '.github/workflows');
const VALIDATOR_ID = 'accepted-artifact-recovery';

function readText(p) { try { return fs.readFileSync(p, 'utf8'); } catch { return ''; } }
function readJson(p, fb) { try { return JSON.parse(fs.readFileSync(path.join(ROOT, p), 'utf8')); } catch { return fb; } }

const fail = [];
const notes = [];

const pkg = readJson('package.json', { scripts: {} });
const npmScripts = pkg.scripts || {};
const registry = readJson('_validation_registry.json', { validators: [] });
const validators = registry.validators || [];

const target = validators.find((v) => v.id === VALIDATOR_ID && v.status === 'ACTIVE');
if (!target) {
  fail.push(`missing_target_validator:${VALIDATOR_ID} - it must be an ACTIVE entry in _validation_registry.json for this check to mean anything.`);
}
const targetProfiles = new Set(target ? target.profiles || [] : []);
const repairCommand = target ? target.repair_command : null;
if (!repairCommand) {
  fail.push(`missing_repair_command:${VALIDATOR_ID} declares no repair_command in the registry, so there is nothing this validator can require a publish to be followed by.`);
}

// Expand a script name's body (recursively through `npm run x`) into the flat
// text of everything it can run, so a literal buried two hops down (like
// release:velocity-content, reached only through release:velocity-intake) is
// still found.
function expandScriptText(name, seen = new Set()) {
  if (seen.has(name)) return '';
  seen.add(name);
  const body = npmScripts[name];
  if (!body) return '';
  let out = body;
  for (const m of body.matchAll(/\bnpm run ([\w:@.-]+)/g)) out += `\n${expandScriptText(m[1], seen)}`;
  return out;
}

const PUBLISH_LITERAL = 'release:velocity-content';
const REPAIR_LITERALS = ['recover:accepted-artifacts', 'heal_until_clean.mjs'];
// A raw check reaches this validator if it runs the registry with an --id for it
// directly, or with a --profile it belongs to.
function reachesCheck(text) {
  if (new RegExp(`--id\\s+${VALIDATOR_ID}\\b`).test(text)) return true;
  for (const m of text.matchAll(/run_validation_registry\.js\s+--profile\s+(\S+)/g)) {
    if (targetProfiles.has(m[1])) return true;
  }
  return false;
}

const publishScripts = new Set();
const repairScripts = new Set();
const checkScripts = new Set();
for (const name of Object.keys(npmScripts)) {
  const expanded = expandScriptText(name);
  if (expanded.includes(PUBLISH_LITERAL) || name === PUBLISH_LITERAL) publishScripts.add(name);
  if (REPAIR_LITERALS.some((lit) => expanded.includes(lit)) || REPAIR_LITERALS.includes(name)) repairScripts.add(name);
  if (reachesCheck(expanded)) checkScripts.add(name);
}
// selfheal(:dry) always re-runs the repair for accepted-artifact-recovery when it
// fails, whatever profile it is invoked with - it is a REPAIR regardless of the
// profile flag baked into its own body.
for (const name of Object.keys(npmScripts)) {
  if (/heal_until_clean\.mjs/.test(npmScripts[name] || '')) repairScripts.add(name);
}

if (!publishScripts.size) fail.push(`zero_publish_scripts_found - no npm script's expanded body contains "${PUBLISH_LITERAL}". Either page publishing was renamed (update this validator deliberately) or the derivation broke.`);
if (!repairScripts.size) fail.push('zero_repair_scripts_found - no npm script reaches recover:accepted-artifacts or the self-heal loop. The derivation broke.');
if (!checkScripts.size) fail.push(`zero_check_scripts_found - no npm script's expanded body reaches run_validation_registry.js with a profile ${VALIDATOR_ID} belongs to, or --id ${VALIDATOR_ID} directly. The derivation broke.`);

// ------------------------------------------------------------- workflow walk
function stepRunBlocks(text) {
  const lines = text.split('\n');
  const steps = [];
  let pendingName = '(unnamed step)';
  for (let i = 0; i < lines.length; i += 1) {
    const nameM = /^\s*-\s*name:\s*(.*)$/.exec(lines[i]);
    if (nameM) { pendingName = nameM[1].trim(); continue; }
    const runM = /^(\s*)run:\s*(.*)$/.exec(lines[i]);
    if (!runM) continue;
    const indent = runM[1].length;
    const inline = runM[2].trim();
    let body = '';
    if (inline && !/^[|>][-+]?$/.test(inline)) {
      body = inline;
    } else {
      const parts = [];
      for (let j = i + 1; j < lines.length; j += 1) {
        const line = lines[j];
        if (!line.trim()) { parts.push(''); continue; }
        const ind = (/^(\s*)/.exec(line) || [, ''])[1].length;
        if (ind <= indent) break;
        parts.push(line);
      }
      body = parts.join('\n');
    }
    steps.push({ name: pendingName, run: body });
    pendingName = '(unnamed step)';
  }
  return steps.filter((s) => s.run);
}

const workflows = fs.existsSync(WF_DIR) ? fs.readdirSync(WF_DIR).filter((f) => /\.ya?ml$/.test(f)) : [];
if (!workflows.length) fail.push('zero_workflows_found - no workflow files under .github/workflows, so this validator examined nothing.');

const examined = [];
let tokensExamined = 0;

for (const file of workflows) {
  const text = readText(path.join(WF_DIR, file));
  const steps = stepRunBlocks(text);
  let stale = false;
  let staleSince = null;
  for (const step of steps) {
    for (const m of step.run.matchAll(/\bnpm run ([\w:@.-]+)/g)) {
      const name = m[1];
      tokensExamined += 1;
      if (publishScripts.has(name)) { stale = true; staleSince = `${file} / ${step.name} (npm run ${name})`; }
      if (repairScripts.has(name)) { stale = false; staleSince = null; }
      if (checkScripts.has(name) && stale) {
        fail.push(
          `stale_accepted_artifact_check:${file} / ${step.name} runs "npm run ${name}", which reaches accepted-artifact-recovery, while a page-publish from ${staleSince} is still outstanding - no recover:accepted-artifacts or self-heal ran in between. ` +
          `A build that publishes a page and is checked without regenerating data/release/accepted_page_artifacts.json fails on a healthy tree. Fix the workflow: run \`npm run recover:accepted-artifacts\` or route the check through self-heal before this step.`
        );
      }
    }
  }
  examined.push({ workflow: file, steps: steps.length, ends_stale: stale });
}

if (!fail.length && !tokensExamined) {
  fail.push('zero_command_tokens_examined - workflows were parsed but no `npm run <name>` token was found in any step, so PUBLISH/REPAIR/CHECK classification never ran. That means the parser broke.');
}

const report = {
  schema_version: '1.0',
  validator: 'lane-accepted-artifact-regen-reach',
  status: fail.length ? 'FAIL' : 'PASS',
  publish_scripts: [...publishScripts].sort(),
  repair_scripts: [...repairScripts].sort(),
  check_scripts: [...checkScripts].sort(),
  workflows_examined: examined,
  command_tokens_examined: tokensExamined,
  notes,
  errors: fail,
};
const evAbs = path.join(ROOT, EVIDENCE);
fs.mkdirSync(path.dirname(evAbs), { recursive: true });
fs.writeFileSync(evAbs, `${JSON.stringify(report, null, 2)}\n`);

if (fail.length) {
  for (const f of fail) console.error(`VALIDATION FAIL: ${f}`);
  console.error(`  evidence: ${EVIDENCE}`);
  process.exit(1);
}

console.log('Accepted-artifact regen reach');
console.log(`  publish scripts   : ${[...publishScripts].sort().join(', ')}`);
console.log(`  repair scripts    : ${[...repairScripts].sort().join(', ')}`);
console.log(`  check scripts     : ${[...checkScripts].sort().join(', ')}`);
console.log(`  workflows examined: ${examined.length}`);
console.log(`lane-accepted-artifact-regen-reach PASS: ${tokensExamined} command token(s) across ${workflows.length} workflow(s) examined; every reachable accepted-artifact-recovery check follows a repair or self-heal when a page-publish precedes it.`);
