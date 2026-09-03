#!/usr/bin/env node
/* eslint-disable no-console */
'use strict';
/**
 * Every workflow that can reach a script reading the repo's own git history must
 * check out with `fetch-depth: 0`.
 *
 * The defect this exists to stop
 * -----------------------------
 * scripts/citation_velocity/recover_historic_artifact_loss.js resolves the bytes
 * a page used to carry with `git show <historic_max_commit>:<file>`. It is the
 * registered repair for the Tier 1 HARD_FAIL validator historic-artifact-recovery,
 * which is in seven profiles including `core`.
 *
 * .github/workflows/query-evidence-refresh.yml ran the self-heal loop - and so
 * the whole `core` profile - behind actions/checkout with no `with:` block at
 * all, which means the default fetch-depth: 1. With one commit of history every
 * historic commit is an "invalid object name", so all 104 candidate routes were
 * unreadable, the script's own Rule 0 guard fired, and BOTH the validator and its
 * repair exited 1. The self-heal loop reported REPAIRS_CHANGED_NOTHING and failed
 * the lane every single day - on a tree that was completely healthy. Validate
 * Repo passed on the identical sha eighteen minutes later, because it checks out
 * with fetch-depth: 0.
 *
 * Nothing in the repo could see that. The logs said "recovery is UNKNOWN"; they
 * could not say "you did not fetch the history". The failure was an ENVIRONMENT
 * problem wearing the costume of data loss, which is precisely the misdiagnosis
 * that gets a validator weakened instead of an environment fixed.
 *
 * What this asserts
 * -----------------
 * Behaviour, not prose. It derives - it does not hardcode - both halves:
 *
 *   1. Which scripts read git history, by reading their source for a git
 *      invocation combined with a history-reading subcommand.
 *   2. Which workflows can execute those scripts, by expanding each workflow's
 *      `run:` commands through package.json scripts, direct `node <path>` calls,
 *      and _validation_registry.json profiles, repair_commands and prepare_commands.
 *
 * A workflow that can reach one of those scripts and does not set fetch-depth: 0
 * is a hard failure, and the message names the workflow, the script and the path
 * it reached it by.
 *
 * Rule 0: this hard-fails if it finds zero history-reading scripts, zero
 * workflows, or zero reachable pairs. Every one of those means the derivation
 * broke and the check is inspecting nothing - which must never read as a pass.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../..');
const EVIDENCE = 'artifacts/validation/lane-git-history-depth.json';
const WF_DIR = path.join(ROOT, '.github/workflows');

const fail = [];
const notes = [];

function readText(p) { try { return fs.readFileSync(p, 'utf8'); } catch { return ''; } }
function readJson(p, fb) { try { return JSON.parse(fs.readFileSync(path.join(ROOT, p), 'utf8')); } catch { return fb; } }

// ---------------------------------------------------------------- half one
// Which scripts read git history?
//
// A git invocation plus a subcommand that can only be answered from history.
// `git status`, `git rev-parse HEAD` and `git diff` against the working tree all
// work in a shallow clone, so they are deliberately not in this list.
const HISTORY_SUBCOMMANDS = ['show', 'rev-list', 'log', 'cat-file', 'merge-base', 'blame'];
const GIT_CALL = /(execFileSync|execSync|spawnSync|exec)\s*\(\s*['"`]git|['"`]git\s|\bgit\s+(show|rev-list|log|cat-file|merge-base|blame)\b/;

// Every string or template literal in a source file that begins with an
// executable name. This is the difference between "this script runs that" and
// "this script's error message mentions that".
const LITERAL = /`([^`\\]*(?:\\.[^`\\]*)*)`|'([^'\\\n]*(?:\\.[^'\\\n]*)*)'|"([^"\\\n]*(?:\\.[^"\\\n]*)*)"/g;
function commandLiterals(src) {
  const out = [];
  for (const m of String(src || '').matchAll(LITERAL)) {
    const body = (m[1] ?? m[2] ?? m[3] ?? '').trim();
    if (/^(node|npm\s+run|npx)\s/.test(body)) out.push(body);
  }
  return out;
}

function walk(dir, out = []) {
  let entries = [];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    const abs = path.join(dir, e.name);
    if (e.isDirectory()) { if (e.name !== 'node_modules') walk(abs, out); }
    else if (/\.(js|mjs|cjs)$/.test(e.name)) out.push(abs);
  }
  return out;
}

const historyScripts = new Set();
for (const abs of walk(path.join(ROOT, 'scripts'))) {
  const src = readText(abs);
  if (!GIT_CALL.test(src)) continue;
  // Require an actual history subcommand, quoted as an argv element or inline.
  const usesHistory = HISTORY_SUBCOMMANDS.some((sub) =>
    new RegExp(`['"\`]${sub}['"\`]`).test(src) || new RegExp(`\\bgit\\s+${sub}\\b`).test(src));
  const relp = path.relative(ROOT, abs);
  // This validator names the git subcommands it looks for, so it matches its own
  // detector. It does not read history; excluding it keeps the evidence honest.
  if (usesHistory && relp !== 'scripts/validators/validate_lane_git_history_depth.js') historyScripts.add(relp);
}

if (!historyScripts.size) {
  fail.push('zero_history_reading_scripts_found - the derivation that finds scripts reading git history matched nothing under scripts/. Either every such script was removed (in which case delete this validator deliberately) or the detection broke. It must not pass on an empty set.');
}

// ---------------------------------------------------------------- half two
// Which workflows can reach them?
const pkg = readJson('package.json', { scripts: {} });
const npmScripts = pkg.scripts || {};
const registry = readJson('_validation_registry.json', { validators: [] });
const validators = registry.validators || [];

const NODE_CALL = /\bnode\s+((?:scripts|tools)\/[\w./-]+\.(?:js|mjs|cjs))/g;
const NPM_CALL = /\bnpm\s+run\s+([\w:@.-]+)/g;
const PROFILE_CALL = /run_validation_registry\.js\s+--profile\s+(\S+)/g;
const ID_CALL = /run_validation_registry\.js\s+--id\s+([\w:-]+)/g;

// Expand a shell command into every script path it can eventually execute.
// Over-approximates on purpose: a template like `--profile ${PROFILE}` is treated
// as every profile, because a guard that guesses narrow is a guard that misses.
function expand(command, seen = new Set(), trail = []) {
  const reached = new Map(); // scriptPath -> trail
  const stack = [[String(command || ''), trail]];
  while (stack.length) {
    const [cmd, how] = stack.pop();
    if (!cmd || seen.has(cmd)) continue;
    seen.add(cmd);

    for (const m of cmd.matchAll(NODE_CALL)) {
      const p = m[1];
      if (!reached.has(p)) reached.set(p, [...how, `node ${p}`]);
      // A script that shells out to other scripts extends the reach - but only
      // through commands it actually RUNS. An earlier version scanned the whole
      // source for `npm run x`, which followed every command name quoted inside a
      // remedy message or a comment and produced 40-hop trails through scripts
      // that never execute anything. Only string and template literals that BEGIN
      // with node/npm/npx are treated as commands; a literal like
      // "...re-run npm run validate:release and commit" does not start with one
      // and is correctly ignored.
      const src = readText(path.join(ROOT, p));
      // A script that cannot spawn a process cannot execute a command, whatever
      // its source happens to quote. scripts/workflows/build_workflow_yaml_inventory.js
      // holds a TABLE of other lanes' commands as data - `command: 'npm run
      // release:self-healing'` describes velocity-full-rebuild.yml, it does not
      // run it - and following that produced a confident, entirely fictional
      // reachability trail. Requiring child_process is what separates a command
      // from a string that looks like one.
      if (!/child_process/.test(src)) continue;
      for (const literal of commandLiterals(src)) {
        stack.push([literal, [...how, `node ${p}`, `runs: ${literal.slice(0, 70)}`]]);
      }
    }

    for (const m of cmd.matchAll(NPM_CALL)) {
      const body = npmScripts[m[1]];
      if (body) stack.push([body, [...how, `npm run ${m[1]}`]]);
    }

    for (const m of cmd.matchAll(ID_CALL)) {
      const v = validators.find((x) => x.id === m[1]);
      if (v) for (const c of [v.command, v.repair_command, ...(v.prepare_commands || [])]) {
        if (c) stack.push([c, [...how, `validator ${v.id}`]]);
      }
    }

    for (const m of cmd.matchAll(PROFILE_CALL)) stack.push([`__PROFILE__ ${m[1]}`, [...how, `--profile ${m[1]}`]]);

    const prof = /^__PROFILE__\s+(\S+)$/.exec(cmd);
    if (prof) {
      const name = prof[1];
      // `${PROFILE}` and friends are unresolvable statically; assume every profile.
      const templated = /[$}{]/.test(name);
      for (const v of validators) {
        if (!templated && !(v.profiles || []).includes(name)) continue;
        for (const c of [v.command, v.repair_command, ...(v.prepare_commands || [])]) {
          if (c) stack.push([c, [...how, `profile ${templated ? '(any, resolved at runtime)' : name}`, `validator ${v.id}`]]);
        }
      }
    }
  }
  return reached;
}

const workflows = fs.existsSync(WF_DIR) ? fs.readdirSync(WF_DIR).filter((f) => /\.ya?ml$/.test(f)) : [];
if (!workflows.length) {
  fail.push(`zero_workflows_found - no workflow files under .github/workflows, so this validator examined nothing. That is a hard failure, not a pass.`);
}

const examined = [];
let reachablePairs = 0;

for (const file of workflows) {
  const text = readText(path.join(WF_DIR, file));
  if (!/actions\/checkout/.test(text)) { notes.push(`${file}: no checkout step; not applicable.`); continue; }

  // fetch-depth as written on the checkout step(s) in this workflow.
  // Read fetch-depth off each checkout STEP, by walking the lines that belong to
  // that step rather than a fixed-size window. A comment block above `with:` is
  // long enough to fall outside any window, and a guard that silently reads the
  // default because its regex ran out of characters is worse than no guard.
  const lines = text.split('\n');
  const depths = [];
  for (let i = 0; i < lines.length; i += 1) {
    if (!/actions\/checkout@/.test(lines[i])) continue;
    const indent = (/^(\s*)-?\s*/.exec(lines[i]) || [, ''])[1].length;
    let depth = '1';
    for (let j = i + 1; j < lines.length; j += 1) {
      const line = lines[j];
      if (!line.trim()) continue;
      const ind = (/^(\s*)/.exec(line) || [, ''])[1].length;
      // A new list item at or left of this step's indentation ends the step, and
      // so does any line dedented past it. `with:` and `uses:` are SIBLINGS at
      // the same indentation when the dash sits on the `- name:` line above, so
      // an `ind <= indent` break ends the step before it ever sees `with:` - which
      // is how this read velocity-content-release.yml, a fetch-depth: 0 lane, as
      // shallow.
      if (/^\s*-\s/.test(line) && ind <= indent) break;
      if (ind < indent) break;
      const d = /^\s*fetch-depth:\s*(\S+)/.exec(line);
      if (d) { depth = d[1]; break; }
    }
    depths.push(depth);
  }
  const deepest = depths.includes('0') ? '0' : (depths[0] || '1');

  // Every `run:` command in the workflow, extracted line-by-line rather than with
  // one large regex. The regex version stopped at the first blank line inside a
  // block scalar, so a long `run: |` step - which is most of them here - had all
  // but its first paragraph dropped, and validate-repo.yml appeared to reach 4
  // scripts when it reaches dozens. A guard that under-reads its input passes for
  // the wrong reason.
  const runs = [];
  for (let i = 0; i < lines.length; i += 1) {
    const m = /^(\s*)run:\s*(.*)$/.exec(lines[i]);
    if (!m) continue;
    const indent = m[1].length;
    const inline = m[2].trim();
    if (inline && !/^[|>][-+]?$/.test(inline)) { runs.push(inline); continue; }
    const body = [];
    for (let j = i + 1; j < lines.length; j += 1) {
      const line = lines[j];
      if (!line.trim()) { body.push(''); continue; }
      const ind = (/^(\s*)/.exec(line) || [, ''])[1].length;
      if (ind <= indent) break;
      body.push(line);
    }
    runs.push(body.join('\n'));
  }

  const reached = new Map();
  for (const r of runs) for (const [p, trail] of expand(r, new Set(), [`${file}`])) if (!reached.has(p)) reached.set(p, trail);

  const needsHistory = [...reached.keys()].filter((p) => historyScripts.has(p));
  reachablePairs += needsHistory.length;
  examined.push({ workflow: file, fetch_depth: deepest, scripts_reached: reached.size, history_scripts_reached: needsHistory });

  if (needsHistory.length && deepest !== '0') {
    for (const p of needsHistory) {
      fail.push(
        `shallow_checkout_reaches_git_history:${file} checks out with fetch-depth: ${deepest} but can execute ${p}, which reads the repository's own history. ` +
        `Under a shallow checkout every historic commit is an "invalid object name", so that script fails on a healthy tree and takes the lane red with it. ` +
        `Reached by: ${(reached.get(p) || []).join(' -> ')}. Fix the environment - add \`fetch-depth: 0\` to the checkout step - do not restructure the script around the missing history.`
      );
    }
  }
}

