const { buildRawSignal, fetchText, slugify } = require('../signal_utils');

function decode(value) {
  return String(value || '')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

function clean(value) {
  return decode(String(value || ''))
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function relevant(title) {
  return /(horse|equine|barn|boarding|trainer|sale|lease|liability|waiver|contract|lawsuit|demand|insurance|business|property|sponsor|trademark|therapy)/i.test(title);
}

function extractPageSignals(source, html) {
  const rows = [];
  const seen = new Set();

  const add = (title, url = source.base_url) => {
    const cleaned = clean(title);
    if (!cleaned || cleaned.length < 12 || cleaned.length > 220) return;
    if (!relevant(cleaned)) return;

    const key = `${slugify(cleaned)}|${url}`;
    if (seen.has(key)) return;
    seen.add(key);

    const signal = buildRawSignal(source, {
      title: cleaned,
      source_url: url,
      short_excerpt: cleaned,
      score: 0,
      comment_count: 0
    }, rows.length);

    if (signal) rows.push(signal);
  };

  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (titleMatch) add(titleMatch[1]);

  const hPattern = /<h[1-3][^>]*>([\s\S]*?)<\/h[1-3]>/gi;
  let hMatch;
  while ((hMatch = hPattern.exec(html)) && rows.length < 40) {
    add(hMatch[1]);
  }

  const linkPattern = /<a\s+[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let lMatch;
  while ((lMatch = linkPattern.exec(html)) && rows.length < 40) {
    const href = lMatch[1];
    let url = source.base_url;
    try {
      url = new URL(href, source.base_url).toString();
    } catch {
      url = source.base_url;
    }
    add(lMatch[2], url);
  }

  return rows.slice(0, 40);
}

async function collect(source) {
  if (!source.base_url) return [];

  try {
    const html = await fetchText(source.base_url);
    return extractPageSignals(source, html);
  } catch (err) {
    console.warn(`[serp_competitor_adapter] failed for ${source.source_key}: ${err.message}`);
    return [];
  }
}

module.exports = { collect };
