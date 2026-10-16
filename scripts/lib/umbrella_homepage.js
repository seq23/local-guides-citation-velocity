'use strict';
/**
 * The theindustryguides.com homepage (owner-approved layout, 14 Oct 2026).
 *
 * Order, top to bottom: umbrella header -> hero (one H1 + one short subline)
 * -> the six canonical vertical cards -> "How every guide site works" ->
 * "Questions about The Industry Guides" -> "About The Industry Guides" (the
 * AEO definition paragraph, read by validate_site_hygiene.js) -> umbrella footer. The visual
 * system is the one the six canonical sites share: white ground, IBM Plex Sans,
 * a 1120px container, 1px #DCE2EA cards with a 12px radius, ink #14213D,
 * accent #0A5C66.
 *
 * The three question links on each card are read from the canonical's own guide
 * inventory (data/contracts/canonical_guides/<vertical>.json: fetched from the
 * live /guides/ hub, http_status per guide). Only the PATH is chosen here; the
 * title and origin come from the inventory, and the build fails before writing
 * if a chosen path is missing from it or did not return 200. Nothing is invented.
 *
 * Guarded by scripts/validators/validate_umbrella_homepage_shape.js.
 */
const { loadInventories } = require('./canonical_guide_links');

// Per-vertical URLs are the ones the homepage already used (Velocity hub path
// and the canonical's /request-assistance/); the scope line is the existing copy.
const VERTICAL_CARDS = [
  { id: 'uscis-card', vertical: 'uscis-medical', title: 'USCIS medical exam', bar: '#0A5C66', hub: '/uscis-medical/', find: 'Find a civil surgeon',
    scope: 'I-693 rules, civil-surgeon state guides, vaccines, corrections, and scheduling.',
    questions: ['/guides/uscis-medical-exam-cost/', '/guides/document-checklist/', '/guides/questions-to-ask-a-civil-surgeon/'] },
  { id: 'personal-injury-card', vertical: 'personal-injury', title: 'Personal injury', bar: '#B45309', hub: '/personal-injury/', find: 'Find an attorney',
    scope: 'State deadlines, negligence rules, claims, evidence, fees, and decision guides.',
    questions: ['/guides/personal-injury-fees-explained/', '/guides/recorded-statements-and-insurance-calls/', '/guides/evidence-checklist-after-an-accident/'] },
  { id: 'dentistry-card', vertical: 'dentistry', title: 'Dentistry', bar: '#1D4ED8', hub: '/dentistry/', find: 'Find a dentist',
    scope: 'Insurance, Medicaid, costs, treatment comparisons, urgency, and provider questions.',
    questions: ['/guides/dental-insurance-coverage-explained/', '/guides/dental-implant-and-oral-surgery-cost/', '/guides/dental-second-opinion/'] },
  { id: 'neuro-card', vertical: 'neuro', title: 'ADHD, autism and neuropsych testing', bar: '#6D28D9', hub: '/neuro/', find: 'Find an evaluator',
    scope: 'Evaluation types, referrals, costs, reports, school/work use, and state access.',
    questions: ['/guides/adhd-evaluations-what-to-expect/', '/guides/autism-evaluation-adults/', '/guides/hospital-vs-private-neuropsych-testing/'] },
  { id: 'trt-card', vertical: 'trt', title: 'Hormones, IV therapy and hair restoration', bar: '#A16207', hub: '/trt/', find: 'Find a clinic',
    scope: 'TRT rules, telehealth, monitoring, fertility, hair loss, and treatment comparisons.',
    questions: ['/guides/does-insurance-cover-testosterone-therapy/', '/guides/is-iv-hydration-worth-it/', '/guides/does-prp-work-for-hair-loss/'] },
  { id: 'senior-living-card', vertical: 'senior-living', title: 'Senior living', badge: 'Memphis area', bar: '#047857', hub: '/senior-living/', find: 'Find a community',
    scope: 'Assisted living vs memory care, Tennessee and Mississippi licensing, TennCare CHOICES, VA benefits, and hospital discharge.',
    questions: ['/guides/assisted-living-cost-memphis/', '/guides/memory-care-when-is-it-time/', '/guides/hospital-discharge-to-assisted-living-memphis/'] },
];

// The one line under the H1 (owner-approved layout, 14 Oct 2026).
const HERO_SUBLINE = 'Pick your situation. Each guide answers the first questions, shows the costs and timeline, then connects you to a licensed provider in your state if you want one.';

