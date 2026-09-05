#!/usr/bin/env node
'use strict';
// Why this file exists.
//
// On 2026-09-04 both head-of-workflow lanes went red and `gh run view <id> --log`
// was unreadable: every line rendered as `UNKNOWN STEP` and the only thing that
// looked like a diagnosis was a bare `##[error]Process completed with exit code 1.`
// The real cause WAS in the log - agent-artifact-continuity's
// `normalized_output_missing:...` - but it sat on line 1188 of 1265, buried under
// ~750 lines in which the validator printed its entire `checked` array as pretty
// JSON. The one line that mattered was drowned by the evidence around it, and the
// LAST thing in the log, which is what a human actually reads, said nothing.
// The diagnosis was only comfortably reachable by downloading a diagnostics
// artifact, which is why this class of failure recurred for four days.
//
// So this does not shorten or suppress anything. It ADDS three surfaces that are
// legible without downloading anything:
//   1. `::error::` annotations, which GitHub renders at the top of the run page.
//   2. A `$GITHUB_STEP_SUMMARY` table, rendered on the run page itself.
//   3. A plain-text block emitted LAST, so the tail of the log is the diagnosis.
// Locally, where neither GitHub variable is set, surface 3 still applies.

const fs = require('fs');
const path = require('path');

const MAX_DETAIL_LINES = 12;

// Pull the human-meaningful failure lines out of a validator's evidence file.
// Validators in this repo converge on `errors` / `violations` / `failures`
// arrays; anything else falls back to the tail of its captured log.
function detailsFor(root, result) {
  const out = [];
  const evidence = result.evidence_file;
  if (evidence) {
    try {
      const parsed = JSON.parse(fs.readFileSync(path.join(root, evidence), 'utf8'));
      for (const key of ['errors', 'violations', 'failures', 'regressions', 'problems']) {
        const rows = parsed && parsed[key];
        if (!Array.isArray(rows) || rows.length === 0) continue;
        for (const row of rows) {
          out.push(typeof row === 'string' ? row : JSON.stringify(row));
        }
      }
    } catch { /* evidence unreadable or absent; fall through to the log */ }
  }
  if (out.length === 0 && result.missing_files && result.missing_files.length) {
    out.push(`prerequisite files missing: ${result.missing_files.join(', ')}`);
  }
  if (out.length === 0 && result.forbidden_source_mutations && result.forbidden_source_mutations.length) {
    out.push(`forbidden source mutations: ${result.forbidden_source_mutations.join(', ')}`);
  }
  if (out.length === 0 && result.missing_outputs && result.missing_outputs.length) {
    out.push(`declared outputs never produced: ${result.missing_outputs.join(', ')}`);
  }
  if (out.length === 0 && result.log) {
    try {
      const lines = fs.readFileSync(path.join(root, result.log), 'utf8').split('\n').filter(Boolean);
      // The runner frames every captured log with `$ <command>`, `STDOUT` and
      // `STDERR`. Those are scaffolding, not diagnosis, and letting them through
      // put "$ node scripts/validators/..." in the first-failure column - which is
      // exactly the uninformative-headline problem this whole change exists to end.
      // If filtering leaves nothing, the scaffolding is all there is, so show it.
      const meaningful = lines.filter(l => !/^\$ /.test(l) && !/^(STDOUT|STDERR)$/.test(l.trim()));
      out.push(...(meaningful.length ? meaningful : lines).slice(-MAX_DETAIL_LINES));
    } catch { /* log unreadable */ }
  }
  if (out.length === 0) {
    out.push(`${result.status} with no machine-readable detail; see ${result.log || result.evidence_file || 'the diagnostics artifact'}`);
  }
  return out.slice(0, MAX_DETAIL_LINES);
}

function blockingResults(report) {
  return (report.results || []).filter(r => r.blocks_release === true
    || ['PREPARE_FAILED', 'PREREQUISITE_MISSING'].includes(r.status));
}

// GitHub workflow commands are single-line; newlines must be percent-encoded.
function encodeAnnotation(text) {
  return String(text).replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');
}

function emitFailureLegibility(report, options = {}) {
  const root = options.root || process.cwd();
  const write = options.write || (s => process.stdout.write(s));
  const env = options.env || process.env;
  const blocking = blockingResults(report);

  // Rule 0: this reporter must never run and say nothing. A FAIL report with no
  // identifiable blocking validator is itself the thing a human needs told.
  const lines = [];
  lines.push('');
  lines.push('==================== BLOCKING VALIDATION FAILURES ====================');
  if (blocking.length === 0) {
    lines.push('The run is FAIL but no validator is marked blocking: that is a runner defect,');
    lines.push('not a content defect. artifacts/validation/validation-summary.json records');
    lines.push(`status=${report.status} counts=${JSON.stringify(report.counts || {})}.`);
  } else {
    lines.push(`${blocking.length} validator(s) blocked this run. Profiles: ${(report.profiles || []).join(', ') || '(none)'}`);
  }

  const summaryRows = [];
  for (const result of blocking) {
    const details = detailsFor(root, result);
    lines.push('');
    lines.push(`--- ${result.id} => ${result.status} (${result.severity || 'severity unknown'})`);
    if (result.title) lines.push(`    ${result.title}`);
    for (const d of details) lines.push(`    ${d}`);
    if (result.evidence_file) lines.push(`    evidence: ${result.evidence_file}`);
    if (result.log) lines.push(`    log: ${result.log}`);

    write(`::error title=${result.id} => ${result.status}::${encodeAnnotation(details.join('\n'))}\n`);
    summaryRows.push({ id: result.id, status: result.status, details, evidence: result.evidence_file, log: result.log });
  }
  lines.push('');
  lines.push('=====================================================================');
  lines.push('');
  write(lines.join('\n'));

  const summaryPath = env.GITHUB_STEP_SUMMARY;
  if (summaryPath) {
    const md = [];
    md.push('## Blocking validation failures', '');
    if (blocking.length === 0) {
      md.push(`Run reported \`${report.status}\` with **no validator marked blocking** — runner defect.`, '');
    } else {
      md.push('| Validator | Status | First failure |', '| --- | --- | --- |');
      for (const row of summaryRows) {
        const first = (row.details[0] || '').replace(/\|/g, '\\|').slice(0, 300);
        md.push(`| \`${row.id}\` | ${row.status} | ${first} |`);
      }
      md.push('');
      for (const row of summaryRows) {
        md.push(`<details><summary><code>${row.id}</code></summary>`, '', '```');
        md.push(...row.details);
        md.push('```', '');
        if (row.evidence) md.push(`evidence: \`${row.evidence}\``, '');
        if (row.log) md.push(`log: \`${row.log}\``, '');
        md.push('</details>', '');
      }
    }
    try {
      fs.appendFileSync(summaryPath, md.join('\n') + '\n');
    } catch { /* summary file unavailable; the annotations and tail block still stand */ }
  }

  return { blocking_count: blocking.length, rows: summaryRows };
}

module.exports = { emitFailureLegibility, detailsFor, blockingResults, encodeAnnotation };
