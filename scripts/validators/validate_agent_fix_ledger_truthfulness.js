#!/usr/bin/env node
/* eslint-disable no-console */
'use strict';
/**
 * A ledger that says "released" must be describing a page that shows it.
 *
 * data/report_fixes/agent_fix_ledger.json records, per recommendation, the rendered
 * page it targets and `required_markers` - the text that must appear on that page for
 * the recommendation to be satisfied. Nothing compared the two.
 *
 * 2026-09-02: a TRT run landed 51 recommendations, every one against trt/index.html.
 * finalize_content_release.js marked all 51 RELEASED_VERIFIED because the ROUTE had
 * completed a freeze transaction - thawed, rebuilt, refrozen - for an unrelated repair
 * spec. Twelve of the 51 required_markers were absent from the page and remained
 * absent. Because prepare_velocity_intake_release.js permanently excludes
 * RELEASED_VERIFIED ids from selection, those twelve could never be worked again: the
 * artifact was recorded as delivered and quietly retired.
 *
 * Three separate records existed and none of them agreed:
 *   - agent_fix_ledger.json           : RELEASED_VERIFIED
 *   - agent_artifact_disposition_ledger.json : QUEUED_FOR_FUTURE_RELEASE
 *   - trt/index.html                  : the requested H2 and comparison matrix absent
 *
 * This validator makes the page the authority. Every fix claiming released status must
 * have every one of its declared markers present in its rendered file.
 *
 * Rule 0: examining zero fixes is a FAILURE. An empty or unreadable ledger means
 * truthfulness is UNKNOWN, not proven.
 *
 * The baseline is a RATCHET over rows that predate the guard. A row in it that is now
 * truthful is reported stale and must be removed; a row not in it is a hard failure.
 * It can only shrink. `npm run recover:fix-ledger-truthfulness` is the registered
 * repair: it re-derives the status of every untruthful row from the page, which both
 * corrects the record and returns genuinely unfinished work to the selection queue.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../..');
const LEDGER_REL = 'data/report_fixes/agent_fix_ledger.json';
const BASELINE_REL = 'data/report_fixes/agent_fix_ledger_truthfulness_baseline.json';
const OUT_REL = 'artifacts/validation/agent-fix-ledger-truthfulness.json';
const RELEASED_STATES = new Set(['RELEASED_VERIFIED', 'APPLIED_VERIFIED']);

function readJson(rel, fallback) {
  try { return JSON.parse(fs.readFileSync(path.join(ROOT, rel), 'utf8')); } catch { return fallback; }
}

const pageCache = new Map();
function pageText(rel) {
  if (!rel) return null;
  if (pageCache.has(rel)) return pageCache.get(rel);
  const abs = path.join(ROOT, rel);
  let value = null;
  if (fs.existsSync(abs)) {
    const html = fs.readFileSync(abs, 'utf8');
    value = { html, decoded: html.replace(/&#8212;/g, '—').replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&') };
  }
  pageCache.set(rel, value);
  return value;
}

/** Absent markers for one fix, or the reason it cannot be checked. */
function auditFix(fix) {
  const rendered = fix.renderedPath || '';
  if (!rendered) return { reason: 'no_rendered_path', missing: [] };
  const page = pageText(rendered);
  if (!page) return { reason: 'rendered_file_missing', missing: [] };
  const markers = Array.isArray(fix.required_markers) ? fix.required_markers.filter(Boolean) : [];
  // A released claim with nothing to verify it against is unproven, not proven.
  if (!markers.length) return { reason: 'no_required_markers', missing: [] };
  const missing = markers.filter((marker) => {
    const raw = String(marker);
    const encoded = raw.replace(/—/g, '&#8212;');
    return !(page.html.includes(raw) || page.decoded.includes(raw) || page.html.includes(encoded) || page.decoded.includes(encoded));
  });
  return { reason: missing.length ? 'required_markers_absent' : '', missing };
}

