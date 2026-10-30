#!/usr/bin/env node
'use strict';
/**
 * entity_backlink_watch: the weekly check that keeps entity.json true
 * (grid authority audit, 30 Oct 2026). Run by .github/workflows/entity-backlink-watch.yml.
 *
 * For every sameAs URL and every pending profile in entity.json it fetches the
 * page under a browser user agent and classifies it:
 *   live        2xx after redirects, and the page names theindustryguides.com
 *   no_link_back 2xx, but the page never names our host
 *   unverifiable a JS-rendered platform (Instagram, Gumroad, Google Maps, TikTok):
 *               a named state, never a pass
 *   dead        404 / 410 / DNS failure
 *   blocked     403 / 429 / 999 / 5xx / timeout: inconclusive, nothing changes
 *
 * Self-heal (--apply writes the files; the workflow opens a PR, never main):
 *   sameAs dead          -> removed from entity.json, its record RETIRED, with a note
 *   pending live         -> promoted: a VERIFIED THIRD_PARTY_PROFILE record is
 *                           written and the URL moves into sameAs
 *   sameAs no_link_back  -> NAMED STOP naming the exact profile field to edit
 *   pending not live     -> NAMED STOP carrying the owner action
 * Zero sameAs AND zero pending exits 1: a watch over nothing is inert.
 *
 * planChanges() is pure, so validate_org_entity_graph.js replays it on fixtures
 * every validation run.
 */
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..', '..');
const ENTITY = path.join(ROOT, 'entity.json');
const REG = path.join(ROOT, 'data', 'authority', 'verified_same_as_registry.json');
const HOST = 'theindustryguides.com';
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';
const JS_RENDERED = [/(^|\.)instagram\.com$/, /(^|\.)gumroad\.com$/, /(^|\.)tiktok\.com$/, /^maps\.app\.goo\.gl$/, /^(www\.)?google\.[a-z.]+$/];

const hostOf = (u) => { try { return new URL(u).hostname.toLowerCase(); } catch { return ''; } };
const isJsRendered = (u) => JS_RENDERED.some((re) => re.test(hostOf(u))) && (!/google\./.test(hostOf(u)) || /\/maps/.test(u));

async function probe(url, timeoutMs = 20000) {
  if (isJsRendered(url)) return { url, state: 'unverifiable', detail: 'JS-rendered platform: the profile body is not in the server response' };
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { redirect: 'follow', signal: ctl.signal, headers: { 'user-agent': UA, accept: 'text/html,*/*' } });
    const body = res.ok ? await res.text() : '';
    if (res.ok) return { url, state: body.toLowerCase().includes(HOST) ? 'live' : 'no_link_back', http: res.status, final_url: res.url };
    if (res.status === 404 || res.status === 410) return { url, state: 'dead', http: res.status };
    return { url, state: 'blocked', http: res.status };
  } catch (e) {
    const code = (e && e.cause && e.cause.code) || '';
    if (code === "ENOTFOUND") return { url, state: 'dead', detail: code };
    return { url, state: 'blocked', detail: e.name === 'AbortError' ? 'timeout' : (code || String(e.message || e)) };
  }
}

function addMonths(iso, n) { const d = new Date(`${iso}T00:00:00Z`); d.setUTCMonth(d.getUTCMonth() + n); return d.toISOString().slice(0, 10); }

