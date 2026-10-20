#!/usr/bin/env node
'use strict';
/**
 * The weekly search-outcome report exists for the week it is due, and it covers
 * every Search Console property the service account could read.
 *
 * search-outcomes-weekly.yml commits reports/search_outcomes/<ISO-week>.{md,json}
 * every Monday at 08:00 Chicago (13:00/14:00 UTC). The week this validator
 * requires is the ISO week of (now - 24h): all of Monday still requires LAST
 * week's report, so a PR opened at 01:00 UTC Monday is never red because the
 * scheduled run has not happened yet; from Tuesday 00:00 UTC on, this week's
 * report must be on main. A missing report then means the owner got no answer
 * to "is the search work helping" that week - the failure this guards.
 *
 * Site count must equal the property count the run recorded, in the JSON twin
 * and in the markdown table the owner reads: a report that silently drops a
 * property is a report that hides the one going wrong.
 *
 * Rule 0: zero properties, or no table rows, is a failure, never a pass.
 *
 * Free discovery (scripts/search_console/free_discovery.py, same workflow, after the
 * report): from 2026-W42 on, or for any report at schema 1.1+, the report carries a
 * `discovery` block and data/discovery/<week>/<host>.json exists for every property
 * that had seeds. Every candidate carries seed + source + status "unmeasured"; no
 * candidate is in data/discovery/measured_targets_snapshot.json (the portfolio's
 * target sets, demand families, measured targets and Search Console queries) or is
 * any property's seed; the receipt shows zero model calls, cost 0, and requests only
 * to the free hosts. Seeds with zero candidates from every source must carry a NAMED
 * STOP in the report the owner reads, never a silent pass.
 * SEARCH_OUTCOMES_NOW (ISO timestamp) overrides the clock for proofs.
 */
const fs = require('fs');
const path = require('path');

const ROOT = process.cwd();
const DIR = 'reports/search_outcomes';
const errors = [];
// The memphisseniorcarehomes.com search -> leads row (funnel columns, "no token" /
// "unavailable" never RED, RED on >= 20 clicks with 0 intake starts) is proved
// against a fixture response on every run; no network, no secret.
{
  const r = require('child_process').spawnSync('python3', ['-I', '-B', 'scripts/tests/test_senior_funnel_row.py'], { cwd: ROOT, encoding: 'utf8', env: { ...process.env, SENIOR_TICK_TOKEN: '' } });
  if (r.status !== 0) errors.push(`senior funnel row fixture test failed: ${(r.stderr || r.stdout || r.error || '').toString().trim().split('\n').slice(-3).join(' | ')}`);
}