function collectUntruthful(ledger) {
  const out = [];
  for (const fix of ledger.fixes || []) {
    if (!RELEASED_STATES.has(String(fix.implementation_status || ''))) continue;
    const verdict = auditFix(fix);
    if (!verdict.reason) continue;
    out.push({
      id: fix.id,
      run_date: fix.run_date || '',
      vertical: fix.vertical || '',
      rendered_path: fix.renderedPath || '',
      implementation_status: fix.implementation_status,
      reason: verdict.reason,
      missing_markers: verdict.missing.slice(0, 3),
    });
  }
  return out;
}

function main() {
  const ledger = readJson(LEDGER_REL, null);
  if (!ledger || !Array.isArray(ledger.fixes)) {
    console.error(`AGENT FIX LEDGER TRUTHFULNESS FAIL: ${LEDGER_REL} is missing or unreadable, so this validator examined zero fixes. Truthfulness is UNKNOWN, not proven.`);
    process.exit(1);
  }
  const claimed = (ledger.fixes || []).filter((fix) => RELEASED_STATES.has(String(fix.implementation_status || '')));
  if (!claimed.length) {
    console.error(`AGENT FIX LEDGER TRUTHFULNESS FAIL: ${ledger.fixes.length} fix(es) present but none claims a released status, so this validator examined zero claims. A ledger with nothing to prove cannot prove itself; refusing to pass on an empty loop.`);
    process.exit(1);
  }

  const untruthful = collectUntruthful(ledger);
  const baseline = readJson(BASELINE_REL, { accepted_untruthful_ids: [] });
  const accepted = new Set(baseline.accepted_untruthful_ids || []);
  const untruthfulIds = new Set(untruthful.map((row) => row.id));

  const newRows = untruthful.filter((row) => !accepted.has(row.id));
  const staleBaseline = [...accepted].filter((id) => !untruthfulIds.has(id)).sort();

  const report = {
    schema_version: '1.0',
    validator: 'agent-fix-ledger-truthfulness',
    status: newRows.length || staleBaseline.length ? 'FAIL' : 'PASS',
    fixes_in_ledger: ledger.fixes.length,
    released_claims_examined: claimed.length,
    untruthful_count: untruthful.length,
    accepted_baseline_count: accepted.size,
    new_untruthful: newRows.slice(0, 200),
    new_untruthful_count: newRows.length,
    stale_baseline: staleBaseline,
  };
  fs.mkdirSync(path.join(ROOT, path.dirname(OUT_REL)), { recursive: true });
  fs.writeFileSync(path.join(ROOT, OUT_REL), `${JSON.stringify(report, null, 2)}\n`, 'utf8');

  if (staleBaseline.length) {
    console.error(`AGENT FIX LEDGER TRUTHFULNESS FAIL: ${staleBaseline.length} baselined id(s) are now truthful and must be removed from ${BASELINE_REL}. The baseline is a ratchet; leaving a repaired row in it would let the same row silently regress.`);
  }
  for (const row of newRows.slice(0, 25)) {
    console.error(`AGENT FIX LEDGER TRUTHFULNESS FAIL: ${row.id} (${row.run_date} ${row.vertical}) is recorded ${row.implementation_status} but ${row.rendered_path || 'its page'} does not show it: ${row.reason}${row.missing_markers.length ? ` - missing ${JSON.stringify(row.missing_markers[0])}` : ''}. A count is not a change.`);
  }
  if (newRows.length > 25) console.error(`AGENT FIX LEDGER TRUTHFULNESS: ${newRows.length - 25} further untruthful row(s) listed in ${OUT_REL}.`);

  if (report.status === 'FAIL') {
    console.error(`AGENT FIX LEDGER TRUTHFULNESS: FAIL - examined ${claimed.length} released claim(s); ${newRows.length} unaccounted, ${staleBaseline.length} stale baseline entr(y/ies). Repair with: npm run recover:fix-ledger-truthfulness`);
    process.exit(1);
  }
  console.log(`AGENT FIX LEDGER TRUTHFULNESS PASS: examined ${claimed.length} released claim(s) across ${ledger.fixes.length} ledger row(s); ${untruthful.length} untruthful, all in the accepted baseline.`);
}

if (require.main === module) main();
module.exports = { auditFix, collectUntruthful, RELEASED_STATES, LEDGER_REL, BASELINE_REL };