const HOW_STEPS = [
  { n: '1', label: 'Answer', title: 'The first questions, answered first', body: 'Cost, timing, who is qualified and what to bring, with the source records shown on the page.' },
  { n: '2', label: 'Compare', title: 'State rules and the questions to ask', body: 'Deadlines, licensing and published fees where they exist, and what to ask any provider before you book.' },
  { n: '3', label: 'Connect', title: 'A provider, when you are ready', body: 'Each guide site has one short request form that routes you to a provider for your situation.' },
];

/** Resolve each card's question paths against the canonical inventories; throws before any write. */
function resolveCards(root) {
  const inventories = loadInventories(root);
  if (VERTICAL_CARDS.length !== inventories.size) throw new Error(`umbrella homepage: ${VERTICAL_CARDS.length} cards for ${inventories.size} canonical inventories`);
  return VERTICAL_CARDS.map((card) => {
    const inv = inventories.get(card.vertical);
    if (!inv) throw new Error(`umbrella homepage: no canonical guide inventory for ${card.vertical}`);
    if (card.questions.length !== 3) throw new Error(`umbrella homepage: ${card.vertical} needs exactly three question links`);
    const questions = card.questions.map((p) => {
      const guide = inv.guides.find((g) => g.path === p);
      if (!guide) throw new Error(`umbrella homepage: ${card.vertical} question ${p} is not in data/contracts/canonical_guides/${card.vertical}.json`);
      if (Number(guide.http_status) !== 200) throw new Error(`umbrella homepage: ${card.vertical} question ${p} fetched ${guide.http_status}, not 200`);
      return { href: `${inv.origin}${p}`, title: guide.title };
    });
    const host = new URL(inv.origin).host;
    return { ...card, origin: inv.origin, host, root: `${inv.origin}/`, provider: `${inv.origin}/request-assistance/`, questions };
  });
}

function renderBody({ esc, definition, faq, root }) {
  const cards = resolveCards(root).map((c) => `<article class="uh-card" id="${c.id}" data-home-vertical="${c.vertical}" style="--bar:${c.bar}">
        <div class="uh-card-head"><h2>${esc(c.title)}</h2>${c.badge ? `<span class="uh-badge">${esc(c.badge)}</span>` : ''}</div>
        <p class="uh-domain">${esc(c.host)}</p>
        <p class="uh-scope">${esc(c.scope)}</p>
        <ul class="uh-qs" data-home-questions="true">${c.questions.map((q) => `<li><a href="${q.href}">${esc(q.title)}</a></li>`).join('')}</ul>
        <div class="uh-actions"><a class="uh-btn primary" href="${c.provider}">${esc(c.find)}</a><a class="uh-btn secondary" href="${c.root}">Open the guide site</a></div>
        <a class="uh-hub" href="${c.hub}">${esc(c.title)} guides on this site</a>
      </article>`).join('\n      ');
  return `
  <section class="uh-hero" data-umbrella-home="true">
    <div class="uh-wrap">
      <h1>Plain answers for six decisions people make under pressure.</h1>
      <p class="uh-deck" data-hero-subline="true">${esc(HERO_SUBLINE)}</p>
    </div>
  </section>
  <section id="vertical-routes" class="uh-verticals" data-canon-block="top" data-home-verticals="true" aria-label="The six guide sites">
    <div class="uh-wrap"><div class="uh-grid">
      ${cards}
    </div></div>
  </section>
  <section id="how" class="uh-how">
    <div class="uh-wrap">
      <h2>How every guide site works</h2>
      <div class="uh-steps">${HOW_STEPS.map((s) => `<div class="uh-step"><span class="uh-step-label">${s.n} · ${esc(s.label)}</span><h3>${esc(s.title)}</h3><p>${esc(s.body)}</p></div>`).join('')}</div>
    </div>
  </section>
  <section id="questions" class="uh-questions" data-home-faq="true">
    <div class="uh-wrap">
      <h2>Questions about The Industry Guides</h2>
      <dl class="uh-faq">${faq.map((f) => `<div><dt>${esc(f.q)}</dt><dd>${esc(f.a)}</dd></div>`).join('')}</dl>
    </div>
  </section>
  <section id="about" class="uh-about" data-home-about="true">
    <div class="uh-wrap">
      <h2>About The Industry Guides</h2>
      <p class="uh-definition site-definition" data-site-definition="true">${definition}</p>
    </div>
  </section>`;
}

const HEADER = `<header class="site-header uh-header">
    <div class="uh-wrap uh-header-row">
      <a href="/" class="uh-brand"><span class="uh-word">The Industry Guides</span><span class="uh-sub">Source-backed guides. Find a provider when you are ready.</span></a>
      <nav class="uh-nav" aria-label="Primary">
        <a href="#vertical-routes">Guides</a>
        <a href="#questions">Questions</a>
        <a href="#how">How we work</a>
        <a class="uh-nav-cta" href="#vertical-routes">Find a provider</a>
      </nav>
    </div>
  </header>`;

