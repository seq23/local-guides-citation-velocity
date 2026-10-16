#!/usr/bin/env node
'use strict';
/**
 * Rewrite dead canonical links on already-accepted (frozen) insight pages.
 *
 * The generator resolves canonical targets through scripts/lib/canonical_routes.js,
 * so every page it renders from now on links a live canonical route. Accepted
 * insight pages are frozen byte-for-byte, though, and a full re-render of them
 * drifts in unrelated ways (nav, dates, and some ledgered blocks the generator no
 * longer reproduces). This rewrites ONLY the canonical links - each href that is
 * not a live route, and the visible label that spells that same URL - through the
 * same resolver, inside a frozen-page mutation scope, then accepts (refreezes) the
 * result. Run it again whenever data/canonical_route_snapshot.json is refreshed
 * and validate_canonical_domains.js reports dead canonical routes.
 *
 * Usage: node scripts/rewrite_insight_canonical_links.js [--dry-run]
 */
const fs = require('fs');
const path = require('path');
const routes = require('./lib/canonical_routes');
const frozen = require('./lib/frozen_pages');

const ROOT = path.resolve(__dirname, '..');
const DRY = process.argv.includes('--dry-run');
const INSIGHTS = path.join(ROOT, 'insights');
const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'content', '_live', 'insights.json'), 'utf8'));
const ctxByFile = new Map((manifest.items || []).map((i) => [path.basename(i.publish_path || ''), { cluster: i.cluster, title: i.title }]));

function escapeRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

const changes = [];
for (const f of fs.readdirSync(INSIGHTS).sort()) {
  if (!f.endsWith('.html')) continue;
  const abs = path.join(INSIGHTS, f);
  const html = fs.readFileSync(abs, 'utf8');
  const dead = [...new Set(routes.canonicalHrefs(html).filter((u) => !routes.isLiveCanonicalRoute(u)))];
  if (!dead.length) continue;
  const ctx = ctxByFile.get(f);
  if (!ctx) throw new Error(`${f}: dead canonical links but no manifest entry to route them by topic`);
  let out = html;
  const map = {};
  for (const oldUrl of dead) {
    const newUrl = routes.resolveCanonicalTarget(oldUrl, ctx);
    map[oldUrl] = newUrl;
    const oldLabel = oldUrl.replace(/^https?:\/\//, '');
    const newLabel = newUrl.replace(/^https?:\/\//, '');
    // href="old" (as written, & possibly escaped) and the label that spells the URL.
    out = out.replace(new RegExp(`href="${escapeRe(oldUrl.replace(/&/g, '&amp;'))}"`, 'g'), `href="${newUrl.replace(/&/g, '&amp;')}"`);
    out = out.replace(new RegExp(`href="${escapeRe(oldUrl)}"`, 'g'), `href="${newUrl}"`);
    out = out.replace(new RegExp(`>${escapeRe(oldLabel)}<`, 'g'), `>${newLabel}<`);
  }
  const left = routes.canonicalHrefs(out).filter((u) => !routes.isLiveCanonicalRoute(u));
  if (left.length) throw new Error(`${f}: still dead after rewrite: ${left.join(', ')}`);
  changes.push({ file: f, route: `/insights/${f}`, abs, out, map });
}

if (!changes.length) { console.log('insight canonical links: 0 dead links found; nothing to rewrite'); process.exit(0); }
const linkCount = changes.reduce((n, c) => n + Object.keys(c.map).length, 0);
if (DRY) { console.log(`DRY RUN: ${changes.length} page(s), ${linkCount} page-link rewrite(s) pending`); process.exit(0); }

const scope = frozen.beginMutationScope(changes.map((c) => c.route), `canonical-route-rewrite-${new Date().toISOString().slice(0, 10)}`);
for (const c of changes) fs.writeFileSync(c.abs, c.out);
const accepted = frozen.acceptMutationScope();
if (accepted.rejected && accepted.rejected.length) throw new Error(`mutation scope rejected ${accepted.rejected.length} route(s): ${JSON.stringify(accepted.rejected.slice(0, 3))}`);
console.log(`insight canonical links: rewrote ${changes.length} page(s) (${linkCount} page-link rewrite(s)); thawed ${scope.thawed_routes.length}, refroze ${accepted.accepted}`);
