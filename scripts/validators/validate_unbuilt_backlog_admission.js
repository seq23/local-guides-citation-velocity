#!/usr/bin/env node
/* eslint-disable no-console */
'use strict';
/**
 * The declared unbuilt backlog must be maintained by a working ADMISSION half,
 * not by a person editing the file after each red build.
 *
 * The defect this exists to stop
 * -----------------------------
 * data/content/unbuilt_rich_page_backlog.json is graded by
 * scripts/validators/validate_rich_new_page_contract.js, which HARD_FAILs when a
 * route is admitted for build in the contract, is not built, and is not declared
 * in the backlog. That assertion is correct and is not weakened here.
 *
 * What was missing was the other side. scripts/content/reconcile_unbuilt_backlog.js
 * could only DELETE entries whose route had become built. Nothing anywhere ADDED
 * a newly admitted-but-unbuilt route. So every absorption that admitted new
 * rich-authority routes turned main red - the governed ceiling is 2 new URLs a
 * day, so nearly none of them can be built on the run that admits them - and the
 * only remedy was a human writing backlog entries by hand. On 2026-09-03 that was
 * 11 neuro guides and clusters, and the release lane had died the same way on
 * many days before.
 *
 * Why rich-new-page-contract cannot be this guard
 * ----------------------------------------------
 * It grades the FILE. A backlog a human hand-wrote five minutes ago passes it
 * identically to one a working reconciler produced. That is precisely how the
 * defect kept coming back: each red was hand-patched, main went green, and the
 * next absorption broke it again. Proving the file is currently complete says
 * nothing about whether anything will keep it complete tomorrow.
 *
 * What this asserts - behaviour, executed
 * ---------------------------------------
 *   1. RULE 0. The shared derivation must yield a non-empty admitted set. Zero
 *      rich-authority rows means the contract is unreadable or the classifier
 *      changed shape, and this validator would then be grading nothing.
 *
 *   2. ADMISSION ACTUALLY RUNS. The reconciler is handed a COPY of the real
 *      backlog with every AWAITING_RELEASE_LANE entry stripped out, and must
 *      re-declare all of them from the contract. This executes the reconciler; it
 *      does not read its source. Delete the admission half, or break the shared
 *      derivation, and this fails. Canonical data is untouched: the copy lives in
 *      a temp directory and the reconciler refuses the self-test flag against the
 *      canonical path.
 *
 *   3. THE QUEUE IS REBUILT AFTER ADMISSION. A route admitted by the reconciler
 *      is declared AWAITING_RELEASE_LANE, and
 *      scripts/validators/validate_unbuilt_backlog_drain.js HARD_FAILs on an
 *      entry awaiting a lane that cannot admit it. The release queue is built
 *      before the reconciler runs, so unless `release:velocity-content` rebuilds
 *      it afterwards, every newly declared route is a promise the lane cannot
 *      keep and the drain validator turns main red instead. This asserts the
 *      pipeline still has that second rebuild.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const cp = require('child_process');

const ROOT = path.resolve(__dirname, '../..');
const EVIDENCE = 'artifacts/validation/unbuilt-backlog-admission.json';
const BACKLOG_REL = 'data/content/unbuilt_rich_page_backlog.json';
const RECONCILER = 'scripts/content/reconcile_unbuilt_backlog.js';

const { admittedRichRoutes, builtPredicate } = require('../lib/rich_admitted_routes');

const errors = [];
const readJson = (abs, fb) => { try { return JSON.parse(fs.readFileSync(abs, 'utf8')); } catch { return fb; } };

// ---------------------------------------------------------------- 1. Rule 0
const admitted = admittedRichRoutes(ROOT);
const isBuilt = builtPredicate(ROOT);
const admittedUnbuilt = admitted.routes.filter((r) => !isBuilt(r));

if (!admitted.sourceRowCount || !admitted.rows.length) {
  errors.push(
    `zero_admitted_rows_examined - the shared derivation in scripts/lib/rich_admitted_routes.js returned ${admitted.sourceRowCount} candidate row(s) and ${admitted.rows.length} rich-authority row(s). ` +
    `With an empty admitted set this validator grades nothing and every assertion below is vacuously true, so it hard-fails rather than passing on an empty loop.`
  );
}

// ------------------------------------------------- 2. admission, executed
const backlogAbs = path.join(ROOT, BACKLOG_REL);
const backlog = readJson(backlogAbs, null);
let selfTest = null;

if (!backlog || !Array.isArray(backlog.routes)) {
  errors.push(`declared_backlog_unreadable:${BACKLOG_REL} - cannot run the admission self-test without the backlog to copy.`);
} else if (!errors.length) {
  const awaiting = backlog.routes
    .filter((e) => e && e.route && String(e.disposition || '').toUpperCase() === 'AWAITING_RELEASE_LANE')
    .map((e) => e.route);

  if (!awaiting.length) {
    // Not a pass-by-emptiness: with nothing awaiting there is nothing to strip,
    // so the self-test cannot demonstrate anything and must say so.
    errors.push(
      `no_awaiting_entries_to_test - ${BACKLOG_REL} declares ${backlog.routes.length} route(s) but none with disposition AWAITING_RELEASE_LANE, ` +
      `so stripping them yields an unchanged file and the admission self-test would prove nothing. Either the backlog is fully retired (record that deliberately) or the dispositions changed shape.`
    );
  } else {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'backlog-admission-'));
    const copyRel = path.relative(ROOT, path.join(dir, 'backlog.json'));
    const receiptRel = path.relative(ROOT, path.join(dir, 'receipt.json'));
    const stripped = {
      ...backlog,
      routes: backlog.routes.filter((e) => !(e && String(e.disposition || '').toUpperCase() === 'AWAITING_RELEASE_LANE')),
    };
    stripped.declared_count = stripped.routes.length;
    fs.writeFileSync(path.join(dir, 'backlog.json'), `${JSON.stringify(stripped, null, 2)}\n`);

    const r = cp.spawnSync(process.execPath, [RECONCILER], {
      cwd: ROOT,
      encoding: 'utf8',
      env: {
        ...process.env,
        RECONCILE_SELFTEST: '1',
        RECONCILE_BACKLOG_PATH: copyRel,
        RECONCILE_RECEIPT_PATH: receiptRel,
      },
    });

    const after = readJson(path.join(dir, 'backlog.json'), { routes: [] });
    const redeclared = new Set((after.routes || []).map((e) => e && e.route).filter(Boolean));
    const missed = awaiting.filter((route) => !redeclared.has(route));

    selfTest = {
      stripped_awaiting: awaiting.length,
      reconciler_exit: r.status,
      routes_after: (after.routes || []).length,
      redeclared: awaiting.length - missed.length,
      missed_count: missed.length,
      missed_first_10: missed.slice(0, 10),
      canonical_untouched: true,
    };

    if (r.status !== 0) {
      errors.push(
        `admission_selftest_reconciler_failed - ${RECONCILER} exited ${r.status} when handed a backlog with its ${awaiting.length} AWAITING_RELEASE_LANE entries stripped out. ` +
        `It must be able to rebuild those declarations from the contract. Output: ${String(r.stderr || r.stdout || '').trim().split('\n').slice(-3).join(' | ')}`
      );
    } else if (missed.length) {
      errors.push(
        `admission_half_does_not_redeclare:${missed.length} of ${awaiting.length} - ${RECONCILER} was handed a backlog with every AWAITING_RELEASE_LANE entry removed and did not re-declare ${missed.length} of them from the contract. ` +
        `That is the exact state that turned main red daily: routes admitted for build, not built, and nothing that declares them, so validate_rich_new_page_contract.js hard-fails until a human writes the entries by hand. ` +
        `Restore the admission half in ${RECONCILER}. First 10: ${missed.slice(0, 10).join(', ')}`
      );
    }
    // The self-test wrote only inside the temp directory.
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* best effort */ }
  }
}

