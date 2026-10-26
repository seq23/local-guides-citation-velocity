'use strict';
/**
 * Zero-paid LLM policy check (owner policy 11 Oct 2026: "nothing should be paid
 * ... cut the probes and make them free"). Pure: every file read goes through the
 * injected `io`, so the same function runs on the repo and on in-memory hostile
 * fixtures (selfTest) - the negative proofs run on every validation, not once.
 *
 *   (a) no SCHEDULED workflow reaches a model except through the free router -
 *       directly, or through an `npm run` script it invokes;
 *       and no script outside the router and the registered probes calls a model
 *       endpoint at all, and every registered probe goes through the router;
 *   (b) config/llm_routing.json: max_cost_usd 0, no paid fallback, no web plugin,
 *       every model $0 on every pricing field; snapshot older than its max age is
 *       a WARNING (refresh with --refresh), never a blocker;
 *   (c) probe workflows: no schedule: trigger, a workflow_dispatch boolean input
 *       confirm_paid defaulting false, and a guard step that refuses otherwise;
 *   (d) the rule is written where the next agent finds it: docs/cost/zero-paid-llm.md
 *       exists and CLAUDE.md carries the "nothing paid" line and points at that doc.
 *       A policy only this file knows is a wish - the next person to open the repo
 *       reads CLAUDE.md, so the line has to be there and has to be read by code.
 */
const fs = require('fs');
const path = require('path');

const ROUTER = 'scripts/lib/free_llm_router.mjs';
const ROUTING = 'config/llm_routing.json';
const SELF = 'scripts/lib/zero_paid_llm_check.js';
const POLICY_DOC = 'docs/cost/zero-paid-llm.md';
const HOUSE_RULES = 'CLAUDE.md';
// Text that means "this line reaches a model provider".
const MODEL_REACH = /openrouter\.ai|OPENROUTER_API_KEY|chat\/completions|api\.openai\.com|anthropic\.com|ANTHROPIC_API_KEY|OPENAI_API_KEY|generativelanguage\.googleapis|GEMINI_API_KEY|GOOGLE_GEMINI_API_KEY|perplexity\.ai|PERPLEXITY_API_KEY|SERPAPI_API_KEY|serpapi\.com|semrush|ahrefs|APIFY_TOKEN|api\.apify/i;
const ENDPOINT = /openrouter\.ai\/api\/v1\/chat\/completions|api\.openai\.com|api\.anthropic\.com|generativelanguage\.googleapis\.com|api\.perplexity\.ai|serpapi\.com\/search/;

function repoIo(root) {
  return {
    read: (rel) => fs.readFileSync(path.join(root, rel), 'utf8'),
    exists: (rel) => fs.existsSync(path.join(root, rel)),
    list: (rel) => (fs.existsSync(path.join(root, rel)) ? fs.readdirSync(path.join(root, rel)) : []),
    walk: (rel) => {
      const out = [];
      const go = (r) => {
        for (const e of fs.readdirSync(path.join(root, r), { withFileTypes: true })) {
          const p = `${r}/${e.name}`;
          if (e.isDirectory()) { if (e.name !== 'node_modules') go(p); } else if (/\.(m?js|cjs|py|sh)$/.test(e.name)) out.push(p);
        }
      };
      if (fs.existsSync(path.join(root, rel))) go(rel);
      return out;
    },
  };
}

const onBlock = (yml) => {
  const m = yml.match(/^on:\s*\n([\s\S]*?)(?=^\S)/m);
  return m ? m[1] : (yml.match(/^on:.*$/m) || [''])[0];
};
const isScheduled = (yml) => /^\s+schedule:/m.test(onBlock(yml));

