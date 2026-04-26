const { buildRawSignal, fetchText, slugify } = require('../signal_utils');

function clean(value) {
  return String(value || '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractTitles(html) {
  const matches = [];
  const re = /"title":{"runs":\[{"text":"([^"]+)"/g;
  let m;

  while ((m = re.exec(html)) && matches.length < 40) {
    const title = clean(m[1]);
    if (!title || title.length < 10) continue;
    if (!/(horse|equine|barn|boarding|trainer|sale|lease|liability|contract|insurance)/i.test(title)) continue;
    matches.push(title);
  }

  return matches;
}

async function collect(source) {
  const terms = Array.isArray(source.search_terms) ? source.search_terms.slice(0, 4) : [];
  const rows = [];
  const seen = new Set();

  for (const term of terms) {
    const url = `https://www.youtube.com/results?search_query=${encodeURIComponent(term)}`;

    try {
      const html = await fetchText(url);
      const titles = extractTitles(html);

      for (const title of titles) {
        const key = slugify(title);
        if (seen.has(key)) continue;
        seen.add(key);

        const signal = buildRawSignal(source, {
          title,
          source_url: url,
          short_excerpt: title,
          score: 0,
          comment_count: 0
        }, rows.length);

        if (signal) rows.push(signal);
      }
    } catch (err) {
      console.warn(`[youtube_adapter] failed for ${term}: ${err.message}`);
    }
  }

  return rows.slice(0, 40);
}

module.exports = { collect };
