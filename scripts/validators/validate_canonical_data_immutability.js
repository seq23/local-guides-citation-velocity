#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const cp = require('child_process');

const ROOT = path.resolve(__dirname, '..', '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'velocity-canonical-immutability-'));
const sandbox = path.join(tmp, 'repo');
const excludes = new Set(['.git', 'node_modules', '.build', 'dist', 'reports', 'artifacts', 'logs']);

function copySandbox() {
  fs.cpSync(ROOT, sandbox, {
    recursive: true,
    filter: (src) => {
      const rel = path.relative(ROOT, src);
      if (!rel) return true;
      return !rel.split(path.sep).some((part) => excludes.has(part));
    }
  });
}

function read(root, rel) {
  const abs = path.join(root, rel);
  if (!fs.existsSync(abs)) throw new Error(`protected file missing: ${rel}`);
  return fs.readFileSync(abs, 'utf8');
}

try {
  copySandbox();
  const contract = JSON.parse(read(sandbox, 'content/_shared/canonical_data_contract.json'));
  const protectedFiles = contract.protected_files || [];
  const before = new Map(protectedFiles.map((rel) => [rel, read(sandbox, rel)]));

  const result = cp.spawnSync(process.execPath, ['scripts/build_site.js'], {
    cwd: sandbox,
    encoding: 'utf8',
    env: { ...process.env, ALLOW_CANONICAL_DATA_REGEN: '1' },
    maxBuffer: 64 * 1024 * 1024
  });

  if (result.status !== 0) {
    process.stdout.write(result.stdout || '');
    process.stderr.write(result.stderr || '');
    throw new Error('immutability sandbox build failed');
  }

  const changed = protectedFiles.filter((rel) => read(sandbox, rel) !== before.get(rel));
  if (changed.length) {
    throw new Error(`canonical data immutability failed after sandbox build: ${changed.join(', ')}`);
  }

  console.log(`CANONICAL DATA IMMUTABILITY PASS: ${protectedFiles.length} protected files; isolated build left the source workspace untouched.`);
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}
