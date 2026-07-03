'use strict';

const ALLOWED_BLOCK_TYPES = Object.freeze([
  'numbered_framework',
  'decision_matrix',
  'comparison_table',
  'cost_table',
  'timeline_table',
  'scorecard',
  'worksheet',
  'checklist',
  'protocol',
  'script',
  'severity_matrix',
  'source_block',
  'callout'
]);

const BLOCK_TYPE_ALIASES = Object.freeze({
  table: 'comparison_table',
  comparison: 'comparison_table',
  'comparison table': 'comparison_table',
  matrix: 'decision_matrix',
  'decision matrix': 'decision_matrix',
  cost: 'cost_table',
  price: 'cost_table',
  pricing: 'cost_table',
  timeline: 'timeline_table',
  wait: 'timeline_table',
  deadline: 'timeline_table',
  scorecard: 'scorecard',
  checklist: 'checklist',
  script: 'script',
  protocol: 'protocol',
  framework: 'numbered_framework',
  'decision tree': 'protocol',
  severity: 'severity_matrix',
  red: 'severity_matrix',
  source: 'source_block',
  legal: 'source_block',
  callout: 'callout'
});

const DEFAULT_HEADERS = Object.freeze({
  comparison_table: ['Factor', 'What to verify', 'Why it matters'],
  decision_matrix: ['Decision', 'When it fits', 'What to do next'],
  cost_table: ['Cost factor', 'Typical range or question', 'What to verify'],
  timeline_table: ['Timeline factor', 'Typical range', 'What to ask'],
  severity_matrix: ['Severity', 'Red flag', 'Action'],
  scorecard: ['Criterion', 'What to check', 'Red flag'],
  worksheet: ['Step', 'Question', 'Output']
});

function canonicalBlockType(value) {
  const raw = String(value || '').toLowerCase().replace(/[_-]+/g, ' ').trim();
  if (!raw) return 'checklist';
  if (ALLOWED_BLOCK_TYPES.includes(raw.replace(/ /g, '_'))) return raw.replace(/ /g, '_');
  for (const [needle, type] of Object.entries(BLOCK_TYPE_ALIASES)) {
    if (raw.includes(needle)) return type;
  }
  return 'checklist';
}

module.exports = { ALLOWED_BLOCK_TYPES, BLOCK_TYPE_ALIASES, DEFAULT_HEADERS, canonicalBlockType };
