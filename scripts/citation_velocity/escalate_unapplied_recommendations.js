#!/usr/bin/env node
'use strict';
// One open issue per page whose recommendations have missed ESCALATE_AFTER releases running;
// the issue is rewritten each release and closed by the release that finally lands them.
const { execFileSync } = require('child_process');
const { escalated, ESCALATE_AFTER, LEDGER_REL } = require('../lib/recommendation_retry_ledger');

const LABEL = 'unapplied-recommendation';
const TITLE_PREFIX = 'Recommendation not landing: ';
const repo = process.env.GITHUB_REPOSITORY || 'seq23/local-guides-citation-velocity';

function gh(args) { return execFileSync('gh', [...args, '-R', repo], { encoding: 'utf8' }); }
const cell = (s) => String(s || '').replace(/\|/g, '\\|').replace(/\s+/g, ' ').slice(0, 160);

const byPage = new Map();
for (const e of escalated()) {
  if (!byPage.has(e.page)) byPage.set(e.page, []);
  byPage.get(e.page).push(e);
}

if (!process.env.GH_TOKEN && !process.env.GITHUB_TOKEN) {
  const msg = `ESCALATION: no GH_TOKEN, so ${byPage.size} page(s) at ${ESCALATE_AFTER}+ missed releases were not raised as issues.`;
  if (process.env.GITHUB_ACTIONS) { console.error(msg); process.exit(1); }
  console.log(msg);
  process.exit(0);
}

gh(['label', 'create', LABEL, '--color', 'D93F0B', '--description', `Agent recommendation missed its page ${ESCALATE_AFTER}+ releases running`, '--force']);
const open = JSON.parse(gh(['issue', 'list', '--label', LABEL, '--state', 'open', '--limit', '500', '--json', 'number,title']));
const openByPage = new Map(open.filter((i) => i.title.startsWith(TITLE_PREFIX)).map((i) => [i.title.slice(TITLE_PREFIX.length), i.number]));

let created = 0; let updated = 0; let closed = 0;
for (const [page, rows] of byPage) {
  rows.sort((a, b) => b.attempts - a.attempts || a.query.localeCompare(b.query));
  const body = [
    `The release lane has worked these recommendations for \`${page}\` in ${ESCALATE_AFTER} or more releases and they are still not on the page. Retrying has stopped fixing them. The next release retries them first; this issue closes itself once they land.`,
    '',
    '| Query | Run | Missed releases | First missed | Why it did not land |',
    '|---|---|---|---|---|',
    ...rows.map((r) => `| ${cell(r.query)} | ${r.run_date} ${r.vertical} | ${r.attempts} | ${r.first_missed} | ${cell(r.reason)} |`),
    '',
    `Source: \`${LEDGER_REL}\`.`
  ].join('\n');
  const number = openByPage.get(page);
  if (number) { gh(['issue', 'edit', String(number), '--body', body]); updated += 1; }
  else { gh(['issue', 'create', '--title', `${TITLE_PREFIX}${page}`, '--label', LABEL, '--body', body]); created += 1; }
}
for (const [page, number] of openByPage) {
  if (byPage.has(page)) continue;
  gh(['issue', 'close', String(number), '--comment', `Cleared: every escalated recommendation for \`${page}\` is now on the page.`]);
  closed += 1;
}
console.log(`ESCALATION: ${byPage.size} page(s) at ${ESCALATE_AFTER}+ missed releases; issues created ${created}, updated ${updated}, closed ${closed}.`);
