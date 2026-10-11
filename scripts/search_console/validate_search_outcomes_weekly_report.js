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
 * SEARCH_OUTCOMES_NOW (ISO timestamp) overrides the clock for proofs.
 */
const fs = require('fs');
const path = require('path');

const ROOT = process.cwd();
const DIR = 'reports/search_outcomes';
const errors = [];

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

const out = { validator: 'search-outcomes-weekly-report', ok: errors.length === 0, week, now: now.toISOString(),
  property_count: report && report.property_count, site_count: report && (report.sites || []).length, table_rows: tableRows, errors };
fs.mkdirSync(path.join(ROOT, 'artifacts/validation'), { recursive: true });
fs.writeFileSync(path.join(ROOT, 'artifacts/validation/search-outcomes-weekly-report.json'), JSON.stringify(out, null, 2) + '\n');
if (errors.length) {
  for (const e of errors) console.error(`SEARCH OUTCOMES WEEKLY FAIL: ${e}`);
  process.exit(1);
}
console.log(`SEARCH OUTCOMES WEEKLY PASS: ${week} covers ${out.site_count}/${out.property_count} properties (${tableRows} table rows)`);
