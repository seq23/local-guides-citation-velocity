const { buildRawSignal, fetchText, slugify } = require('../signal_utils');

function clean(value) {
  return String(value || '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractCaptions(html) {
  const matches = [];
  const re = /"text":"([^"]{20,200})"/g;
  let m;

  while ((m = re.exec(html)) && matches.length < 30) {
    const text = clean(m[1]);
    if (!/(horse|equine|barn|boarding|trainer|sale|lease|liability|contract)/i.test(text)) continue;
    matches.push(text);
  }

  return matches;
}

async function collect(source) {
  if (!source.base_url) return [];

  try {
    const html = await fetchText(source.base_url);
    const captions = extractCaptions(html);

    return captions.map((c, i) =>
      buildRawSignal(source, {
        title: c,
        source_url: source.base_url,
        short_excerpt: c,
        score: 0,
        comment_count: 0
      }, i)
    ).filter(Boolean);
  } catch (err) {
    console.warn(`[instagram_adapter] skipped ${source.source_key}: ${err.message}`);
    return [];
  }
}

module.exports = { collect };
