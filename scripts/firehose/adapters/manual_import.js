'use strict';
const { readJson } = require('../../citation_intelligence/pipeline_lib');
const { passResult, safeDisabled } = require('./adapter_common');
async function collect(source) {
  const disabled = safeDisabled(source);
  if (disabled) return disabled;
  if (source.mode === 'fixture') {
    const fixture = readJson('data/signals/fixtures/raw_signals.json', { records: [] });
    return passResult(source, fixture.records || []);
  }
  const manual = readJson('data/signals/manual_import.json', { records: [] });
  return passResult(source, manual.records || [], manual.records ? [] : ['No manual_import records found.']);
}
module.exports = { collect };
