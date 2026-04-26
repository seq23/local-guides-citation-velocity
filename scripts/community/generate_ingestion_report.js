const { readJson, writeJson } = require('./signal_utils');
function countBy(rows, key) { return rows.reduce((a, r) => { const k = r[key] || 'unknown'; a[k] = (a[k] || 0) + 1; return a; }, {}); }
function run() {
  const raw = readJson('data/community/raw_signals.json', []);
  const norm = readJson('data/community/normalized_signals.json', []);
  const live = readJson('content/_staged/live_signal_queries.json', []);
  const status = readJson('data/community/collection_status.json', {});
  const health = readJson('data/community/source_health_log.json', { entries: [] });
  const zeroRedditWarning = Boolean(status.zero_reddit_warning);
  const redditHealth = status.reddit_health || (zeroRedditWarning ? 'degraded' : 'unknown');
  const warnings = [];
  if (zeroRedditWarning) warnings.push('reddit_health=degraded; zero_reddit_warning=true; Reddit produced zero fresh signals. validate:all remains warning-only by policy.');
  if (Number(status.fresh_count || 0) === 0 && Number(status.retained_signal_count || raw.length || 0) > 0) warnings.push('No fresh signals collected; retained signal store is available for continuity.');
  if (Number(status.retained_signal_count || raw.length || 0) === 0) warnings.push('No retained signal inventory exists. Manual import fallback should be populated before relying on ingestion outputs.');
  const report = {
    generated_at: new Date().toISOString(),
    total_signals: raw.length,
    fresh_count: Number(status.fresh_count || 0),
    retained_signal_count: Number(status.retained_signal_count || raw.length || 0),
    normalized_count: norm.length,
    live_query_count: live.length,
    reddit_health: redditHealth,
    zero_reddit_warning: zeroRedditWarning,
    manual_import_count: Number(status.manual_import_count || 0),
    warnings,
    signals_by_source: countBy(raw, 'source_key'),
    signals_by_platform: countBy(raw, 'platform'),
    live_queries_by_vertical: countBy(live, 'vertical'),
    collection_status: status.adapter_status || [],
    recent_source_health: (health.entries || []).slice(-20)
  };
  writeJson('data/community/ingestion_report.json', report);
  if (warnings.length) console.warn(`[ingestion_report] WARNINGS: ${warnings.join(' | ')}`);
  console.log(JSON.stringify(report, null, 2));
}
if (require.main === module) run();
module.exports = { run };
