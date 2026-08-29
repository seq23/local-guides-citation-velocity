'use strict';
const fs = require('fs');
const path = require('path');
const { ROOT, hash, excerpt } = require('../../citation_intelligence/pipeline_lib');
const { passResult, safeDisabled } = require('./adapter_common');
function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) walk(p, out);
    else if (ent.name === 'agent_run_manifest.json') out.push(p);
  }
  return out;
}
async function collect(source) {
  const disabled = safeDisabled(source);
  if (disabled) return disabled;
  const manifests = walk(path.join(ROOT, 'data/report_fixes/agent_runs')).sort();
  // Two defects lived in the next two lines.
  //
  // 1. `manifests.slice(0, 25)` silently dropped everything past the 25th. With
  //    47 manifests on disk, 22 agent runs - 47% - were discarded by a step that
  //    exited 0 and named nothing, because the warning below only fires when
  //    records.length is ZERO. A cap is fine; a cap that reports the capped
  //    figure as the whole is the defect this repo corrected elsewhere today
  //    (a suppressed backlog reported as 68 against a true depth of 389). The
  //    cap now names what it left behind, and the population travels with the
  //    slice.
  // 2. `hash(file, 10)` hashed the ABSOLUTE path, so every signal_id changed
  //    between the CI runner checkout and any other checkout of identical
  //    content. Roughly 100 normalized_id/signal_id lines churned on every run
  //    and no signal could be correlated across machines. The line below already
  //    had the answer - path.relative(ROOT, file) - one line down.
  const CAP = 25;
  const truncated = Math.max(0, manifests.length - CAP);
  const records = manifests.slice(0, CAP).map((file, idx) => {
    const relFile = path.relative(ROOT, file).replace(/\\/g, '/');
    let parsed = {};
    try { parsed = JSON.parse(fs.readFileSync(file, 'utf8')); } catch {}
    const title = excerpt(parsed.title || parsed.run_id || `Agent artifact ${idx + 1}`, 180);
    return {
      signal_id: `agent_artifact_${hash(relFile, 10)}`,
      source_key: source.source_key,
      source_url: `repo://${relFile}`,
      captured_at: new Date().toISOString().slice(0, 10),
      raw_title: title,
      raw_signal_phrase: title,
      short_excerpt: excerpt(parsed.summary || title, 260),
      vertical: parsed.vertical || 'general',
      intent: 'agent_artifact_repair',
      candidate_type: 'repair',
      page_family: parsed.page_family || 'guide',
      route_owner: parsed.route_owner || 'repo_agent_artifact',
      source_basis: 'repo_local_agent_artifact',
      engagement: { score: 0, comments: 0 },
      status: 'raw'
    };
  });
  const warnings = [];
  if (!records.length) warnings.push('No repo-local agent_run_manifest.json files found.');
  if (truncated) warnings.push(`agent_artifacts cap: ${manifests.length} agent_run_manifest.json files on disk, ${records.length} collected, ${truncated} NOT collected this run. The collected count is a slice, not the population.`);
  const result = passResult(source, records, warnings);
  if (result && typeof result === 'object') {
    result.population_total = manifests.length;
    result.collected_count = records.length;
    result.truncated_count = truncated;
  }
  return result;
}
module.exports = { collect };