// --------------------------------------- 3. the queue is rebuilt afterwards
const pkg = readJson(path.join(ROOT, 'package.json'), { scripts: {} });
const releaseScript = String((pkg.scripts || {})['release:velocity-content'] || '');
if (!releaseScript) {
  errors.push('release_script_missing - package.json has no "release:velocity-content" script, so the ordering that keeps newly declared routes offered to the release law cannot be checked.');
} else {
  const steps = releaseScript.split('&&').map((x) => x.trim());
  const reconcileAt = steps.findIndex((x) => /\breconcile\b|backlog:reconcile/.test(x));
  const queueAfter = steps.findIndex((x, i) => i > reconcileAt && /strategy:release-queue/.test(x));
  if (reconcileAt < 0) {
    errors.push('reconcile_not_in_release_script - "release:velocity-content" no longer runs backlog:reconcile, so nothing declares newly admitted routes during a release.');
  } else if (queueAfter < 0) {
    errors.push(
      'release_queue_not_rebuilt_after_reconcile - "release:velocity-content" runs backlog:reconcile but does not run strategy:release-queue afterwards. ' +
      'The queue is built BEFORE the reconciler, so a route the reconciler declares AWAITING_RELEASE_LANE is not in data/release/page_release_queue.json, ' +
      'and validate_unbuilt_backlog_drain.js hard-fails on an entry awaiting a lane that cannot admit it. Without the second rebuild, fixing the undeclared-routes failure simply moves main\'s red from one validator to another. ' +
      `Current script: ${releaseScript}`
    );
  }
}

const report = {
  schema_version: '1.0',
  validator: 'unbuilt-backlog-admission',
  status: errors.length ? 'FAIL' : 'PASS',
  candidate_rows_read: admitted.sourceRowCount,
  rich_rows_examined: admitted.rows.length,
  rich_routes_examined: admitted.routes.length,
  admitted_unbuilt_total: admittedUnbuilt.length,
  admission_selftest: selfTest,
  release_script: releaseScript,
  errors,
};
const evAbs = path.join(ROOT, EVIDENCE);
fs.mkdirSync(path.dirname(evAbs), { recursive: true });
fs.writeFileSync(evAbs, `${JSON.stringify(report, null, 2)}\n`);

if (errors.length) {
  for (const e of errors) console.error(`VALIDATION FAIL: ${e}`);
  console.error(`  evidence: ${EVIDENCE}`);
  process.exit(1);
}

console.log('Unbuilt backlog admission');
console.log(`  candidate rows read               : ${admitted.sourceRowCount}`);
console.log(`  rich-authority rows examined      : ${admitted.rows.length} over ${admitted.routes.length} route(s)`);
console.log(`  admitted and unbuilt              : ${admittedUnbuilt.length}`);
console.log(`  admission self-test               : stripped ${selfTest.stripped_awaiting} awaiting entr(ies), reconciler re-declared ${selfTest.redeclared}`);
console.log(`  release queue rebuilt after reconcile: yes`);
console.log(`unbuilt-backlog-admission PASS: the reconciler rebuilt all ${selfTest.stripped_awaiting} stripped declaration(s) from the contract, so the backlog is maintained by a working admission half rather than by hand.`);
