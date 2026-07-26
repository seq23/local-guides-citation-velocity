#!/usr/bin/env node
import fs from 'node:fs';
const read=p=>JSON.parse(fs.readFileSync(p,'utf8'));
const c=read('data/authority_scale/citation_yield_contract.json'); const l=read('data/authority_scale/citation_yield_observations.json'); const s=read('data/authority_scale/citation_yield_scoreboard.json'); const d=read('data/authority_scale/velocity_decision.json'); const h=read('data/authority_scale/velocity_health.json');
const errors=[]; const twinAllowed=new Set(['local-guides-citation-velocity','sprylabs-hpc-site']);
if(c.objective?.stretch_target!==100000||c.objective?.window_days!==180||c.objective?.target_is_guarantee!==false)errors.push('objective_contract');
if(Boolean(c.twin_agent?.enabled)!==twinAllowed.has(c.repo_id))errors.push('twin_scope_violation');
if(!c.publication_budget?.unified_new_url_budget)errors.push('unified_budget_missing');
for(const e of (l.events||[])){if(e.event_type==='verified_external_citation'&&!(e.provider&&e.observed_at&&e.surfaced_url&&e.query_or_prompt&&e.evidence_ref))errors.push('verified_citation_missing_evidence');}
if(Number(s.verified_external_citations_with_required_evidence||0)!==(l.events||[]).filter(e=>e.event_type==='verified_external_citation'&&e.provider&&e.observed_at&&e.surfaced_url&&e.query_or_prompt&&e.evidence_ref).length)errors.push('scoreboard_truth_mismatch');
if(!Array.isArray(c.page_quality_patterns)||c.page_quality_patterns.length<7)errors.push('page_quality_contract_too_weak');
if(!['HOLD','UPSHIFT_ONE_TIER','DOWNSHIFT_ONE_TIER'].includes(d.decision))errors.push('velocity_decision_invalid');
if(Object.values(h).includes('UNKNOWN')&&d.decision==='UPSHIFT_ONE_TIER')errors.push('velocity_upshift_on_unknown_health');
if(Object.values(h).includes('UNKNOWN')&&Number(d.recommended_new_url_ceiling_per_day)!==Number(d.current_new_url_ceiling_per_day))errors.push('velocity_changed_with_unknown_health');
if(!Array.isArray(d.configured_scale_tiers)||!d.configured_scale_tiers.includes(Number(d.recommended_new_url_ceiling_per_day)))errors.push('velocity_recommendation_outside_tiers');

if(errors.length){console.error('CITATION YIELD CONTRACT FAIL',errors);process.exit(1);} console.log(`CITATION YIELD CONTRACT PASS: repo=${c.repo_id}; twin=${Boolean(c.twin_agent?.enabled)}; verified=${s.verified_external_citations_with_required_evidence}`);
