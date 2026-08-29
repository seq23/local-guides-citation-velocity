#!/usr/bin/env node
'use strict';
/**
 * A lane may not push a tree it did not validate.
 *
 * Three steps in this repo push HEAD:main inside a retry loop that rebases onto
 * whatever main has become. A rebase that applies WITHOUT conflict is not a
 * rebase that changes nothing: origin/main moved - that is the only reason to
 * rebase - so the result is a combination of two separately-validated trees,
 * which is not itself a validated tree.
 *
 * Two of the three already handled this: the Velocity release step in
 * velocity-content-release.yml and the push loop in velocity-full-rebuild.yml
 * both re-run build + validate:release after a successful rebase and amend the
 * result. The absorption step in velocity-content-release.yml did not - it
 * re-derived only on the CONFLICT path and pushed straight through on the clean
 * one. It is also the step that runs first and most often. That was fixed on
 * 2026-08-29, and this validator exists so a future edit cannot quietly undo it,
 * or add a fourth push loop without the same protection.
 *
 * The rule, checked on the workflow source: in any step whose script pushes to
 * main, every `git rebase` must be followed - before the push - by a validation
 * command. "Followed by" is checked textually against the step body, which is
 * the same surface the sibling workflow contracts assert on.
 *
 * Rule 0: hard-fails if it finds zero workflows, zero pushing steps, or zero
 * rebases. A guard that passes because it found nothing to govern is the defect
 * this repo keeps finding.
 */
const fs = require('fs');
const path = require('path');

const ROOT = process.cwd();
const DIR = path.join(ROOT, '.github/workflows');

const errors = [];
const examined = [];

if (!fs.existsSync(DIR)) {
  console.error('PUSH-AFTER-REBASE FAIL: .github/workflows does not exist; nothing could be checked.');
  process.exit(1);
}

const files = fs.readdirSync(DIR).filter((f) => /\.ya?ml$/.test(f)).sort();
if (!files.length) {
  console.error('PUSH-AFTER-REBASE FAIL: no workflow files found; refusing to pass on an empty loop.');
  process.exit(1);
}

// Split the raw YAML into step bodies without a YAML parser: a step body is the
// text between one `- name:`/`- uses:` marker and the next at the same depth.
// Textual is the right granularity here - the thing being governed is the shell
// script inside the step, and the sibling workflow contracts assert on the same
// raw text.
const STEP_SPLIT = /\n(?=\s{6,}- (?:name|uses|id):)/;

let pushingSteps = 0;
let rebasesSeen = 0;

for (const file of files) {
  const raw = fs.readFileSync(path.join(DIR, file), 'utf8');
  for (const step of raw.split(STEP_SPLIT)) {
    if (!/git\s+push\s+origin\s+HEAD:main/.test(step)) continue;
    pushingSteps += 1;
    const label = (step.match(/-\s*(?:name|id):\s*(.+)/) || [, 'unnamed step'])[1].trim();
    const where = `${file} :: ${label}`;
    examined.push(where);

    const rebases = step.match(/git\s+rebase\s+origin\/main/g) || [];
    if (!rebases.length) {
      // A push loop with no rebase pushes exactly what it validated. Fine.
      continue;
    }
    rebasesSeen += rebases.length;

    // The path that matters is the CLEAN rebase. A textual "is there a validate
    // command somewhere between the rebase and the push" is not enough, and
    // saying so is the whole point: the defective version of this step DID have
    // `npm run validate:release` between the two - but only inside the
    // `if ! git rebase ...; then ... fi` CONFLICT branch, which the clean path
    // skips entirely. A guard that matched on proximity passed the very code it
    // was written to catch. So walk the shell structure instead.
    //
    // The clean path is: `if ! git rebase` evaluates false, the `then` block is
    // skipped, execution continues. Validation must therefore appear in an
    // `elif`/`else` arm of that same `if`, or after its closing `fi`, and before
    // the push.
    const lines = step.split('\n');
    const rebaseIf = lines.findIndex((l) => /if\s+!\s+git\s+rebase\s+origin\/main/.test(l));
    const VALIDATE = /npm\s+run\s+validate[:\w-]*/;
    let cleanPathValidates = false;

    if (rebaseIf === -1) {
      // A bare `git rebase` with no if-guard: every path is the clean path, so
      // any validation before the push counts.
      const pushLine = lines.findIndex((l) => /git\s+push\s+origin\s+HEAD:main/.test(l));
      cleanPathValidates = lines.slice(0, pushLine === -1 ? lines.length : pushLine).some((l) => VALIDATE.test(l));
    } else {
      const baseIndent = (lines[rebaseIf].match(/^\s*/) || [''])[0].length;
      let depth = 0;
      let inSkippedThen = true; // the conflict branch, which the clean path skips
      for (let i = rebaseIf + 1; i < lines.length; i += 1) {
        const line = lines[i];
        const indent = (line.match(/^\s*/) || [''])[0].length;
        const trimmed = line.trim();
        if (/^if\b/.test(trimmed)) depth += 1;
        if (indent === baseIndent && /^(elif|else)\b/.test(trimmed) && depth === 0) { inSkippedThen = false; continue; }
        if (indent === baseIndent && /^fi\b/.test(trimmed)) {
          if (depth === 0) { inSkippedThen = false; continue; }
          depth -= 1;
          continue;
        }
        if (/^fi\b/.test(trimmed) && depth > 0) { depth -= 1; continue; }
        if (/git\s+push\s+origin\s+HEAD:main/.test(trimmed) && !inSkippedThen) break;
        if (!inSkippedThen && VALIDATE.test(trimmed)) { cleanPathValidates = true; break; }
      }
    }

    if (!cleanPathValidates) {
      errors.push(
        `${where}: rebases onto origin/main and then pushes to main without re-validating on the CLEAN-rebase path. ` +
        'A conflict-branch re-derivation does not count: a rebase that applies without conflict skips that branch entirely, ' +
        'and still produces a tree nobody validated, because main moved - which is the only reason the rebase happened. ' +
        'Re-run the build and validation and amend the commit before pushing, the way the Velocity release step and velocity-full-rebuild.yml already do.'
      );
    }
  }
}

if (!pushingSteps) errors.push('found zero steps pushing to main. This validator governs push-to-main safety and examined nothing; refusing to pass on an empty loop.');
if (pushingSteps && !rebasesSeen) errors.push(`found ${pushingSteps} step(s) pushing to main but zero rebases. The retry loops this guard exists for have been removed or rewritten; re-check that the push surface is still safe rather than passing on their absence.`);

const report = {
  schema_version: '1.0',
  validator: 'push-after-rebase-revalidates',
  status: errors.length ? 'FAIL' : 'PASS',
  workflows_examined: files.length,
  pushing_steps_examined: pushingSteps,
  rebases_examined: rebasesSeen,
  steps: examined,
  errors,
  checked_at: new Date().toISOString()
};
fs.mkdirSync(path.join(ROOT, 'artifacts/validation'), { recursive: true });
fs.writeFileSync(path.join(ROOT, 'artifacts/validation/push-after-rebase-revalidates.json'), JSON.stringify(report, null, 2) + '\n');

if (errors.length) {
  console.error('PUSH-AFTER-REBASE FAIL:');
  for (const e of errors) console.error(`  - ${e}`);
  process.exit(1);
}
console.log(`PUSH-AFTER-REBASE PASS: ${files.length} workflow(s); ${pushingSteps} step(s) push to main, ${rebasesSeen} rebase(s) examined, every one re-validates before pushing.`);
