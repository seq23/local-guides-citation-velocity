const { readJson, writeJson, slugify } = require('./signal_utils');
const VERTICALS = new Set(['pi', 'dentistry', 'neuro', 'uscis', 'trt']);

// Every normalized signal already carries the vertical it was collected for.
// This function used to ignore that entirely and re-derive the vertical from
// four regexes over the raw question text, returning 'pi' whenever all four
// missed. That made personal_injury the classifier's error bucket rather than a
// vertical: a question about a testosterone cycle, an H-1B petition, a hair
// transplant or a root canal all fell through to 'pi', and a capacity-driven
// fallback then published them under /personal-injury/ with that vertical's
// legal sources and its accident-lead CTA attached.
//
// Prefer what the signal already knows. Use the text heuristics only as a hint
// when it knows nothing, and return null rather than guessing - an unclassified
// signal must not be published, which is what publishableVertical() enforces.
function verticalFor(signal) {
  const carried = String(
    (signal && (signal.vertical || signal.target_vertical)) || ''
  ).trim().toLowerCase();
  if (VERTICALS.has(carried)) return carried;

  const v = String(
    (signal && (signal.normalized_query || signal.preserved_query)) || signal || ''
  ).toLowerCase();
  if (/dent|tooth|teeth|implant|root canal|orthodont/.test(v)) return 'dentistry';
  if (/adhd|autism|neuro|psych|assessment|evaluation/.test(v)) return 'neuro';
  if (/uscis|i-693|civil surgeon|immigration|green card/.test(v)) return 'uscis';
  if (/testosterone|trt|iv therapy|hair loss|peptide/.test(v)) return 'trt';
  // Deliberately not 'pi'. A signal nothing can classify is unclassified.
  return null;
}
function run() {
  const normalized = readJson('data/community/normalized_signals.json', []);
  const rows = normalized.map((n, idx) => ({
    id: `live_signal_${String(idx).padStart(4, '0')}_${slugify(n.normalized_query || n.preserved_query || '').slice(0, 60)}`,
    vertical: verticalFor(n),
    query: n.preserved_query || n.normalized_query,
    normalized_query: n.normalized_query,
    llm_bait_phrase: n.llm_bait_phrase || n.normalized_query,
    source_signal_ids: n.source_signal_ids || [],
    signal_score: n.signal_score || 0,
    status: 'live_signal_collected'
  }));
  // An unclassified signal is held, never published. Publishing it would put it
  // under whichever vertical the downstream fallback happens to pick, which is
  // exactly how 183 off-topic pages ended up under /personal-injury/.
  const classified = rows.filter((r) => r.vertical);
  const unclassified = rows
    .filter((r) => !r.vertical)
    .map((r) => ({ ...r, status: 'held_unclassified', action: 'needs_vertical_before_publish' }));

  writeJson('content/_staged/live_signal_queries.json', classified);
  writeJson('data/community/publish_queue.json', classified.map((r) => ({ ...r, action: 'review_for_future_content_or_query_compiler' })));
  writeJson('data/community/unclassified_signals.json', unclassified);
  writeJson('data/community/approval_queue.json', []);
  console.log(
    `Mapped ${classified.length} classified signals into content/_staged/live_signal_queries.json; ` +
    `held ${unclassified.length} unclassified in data/community/unclassified_signals.json.`
  );
}
if (require.main === module) run();
module.exports = { run };
