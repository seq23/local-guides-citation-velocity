#!/usr/bin/env node
'use strict';
// theindustryguides.com is the hub that routes readers to the six canonical
// guide sites. The owner-approved homepage (14 Oct 2026) puts that routing first:
// hero (one H1 + one subline, no definition paragraph), then the six vertical cards, each with three links into its canonical's
// verified guide inventory, a "Find a ..." link to its /request-assistance/ and
// a link to its root. This guards the routing, not the styling.
//
// Fails (hard_fail_basis public_route_integrity) when, in index.html and in
// dist/index.html when it is built:
//   - there is no <main>, no hero section holding the H1, or the first section
//     after the hero is not the vertical cards (#vertical-routes);
//   - fewer than six vertical cards render, a canonical vertical has no card, or
//     a vertical has two;
//   - a card does not link its canonical's /request-assistance/ and root, its
//     Velocity hub, or three guide paths present (http 200) in
//     data/contracts/canonical_guides/<vertical>.json;
//   - the visible page carries the keyword-inventory grid ("Related decision
//     paths", "owned routes", "Related search intents", a fanout block).
// It also absorbs the retired live-hubs check: content/_live/pages.json must
// hold every vertical's hub slug. Zero cards, zero inventories or a missing
// file is a failure, never a pass.
//
// The validator runs a self-test on synthetic pages every time;
// scripts/tests/test_umbrella_homepage_shape.js runs the same cases standalone.
const fs = require('fs');
const path = require('path');
const { loadInventories } = require('../lib/canonical_guide_links');
const { canonicalVerticalIds } = require('../lib/canonical_vertical');

const ROOT = path.resolve(__dirname, '..', '..');
const BANNED_VISIBLE = [/related decision paths/i, /owned routes/i, /related search intents/i];

/** Top-level <section> elements inside the given html, with nesting respected. */
function topLevelSections(html) {
  const re = /<section\b[^>]*>|<\/section>/gi;
  const out = [];
  let depth = 0;
  let start = -1;
  let m;
  while ((m = re.exec(html))) {
    if (m[0][1] !== '/') {
      if (depth === 0) start = m.index;
      depth += 1;
    } else if (depth > 0) {
      depth -= 1;
      if (depth === 0) out.push(html.slice(start, re.lastIndex));
    }
  }
  return out;
}

