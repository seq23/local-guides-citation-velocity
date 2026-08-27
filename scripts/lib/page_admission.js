/**
 * One definition of "this route is public", imported by everything that needs
 * one. Before this file there were three, and they disagreed.
 *
 *   - `build_site.js:1963` filtered on `publication_status !== 'EVIDENCE_ONLY'`.
 *     Zero of the 865 entries in `content/_live/pages.json` carry that value, so
 *     the filter excluded nothing. It read like a gate and was a no-op.
 *   - `build_site.js:2509` filtered the public inventory on membership in
 *     `data/content/page_admission_registry.json`.
 *   - `scripts/content/validate_programmatic_substance.js` applied a third,
 *     stricter test (>= 2 sources, >= 3 sections, >= 250 projected words) to a
 *     fourth corpus - `data/page_families/velocity_page_specs.json`, 412 pages,
 *     not the 865.
 *
 * They disagree on 190 routes, which render to disk and appear in no sitemap,
 * no feed and no llms export. That direction of drift wastes work rather than
 * advertising a 404, so nothing failed and nothing noticed for months.
 *
 * The point of putting the predicate here is not that today's answer changes.
 * It is that there is now one answer, so the next person who tightens the rule
 * tightens it everywhere instead of in whichever file they had open.
 */
const fs = require('fs');
const path = require('path');

// Reuse the route normalizer the build already uses rather than writing a second
// one. A module whose whole purpose is to stop two definitions drifting apart
// should not open by introducing a third.
const { normalizeRoute } = require('./frozen_pages');

const ROOT = path.resolve(__dirname, '..', '..');

let admittedCache = null;

/** The set of routes the admission registry has admitted. */
function admittedRoutes() {
  if (admittedCache) return admittedCache;
  const file = path.join(ROOT, 'data', 'content', 'page_admission_registry.json');
  const doc = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : { pages: [] };
  admittedCache = new Set((doc.pages || []).map((p) => normalizeRoute(p.path)));
  return admittedCache;
}

/** Held back as evidence rather than published. Named so the check reads the
 *  same wherever it appears, instead of being retyped as a string comparison. */
function isEvidenceOnly(page) {
  return Boolean(page) && page.publication_status === 'EVIDENCE_ONLY';
}

/**
 * The predicate. A route is public when the admission registry has admitted it
 * and its page record has not been held back as evidence-only.
 *
 * `page` is optional: the sitemap knows only a route, the writer knows the whole
 * record, and both must get the same answer for the part they can both see.
 */
function isPubliclyAdmitted(route, page = null) {
  if (isEvidenceOnly(page)) return false;
  return admittedRoutes().has(normalizeRoute(route));
}

/** Routes that render but are not public. Not an error - a waste report. */
function renderedButNotPublic(writtenRoutes) {
  return writtenRoutes.map(normalizeRoute).filter((r) => r && !admittedRoutes().has(r));
}

module.exports = { isPubliclyAdmitted, isEvidenceOnly, admittedRoutes, renderedButNotPublic, normalizeRoute };
