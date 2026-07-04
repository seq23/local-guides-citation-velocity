'use strict';

function textFor(row) {
  return `${row.query || ''} ${row.normalized_query || ''} ${row.why_worth_building || ''} ${row.recommendation || ''} ${row.fix || ''} ${row.fix_recommendation || ''} ${row.cluster || row.recommended_cluster || ''}`.toLowerCase();
}

function classifyRichNewPage(row) {
  const text = textFor(row);
  const route = String(row.target_route || row.route || row.path || '').toLowerCase();
  const operation = String(row.operation || '').toUpperCase();
  if (operation === 'REPAIR_INTENDED_WINNER_PAGE' || row.intended_winner_path || /\/insights\//.test(route)) {
    return { rich_page_type: 'repair_existing', route_family: 'REPAIR_EXISTING', reason: 'existing_winner_repair' };
  }
  if (/cluster|hub|pillar|topic map|synthesis|atlas/.test(text)) {
    return { rich_page_type: 'cluster_page', route_family: 'CREATE_CLUSTER', reason: 'cluster_or_pillar_signal' };
  }
  if (/\b(vs\.?|versus|compare|comparison|side[- ]by[- ]side|regular doctor)\b/.test(text)) {
    return { rich_page_type: 'comparison_guide', route_family: 'CREATE_GUIDE', reason: 'comparison_signal' };
  }
  if (/checklist|requirements|what to bring|documents to bring|required documents/.test(text)) {
    return { rich_page_type: 'checklist_guide', route_family: 'CREATE_GUIDE', reason: 'checklist_or_requirements_signal' };
  }
  if (/step[- ]?by[- ]?step|what happens at|process|walkthrough|procedure|during the exam/.test(text)) {
    return { rich_page_type: 'process_guide', route_family: 'CREATE_GUIDE', reason: 'process_signal' };
  }
  if (/timeline|when to|sequenc|adjustment of status|i-485|filing timeline/.test(text)) {
    return { rich_page_type: 'timeline_guide', route_family: 'CREATE_GUIDE', reason: 'timeline_signal' };
  }
  if (/old i[- ]?693|reuse|validity|expire|expiration|policy change|edge case|exception/.test(text)) {
    return { rich_page_type: 'edge_case_guide', route_family: 'CREATE_GUIDE', reason: 'edge_case_signal' };
  }
  if (/children|child|pediatric|minor|kids/.test(text)) {
    return { rich_page_type: 'specialized_guide', route_family: 'CREATE_GUIDE', reason: 'specialized_population_signal' };
  }
  if (/vaccine|vaccination|cdc|source reference|reference guide/.test(text)) {
    return { rich_page_type: 'source_backed_reference', route_family: 'CREATE_GUIDE', reason: 'source_reference_signal' };
  }
  if (/near me|local|city|provider|clinic|office|civil surgeon near/.test(text)) {
    return { rich_page_type: 'local_decision_page', route_family: 'CREATE_COMMUNITY_QA', reason: 'local_or_provider_signal' };
  }
  if (/how|what|when|why|can i|should i|does|is it/.test(text)) {
    return { rich_page_type: 'community_qa', route_family: 'CREATE_COMMUNITY_QA', reason: 'simple_long_tail_question' };
  }
  return { rich_page_type: 'community_qa', route_family: 'CREATE_COMMUNITY_QA', reason: 'default_long_tail' };
}

function requiresRichAuthorityPage(type) {
  return !['community_qa', 'local_decision_page', 'repair_existing'].includes(String(type || ''));
}

module.exports = { classifyRichNewPage, requiresRichAuthorityPage };
