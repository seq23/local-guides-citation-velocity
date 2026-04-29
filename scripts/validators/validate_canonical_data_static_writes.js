#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const contract = JSON.parse(fs.readFileSync(path.join(ROOT, 'content', '_shared', 'canonical_data_contract.json'), 'utf8'));
const protectedFiles = contract.protected_files || [];

const allowed = new Set([
  'scripts/lib/canonical_data_guard.js',
  'scripts/validators/validate_canonical_data_static_writes.js',
  'scripts/validators/validate_canonical_data_immutability.js'
]);

function walk(dir) {
  if (!fs.existsSync(dir)) return [];
  const out = [];
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) out.push(...walk(p));
    else out.push(p);
  }
  return out;
}

function stripComments(s) {
  return s
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '');
}

const offenders = [];

for (const abs of walk(path.join(ROOT, 'scripts')).filter(f => f.endsWith('.js'))) {
  const rel = path.relative(ROOT, abs).replace(/\\/g, '/');
  if (allowed.has(rel)) continue;

  const text = stripComments(fs.readFileSync(abs, 'utf8'));

  for (const protectedFile of protectedFiles) {
    const base = path.basename(protectedFile);

    const directProtectedWrite =
      new RegExp(`writeFileSync\\s*\\([^\\)]*${protectedFile.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 's').test(text) ||
      new RegExp(`writeFileSync\\s*\\([^\\)]*${base.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 's').test(text) ||
      new RegExp(`writeUtf8\\s*\\([^\\)]*${protectedFile.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 's').test(text) ||
      new RegExp(`writeUtf8\\s*\\([^\\)]*${base.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 's').test(text) ||
      new RegExp(`writeJson\\s*\\([^\\)]*${protectedFile.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 's').test(text) ||
      new RegExp(`writeJson\\s*\\([^\\)]*${base.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 's').test(text);

    if (directProtectedWrite && !text.includes('guardedWriteUtf8') && !text.includes('guardedWriteJson') && !text.includes('assertCanWriteCanonical')) {
      offenders.push(`${rel} direct write risk: ${protectedFile}`);
    }
  }
}

if (offenders.length) {
  console.error('CANONICAL DATA STATIC WRITE CHECK FAILED');
  offenders.forEach(x => console.error('- ' + x));
  process.exit(1);
}

console.log('CANONICAL DATA STATIC WRITE CHECK PASS');
