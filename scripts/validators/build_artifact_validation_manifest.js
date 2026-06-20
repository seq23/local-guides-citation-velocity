#!/usr/bin/env node
'use strict';
const fs=require('fs'),path=require('path'),crypto=require('crypto');
const ROOT=path.resolve(__dirname,'../..');
const hash=f=>crypto.createHash('sha256').update(fs.readFileSync(path.join(ROOT,f))).digest('hex');
const files=[
 'REPO_IDENTITY.md','AGENTS.md','_repo_update_contract.json','_repo_lifecycle_profile.json','_repo_validation_matrix.json','_validation_registry.json','_browser_suite_contract.json','_public_route_manifest.json','_baseline_packaging_contract.json','package.json','package-lock.json',
 'content/_staged/pages.json','content/_live/pages.json','content/_live/insights.json','content/_live/published_urls.json','content/_shared/executable_files.json',
 'data/page_families/velocity_page_specs.json','data/evidence/source_registry.json','data/evidence/state_source_registry.json','data/evidence/claim_registry.json','data/content/page_admission_registry.json','data/content/programmatic_content_standard.json','data/routing/canonical_destination_registry.json','data/overhaul/full_scope_overhaul_contract.json','data/overhaul/page_family_registry.json','data/overhaul/page_disposition_registry.json',
 'data/citation_velocity/recommendations.json','data/citation_velocity/runs.json','data/citation_velocity/wins.json','data/citation_velocity/page_acceptance_registry.json','data/citation_velocity/source_ownership_registry.json',
 'data/providers/provider_substrate_contract.json','data/providers/provider_registry.json','data/authority/reviewer_registry.json','data/authority/verified_same_as_registry.json',
 'data/network/network_identity_registry.json','data/network/crawler_policy.json','data/seo/backlink_evidence_registry.json','data/seo/search_submission_registry.json','data/measurement/llm_query_panel.json','data/release/page_release_contract.json','data/release/route_retirements.json','data/strategy/citation_dominance_contract.json','data/strategy/citation_dominance_gap_registry.json',
 'seo/disavow/theindustryguides.com-disavow.txt','seo/disavow/source/operator_README.md','seo/disavow/source/operator_theindustryguides.com-disavow.txt','seo/disavow/source/source_package.sha256',
 'scripts/build_site.js','scripts/lib/publish_contract.js','scripts/validators/validate_network_crawler_contract.js','scripts/validators/validate_strategy_integrity_contract.js','scripts/velocity_content_release.js','scripts/validation/run_validation_registry.js','scripts/validation/validate_validation_registry.js','scripts/validators/validate_velocity_only_overhaul.js','scripts/validators/validate_citation_velocity_master_plan.js','scripts/validators/validate_citation_dominance_strategy.js','scripts/validators/validate_search_quality_basics.js','scripts/validators/validate_deterministic_build.js',
 '.github/workflows/validate.yml','.github/workflows/velocity_content_release.yml','.github/workflows/velocity_full_rebuild.yml','.github/workflows/release_batch.yml','.github/workflows/deploy-distribution.yml','.github/workflows/postdeploy_public_audit.yml',
 'index.html','sitemap.xml','robots.txt','llms.txt','_redirects',
 'docs/strategy/THEINDUSTRYGUIDES_CITATION_DOMINANCE_IMPLEMENTATION.md','docs/architecture/ADR-2026-06-19-02-VELOCITY-ONLY.md','docs/overhaul/VELOCITY_ONLY_FULL_SCOPE_OVERHAUL.md','docs/runbooks/README.md','data/community/index_manifest.json','scripts/community/update_indexes.js','scripts/validators/validate_social_content_loop.js',
 'artifacts/validation/strategy-integrity-contract.json','artifacts/validation/citation-dominance-strategy.json',
 'artifacts/validation/validation-summary-core.json','artifacts/validation/validation-summary-canonical-data.json','artifacts/validation/validation-summary-advisory.json','artifacts/validation/determinism.json','artifacts/validation/repo-hygiene.json',
 'artifacts/release/VALIDATION_SIMPLIFICATION_REPORT.md','artifacts/release/VALIDATOR_HOSTILE_REVIEW.md','artifacts/release/VALIDATOR_HOSTILE_REVIEW.json','artifacts/release/STRATEGY_ALIGNMENT_MATRIX.md','artifacts/release/STRATEGY_ALIGNMENT_MATRIX.json','artifacts/release/VELOCITY_ONLY_OVERHAUL_EXECUTION_REPORT.md','artifacts/release/VELOCITY_ONLY_MASTER_PLAN_COMPLETION_CHECKLIST.md','artifacts/release/VELOCITY_ONLY_MASTER_PLAN_COMPLETION_CHECKLIST.json','artifacts/release/SEARCH_SUBMISSION_MANIFEST.json','artifacts/release/GSC_BING_RESUBMISSION_RUNBOOK.md','artifacts/release/HOSTILE_REVIEW_FINAL.md','artifacts/release/HOSTILE_REVIEW_FINAL.json','artifacts/release/FUTURE_PAGE_APPEND_PROOF.json','artifacts/validation/workflow-data-trace.md'
];
const missing=files.filter(f=>!fs.existsSync(path.join(ROOT,f)));
if(missing.length){console.error(`missing release files: ${missing.join(', ')}`);process.exit(1);}
const critical=files.map(f=>({path:f,sha256:hash(f),size_bytes:fs.statSync(path.join(ROOT,f)).size}));
const sourceSha=crypto.createHash('sha256').update(critical.map(x=>`${x.path}:${x.sha256}`).join('\n')).digest('hex');
const data={
 schema_version:'2.0',
 repo:'local-guides-citation-velocity-main',
 status:'VELOCITY_ONLY_SOURCE_AND_RENDER_HASHED',
 generated_at:'2026-06-20T00:00:00.000Z',
 source_sha256:sourceSha,
 release_critical_files:critical,
 zip_checks:{integrity:'REOPEN_AND_TEST_FINAL_ARCHIVE',wrapper:'local-guides-citation-velocity-main',exclusions:['.git','node_modules','.env','.env.*','dist','reports','.build','artifacts/validation/runtime','*.log','*.zip'],hashes:'FINAL_ARCHIVE_SHA256_SIDECAR'}
};
fs.writeFileSync(path.join(ROOT,'_artifact_validation_manifest.json'),JSON.stringify(data,null,2)+'\n');
fs.mkdirSync(path.join(ROOT,'artifacts/validation'),{recursive:true});
fs.writeFileSync(path.join(ROOT,'artifacts/validation/artifact-manifest.json'),JSON.stringify({validator:'artifact-manifest',ok:true,file_count:files.length,generated_at:data.generated_at},null,2)+'\n');
console.log(`ARTIFACT MANIFEST BUILT (${files.length} release-critical files)`);
