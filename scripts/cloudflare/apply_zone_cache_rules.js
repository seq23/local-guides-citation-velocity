#!/usr/bin/env node
'use strict';
/**
 * Make the live zone's cache rules match config/cloudflare/zone_cache_rules.json.
 *
 *   node scripts/cloudflare/apply_zone_cache_rules.js --check   read-only: exit 1 on drift
 *   node scripts/cloudflare/apply_zone_cache_rules.js --apply   write the rules (idempotent)
 *
 * Needs CLOUDFLARE_API_TOKEN (Zone: Cache Rules Edit, Zone Settings Edit for tiered
 * cache) injected from the credential vault; the value is never printed. Rules this
 * file does not own (a different `ref`) are kept as they are.
 */
const fs = require('fs');
const path = require('path');

const CONFIG = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../config/cloudflare/zone_cache_rules.json'), 'utf8'));
const MODE = process.argv.includes('--apply') ? 'apply' : 'check';
const TOKEN = process.env.CLOUDFLARE_API_TOKEN;
const API = 'https://api.cloudflare.com/client/v4';

async function cf(method, url, body) {
  const res = await fetch(`${API}${url}`, { method, headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  const json = await res.json().catch(() => ({}));
  return { status: res.status, json };
}
const owned = (rule) => CONFIG.rules.some((r) => r.ref === rule.ref);
const same = (live, want) => live && live.expression === want.expression && live.action === want.action && live.enabled === want.enabled
  && JSON.stringify(live.action_parameters) === JSON.stringify(want.action_parameters);

async function main() {
  if (!TOKEN) { console.error('CLOUDFLARE_API_TOKEN is not set; inject it from the vault.'); process.exit(2); }
  const zones = await cf('GET', `/zones?name=${encodeURIComponent(CONFIG.zone)}`);
  const zoneId = zones.json.result && zones.json.result[0] && zones.json.result[0].id;
  if (!zoneId) { console.error(`zone ${CONFIG.zone} not visible to this token (HTTP ${zones.status})`); process.exit(1); }
  const entry = await cf('GET', `/zones/${zoneId}/rulesets/phases/${CONFIG.phase}/entrypoint`);
  const liveRules = entry.status === 200 ? (entry.json.result.rules || []) : [];
  const drift = CONFIG.rules.filter((want) => !same(liveRules.find((r) => r.ref === want.ref), want)).map((r) => r.ref);
  const tiered = await cf('GET', `/zones/${zoneId}/cache/tiered_cache_smart_topology_enable`);
  const tieredOn = tiered.json.result && tiered.json.result.value === 'on';
  const tieredDrift = CONFIG.smart_tiered_cache && !tieredOn;
  if (MODE === 'check') {
    if (drift.length || tieredDrift) { console.error(`zone cache DRIFT: rules ${drift.join(', ') || 'in sync'}; smart tiered cache ${tieredOn ? 'on' : 'off'}`); process.exit(1); }
    console.log(`zone cache in sync: ${CONFIG.rules.length} rule(s), smart tiered cache ${tieredOn ? 'on' : 'off'}`);
    return;
  }
  if (drift.length) {
    const keep = liveRules.filter((r) => !owned(r)).map(({ id, version, last_updated, ...rest }) => rest);
    const rules = [...keep, ...CONFIG.rules];
    const put = await cf('PUT', `/zones/${zoneId}/rulesets/phases/${CONFIG.phase}/entrypoint`, { rules });
    if (!put.json.success) { console.error(`ruleset write failed (HTTP ${put.status}): ${JSON.stringify(put.json.errors)}`); process.exit(1); }
  }
  if (tieredDrift) {
    const patch = await cf('PATCH', `/zones/${zoneId}/cache/tiered_cache_smart_topology_enable`, { value: 'on' });
    if (!patch.json.success) { console.error(`smart tiered cache write failed (HTTP ${patch.status}): ${JSON.stringify(patch.json.errors)}`); process.exit(1); }
  }
  console.log(`zone cache applied: ${drift.length ? `wrote ${drift.join(', ')}` : 'rules already in sync'}; smart tiered cache ${tieredDrift ? 'turned on' : (tieredOn ? 'already on' : 'not requested')}`);
}
main().catch((e) => { console.error(e.message); process.exit(1); });
