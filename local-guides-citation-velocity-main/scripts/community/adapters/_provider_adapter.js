const { buildRawSignal, fetchJson, slugify } = require('../signal_utils');
async function collectFromProvider(source, envName) {
  const url = process.env[envName];
  if (!url) return [];
  try {
    const json = await fetchJson(url);
    const rows = Array.isArray(json) ? json : (json.items || json.results || json.imports || []);
    return rows.map((item, idx) => buildRawSignal(source, {
      title: item.title || item.question || item.thread_title || item.caption,
      source_url: item.source_url || item.url || item.link || source.base_url,
      short_excerpt: item.short_excerpt || item.snippet || item.description || item.title || item.question,
      score: item.score || 0,
      comment_count: item.comment_count || item.comments || item.reply_count || 0,
      captured_at: item.captured_at || item.created_at
    }, idx)).filter(Boolean);
  } catch (err) {
    console.warn(`[${slugify(source.platform)}_adapter] provider fetch failed for ${source.source_key}: ${err.message}`);
    return [];
  }
}
module.exports = { collectFromProvider };
