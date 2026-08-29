#!/usr/bin/env node
'use strict';
const L=require('../search_intelligence/lib');const errors=[];const provider=L.readJson('data/search_intelligence/provider_truth_snapshot.json');const allowed=new Set(L.loadContract().provider_states);for(const [k,p] of Object.entries(provider.providers||{})){if(!allowed.has(p.state))errors.push(`provider_state:${k}:${p.state}`);if((p.state==='NOT_CONFIGURED'||p.state==='INCONCLUSIVE')&&p.state==='PASS')errors.push(`fake_green:${k}`);}// Rule 0: a truth validator that examined no providers has proved nothing.
if(!Object.keys(provider.providers||{}).length)errors.push('provider_truth_snapshot_examined_zero_providers');
const cites=L.readJson('data/search_intelligence/verified_external_citations.json',{events:[]});for(const e of cites.events||[])if(!L.verifyCitationEvent(e))errors.push(`citation_missing_evidence:${e.event_id||'unknown'}`);const outcomes=L.readJson('data/search_intelligence/retest_outcomes.json',{outcomes:[]});for(const o of outcomes.outcomes||[]){if(!L.loadContract().retest_outcomes.includes(o.outcome))errors.push(`bad_outcome:${o.outcome}`);if(o.outcome==='IMPROVED'&&(!o.before_external_evidence||!o.after_external_evidence))errors.push(`improved_without_before_after:${o.repair_id}`);}const receipts=L.readJson('data/search_intelligence/repair_receipts.json',{repairs:[]});for(const r of receipts.repairs||[]){if(r.status==='APPLIED'&&(!r.before_sha256||!r.after_sha256||r.before_sha256===r.after_sha256))errors.push(`applied_without_real_mutation:${r.repair_id}`);if(r.rollback_eligible&&!r.rollback_snapshot)errors.push(`rollback_without_snapshot:${r.repair_id}`);}const h=L.readJson('data/search_intelligence/automation_health.json');
// The fake-green guard, pointed at the states that are actually written.
//
// This was `if(h.state==='GREEN'&&!h.last_validated_sha)errors.push('automation_fake_green')`.
// scripts/search_intelligence/ci_health_alert.js writes 'RECOVERED' or 'RED' and
// never 'GREEN' (its own header says so), and initEmpty seeds 'UNPROVEN'. So the
// one guard standing between this repo and a green CI badge with nothing behind it
// governed a state no writer could produce - dead code that could never fire on the
// value it was written to catch. The guard now names the green state that IS
// written, and any state no writer emits is itself a hard failure, so the two ends
// cannot drift apart in silence again.
const WRITTEN_HEALTH_STATES=new Set(['UNPROVEN','RECOVERED','RED']);
if(!h||typeof h.state!=='string'||!h.state)errors.push('automation_health_state_missing');
else if(!WRITTEN_HEALTH_STATES.has(h.state))errors.push(`automation_health_state_never_written:${h.state}`);
if(h&&h.state==='RECOVERED'&&!h.last_validated_sha)errors.push('automation_fake_green');
// A recovery supersedes the failure it recovered from. A RECOVERED record still
// carrying the red run's URL describes a green state pointing at a red run.
if(h&&h.state==='RECOVERED'&&h.failure_run_url)errors.push('automation_recovered_still_pointing_at_failure_run');
if(h&&h.state==='RED'&&!h.last_failure_sha)errors.push('automation_red_without_failure_sha');const report={validator:'search-intelligence-truth',status:errors.length?'FAIL':'PASS',verified_external_citations:(cites.events||[]).length,retest_outcomes:(outcomes.outcomes||[]).length,errors};L.writeJson('artifacts/validation/search-intelligence-truth.json',report);if(errors.length){console.error(errors.join('\n'));process.exit(1);}console.log(`SEARCH INTELLIGENCE TRUTH PASS: citations=${report.verified_external_citations}`);
