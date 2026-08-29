#!/usr/bin/env node
'use strict';
/**
 * Local pantry usage trace contract.
 *
 * WHAT THIS USED TO DO, AND WHY IT WAS WRONG
 *
 * Four lines, byte-for-byte identical to scripts/content/trace_local_pantry_usage.js.
 * It opened content-bank/, counted array lengths, and wrote a report whose
 * "status":"PASS" was a hardcoded string literal. There was no exit(1), no FAIL
 * branch and no throw anywhere in the file, so no input could make it fail: it
 * was proven to pass against an emptied content-bank/.
 *
 * The registry compounded it. This validator's `requires_files` names
 * scripts/content/trace_local_pantry_usage.js -- which nothing in the repo ever
 * executed (no npm alias, no caller). So the registry proved the tracer EXISTED
 * and never that it had RUN, and this gate "validated" a trace that had never
 * been produced.
 *
 * It now runs the tracer itself and judges the trace the tracer just produced.
 * Every assertion below can fail on a real input:
 *
 *   HARD STOPS (Rule 0: no stage may exit 0 having done nothing)
 *     - content-bank/ absent
 *     - content-bank/ present but holding zero JSON banks
 *     - zero pantry items examined across all banks
 *     - zero source files scanned for consumers (the usage half unmeasured)
 *     - any bank that does not parse
 *     - any bank whose every array field is empty
 *
 *   MEASURED FINDING (reported loudly, does not stop the build)
 *     - a bank no file in the repo reads, or one only a validator reads. That
 *       content reaches no reader. It is a measured, honest number, and the
 *       registry files this validator as STRONG_WARNING, so it is named in full
 *       and recorded in the evidence file rather than turned red here.
 *
 * The distinction that matters, and the one the old file erased: "measured and
 * bad" warns; "not measured at all" stops.
 */
const fs = require('fs');
const path = require('path');
const { trace, writeTrace } = require('./trace_local_pantry_usage');

const ROOT = path.resolve(__dirname, '..', '..');

const result = trace();
writeTrace(result);

const errors = [];

if (!result.bank_dir_exists) {
  errors.push('content-bank/ does not exist: the local pantry was not measured at all.');
} else if (result.bank_file_count === 0) {
  errors.push('content-bank/ holds zero *.json banks: nothing was examined.');
}
if (result.bank_dir_exists && result.items_examined === 0) {
  errors.push('zero pantry items examined across all banks; a trace that counted nothing is not a pass.');
}
if (result.sources_scanned === 0) {
  errors.push('zero source files scanned for pantry consumers; the usage half of this trace was not measured.');
}
for (const e of result.parse_errors) {
  errors.push(`bank does not parse -- ${e}`);
}
for (const [file, info] of Object.entries(result.files)) {
  if (info.parse_error) continue;
  if (info.items === 0) {
    errors.push(`${file}: every array field is empty (${Object.keys(info.arrays).length} array field(s), 0 items).`);
  }
}

const evidence = {
  validator: 'local-pantry-trace',
  status: errors.length ? 'FAIL' : 'PASS',
  items_examined: result.items_examined,
  bank_file_count: result.bank_file_count,
  sources_scanned: result.sources_scanned,
  unconsumed_banks: result.unconsumed_banks,
  validation_only_banks: result.validation_only_banks,
  pipeline_backed_banks: result.pipeline_backed_banks,
  errors,
  trace: result,
};
fs.mkdirSync(path.join(ROOT, 'artifacts/validation'), { recursive: true });
fs.writeFileSync(
  path.join(ROOT, 'artifacts/validation/local-pantry-trace.json'),
  JSON.stringify(evidence, null, 2) + '\n'
);

if (errors.length) {
  console.error('LOCAL PANTRY TRACE FAIL');
  for (const e of errors) console.error(`  - ${e}`);
  process.exit(1);
}

console.log(
  `LOCAL PANTRY TRACE: ${result.bank_file_count} bank(s), ${result.items_examined} item(s) examined, `
  + `${result.sources_scanned} source file(s) scanned for consumers.`
);

const unread = [...result.unconsumed_banks, ...result.validation_only_banks].sort();
if (unread.length) {
  console.warn('[local-pantry-trace] STRONG WARNING ONLY:');
  console.warn(
    `- ${unread.length} of ${result.bank_file_count} bank(s) reach no reader: `
    + `${result.unconsumed_banks.length} are read by no file in the repo, `
    + `${result.validation_only_banks.length} are read only by a validator that never ships their content.`
  );
  for (const f of unread) {
    const kind = result.unconsumed_banks.includes(f) ? 'no consumer' : 'validator-only';
    console.warn(`    ${f}  (${result.files[f].items} items, ${kind})`);
  }
  console.warn(`- ${result.pipeline_backed_banks.length} bank(s) are read by a pipeline path.`);
  console.warn('- This is a measured finding, not an unmeasured one. Full detail in artifacts/validation/local-pantry-trace.json.');
} else {
  console.log('  every bank is read by a pipeline path.');
}
