'use strict';

// Session recording belongs at the step where a visitor submits or buys.
// Ignore inert markup so an example form in a comment cannot enable recording.
function conversionPage(html) {
  const markup = String(html).replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<(script|style|template)\b[^>]*>[\s\S]*?<\/\1>/gi, '');
  if (/<form\b[^>]*>/i.test(markup)) return true;
  for (const m of markup.matchAll(/<a\b[^>]*\s+href\s*=\s*(["'])([\s\S]*?)\1/gi)) {
    let url;
    try { url = new URL(m[2].replace(/&amp;/g, '&'), 'https://theindustryguides.com'); } catch { continue; }
    if (!/^https?:$/.test(url.protocol)) continue;
    if (/(^|\.)(gumroad\.com|buy\.stripe\.com|checkout\.stripe\.com)$/.test(url.hostname)
      || /\/(checkout|cart|buy)(\/|$)/i.test(url.pathname)) return true;
  }
  return false;
}

function installClarity(html, snippet) {
  // Remove tags installed on earlier builds as well as the legacy inline tag.
  const cleaned = html.replace(/<script\b(?=[^>]*(?:\bdata-clarity-loader\b|(?:clarity-loader\.js|clarity\.ms\/tag\/)))[^>]*>[\s\S]*?<\/script>/gi, '');
  if (!conversionPage(cleaned)) return cleaned;
  return cleaned.replace(/<\/head>/i, () => `${snippet}</head>`);
}

function selfTest() {
  const tag = '<script data-clarity-loader src="/assets/clarity-loader.js" defer></script>';
  const page = (body) => `<html><head>${tag}</head><body>${body}</body></html>`;
  const cases = [
    ['editorial page', '<p>Guide</p>', false],
    ['form', '<form action="/submit"><input name="name"></form>', true],
    ['Gumroad purchase', '<a href="https://example.gumroad.com/l/guide">Buy</a>', true],
    ['Stripe purchase', '<a href="https://buy.stripe.com/example">Buy</a>', true],
    ['local checkout', '<a href="/checkout/">Checkout</a>', true],
    ['provider intake referral', '<a href="https://dentistryguides.com/request-assistance/">Ask</a>', false],
    ['commented form', '<!-- <form></form> -->', false],
    ['inert form', '<template><form></form></template>', false],
    ['script text', '<script>var example="<form>";</script>', false],
    ['purchase domain in prose', '<p>gumroad.com</p>', false],
    ['inert purchase attribute', '<a data-href="https://buy.stripe.com/example">Preview</a>', false],
  ];
  const errors = [];
  for (const [name, body, expected] of cases) {
    const result = installClarity(page(body), tag);
    if (result.includes(tag) !== expected) errors.push(name);
    if (installClarity(result, tag) !== result) errors.push(`${name}: not idempotent`);
  }
  return { cases: cases.length, errors };
}

module.exports = { conversionPage, installClarity, selfTest };
