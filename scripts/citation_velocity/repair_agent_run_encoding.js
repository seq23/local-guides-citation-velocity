#!/usr/bin/env node
'use strict';
/**
 * Repair double-encoded UTF-8 in a landed Twin Agent artifact - and in any
 * repo-written ledger that copied its bytes - at source.
 *
 *   node scripts/citation_velocity/repair_agent_run_encoding.js <path> [<path>...]           # inspect only
 *   node scripts/citation_velocity/repair_agent_run_encoding.js <path> [<path>...] --write   # rewrite in place
 *
 * Inspect mode prints, per file, how many sequences decode and what survives; it
 * exits 1 when any file would still carry mojibake after repair, so the defect is
 * named before anything is written. --write rewrites only files whose repair is
 * complete and never touches a file that would still be mojibake:
 *   - a text artifact (.csv, .html, .md, ...) is rewritten through a temp file and
 *     verified to read back as the repaired text;
 *   - a .json file is parsed, every string value is decoded exactly (keys and
 *     structure untouched), and it is written through writeJsonVerified so a
 *     ledger can never be left on disk half-repaired or unparseable.
 * The delivered bytes remain in git history.
 *
 * 2026-09-30 trt.csv: 427 sequences (134 "—", 186 "→", 49 "–", 42 "↓", 6 "↑", 6 "…",
 * 4 "≥") stored as c3 a2 c2 80 c2 94 ... alongside 282 correctly encoded characters.
 * Intake copied them into the normalized run, the source ledger, the cumulative fix
 * ledger, the implementation ledger and the acceptance manifest. The first two are
 * regenerated from the CSV; the last three are cumulative and keyed by ids hashed
 * from the delivered text, so their 30 Sep entries would carry the mojibake forever
 * (and the refreeze marker check would reject any rebuild that "lost" it). Intake
 * now decodes this shape on read (scripts/lib/agent_run_drop_integrity.js
 * readArtifactText) and agent-run-drop-integrity refuses a repo-written ledger that
 * carries it; this CLI is how the committed source and ledgers are brought back to
 * once-encoded text so everything downstream regenerates clean.
 */
const fs = require('fs');
const path = require('path');
const { repairDoubleEncodedUtf8 } = require('../lib/text_encoding_repair');
const { textDefect, writeJsonVerified, readJsonStrict } = require('../lib/agent_run_drop_integrity');

const ROOT = path.resolve(__dirname, '../..');
const args = process.argv.slice(2);
const write = args.includes('--write');
const files = args.filter((a) => a !== '--write');
if (!files.length) {
  console.error('usage: repair_agent_run_encoding.js <path> [<path>...] [--write]');
  process.exit(2);
}

/** Decode every string value in a parsed JSON document; returns the repaired value and the merged verdict. */
function repairJsonValue(value, tally) {
  if (typeof value === 'string') {
    const v = repairDoubleEncodedUtf8(value);
    tally.repaired += v.repaired;
    if (v.residual) { tally.residual_count += v.residual_count; for (const s of v.residual_samples) tally.residual_samples.add(s); }
    for (const [k, n] of Object.entries(v.samples)) tally.samples[k] = (tally.samples[k] || 0) + n;
    return v.text;
  }
  if (Array.isArray(value)) return value.map((item) => repairJsonValue(item, tally));
  if (value && typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) out[k] = repairJsonValue(v, tally);
    return out;
  }
  return value;
}

function formatSamples(samples) { return Object.entries(samples).map(([k, n]) => `${n}x ${k}`).join(', '); }

let failed = false;
let totalRepaired = 0;
for (const given of files) {
  const abs = path.isAbsolute(given) ? given : path.join(ROOT, given);
  const label = path.relative(ROOT, abs).replace(/\\/g, '/');
  if (!fs.existsSync(abs)) { console.error(`FAIL ${label}: missing_file`); failed = true; continue; }
  const buf = fs.readFileSync(abs);
  const defect = textDefect(buf);
  if (defect) { console.error(`FAIL ${label}: ${defect}; not text this repair can read`); failed = true; continue; }

  if (label.endsWith('.json')) {
    const read = readJsonStrict(abs, { requireObject: false });
    if (!read.ok) { console.error(`FAIL ${label}: ${read.defect}: ${read.detail}`); failed = true; continue; }
    const tally = { repaired: 0, residual_count: 0, residual_samples: new Set(), samples: {} };
    const repairedValue = repairJsonValue(read.value, tally);
    if (tally.residual_count) { console.error(`FAIL ${label}: ${tally.repaired} sequence(s) decode but ${tally.residual_count} mojibake match(es) survive in string values: ${[...tally.residual_samples].join(' ')}; refusing to write`); failed = true; continue; }
    if (!tally.repaired) { console.log(`CLEAN ${label}: no double-encoded UTF-8`); continue; }
    totalRepaired += tally.repaired;
    if (!write) { console.log(`WOULD REPAIR ${label}: ${tally.repaired} sequence(s) across string values: ${formatSamples(tally.samples)}`); continue; }
    writeJsonVerified(abs, repairedValue);
    console.log(`REPAIRED ${label}: ${tally.repaired} sequence(s) across string values: ${formatSamples(tally.samples)}`);
    continue;
  }

  const verdict = repairDoubleEncodedUtf8(buf.toString('utf8'));
  if (verdict.residual) {
    console.error(`FAIL ${label}: ${verdict.repaired} sequence(s) decode but ${verdict.residual_count} mojibake match(es) survive: ${verdict.residual_samples.join(' ')}; refusing to write`);
    failed = true;
    continue;
  }
  if (!verdict.repaired) { console.log(`CLEAN ${label}: no double-encoded UTF-8`); continue; }
  totalRepaired += verdict.repaired;
  if (!write) { console.log(`WOULD REPAIR ${label}: ${verdict.repaired} sequence(s) in ${verdict.passes.length} pass(es): ${formatSamples(verdict.samples)}`); continue; }
  const tmp = `${abs}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, verdict.text, 'utf8');
  const back = fs.readFileSync(tmp, 'utf8');
  if (back !== verdict.text || repairDoubleEncodedUtf8(back).residual) { fs.rmSync(tmp, { force: true }); console.error(`FAIL ${label}: repaired text did not read back exactly; original left untouched`); failed = true; continue; }
  fs.renameSync(tmp, abs);
  console.log(`REPAIRED ${label}: ${verdict.repaired} sequence(s) in ${verdict.passes.length} pass(es): ${formatSamples(verdict.samples)}`);
}
if (failed) { console.error('REPAIR AGENT RUN ENCODING FAIL'); process.exit(1); }
console.log(`REPAIR AGENT RUN ENCODING ${write ? 'DONE' : 'INSPECT'}: ${totalRepaired} sequence(s) across ${files.length} file(s)`);
