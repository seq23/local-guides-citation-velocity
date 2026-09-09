#!/usr/bin/env node
/* eslint-disable no-console */
'use strict';
/**
 * NO TRACKED FILE MAY CARRY A GIT CONFLICT MARKER.
 *
 * On 2026-09-09, PRs #99, #100 and #101 each landed on a main that had moved, and the
 * rebases were resolved with directory pathspecs - `git checkout --theirs -- artifacts`
 * - because the conflicts were all in regenerable validation receipts and resolving 44
 * of them one by one looked like the slow path. It was the correct instinct and the
 * wrong command: `--theirs` on a directory silently leaves any file git had already
 * written markers into exactly as it found it. 28 receipts reached main carrying
 * `<<<<<<< HEAD`, 276 marker lines in validation-summary-release.json alone.
 *
 * Nothing caught it. Every one of those files is JSON, and JSON with a conflict marker
 * in it does not parse - so the code that reads them fell into a catch and treated the
 * file as absent. scripts/selfheal/publish_gate_decision.mjs could not read the summary
 * and correctly refused to publish; other readers default to an empty object and simply
 * see nothing, which is the "runs but inert" failure mode this repo keeps finding. A
 * corrupt receipt is worse than a missing one because it looks present.
 *
 * The check is cheap and total: every tracked text file, scanned for a marker at the
 * start of a line. It costs a second and it closes the whole class, including the next
 * agent who reaches for the same directory pathspec at two in the morning.
 *
 * Rule 0: scanning zero files is a FAILURE. If git cannot list the tree, corruption is
 * UNKNOWN, not absent.
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '../..');
const OUT_REL = 'artifacts/validation/no-conflict-markers.json';

// A marker only counts at the start of a line. "<<<<<<<" inside prose or a diff quoted
// in a comment is not a conflict; git only ever writes them column 0.
const MARKERS = [/^<{7}\s/m, /^={7}$/m, /^>{7}\s/m];
// `=======` alone appears legitimately in markdown underlines and ASCII rules, so it is
// only a marker when the file also carries one of the unambiguous two.
const UNAMBIGUOUS = [/^<{7}\s/m, /^>{7}\s/m];

const ls = spawnSync('git', ['ls-files', '-z'], { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
if (ls.status !== 0 || typeof ls.stdout !== 'string') {
  console.error('NO CONFLICT MARKERS FAIL: `git ls-files` did not answer, so this scanned zero files. Whether the tree carries conflict markers is UNKNOWN, not proven.');
  process.exit(1);
}
const files = ls.stdout.split('\0').filter(Boolean);
if (!files.length) {
  console.error('NO CONFLICT MARKERS FAIL: git lists zero tracked files. Refusing to pass on an empty loop.');
  process.exit(1);
}

const BINARY = /\.(png|jpe?g|gif|webp|avif|ico|pdf|zip|gz|tgz|woff2?|ttf|eot|mp4|webm|mp3|wasm)$/i;
const offenders = [];
let scanned = 0;
for (const rel of files) {
  if (BINARY.test(rel)) continue;
  const abs = path.join(ROOT, rel);
  let text;
  try {
    const stat = fs.statSync(abs);
    if (!stat.isFile() || stat.size > 64 * 1024 * 1024) continue;
    text = fs.readFileSync(abs, 'utf8');
  } catch { continue; }
  if (text.includes('\0')) continue;
  scanned += 1;
  if (!UNAMBIGUOUS.some((re) => re.test(text))) continue;
  const lines = text.split('\n');
  const hits = [];
  lines.forEach((line, i) => {
    if (MARKERS.some((re) => re.test(line))) hits.push(i + 1);
  });
  offenders.push({ path: rel, marker_lines: hits.length, first_line: hits[0] || null });
}

if (!scanned) {
  console.error(`NO CONFLICT MARKERS FAIL: ${files.length} tracked file(s) listed but none was readable as text, so this scanned zero. Refusing to pass on an empty loop.`);
  process.exit(1);
}

const report = {
  schema_version: '1.0',
  validator: 'no-conflict-markers',
  status: offenders.length ? 'FAIL' : 'PASS',
  tracked_files: files.length,
  text_files_scanned: scanned,
  offender_count: offenders.length,
  offenders,
  checked_at: process.env.SOURCE_DATE || new Date().toISOString().slice(0, 10),
};
fs.mkdirSync(path.join(ROOT, 'artifacts/validation'), { recursive: true });
fs.writeFileSync(path.join(ROOT, OUT_REL), `${JSON.stringify(report, null, 2)}\n`, 'utf8');

if (offenders.length) {
  const total = offenders.reduce((a, o) => a + o.marker_lines, 0);
  console.error(`NO CONFLICT MARKERS FAIL: ${offenders.length} tracked file(s) carry ${total} git conflict marker line(s). A JSON receipt with a marker in it does not parse, so every reader treats it as absent - corrupt, not missing, which is worse.`);
  for (const o of offenders.slice(0, 30)) console.error(`  ${o.path} :: ${o.marker_lines} marker line(s), first at line ${o.first_line}`);
  if (offenders.length > 30) console.error(`  ...and ${offenders.length - 30} more; see ${OUT_REL}`);
  process.exit(1);
}
console.log(`NO CONFLICT MARKERS PASS: ${scanned} tracked text file(s) of ${files.length} scanned; none carries a git conflict marker.`);
