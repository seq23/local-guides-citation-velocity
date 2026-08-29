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
// HALT_AT_FLOOR is a real decision. The three-decision list below could not express
// "stop publishing": the tier ladder had no zero, so a hard failure at the lowest
// tier emitted DOWNSHIFT_ONE_TIER with recommended === current and the release lane
// carried on at full rate. 0 is now a configured tier and a floor halt is a named
// decision of its own.
if(!['HOLD','UPSHIFT_ONE_TIER','DOWNSHIFT_ONE_TIER','HALT_AT_FLOOR'].includes(d.decision))errors.push('velocity_decision_invalid');
if(Object.values(h).includes('UNKNOWN')&&d.decision==='UPSHIFT_ONE_TIER')errors.push('velocity_upshift_on_unknown_health');
// "Do not move the ceiling on unknown evidence" - with one direction excepted.
// The rule was written when a downshift could not actually move the ceiling (the
// tier ladder had no rung below 2), so it never had to distinguish directions. Now
// that a hard failure really does lower the ceiling, an explicit FAIL alongside
// other still-UNKNOWN gates was tripping this as if the brake were an unevidenced
// change. An explicit named failure is evidence, and a DOWNWARD move on it is the
// safe direction. Upward movement on unknown health remains an error, and so does
// any move with no named failure behind it.
const velocityHardFailures=Array.isArray(d.hard_failure_reasons)?d.hard_failure_reasons:[];
const velocityMovedDown=Number(d.recommended_new_url_ceiling_per_day)<Number(d.current_new_url_ceiling_per_day);
if(Object.values(h).includes('UNKNOWN')&&Number(d.recommended_new_url_ceiling_per_day)!==Number(d.current_new_url_ceiling_per_day)&&!(velocityHardFailures.length&&velocityMovedDown))errors.push('velocity_changed_with_unknown_health');
// Rule 0: an empty tier ladder means every membership assertion below passes on an
// empty loop, which is the defect they exist to catch.
if(!Array.isArray(d.configured_scale_tiers)||d.configured_scale_tiers.length===0)errors.push('velocity_no_configured_tiers');
if(!Array.isArray(d.configured_scale_tiers)||!d.configured_scale_tiers.includes(Number(d.recommended_new_url_ceiling_per_day)))errors.push('velocity_recommendation_outside_tiers');
// The ceiling actually in force must itself be a configured tier. Only the
// recommendation was checked, so a current ceiling nobody configured passed silently
// while the evaluator rounded it to the floor with Math.max(0, indexOf(...)).
if(!Array.isArray(d.configured_scale_tiers)||!d.configured_scale_tiers.includes(Number(d.current_new_url_ceiling_per_day)))errors.push('velocity_current_ceiling_outside_tiers');
// A declared brake must actually move the ceiling. DOWNSHIFT_ONE_TIER with
// recommended === current is exactly the reported-but-not-applied brake that let a
// hard validation failure publish at full rate.
if(d.decision==='DOWNSHIFT_ONE_TIER'&&!(Number(d.recommended_new_url_ceiling_per_day)<Number(d.current_new_url_ceiling_per_day)))errors.push('downshift_did_not_downshift');
if(d.decision==='HALT_AT_FLOOR'&&Number(d.recommended_new_url_ceiling_per_day)!==0)errors.push('halt_at_floor_without_zero_ceiling');
// A hard failure must be visible as a reduced ceiling, whatever the decision string
// says. This is the assertion that would have caught the original defect on the data
// alone, without reading the evaluator.
// HALT_AT_FLOOR is the one case where recommended === current is correct: the
// ceiling is already 0 and there is nothing left to reduce.
if(Array.isArray(d.hard_failure_reasons)&&d.hard_failure_reasons.length&&!(Number(d.recommended_new_url_ceiling_per_day)<Number(d.current_new_url_ceiling_per_day))&&!(d.decision==='HALT_AT_FLOOR'&&Number(d.recommended_new_url_ceiling_per_day)===0))errors.push('hard_failure_did_not_reduce_ceiling');
if(Array.isArray(d.hard_failure_reasons)&&d.hard_failure_reasons.length&&!['DOWNSHIFT_ONE_TIER','HALT_AT_FLOOR'].includes(d.decision))errors.push('hard_failure_without_brake_decision');

if(errors.length){console.error('CITATION YIELD CONTRACT FAIL',errors);process.exit(1);} console.log(`CITATION YIELD CONTRACT PASS: repo=${c.repo_id}; twin=${Boolean(c.twin_agent?.enabled)}; verified=${s.verified_external_citations_with_required_evidence}`);
