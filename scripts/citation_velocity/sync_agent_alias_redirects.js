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
const NORMALIZED = 'data/report_fixes/normalized_agent_runs';
const { resolveTargetPath, normalizeImplementationPath } = require('../lib/citation_route_resolver');

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
  // An insight is served AT its .html path, not at a directory. Appending a slash
  // turned /insights/trt-022-....html into /insights/trt-022-....html/, which then
  // failed the route-shape check on its dot - so every insight alias was silently
  // rejected and every insight URL an agent named by the wrong serial went on 404ing.
  // That is one of the three findings the absorption ratchet was holding.
  if (!out.endsWith('/') && !/\.html$/i.test(out)) out = `${out}/`;
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
// Two legal shapes: a directory route, and an insight document route ending .html.
const ROUTE_SHAPE = /^\/(?:[a-z0-9]+(?:-[a-z0-9]+)*\/)+$/;
const DOC_ROUTE_SHAPE = /^\/(?:[a-z0-9]+(?:-[a-z0-9]+)*\/)*[a-z0-9]+(?:-[a-z0-9]+)*\.html$/;
function isEmittableRoute(route) {
  if (!route || route.length > 200) return false;
  if (/\s|\|\||[:?#"'`]/.test(route)) return false;
  return ROUTE_SHAPE.test(route) || DOC_ROUTE_SHAPE.test(route);
}

// An alias must point at the SAME SUBJECT.
//
// Allowing .html routes immediately surfaced why: several ledger rows were resolved by
// the old serial-only rule, so their named target and their resolved target share a
// number and nothing else - /insights/trt-015-trt-clinic-red-flags-to-avoid-in-2026.html
// against /insights/trt-015-endocrinologist-for-trt-when-to-choose.html. Publishing a
// 301 between those would send a reader looking for clinic red flags to a page about
// choosing an endocrinologist. A wrong redirect is worse than a 404: the 404 is honest.
//
// So a redirect is emitted only when the two names actually agree:
//   - identical document name under a different directory  (/x.html -> /insights/x.html)
//   - identical descriptive slug after `family-serial-`     (trt-003-injections -> trt-022-injections)
//   - the named route is the target's stem                  (trt-002.html -> trt-002-how-to-....html)
function documentName(route) {
  const parts = String(route || '').replace(/\/$/, '').split('/');
  return (parts[parts.length - 1] || '').replace(/\.html$/i, '').toLowerCase();
}
function descriptiveSlug(name) {
  const m = String(name || '').match(/^([a-z]+(?:-[a-z]+)*)-(\d{2,})-(.+)$/i);
  return m ? { family: m[1].toLowerCase(), descriptive: m[3].toLowerCase() } : null;
}
function aliasNamesSameSubject(named, target) {
  // Directory section routes were already emitted safely before .html was allowed:
  // resolveDistinctiveSection() only resolves those when exactly one sibling matches a
  // non-generic token, so /dentistry/pediatric-dentistry/ -> /dentistry/pediatric-family/
  // is a synonym the resolver proved, not a coincidence. The subject test exists for
  // the class this change newly admits - serial-numbered insight documents, where two
  // unrelated pages routinely share a number.
  if (!/\.html$/i.test(named) && !/\.html$/i.test(target)) return true;
  const a = documentName(named);
  const b = documentName(target);
  if (!a || !b) return false;
  if (a === b) return true;
  const da = descriptiveSlug(a);
  const db = descriptiveSlug(b);
  if (da && db && da.family === db.family && da.descriptive === db.descriptive) return true;
  if (b.startsWith(`${a}-`)) return true;
  return false;
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
  // Insight documents are published pages too. Without them every .html alias target
  // looked like a route this repo does not publish, and was skipped.
  const addIfOnDisk = (route) => {
    const file = route.replace(/^\//, '');
    if (file && fs.existsSync(rel(file))) realRoutes.add(route);
  };
  for (const entry of ledger.entries) {
    addIfOnDisk(toRoute(entry.implementation_path || ''));
    addIfOnDisk(toRoute(entry.intended_winner_page || ''));
  }
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

  // THE LEDGER IS NOT THE ONLY PLACE A TESTED URL IS RECORDED.
  //
  // A ledger row keeps one named target per repaired page. A run names many more, and
  // an absorption check asks about all of them: /insights/trt-002.html and
  // /uscis-medical/community-questionswhat-is-the-uscis-medical-exam-and-who-performs-it/
  // were both reported by runs, both resolve cleanly through the route resolver, both
  // were repaired - and both went on returning 404 at the address the agent tested,
  // because nothing ever projected the resolver's answer into _redirects for them.
  //
  // So every named target in every normalized run is resolved here too. The same three
  // safety rules apply as below: never shadow a real page, never point at a page this
  // repo does not publish, and never bridge two different subjects.
  const namedFromRuns = [];
  const runsDir = rel(NORMALIZED);
  if (fs.existsSync(runsDir)) {
    for (const file of fs.readdirSync(runsDir).sort()) {
      if (!file.endsWith('.json')) continue;
      const run = readJson(`${NORMALIZED}/${file}`, { records: [] });
      for (const row of run.records || []) {
        const raw = row.repo_file_path || row.intended_winner_page || row.target_url || '';
        if (!raw) continue;
        namedFromRuns.push(raw);
      }
    }
  }
  const mismatched = [];
  const runAliases = [];
  const seenRaw = new Set();
  for (const raw of namedFromRuns) {
    if (seenRaw.has(raw)) continue;
    seenRaw.add(raw);
    const namedRoute = toRoute(raw);
    if (!namedRoute || !isEmittableRoute(namedRoute)) continue;
    if (fs.existsSync(rel(namedRoute.replace(/^\//, '')))) continue;      // already served
    if (fs.existsSync(rel(`${namedRoute.replace(/^\//, '')}index.html`))) continue;
    let verdict;
    try { verdict = resolveTargetPath({ value: raw }); } catch { continue; }
    if (!verdict || verdict.block_reason) continue;
    const resolved = normalizeImplementationPath(verdict.implementation_path || '');
    if (!resolved || !fs.existsSync(rel(resolved))) continue;
    runAliases.push({ named: namedRoute, target: toRoute(resolved) });
  }
  for (const entry of ledger.entries) {
    const target = toRoute(entry.implementation_path || '');
    if (!target) continue;
    // resolver_aliases carries every URL the agent named for this page, including the
    // ones a ledger merge would otherwise have overwritten.
    const namedCandidates = [...new Set([
      entry.intended_winner_page || entry.intended_winner_path || '',
      ...(entry.resolver_aliases || [])
    ].map(toRoute).filter(Boolean))];
    for (const named of namedCandidates) {
    examined += 1;
    if (named === target) continue;
    if (!isEmittableRoute(named) || !isEmittableRoute(target)) { rejected.push(named); continue; }
    if (!aliasNamesSameSubject(named, target)) { mismatched.push(`${named} -> ${target}`); continue; }
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
  }

  // Rule 0: this must not be able to exit 0 having looked at nothing. Zero entries
  // examined means the ledger is empty or shaped differently than assumed, and a
  // silent success there is exactly how "runs but inert" hides.
  if (examined === 0) {
    console.error(`AGENT ALIAS REDIRECT SYNC FAIL: examined zero ledger entries with both a named and a resolved route; refusing to report success on an empty loop.`);
    process.exit(1);
  }

  // Same emission rules, second source.
  for (const { named, target } of runAliases) {
    examined += 1;
    if (!named || !target || named === target) continue;
    if (!isEmittableRoute(named) || !isEmittableRoute(target)) { rejected.push(named); continue; }
    if (!aliasNamesSameSubject(named, target)) { mismatched.push(`${named} -> ${target}`); continue; }
    if (realRoutes.has(named)) continue;
    if (!realRoutes.has(target)) continue;
    if (!existing.has(named)) {
      const record = {
        source_path: named,
        target_path: target,
        status: 'ACTIVE_301',
        reason: 'URL named and tested by a landed citation run; the route resolver canonicalizes it to the published page, so the tested URL resolves instead of 404ing.',
        evidence: ['_redirects', NORMALIZED, 'scripts/lib/citation_route_resolver.js']
      };
      retirements.retirements.push(record);
      existing.set(named, record);
      recorded.push(`${named} -> ${target}`);
    }
    if (!servedSources.has(named)) { servedSources.add(named); added.push(`${named} -> ${target}`); }
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
  console.log(`AGENT ALIAS REDIRECT SYNC PASS: examined ${examined} named target(s); served ${added.length} new alias 301(s); recorded ${recorded.length} in the authority file; rejected ${rejected.length} non-route value(s); refused ${mismatched.length} alias(es) whose named and resolved routes are different subjects.`);
  for (const line of mismatched) console.log(`  REFUSED (different subject): ${line}`);
  for (const line of rejected) console.log(`  REJECTED (not a route): ${String(line).slice(0, 120)}`);
  for (const line of added) console.log(`  ${line}`);
}

main();