if (!fail.length && !reachablePairs) {
  fail.push(
    `zero_reachable_history_scripts - ${historyScripts.size} script(s) read git history and ${workflows.length} workflow(s) were parsed, but the reachability derivation connected none of them to any workflow. ` +
    `That means the command expansion stopped working, so this validator would pass no matter how shallow every checkout became. An empty loop is a hard failure, not a pass.`
  );
}

const report = {
  schema_version: '1.0',
  validator: 'lane-git-history-depth',
  status: fail.length ? 'FAIL' : 'PASS',
  history_reading_scripts: [...historyScripts].sort(),
  workflows_examined: examined,
  reachable_history_script_pairs: reachablePairs,
  notes,
  errors: fail
};
const evAbs = path.join(ROOT, EVIDENCE);
fs.mkdirSync(path.dirname(evAbs), { recursive: true });
fs.writeFileSync(evAbs, `${JSON.stringify(report, null, 2)}\n`);

if (fail.length) {
  for (const f of fail) console.error(`VALIDATION FAIL: ${f}`);
  console.error(`  evidence: ${EVIDENCE}`);
  process.exit(1);
}

console.log('Lane git history depth');
console.log(`  scripts that read git history     : ${historyScripts.size}`);
for (const p of [...historyScripts].sort()) console.log(`    ${p}`);
console.log(`  workflows examined                : ${examined.length}`);
for (const e of examined) {
  const flag = e.history_scripts_reached.length ? `reaches ${e.history_scripts_reached.length} history script(s)` : 'no history dependency';
  console.log(`    ${e.workflow}: fetch-depth=${e.fetch_depth}, ${e.scripts_reached} script(s) reachable, ${flag}`);
}
console.log(`lane-git-history-depth PASS: ${reachablePairs} workflow/history-script pair(s) examined; every workflow that can execute a git-history-reading script checks out with fetch-depth: 0.`);
