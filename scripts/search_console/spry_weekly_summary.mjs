#!/usr/bin/env node
/**
 * THE SPRY LABS WEEKLY HAND-OFF (owner, 1 Nov 2026). The weekly search report no longer emails the
 * owner. This writes spry-weekly-summary.json (schema spry-weekly-summary-v1) from
 * reports/search_outcomes/<week>.json; the workflow uploads it as the artifact `spry-weekly-summary`
 * and Boss OS puts a short Industry Guides section into the one "Spry Labs weekly" email (Wednesdays
 * 08:15 Central). Facts only, per site: Boss OS words them and drops any property that is not hers.
 *
 *   node scripts/search_console/spry_weekly_summary.mjs <report.json> [out.json]
 *   node scripts/search_console/spry_weekly_summary.mjs --self-check
 */
import { readFileSync, writeFileSync } from 'node:fs';

const STATE = { GREEN: 'fine', WATCH: 'watch', RED: 'needs-a-look' };

export function summarise(report, runUrl = null) {
  const sites = (report?.sites ?? []).map((s) => ({
    host: s.host,
    state: STATE[s.verdict] ?? 'watch',
    why: s.reason ? [String(s.reason)] : [],
    clicks: s.current?.clicks ?? null,
    impressions: s.current?.impressions ?? null,
    prev_clicks: s.prior?.clicks ?? null,
    prev_impressions: s.prior?.impressions ?? null,
  }));
  if (sites.length === 0) throw new Error('NAMED STOP [NO_SITES] the weekly report covers no property; nothing to hand to Boss OS.');
  return {
    schema: 'spry-weekly-summary-v1', business: 'Search across the portfolio', week: report.week,
    generated_at: report.generated_at ?? new Date().toISOString(), run_url: runUrl, sites, notes: [],
  };
}

export function selfCheck() {
  const r = summarise({ week: '2026-W45', sites: [
    { host: 'a.example', verdict: 'GREEN', reason: 'impressions up (0 -> 5)', current: { clicks: 1, impressions: 5 }, prior: { clicks: 0, impressions: 0 } },
    { host: 'b.example', verdict: 'RED', reason: 'impressions down 60%' },
    { host: 'c.example', verdict: 'SOMETHING_NEW' },
  ] });
  if (r.sites[0].state !== 'fine' || r.sites[0].prev_impressions !== 0 || r.sites[1].state !== 'needs-a-look') throw new Error('self-check: summary is wrong');
  if (r.sites[2].state !== 'watch') throw new Error('self-check: an unknown verdict must read "watch", never "fine"');
  let refused = false;
  try { summarise({ week: 'x', sites: [] }); } catch { refused = true; }
  if (!refused) throw new Error('self-check: an empty report was handed on (rule 0)');
  console.log('spry_weekly_summary self-check: ok');
}

if (import.meta.url === `file://${process.argv[1]}` && process.argv[2] === '--self-check') selfCheck();
else if (import.meta.url === `file://${process.argv[1]}`) {
  const [input, out = 'spry-weekly-summary.json'] = process.argv.slice(2);
  const summary = summarise(JSON.parse(readFileSync(input, 'utf8')), process.env.RUN_URL ?? null);
  writeFileSync(out, `${JSON.stringify(summary, null, 2)}\n`);
  console.log(`spry weekly summary: ${summary.sites.length} site(s) -> ${out}`);
}
