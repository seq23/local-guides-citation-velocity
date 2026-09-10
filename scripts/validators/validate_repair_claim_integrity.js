#!/usr/bin/env node
/* eslint-disable no-console */
'use strict';
/**
 * A registered repair claim must be STRUCTURALLY capable of being a repair.
 *
 * The defect this exists to stop
 * -----------------------------
 * `_validation_registry.json` lets a validator claim `repair_command`: "when I
 * fail, self-heal can run this and clear me". On 2026-09-10, `citation-agent-fixes`
 * claimed `npm run apply:citation-agent-fixes`. That command writes
 * data/report_fixes/agent_fix_ledger.json. The verdicts that actually fail that
 * validator - rendered_missing_route, rendered_missing_marker,
 * missing_required_markers - are content facts about rendered pages. No command can
 * invent the sentence a reader needs. The claim was false, self-heal burned an
 * attempt on it, and the lane reported UNRESOLVED instead of the real reason.
 *
 * Why repair-command-efficacy is not enough on its own
 * ----------------------------------------------------
 * repair-command-efficacy is the behavioural check and it is the stronger one, but
 * it can only observe a repair WHILE ITS VALIDATOR IS FAILING - it says so itself:
 * "a repair is only tested against a validator it needs to fix". On a clean tree
 * all ten repair-bearing validators pass, none of their repairs are exercised, and
 * a false claim registered today is invisible until the day it is needed - which is
 * the worst possible day to discover it. This is the repo's named recurring defect
 * class, "runs but inert": the claim exists, nothing invokes it, nobody learns.
 *
 * This validator is the STATIC half, and it runs on every tree, green or red.
 *
 * What this asserts, for every ACTIVE validator declaring a repair_command
 * -----------------------------------------------------------------------
 *   1. RESOLVABLE      - the command resolves to an npm script that exists and to at
 *                        least one .js entry point that exists on disk. A claim
 *                        pointing at nothing can never repair anything.
 *   2. WRITE SURFACE   - repair_writes is present and non-empty. Without it
 *                        repair-command-efficacy cannot tell whether the repair did
 *                        anything and degrades to "unverifiable"; requiring it here
 *                        means efficacy is always measurable, not only when failing.
 *   3. REACHABLE       - every path in repair_writes appears in the transitive
 *                        source closure of the repair command (require() graph plus
 *                        spawned .js entry points). A repair that declares a file
 *                        its own code never names cannot write it, and the
 *                        efficacy check would then watch the wrong file and
 *                        conclude "no-op" or "effective" for the wrong reason.
 *   4. NO CONTRADICTION- a validator must not declare BOTH repair_command and
 *                        no_repair_reason. That is two opposite answers to
 *                        "can a command fix this?" and the reader cannot tell which
 *                        self-heal will believe.
 *   5. SUBSTANTIVE OPT-OUT - a no_repair_reason must be a real explanation, not a
 *                        rubber stamp, so removing a false claim stays honest work
 *                        rather than becoming the easy way to silence this check.
 *
 * Rule 0: hard-fails when it examines zero claims. A registry with no repair_command
 * and no no_repair_reason means the derivation broke or the field was renamed; that
 * must not read as "all clear".
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../..');
const EVIDENCE = 'artifacts/validation/repair-claim-integrity.json';
const MIN_REASON_CHARS = 120;

function readJson(p, fb) { try { return JSON.parse(fs.readFileSync(path.join(ROOT, p), 'utf8')); } catch { return fb; } }
function exists(rel) { const a = path.join(ROOT, rel); return fs.existsSync(a) && fs.statSync(a).isFile(); }

const pkgScripts = readJson('package.json', {}).scripts || {};

// Entry points: follow `npm run <script>` indirection and every `foo.js` token that
// resolves to a real file (covers `node x.js`, spawnSync(process.execPath,['x.js'])).
function entryPoints(cmd, depth = 0, seen = new Set()) {
  const out = [];
  if (depth > 6 || !cmd) return out;
  for (const part of String(cmd).split('&&')) {
    const m = part.trim().match(/^(?:\w+=\S+\s+)*npm run ([\w:-]+)/);
    if (m) {
      if (pkgScripts[m[1]] === undefined) { out.push({ missingScript: m[1] }); continue; }
      if (seen.has(m[1])) continue;
      seen.add(m[1]);
      out.push(...entryPoints(pkgScripts[m[1]], depth + 1, seen));
      continue;
    }
    for (const mm of part.matchAll(/(?:^|\s)([\w./-]+\.js)(?:\s|$)/g)) out.push({ file: mm[1].replace(/^\.\//, '') });
  }
  return out;
}

function sourceClosure(files) {
  const seen = new Set();
  const stack = [...files];
  while (stack.length) {
    const raw = stack.pop();
    if (!raw) continue;
    const rel = raw.replace(/^\.\//, '');
    if (seen.has(rel)) continue;
    if (!exists(rel)) continue;
    seen.add(rel);
    const abs = path.join(ROOT, rel);
    const src = fs.readFileSync(abs, 'utf8');
    for (const m of src.matchAll(/require\(['"](\.[^'"]+)['"]\)/g)) {
      let r = path.relative(ROOT, path.resolve(path.dirname(abs), m[1]));
      if (!r.endsWith('.js')) r += '.js';
      stack.push(r);
    }
    for (const m of src.matchAll(/['"]([\w./-]+\.js)['"]/g)) stack.push(m[1]);
  }
  return [...seen];
}

const registry = readJson('_validation_registry.json', { validators: [] });
const all = registry.validators || [];
const claims = all.filter((v) => v.status === 'ACTIVE' && v.repair_command);
const optOuts = all.filter((v) => v.no_repair_reason);

// Rule 0 - never pass on an empty set.
if (!claims.length && !optOuts.length) {
  console.error('VALIDATION FAIL: zero_repair_claims_examined - no validator in _validation_registry.json declares either repair_command or no_repair_reason. Every repair claim and every deliberate opt-out has vanished at once, which means the field was renamed or the registry failed to parse - not that every claim is sound. Refusing to pass on an empty set.');
  process.exit(1);
}

const fail = [];
const examined = [];

for (const v of claims) {
  const eps = entryPoints(v.repair_command);
  const missingScripts = eps.filter((e) => e.missingScript).map((e) => e.missingScript);
  const files = eps.filter((e) => e.file).map((e) => e.file);
  const realFiles = files.filter(exists);
  const row = { id: v.id, repair_command: v.repair_command, checks: {} };

  // 1. RESOLVABLE
  if (missingScripts.length) {
    fail.push(`repair_command_unresolvable:${v.id} - declares "${v.repair_command}" but package.json has no script named ${missingScripts.map((s) => `"${s}"`).join(', ')}. A repair that cannot start cannot repair.`);
    row.checks.resolvable = false;
  } else if (!realFiles.length) {
    fail.push(`repair_command_no_entry_point:${v.id} - "${v.repair_command}" resolves to no .js file that exists on disk (saw: ${files.join(', ') || 'nothing'}). A repair that cannot start cannot repair.`);
    row.checks.resolvable = false;
  } else {
    row.checks.resolvable = true;
  }

  // 2. WRITE SURFACE DECLARED
  const writes = v.repair_writes || [];
  if (!writes.length) {
    fail.push(`repair_no_declared_write_surface:${v.id} - declares repair_command "${v.repair_command}" but no repair_writes. repair-command-efficacy cannot then tell whether this repair does anything when it runs, and reports it UNVERIFIABLE. Declare the files this repair writes.`);
    row.checks.write_surface_declared = false;
  } else {
    row.checks.write_surface_declared = true;
  }

  // 3. REACHABLE
  if (writes.length && row.checks.resolvable) {
    const closure = sourceClosure(realFiles);
    const src = closure.map((f) => fs.readFileSync(path.join(ROOT, f), 'utf8')).join('\n');
    const unreachable = writes.filter((w) => !src.includes(w) && !src.includes(path.basename(w)));
    row.source_files_scanned = closure.length;
    row.checks.write_surface_reachable = !unreachable.length;
    if (unreachable.length) {
      fail.push(`repair_writes_unreachable:${v.id} - declares it writes ${unreachable.join(', ')}, but no file in the ${closure.length}-file source closure of "${v.repair_command}" so much as names ${unreachable.length > 1 ? 'those paths' : 'that path'}. The repair cannot write what it claims, so repair-command-efficacy watches the wrong file and grades this repair on evidence it can never produce.`);
    }
  }

  // 4. NO CONTRADICTION
  if (v.no_repair_reason) {
    fail.push(`repair_claim_contradiction:${v.id} - declares BOTH repair_command "${v.repair_command}" and no_repair_reason. Those are opposite answers to "can a command clear this validator?" and nothing tells a reader, or self-heal, which one is current. Keep exactly one.`);
    row.checks.no_contradiction = false;
  } else {
    row.checks.no_contradiction = true;
  }

  examined.push(row);
}

// 5. SUBSTANTIVE OPT-OUT
for (const v of optOuts) {
  const reason = String(v.no_repair_reason || '').trim();
  const row = { id: v.id, opt_out: true, reason_chars: reason.length, checks: {} };
  if (reason.length < MIN_REASON_CHARS) {
    fail.push(`no_repair_reason_not_substantive:${v.id} - opts out of declaring a repair with only ${reason.length} characters of explanation (minimum ${MIN_REASON_CHARS}). Removing a false repair claim is legitimate, but it has to say WHAT was claimed and WHY no command can supply the judgment, or this becomes the quiet way to delete a repair nobody wanted to fix.`);
    row.checks.substantive = false;
  } else {
    row.checks.substantive = true;
  }
  examined.push(row);
}

const report = {
  schema_version: '1.0',
  validator: 'repair-claim-integrity',
  status: fail.length ? 'FAIL' : 'PASS',
  active_repair_claims: claims.length,
  deliberate_opt_outs: optOuts.length,
  claims_examined: examined.length,
  examined,
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

console.log('Repair claim integrity');
console.log(`  ACTIVE validators claiming a repair_command : ${claims.length}`);
console.log(`  deliberate no_repair_reason opt-outs        : ${optOuts.length}`);
console.log(`  total claims examined                      : ${examined.length}`);
console.log(`repair-claim-integrity PASS: every repair claim resolves, declares a write surface its own code can reach, and no validator answers "can a command fix this?" twice.`);
