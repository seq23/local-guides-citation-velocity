#!/usr/bin/env node
// Size the Velocity processing budget to the work that has actually landed.
//
// The release lane hard-coded VELOCITY_RELEASE_TARGET to 5. That number is a
// cadence choice, and it was applied to every trigger including the one that
// exists precisely because an external agent just delivered a full run. A single
// dentistry drop on 2026-09-01 carried 70 planable specs; the lane planned 5 and
// recorded 53 as CARRIED_NOT_WORKED. Because a fresh run lands faster than five
// rows a day drain, the backlog never converged and the owner's report kept
// re-reporting fixes the repo had been told about weeks earlier.
//
// The budget is therefore derived rather than declared: count the rows that are
// ready and not yet ledgered, and ask for exactly that many. An explicit
// batch_size input still wins, so a human capping a run keeps the old behaviour,
// and the floor keeps a quiet day behaving exactly as it did before.
//
// This is deliberately vertical-agnostic. It counts whatever is in
// normalized_agent_runs, so a vertical that appears for the first time tomorrow
// is budgeted for without a code change naming it.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const NORMALIZED = path.join(ROOT, 'data/report_fixes/normalized_agent_runs');
const LEDGER = path.join(ROOT, 'data/report_fixes/agent_exact_implementation_ledger.json');
const POLICY = path.join(ROOT, 'data/report_fixes/agent_exact_implementation_policy.json');

// The floor is the lane's historical cadence: never ask for less than it used to.
const FLOOR = Number(process.env.VELOCITY_RELEASE_FLOOR || 5);

function readJson(p, fallback) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return fallback; }
}

function ledgeredIds() {
  const ledger = readJson(LEDGER, { entries: [] });
  const out = new Set();
  for (const entry of ledger.entries || []) {
    for (const key of ['record_ids', 'source_record_ids']) {
      for (const id of entry[key] || []) if (id) out.add(String(id));
    }
    if (entry.record_id) out.add(String(entry.record_id));
  }
  return out;
}

function main() {
  if (!fs.existsSync(NORMALIZED)) {
    // No normalized runs at all is a real state (a fresh clone), not a reason to
    // invent a budget. Fall back to the floor and say so.
    console.error(`[release-budget] ${NORMALIZED} does not exist; using floor ${FLOOR}`);
    process.stdout.write(String(FLOOR));
    return;
  }

  const policy = readJson(POLICY, { effective_from: '9999-12-31', retroactive_processing: false });
  const done = ledgeredIds();

  let pending = 0;
  let runsExamined = 0;
  const perRun = [];

  for (const file of fs.readdirSync(NORMALIZED).filter((f) => f.endsWith('.json')).sort()) {
    const payload = readJson(path.join(NORMALIZED, file), null);
    if (!payload || !Array.isArray(payload.records)) continue;
    runsExamined += 1;
    let runPending = 0;
    for (const row of payload.records) {
      if (row.source !== 'twin_agent_artifact' && row.source_section === undefined) continue;
      // Same pre-cutover rule the plan builder applies, so the budget cannot ask
      // for rows the planner will refuse to work.
      if (policy.retroactive_processing === false && row.run_date && policy.effective_from
        && row.run_date < policy.effective_from) continue;
      if (String(row.status || '') !== 'READY_TO_RELEASE') continue;
      if (done.has(String(row.id))) continue;
      runPending += 1;
    }
    if (runPending) perRun.push(`${file.replace(/\.json$/, '')}=${runPending}`);
    pending += runPending;
  }

  // Rule 0: a budget resolver that examined no runs has not done its job, and a
  // silent floor would look identical to a correct answer. Say which it was.
  if (runsExamined === 0) {
    console.error('[release-budget] FAIL: examined zero normalized runs; refusing to emit a budget on an empty loop');
    process.exit(1);
  }

  const budget = Math.max(FLOOR, pending);
  console.error(`[release-budget] runs=${runsExamined} pending_ready_rows=${pending} floor=${FLOOR} budget=${budget}`);
  if (perRun.length) console.error(`[release-budget] pending by run: ${perRun.join(' ')}`);
  process.stdout.write(String(budget));
}

main();
