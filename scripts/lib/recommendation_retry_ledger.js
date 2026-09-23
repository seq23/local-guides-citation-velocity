'use strict';
// A recommendation that a release worked but did not land on its page is retried first,
// counted per release, and escalated to a person once retrying has stopped working.
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../..');
const LEDGER_REL = 'data/report_fixes/recommendation_retry_ledger.json';
const ledgerFile = () => process.env.RECOMMENDATION_RETRY_LEDGER || path.join(ROOT, LEDGER_REL);
const ESCALATE_AFTER = 3;
const DONE = new Set(['RELEASED_VERIFIED', 'APPLIED_VERIFIED']);

function read() {
  try {
    const doc = JSON.parse(fs.readFileSync(ledgerFile(), 'utf8'));
    return { ...doc, entries: doc.entries || {} };
  } catch {
    return { schema_version: '1.0', escalate_after: ESCALATE_AFTER, entries: {} };
  }
}

function write(doc) {
  const entries = Object.fromEntries(Object.entries(doc.entries).sort(([a], [b]) => a.localeCompare(b)));
  const out = { schema_version: '1.0', escalate_after: ESCALATE_AFTER, updated_at: doc.updated_at, entry_count: Object.keys(entries).length, entries };
  fs.writeFileSync(ledgerFile(), `${JSON.stringify(out, null, 2)}\n`);
}

// attempted: fix-ledger rows this release worked. A row now on its page leaves the ledger;
// a row still missing gains one attempt per release date (re-running a date does not count twice).
function recordOutcomes(fixes, attemptedIds, date, reasonFor) {
  const doc = read();
  const byId = new Map(fixes.map((f) => [f.id, f]));
  let cleared = 0; let missed = 0;
  for (const id of attemptedIds) {
    const fix = byId.get(id);
    if (!fix) continue;
    if (DONE.has(String(fix.implementation_status || ''))) {
      if (doc.entries[id]) { delete doc.entries[id]; cleared += 1; }
      continue;
    }
    const prior = doc.entries[id] || { attempts: 0, first_missed: date };
    doc.entries[id] = {
      ...prior,
      attempts: prior.last_attempt === date ? prior.attempts : prior.attempts + 1,
      last_attempt: date,
      run_date: fix.run_date || '',
      vertical: fix.vertical || '',
      page: fix.renderedPath || fix.intended_winner_path || '',
      query: fix.query || '',
      reason: reasonFor(fix)
    };
    missed += 1;
  }
  doc.updated_at = date;
  write(doc);
  return { cleared, missed, escalated: escalated(doc).length };
}

function escalated(doc = read()) {
  return Object.entries(doc.entries).filter(([, e]) => e.attempts >= ESCALATE_AFTER).map(([id, e]) => ({ id, ...e }));
}

module.exports = { LEDGER_REL, ESCALATE_AFTER, read, recordOutcomes, escalated };
