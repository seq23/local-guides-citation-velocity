#!/usr/bin/env node
'use strict';
// Rendered HTML must match the accepted bytes in data/release/frozen_page_registry.json.
//
// PAGE_RELEASE_LAW.md §8 makes accepted output physically frozen; §9 requires
// repairs in durable source, generator, registry, or workflow code rather than
// hand-edited rendered HTML. Nothing in the core profile enforced either.
//
// The failure this catches is quiet, which is what makes it worth a HARD_FAIL:
// edited rendered output passes every other validator, the frozen guard at the
// end of the next build silently reverts it, and the deployed site never
// changes - so CI reports green over a no-op. Observed on 1,130 pages.
//
// Drift here is not always a hand edit. It also appears when a generator change
// is left outside an authorized mutation transaction, which is the legitimate
// path: frozen_pages.js begin -> build -> accept.

const fs = require('fs');
const path = require('path');
const { verifyFrozenPages } = require('../lib/frozen_pages.js');

const ROOT = path.resolve(__dirname, '../..');
const EVIDENCE = path.join(ROOT, 'artifacts/validation/frozen-output-integrity.json');

const result = verifyFrozenPages();
const errors = result.errors || [];

fs.mkdirSync(path.dirname(EVIDENCE), { recursive: true });
fs.writeFileSync(EVIDENCE, `${JSON.stringify({
  schema_version: '1.0',
  validator: 'frozen-output-integrity',
  authority: 'docs/PAGE_RELEASE_LAW.md',
  status: result.ok ? 'PASS' : 'FAIL',
  frozen_route_count: result.count,
  error_count: errors.length,
  errors: errors.slice(0, 200),
}, null, 2)}\n`);

if (!result.ok) {
  console.error(`FROZEN OUTPUT INTEGRITY FAIL: ${errors.length} of ${result.count} route(s) drifted`);
  for (const e of errors.slice(0, 20)) console.error(`  ${e}`);
  if (errors.length > 20) console.error(`  ...and ${errors.length - 20} more (see ${path.relative(ROOT, EVIDENCE)})`);
  console.error('  remedy: npm run freeze:restore, then fix durable source per PAGE_RELEASE_LAW.md §9');
  console.error('  intentional change: node scripts/frozen_pages.js begin <release-id> <route...> -> npm run build -> accept');
  process.exit(1);
}
console.log(`FROZEN OUTPUT INTEGRITY PASS: ${result.count} accepted routes match frozen bytes`);
