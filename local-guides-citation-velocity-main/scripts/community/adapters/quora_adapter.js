const { buildRawSignal, fetchText, slugify } = require('../signal_utils');

function clean(value) {
  return String(value || '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractQuestions(html) {
  const matches = [];
  const re = />\s*([^<>]{20,160}\?)\s*</g;
  let m;

  while ((m = re.exec(html)) && matches.length < 40) {
    const q = clean(m[1]);
    if (!/(horse|equine|barn|boarding|trainer|sale|lease|liability|contract|lawsuit)/i.test(q)) continue;
    matches.push(q);
  }

  return matches;
}

async function collect(source) {
  if (!source.base_url) return [];

  try {
    const html = await fetchText(source.base_url);
    const questions = extractQuestions(html);

    return questions.map((q, i) =>
      buildRawSignal(source, {
        title: q,
        source_url: source.base_url,
        short_excerpt: q,
        score: 0,
        comment_count: 0
      }, i)
    ).filter(Boolean);
  } catch (err) {
    console.warn(`[quora_adapter] skipped ${source.source_key}: ${err.message}`);
    return [];
  }
}

module.exports = { collect };
