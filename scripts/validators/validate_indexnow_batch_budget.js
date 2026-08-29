#!/usr/bin/env node
'use strict';
/**
 * The IndexNow batch budget, and the backlog the budget creates.
 *
 * Two defects lived here.
 *
 * 1. This validator passed having examined nothing. Its loop was
 *    `for (const file of [priority, batch]) { if (!fs.existsSync(p)) continue; ... }`
 *    so with neither file on disk it iterated zero URLs and printed
 *    {"status":"PASS"}. It is declared HARD_FAIL, and it was structurally
 *    incapable of failing on absence - the exact empty-loop pass this repo
 *    keeps finding. Reproduced on 2026-08-29: with no .build present it exited
 *    0. It now hard-fails when it examines zero URLs, and the registry gives it
 *    requires_files plus a prepare command so an absent .build is a blocking
 *    PREREQUISITE_MISSING rather than a silent pass.
 *
 * 2. "Deferred" did not mean later. docs/INDEXNOW-ROOT-CAUSE-FIX.md says
 *    overflow URLs go to indexnow-deferred-batch.txt "instead of submitting
 *    thousands at once" and that IndexNow is submitted "in safe batches". There
 *    were no batches, plural. scorePriority is a pure function of the slug, so
 *    the top 100 was a fixed set: every deploy submitted the identical 100 URLs
 *    and 2051 were deferred forever. The cap is legitimate and stays - large
 *    mixed batches partially fail, which is what it was written to prevent -
 *    but a queue that never advances is not a queue. scripts/build_site.js now
 *    walks the overflow pool with a date cursor and writes a coverage receipt.
 *
 * So this validator asserts, on the data:
 *   - both budget files exist and at least one URL was examined (Rule 0);
 *   - no file exceeds its budget, and every URL parses as http(s);
 *   - the coverage receipt exists and accounts for the WHOLE pool:
 *     batch + deferred == pool. A count of what was submitted must never be
 *     published without the count of what was not;
 *   - the rotation actually rotates - there are rotating slots, the pool closes
 *     in a bounded number of days, and the cursor is inside the pool. A
 *     deferred set that can never be reached is a permanent silent drop of
 *     everything below the cut.
 */
const fs = require('fs');
const path = require('path');

const ROOT = process.cwd();
const limit = Number.parseInt(process.env.INDEXNOW_SAFE_BATCH_LIMIT || '100', 10);
const max = Number.isFinite(limit) && limit > 0 ? limit : 100;

const PRIORITY = '.build/indexnow-priority.txt';
const BATCH = '.build/indexnow-batch.txt';
const DEFERRED = '.build/indexnow-deferred-batch.txt';
const COVERAGE = '.build/indexnow-batch-coverage.json';

const errors = [];
const readUrls = (rel) => {
  const p = path.join(ROOT, rel);
  if (!fs.existsSync(p)) return null;
  return fs.readFileSync(p, 'utf8').split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
};

let urlsExamined = 0;
const counts = {};
for (const rel of [PRIORITY, BATCH, DEFERRED]) {
  const urls = readUrls(rel);
  if (urls === null) {
    // Absence is not a pass. The whole point of this validator is the budget,
    // and there is no budget to check when the artifact was never built.
    errors.push(`${rel} is missing. This validator refuses to report a budget it did not measure; build the distribution artifacts first (npm run build).`);
    continue;
  }
  counts[rel] = urls.length;
  if (rel !== DEFERRED) {
    const budget = rel === PRIORITY ? 50 : max;
    if (urls.length > budget) errors.push(`${rel} has ${urls.length} URLs; max ${budget}`);
    if (urls.length === 0) errors.push(`${rel} holds zero URLs. A deploy that submits nothing is not a successful deploy.`);
  }
  urlsExamined += urls.length;
  for (const u of urls) {
    try {
      const parsed = new URL(u);
      if (!/^https?:$/.test(parsed.protocol)) errors.push(`${rel} invalid protocol: ${u}`);
    } catch { errors.push(`${rel} invalid URL: ${u}`); }
  }
}

// ------------------------------------------------------------------- Rule 0
if (urlsExamined === 0) {
  errors.push('examined zero URLs across every budget file - refusing to pass on an empty loop. A PASS here has meant "nothing was checked" every time .build was absent.');
}

