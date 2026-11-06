// Cloudflare Pages Function
// Endpoint: GET /go/?to=<absolute canonical URL>
//
// The one-click route for a portfolio link the Search Readiness g3 cap would
// otherwise turn into plain text (scripts/lib/served_head_contract.js,
// hopPortfolioLinks). The senior-living guides keep every CTA, city and guide
// route the owner's funnel requires, but only ONE of them is a direct outbound
// anchor; the rest come through here, marked rel="nofollow" on the page and
// noindex on this response, so they are reader routes and not a link footprint.
//
// Only the canonical guide domains named in content/_shared/canonical_map.json
// are allowed: this is never an open redirect.
import canonicalMap from '../../content/_shared/canonical_map.json';

const ALLOWED = new Set(
  Object.values(canonicalMap.canon || {})
    .flatMap((v) => [v.home, v.state_hint, v.directory_hint])
    .map((u) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return null; } })
    .filter(Boolean)
);

export function resolveHop(requestUrl) {
  const raw = new URL(requestUrl).searchParams.get('to');
  if (!raw) return null;
  let target;
  try { target = new URL(raw); } catch { return null; }
  if (target.protocol !== 'https:') return null;
  if (!ALLOWED.has(target.hostname.replace(/^www\./, ''))) return null;
  return target.href;
}

export function onRequestGet(context) {
  const target = resolveHop(context.request.url);
  const headers = { 'x-robots-tag': 'noindex, nofollow', 'cache-control': 'no-store' };
  if (!target) return new Response('Unknown destination', { status: 404, headers });
  return new Response(null, { status: 302, headers: { ...headers, location: target } });
}
