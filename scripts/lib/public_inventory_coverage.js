'use strict';
const identity = route => String(route).replace(/\/index\.html$/, '/').replace(/\.html$/, '').replace(/\/$/, '') || '/';

// Preserve the historical anti-truncation floor while accounting for approved
// consolidations. A deleted page without a recorded working 301 never counts.
function inventoryCoverage({ admitted, rendered, retirements, redirects, minimum }) {
  const live = new Set(admitted.map(identity));
  const found = new Set(rendered.map(identity));
  const redirectMap = new Map(redirects.map(([from, to, status]) => [identity(from), { to: identity(to), status }]));
  const issues = [];
  if (!live.size) issues.push('no admitted routes');
  for (const route of live) if (!found.has(route)) issues.push(`admitted route missing from indexable tree: ${route}`);
  const retired = new Set();
  for (const row of retirements) {
    if (row.status !== 'ACTIVE_301') continue;
    const source = identity(row.source_path), target = identity(row.target_path), rule = redirectMap.get(source);
    if (live.has(source) || !live.has(target) || !rule || rule.status !== '301' || rule.to !== target) {
      issues.push(`invalid retirement coverage: ${source} -> ${target}`);
    } else retired.add(source);
  }
  const coverage = live.size + retired.size;
  if (coverage < minimum) issues.push(`only ${coverage} active or permanently consolidated routes; expected at least ${minimum}`);
  return { coverage, active: live.size, retired: retired.size, issues };
}
module.exports = { inventoryCoverage };
