// How the self-heal loop decides whether a repair made progress.
//
// Extracted from heal_until_clean.mjs so the decision can be exercised
// directly. The loop itself can only be tested by running a full release
// profile, which is why this logic went three rounds of the SAME defect
// before anyone could see it: a repair that did not fix anything and a repair
// that had nothing left to fix are different states, and the loop kept
// reading them as one.
//
// 2026-09-03 (run 33793861821) fixed the EXIT-0 half: a repair that exits 0
// and touches no file is only a dead end if the validator ALSO still fails,
// because Tier 8's repair-command-efficacy may already have fixed the tree
// mid-pass. The recheck was added, but it was gated behind `code === 0`.
//
// 2026-09-08 (run 34274346332) is the EXIT-NON-ZERO half of that same bug.
// `recover:run-delivery-coverage-ratchet` refused with
//   "REBASELINE REFUSED: no run is unenrolled and no cap can be tightened,
//    so this would rewrite the identical baseline and report success.
//    Nothing to repair."
// and exited 1. That refusal is CORRECT - agent-run-delivery-coverage's own
// artifact recorded PASS in the very same run - but the loop read exit!=0 as
// "repair FAILED", declared REPAIRS_CHANGED_NOTHING and took the release lane
// red. A repair refusing because there is nothing left to repair is the
// success case, not the failure case.
//
// The validator is the authority on whether the tree is healthy. The repair's
// exit code is only a hint about whether the repair did work. So whenever a
// repair reports "no progress" by EITHER route - exit 0 changing nothing, or
// a non-zero refusal - the loop asks the validator, and the validator decides.
// This is not a weakened assertion: it replaces a proxy signal with the real
// one, and a repair that fails while its validator STILL fails is as fatal as
// it ever was.

export function classifyRepair({ code, before, after, recheckPasses }) {
  const changedNothing = before !== null && after !== null && before === after;
  const claimedNoProgress = (code === 0 && changedNothing) || code !== 0;

  // The validator was only consulted when the repair claimed no progress;
  // `recheckPasses` is undefined otherwise and must not be read as a verdict.
  const resolvedByRecheck = claimedNoProgress && recheckPasses === true;

  return {
    noOp: code === 0 && changedNothing && !resolvedByRecheck,
    refusedButResolved: code !== 0 && resolvedByRecheck,
    failed: code !== 0 && !resolvedByRecheck,
    resolvedByRecheck,
    needsRecheck: claimedNoProgress
  };
}

// True when no repair in this pass advanced the tree, so re-running the
// identical validate pass would produce the identical result.
export function noRepairMadeProgress(repaired) {
  if (!repaired.length) return false;
  return repaired.every((x) => x.no_op || (x.code !== 0 && !x.resolved_by_recheck));
}

// A stop that is not printed is not a named stop.
//
// The second half of run 34274346332's defect: the loop captured every repair's
// stdout+stderr into `r.out` and then threw it away. The CI log said only
//
//   repair FAILED for agent-run-delivery-coverage (exit 1)
//
// while the repair itself had printed a complete, actionable named stop -
// "REBASELINE REFUSED: no run is unenrolled and no cap can be tightened ...
// Nothing to repair." - which reached nobody. Triage had to download the run
// artifacts and re-derive from JSON what the repair had already said in words.
//
// So: whenever a repair does not straightforwardly succeed, its own words are
// echoed into the log under the verdict line. A repair that fails while saying
// NOTHING is itself named as a defect, because an unexplained exit code is the
// thing that made this outage expensive.
export const NO_OUTPUT_NOTICE =
  'the repair printed NOTHING - a bare non-zero exit is not a named stop; '
  + 'give this repair an explanatory refusal message';

export function renderRepairOutcome({ id, cmd, code, verdict, out }) {
  const lines = [];
  if (verdict.refusedButResolved) {
    lines.push(`  repair for ${id} exited ${code} because it had nothing left to repair, and ${id} now passes (already fixed earlier in this same validate pass) - not a failure`);
  } else if (verdict.failed) {
    lines.push(`  repair FAILED for ${id} (exit ${code}), and ${id} still fails after it`);
  } else if (verdict.noOp) {
    lines.push(`  repair NO-OP for ${id}: "${cmd}" exited 0 but changed no file, so ${id} cannot clear on a retry`);
  } else if (verdict.resolvedByRecheck) {
    lines.push(`  repair for ${id} changed nothing on this invocation, but ${id} now passes (already fixed earlier in this same validate pass) - not a no-op`);
  } else {
    // Plain success: it changed the tree. Nothing to explain.
    return lines;
  }

  const said = String(out || '').trim();
  if (said) {
    lines.push(`  ${id} repair said:`);
    for (const line of said.split('\n')) lines.push(`    | ${line}`);
  } else if (verdict.failed) {
    lines.push(`  ${id}: ${NO_OUTPUT_NOTICE}`);
  }
  return lines;
}
