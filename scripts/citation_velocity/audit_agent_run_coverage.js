#!/usr/bin/env node
/* eslint-disable no-console */
'use strict';
/**
 * Per-run delivery coverage for every landed agent run.
 *
 * agent-fix-ledger-truthfulness answers one question: does a row that CLAIMS a
 * released status show on its page? That guard is scoped to the claim. It says
 * nothing about a run's delivery as a whole, and — this is the part that matters —
 * a row demoted out of RELEASED_VERIFIED by the registered repair leaves the
 * truthfulness guard's field of view entirely. Draining the untruthful backlog
 * therefore makes the guard quieter without a single marker reaching a page.
 *
 * This audit closes that hole by measuring the run, not the claim:
 *
 *   declared   every ledger row for the run, whatever its status
 *   actionable rows that can be checked at all - a rendered file that exists on
 *              disk and at least one declared required_marker
 *   rendered   actionable rows whose every required_marker is present in that file
 *   coverage   rendered / actionable
 *
 * Rows that are not actionable are NOT quietly dropped: they are counted and
 * itemised as gaps under their own reason (rendered_file_missing,
 * no_required_markers, no_rendered_path), because an unverifiable claim is
 * unproven, not proven.
 *
 * --live re-asks the question of the reader rather than the tree. The repo is not
 * the site: a marker committed but not deployed is not delivered, and 15 of the 18
 * orphans found in this repo on 2026-09-02 were linked only from routes answering
 * 301, so every in-repo check saw a link no crawler receives. In --live mode each
 * distinct gap page is fetched from the public host and the missing markers are
 * re-checked against the bytes the server actually returns.
 *
 * Rule 0: examining zero rows is a FAILURE, not a clean sheet.
 */

const fs = require('fs');
const path = require('path');
const { auditFix } = require('../validators/validate_agent_fix_ledger_truthfulness');

const ROOT = path.resolve(__dirname, '../..');
const LEDGER_REL = 'data/report_fixes/agent_fix_ledger.json';
const PUBLISHED_REL = 'content/_live/published_urls.json';
const OUT_REL = 'artifacts/validation/agent-run-coverage-audit.json';
const LIVE_OUT_REL = 'artifacts/validation/agent-run-coverage-live.json';
const HOST = process.env.COVERAGE_AUDIT_HOST || 'https://theindustryguides.com';
const UNVERIFIABLE = new Set(['no_rendered_path', 'rendered_file_missing', 'no_required_markers']);

