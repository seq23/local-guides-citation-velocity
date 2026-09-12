'use strict';

const fs = require('fs');
const path = require('path');
const { classifyOpportunity } = require('./citation_opportunity_classifier');
const { normalizeVertical, routeSegmentForVertical } = require('./vertical_authority');
const { routeShape, renderedPathForRoute } = require('./page_family_authority');
// A route may never name the model that generated the page. The seven
// -openai-gpt-4o / -perplexity / -gemini-1-5-flash routes retired on 2026-08-29
// all entered here: `query` arrived from an LLM answer panel carrying the
// answering model in its display string, and this function slugified it whole.
// Stripping at the one place a query becomes a URL closes it for every caller.
// See scripts/lib/model_name_guard.js.
const { stripModelNames } = require('./model_name_guard');
const ROOT = path.resolve(__dirname, '../..');
const POLICY_PATH = 'data/report_fixes/page_family_routing_policy.json';
// A ROUTE MAY NOT END MID-WORD.
//
// The cap was a bare .slice(0, 90), which cuts wherever character 90 falls. On
// 2026-09-11 the release lane minted
// /neuro/guides/we-only-discovered-asd-through-neuropsych-evaluation-because-my-child-is-highly-functionin/
// - exactly 90 characters, "functioning" severed at "functionin" - and
// route-topic-quality failed it as truncated_route_slug, the 486th instance of a
// class whose first 485 are sealed in a baseline that must not grow.
//
// validate_route_topic_quality.js flags any final route segment of 88 characters
// or more, so trimming has to land BELOW that, not at it: cut to 87 and then drop
// back to the last hyphen, which removes the partial word and guarantees the
// segment can never reach the threshold. A single unbroken word longer than the
// cap has no boundary to fall back to and keeps the hard slice - there is nothing
// better available, and it is not the shape this defect takes.
//
// Fixed HERE for the same reason stripModelNames is: this is the one place a query
// becomes a URL, so closing it closes it for every caller rather than for whichever
// caller was remembered.
const LEGACY_SLUG_MAX = 90;
const SLUG_MAX = 87;
function capSlugAtWordBoundary(slug) {
  if (slug.length <= SLUG_MAX) return slug;
  const cut = slug.slice(0, SLUG_MAX);
  const lastBoundary = cut.lastIndexOf('-');
  const trimmed = lastBoundary > 0 ? cut.slice(0, lastBoundary) : cut;
  return trimmed.replace(/-+$/, '') || cut;
}
function baseSlug(value) {
  return stripModelNames(String(value || '')).toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}
function slugify(value) { return capSlugAtWordBoundary(baseSlug(value)) || 'citation-question'; }
function legacySlugify(value) { return baseSlug(value).slice(0, LEGACY_SLUG_MAX) || 'citation-question'; }

// AN ALREADY-PUBLISHED PAGE KEEPS THE URL IT WAS PUBLISHED AT.
//
// Trimming the cap fixes the route the lane MINTS. It must not silently re-address
// routes that already exist: 254 live pages sit at exactly the old 90-character cap,
// and re-deriving them through the new rule would move every one of them to a URL
// with no page on it. The first run after the trim proved it - two rows whose pages
// are published at the 90-character route resolved to the trimmed route instead, and
// citation-agent-fix-trace correctly reported them as selected-but-not-created.
//
// So: if the legacy route for this query is a page that exists, that page's URL is
// the answer. Only a query with no published page behind it gets the trimmed slug.
// The set is read once from the live content, which is the same source the admission
// registry and the sitemap derive from, so this cannot drift into a third opinion
// about which pages exist.
let publishedRouteCache = null;
function publishedRoutes() {
  if (publishedRouteCache) return publishedRouteCache;
  publishedRouteCache = new Set();
  try {
    const live = JSON.parse(fs.readFileSync(path.join(ROOT, 'content/_live/pages.json'), 'utf8'));
    for (const page of live.pages || []) {
      const slug = String(page.slug || page.path || '');
      if (slug) publishedRouteCache.add(slug.endsWith('/') ? slug : `${slug}/`);
    }
  } catch { /* no live content yet: nothing is published, so nothing is preserved */ }
  return publishedRouteCache;
}
function readPolicy() { try { return JSON.parse(fs.readFileSync(path.join(ROOT, POLICY_PATH), 'utf8')); } catch { return {}; } }
function routeForFamily(vertical, query, family) {
  const v = routeSegmentForVertical(vertical);
  const section = family === 'CREATE_GUIDE' ? 'guides' : family === 'CREATE_CLUSTER' ? 'clusters' : 'community-questions';
  const legacy = `/${v}/${section}/${legacySlugify(query)}/`;
  if (publishedRoutes().has(legacy)) return legacy;
  return `/${v}/${section}/${slugify(query)}/`;
}
function routePage(row) {
  const policy = readPolicy();
  const decision = classifyOpportunity(row);
  const vertical = normalizeVertical(row.vertical);
  const verticalPolicy = policy.verticals?.[vertical] || policy.verticals?.[routeSegmentForVertical(vertical)] || {};
  const allowed = new Set(verticalPolicy.allowed_families || policy.default_allowed_families || ['CREATE_COMMUNITY_QA']);
  if (decision.family === 'REPAIR_EXISTING') {
    const target = row.target_route || '';
    const renderedPath = row.renderedPath || renderedPathForRoute(target);
    return { ...decision, status: 'REPAIR_EXISTING', target_route: target, renderedPath, route_shape: target ? routeShape(target) : 'repair_existing', route_authority: 'artifact_admitted', admission_basis: 'existing_target_repair', rich_page_type: decision.rich_page_type || 'repair_existing' };
  }
  let family = decision.family;
  let reason = decision.reason;
  if (!allowed.has(family)) {
    if (allowed.has('CREATE_COMMUNITY_QA') && family !== 'CREATE_GUIDE') {
      reason = `downgraded_from_${family}`;
      family = 'CREATE_COMMUNITY_QA';
    } else {
      return { ...decision, status: 'BLOCKED_UNSUPPORTED_PAGE_FAMILY', blocked_reason: 'UNSUPPORTED_PAGE_FAMILY', target_route: '', renderedPath: '', route_shape: '', route_authority: 'blocked_by_route_shape_policy', admission_basis: '' };
    }
  }
  const route = routeForFamily(vertical, row.query || row.normalized_query, family);
  return { family, reason, status: 'READY_TO_RELEASE', target_route: route, renderedPath: renderedPathForRoute(route), route_shape: routeShape(route), route_authority: 'artifact_admitted', admission_basis: 'route_resolver', rich_page_type: decision.rich_page_type || (family === 'CREATE_GUIDE' ? 'checklist_guide' : family === 'CREATE_CLUSTER' ? 'cluster_page' : 'community_qa') };
}
module.exports = { routePage, routeForFamily, slugify, legacySlugify };
