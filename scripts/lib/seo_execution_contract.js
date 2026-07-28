'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '../..');
const POLICY = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/report_fixes/seo_execution_policy.json'), 'utf8'));
function text(v){ return String(v == null ? '' : v).replace(/\s+/g,' ').trim(); }
function arr(v){
  if (Array.isArray(v)) return v.filter(Boolean);
  if (v == null || v === '') return [];
  if (typeof v === 'string') { try { const p=JSON.parse(v); return Array.isArray(p)?p.filter(Boolean):[]; } catch { return []; } }
  return [];
}
function scope(v){ const k=text(v).toLowerCase().replace(/\s+/g,'-'); return POLICY.scope_aliases[k] || POLICY.scope_aliases[k.replace(/_/g,'-')] || k.replace(/-/g,'_'); }
function schemaAction(v){ const s=text(v).toLowerCase(); if(!s) return 'none'; if(/add/.test(s) && /(faq|howto|article|breadcrumb|webpage|collectionpage)/.test(s)) return 'add_supported_type'; if(/repair|fix|regenerate/.test(s)) return 'repair_existing'; if(/validate|check/.test(s)) return 'validate_existing'; return 'none'; }
function pageDecision(v){ const s=text(v).toLowerCase(); if(/repair|fix|update/.test(s)) return 'repair_existing'; if(/build|create|new/.test(s)) return 'build_new'; if(/consolidate|merge/.test(s)) return 'consolidate'; if(/no[_ -]?action|maintain/.test(s)) return 'no_action'; return ''; }
function normalize(raw={}){
  if(!raw || typeof raw!=='object') return {status:'NOT_PROVIDED', value:null, errors:[]};
  const value={
    query:text(raw.query), scope:scope(raw.scope||raw.vertical), model:text(raw.model), run_date:text(raw.run_date),
    target_url:text(raw.target_url), target_filepath:text(raw.target_filepath||raw.repo_file_path),
    search_intent:text(raw.search_intent||raw.intent_stage), buyer_stage:text(raw.buyer_stage),
    page_decision:pageDecision(raw.page_decision||raw.action), recommended_page_type:text(raw.recommended_page_type||raw.page_type),
    on_page_failures:arr(raw.on_page_failures||raw.on_page_failures_json), competitor_url:text(raw.competitor_url),
    competitor_format_gap:text(raw.competitor_format_gap), internal_link_actions:arr(raw.internal_link_actions||raw.internal_link_actions_json),
    schema_action:schemaAction(raw.schema_action), exact_edit:text(raw.exact_edit||raw.edit_instruction),
    acceptance_checks:arr(raw.acceptance_checks||raw.acceptance_checks_json), required_internal_links:arr(raw.required_internal_links||raw.required_internal_links_json),
    ranking_mode:text(raw.ranking_mode), selection_criteria:arr(raw.selection_criteria), evidence:arr(raw.provider_evidence)
  };
  const errors=[];
  if(!value.query) errors.push('missing_query');
  if(value.page_decision && !POLICY.allowed_page_decisions.includes(value.page_decision)) errors.push('unsupported_page_decision');
  if(value.recommended_page_type && !POLICY.allowed_page_types.includes(value.recommended_page_type)) errors.push('unsupported_page_type');
  if(value.ranking_mode && POLICY.ranking_modes_blocked.includes(value.ranking_mode)) errors.push('blocked_ranking_mode');
  for(const link of value.internal_link_actions){ if(link && typeof link==='object' && text(link.from_url)===text(link.to_url)) errors.push('self_link'); }
  return {status:errors.length?'INVALID':'VALID', value, errors};
}
module.exports={normalizeSeoExecution:normalize, normalizeScope:scope, normalizeArray:arr, normalizeSchemaAction:schemaAction, normalizePageDecision:pageDecision, POLICY};
