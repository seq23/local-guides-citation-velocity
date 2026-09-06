'use strict';
/**
 * What a thawed route is not allowed to lose.
 *
 * A route thawed for a repair is exempt from restoreFrozenPages(), so it is rebuilt
 * from source rather than restored from its accepted bytes. That is the point - the
 * repair has to be able to change the page. What was never checked is the other
 * direction: acceptMutationScope() re-froze whatever came back, comparing nothing
 * against transaction.prior_html_sha256, which it records and then never reads.
 *
 * 2026-09-04 is what that costs. A merged uscis-medical repair thawed
 * /uscis-medical/, the rebuild came back 414 bytes lighter, and the bytes were the
 * links carrying two ledgered required_markers. Nine landed recommendations across
 * the 2026-07-24, 2026-07-31 and 2026-08-07 runs stopped being shown by the page that
 * had been delivering them, to buy one new H2. The release then froze that page as
 * the accepted copy, and Velocity Content Release stayed red for three days on
 * rendered-output-shrink-guard and agent-run-delivery-coverage - the two guards that
 * exist precisely because this had happened once before.
 *
 * The ledger already states the invariant per row: required_markers is the text that
 * must appear on the rendered page for a recommendation to be satisfied. This module
 * turns that into a per-route rule the freeze transaction can enforce at the moment
 * of acceptance, where refusing is still cheap and the prior bytes are still on disk.
 *
 * A marker only counts if the PRIOR page actually showed it. A marker that was never
 * there is unlanded work, not a regression, and holding a repair hostage to it would
 * block every route that has an outstanding recommendation.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../..');
const LEDGER_REL = 'data/report_fixes/agent_fix_ledger.json';

function readJson(rel, fallback) {
  try { return JSON.parse(fs.readFileSync(path.join(ROOT, rel), 'utf8')); } catch { return fallback; }
}

/** The same decoding the truthfulness validator uses, so both agree on "present". */
function decode(html) {
  return String(html).replace(/&#8212;/g, '—').replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&');
}

function shows(html, decoded, marker) {
  const raw = String(marker);
  const encoded = raw.replace(/—/g, '&#8212;');
  return html.includes(raw) || decoded.includes(raw) || html.includes(encoded) || decoded.includes(encoded);
}

/**
 * Map of normalized route -> [{ id, run_date, marker }] drawn from every ledger row
 * that names a rendered page and declares markers, whatever status it now carries.
 * Status is deliberately ignored: a demoted row whose marker is still on the page is
 * still delivering it, and losing it is still a loss.
 */
function ledgerMarkersByRoute({ normalizeRoute, implementationPathToRoute }) {
  const ledger = readJson(LEDGER_REL, null);
  const byRoute = new Map();
  for (const fix of (ledger && ledger.fixes) || []) {
    const rendered = fix.renderedPath || '';
    if (!rendered) continue;
    const markers = Array.isArray(fix.required_markers) ? fix.required_markers.filter(Boolean) : [];
    if (!markers.length) continue;
    const route = normalizeRoute(implementationPathToRoute(rendered));
    if (!route) continue;
    if (!byRoute.has(route)) byRoute.set(route, []);
    const rows = byRoute.get(route);
    for (const marker of markers) rows.push({ id: fix.id || '', run_date: fix.run_date || '', marker: String(marker) });
  }
  return byRoute;
}

/**
 * Markers the prior page showed and the current page does not. Deduplicated by
 * marker text, with the ledger rows that depended on each one.
 */
function lostMarkers(priorHtml, currentHtml, rows) {
  const priorRaw = String(priorHtml);
  const priorDecoded = decode(priorRaw);
  const currentRaw = String(currentHtml);
  const currentDecoded = decode(currentRaw);
  const lost = new Map();
  for (const row of rows || []) {
    if (!shows(priorRaw, priorDecoded, row.marker)) continue;
    if (shows(currentRaw, currentDecoded, row.marker)) continue;
    if (!lost.has(row.marker)) lost.set(row.marker, { marker: row.marker, depended_on_by: [] });
    lost.get(row.marker).depended_on_by.push({ id: row.id, run_date: row.run_date });
  }
  return [...lost.values()];
}

module.exports = { LEDGER_REL, decode, shows, ledgerMarkersByRoute, lostMarkers };