/** Pure: entity + registry + probe results -> new entity, new registry, actions, named stops. */
function planChanges(entity, registry, results, today) {
  const e = JSON.parse(JSON.stringify(entity));
  const r = JSON.parse(JSON.stringify(registry));
  const byUrl = new Map(results.map((x) => [x.url, x]));
  const actions = [];
  const stops = [];
  const errors = [];
  const sameAs = (e.sameAs || []).map(String);
  const pending = e.profiles_pending || [];
  if (!sameAs.length && !pending.length) errors.push('zero_items: entity.json has no sameAs and no pending profile; the watch would check nothing');
  const keep = [];
  for (const url of sameAs) {
    const res = byUrl.get(url) || { state: 'blocked', detail: 'not probed' };
    const rec = (r.records || []).find((x) => x.url === url && x.status === 'VERIFIED');
    if (res.state === 'dead') {
      if (rec) { rec.status = 'RETIRED'; rec.retired_at = today; rec.retired_reason = `entity-backlink-watch: ${res.http || res.detail} on ${today}`; }
      actions.push({ kind: 'removed_dead_sameAs', url, evidence: res.http || res.detail });
      continue;
    }
    keep.push(url);
    if (res.state === 'no_link_back') stops.push(`Missing link-back: ${url} resolves but never names ${HOST}. Edit ${(rec && rec.link_back_field) || 'the profile\'s website field'} to https://${HOST}/ (owner login).`);
    if (res.state === 'unverifiable') actions.push({ kind: 'unverifiable', url, detail: res.detail });
    if (res.state === 'blocked') actions.push({ kind: 'inconclusive', url, detail: res.http || res.detail });
  }
  const stillPending = [];
  for (const p of pending) {
    const res = byUrl.get(p.url) || { state: 'blocked', detail: 'not probed' };
    if (res.state === 'live') {
      r.records = r.records || [];
      r.records.push({
        entity_id: e['@id'], url: p.url, source_url: p.url, basis: 'THIRD_PARTY_PROFILE', status: 'VERIFIED',
        verified_at: today, recheck_by: addMonths(today, 6), link_back_field: p.link_back_field,
        verification_method: `entity-backlink-watch: GET under a browser user agent returned ${res.http}, and the profile names ${HOST}.`,
      });
      keep.push(p.url);
      actions.push({ kind: 'promoted_pending', url: p.url, platform: p.platform });
      continue;
    }
    stillPending.push(p);
    stops.push(`Pending ${p.platform} (${p.url}): ${res.state}${res.http ? ` ${res.http}` : ''}. ${p.owner_action}`);
  }
  e.sameAs = keep;
  e.profiles_pending = stillPending;
  const changed = JSON.stringify(e) !== JSON.stringify(entity) || JSON.stringify(r) !== JSON.stringify(registry);
  if (changed) e.updated_at = today;
  return { entity: e, registry: r, actions, stops, errors, changed };
}

async function main() {
  const apply = process.argv.includes('--apply');
  const outArg = process.argv.find((a) => a.startsWith('--out='));
  const out = outArg ? outArg.slice(6) : path.join(ROOT, 'artifacts', 'authority', 'entity-backlink-watch.json');
  const entity = JSON.parse(fs.readFileSync(ENTITY, 'utf8'));
  const registry = JSON.parse(fs.readFileSync(REG, 'utf8'));
  const urls = [...(entity.sameAs || []), ...(entity.profiles_pending || []).map((p) => p.url)];
  const results = [];
  for (const u of urls) results.push(await probe(u));
  const today = new Date().toISOString().slice(0, 10);
  const plan = planChanges(entity, registry, results, today);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, `${JSON.stringify({ checked_at: today, results, actions: plan.actions, named_stops: plan.stops, errors: plan.errors, changed: plan.changed }, null, 2)}\n`);
  for (const x of results) console.log(`${x.state.padEnd(13)} ${x.url}${x.http ? ` (${x.http})` : ''}${x.detail ? ` - ${x.detail}` : ''}`);
  for (const a of plan.actions) console.log(`ACTION ${a.kind}: ${a.url}`);
  for (const s of plan.stops) console.log(`NAMED STOP: ${s}`);
  if (process.env.GITHUB_STEP_SUMMARY) {
    const lines = ['## Entity backlink watch', '', ...results.map((x) => `- \`${x.state}\` ${x.url}${x.http ? ` (${x.http})` : ''}`), '', ...plan.actions.map((a) => `- action: ${a.kind} ${a.url}`), ...plan.stops.map((s) => `- **NAMED STOP:** ${s}`)];
    fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${lines.join('\n')}\n`);
  }
  if (plan.errors.length) { for (const e of plan.errors) console.error(`FAIL ${e}`); process.exit(1); }
  if (apply && plan.changed) {
    fs.writeFileSync(ENTITY, `${JSON.stringify(plan.entity, null, 2)}\n`);
    fs.writeFileSync(REG, `${JSON.stringify(plan.registry, null, 2)}\n`);
    console.log('entity.json and the verified registry updated; the workflow opens a PR.');
  }
  console.log(`entity-backlink-watch: ${results.length} profile(s) checked, ${plan.actions.length} action(s), ${plan.stops.length} named stop(s).`);
}

if (require.main === module) main().catch((e) => { console.error(e); process.exit(1); });
module.exports = { planChanges, probe, isJsRendered, HOST };
