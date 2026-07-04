#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '../..');
const { routePage } = require('../lib/page_family_router');
const { validateAuthorityRecord } = require('../lib/page_family_authority');
const out = (rel, data) => { const p = path.join(ROOT, rel); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, JSON.stringify(data, null, 2) + '\n'); };
const verticals = ['personal-injury', 'dentistry', 'trt', 'neuro', 'uscis-medical'];
const cases = [
  { kind: 'repair', operation: 'REPAIR_INTENDED_WINNER_PAGE', query: 'repair existing intended winner page', target_route: '/insights/sample-existing-page.html', renderedPath: 'insights/sample-existing-page.html' },
  { kind: 'community', query: 'how do I compare a local provider near me before booking' },
  { kind: 'guide', query: 'requirements checklist for the main appointment' },
  { kind: 'cluster', query: 'source hub cluster for decision support' },
  { kind: 'blocked', status: 'BLOCKED_UNSAFE', blocked_reason: 'fixture blocked candidate', query: 'blocked unsupported request' }
];
const errors = [];
const results = [];
for (const vertical of verticals) {
  for (const c of cases) {
    if (c.kind === 'blocked') { results.push({ vertical, kind: c.kind, status: 'BLOCKED_FIXTURE_NOT_ROUTED' }); continue; }
    const decision = routePage({ ...c, vertical, admission_basis: 'fixture', route_authority: 'artifact_admitted', source: 'batch_f_fixture' });
    const record = { id: `${vertical}:${c.kind}`, source: 'batch_f_fixture', route: decision.target_route, renderedPath: decision.renderedPath, vertical, route_vertical: vertical === 'personal-injury' ? 'personal_injury' : vertical, route_family: decision.family || decision.route_family, route_shape: decision.route_shape, route_authority: decision.route_authority, admission_basis: decision.admission_basis, status: decision.status, operation: c.operation || 'CREATE_NEW_TARGET_PAGE', has_source: true };
    const recordErrors = validateAuthorityRecord(record, { route_shapes: ['community_question', 'guide', 'cluster', 'state_family', 'insight_html', 'legacy_index_html', 'vertical_hub'] });
    if (recordErrors.length) errors.push(...recordErrors.map((e) => `fixture:${e}`));
    if (c.kind === 'guide' && decision.family !== 'CREATE_GUIDE') errors.push(`guide_fixture_not_guide:${vertical}:${decision.family}:${decision.target_route}`);
    if (c.kind === 'cluster' && decision.family !== 'CREATE_CLUSTER') errors.push(`cluster_fixture_not_cluster:${vertical}:${decision.family}:${decision.target_route}`);
    results.push({ vertical, kind: c.kind, decision });
  }
}
const report = { schema_version: '1.0', validator: 'dynamic-page-contract-cross-vertical', status: errors.length ? 'FAIL' : 'PASS', verticals, cases_checked: results.length, results, errors };
out('artifacts/validation/dynamic-page-contract-cross-vertical.json', report);
if (errors.length) { console.error(JSON.stringify(report, null, 2)); process.exit(1); }
console.log(`dynamic-page-contract-cross-vertical PASS (${results.length} fixture case(s))`);
