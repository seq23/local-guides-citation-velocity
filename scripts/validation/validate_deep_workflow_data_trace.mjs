#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

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
  for (const raw of lines) {
    const line = raw.trim();
    const run = line.match(/^run:\s*(.+)$/);
    if (run && !/[|>]\s*$/.test(run[1])) out.push(run[1].replace(/^['"]|['"]$/g, ''));
    const npm = line.match(/npm\s+run\s+([A-Za-z0-9:_-]+)/g);
    if (npm) out.push(...npm);
    const node = line.match(/(?:^|\s)(node\s+[^&|;]+)/);
    if (node) out.push(node[1].trim());
    const py = line.match(/(?:^|\s)(python3\s+[^&|;]+)/);
    if (py) out.push(py[1].trim());
    const bash = line.match(/(?:^|\s)(bash\s+[^&|;]+)/);
    if (bash) out.push(bash[1].trim());
  }
  return [...new Set(out)].filter(Boolean);
}
function verifyCommand(cmd) {
  const result = {command: cmd, status: 'PASS', checks: []};
  for (const m of cmd.matchAll(/npm\s+run\s+([A-Za-z0-9:_-]+)/g)) {
    const name = m[1];
    const ok = Boolean(scripts[name]);
    result.checks.push({type: 'npm_script', name, ok});
    if (!ok) result.status = 'FAIL';
  }
  for (const m of cmd.matchAll(/(?:node|python3|bash)\s+([^\s]+\.(?:mjs|js|py|sh))/g)) {
    const file = m[1].replace(/^\.\//, '');
    const ok = existsRel(file);
    result.checks.push({type: 'file', path: file, ok});
    if (!ok) result.status = 'FAIL';
  }
  return result;
}
for (const file of workflowFiles) {
  const rel = `.github/workflows/${file}`;
  const text = fs.readFileSync(path.join(root, rel), 'utf8');
  const commands = extractCommands(text);
  const commandTraces = commands.map(verifyCommand);
  const wfErrors = commandTraces.flatMap(c => c.checks.filter(ch => !ch.ok).map(ch => `${file}:${ch.type}:${ch.name || ch.path}:missing`));
  errors.push(...wfErrors);
  workflows.push({workflow: file, command_count: commands.length, status: wfErrors.length ? 'FAIL' : 'PASS', commands: commandTraces});
}
const report = {
  schema_version: '1.0',
  generated_at: new Date().toISOString(),
  status: errors.length ? 'FAIL' : 'PASS',
  workflow_count: workflowFiles.length,
  errors,
  warnings,
  workflows
};
fs.mkdirSync(path.join(root, 'reports'), {recursive: true});
fs.writeFileSync(path.join(root, 'reports', 'deep-workflow-data-trace.json'), JSON.stringify(report, null, 2) + '\n');
fs.mkdirSync(path.join(root, 'artifacts', 'validation'), {recursive: true});
fs.writeFileSync(path.join(root, 'artifacts', 'validation', 'deep-workflow-data-trace.json'), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2));
if (errors.length) process.exit(1);
