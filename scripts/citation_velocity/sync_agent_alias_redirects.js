#!/usr/bin/env node
/* eslint-disable no-console */
'use strict';
// Turn the route resolver's canonicalization into real 301s.
//
// An external agent names the URL it tested. Those names are not always the repo's
// slug: the 2026-09-01 dentistry run reported /dentistry/pediatric-dentistry/,
// /dentistry/emergency-dentistry/ and /dentistry/second-opinions-treatment-planning/
// for pages this repo publishes as pediatric-family, emergency-open-now and
// second-opinion. The intake resolver already knows every one of those mappings - it
// has to, to apply the repairs at all - and records it in the exact-implementation
// ledger as intended_winner_page != implementation_path.
//
// That knowledge stopped at the ledger. The URL the agent actually tested, the one an
// answer engine would follow, kept returning 404 - which is precisely what the run's
// Monthly Site Health Audit reported as its single Critical finding.
//
// So the mapping is projected into data/release/route_retirements.json, the canonical
// authority build_site.js renders _redirects from. Nothing is hand-written into
// _redirects, and nothing is invented here: a redirect is emitted only where the
// ledger already recorded the canonicalization AND the named route does not exist as
// a page in its own right.
//
// Vertical-agnostic on purpose: it reads the ledger, never a list of verticals.

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../..');
const LEDGER = 'data/report_fixes/agent_exact_implementation_ledger.json';
const RETIREMENTS = 'data/release/route_retirements.json';
const LIVE_PAGES = 'content/_live/pages.json';
const REDIRECTS = '_redirects';
const CONTRACT = 'data/overhaul/full_scope_overhaul_contract.json';

function rel(p) { return path.join(ROOT, p); }
function readJson(p, fallback) { try { return JSON.parse(fs.readFileSync(rel(p), 'utf8')); } catch { return fallback; } }