function isoWeek(d) {
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((t - yearStart) / 86400000 + 1) / 7);
  return `${t.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

const now = process.env.SEARCH_OUTCOMES_NOW ? new Date(process.env.SEARCH_OUTCOMES_NOW) : new Date();
if (Number.isNaN(now.getTime())) errors.push(`SEARCH_OUTCOMES_NOW is not a date: ${process.env.SEARCH_OUTCOMES_NOW}`);
const week = isoWeek(new Date(now.getTime() - 24 * 3600 * 1000));
const jsonRel = `${DIR}/${week}.json`;
const mdRel = `${DIR}/${week}.md`;

let report = null;
if (!fs.existsSync(path.join(ROOT, jsonRel))) errors.push(`${jsonRel} missing: the weekly search-outcome report for ${week} was never committed (search-outcomes-weekly.yml)`);
else {
  try { report = JSON.parse(fs.readFileSync(path.join(ROOT, jsonRel), 'utf8')); } catch (e) { errors.push(`${jsonRel} unreadable: ${e.message}`); }
}
if (!fs.existsSync(path.join(ROOT, mdRel))) errors.push(`${mdRel} missing: the report the owner reads for ${week} was never committed`);

let tableRows = null;
if (report) {
  const n = report.property_count;
  const sites = Array.isArray(report.sites) ? report.sites : [];
  if (report.week !== week) errors.push(`${jsonRel} declares week ${report.week}, expected ${week}`);
  if (!Number.isInteger(n) || n <= 0) errors.push(`${jsonRel} property_count is ${n}: a report over zero properties measured nothing`);
  if (sites.length !== n) errors.push(`${jsonRel} has ${sites.length} sites but the account read ${n} properties`);
  const hosts = new Set(sites.map((s) => s.host));
  if (hosts.size !== sites.length) errors.push(`${jsonRel} lists a site more than once`);
  for (const s of sites) if (!['GREEN', 'WATCH', 'RED'].includes(s.verdict)) errors.push(`${jsonRel} ${s.host} has verdict ${s.verdict}`);
  if (fs.existsSync(path.join(ROOT, mdRel))) {
    const md = fs.readFileSync(path.join(ROOT, mdRel), 'utf8');
    tableRows = md.split('\n').filter((l) => /^\| [^|]+ \| [^|]* \| [^|]* \| [^|]* \| [^|]* \| (GREEN|WATCH|RED) \|/.test(l)).length;
    if (tableRows !== n) errors.push(`${mdRel} table has ${tableRows} site rows but the account read ${n} properties`);
  }
}

const FREE_HOSTS = new Set(['suggestqueries.google.com', 'www.google.com', 'www.reddit.com', 'raw.githubusercontent.com', 'api.github.com']);
const norm = (q) => String(q || '').toLowerCase().replace(/\u2019/g, "'").replace(/[^\w\s']/g, ' ').replace(/\s+/g, ' ').trim();
let discovery = null;
if (report && (week >= '2026-W42' || String(report.schema_version) !== '1.0')) {
  const d = report.discovery;
  const dir = `data/discovery/${week}`;
  discovery = { required: true, files: 0, candidates: 0 };
  const seeded = (report.sites || []).filter((s) => Array.isArray(s.seeds) && s.seeds.length);
  if (!d) errors.push(`${jsonRel} has no discovery block: free_discovery.py did not run after the report`);
  else {
    const r = d.receipt || {};
    if (r.model_calls !== 0) errors.push(`discovery receipt model_calls=${r.model_calls}: the step must make no model call`);
    if (r.cost_usd !== 0) errors.push(`discovery receipt cost_usd=${r.cost_usd}: nothing paid may run`);
    if ((r.refused_hosts || []).length) errors.push(`discovery tried non-free hosts: ${r.refused_hosts.join(', ')}`);
    for (const h of Object.keys(r.requests_by_host || {})) if (!FREE_HOSTS.has(h)) errors.push(`discovery called ${h}, not a free host`);
    if (d.properties_with_seeds !== seeded.length) errors.push(`discovery covered ${d.properties_with_seeds} properties but ${seeded.length} had seeds`);
    if (seeded.length && !d.candidate_count && !d.named_stop) errors.push('discovery found 0 candidates for seeded properties without a NAMED STOP: the step ran inert');
    if (d.named_stop && !(fs.existsSync(path.join(ROOT, mdRel)) && fs.readFileSync(path.join(ROOT, mdRel), 'utf8').includes(d.named_stop))) errors.push(`${mdRel} does not carry the discovery NAMED STOP the owner must see`);
    if (fs.existsSync(path.join(ROOT, mdRel)) && !/^Discovery: \d+ candidates for \d+ seeds/m.test(fs.readFileSync(path.join(ROOT, mdRel), 'utf8'))) errors.push(`${mdRel} has no Discovery summary line: the Monday email would not carry it`);
  }
  // Candidates are checked against the dedupe set of THEIR week (data/discovery/<week>/
  // measured_targets_snapshot.json). The top-level snapshot is rewritten by every run, so
  // on a Monday it already holds the new week's set; a query Google began measuring since
  // is a discovery that worked, not a dedupe failure (failed run 38293344697, 12 Oct 2026).
  // The top-level file stands in only when it declares this same week.
  let measured = null;
  const weekSnapRel = `${dir}/measured_targets_snapshot.json`;
  const topSnapRel = 'data/discovery/measured_targets_snapshot.json';
  const snapRel = fs.existsSync(path.join(ROOT, weekSnapRel)) ? weekSnapRel : topSnapRel;
  try {
    const snap = JSON.parse(fs.readFileSync(path.join(ROOT, snapRel), 'utf8'));
    if (snap.week !== week) errors.push(`${snapRel} is the dedupe set for ${snap.week}, not ${week}, and ${weekSnapRel} is missing: ${week}'s candidates cannot be checked`);
    else measured = new Set(snap.queries);
  } catch (e) { errors.push(`${snapRel} unreadable: ${e.message}`); }
  if (measured && measured.size === 0) errors.push(`${snapRel} is empty: dedupe compared against nothing`);
  const seedSet = new Set(seeded.flatMap((s) => s.seeds.map((x) => norm(x.query))));
  for (const s of seeded) {
    const rel = `${dir}/${s.host}.json`;
    if (!fs.existsSync(path.join(ROOT, rel))) { errors.push(`${rel} missing: ${s.host} had ${s.seeds.length} seeds`); continue; }
    let doc;
    try { doc = JSON.parse(fs.readFileSync(path.join(ROOT, rel), 'utf8')); } catch (e) { errors.push(`${rel} unreadable: ${e.message}`); continue; }
    discovery.files += 1;
    if (!doc.rule || !/cannot publish a page anywhere until Google shows an impression/.test(doc.rule)) errors.push(`${rel} does not carry the no-publish-until-impression rule`);
    if (!doc.questions_for_page || typeof doc.questions_for_page !== 'object') errors.push(`${rel} has no questions_for_page map`);
    for (const c of doc.candidates || []) {
      discovery.candidates += 1;
      if (!c.seed || !c.source) errors.push(`${rel} candidate "${c.query}" lacks seed or source`);
      if (c.status !== 'unmeasured') errors.push(`${rel} candidate "${c.query}" has status ${c.status}, expected unmeasured`);
      const n = norm(c.query);
      if ((measured && measured.has(n)) || seedSet.has(n)) errors.push(`${rel} candidate "${c.query}" is already a measured target`);
    }
  }
}

