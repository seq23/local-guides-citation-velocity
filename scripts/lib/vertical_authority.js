'use strict';

const VERTICAL_ALIASES = new Map(Object.entries({
  pi: 'personal_injury',
  'personal injury': 'personal_injury',
  'personal-injury': 'personal_injury',
  personal_injury: 'personal_injury',
  dentistry: 'dentistry',
  dental: 'dentistry',
  trt: 'trt',
  testosterone: 'trt',
  hair: 'trt',
  'hair-loss': 'trt',
  peptides: 'trt',
  neuro: 'neuro',
  neuropsych: 'neuro',
  uscis: 'uscis-medical',
  'uscis medical': 'uscis-medical',
  'uscis-medical': 'uscis-medical'
}));

const ROUTE_SEGMENT_BY_VERTICAL = {
  personal_injury: 'personal-injury',
  dentistry: 'dentistry',
  trt: 'trt',
  neuro: 'neuro',
  'uscis-medical': 'uscis-medical'
};

function normalizeVertical(value) {
  const raw = String(value || '').trim().toLowerCase();
  const dashed = raw.replace(/_/g, '-');
  return VERTICAL_ALIASES.get(dashed) || VERTICAL_ALIASES.get(dashed.replace(/-/g, ' ')) || VERTICAL_ALIASES.get(raw) || dashed;
}

function routeSegmentForVertical(value) {
  const vertical = normalizeVertical(value);
  return ROUTE_SEGMENT_BY_VERTICAL[vertical] || String(vertical || '').replace(/_/g, '-');
}

function verticalFromRoute(route) {
  const first = String(route || '').replace(/^https?:\/\/[^/]+/i, '').replace(/^\//, '').split('/')[0] || '';
  return normalizeVertical(first);
}

function isSupportedVertical(value) {
  return Boolean(ROUTE_SEGMENT_BY_VERTICAL[normalizeVertical(value)]);
}

module.exports = {
  normalizeVertical,
  routeSegmentForVertical,
  verticalFromRoute,
  isSupportedVertical,
  supportedVerticals: Object.keys(ROUTE_SEGMENT_BY_VERTICAL)
};
