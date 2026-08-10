#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const root = process.cwd();
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const scripts = pkg.scripts || {};
const workflowsDir = path.join(root, '.github', 'workflows');
const workflowFiles = fs.existsSync(workflowsDir)
  ? fs.readdirSync(workflowsDir).filter(f => /\.ya?ml$/.test(f)).sort()
  : [];
const errors = [];
const warnings = [];
const workflows = [];

function existsRel(rel) { return fs.existsSync(path.join(root, rel)); }
function extractCommands(text) {
  const out = [];
  const lines = text.split(/\r?\n/);
  let block = null;
  let blockIndent = -1;
  for (const raw of lines) {
    const indent = raw.match(/^\s*/)[0].length;
    const line = raw.trim();
    if (block !== null) {
      if (line && indent <= blockIndent) { out.push(block.trim()); block = null; blockIndent = -1; }
      else { block += `\n${line}`; continue; }
    }
    const runBlock = raw.match(/^(\s*)run:\s*[|>]\s*$/);
    if (runBlock) { block = ''; blockIndent = runBlock[1].length; continue; }
    const run = line.match(/^run:\s*(.+)$/);
    if (run) out.push(run[1].replace(/^['"]|['"]$/g, ''));
  }
  if (block !== null) out.push(block.trim());
  return [...new Set(out.filter(Boolean))];
}
function resolveScriptClosure(initial) {
  const queue = [...initial];
  const seen = new Set();
  const missing = [];
  const commandRows = [];
  while (queue.length) {
    const name = queue.shift();
    if (seen.has(name)) continue;
    seen.add(name);
    const command = scripts[name];
    if (!command) { missing.push(name); continue; }
    commandRows.push({ script: name, command });
    for (const m of command.matchAll(/npm\s+run\s+([A-Za-z0-9:_-]+)/g)) queue.push(m[1]);
  }
  return { scripts: [...seen].sort(), missing: [...new Set(missing)].sort(), commands: commandRows };
}
function directNpmScripts(commands) {
  return [...new Set(commands.flatMap(cmd => [...cmd.matchAll(/npm\s+run\s+([A-Za-z0-9:_-]+)/g)].map(m => m[1])))].sort();
}
function verifyFileTokens(command, checks) {
  for (const m of command.matchAll(/(?:node|python3|bash)\s+([^\s;&|]+\.(?:mjs|js|py|sh))/g)) {
    const file = m[1].replace(/^\.\//, '');
    const ok = existsRel(file);
    checks.push({ type: 'file', path: file, ok });
  }
}
function verifyCommand(cmd) {
  const result = { command: cmd, status: 'PASS', checks: [] };
  const direct = directNpmScripts([cmd]);
  const closure = resolveScriptClosure(direct);
  for (const name of direct) result.checks.push({ type: 'npm_script', name, ok: Boolean(scripts[name]) });
  for (const name of closure.missing) result.checks.push({ type: 'transitive_npm_script', name, ok: false });
  verifyFileTokens(cmd, result.checks);
  for (const row of closure.commands) verifyFileTokens(row.command, result.checks);
  result.direct_npm_scripts = direct;
  result.transitive_npm_scripts = closure.scripts;
  result.status = result.checks.some(x => !x.ok) ? 'FAIL' : 'PASS';
  return result;
}
function lifecycleCheck(id, fn) {
  try { fn(); return { id, status: 'PASS' }; }
  catch (error) { errors.push(`lifecycle:${id}:${error.message}`); return { id, status: 'FAIL', error: error.message }; }
}
function assert(value, message) { if (!value) throw new Error(message); }

for (const file of workflowFiles) {
  const rel = `.github/workflows/${file}`;
  const text = fs.readFileSync(path.join(root, rel), 'utf8');
  const commands = extractCommands(text);
  const commandTraces = commands.map(verifyCommand);
  const wfErrors = commandTraces.flatMap(c => c.checks.filter(ch => !ch.ok).map(ch => `${file}:${ch.type}:${ch.name || ch.path}:missing`));
  errors.push(...wfErrors);
  workflows.push({ workflow: file, command_count: commands.length, status: wfErrors.length ? 'FAIL' : 'PASS', commands: commandTraces });
}

const velocityWorkflow = fs.readFileSync(path.join(workflowsDir, 'velocity-content-release.yml'), 'utf8');
const velocityCommands = extractCommands(velocityWorkflow);
const velocityClosure = resolveScriptClosure(directNpmScripts(velocityCommands));
const searchSource = fs.readFileSync(path.join(root, 'scripts/search_intelligence/search_intelligence.js'), 'utf8');
const clickSource = fs.readFileSync(path.join(root, 'scripts/browser/public_click_audit.js'), 'utf8');
const L = require(path.join(root, 'scripts/search_intelligence/lib.js'));
const { classifyConsoleError } = require(path.join(root, 'scripts/browser/console_error_policy.js'));

const lifecycle = [
  lifecycleCheck('velocity-agent-manifest-trigger-is-bounded', () => {
    assert(velocityWorkflow.includes('data/report_fixes/agent_runs/**/agent_run_manifest.json'), 'agent manifest push path missing');
    assert(velocityWorkflow.includes('npm run release:velocity-intake'), 'consolidated Velocity intake missing');
  }),
  lifecycleCheck('velocity-intake-resolves-through-provenance-and-finalization', () => {
    for (const name of ['validate:agent-run-intake','citation:prepare-velocity-intake','release:content-finalize','validate:velocity-intake-workflow','trace:agent-artifact-data-flow']) {
      assert(velocityClosure.scripts.includes(name), `transitive intake stage missing:${name}`);
    }
  }),
  lifecycleCheck('search-intelligence-runtime-protected-tree-guard-is-wired', () => {
    assert(searchSource.includes('const protectedBefore=protectedAgentSnapshot()'), 'before snapshot missing');
    assert(searchSource.includes('assertProtectedAgentSnapshotUnchanged(protectedBefore,protectedAgentSnapshot())'), 'after snapshot enforcement missing');
  }),
  lifecycleCheck('search-intelligence-guard-allows-preexisting-agent-addition', () => {
    assert(L.assertProtectedAgentSnapshotUnchanged([{path:'old',sha256:'a'},{path:'new-agent',sha256:'b'}],[{path:'old',sha256:'a'},{path:'new-agent',sha256:'b'}]) === true, 'legitimate preexisting addition rejected');
  }),
  lifecycleCheck('search-intelligence-guard-rejects-protected-mutation', () => {
    let blocked = false;
    try { L.assertProtectedAgentSnapshotUnchanged([{path:'agent',sha256:'a'}],[{path:'agent',sha256:'b'}]); } catch (e) { blocked = e.code === 'SEARCH_INTELLIGENCE_PROTECTED_AGENT_MUTATION'; }
    assert(blocked, 'protected byte mutation not blocked');
  }),
  lifecycleCheck('search-intelligence-guard-rejects-new-protected-file-during-run', () => {
    let blocked = false;
    try { L.assertProtectedAgentSnapshotUnchanged([{path:'agent',sha256:'a'}],[{path:'agent',sha256:'a'},{path:'rogue',sha256:'x'}]); } catch (e) { blocked = e.code === 'SEARCH_INTELLIGENCE_PROTECTED_AGENT_MUTATION'; }
    assert(blocked, 'new protected file during Search Intelligence not blocked');
  }),
  lifecycleCheck('postdeploy-cloudflare-telemetry-is-warning-only', () => {
    const msg = `Loading the script 'https://static.cloudflareinsights.com/beacon.min.js/v123' violates the following Content Security Policy directive: "script-src 'self'". The action has been blocked.`;
    assert(classifyConsoleError(msg).severity === 'WARNING', 'known provider telemetry CSP event not warning');
    assert(clickSource.includes('provider_console_warnings'), 'audit does not record provider warning separately');
  }),
  lifecycleCheck('postdeploy-first-party-console-error-still-blocks', () => {
    assert(classifyConsoleError('Uncaught TypeError: app is not a function').severity === 'BLOCK', 'first-party console error downgraded');
  })
];

const report = {
  schema_version: '2.0',
  generated_at: new Date().toISOString(),
  status: errors.length ? 'FAIL' : 'PASS',
  workflow_count: workflowFiles.length,
  errors,
  warnings,
  lifecycle_checks: lifecycle,
  workflows
};
fs.mkdirSync(path.join(root, 'reports'), {recursive: true});
fs.writeFileSync(path.join(root, 'reports', 'deep-workflow-data-trace.json'), JSON.stringify(report, null, 2) + '\n');
fs.mkdirSync(path.join(root, 'artifacts', 'validation'), {recursive: true});
fs.writeFileSync(path.join(root, 'artifacts', 'validation', 'deep-workflow-data-trace.json'), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2));
if (errors.length) process.exit(1);
