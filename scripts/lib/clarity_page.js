'use strict';

// Session recording belongs at the step where a visitor submits or buys.
// Ignore inert markup so an example form in a comment cannot enable recording.
//
// The home page is the one exception and carries the tag unconditionally. It is
// the entry point every other page is reached through, and Search Readiness e6
// and i8 both read it directly ("the homepage ... loads Clarity"): scoping the
// tag to conversion markup alone stripped it from the home page on 28 Oct 2026
// and both items went red the same morning. Its conversion step is a link out
// to a provider intake on another host, which conversionPage() deliberately
// does not count, so no markup rule can recover it - the caller marks it.
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

function installClarity(html, snippet, opts = {}) {
  // Remove tags installed on earlier builds as well as the legacy inline tag.
  const cleaned = html.replace(/<script\b(?=[^>]*(?:\bdata-clarity-loader\b|(?:clarity-loader\.js|clarity\.ms\/tag\/)))[^>]*>[\s\S]*?<\/script>/gi, '');
  if (!opts.always && !conversionPage(cleaned)) return cleaned;
  if (!/<\/head>/i.test(cleaned)) return cleaned;
  return cleaned.replace(/<\/head>/i, () => `${snippet}</head>`);
}

// The published home page, relative to the output root. install_clarity.js asks
// this rather than carrying its own copy of the path, so the installer and the
// validator that checks the served page cannot disagree about which file it is.
const HOME_PAGE = 'index.html';
function isHomePage(rel) {
  return String(rel).replace(/^\.\//, '') === HOME_PAGE;
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
  // The home page keeps the tag on exactly the markup that loses it elsewhere.
  const homeCases = [
    ['home page, editorial markup', '<p>Guide</p>'],
    ['home page, provider referral only', '<a href="https://dentistryguides.com/request-assistance/">Ask</a>'],
  ];
  const errors = [];
  for (const [name, body, expected] of cases) {
    const result = installClarity(page(body), tag);
    if (result.includes(tag) !== expected) errors.push(name);
    if (installClarity(result, tag) !== result) errors.push(`${name}: not idempotent`);
  }
  for (const [name, body] of homeCases) {
    // Unmarked it is dropped; as the home page it is kept. Both directions,
    // so the exception cannot pass by the predicate having gone permissive.
    if (installClarity(page(body), tag).includes(tag)) errors.push(`${name}: kept without always`);
    const result = installClarity(page(body), tag, { always: true });
    if (!result.includes(tag)) errors.push(`${name}: not installed`);
    if (installClarity(result, tag, { always: true }) !== result) errors.push(`${name}: not idempotent`);
    // Exactly one tag, never a second copy stacked on a rebuild.
    if (result.split(tag).length - 1 !== 1) errors.push(`${name}: duplicated`);
  }
  if (!isHomePage('index.html') || isHomePage('insights/index.html')) errors.push('isHomePage');
  // A page with no </head> is left alone rather than silently skipped-as-clean.
  if (installClarity('<html><body>x</body></html>', tag, { always: true }).includes(tag)) {
    errors.push('headless page: tag installed with no head');
  }
  return { cases: cases.length + homeCases.length, errors };
}

module.exports = { conversionPage, installClarity, isHomePage, HOME_PAGE, selfTest };