function visibleText(html) {
  return String(html)
    .replace(/<script\b[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ');
}

function hrefs(html) { return [...String(html).matchAll(/<a\b[^>]*\bhref="([^"]*)"/gi)].map((m) => m[1]); }

/** Returns the list of failures for one rendered homepage. */
function checkHtml(html, { inventories, ids, label = 'index.html' }) {
  const errors = [];
  const main = String(html).match(/<main\b[^>]*>([\s\S]*?)<\/main>/i);
  if (!main) return [`${label}: no <main>`];
  const sections = topLevelSections(main[1]);
  if (!sections.length) return [`${label}: zero sections inside <main>`];
  const heroAt = sections.findIndex((s) => /<h1\b/i.test(s));
  if (heroAt !== 0) errors.push(`${label}: the first section in <main> is not the hero holding the H1`);
  if (heroAt >= 0) {
    // The hero is the H1 and one short subline, nothing else (owner-approved
    // layout, 14 Oct 2026); the definition paragraph lives in the About block.
    const hero = sections[heroAt];
    const inner = hero.slice(hero.indexOf('>') + 1, hero.lastIndexOf('</section>')).replace(/<\/?div\b[^>]*>/gi, '');
    const blocks = [...inner.matchAll(/<(h1|p|ul|ol|dl|section|article|form|h[2-6]|figure|table|nav|a)\b[^>]*>/gi)].map((x) => x[1].toLowerCase());
    if (blocks.join(',') !== 'h1,p') errors.push(`${label}: the hero is not one H1 + one subline (${blocks.join(',') || 'empty'})`);
    if (/data-site-definition="true"/.test(hero)) errors.push(`${label}: the definition paragraph sits in the hero, not the About block`);
  }
  const next = heroAt >= 0 ? sections[heroAt + 1] : null;
  const opener = next ? next.slice(0, next.indexOf('>') + 1) : '';
  if (!next || !/\bid="vertical-routes"/.test(opener)) errors.push(`${label}: the first section after the hero is not the vertical cards (#vertical-routes)`);

  const verticalSection = sections.find((s) => /\bid="vertical-routes"/.test(s.slice(0, s.indexOf('>') + 1))) || '';
  const cards = [...verticalSection.matchAll(/<article\b[^>]*data-home-vertical="([^"]+)"[^>]*>([\s\S]*?)<\/article>/gi)];
  if (cards.length < ids.length) errors.push(`${label}: ${cards.length} vertical cards render, ${ids.length} required`);
  const seen = new Map();
  for (const [, v, body] of cards) seen.set(v, (seen.get(v) || 0) + 1);
  for (const id of ids) {
    if (!seen.has(id)) errors.push(`${label}: no card for canonical vertical ${id}`);
    else if (seen.get(id) > 1) errors.push(`${label}: ${seen.get(id)} cards for ${id}`);
  }
  for (const [, v, body] of cards) {
    const inv = inventories.get(v);
    if (!inv) { errors.push(`${label}: card ${v} is not a canonical vertical`); continue; }
    const links = hrefs(body);
    if (!links.includes(`${inv.origin}/request-assistance/`)) errors.push(`${label}: ${v} card does not link ${inv.origin}/request-assistance/`);
    if (!links.includes(`${inv.origin}/`)) errors.push(`${label}: ${v} card does not link ${inv.origin}/`);
    if (!links.includes(`/${v}/`)) errors.push(`${label}: ${v} card does not link its hub /${v}/`);
    const ok200 = new Set(inv.guides.filter((g) => Number(g.http_status) === 200).map((g) => g.path));
    const guideLinks = links.filter((h) => h.startsWith(`${inv.origin}/guides/`));
    const verified = guideLinks.filter((h) => ok200.has(h.slice(inv.origin.length)));
    for (const h of guideLinks) if (!ok200.has(h.slice(inv.origin.length))) errors.push(`${label}: ${v} card links ${h}, not a 200 guide in its canonical inventory`);
    if (verified.length < 3) errors.push(`${label}: ${v} card has ${verified.length} verified question links, 3 required`);
  }

  const text = visibleText(html);
  for (const re of BANNED_VISIBLE) if (re.test(text)) errors.push(`${label}: visible keyword-inventory grid ("${re.source}")`);
  if (/data-fanout-block="true"/.test(html)) errors.push(`${label}: visible fanout block present`);
  return errors;
}

function checkHubs(root, ids) {
  const live = path.join(root, 'content', '_live', 'pages.json');
  if (!fs.existsSync(live)) return ['content/_live/pages.json missing'];
  const slugs = new Set((JSON.parse(fs.readFileSync(live, 'utf8')).pages || []).map((p) => p && p.slug).filter(Boolean));
  return ids.filter((id) => !slugs.has(`/${id}/`)).map((id) => `content/_live/pages.json lacks hub /${id}/`);
}

function run(root = ROOT) {
  const ids = canonicalVerticalIds(root);
  const inventories = loadInventories(root);
  const errors = [];
  if (!ids.length) errors.push('zero canonical vertical ids');
  if (inventories.size !== ids.length) errors.push(`${inventories.size} canonical guide inventories for ${ids.length} vertical ids`);
  const files = [['index.html', path.join(root, 'index.html')], ['dist/index.html', path.join(root, 'dist', 'index.html')]];
  let checked = 0;
  for (const [label, abs] of files) {
    if (!fs.existsSync(abs)) { if (label === 'index.html') errors.push('index.html missing'); continue; }
    errors.push(...checkHtml(fs.readFileSync(abs, 'utf8'), { inventories, ids, label }));
    checked += 1;
  }
  errors.push(...checkHubs(root, ids));
  return { errors, checked, verticals: ids.length };
}

// ---------------------------------------------------------------- self-test
function goodPage(inventories, ids, { drop = null, extraBefore = '', mutateCard = null, tail = '', heroExtra = '' } = {}) {
  const cards = ids.filter((id) => id !== drop).map((id) => {
    const inv = inventories.get(id);
    const qs = inv.guides.filter((g) => Number(g.http_status) === 200).slice(0, 3).map((g) => `<li><a href="${inv.origin}${g.path}">${g.title}</a></li>`).join('');
    let card = `<article class="uh-card" data-home-vertical="${id}"><h2>${id}</h2><ul>${qs}</ul><a href="${inv.origin}/request-assistance/">Find</a><a href="${inv.origin}/">Open</a><a href="/${id}/">Hub</a></article>`;
    if (mutateCard && mutateCard.id === id) card = mutateCard.fn(card, inv);
    return card;
  }).join('');
  return `<html><body><main><section class="uh-hero" data-umbrella-home="true"><div><h1>Plain answers</h1><p>Pick your situation.</p>${heroExtra}</div></section>${extraBefore}<section id="vertical-routes" data-home-verticals="true">${cards}</section><section id="how"><h2>How every guide site works</h2></section>${tail}</main></body></html>`;
}

function selfTest(root = ROOT) {
  const ids = canonicalVerticalIds(root);
  const inventories = loadInventories(root);
  const first = ids[0];
  const cases = [
    { name: 'approved shape passes', html: goodPage(inventories, ids), pass: true },
    { name: 'a second paragraph under the H1 fails (the 53-word definition back in the hero)', html: goodPage(inventories, ids, { heroExtra: '<p class="site-definition" data-site-definition="true">The Industry Guides is ...</p>' }), pass: false },
    { name: 'a hero without the subline fails', html: goodPage(inventories, ids).replace('<p>Pick your situation.</p>', ''), pass: false },
    { name: 'no main fails', html: '<html><body><section><h1>x</h1></section></body></html>', pass: false },
    { name: 'a section between hero and cards fails (old "At a glance" / router strip)', html: goodPage(inventories, ids, { extraBefore: '<section class="card answer-box"><h2>Use this page to frame the decision</h2></section>' }), pass: false },
    { name: 'five cards fails', html: goodPage(inventories, ids, { drop: ids[ids.length - 1] }), pass: false },
    { name: 'a question link outside the canonical inventory fails', html: goodPage(inventories, ids, { mutateCard: { id: first, fn: (c, inv) => c.replace(/href="[^"]*\/guides\/[^"]*"/, `href="${inv.origin}/guides/invented-question/"`) } }), pass: false },
    { name: 'a card without its request-assistance link fails', html: goodPage(inventories, ids, { mutateCard: { id: first, fn: (c) => c.replace('/request-assistance/', '/contact/') } }), pass: false },
    { name: 'the visible "Related decision paths" grid fails', html: goodPage(inventories, ids, { tail: '<section class="card fanout-block" data-fanout-block="true"><h2>Related decision paths people also use</h2></section>' }), pass: false },
    { name: '"owned routes" text fails', html: goodPage(inventories, ids, { tail: '<section><p>Additional owned routes for this topic</p></section>' }), pass: false },
    { name: 'the grid kept only in a script (schema) passes', html: goodPage(inventories, ids, { tail: '<script type="application/ld+json">{"name":"Related decision paths"}</script>' }), pass: true },
  ];
  const failures = [];
  for (const c of cases) {
    const errs = checkHtml(c.html, { inventories, ids, label: c.name });
    if (c.pass && errs.length) failures.push(`expected pass: ${c.name}: ${errs.join('; ')}`);
    if (!c.pass && !errs.length) failures.push(`expected failure: ${c.name}`);
  }
  return { cases: cases.length, failures };
}

module.exports = { checkHtml, topLevelSections, run, selfTest };

if (require.main === module) {
  const st = selfTest();
  const { errors, checked, verticals } = run();
  const all = [...st.failures.map((f) => `self-test: ${f}`), ...errors];
  const evidence = { validator: 'umbrella-homepage-shape', status: all.length ? 'FAIL' : 'PASS', files_checked: checked, verticals, self_test_cases: st.cases, errors: all };
  fs.mkdirSync(path.join(ROOT, 'artifacts', 'validation'), { recursive: true });
  fs.writeFileSync(path.join(ROOT, 'artifacts', 'validation', 'umbrella-homepage-shape.json'), JSON.stringify(evidence, null, 2) + '\n');
  if (all.length) { console.error(`UMBRELLA HOMEPAGE SHAPE FAIL (${all.length})\n${all.join('\n')}`); process.exit(1); }
  console.log(`umbrella homepage shape PASS: ${checked} file(s), ${verticals} vertical cards each routed to its canonical, ${st.cases} self-test cases`);
}
