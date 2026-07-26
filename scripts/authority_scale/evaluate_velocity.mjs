#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
const ROOT=process.cwd();
const read=(p,f)=>{try{return JSON.parse(fs.readFileSync(path.join(ROOT,p),'utf8'));}catch{return f;}};
const write=(p,v)=>{const f=path.join(ROOT,p);fs.mkdirSync(path.dirname(f),{recursive:true});fs.writeFileSync(f,JSON.stringify(v,null,2)+'\n');};
const contract=read('data/authority_scale/citation_yield_contract.json',{});
const governor=read('data/authority_scale/velocity_governor.json',{});
const scoreboard=read('data/authority_scale/citation_yield_scoreboard.json',{});
const health=read('data/authority_scale/velocity_health.json',{
  schema_version:'1.0',as_of:null,validation_status:'UNKNOWN',semantic_duplicate_status:'UNKNOWN',distribution_status:'UNKNOWN',indexation_status:'UNKNOWN',observed_yield_trend:'UNKNOWN',source_claim_status:'UNKNOWN',minimum_yield_events_for_upshift:10
});
const current=Number(governor.current_default_new_page_ceiling_per_day ?? contract.publication_budget?.current_starting_ceiling_per_day ?? 0);
const tiers=(governor.scale_tiers||contract.publication_budget?.scale_tiers||[]).map(Number).filter(Number.isFinite);
const idx=Math.max(0,tiers.indexOf(current));
const prev=idx>0?tiers[idx-1]:current;
const next=idx>=0&&idx<tiers.length-1?tiers[idx+1]:null;
const counts=scoreboard.observed_counts||{};
const yieldEvents=Number(counts.llm_linked_citation||0)+Number(counts.external_backlink_or_reference||0)+Number(counts.verified_external_citation||0);
const hardFailures=[];
if(health.validation_status==='FAIL') hardFailures.push('validation_failure');
if(['FAIL','REGRESSION'].includes(health.semantic_duplicate_status)) hardFailures.push('semantic_duplicate_regression');
if(['FAIL','DEGRADED'].includes(health.distribution_status)) hardFailures.push('distribution_failure');
if(['FAIL','DEGRADED','BACKLOGGED'].includes(health.indexation_status)) hardFailures.push('indexation_degradation');
if(health.source_claim_status==='FAIL') hardFailures.push('source_or_claim_failure');
const good = health.validation_status==='PASS' && health.semantic_duplicate_status==='CLEAN' && health.distribution_status==='HEALTHY' && health.indexation_status==='HEALTHY' && ['STABLE','IMPROVING'].includes(health.observed_yield_trend) && ['PASS','NOT_APPLICABLE'].includes(health.source_claim_status) && yieldEvents>=Number(health.minimum_yield_events_for_upshift||10);
let decision='HOLD',recommended=current,reasons=[];
if(hardFailures.length){decision='DOWNSHIFT_ONE_TIER';recommended=prev;reasons=hardFailures;}
else if(good&&next!==null){decision='UPSHIFT_ONE_TIER';recommended=next;reasons=['all_explicit_health_gates_pass','minimum_observed_yield_met'];}
else {reasons=['insufficient_explicit_evidence_for_upshift']; if(next===null) reasons.push('already_at_highest_configured_tier');}
const out={schema_version:'1.0',generated_at:scoreboard.generated_at||contract.effective_date+'T00:00:00.000Z',repo_id:contract.repo_id||null,current_new_url_ceiling_per_day:current,configured_scale_tiers:tiers,decision,recommended_new_url_ceiling_per_day:recommended,next_tier:next,previous_tier:prev,hard_failure_reasons:hardFailures,decision_reasons:reasons,health_snapshot:health,observed_yield_events_for_velocity_gate:yieldEvents,automatic_safety_law:'Unknown or incomplete evidence always holds the current tier. Explicit failure can downshift. Upshift requires every configured health gate plus observed yield evidence.'};
write('data/authority_scale/velocity_decision.json',out);
const synchronizedScoreboard={...scoreboard,next_tier_eligible:decision==='UPSHIFT_ONE_TIER',next_tier_reason:reasons.join('|'),velocity_decision:decision,recommended_new_url_ceiling_per_day:recommended};
write('data/authority_scale/citation_yield_scoreboard.json',synchronizedScoreboard);
console.log(JSON.stringify(out,null,2));
