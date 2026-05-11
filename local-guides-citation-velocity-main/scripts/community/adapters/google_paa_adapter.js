const { buildRawSignal, fetchJson } = require('../signal_utils');
const DEFAULT_TERMS = ['horse sale contract legal questions', 'horse lease agreement legal questions', 'horse boarding liability questions'];
async function collect(source) {
  if (process.env.COLLECT_LIVE_SIGNALS !== "1") return [];
  const key = process.env.SERPAPI_API_KEY;
  if (!key) return [];
  const terms = (source.search_terms || DEFAULT_TERMS).slice(0, Number(process.env.SIGNAL_TERMS_PER_SOURCE || 2));
  const signals = [];
  for (const term of terms) {
    const url = `https://serpapi.com/search.json?engine=google&q=${encodeURIComponent(term)}&api_key=${encodeURIComponent(key)}`;
    try {
      const json = await fetchJson(url);
      const related = json.related_questions || json.people_also_ask || [];
      for (const item of related) {
        const question = item.question || item.title;
        if (!question) continue;
        const signal = buildRawSignal(source, {
          title: question,
          source_url: item.link || source.base_url,
          short_excerpt: item.snippet || question
        }, signals.length);
        if (signal) signals.push(signal);
      }
    } catch (err) {
      console.warn(`[google_paa_adapter] ${source.source_key} query failed: ${term} (${err.message})`);
    }
  }
  return signals;
}
module.exports = { collect };
