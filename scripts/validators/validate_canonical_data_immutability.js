#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const cp = require('child_process');

const ROOT = path.resolve(__dirname, '..', '..');
const contract = JSON.parse(fs.readFileSync(path.join(ROOT, 'content', '_shared', 'canonical_data_contract.json'), 'utf8'));
const protectedFiles = contract.protected_files || [];

function read(rel) {
  const abs = path.join(ROOT, rel);
  if (!fs.existsSync(abs)) throw new Error(`protected file missing: ${rel}`);
  return fs.readFileSync(abs, 'utf8');
}

const before = new Map(protectedFiles.map(rel => [rel, read(rel)]));

const commands = [
  ['node', ['scripts/build_site.js']]
];

for (const [cmd, args] of commands) {
  const label = `${cmd} ${args.join(' ')}`;
  const result = cp.spawnSync(cmd, args, {
    cwd: ROOT,
    encoding: 'utf8',
    env: { ...process.env, ALLOW_CANONICAL_DATA_REGEN: '' }
  });

  if (result.status !== 0) {
    process.stdout.write(result.stdout || '');
    process.stderr.write(result.stderr || '');
    throw new Error(`immutability command failed: ${label}`);
  }

  const changed = [];
  for (const rel of protectedFiles) {
    const after = read(rel);
    if (after !== before.get(rel)) changed.push(rel);
  }

  if (changed.length) {
    for (const rel of changed) fs.writeFileSync(path.join(ROOT, rel), before.get(rel), 'utf8');
    throw new Error(`canonical data immutability failed after "${label}": ${changed.join(', ')}`);
  }
}

console.log(`CANONICAL DATA IMMUTABILITY PASS: ${protectedFiles.length} protected files`);
