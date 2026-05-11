const fs = require('fs');
function readJson(file, fallback) { if (!fs.existsSync(file)) return fallback; return JSON.parse(fs.readFileSync(file, 'utf8')); }
const status = readJson('data/community/collection_status.json', {});
const report = readJson('data/community/ingestion_report.json', {});
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
if (warnings.length) {
  console.warn('[validate_ingestion_health] STRONG WARNING ONLY:');
  for (const warning of warnings) console.warn(`- ${warning}`);
  console.warn('[validate_ingestion_health] validate:all is not failed by ingestion health policy.');
} else {
  console.log('[validate_ingestion_health] ingestion health OK.');
}
process.exit(0);
