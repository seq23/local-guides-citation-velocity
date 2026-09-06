#!/usr/bin/env node
/* eslint-disable no-console */
'use strict';
/**
 * The freeze transaction must be able to say no.
 *
 * acceptMutationScope() re-froze whatever a thawed rebuild produced. It recorded
 * transaction.prior_html_sha256 at the start of every mutation and never read it, so
 * a route that came back missing content was accepted, frozen as the new accepted
 * copy, and only caught downstream by rendered-output-shrink-guard - after the bytes
 * were already the record. On 2026-09-04 that cost /uscis-medical/ 414 bytes and nine
 * landed recommendations across three runs, and left Velocity Content Release red for
 * three days with two registered repairs that could not clear it.
 *
 * This validator proves the refusal still works, in both directions:
 *
 *   A. On the real ledger and the real rendered pages: for a route that is currently
 *      showing ledgered markers, removing one from the page under test is DETECTED,
 *      and leaving the page alone is NOT. A detector that never fires and a clean
 *      site are indistinguishable, which is the whole reason this class hid.
 *
 *   B. On any acceptance report a release left behind: every rejected route is back
 *      at its accepted bytes, and every thawed route was either accepted or rejected
 *      - a route in neither was silently dropped.
 *
 * Rule 0: examining zero routes is a FAILURE.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '../..');
const { normalizeRoute, implementationPathToRoute, loadRegistry, ACCEPTANCE_REPORT_REL } = require('../lib/frozen_pages');
const { ledgerMarkersByRoute, lostMarkers } = require('../lib/route_marker_preservation');

const OUT_REL = 'artifacts/validation/mutation-scope-acceptance-guard.json';

function rel(p) { return path.join(ROOT, p); }
function sha256(buf) { return crypto.createHash('sha256').update(buf).digest('hex'); }
function readJson(p, fallback) { try { return JSON.parse(fs.readFileSync(rel(p), 'utf8')); } catch { return fallback; } }

function renderedRelForRoute(route, registry) {
  const record = (registry.pages || []).find((p) => normalizeRoute(p.route) === route);
  if (record && record.rendered_file) return record.rendered_file;
  const r = normalizeRoute(route);
  if (r === '/') return 'index.html';
  if (r.endsWith('.html')) return r.slice(1);
  return `${r.slice(1).replace(/\/$/, '')}/index.html`;
}

function main() {
  const errors = [];
  const registry = loadRegistry();
  const byRoute = ledgerMarkersByRoute({ normalizeRoute, implementationPathToRoute });

  // ---- A. the detector, proved positively and negatively on real pages ----
  const cases = [];
  for (const [route, rows] of byRoute) {
    const renderedRel = renderedRelForRoute(route, registry);
    const abs = rel(renderedRel);
    if (!fs.existsSync(abs)) continue;
    const html = fs.readFileSync(abs, 'utf8');
    // A marker the page shows today: that is what a rebuild is able to lose.
    const shown = rows.filter((row) => html.includes(row.marker));
    if (!shown.length) continue;
    const marker = shown[0].marker;

    const unchanged = lostMarkers(html, html, rows);
    // Strip every representation the presence test accepts. Removing only the raw
    // spelling leaves the entity-encoded copy behind - the page still shows the
    // marker, so "not detected" would be the correct answer to the wrong question.
    let damagedHtml = html;
    for (const form of [marker, marker.replace(/—/g, '&#8212;'), marker.replace(/'/g, '&#39;'), marker.replace(/"/g, '&quot;'), marker.replace(/&/g, '&amp;')]) {
      damagedHtml = damagedHtml.split(form).join('');
    }
    const damaged = lostMarkers(html, damagedHtml, rows);

    if (unchanged.length) errors.push(`${route}: an unchanged page reported ${unchanged.length} lost marker(s); the detector fires on pages that lost nothing.`);
    if (!damaged.some((entry) => entry.marker === marker)) errors.push(`${route}: removing ${JSON.stringify(marker)} from the page was NOT detected as a loss.`);
    cases.push({ route, rendered_file: renderedRel, markers_on_page: shown.length, probe_marker: marker, detected: damaged.some((e) => e.marker === marker) });
    if (cases.length >= 25) break;
  }

  if (!cases.length) {
    console.error('MUTATION SCOPE ACCEPTANCE GUARD FAIL: examined zero routes. No ledgered route currently shows a marker on its rendered page, so this guard proved nothing. Refusing to pass on an empty loop.');
    process.exit(1);
  }

  // ---- B. any acceptance report a release left behind ----
  const report = readJson(ACCEPTANCE_REPORT_REL, null);
  let reportChecked = 0;
  if (report) {
    const seen = (report.accepted_routes || []).length + (report.rejected || []).length;
    if (seen !== Number(report.thawed_route_count)) {
      errors.push(`${ACCEPTANCE_REPORT_REL}: ${report.thawed_route_count} route(s) thawed but ${seen} accounted for. A thawed route in neither list was dropped without a decision.`);
    }
    for (const row of report.rejected || []) {
      reportChecked += 1;
      const record = (registry.pages || []).find((p) => normalizeRoute(p.route) === normalizeRoute(row.route));
      if (!record) { errors.push(`${row.route}: rejected but absent from the frozen registry.`); continue; }
      if (record.state !== 'FROZEN') errors.push(`${row.route}: rejected but left in state ${record.state}; a refused mutation must leave the route frozen.`);
      const abs = rel(record.rendered_file || renderedRelForRoute(normalizeRoute(row.route), registry));
      if (!fs.existsSync(abs)) { errors.push(`${row.route}: rejected but its rendered file is missing.`); continue; }
      if (sha256(fs.readFileSync(abs)) !== record.accepted_html_sha256) {
        errors.push(`${row.route}: rejected, but the rendered file does not match the accepted bytes. A refusal that does not restore is a loss with a log line.`);
      }
    }
  }

  const out = {
    schema_version: '1.0',
    validator: 'mutation-scope-acceptance',
    status: errors.length ? 'FAIL' : 'PASS',
    routes_with_ledgered_markers: byRoute.size,
    detector_cases_proved: cases.length,
    acceptance_report_present: Boolean(report),
    rejected_routes_checked: reportChecked,
    errors,
    cases,
  };
  fs.mkdirSync(path.dirname(rel(OUT_REL)), { recursive: true });
  fs.writeFileSync(rel(OUT_REL), `${JSON.stringify(out, null, 2)}\n`, 'utf8');

  if (errors.length) {
    console.error(`MUTATION SCOPE ACCEPTANCE GUARD FAIL: ${errors.length} problem(s).`);
    for (const line of errors.slice(0, 25)) console.error(`  ${line}`);
    process.exit(1);
  }
  console.log(`MUTATION SCOPE ACCEPTANCE GUARD PASS: refusal proved on ${cases.length} route(s) that currently show ledgered markers, positively and negatively; ${reportChecked} rejected route(s) verified back at their accepted bytes.`);
}

main();
