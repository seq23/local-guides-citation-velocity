const { readJson, writeJson, slugify } = require('./signal_utils');
function verticalFor(text) {
  const v = String(text || '').toLowerCase();
  if (/dent|tooth|teeth|implant|root canal|orthodont/.test(v)) return 'dentistry';
  if (/adhd|autism|neuro|psych|assessment|evaluation/.test(v)) return 'neuro';
  if (/uscis|i-693|civil surgeon|immigration|green card/.test(v)) return 'uscis';
  if (/testosterone|trt|iv therapy|hair loss|peptide/.test(v)) return 'trt';
  return 'pi';
}
function run() {
  const normalized = readJson('data/community/normalized_signals.json', []);
  const rows = normalized.map((n, idx) => ({
    id: `live_signal_${String(idx).padStart(4, '0')}_${slugify(n.normalized_query || n.preserved_query || '').slice(0, 60)}`,
    vertical: verticalFor(n.normalized_query || n.preserved_query),
    query: n.preserved_query || n.normalized_query,
    normalized_query: n.normalized_query,
    llm_bait_phrase: n.llm_bait_phrase || n.normalized_query,
    source_signal_ids: n.source_signal_ids || [],
    signal_score: n.signal_score || 0,
    status: 'live_signal_collected'
  }));
  writeJson('content/_staged/live_signal_queries.json', rows);
  writeJson('data/community/publish_queue.json', rows.map((r) => ({ ...r, action: 'review_for_future_content_or_query_compiler' })));
  writeJson('data/community/approval_queue.json', []);
  console.log(`Mapped ${rows.length} normalized signals into content/_staged/live_signal_queries.json.`);
}
if (require.main === module) run();
module.exports = { run };