// The Monday run is the only writer of the report this gate requires. A failed
// Monday run with nothing to re-run it held main red for a week's report on
// 2026-10-20 (W43). The workflow must keep a Monday catch-up that fires before
// Tuesday 00:00 UTC and a daily catch-up, both guarded on the report being missing.
{
  const wf = fs.readFileSync(path.join(ROOT, '.github/workflows/search-outcomes-weekly.yml'), 'utf8');
  const crons = [...wf.matchAll(/cron:\s*"([^"]+)"/g)].map((m) => m[1]);
  const mondayCatchUp = crons.find((c) => { const [, h, , , dow] = c.split(/\s+/); return dow === '1' && h.split(',').some((x) => Number(x) > 14 && Number(x) <= 23); });
  const dailyCatchUp = crons.find((c) => { const dow = c.split(/\s+/)[4]; return dow === '0,2-6'; });
  if (!mondayCatchUp) errors.push('search-outcomes-weekly.yml has no Monday catch-up cron after 14:00 UTC: a failed Monday run leaves main red from Tuesday');
  if (!dailyCatchUp) errors.push('search-outcomes-weekly.yml has no daily (Sun, Tue-Sat) catch-up cron: a week that slipped is never repaired');
  for (const c of [mondayCatchUp, dailyCatchUp].filter(Boolean)) {
    if (!wf.includes(`"$SCHEDULE" = "${c}"`)) errors.push(`search-outcomes-weekly.yml catch-up cron "${c}" is not routed through the report-missing guard`);
  }
  if (!/contents\/reports\/search_outcomes\/\$week\.json\?ref=main/.test(wf)) errors.push('search-outcomes-weekly.yml catch-up guard does not check this week\'s report on main');
}

const out = { validator: 'search-outcomes-weekly-report', discovery, ok: errors.length === 0, week, now: now.toISOString(),
  property_count: report && report.property_count, site_count: report && (report.sites || []).length, table_rows: tableRows, errors };
fs.mkdirSync(path.join(ROOT, 'artifacts/validation'), { recursive: true });
fs.writeFileSync(path.join(ROOT, 'artifacts/validation/search-outcomes-weekly-report.json'), JSON.stringify(out, null, 2) + '\n');
if (errors.length) {
  for (const e of errors) console.error(`SEARCH OUTCOMES WEEKLY FAIL: ${e}`);
  process.exit(1);
}
console.log(`SEARCH OUTCOMES WEEKLY PASS: ${week} covers ${out.site_count}/${out.property_count} properties (${tableRows} table rows)` +
  (discovery ? `; discovery ${discovery.files} files, ${discovery.candidates} candidates, 0 paid calls` : '; discovery not yet due for this report'));
