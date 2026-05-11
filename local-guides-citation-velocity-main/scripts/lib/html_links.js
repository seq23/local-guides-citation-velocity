'use strict';

function decodeHtmlEntities(value) {
  return value
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

function extractHrefTargets(html) {
  const hrefs = [];
  const re = /<a\b[^>]*\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))[^>]*>/gi;
  let match;
  while ((match = re.exec(html)) !== null) {
    const raw = match[1] || match[2] || match[3] || '';
    hrefs.push(decodeHtmlEntities(raw.trim()));
  }
  return hrefs;
}

function normalizePath(href) {
  if (!href) return '';
  let out = href.trim();
  const hashIndex = out.indexOf('#');
  if (hashIndex >= 0) out = out.slice(0, hashIndex);
  const queryIndex = out.indexOf('?');
  if (queryIndex >= 0) out = out.slice(0, queryIndex);
  if (!out) return '';
  if (/^https?:\/\//i.test(out)) {
    try {
      const url = new URL(out);
      out = url.pathname;
    } catch (_) {
      return out;
    }
  }
  return out;
}

function hasHrefPath(html, expectedPath) {
  const normalizedExpected = normalizePath(expectedPath);
  return extractHrefTargets(html).some((href) => normalizePath(href) === normalizedExpected);
}

module.exports = {
  extractHrefTargets,
  normalizePath,
  hasHrefPath,
};
