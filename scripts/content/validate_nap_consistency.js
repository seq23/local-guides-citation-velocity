#!/usr/bin/env node
'use strict';
// NAP citation consistency, made honest about whether it measured anything.
//
// What this used to do, and why that was wrong
// --------------------------------------------
// It read content-bank/nap-citation-registry.json, looped over `obj.records`,
// and printed {"status":"PASS","records":0,"errors":[]} with exit 0. The
// registry has held ZERO records for its entire life - production CI logs carry
// "nap-citation-registry.json": { "fields": 13, "records": 0 } - so this
// validator has never compared a single business name, address or phone number
// against another. Every run it printed the same word, PASS, that it would print
// after checking a thousand consistent records. "All the NAP records agree" and
// "there are no NAP records" are not the same statement, and a reader of the CI
// log had no way to tell them apart.
//
// Rule 0: no stage may exit 0 having done nothing. Zero records is not a clean
// bill of health, it is an unverifiable one. It is now reported as its own
// status, UNVERIFIED_NO_RECORDS, with a named stop and the remedy, and the
// process exits non-zero so a human actually sees it. The word PASS is now
// reserved for a run that compared at least one record.

const fs = require('fs');
const path = require('path');

const ROOT = process.cwd();
const REGISTRY = 'content-bank/nap-citation-registry.json';
const regPath = path.join(ROOT, REGISTRY);

const write = (report) => {
  fs.mkdirSync(path.join(ROOT, 'reports'), { recursive: true });
  fs.mkdirSync(path.join(ROOT, 'artifacts/validation'), { recursive: true });
  const body = JSON.stringify(report, null, 2) + '\n';
  fs.writeFileSync(path.join(ROOT, 'reports/nap-consistency.json'), body);
  fs.writeFileSync(path.join(ROOT, 'artifacts/validation/nap-consistency.json'), body);
};

// An absent or unreadable registry is a named stop, not a silent zero.
if (!fs.existsSync(regPath)) {
  const report = { status: 'UNVERIFIED_REGISTRY_MISSING', records: 0, errors: [`${REGISTRY} does not exist`] };
  write(report);
  console.error(JSON.stringify(report, null, 2));
  console.error(`NAP CONSISTENCY: STOP - ${REGISTRY} is not present, so no NAP record could be read and nothing was checked.`);
  console.error('  Remedy: restore the registry, or retire this validator in _validation_registry.json. Do not let its absence read as consistency.');
  process.exit(1);
}

let obj;
try {
  obj = JSON.parse(fs.readFileSync(regPath, 'utf8'));
} catch (e) {
  const report = { status: 'UNVERIFIED_REGISTRY_UNREADABLE', records: 0, errors: [`${REGISTRY} is not valid JSON (${e.message})`] };
  write(report);
  console.error(JSON.stringify(report, null, 2));
  console.error(`NAP CONSISTENCY: STOP - ${REGISTRY} could not be parsed (${e.message}), so nothing was checked.`);
  process.exit(1);
}

const records = Array.isArray(obj.records) ? obj.records : [];

// ------------------------------------------------------------------- Rule 0
// The whole defect, in one branch. Zero records means zero comparisons; saying
// PASS here is the empty-loop pass this repo keeps finding.
if (records.length === 0) {
  const report = {
    status: 'UNVERIFIED_NO_RECORDS',
    records: 0,
    comparisons: 0,
    errors: [],
    stop_reason: `${REGISTRY} declares ${(obj.fields || []).length} NAP fields but holds zero records, so NAP consistency has never been measured.`,
    remedy: 'Populate the registry with the real business NAP rows (one per listing surface), or mark this validator INACTIVE with a reason. Until then no consistency claim can be made.',
  };
  write(report);
  console.error(JSON.stringify(report, null, 2));
  console.error(`NAP CONSISTENCY: STOP - ${report.stop_reason}`);
  console.error('  This is NOT a pass. Nothing was compared; the registry is empty.');
  console.error(`  Remedy: ${report.remedy}`);
  process.exit(1);
}

const seen = new Map();
const errors = [];
let comparisons = 0;
for (const r of records) {
  if (!r.business_name) { errors.push('NAP record missing business_name'); continue; }
  const key = r.business_name;
  const prev = seen.get(key);
  if (prev) {
    comparisons++;
    if (JSON.stringify(prev) !== JSON.stringify(r)) errors.push(`inconsistent NAP for ${key}`);
  }
  seen.set(key, r);
}

const report = {
  status: errors.length ? 'FAIL' : 'PASS',
  records: records.length,
  distinct_business_names: seen.size,
  comparisons,
  errors,
};
write(report);
console[errors.length ? 'error' : 'log'](JSON.stringify(report, null, 2));
if (errors.length) process.exit(1);
console.log(`NAP CONSISTENCY PASS: checked ${records.length} record(s) across ${seen.size} business name(s); ${comparisons} same-name comparison(s) made, all consistent.`);
