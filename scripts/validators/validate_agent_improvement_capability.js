#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '../..');
const { classifyRichNewPage } = require('../lib/rich_new_page_classifier');
const read = (rel, fallback = null) => { try { return JSON.parse(fs.readFileSync(path.join(ROOT, rel), 'utf8')); } catch { return fallback; } };
const out = (rel, data) => { const p = path.join(ROOT, rel); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, JSON.stringify(data, null, 2) + '\n'); };
const contract = read('_agent_improvement_capability_contract.json', null);
const errors = [];
const required = ['APPEND_SECTION','ADD_DIRECT_ANSWER_BLOCK','ADD_CHECKLIST','ADD_COMPARISON_TABLE','ADD_TIMELINE','ADD_STEP_BY_STEP_PROCESS','ADD_REQUIREMENTS_BREAKDOWN','ADD_RED_FLAGS_SECTION','FIX_404_ROUTE','RESTORE_MISSING_PAGE','CREATE_GUIDE_PAGE','CREATE_CHECKLIST_PAGE','CREATE_COMPARISON_GUIDE','CREATE_TIMELINE_GUIDE','CREATE_PROCESS_GUIDE','CREATE_EDGE_CASE_GUIDE','CREATE_SOURCE_BACKED_REFERENCE_PAGE','CREATE_COMMUNITY_QA_PAGE','QUARANTINE_UNSAFE_RECOMMENDATION','ESCALATE_UNSUPPORTED_IMPROVEMENT'];
if (!contract) errors.push('improvement_capability_contract_missing');
else for (const primitive of required) if (!contract.allowed_improvement_primitives?.includes(primitive)) errors.push(`missing_improvement_primitive:${primitive}`);
const samples = [
  ['requirements checklist for the appointment','checklist_guide'],
  ['civil surgeon vs regular doctor comparison','comparison_guide'],
  ['what happens at the exam step by step','process_guide'],
  ['adjustment of status timeline','timeline_guide'],
  ['can I use an old I-693 for a new application','edge_case_guide'],
  ['what vaccines are required for the USCIS medical exam','source_backed_reference']
];
const sample_results = [];
for (const [query, expected] of samples) {
  const got = classifyRichNewPage({ query, why_worth_building: query });
  sample_results.push({ query, expected, got });
  if (got.rich_page_type !== expected) errors.push(`sample_mapping_failed:${query}:${got.rich_page_type}:${expected}`);
}
const report = { schema_version: '1.0', validator: 'agent-improvement-capability', status: errors.length ? 'FAIL' : 'PASS', sample_results, errors };
out('artifacts/validation/agent-improvement-capability.json', report);
if (errors.length) { console.error(JSON.stringify(report, null, 2)); process.exit(1); }
console.log('agent-improvement-capability PASS');
