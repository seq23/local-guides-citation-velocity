'use strict';
/**
 * Public-signal ingestion health.
 *
 * WHAT THIS USED TO DO, AND WHY IT WAS WRONG
 *
 * readJson() returned {} for a file that does not exist, so every metric below
 * defaulted to 0 and the validator could not tell "Reddit returned nothing" from
 * "no ingestion run has ever written a status file". Both produced the same
 * output - degraded, zero fresh signals - and both exited 0.
 *
 * The warn-and-exit-0 half is CORRECT and is kept exactly as it was. This is a
 * STRONG_WARNING validator: a degraded external feed is a measured, honest signal,
 * release content stays structurally valid without it, and turning that red would
 * make it a check someone switches off. `warning_patterns` in
 * _validation_registry.json depend on the strings below; they are unchanged.
 *
 * What is fixed is only the other half. With BOTH inputs absent nothing was
 * measured at all, and the run still reported "reddit_health: degraded" - a value
 * for a thing it had not looked at, which is a fabricated measurement, not a
 * warning. That case is now a named hard stop that says so in those words.
 *
 *   measured and bad   -> warn, exit 0   (unchanged)
 *   not measured at all -> named stop, exit 1
 */
const fs = require('fs');

const STATUS_FILE = 'data/community/collection_status.json';
const REPORT_FILE = 'data/community/ingestion_report.json';

function readJson(file, fallback) { if (!fs.existsSync(file)) return fallback; return JSON.parse(fs.readFileSync(file, 'utf8')); }

// Presence is tracked separately from content. A zero read from a file that exists
// is a measurement; a zero read from a file that does not exist is not.
const statusPresent = fs.existsSync(STATUS_FILE);
const reportPresent = fs.existsSync(REPORT_FILE);

if (!statusPresent && !reportPresent) {
  console.error('[validate_ingestion_health] NOT MEASURED - ingestion health is UNKNOWN.');
  console.error(`- ${STATUS_FILE}: absent`);
  console.error(`- ${REPORT_FILE}: absent`);
  console.error('  No ingestion run has written a status file, so there is no signal to grade.');
  console.error('  This is not "degraded": degraded is a measurement, and nothing was measured.');
  console.error('  Run the ingestion collector so one of the files above exists, then re-run.');
  process.exit(1);
}

const status = readJson(STATUS_FILE, {});
const report = readJson(REPORT_FILE, {});
const retained = Number(status.retained_signal_count || report.retained_signal_count || report.total_signals || 0);
const fresh = Number(status.fresh_count || report.fresh_count || 0);
const redditSignals = Number(status.reddit_collected_count || report.reddit_collected_count || 0);
const warnings = [];
if (redditSignals === 0) {
  console.warn('⚠️ reddit_health: degraded');
  console.warn('⚠️ zero_reddit_warning: true');
}
if (status.zero_reddit_warning || report.zero_reddit_warning) warnings.push('reddit_health=degraded; zero_reddit_warning=true; Reddit yielded zero fresh signals.');
if (fresh === 0) warnings.push('fresh_count=0 for latest ingestion run.');
if (retained === 0) warnings.push('retained_signal_count=0; ingestion continuity fallback inventory is empty.');
if (!statusPresent) warnings.push(`${STATUS_FILE} absent; graded from ${REPORT_FILE} alone.`);
if (!reportPresent) warnings.push(`${REPORT_FILE} absent; graded from ${STATUS_FILE} alone.`);
if (warnings.length) {
  console.warn('[validate_ingestion_health] STRONG WARNING ONLY:');
  for (const warning of warnings) console.warn(`- ${warning}`);
  console.warn('[validate_ingestion_health] validate:all is not failed by ingestion health policy.');
} else {
  console.log('[validate_ingestion_health] ingestion health OK.');
}
process.exit(0);
