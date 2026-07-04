'use strict';
function blockedResult(source, reason) {
  return {
    adapter: source.adapter,
    source: source.source_key,
    mode: source.mode,
    terms_status: source.terms_status,
    collected_at: new Date().toISOString(),
    records: [],
    errors: [],
    warnings: [reason],
    status: source.terms_status === 'blocked' ? 'BLOCKED' : 'WARN'
  };
}
function passResult(source, records, warnings = []) {
  return {
    adapter: source.adapter,
    source: source.source_key,
    mode: source.mode,
    terms_status: source.terms_status,
    collected_at: new Date().toISOString(),
    records,
    errors: [],
    warnings,
    status: warnings.length ? 'WARN' : 'PASS'
  };
}
function safeDisabled(source) {
  if (source.terms_status === 'allowed') return null;
  return blockedResult(source, `Source is ${source.terms_status}; live collection disabled by source-compliance contract.`);
}
module.exports = { blockedResult, passResult, safeDisabled };
