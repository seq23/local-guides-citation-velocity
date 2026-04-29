'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const CONTRACT_PATH = path.join(ROOT, 'content', '_shared', 'canonical_data_contract.json');

function loadContract() {
  if (!fs.existsSync(CONTRACT_PATH)) {
    return {
      protected_files: [
        'content/_shared/query_cluster_registry.json',
        'content/_shared/query_to_cluster_map.json',
        'content/_shared/atlas_registry.json'
      ],
      allowed_intentional_mutation_env: 'ALLOW_CANONICAL_DATA_REGEN'
    };
  }
  return JSON.parse(fs.readFileSync(CONTRACT_PATH, 'utf8'));
}

function normalizeRel(filePath) {
  const abs = path.isAbsolute(filePath) ? filePath : path.resolve(ROOT, filePath);
  return path.relative(ROOT, abs).replace(/\\/g, '/');
}

function assertCanWriteCanonical(filePath, reason = '') {
  const contract = loadContract();
  const protectedFiles = new Set(contract.protected_files || []);
  const envName = contract.allowed_intentional_mutation_env || 'ALLOW_CANONICAL_DATA_REGEN';
  const rel = normalizeRel(filePath);

  if (!protectedFiles.has(rel)) return;
  if (process.env[envName] === '1') return;

  throw new Error(
    `CANONICAL DATA WRITE BLOCKED: ${rel}` +
    (reason ? ` (${reason})` : '') +
    `\nSet ${envName}=1 only for intentional canonical-regeneration scripts.`
  );
}

function guardedWriteUtf8(filePath, content, reason = '') {
  assertCanWriteCanonical(filePath, reason);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, 'utf8');
}

function guardedWriteJson(filePath, payload, reason = '') {
  guardedWriteUtf8(filePath, JSON.stringify(payload, null, 2) + '\n', reason);
}

module.exports = {
  ROOT,
  CONTRACT_PATH,
  loadContract,
  normalizeRel,
  assertCanWriteCanonical,
  guardedWriteUtf8,
  guardedWriteJson
};
