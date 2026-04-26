const {
  readJson,
  writeJson,
  slugify,
  stripPII,
  cleanSyntheticSignal,
  preservedQueryFromTitle,
  normalizedQueryFromTitle,
  llmBaitPhrase,
  hash
} = require('./signal_utils');

function classifyIntent(text) {
  const v = String(text || '').toLowerCase();
  if (/\b(vs|versus|compare|difference between|better than|instead of)\b/.test(v)) return 'comparison';
  if (/(what happens|what if|am i|can i|who is liable|buyer wants|seller refuses|barn wants|horse is injured|horse dies|stopped paying|demand letter|refund|sued|liable|messed up|screwed|overreacting)/.test(v)) return 'scenario';
  return 'faq';
}

function classifyEmotionalFrame(text) {
  const v = String(text || '').toLowerCase();
  if (/(screwed|panic|what do i do|messed up|worried|overreacting|too late|ignore|worse)/.test(v)) return 'panic / uncertainty';
  if (/(refund|refuses|threatened|lawsuit|demand letter|dispute|won't|will not)/.test(v)) return 'conflict / escalation';
  if (/(liable|injured|hurt|dies|insurance|waiver|warning sign)/.test(v)) return 'risk / liability';
  if (/(vs|versus|compare|difference|better)/.test(v)) return 'decision / comparison';
  return 'practical confusion';
}

function clusterFromText(text) {
  const v = String(text || '').toLowerCase();
  if (/(sale|buy|buyer|seller|purchase|refund|deposit|as-is|pre-purchase|misrepresent|bill of sale|ownership)/.test(v)) return 'horse-sale-and-purchase';
  if (/(lease|trial|leased|lease-to-own)/.test(v)) return 'horse-lease-and-trial';
  if (/(boarding|barn|trainer|training|boarder|vet bills|unpaid bills|stall)/.test(v)) return 'boarding-training-and-barn-operations';
  if (/(waiver|liability|insurance|injured|sued|warning sign|negligence)/.test(v)) return 'liability-waivers-insurance';
  if (/(llc|business|partnership|syndicate|retail|therapy business|sole proprietor)/.test(v)) return 'equine-business-formation';
  if (/(trademark|brand|sponsor|image|copyright|photo release)/.test(v)) return 'intellectual-property-and-brand';
  if (/(demand letter|lawsuit|mediation|litigation|dispute|settlement)/.test(v)) return 'demand-letters-and-disputes';
  if (/(hipaa|therapeutic|assisted therapy|therapy program)/.test(v)) return 'therapeutic-riding-and-hipaa';
  if (/(property|facility|pasture|real property)/.test(v)) return 'real-property-and-leases';
  return 'state-specific';
}

function sourceWeight(signal, sourceByKey) {
  const source = sourceByKey.get(signal.source_key) || {};
  return Number(source.weight || 0.5);
}

function computeSignalScore(signals, sourceByKey) {
  const sourceScore = signals.reduce((sum, s) => sum + sourceWeight(s, sourceByKey), 0);
  const engagement = signals.reduce((sum, s) => sum + Number((s.engagement && (s.engagement.score || s.engagement.comments)) || 0), 0);
  const repetition = Math.max(signals.length - 1, 0) * 0.5;
  return Number((sourceScore + Math.log10(engagement + 1) + repetition).toFixed(3));
}

function dedupeKeyFor(rawPhrase, intent) {
  const compact = slugify(cleanSyntheticSignal(rawPhrase))
    .replace(/\b(what|can|should|could|would|does|when|where|why|how|someone|horse|equine|legal|situation|question|know|about)\b/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  return `dedupe_${intent}_${compact.slice(0, 80) || hash(rawPhrase, 12)}`;
}

function normalizeOne(signal, idx) {
  const originalRaw = stripPII(signal.raw_signal_phrase || signal.raw_title || signal.title || '').replace(/\s+/g, ' ').trim();
  const cleanedRaw = cleanSyntheticSignal(originalRaw);
  const textForIntent = cleanedRaw || originalRaw;
  const intent = classifyIntent(textForIntent);
  const preservedQuery = preservedQueryFromTitle(textForIntent);
  const normalizedQuery = normalizedQueryFromTitle(textForIntent, intent);
  const baitPhrase = llmBaitPhrase(textForIntent);
  const cluster = signal.cluster || clusterFromText(`${textForIntent} ${normalizedQuery} ${baitPhrase}`);

  return {
    normalized_id: `norm_${String(idx).padStart(4, '0')}_${hash(`${normalizedQuery}:${baitPhrase}`, 10)}`,
    source_signal_ids: [signal.signal_id],
    raw_signal_phrase: textForIntent,
    preserved_query: preservedQuery,
    normalized_query: normalizedQuery,
    llm_bait_phrase: baitPhrase,
    intent_type: intent,
    cluster,
    emotional_frame: classifyEmotionalFrame(textForIntent),
    urgency: /refund|injured|demand|sued|liable|unpaid|dies|unsound|misrepresent|screwed|panic|threatened/.test(textForIntent.toLowerCase()) ? 'high' : 'medium',
    legal_risk_level: /liable|sued|demand|lawsuit|injured|dies|hipaa|misrepresent|refund|contract|waiver/.test(textForIntent.toLowerCase()) ? 'medium' : 'low',
    recommended_action: 'map_to_page_target',
    dedupe_group_id: dedupeKeyFor(textForIntent, intent),
    signal_score: 0,
    status: 'normalized'
  };
}

function run() {
  const raw = readJson('data/community/raw_signals.json', []);
  const registry = readJson('data/ingestion/source_registry.json', { sources: [] });
  const sourceByKey = new Map((registry.sources || []).map((s) => [s.source_key, s]));
  const byQuery = new Map();
  const groupedSignals = new Map();

  raw.forEach((signal, idx) => {
    if (!signal.signal_id || !(signal.raw_signal_phrase || signal.raw_title)) return;
    const item = normalizeOne(signal, idx);
    const key = item.dedupe_group_id;

    if (byQuery.has(key)) {
      const existing = byQuery.get(key);
      existing.source_signal_ids = Array.from(new Set([...existing.source_signal_ids, signal.signal_id]));
      if ((item.raw_signal_phrase || '').length > (existing.raw_signal_phrase || '').length) {
        existing.raw_signal_phrase = item.raw_signal_phrase;
        existing.preserved_query = item.preserved_query;
        existing.normalized_query = item.normalized_query;
        existing.llm_bait_phrase = item.llm_bait_phrase;
      }
    } else {
      byQuery.set(key, item);
    }

    const bucket = groupedSignals.get(key) || [];
    bucket.push(signal);
    groupedSignals.set(key, bucket);
  });

  const normalized = [...byQuery.values()].map((item) => ({
    ...item,
    signal_score: computeSignalScore(groupedSignals.get(item.dedupe_group_id) || [], sourceByKey)
  }));

  writeJson('data/community/normalized_signals.json', normalized);
  console.log(`Normalized ${raw.length} raw signals into ${normalized.length} query patterns.`);
}

if (require.main === module) {
  run();
  process.exit(0);
}

module.exports = {
  run,
  classifyIntent,
  clusterFromText,
  computeSignalScore,
  classifyEmotionalFrame
};