// ------------------------------------- the backlog the budget creates
let coverage = null;
const coverageAbs = path.join(ROOT, COVERAGE);
if (!fs.existsSync(coverageAbs)) {
  errors.push(`${COVERAGE} is missing. The number of URLs submitted must never be published without the number deferred; the coverage receipt is where that accounting lives.`);
} else {
  try { coverage = JSON.parse(fs.readFileSync(coverageAbs, 'utf8')); }
  catch (e) { errors.push(`${COVERAGE} is unreadable JSON (${e.message})`); }
}

if (coverage) {
  const batchCount = counts[BATCH];
  const deferredCount = counts[DEFERRED];
  const pool = Number(coverage.url_pool_total);

  if (!Number.isFinite(pool) || pool <= 0) {
    errors.push(`${COVERAGE}: url_pool_total is not a positive number, so nothing states how large the population actually is.`);
  } else if (Number.isFinite(batchCount) && Number.isFinite(deferredCount) && batchCount + deferredCount !== pool) {
    errors.push(`${COVERAGE}: ${batchCount} submitted + ${deferredCount} deferred = ${batchCount + deferredCount}, which does not account for the declared pool of ${pool}. URLs are going missing between the ranking and the two output files.`);
  }
  if (coverage.batch_urls !== batchCount) errors.push(`${COVERAGE}: batch_urls=${coverage.batch_urls} but ${BATCH} holds ${batchCount}.`);
  if (coverage.deferred_urls !== deferredCount) errors.push(`${COVERAGE}: deferred_urls=${coverage.deferred_urls} but ${DEFERRED} holds ${deferredCount}.`);

  // The rotation must actually rotate.
  const slots = Number(coverage.rotating_slots_per_deploy);
  const overflow = Number(coverage.overflow_pool);
  if (overflow > 0) {
    if (!Number.isFinite(slots) || slots <= 0) {
      errors.push(`${COVERAGE}: the overflow pool holds ${overflow} URLs but rotating_slots_per_deploy is ${coverage.rotating_slots_per_deploy}. With no rotating slots the same batch ships on every deploy and everything below the cut is deferred forever - "deferred" would again be a word that means never.`);
    }
    if (!Number.isFinite(Number(coverage.days_to_full_coverage)) || Number(coverage.days_to_full_coverage) <= 0) {
      errors.push(`${COVERAGE}: days_to_full_coverage is ${coverage.days_to_full_coverage}. The pool must close in a bounded number of days or the deferred set is a permanent silent drop.`);
    }
    const offset = Number(coverage.rotation_offset);
    if (!Number.isFinite(offset) || offset < 0 || offset >= overflow) {
      errors.push(`${COVERAGE}: rotation_offset ${coverage.rotation_offset} is outside the ${overflow}-URL overflow pool.`);
    }
  }
}

const report = {
  status: errors.length ? 'FAIL' : 'PASS',
  validator: 'indexnow-batch-budget',
  maxBatch: max,
  urls_examined: urlsExamined,
  priority_urls: counts[PRIORITY] ?? null,
  batch_urls: counts[BATCH] ?? null,
  deferred_urls: counts[DEFERRED] ?? null,
  url_pool_total: coverage ? coverage.url_pool_total : null,
  rotating_slots_per_deploy: coverage ? coverage.rotating_slots_per_deploy : null,
  days_to_full_coverage: coverage ? coverage.days_to_full_coverage : null,
  errors,
  generated_at: new Date().toISOString()
};
fs.mkdirSync(path.join(ROOT, 'artifacts', 'validation'), { recursive: true });
fs.writeFileSync(path.join(ROOT, 'artifacts', 'validation', 'indexnow-batch-budget.json'), JSON.stringify(report, null, 2) + '\n');

if (errors.length) {
  console.error(JSON.stringify({ status: 'FAIL', errors }, null, 2));
  process.exit(1);
}
console.log(`INDEXNOW BATCH BUDGET PASS: ${urlsExamined} URLs examined; ${counts[BATCH]} of ${coverage.url_pool_total} submitted this deploy (${counts[PRIORITY]} priority, budget ${max}), ${counts[DEFERRED]} deferred to a later deploy; ${coverage.rotating_slots_per_deploy} rotating slot(s) close the ${coverage.overflow_pool}-URL overflow pool every ${coverage.days_to_full_coverage} day(s).`);