function readJson(rel, fallback) {
  try { return JSON.parse(fs.readFileSync(path.join(ROOT, rel), 'utf8')); } catch { return fallback; }
}
function writeJson(rel, value) {
  fs.mkdirSync(path.join(ROOT, path.dirname(rel)), { recursive: true });
  fs.writeFileSync(path.join(ROOT, rel), `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

/**
 * The public URL a rendered path is served at.
 *
 * Published inventory first, because the generator's own route table is the only
 * authority on how a file is exposed - /uscis-medical/index.html is served at
 * /uscis-medical/ and insight files are served extensionless. Guessing that
 * mapping is how an in-repo check ends up asserting a URL nobody is served.
 */
function buildUrlResolver() {
  const published = readJson(PUBLISHED_REL, { items: [] });
  const byPath = new Map();
  for (const item of published.items || []) {
    if (item && item.path && item.url) byPath.set(String(item.path), String(item.url));
  }
  return function resolve(renderedPath) {
    const rel = String(renderedPath || '').trim();
    if (!rel) return { url: '', mapping: 'none' };
    const direct = byPath.get(`/${rel}`);
    if (direct) return { url: direct, mapping: 'published_inventory' };
    if (rel.endsWith('/index.html')) {
      const dir = `/${rel.slice(0, -'index.html'.length)}`;
      const viaDir = byPath.get(dir);
      if (viaDir) return { url: viaDir, mapping: 'published_inventory' };
      return { url: `${HOST}${dir}`, mapping: 'derived_directory' };
    }
    return { url: `${HOST}/${rel}`, mapping: 'derived_file' };
  };
}

function decodeVariants(html) {
  return html.replace(/&#8212;/g, '—').replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&');
}
function markerPresent(html, marker) {
  const raw = String(marker);
  const decoded = decodeVariants(html);
  const encoded = raw.replace(/—/g, '&#8212;');
  return html.includes(raw) || decoded.includes(raw) || html.includes(encoded) || decoded.includes(encoded);
}

function collect() {
  const ledger = readJson(LEDGER_REL, null);
  if (!ledger || !Array.isArray(ledger.fixes)) {
    console.error(`AGENT RUN COVERAGE FAIL: ${LEDGER_REL} is missing or unreadable, so this audit examined zero rows. Coverage is UNKNOWN, not proven.`);
    process.exit(1);
  }
  if (!ledger.fixes.length) {
    console.error(`AGENT RUN COVERAGE FAIL: ${LEDGER_REL} holds zero rows. Refusing to report coverage off an empty loop.`);
    process.exit(1);
  }
  const resolve = buildUrlResolver();
  const runs = new Map();
  const gaps = [];
  const records = [];
  for (const fix of ledger.fixes) {
    const runDate = String(fix.run_date || '(undated)');
    if (!runs.has(runDate)) runs.set(runDate, { run_date: runDate, declared: 0, actionable: 0, rendered: 0, unverifiable: 0, gaps: 0 });
    const row = runs.get(runDate);
    row.declared += 1;
    const verdict = auditFix(fix);
    const unverifiable = UNVERIFIABLE.has(verdict.reason);
    if (unverifiable) row.unverifiable += 1;
    else {
      row.actionable += 1;
      if (!verdict.reason) row.rendered += 1;
    }
    const resolved = resolve(fix.renderedPath || '');
    records.push({
      run_date: runDate,
      id: fix.id,
      rendered_path: fix.renderedPath || '',
      public_url: resolved.url,
      repo_verdict: verdict.reason || 'rendered',
      actionable: !unverifiable,
      markers: (Array.isArray(fix.required_markers) ? fix.required_markers.filter(Boolean) : []).map(String),
    });
    if (!verdict.reason) continue;
    row.gaps += 1;
    gaps.push({
      run_date: runDate,
      id: fix.id,
      vertical: fix.vertical || '',
      implementation_status: String(fix.implementation_status || ''),
      rendered_path: fix.renderedPath || '',
      public_url: resolved.url,
      url_mapping: resolved.mapping,
      reason: verdict.reason,
      missing_markers: (verdict.missing || []).slice(0, 3),
    });
  }
  const table = [...runs.values()].sort((a, b) => a.run_date.localeCompare(b.run_date));
  for (const row of table) row.coverage_pct = row.actionable ? Number(((row.rendered / row.actionable) * 100).toFixed(1)) : 0;
  const totals = table.reduce((acc, row) => ({
    declared: acc.declared + row.declared,
    actionable: acc.actionable + row.actionable,
    rendered: acc.rendered + row.rendered,
    unverifiable: acc.unverifiable + row.unverifiable,
    gaps: acc.gaps + row.gaps,
  }), { declared: 0, actionable: 0, rendered: 0, unverifiable: 0, gaps: 0 });
  totals.coverage_of_actionable_pct = totals.actionable ? Number(((totals.rendered / totals.actionable) * 100).toFixed(1)) : 0;
  totals.coverage_of_declared_pct = Number(((totals.rendered / totals.declared) * 100).toFixed(1));
  totals.runs = table.length;
  return { ledger, table, gaps, totals, records };
}

function normalizePath(url) {
  try { return decodeURIComponent(new URL(url).pathname).replace(/\/+$/, '').toLowerCase(); } catch { return String(url); }
}

async function fetchPage(url) {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const res = await fetch(url, { redirect: 'follow', headers: { 'user-agent': 'the-industry-guides-coverage-audit/1.0' } });
      const body = await res.text();
      // A 200 reached only after the route moved you somewhere else is not this
      // page being served. 15 of the 18 orphans found here on 2026-09-02 were
      // linked only from routes answering 301, and every in-repo check read them
      // as live. Compare the paths, not the status code.
      const samePath = normalizePath(url) === normalizePath(res.url);
      return { status: res.status, final_url: res.url, bytes: body.length, html: body, redirected_away: !samePath, error: '' };
    } catch (err) {
      if (attempt) return { status: 0, final_url: url, bytes: 0, html: '', redirected_away: false, error: String((err && err.message) || err) };
    }
  }
  return { status: 0, final_url: url, bytes: 0, html: '', redirected_away: false, error: 'unreachable' };
}

async function live(state) {
  // Every record, not only the gaps. Checking the failures alone would leave the
  // 2,278 "rendered" rows resting on the tree, and the tree is not the site.
  const targets = [...new Set(state.records.map((rec) => rec.public_url).filter(Boolean))].sort();
  if (!targets.length) {
    console.error('AGENT RUN COVERAGE LIVE FAIL: zero URLs to fetch. A live check that fetches nothing has proven nothing.');
    process.exit(1);
  }
  const pages = new Map();
  const queue = targets.slice();
  const workers = Array.from({ length: 6 }, async () => {
    for (;;) {
      const url = queue.shift();
      if (!url) return;
      pages.set(url, await fetchPage(url));
    }
  });
  await Promise.all(workers);

  const liveRuns = new Map();
  const rows = state.records.map((rec) => {
    const page = pages.get(rec.public_url) || { status: 0, final_url: rec.public_url, bytes: 0, html: '', redirected_away: false, error: 'not_fetched' };
    const missingLive = page.status === 200 ? rec.markers.filter((marker) => !markerPresent(page.html, marker)) : rec.markers.slice();
    // Served and complete is the only PASS. Anything else is unproven or absent -
    // an unreachable URL is not a delivered recommendation.
    let verdict;
    if (page.status === 0) verdict = 'UNREACHABLE';
    else if (page.status !== 200) verdict = `NOT_SERVED_${page.status}`;
    else if (page.redirected_away) verdict = 'REDIRECTED_AWAY';
    else if (!rec.markers.length) verdict = 'SERVED_UNVERIFIABLE';
    else if (missingLive.length) verdict = 'ABSENT_LIVE';
    else verdict = 'RENDERED_LIVE';

    if (!liveRuns.has(rec.run_date)) liveRuns.set(rec.run_date, { run_date: rec.run_date, declared: 0, actionable_live: 0, rendered_live: 0 });
    const runRow = liveRuns.get(rec.run_date);
    runRow.declared += 1;
    if (verdict === 'RENDERED_LIVE' || verdict === 'ABSENT_LIVE') runRow.actionable_live += 1;
    if (verdict === 'RENDERED_LIVE') runRow.rendered_live += 1;

    return {
      run_date: rec.run_date,
      id: rec.id,
      rendered_path: rec.rendered_path,
      public_url: rec.public_url,
      repo_verdict: rec.repo_verdict,
      live_status: page.status,
      live_final_url: page.final_url,
      live_bytes: page.bytes,
      live_redirected_away: Boolean(page.redirected_away),
      live_error: page.error,
      live_verdict: verdict,
      live_missing_markers: missingLive.slice(0, 3),
    };
  });

  const verdicts = {};
  for (const row of rows) verdicts[row.live_verdict] = (verdicts[row.live_verdict] || 0) + 1;
  const statuses = {};
  for (const url of targets) { const s = pages.get(url).status; statuses[s] = (statuses[s] || 0) + 1; }

  // The two records disagreeing is the whole defect class. Name both directions.
  const repoRenderedNotLive = rows.filter((row) => row.repo_verdict === 'rendered' && row.live_verdict !== 'RENDERED_LIVE');
  const liveRenderedNotRepo = rows.filter((row) => row.repo_verdict !== 'rendered' && row.live_verdict === 'RENDERED_LIVE');

  const liveTable = [...liveRuns.values()].sort((a, b) => a.run_date.localeCompare(b.run_date));
  for (const row of liveTable) row.coverage_live_pct = row.actionable_live ? Number(((row.rendered_live / row.actionable_live) * 100).toFixed(1)) : 0;
  const liveTotals = liveTable.reduce((acc, row) => ({
    declared: acc.declared + row.declared,
    actionable_live: acc.actionable_live + row.actionable_live,
    rendered_live: acc.rendered_live + row.rendered_live,
  }), { declared: 0, actionable_live: 0, rendered_live: 0 });
  liveTotals.coverage_live_of_actionable_pct = liveTotals.actionable_live ? Number(((liveTotals.rendered_live / liveTotals.actionable_live) * 100).toFixed(1)) : 0;
  liveTotals.coverage_live_of_declared_pct = Number(((liveTotals.rendered_live / liveTotals.declared) * 100).toFixed(1));

  writeJson(LIVE_OUT_REL, {
    schema_version: '1.0',
    audit: 'agent-run-coverage-live',
    host: HOST,
    fetched_at: new Date().toISOString(),
    distinct_pages_fetched: targets.length,
    http_status_counts: statuses,
    records_checked: rows.length,
    verdict_counts: verdicts,
    live_totals: liveTotals,
    per_run_live: liveTable,
    repo_rendered_but_not_live_count: repoRenderedNotLive.length,
    repo_rendered_but_not_live: repoRenderedNotLive.slice(0, 200),
    live_rendered_but_not_in_repo_count: liveRenderedNotRepo.length,
    pages: targets.map((url) => ({ url, status: pages.get(url).status, final_url: pages.get(url).final_url, bytes: pages.get(url).bytes, redirected_away: Boolean(pages.get(url).redirected_away), error: pages.get(url).error })),
    gaps: rows.filter((row) => row.live_verdict !== 'RENDERED_LIVE'),
  });
  console.log(`AGENT RUN COVERAGE LIVE: fetched ${targets.length} distinct page(s) from ${HOST}; ${rows.length} record(s) re-checked against served bytes. ${JSON.stringify(verdicts)}`);
  console.log(`AGENT RUN COVERAGE LIVE: live coverage ${liveTotals.rendered_live}/${liveTotals.actionable_live} = ${liveTotals.coverage_live_of_actionable_pct}% of actionable (${liveTotals.coverage_live_of_declared_pct}% of declared); ${repoRenderedNotLive.length} row(s) the repo shows but the reader is not served -> ${LIVE_OUT_REL}`);
}

async function main() {
  const state = collect();
  writeJson(OUT_REL, {
    schema_version: '1.0',
    audit: 'agent-run-coverage',
    generated_at: new Date().toISOString(),
    ledger_updated_at: state.ledger.updated_at || '',
    totals: state.totals,
    per_run: state.table,
    gaps: state.gaps,
  });
  console.log(`AGENT RUN COVERAGE: ${state.totals.runs} run(s); declared ${state.totals.declared}, actionable ${state.totals.actionable}, rendered ${state.totals.rendered} (${state.totals.coverage_of_actionable_pct}% of actionable, ${state.totals.coverage_of_declared_pct}% of declared); ${state.totals.gaps} gap(s) -> ${OUT_REL}`);
  if (process.argv.includes('--table')) {
    console.log('run_date\tdeclared\tactionable\trendered\tcoverage%');
    for (const row of state.table) console.log(`${row.run_date}\t${row.declared}\t${row.actionable}\t${row.rendered}\t${row.coverage_pct}`);
  }
  if (process.argv.includes('--live')) await live(state);
}

main().catch((err) => { console.error(`AGENT RUN COVERAGE FAIL: ${(err && err.stack) || err}`); process.exit(1); });
