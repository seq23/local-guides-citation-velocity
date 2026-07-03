'use strict';

function textFor(row) {
  return `${row.query || ''} ${row.recommendation || row.fix_recommendation || row.why_worth_building || ''} ${row.cluster || ''}`.toLowerCase();
}
function classifyOpportunity(row) {
  const text = textFor(row);
  const vertical = String(row.vertical || '').replace(/_/g, '-');
  if (String(row.operation || '').toUpperCase() === 'REPAIR_INTENDED_WINNER_PAGE' || row.intended_winner_path) return { family: 'REPAIR_EXISTING', reason: 'existing_target_repair' };
  if (vertical === 'neuro' && /migraine|headache|cgrp|aimovig|emgality|ibuprofen|vitamin b2|magnesium|neuromodulation/.test(text)) return { family: 'EXPANSION_CANDIDATE', reason: 'broader_neurology_topic_outside_current_neuro_evaluation_scope' };
  if (/foundational|cluster|guide|pillar|evergreen|dedicated page|complete guide|source hub/.test(text)) return { family: 'CREATE_GUIDE', reason: 'foundational_or_guide_language' };
  if (/near me|local|city|atlanta|dallas|miami|chicago|new york|provider|clinic|office/.test(text)) return { family: 'CREATE_COMMUNITY_QA', reason: 'local_or_provider_question' };
  if (/what|how|which|when|why|is it|should i|can i/.test(text)) return { family: 'CREATE_COMMUNITY_QA', reason: 'long_tail_question' };
  return { family: 'CREATE_COMMUNITY_QA', reason: 'default_safe_long_tail_lane' };
}
module.exports = { classifyOpportunity };
