#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '../..');
const { classifyRichNewPage, requiresRichAuthorityPage } = require('../lib/rich_new_page_classifier');
const out = (rel, data) => { const p = path.join(ROOT, rel); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, JSON.stringify(data, null, 2) + '\n'); };
const read = (rel, fallback = null) => { try { return JSON.parse(fs.readFileSync(path.join(ROOT, rel), 'utf8')); } catch { return fallback; } };
const live = read('content/_live/pages.json', { pages: [] });
const staged = read('content/_staged/pages.json', { pages: [] });
const created = read('artifacts/validation/velocity-content-release.json', { created: [] });
const approval = read('data/community/approval_queue.json', []);
const html = read('artifacts/validation/html-report-contract.json', {});
const pages = [...(live.pages || []), ...(staged.pages || [])];
const byRoute = new Map(pages.map((p) => [p.path || p.slug, p]));
const errors = [];
const checked = [];
const targetRows = [];
for (const row of created.created || []) targetRows.push({ id: row.id, route: row.route, source: 'velocity-content-release' });
for (const row of Array.isArray(approval) ? approval : []) {
  if (String(row.admission_basis || '').includes('HTML_REPORT_CONTRACT_PAGE_TO_BUILD') && row.target_route && (String(row.source_run_id || '').includes('2026-07-03') || String(row.source_artifacts?.manifest || '').includes('2026-07-03'))) targetRows.push({ id: row.id, route: row.target_route, source: 'approval_queue', query: row.query, rich_page_type: row.rich_page_type, route_family: row.route_family, source_run_id: row.source_run_id, source_artifacts: row.source_artifacts });
}
for (const row of Array.isArray(html.page_specs) ? html.page_specs : []) {
  if (row.target_route && (String(row.source_run_id || '').includes('2026-07-03') || String(row.source_artifacts?.manifest || '').includes('2026-07-03'))) targetRows.push({ id: row.id, route: row.target_route, source: 'html_report_contract', query: row.query, rich_page_type: row.rich_page_type, route_family: row.route_family, source_run_id: row.source_run_id, source_artifacts: row.source_artifacts });
}
const dedupedRows = [...new Map(targetRows.map((row) => [row.route, row])).values()]
  .filter((row) => {
    const rich = row.rich_page_type || classifyRichNewPage(row).rich_page_type;
    return requiresRichAuthorityPage(rich) || /\/(guides|clusters)\//.test(String(row.route || ''));
  });
for (const row of dedupedRows) {
  const page = byRoute.get(row.route);
  if (!page) { errors.push(`created_page_missing:${row.route}`); continue; }
  const richType = page.rich_page_type || classifyRichNewPage(page).rich_page_type;
  const sections = Array.isArray(page.sections) ? page.sections : [];
  const text = JSON.stringify(page).toLowerCase();
  if (requiresRichAuthorityPage(richType) && page.page_family === 'CREATE_COMMUNITY_QA') errors.push(`rich_page_downgraded_to_community_qa:${row.route}:${richType}`);
  if (requiresRichAuthorityPage(richType) && sections.length < 6) errors.push(`rich_page_too_thin:${row.route}:${richType}:${sections.length}`);
  for (const phrase of ['direct answer', 'source basis', 'why this page exists']) {
    if (!text.includes(phrase)) errors.push(`rich_page_missing_block:${row.route}:${phrase}`);
  }
  if (!page.content_atom) errors.push(`rich_page_missing_content_atom:${row.route}`);
  if (!page.admission_basis || !page.route_authority) errors.push(`rich_page_missing_admission_metadata:${row.route}`);
  checked.push({ route: row.route, rich_page_type: richType, page_family: page.page_family, sections: sections.length });
}
const report = { schema_version: '1.0', validator: 'rich-new-page-contract', status: errors.length ? 'FAIL' : 'PASS', checked_count: checked.length, checked, errors };
out('artifacts/validation/rich-new-page-contract.json', report);
if (errors.length) { console.error(JSON.stringify(report, null, 2)); process.exit(1); }
console.log(`rich-new-page-contract PASS (${checked.length} created page(s))`);
