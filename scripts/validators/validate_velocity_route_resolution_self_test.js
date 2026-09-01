#!/usr/bin/env node
'use strict';
const fs=require('fs');const path=require('path');const ROOT=path.resolve(__dirname,'../..');
const {resolveTargetPath, normalizeSlugComparable, similarityScore}=require('../lib/citation_route_resolver');
function writeJson(p,v){const out=path.join(ROOT,p);fs.mkdirSync(path.dirname(out),{recursive:true});fs.writeFileSync(out,JSON.stringify(v,null,2)+'\n')}
function firstHtml(){ const dirs=['insights','guides','near-me','compare']; for(const d of dirs){const abs=path.join(ROOT,d); if(!fs.existsSync(abs)) continue; const f=fs.readdirSync(abs).find(x=>x.endsWith('.html')); if(f) return `${d}/${f}`;} return 'index.html'; }
const existing=firstHtml();
const typo=existing.replace(/[aeiou]/i,'');
const exact=resolveTargetPath(existing);
const fuzzy=resolveTargetPath({value:typo, query:typo.replace(/[-/]/g,' '), operation:'REPAIR_INTENDED_WINNER_PAGE'});
const newPage=resolveTargetPath({value:'brand-new-agent-page-that-should-not-collapse', query:'brand new agent page that should not collapse into existing pages', operation:'CREATE_NEW_TARGET_PAGE'});
// THE FOUR SHAPES THE LANDED ARTIFACTS ACTUALLY CONTAIN.
//
// The four cases above are synthetic - an exact path, a typo of one, a brand-new
// target, a similarity score. None of them is a shape the external Citation Velocity
// agent emits. It emits whole recommendation lines, bullet-separated ones, and bare
// human titles, and until 2026-09-01 the resolver placed none of them: fifty named
// targets across five runs were written off as malformed source artifacts while every
// page they named sat in the repo. A self-test that only exercises inputs the pipeline
// never receives is the "runs but inert" defect in miniature.
//
// Each case is pinned to a real published page, so the shape is proven against the
// repo rather than against a fixture, and the case is skipped (never silently passed)
// if that page is not present.
const pinned=(p)=>fs.existsSync(path.join(ROOT,p))?p:'';
const shapeCases=[
 {name:'whole_recommendation_line_resolves', target:pinned('insights/trt-001-the-industry-guides-trt-clinic-evaluation-framework.html'),
  input:{value:'FILEPATH: insights/trt-001-the-industry-guides-trt-clinic-evaluation-framework.html || CURRENT: H2 "Decision Checklist" missing explicit comparison columns || EDIT: Add a table.', family:'trt'}},
 {name:'bullet_separated_line_resolves', target:pinned('personal-injury/index.html'),
  input:{value:'personal-injury/index.html &bull; INTENT: informational (awareness) &bull; DECISION: repair_existing', family:'personal-injury'}},
 {name:'bare_title_resolves_by_descriptive_slug', target:pinned('insights/trt-020-trt-and-sleep-apnea-what-to-ask.html'),
  input:{value:'TRT%20and%20Sleep%20Apnea:%20What%20to%20Ask', query:'can TRT worsen sleep apnea symptoms', family:'trt'}},
 {name:'family_breaks_a_cross_family_title_tie', target:pinned('insights/trt-013-does-insurance-cover-trt.html'),
  input:{value:'Does%20Insurance%20Cover%20TRT', query:'does insurance cover testosterone replacement therapy', family:'trt'}},
 // The name outranks its context: adding the query must never pull a resolvable name
 // onto a different page. This one regressed the 2026-07-31 USCIS run when the query
 // was folded into scoring unconditionally.
 {name:'query_context_does_not_override_a_resolvable_name', target:pinned('uscis-medical/community-questions/what-is-the-uscis-medical-exam-and-who-performs-it/index.html'),
  input:{value:'uscis-medical/community-questionswhat-is-the-uscis-medical-exam-and-who-performs-it/index.html', query:'can i go to my regular family doctor for the uscis medical exam', family:'uscis-medical'}}
].filter((c)=>c.target).map((c)=>{
 const result=resolveTargetPath(c.input);
 return {name:c.name, pass:!result.block_reason && result.implementation_path===c.target, expected:c.target, result};
});
if(!shapeCases.length){console.error('VELOCITY ROUTE RESOLUTION SELF TEST FAIL: not one pinned page is present; the shape cases examined nothing, which is not a pass.');process.exit(1)}
const tests=[...shapeCases,
 {name:'exact_existing_route', pass:!exact.block_reason && exact.implementation_path===existing, result:exact},
 {name:'misspelled_existing_route', pass:!fuzzy.block_reason && Boolean(fuzzy.implementation_path), result:fuzzy},
 {name:'new_page_guard_preserves_new_target', pass:!newPage.block_reason && /NEW_PAGE_TARGET_PRESERVED|EXACT_NEW_PAGE_DUPLICATE_EXISTS/.test(newPage.status), result:newPage},
 {name:'similarity_score_operational', pass:similarityScore('dentstry-guide','dentistry-guide')>=0.7, result:{score:similarityScore('dentstry-guide','dentistry-guide'), comparable:normalizeSlugComparable('Dentistry Guide')}}
];
const errors=tests.filter(t=>!t.pass).map(t=>`${t.name}:failed`);
const report={schema_version:'1.0',validator:'velocity-route-resolution-self-test',status:errors.length?'FAIL':'PASS',existing_fixture:existing,tests,errors};
writeJson('artifacts/validation/velocity-route-resolution-self-test.json',report);
if(errors.length){console.error(errors.join('\n'));process.exit(1)}
console.log(`VELOCITY ROUTE RESOLUTION SELF TEST PASS: ${tests.length} cases`);