// "dentistry/pediatric-dentistry/index.html" and
// "https://theindustryguides.com/dentistry/pediatric-dentistry/" both mean /dentistry/pediatric-dentistry/.
function toRoute(value) {
  let out = String(value || '').trim();
  if (!out) return '';
  out = out.replace(/^https?:\/\/[^/]+/, '').replace(/[?#].*$/, '');
  out = out.replace(/index\.html$/, '');
  if (!out.startsWith('/')) out = `/${out}`;
  if (!out.endsWith('/')) out = `${out}/`;
  return out.replace(/\/{2,}/g, '/');
}

// A redirect source has to be a URL path, and only that.
//
// Historical ledger rows carry values in intended_winner_page that are not routes at
// all: a whole FIX instruction ("FILEPATH: trt/index.html || CURRENT: ... || EDIT:
// ..."), or a human-readable article title. Those are the same composite-field defect
// the source parser was fixed for, frozen into data written before the fix. Projecting
// them into _redirects would have published nine aliases of which four were nonsense.
//
// Emitting a redirect is a public, durable act, so this refuses anything that is not
// unmistakably a path: lowercase slug segments, no whitespace, no separators from the
// report format, and a sane length.
const ROUTE_SHAPE = /^\/(?:[a-z0-9]+(?:-[a-z0-9]+)*\/)+$/;
function isEmittableRoute(route) {
  if (!route || route.length > 200) return false;
  if (/\s|\|\||[:?#"'`]/.test(route)) return false;
  return ROUTE_SHAPE.test(route);
}

function main() {
  const ledger = readJson(LEDGER, null);
  if (!ledger || !Array.isArray(ledger.entries)) {
    console.error(`AGENT ALIAS REDIRECT SYNC FAIL: ${LEDGER} is missing or has no entries array.`);
    process.exit(1);
  }
  const retirements = readJson(RETIREMENTS, null);
  if (!retirements || !Array.isArray(retirements.retirements)) {
    console.error(`AGENT ALIAS REDIRECT SYNC FAIL: ${RETIREMENTS} is missing or has no retirements array.`);
    process.exit(1);
  }

  const livePages = readJson(LIVE_PAGES, { pages: [] });
  const realRoutes = new Set((livePages.pages || []).map((p) => toRoute(p.slug || p.path || '')).filter(Boolean));
  const existing = new Map(retirements.retirements.map((r) => [toRoute(r.source_path), r]));

  // The two surfaces are reconciled independently. Deduping on the authority file
  // alone meant a mapping already recorded there but never written to _redirects
  // could never be repaired: the script saw "already known" and emitted nothing,
  // while the route went on 404ing. What is SERVED and what is RECORDED are checked
  // separately, so either one being behind is fixed on the next run.
  const redirectText = fs.readFileSync(rel(REDIRECTS), 'utf8');
  const servedSources = new Set(
    redirectText.split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#'))
      .map((l) => toRoute(l.split(/\s+/)[0]))
  );

  const added = [];
  const recorded = [];
  const rejected = [];
  let examined = 0;
  for (const entry of ledger.entries) {
    const named = toRoute(entry.intended_winner_page || entry.intended_winner_path || '');
    const target = toRoute(entry.implementation_path || '');
    if (!named || !target) continue;
    examined += 1;
    if (named === target) continue;
    if (!isEmittableRoute(named) || !isEmittableRoute(target)) { rejected.push(named); continue; }
    // Never shadow a page that genuinely exists at the named route, and never
    // point a redirect at something this repo does not publish.
    if (realRoutes.has(named)) continue;
    if (!realRoutes.has(target)) continue;
    if (!existing.has(named)) {
      const record = {
        source_path: named,
        target_path: target,
        status: 'ACTIVE_301',
        reason: 'Agent-tested URL alias; the citation route resolver canonicalizes it to the published page, so the tested URL resolves instead of 404ing.',
        evidence: ['_redirects', LEDGER, 'scripts/lib/citation_route_resolver.js']
      };
      retirements.retirements.push(record);
      existing.set(named, record);
      recorded.push(`${named} -> ${target}`);
    }
    if (!servedSources.has(named)) {
      servedSources.add(named);
      added.push(`${named} -> ${target}`);
    }
  }

  // Rule 0: this must not be able to exit 0 having looked at nothing. Zero entries
  // examined means the ledger is empty or shaped differently than assumed, and a
  // silent success there is exactly how "runs but inert" hides.
  if (examined === 0) {
    console.error(`AGENT ALIAS REDIRECT SYNC FAIL: examined zero ledger entries with both a named and a resolved route; refusing to report success on an empty loop.`);
    process.exit(1);
  }

  const today = process.env.SOURCE_DATE || new Date().toISOString().slice(0, 10);
  if (recorded.length) {
    retirements.updated_at = today;
    fs.writeFileSync(rel(RETIREMENTS), `${JSON.stringify(retirements, null, 2)}\n`);
  }
  if (added.length) {
    // _redirects is the file Pages actually serves; route_retirements.json is the
    // authority record beside it. Both are written, in the same shape
    // scripts/retire_offtopic_routes.js already uses, so the served behaviour and the
    // audit trail cannot disagree.
    const redirectsPath = rel(REDIRECTS);
    let text = redirectText;
    if (!text.endsWith('\n')) text += '\n';
    text += `\n# ${today} agent-tested URL aliases for ${added.length} route(s) an external citation run named but this repo publishes under another slug.\n`
      + `# Authority: ${RETIREMENTS}. Derived from ${LEDGER} by scripts/citation_velocity/sync_agent_alias_redirects.js.\n`;
    for (const line of added) {
      const [from, to] = line.split(' -> ');
      text += `${from} ${to} 301\n`;
    }
    fs.writeFileSync(redirectsPath, text);

    // The overhaul contract carries approved_route_retirements as a ratchet with a
    // dated note per raise, and full-scope-overhaul hard-fails when the ledger and
    // the contract disagree. scripts/retire_offtopic_routes.js maintains it the same
    // way; a second producer of ACTIVE_301s has to maintain it too, or the first
    // alias this lane ever emits turns the build red.
    const contract = readJson(CONTRACT, null);
    if (!contract || !contract.counts) {
      console.error(`AGENT ALIAS REDIRECT SYNC FAIL: ${CONTRACT} is missing or has no counts block, so the retirement ratchet cannot be kept in step with the ${added.length} alias(es) just written.`);
      process.exit(1);
    }
    const activeCount = retirements.retirements.filter((r) => r.status === 'ACTIVE_301').length;
    const previous = contract.counts.approved_route_retirements;
    contract.counts.approved_route_retirements = activeCount;
    contract.notes = contract.notes || {};
    contract.notes[`agent_url_aliases_${today.replace(/-/g, '_')}`] =
      `approved_route_retirements raised from ${previous} to ${activeCount} on ${today}. `
      + `${added.length} alias 301(s) were added for URLs an external citation-velocity run named and tested but which this repo publishes under a different slug `
      + `(${added.join('; ')}). The mapping is not new - scripts/lib/citation_route_resolver.js already canonicalized these to apply the runs' repairs - it simply never reached _redirects, so the exact URLs the agent reported as 404s stayed 404s. `
      + `No page is retired or removed by this: every target is a page that already exists, and effective_inventory is unchanged.`;
    fs.writeFileSync(rel(CONTRACT), `${JSON.stringify(contract, null, 2)}\n`);
    console.log(`  retirement ratchet: approved_route_retirements ${previous} -> ${activeCount}`);
  }
  console.log(`AGENT ALIAS REDIRECT SYNC PASS: examined ${examined} ledger entr(ies); served ${added.length} new alias 301(s); recorded ${recorded.length} in the authority file; rejected ${rejected.length} non-route value(s).`);
  for (const line of rejected) console.log(`  REJECTED (not a route): ${String(line).slice(0, 120)}`);
  for (const line of added) console.log(`  ${line}`);
}

main();
