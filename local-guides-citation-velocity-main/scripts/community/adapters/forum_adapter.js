const { buildRawSignal, fetchText, slugify } = require('../signal_utils');

function clean(value) {
  return String(value || '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Extract forum-style thread titles from HTML
 */
function extractThreads(html) {
  const rows = [];
  const seen = new Set();

  // Common patterns across XenForo, vBulletin, phpBB, etc.
  const patterns = [
    /<a[^>]+class="[^"]*(?:title|thread)[^"]*"[^>]*>([\s\S]*?)<\/a>/gi,
    /<h\d[^>]*>([\s\S]*?)<\/h\d>/gi,
    /<a[^>]+href="[^"]*thread[^"]*"[^>]*>([\s\S]*?)<\/a>/gi
  ];

  for (const pattern of patterns) {
    let match;

    while ((match = pattern.exec(html)) && rows.length < 80) {
      const raw = clean(match[1]);

      if (!raw || raw.length < 12) continue;

      // Filter to relevant legal / horse topics
      if (
        !/(horse|equine|barn|boarding|trainer|sale|lease|liability|contract|waiver|lawsuit|insurance|business)/i.test(
          raw
        )
      ) continue;

      const key = slugify(raw);
      if (seen.has(key)) continue;
      seen.add(key);

      rows.push(raw);
    }
  }

  return rows.slice(0, 40);
}

/**
 * Main collector
 */
async function collect(source) {
  if (!source.base_url) return [];

  try {
    const html = await fetchText(source.base_url);

    const titles = extractThreads(html);

    const signals = titles.map((title, idx) =>
      buildRawSignal(
        source,
        {
          title,
          source_url: source.base_url,
          short_excerpt: title,
          score: 0,
          comment_count: 0
        },
        idx
      )
    );

    return signals.filter(Boolean);
  } catch (err) {
    console.warn(
      `[forum_adapter] failed for ${source.source_key}: ${err.message}`
    );
    return [];
  }
}

module.exports = { collect };