// The contact link is wrapped in Cloudflare's `<!--email_off-->` opt-out markers.
// WITHOUT THEM Cloudflare Email Address Obfuscation rewrites the mailto into
// `/cdn-cgi/l/email-protection#<hex>`, which is a real link to a route that 404s for
// anything that does not run its JavaScript: every crawler, Ahrefs Site Audit included.
// Danielle's 16 Oct 2026 crawl of theindustryguides.com found exactly that on the
// homepage (the site's only mailto). The markers tell Cloudflare to leave the address
// alone, so the link stays a plain mailto for readers and crawlers alike.
// validate_umbrella_homepage_shape.js fails if a mailto on this page loses them.
const footer = (year) => `<footer class="site-footer uh-footer">
    <div class="uh-wrap uh-footer-row">
      <span>© ${year} The Industry Guides</span>
      <a href="/insights/">Insights</a>
      <a href="/atlas/">Atlas</a>
      <a href="/methodology">Methodology</a>
      <a href="/tools/">Tools</a>
      <a href="/glossary/">Glossary</a>
      <a href="/medium/">Articles</a>
      <a href="/about">For providers</a>
      <a href="/disclaimer">Disclaimer</a>
      <a href="/privacy">Privacy</a>
      <!--email_off--><a href="mailto:hello@theindustryguides.com">Contact: hello@theindustryguides.com</a><!--/email_off-->
    </div>
    <p class="uh-wrap uh-byline muted small editorial-byline" data-editorial-byline="true">Published by <a href="/about">The Industry Guides Editorial Team</a>.</p>
  </footer>`;

