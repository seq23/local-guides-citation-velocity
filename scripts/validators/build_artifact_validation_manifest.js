#!/usr/bin/env node
'use strict';
const fs=require('fs'),path=require('path'),crypto=require('crypto');
const ROOT=path.resolve(__dirname,'../..');
const hash=f=>crypto.createHash('sha256').update(fs.readFileSync(path.join(ROOT,f))).digest('hex');
let files=[
 'README.md','REPO_IDENTITY.md','AGENTS.md','_repo_update_contract.json','_repo_lifecycle_profile.json','_repo_validation_matrix.json','_validation_registry.json','_browser_suite_contract.json','_public_route_manifest.json','_baseline_packaging_contract.json','package.json','package-lock.json','wrangler.toml',
 'content/_staged/pages.json','content/_live/pages.json','content/_live/insights.json','content/_live/published_urls.json','content/_shared/executable_files.json',
 'data/page_families/velocity_page_specs.json','data/evidence/source_registry.json','data/evidence/state_source_registry.json','data/evidence/claim_registry.json','data/content/page_admission_registry.json','data/content/programmatic_content_standard.json','data/routing/canonical_destination_registry.json','data/overhaul/full_scope_overhaul_contract.json','data/overhaul/page_family_registry.json','data/overhaul/page_disposition_registry.json',
 'data/citation_velocity/recommendations.json','data/citation_velocity/runs.json','data/citation_velocity/wins.json','data/citation_velocity/page_acceptance_registry.json','data/citation_velocity/source_ownership_registry.json',
 'data/providers/provider_substrate_contract.json','data/providers/provider_registry.json','data/authority/reviewer_registry.json','data/authority/verified_same_as_registry.json',
 'data/network/network_identity_registry.json','data/network/crawler_policy.json','data/seo/backlink_evidence_registry.json','data/seo/search_submission_registry.json','data/measurement/llm_query_panel.json','data/measurement/citation_honesty_scoreboard.json','data/measurement/zero_dollar_citation_test_ledger.json','data/measurement/free_win_self_heal_queue.json','data/measurement/observed_external_citation_evidence.json','data/release/page_release_contract.json','data/release/route_retirements.json','data/strategy/citation_dominance_contract.json','data/strategy/citation_dominance_gap_registry.json','data/strategy/citation_strategy_profile.json','data/strategy/max_fanout_surfacing_contract.json','data/strategy/citation_growth_strategy.json','data/queries/citation_fanout_opportunities_100k/index.json','_citation_intelligence_contract.json','_content_release_contract.json','data/signals/source_registry.json','data/signals/source_health.json','data/signals/firehose_ledger.json','data/signals/fixtures/raw_signals.json','data/content/atom_registry.json','data/content/atom_type_contract.json',
 'seo/disavow/theindustryguides.com-disavow.txt','seo/disavow/source/operator_README.md','seo/disavow/source/operator_theindustryguides.com-disavow.txt','seo/disavow/source/source_package.sha256',
 'scripts/build_site.js','scripts/lib/publish_contract.js','scripts/citation_intelligence/build_100k_citation_runway.js','scripts/validators/validate_phase_tree_hygiene.js','scripts/validators/validate_network_crawler_contract.js','scripts/validators/validate_strategy_integrity_contract.js','scripts/velocity_content_release.js','scripts/validation/run_validation_registry.js','scripts/validation/validate_validation_registry.js','scripts/validators/validate_velocity_only_overhaul.js','scripts/validators/validate_citation_velocity_master_plan.js','scripts/validators/validate_citation_dominance_strategy.js','scripts/validators/validate_search_quality_basics.js','scripts/validators/validate_deterministic_build.js',
 '.github/workflows/validate-repo.yml','.github/workflows/velocity-content-release.yml','.github/workflows/daily-citation-intelligence.yml','.github/workflows/velocity-full-rebuild.yml','.github/workflows/deploy-distribution.yml','.github/workflows/postdeploy-public-audit.yml',
 'index.html','sitemap.xml','robots.txt','llms.txt','_redirects',
 'docs/strategy/THEINDUSTRYGUIDES_CITATION_DOMINANCE_IMPLEMENTATION.md','docs/strategy/TRAFFIC_QUALIFIED_CITATION_VELOCITY_6MO_PLAN.md','docs/runbooks/STRUCTURAL_GRAPH_LIVE_POLICY.md','docs/runbooks/WORKFLOW_YAML_TOPOLOGY.md','docs/runbooks/100k_180_day_citation_velocity.md','docs/architecture/ADR-2026-06-19-02-VELOCITY-ONLY.md','docs/overhaul/VELOCITY_ONLY_FULL_SCOPE_OVERHAUL.md','docs/runbooks/README.md','data/community/index_manifest.json','scripts/community/update_indexes.js','scripts/validators/validate_social_content_loop.js',
 'artifacts/validation/strategy-integrity-contract.json','artifacts/validation/citation-dominance-strategy.json','artifacts/validation/citation-strategy-gate.json','artifacts/validation/citation-100k-runway.json','artifacts/validation/local-guides-tree-hygiene.json','artifacts/validation/fixture-signal-trace.json','artifacts/validation/daily-citation-release-plan.json','artifacts/validation/daily-proof-packet.json','artifacts/validation/workflow-yaml-inventory.json',
 'artifacts/validation/validation-summary-core.json','artifacts/validation/validation-summary-canonical-data.json','artifacts/validation/validation-summary-advisory.json','artifacts/validation/determinism.json','artifacts/validation/repo-hygiene.json',
 'artifacts/release/VALIDATION_SIMPLIFICATION_REPORT.md','artifacts/release/VALIDATOR_HOSTILE_REVIEW.md','artifacts/release/VALIDATOR_HOSTILE_REVIEW.json','artifacts/release/STRATEGY_ALIGNMENT_MATRIX.md','artifacts/release/STRATEGY_ALIGNMENT_MATRIX.json','artifacts/release/VELOCITY_ONLY_OVERHAUL_EXECUTION_REPORT.md','artifacts/release/VELOCITY_ONLY_MASTER_PLAN_COMPLETION_CHECKLIST.md','artifacts/release/VELOCITY_ONLY_MASTER_PLAN_COMPLETION_CHECKLIST.json','artifacts/release/SEARCH_SUBMISSION_MANIFEST.json','artifacts/release/GSC_BING_RESUBMISSION_RUNBOOK.md','artifacts/release/HOSTILE_REVIEW_FINAL.md','artifacts/release/HOSTILE_REVIEW_FINAL.json','artifacts/release/FUTURE_PAGE_APPEND_PROOF.json','artifacts/validation/workflow-data-trace.md'
,
 'docs/SOURCE_AUTHORITY.md','docs/authority/LISTINGS_CANONICAL_MASTER_INDEX_v3.md','SYSTEM_MAP_PLAIN_ENGLISH.md','IMPLEMENTATION_STATUS.md','VALIDATION_AND_HANDOFF.md','ROLLBACK.md','ENVIRONMENT_AND_SECRETS_GUIDE.md','docs/DAY_0_OPERATOR_GUIDE.md',
 'data/release/baseline_provenance.json','data/release/frozen_page_registry.json','data/strategy/page_strategy_registry.json','data/strategy/page_opportunity_backlog.json','data/release/page_release_queue.json',
 'data/workflows/workflow_contract_registry.json','data/strategy/generated_content_finalization_contract.json','scripts/validators/validate_generated_content_finalization_contract.js','scripts/validators/validate_controlled_release_readiness.js','scripts/validators/validate_velocity_intake_workflow.js','scripts/lib/frozen_pages.js','scripts/frozen_pages.js','scripts/lib/sharded_json.js','scripts/content/build_page_opportunity_backlog.js','scripts/content/build_page_release_queue.js','scripts/release/promote_staged_content.js','scripts/release/finalize_content_release.js','scripts/release/bootstrap_live_content.js','scripts/verify_baseline_snapshot.js','scripts/make_baseline_snapshot.sh','scripts/create_store_zip.rb','scripts/build_pages_dist.js','scripts/strategy/build_citation_strategy_gate.js','scripts/citation_velocity/prepare_velocity_intake_release.js','scripts/citation_velocity/apply_agent_exact_implementation_plan.js','scripts/lib/agent_exact_repairs.js','scripts/lib/content_atom.js','scripts/validators/validate_page_release_law.js','docs/PAGE_RELEASE_LAW.md','docs/runbooks/ZIP_APPLY_CHEAT_GUIDE.md','docs/runbooks/REPOSITORY_UPDATE_RUNBOOK.md','CONTENT_OR_PUBLISHING_WORKFLOW.md','PROOF_MATRIX.md','REAL_VS_FIXTURE_DATA_GUIDE.md','WORKFLOW_AUTOMATION_MAP.md','artifacts/release/VELOCITY_LISTINGS_HARDENING_2026-07-24.md','artifacts/release/VELOCITY_LISTINGS_HARDENING_2026-07-24.json'
];
// Dynamic release-critical sets: every 100K shard and every frozen accepted-output cache blob.
const shardIndexPath=path.join(ROOT,'data/queries/citation_fanout_opportunities_100k/index.json');
if(fs.existsSync(shardIndexPath)){
 const idx=JSON.parse(fs.readFileSync(shardIndexPath,'utf8'));
 files.push(...(idx.shards||[]).map((s)=>s.path));
}
const frozenRegistryPath=path.join(ROOT,'data/release/frozen_page_registry.json');
if(fs.existsSync(frozenRegistryPath)){
 const reg=JSON.parse(fs.readFileSync(frozenRegistryPath,'utf8'));
 files.push(...(reg.pages||[]).map((r)=>r.cache_file).filter(Boolean));
}
files=[...new Set(files)].sort();
const missing=files.filter(f=>!fs.existsSync(path.join(ROOT,f)));
if(missing.length){console.error(`missing release files: ${missing.join(', ')}`);process.exit(1);}
const critical=files.map(f=>({path:f,sha256:hash(f),size_bytes:fs.statSync(path.join(ROOT,f)).size}));
const sourceSha=crypto.createHash('sha256').update(critical.map(x=>`${x.path}:${x.sha256}`).join('\n')).digest('hex');
const data={
 schema_version:'2.0',
 repo:'local-guides-citation-velocity-main',
 status:'VELOCITY_LISTINGS_HARDENED_STRUCTURALLY_CHECKED_LOCAL_VALIDATION_REQUIRED',
 generated_at:`${process.env.SOURCE_DATE||new Date().toISOString().slice(0,10)}T00:00:00.000Z`,
 source_sha256:sourceSha,
 release_critical_files:critical,
 zip_checks:{integrity:'REOPEN_AND_TEST_FINAL_ARCHIVE',wrapper:'local-guides-citation-velocity-main',exclusions:['.git','node_modules','.env','.env.*','.build','artifacts/validation/runtime','*.log','*.zip'],hashes:'REOPEN_FINAL_ARCHIVE_AND_VERIFY_EVERY_RELEASE_CRITICAL_FILE_PLUS_FINAL_ARCHIVE_SHA256'}
};
fs.writeFileSync(path.join(ROOT,'_artifact_validation_manifest.json'),JSON.stringify(data,null,2)+'\n');
fs.mkdirSync(path.join(ROOT,'artifacts/validation'),{recursive:true});
fs.writeFileSync(path.join(ROOT,'artifacts/validation/artifact-manifest.json'),JSON.stringify({validator:'artifact-manifest',ok:true,file_count:files.length,generated_at:data.generated_at},null,2)+'\n');
console.log(`ARTIFACT MANIFEST BUILT (${files.length} release-critical files)`);
