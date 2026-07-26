#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
const ROOT=process.cwd();
const read=(p,f)=>{try{return JSON.parse(fs.readFileSync(path.join(ROOT,p),'utf8'));}catch{return f;}};
const write=(p,v)=>{const f=path.join(ROOT,p);fs.mkdirSync(path.dirname(f),{recursive:true});fs.writeFileSync(f,JSON.stringify(v,null,2)+'\n');};
const contract=read('data/authority_scale/citation_yield_contract.json',null);
if(!contract) throw new Error('missing citation_yield_contract.json');
const ledger=read('data/authority_scale/citation_yield_observations.json',{events:[]});
const events=Array.isArray(ledger.events)?ledger.events:[];
const validTypes=new Set(contract.event_types||[]);
const counts=Object.fromEntries((contract.event_types||[]).map(t=>[t,0]));
let invalid=0, verifiedWithProof=0;
for(const e of events){ if(!e||!validTypes.has(e.event_type)){invalid++;continue;} counts[e.event_type]++; if(e.event_type==='verified_external_citation'&&e.provider&&e.observed_at&&e.surfaced_url&&e.query_or_prompt&&e.evidence_ref) verifiedWithProof++; }
const target=Number(contract.objective?.stretch_target||100000); const windowDays=Number(contract.objective?.window_days||180);
const remaining=Math.max(0,target-verifiedWithProof); const requiredDaily=remaining/windowDays;
const current=Number(contract.publication_budget?.current_starting_ceiling_per_day||0); const tiers=contract.publication_budget?.scale_tiers||[]; const idx=tiers.indexOf(current); const next=idx>=0&&idx<tiers.length-1?tiers[idx+1]:null;
const scoreboard={schema_version:'1.0',generated_at:(process.env.AUTHORITY_RUN_AT||events.map(e=>e.observed_at).filter(Boolean).sort().at(-1)||(contract.effective_date+'T00:00:00.000Z')),repo_id:contract.repo_id,objective:contract.objective,twin_agent_enabled:Boolean(contract.twin_agent?.enabled),observed_counts:counts,verified_external_citations_with_required_evidence:verifiedWithProof,invalid_or_unknown_events:invalid,remaining_to_stretch_target:remaining,required_average_verified_citations_per_day_if_starting_now:Number(requiredDaily.toFixed(2)),current_new_url_ceiling_per_day:current,next_tier:next,next_tier_eligible:false,next_tier_reason:'HOLD_UNTIL_EXTERNAL_YIELD_AND_INDEXATION_EVIDENCE_SUPPORT_UPSHIFT',decision_policy:{prefer_existing_repair_when:'an existing page is a strong intent match and a specific evidence-backed improvement is available',create_new_url_when:'intent is materially distinct, the surface is not already covered, and the page can meet substance/duplication/source gates'},truth_note:'This scoreboard does not infer citations from fanout, pages, indexation, search impressions, or LLM mentions.'};
write('data/authority_scale/citation_yield_scoreboard.json',scoreboard); console.log(JSON.stringify(scoreboard,null,2));
