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
  // Cloudflare Pages serves `foo.html` at `/foo` and 308-redirects the `.html`
  // form, so the two spellings address one resource. Internal links now use the
  // extensionless form (the one that returns 200) while routes and rendered
  // filenames keep `.html`; without this, every link check comparing a route to
  // a rendered anchor would report a missing link that is plainly present.
  if (out.length > 5 && out.endsWith('.html')) out = out.slice(0, -5);
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