function check(io, { reg, now = Date.now() } = {}) {
  const failures = [];
  const warnings = [];
  const stats = { scheduled_workflows: 0, probe_workflows: 0, scripts_scanned: 0, models: 0 };

  // ---------------------------------------------------------------- (b) config
  let cfg = null;
  if (!io.exists(ROUTING)) failures.push(`${ROUTING} missing`);
  else {
    try { cfg = JSON.parse(io.read(ROUTING)); } catch (e) { failures.push(`${ROUTING} does not parse: ${e.message}`); }
  }
  if (cfg) {
    const p = cfg.policy || {};
    if (p.max_cost_usd !== 0) failures.push(`${ROUTING} policy.max_cost_usd is ${JSON.stringify(p.max_cost_usd)}, must be 0`);
    if (p.paid_fallback !== false) failures.push(`${ROUTING} policy.paid_fallback must be false`);
    if (p.web_plugin_allowed !== false) failures.push(`${ROUTING} policy.web_plugin_allowed must be false`);
    if (p.probes_scheduled !== false) failures.push(`${ROUTING} policy.probes_scheduled must be false`);
    const models = Array.isArray(cfg.models) ? cfg.models : [];
    stats.models = models.length;
    if (models.length < 3) failures.push(`${ROUTING} lists ${models.length} model(s); keep an ordered fallback of 3-4 $0 models`);
    for (const m of models) {
      const pr = m.pricing || {};
      if (pr.prompt !== '0' || pr.completion !== '0') failures.push(`${ROUTING} model ${m.id} is not $0 (prompt ${pr.prompt}, completion ${pr.completion})`);
      for (const [k, v] of Object.entries(pr)) if (Number(v) !== 0) failures.push(`${ROUTING} model ${m.id} pricing.${k}=${v} is not 0`);
      if (/:online$/.test(m.id || '')) failures.push(`${ROUTING} model ${m.id} uses the billed :online suffix`);
    }
    const snap = Date.parse(cfg.snapshot_date || '');
    const maxAge = Number(p.snapshot_max_age_days || 30);
    if (!Number.isFinite(snap)) failures.push(`${ROUTING} snapshot_date is not a date`);
    else if ((now - snap) / 86400000 > maxAge) warnings.push(`${ROUTING} pricing snapshot is ${Math.floor((now - snap) / 86400000)} days old (max ${maxAge}); run node ${ROUTER} --refresh`);
  }

  // ------------------------------------------------- (a) scheduled workflows
  const pkg = io.exists('package.json') ? JSON.parse(io.read('package.json')) : { scripts: {} };
  const npmScripts = pkg.scripts || {};
  const expandNpm = (line, depth = 0) => {
    let out = line;
    if (depth > 4) return out;
    for (const m of line.matchAll(/npm run ([\w:.-]+)/g)) if (npmScripts[m[1]]) out += `\n${expandNpm(npmScripts[m[1]], depth + 1)}`;
    return out;
  };
  const probeScripts = reg.probe_scripts || [];
  const probeWorkflows = reg.probe_workflows || [];
  const wfDir = '.github/workflows';
  const wfs = io.list(wfDir).filter((f) => /\.ya?ml$/.test(f));
  if (!wfs.length) failures.push(`${wfDir} holds no workflows; refusing to pass on nothing`);
  for (const f of wfs) {
    const yml = io.read(`${wfDir}/${f}`);
    if (!isScheduled(yml)) continue;
    stats.scheduled_workflows += 1;
    // Judged per STEP: a step may carry the key only if what it runs is the router.
    const steps = yml.split(/\n(?=\s*- (?:name|uses|run|id|if|env):)/);
    for (const step of steps) {
      const body = step.split('\n').filter((l) => !/^\s*#/.test(l)).join('\n');
      const expanded = expandNpm(body);
      const label = (body.match(/- name:\s*(.*)/) || body.match(/run:\s*(.*)/) || [, body.trim().split('\n')[0]])[1];
      const hitsProbe = probeScripts.some((s) => expanded.includes(s) || expanded.includes(path.basename(s)));
      const runs = (expanded.match(/run:[\s\S]*/) || [''])[0];
      const viaRouter = /free_llm_router/.test(runs) && !runs.split('\n').some((l) => MODEL_REACH.test(l) && !/free_llm_router|OPENROUTER_API_KEY:/.test(l));
      if (hitsProbe) failures.push(`${wfDir}/${f} is scheduled and runs a probe in step "${label}"`);
      else if (MODEL_REACH.test(expanded) && !viaRouter) failures.push(`${wfDir}/${f} is scheduled and reaches a model outside the free router in step "${label}"`);
    }
  }

  // Scripts that call a model endpoint must be the router or a registered probe;
  // every registered probe must go through the router and carry the dispatch gate.
  for (const s of io.walk('scripts')) {
    stats.scripts_scanned += 1;
    const src = io.read(s);
    if (!ENDPOINT.test(src)) continue;
    if (s === ROUTER || s === SELF) continue;
    if (!probeScripts.includes(s)) failures.push(`${s} calls a model endpoint directly; only ${ROUTER} may (route it through the router)`);
  }
  for (const s of probeScripts) {
    if (!io.exists(s)) { failures.push(`registered probe ${s} missing`); continue; }
    const src = io.read(s);
    if (!/free_llm_router\.mjs/.test(src)) failures.push(`${s} does not route through ${ROUTER}`);
    if (!/CONFIRM_PAID/.test(src)) failures.push(`${s} has no CONFIRM_PAID gate; a run outside the dispatch workflow could call a model`);
    if (ENDPOINT.test(src)) failures.push(`${s} still calls a model endpoint itself instead of through ${ROUTER}`);
  }
  if (!io.exists(ROUTER)) failures.push(`${ROUTER} missing`);

  // ---------------------------------------------------- (c) probe workflows
  for (const f of probeWorkflows) {
    const rel = `${wfDir}/${f}`;
    if (!io.exists(rel)) { failures.push(`registered probe workflow ${rel} missing`); continue; }
    stats.probe_workflows += 1;
    const yml = io.read(rel);
    if (isScheduled(yml) || /^\s+schedule:/m.test(yml)) failures.push(`${rel} has a schedule: trigger; probes are dispatch-only by owner policy`);
    if (/^\s+(push|pull_request|workflow_run|repository_dispatch):/m.test(onBlock(yml))) failures.push(`${rel} has a non-dispatch trigger; probes are dispatch-only by owner policy`);
    const input = (yml.match(/confirm_paid:\s*\n((?:\s{8,}.*\n)+)/) || [])[1] || '';
    if (!input) failures.push(`${rel} has no workflow_dispatch input confirm_paid`);
    else {
      if (!/type:\s*boolean/.test(input)) failures.push(`${rel} confirm_paid must be type: boolean`);
      if (!/default:\s*false/.test(input)) failures.push(`${rel} confirm_paid must default to false`);
    }
    if (!/inputs\.confirm_paid/.test(yml) || !/NAMED STOP/.test(yml)) failures.push(`${rel} has no guard step that refuses (NAMED STOP) unless inputs.confirm_paid is true`);
    if (!/CONFIRM_PAID:\s*\$\{\{\s*inputs\.confirm_paid\s*\}\}/.test(yml)) failures.push(`${rel} does not pass CONFIRM_PAID from inputs.confirm_paid to the probe`);
  }
  if (!probeWorkflows.length) failures.push('no probe workflows registered; the check would govern nothing');

  // ------------------------------------------------- (d) the written policy
  if (!io.exists(POLICY_DOC)) failures.push(`${POLICY_DOC} missing; the zero-paid policy has no written record`);
  if (!io.exists(HOUSE_RULES)) failures.push(`${HOUSE_RULES} missing; the zero-paid rule has nowhere the next agent will read it`);
  else {
    const rules = io.read(HOUSE_RULES);
    if (!/nothing paid/i.test(rules)) failures.push(`${HOUSE_RULES} does not say "nothing paid"`);
    if (!rules.includes(POLICY_DOC)) failures.push(`${HOUSE_RULES} does not point at ${POLICY_DOC}`);
    stats.house_rules_bytes = rules.length;
  }

  return { failures, warnings, stats };
}

/** Negative proofs on in-memory fixtures: each mutation must be caught. */
function selfTest(root, reg) {
  const base = repoIo(root);
  const mk = (overrides) => ({
    ...base,
    read: (rel) => (rel in overrides ? overrides[rel] : base.read(rel)),
    exists: (rel) => (rel in overrides ? overrides[rel] !== null : base.exists(rel)),
    list: (rel) => [...new Set([...base.list(rel), ...Object.keys(overrides).filter((k) => k.startsWith(`${rel}/`) && overrides[k] !== null).map((k) => k.slice(rel.length + 1))])],
    walk: (rel) => [...new Set([...base.walk(rel), ...Object.keys(overrides).filter((k) => k.startsWith(`${rel}/`) && overrides[k] !== null)])],
  });
  const cfg = JSON.parse(base.read(ROUTING));
  const pw = `.github/workflows/${reg.probe_workflows[0]}`;
  const cases = [
    ['scheduled workflow calls a model directly', { '.github/workflows/zz_fixture.yml': "on:\n  schedule:\n    - cron: '0 0 * * *'\njobs:\n  a:\n    steps:\n      - env:\n          OPENROUTER_API_KEY: x\n        run: curl https://openrouter.ai/api/v1/chat/completions\n" }],
    ['scheduled workflow runs a probe', { '.github/workflows/zz_fixture.yml': `on:\n  schedule:\n    - cron: '0 0 * * *'\njobs:\n  a:\n    steps:\n      - run: node ${reg.probe_scripts[0]}\n` }],
    ['paid model in the routing config', { [ROUTING]: JSON.stringify({ ...cfg, models: [...cfg.models, { id: 'openai/gpt-4o-mini', pricing: { prompt: '0.00000015', completion: '0.0000006' } }] }) }],
    ['max_cost_usd above zero', { [ROUTING]: JSON.stringify({ ...cfg, policy: { ...cfg.policy, max_cost_usd: 1 } }) }],
    ['probe workflow regains a schedule', { [pw]: base.read(pw).replace(/^on:\s*\n/m, "on:\n  schedule:\n    - cron: '0 0 * * *'\n") }],
    ['probe workflow loses confirm_paid', { [pw]: base.read(pw).replace(/confirm_paid/g, 'confirm_x') }],
    ['a script calls a model endpoint outside the router', { 'scripts/zz_fixture.mjs': "await fetch('https://openrouter.ai/api/v1/chat/completions')" }],
    ['CLAUDE.md loses the "nothing paid" line', { [HOUSE_RULES]: base.read(HOUSE_RULES).replace(/nothing paid/gi, 'kept cheap') }],
    ['CLAUDE.md stops pointing at the policy doc', { [HOUSE_RULES]: base.read(HOUSE_RULES).split(POLICY_DOC).join('docs/cost/elsewhere.md') }],
    ['the policy doc is deleted', { [POLICY_DOC]: null }],
  ];
  const missed = [];
  for (const [name, ov] of cases) if (!check(mk(ov), { reg }).failures.length) missed.push(name);
  const stale = check(mk({ [ROUTING]: JSON.stringify({ ...cfg, snapshot_date: '2020-01-01' }) }), { reg });
  if (stale.failures.length || !stale.warnings.length) missed.push('stale snapshot must warn, not fail');
  return { cases: cases.length + 1, missed };
}

module.exports = { check, selfTest, repoIo, ROUTER, ROUTING, POLICY_DOC, HOUSE_RULES };
