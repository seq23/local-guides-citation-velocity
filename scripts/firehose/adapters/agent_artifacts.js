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
  const manifests = walk(path.join(ROOT, 'data/report_fixes/agent_runs'));
  const records = manifests.slice(0, 25).map((file, idx) => {
    let parsed = {};
    try { parsed = JSON.parse(fs.readFileSync(file, 'utf8')); } catch {}
    const title = excerpt(parsed.title || parsed.run_id || `Agent artifact ${idx + 1}`, 180);
    return {
      signal_id: `agent_artifact_${hash(file, 10)}`,
      source_key: source.source_key,
      source_url: `repo://${path.relative(ROOT, file).replace(/\\/g, '/')}`,
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
  return passResult(source, records, records.length ? [] : ['No repo-local agent_run_manifest.json files found.']);
}
module.exports = { collect };
