#!/usr/bin/env node
'use strict';
/**
 * Put canonical guide links onto the FROZEN Velocity pieces (2026-10-13).
 *
 * Every published route is frozen: a rebuild renders the new elements and then
 * restoreFrozenPages() puts the accepted bytes back. A thaw-and-rebuild would also
 * carry months of unrelated generator drift onto 600+ pages. This adds ONLY the
 * guide sentence and the "Read the full guide" line (scripts/lib/canonical_guide_links.js,
 * the same markup the renderers emit) and the guide-URL repoints in
 * data/contracts/canonical_guides/repointed_guide_urls.json, inside a governed
 * mutation scope:
 *
 *   node scripts/frozen_pages.js begin <release-id> $(node scripts/retrofit_canonical_guide_links.js --routes)
 *   node scripts/retrofit_canonical_guide_links.js --apply
 *   node scripts/frozen_pages.js accept
 *
 * Without --apply it reports what it would change and writes nothing.
 */
const fs = require('fs');
const path = require('path');
const L = require('./lib/canonical_guide_links');
const { loadRegistry, normalizeRoute } = require('./lib/frozen_pages');

const ROOT = path.resolve(__dirname, '..');
const APPLY = process.argv.includes('--apply');
const ROUTES_ONLY = process.argv.includes('--routes');
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

const repoints = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/contracts/canonical_guides/repointed_guide_urls.json'), 'utf8')).repoints || [];
if (!repoints.length) throw new Error('repointed_guide_urls.json: zero repoints');
const repointRe = (from) => new RegExp(`${from.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')}(?=["'#?\\s<])`, 'g');

const plan = L.planPieceGuides(ROOT);
if (![...plan.values()].some((p) => p.guides.length)) throw new Error('zero pieces matched a canonical guide: the plan reaches nothing');
const registry = loadRegistry();
const changes = [];
for (const record of registry.pages || []) {
  const route = normalizeRoute(record.route);
  const rel = record.rendered_file;
  if (!rel) continue;
  const abs = path.join(ROOT, rel);
  if (!fs.existsSync(abs)) continue;
  const before = fs.readFileSync(abs, 'utf8');
  let after = before;
  const piece = plan.get(route);
  if (piece) after = L.injectIntoHtml(after, piece.guides, piece.site, esc, route);
  for (const r of repoints) {
    after = after.replace(repointRe(r.from), r.to);
    // Some cards print the URL as the link text without its scheme.
    const bare = (u) => u.replace(/^https?:\/\//, '');
    after = after.split(`>${bare(r.from)}<`).join(`>${bare(r.to)}<`).split(`>${bare(r.from).replace(/\/$/, '')}<`).join(`>${bare(r.to)}<`);
  }
  if (after !== before) changes.push({ route, abs, after, guides: piece ? piece.guides.length : 0 });
}
if (ROUTES_ONLY) { process.stdout.write(changes.map((c) => c.route).join('\n') + '\n'); process.exit(0); }
if (APPLY) for (const c of changes) fs.writeFileSync(c.abs, c.after);
const withGuides = changes.filter((c) => c.guides).length;
console.log(`${APPLY ? 'APPLIED' : 'DRY RUN'}: ${changes.length} frozen page(s) change; ${withGuides} gain canonical guide links; ${changes.length - withGuides} repoint only`);
