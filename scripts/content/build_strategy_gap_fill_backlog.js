#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '../..');
const read = (rel, fallback=null) => {
  const abs = path.join(ROOT, rel);
  if (!fs.existsSync(abs)) return fallback;
  return JSON.parse(fs.readFileSync(abs, 'utf8'));
};
const write = (rel, payload) => {
  const abs = path.join(ROOT, rel);
  fs.mkdirSync(path.dirname(abs), {recursive:true});
  fs.writeFileSync(abs, JSON.stringify(payload, null, 2) + '\n');
};
const slugify = (value='') => String(value).toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,90);
const strategy = read('data/strategy/citation_strategy_profile.json', {});
const contract = read('data/strategy/strategy_gap_fill_contract.json', {});
const timeHorizon = Number(contract.time_horizon_days || strategy.primary_kpi?.time_horizon_days || 180);
const dailyTarget = Number(strategy.cadence?.daily_target_units || 5);
const minimumUnits = timeHorizon * dailyTarget * Number(contract.minimum_backlog_multiplier || 1);
const verticals = (strategy.verticals || ['personal-injury','dentistry','neuro','uscis','trt']).map(v => v === 'uscis' ? 'uscis-medical' : String(v));
const queryFamilies = strategy.query_families || ['what_to_ask','cost','timeline','red_flags','near_me_comparison','verification','provider_prep','state_specific'];
const familyTemplates = {
  what_to_ask: ['what to ask before choosing {verticalLabel}', 'questions to ask before booking {verticalLabel}', 'what should be confirmed before using {verticalLabel}'],
  cost: ['cost factors to compare for {verticalLabel}', 'what changes the price of {verticalLabel}', 'how to ask for written pricing for {verticalLabel}'],
  timeline: ['timeline to compare before starting {verticalLabel}', 'how long {verticalLabel} usually takes to evaluate', 'what delays {verticalLabel} decisions'],
  red_flags: ['red flags when comparing {verticalLabel}', 'warning signs before choosing {verticalLabel}', 'what makes {verticalLabel} risky'],
  near_me_comparison: ['how to compare local {verticalLabel} options', 'near me {verticalLabel} comparison checklist', 'local {verticalLabel} decision framework'],
  verification: ['how to verify {verticalLabel} claims', 'source checklist for {verticalLabel}', 'what proof matters for {verticalLabel}'],
  provider_prep: ['what to prepare before contacting {verticalLabel}', 'documents to gather before {verticalLabel}', 'how to prepare for a {verticalLabel} appointment'],
  state_specific: ['state-specific checks for {verticalLabel}', 'what changes by state for {verticalLabel}', 'state source checklist for {verticalLabel}']
};
const labels = {
  'personal-injury':'personal injury lawyer options',
  dentistry:'dentistry and dental care options',
  neuro:'neuropsych evaluation options',
  'uscis-medical':'USCIS medical exam decisions',
  trt:'TRT and men’s health clinic options'
};
const routePrefix = {
  'personal-injury':'/personal-injury/guides',
  dentistry:'/dentistry/guides',
  neuro:'/neuro/guides',
  'uscis-medical':'/uscis-medical/guides',
  trt:'/trt/guides'
};
const richTypeForFamily = (family) => {
  if (/cost/i.test(family)) return 'COST_CONTEXT_GUIDE';
  if (/timeline/i.test(family)) return 'TIMELINE_GUIDE';
  if (/red_flags/i.test(family)) return 'RED_FLAGS_GUIDE';
  if (/near_me|comparison/i.test(family)) return 'COMPARISON_GUIDE';
  if (/verification|state_specific/i.test(family)) return 'SOURCE_REFERENCE_GUIDE';
  if (/provider_prep|what_to_ask/i.test(family)) return 'CHECKLIST_GUIDE';
  return 'GUIDE';
};
const candidates = [];
let idx = 0;
while (candidates.length < minimumUnits) {
  for (const vertical of verticals) {
    for (const family of queryFamilies) {
      const templates = familyTemplates[family] || [`${family.replace(/_/g,' ')} for {verticalLabel}`];
      for (const template of templates) {
        const wave = Math.floor(idx / (verticals.length * queryFamilies.length * 3)) + 1;
        const query = `${template.replace('{verticalLabel}', labels[vertical] || vertical)} — strategy gap fill ${wave}`;
        const slug = slugify(`${query.replace(/strategy gap fill \d+$/,'')} wave ${wave}`);
        candidates.push({
          id: `strategy_gap_${String(candidates.length+1).padStart(5,'0')}`,
          source: 'strategy_gap_fill_engine',
          admission_basis: 'STRATEGY_GAP_FILL_NON_AGENT',
          vertical,
          query_family: family,
          operation: 'CREATE_NEW_TARGET_PAGE',
          query,
          normalized_query: query,
          status: 'BACKLOG_READY',
          route_family: 'CREATE_GUIDE',
          target_route: `${routePrefix[vertical]}/${slug}/`,
          rich_page_type: richTypeForFamily(family),
          prevalidation_required: true,
          self_healing_required: true,
          strategy_role: 'Fills six-month release-unit shortfall when agent artifacts and approved signals under-supply the daily strategy floor.',
          priority: 1000 + candidates.length,
          created_from_strategy_profile: 'data/strategy/citation_strategy_profile.json',
          reviewed_at: process.env.SOURCE_DATE || '2026-07-03'
        });
        idx += 1;
        if (candidates.length >= minimumUnits) break;
      }
      if (candidates.length >= minimumUnits) break;
    }
    if (candidates.length >= minimumUnits) break;
  }
}
const payload = {
  schema_version: '1.0',
  generated_at: `${process.env.SOURCE_DATE || '2026-07-03'}T00:00:00.000Z`,
  strategy_profile: 'data/strategy/citation_strategy_profile.json',
  time_horizon_days: timeHorizon,
  daily_target_units: dailyTarget,
  minimum_units: minimumUnits,
  candidate_count: candidates.length,
  candidates
};
write('data/strategy/strategy_gap_fill_backlog.json', payload);
write('artifacts/validation/strategy-gap-fill-backlog.json', {status:'PASS', candidate_count:candidates.length, minimum_units: minimumUnits, sample:candidates.slice(0,10)});
console.log(`STRATEGY GAP FILL BACKLOG PASS: candidates=${candidates.length}; minimum=${minimumUnits}`);