const STYLE = `<style data-umbrella-home-style="true">
.umbrella-home{font-family:'IBM Plex Sans',system-ui,-apple-system,'Segoe UI',sans-serif;color:#14213D;background:#FFFFFF}
.umbrella-home a{color:#0A5C66}.umbrella-home a:hover{color:#073F46}
.umbrella-home h1,.umbrella-home h2,.umbrella-home h3{font-family:inherit;color:#14213D}
.umbrella-home main.container{max-width:none;margin:0;padding:0}
.uh-wrap{max-width:1120px;margin:0 auto;padding-left:24px;padding-right:24px;box-sizing:border-box}
.umbrella-home .site-header{position:static;background:#FFFFFF;border-bottom:1px solid #E3E7EE;backdrop-filter:none}
.uh-header-row{display:flex;flex-wrap:wrap;align-items:center;gap:16px 28px;padding-top:14px;padding-bottom:14px}
.uh-brand{text-decoration:none;display:flex;flex-direction:column;gap:2px}.uh-brand:hover{text-decoration:none}
.uh-word{font-size:20px;font-weight:700;letter-spacing:-.01em;color:#14213D}
.uh-sub{font-size:12px;color:#4B5563}
.uh-nav{display:flex;flex-wrap:wrap;gap:4px 22px;margin-left:auto;align-items:center;font-size:15px;font-weight:500}
.umbrella-home .uh-nav a{color:#14213D;text-decoration:none;padding:10px 0}
.umbrella-home .uh-nav a.uh-nav-cta{color:#FFFFFF;background:#0A5C66;padding:11px 18px;border-radius:8px;font-weight:600}
.uh-hero{background:#F4F7F9;border-bottom:1px solid #E3E7EE}
.uh-hero .uh-wrap{padding-top:44px;padding-bottom:36px;display:flex;flex-direction:column;gap:14px}
.uh-hero h1{margin:0;font-size:40px;line-height:1.12;font-weight:700;letter-spacing:-.02em;max-width:820px}
.uh-deck{margin:0;font-size:18px;line-height:1.5;color:#374151;max-width:760px}
.umbrella-home section.uh-verticals{border:0;border-radius:0;background:#FFFFFF;box-shadow:none;margin:0;padding:0}
.uh-verticals .uh-wrap{padding-top:40px;padding-bottom:24px}
.uh-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:20px}
.uh-card{border:1px solid #DCE2EA;border-top:5px solid var(--bar,#0A5C66);border-radius:12px;padding:22px;display:flex;flex-direction:column;gap:12px;background:#FFFFFF;min-width:0}
.uh-card-head{display:flex;flex-wrap:wrap;align-items:center;gap:10px}
.uh-card h2{margin:0;font-size:24px;font-weight:700;letter-spacing:-.01em;line-height:1.2}
.uh-badge{font-size:12px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:#047857;border:1px solid #047857;border-radius:999px;padding:3px 10px}
.uh-domain{margin:0;font-size:13px;color:#4B5563}
.uh-scope{margin:0;font-size:15px;line-height:1.5;color:#374151}
.uh-qs{margin:0;padding:0;list-style:none;display:flex;flex-direction:column;gap:8px;font-size:15px;line-height:1.4}
.uh-qs a{overflow-wrap:anywhere}
.uh-actions{display:flex;flex-wrap:wrap;gap:10px;margin-top:auto;padding-top:4px}
.umbrella-home .uh-btn{display:inline-block;text-decoration:none;padding:11px 16px;border-radius:8px;font-weight:600;font-size:15px;line-height:1.2}
.umbrella-home .uh-btn.primary{color:#FFFFFF;background:#14213D}
.umbrella-home .uh-btn.secondary{color:#14213D;border:1px solid #C9D1DB;background:#FFFFFF}
.uh-hub{font-size:14px}
.uh-how{background:#F4F7F9;border-top:1px solid #E3E7EE;border-bottom:1px solid #E3E7EE;margin-top:16px}
.uh-how .uh-wrap,.uh-questions .uh-wrap{padding-top:40px;padding-bottom:40px;display:flex;flex-direction:column;gap:20px}
.uh-how h2{margin:0;font-size:28px;font-weight:700;letter-spacing:-.01em}
.uh-steps{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:16px}
.uh-step{background:#FFFFFF;border:1px solid #DCE2EA;border-radius:12px;padding:20px;display:flex;flex-direction:column;gap:8px}
.uh-step-label{font-size:12px;font-weight:600;letter-spacing:.08em;text-transform:uppercase;color:#0A5C66}
.uh-step h3{margin:0;font-size:18px;font-weight:600}
.uh-step p{margin:0;font-size:15px;line-height:1.5;color:#374151}
.uh-questions h2,.uh-about h2{margin:0;font-size:24px;font-weight:700}
.uh-about{border-top:1px solid #E3E7EE}
.uh-about .uh-wrap{padding-top:32px;padding-bottom:32px;display:flex;flex-direction:column;gap:12px}
.uh-definition{margin:0;font-size:16px;line-height:1.6;color:#374151;max-width:820px}
.uh-faq{margin:0;display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px 32px}
.uh-faq>div{display:flex;flex-direction:column;gap:6px}
.uh-faq dt{font-weight:600;font-size:16px}
.uh-faq dd{margin:0;font-size:15px;line-height:1.5;color:#374151}
.umbrella-home .review-date,.umbrella-home .search-ranked-links{max-width:1120px;margin:0 auto;padding:0 24px 24px;box-sizing:border-box;background:none;border:0}
.umbrella-home .search-ranked-links h2{font-size:20px;margin:0 0 8px}
.umbrella-home .site-footer{border-top:1px solid #E3E7EE;background:#F4F7F9;margin-top:0}
.uh-footer-row{display:flex;flex-wrap:wrap;gap:8px 24px;padding-top:20px;padding-bottom:8px;font-size:13px;color:#4B5563}
.uh-byline{margin:0 auto;padding-bottom:20px;font-size:13px;color:#4B5563}
@media (max-width:760px){
.uh-wrap,.umbrella-home .review-date,.umbrella-home .search-ranked-links{padding-left:16px;padding-right:16px}
.uh-grid,.uh-steps,.uh-faq{grid-template-columns:1fr}
.uh-nav{margin-left:0}
.uh-hero h1{font-size:30px}
.uh-deck{font-size:17px}
}
</style>`;

const HEAD_EXTRA = `<link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;500;600;700&amp;display=swap" />
  ${STYLE}`;

/** Swap the shared layout's chrome for the umbrella header/footer; throws if the layout shape moved. */
function applyChrome(html, year) {
  const header = /<header class="site-header">[\s\S]*?<\/header>/;
  const foot = /<footer class="site-footer">[\s\S]*?<\/footer>/;
  if (!header.test(html) || !foot.test(html) || !/<body>/.test(html) || !/<\/head>/.test(html)) {
    throw new Error('umbrella homepage: templates/layout.html no longer has the <body>, site-header, site-footer and </head> this homepage replaces');
  }
  return html
    .replace(header, HEADER)
    .replace(foot, footer(year))
    .replace('<body>', '<body class="umbrella-home">')
    .replace('</head>', `  ${HEAD_EXTRA}\n</head>`);
}

module.exports = { VERTICAL_CARDS, HERO_SUBLINE, HOW_STEPS, resolveCards, renderBody, applyChrome, footer };
