#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
node <<'NODE'
const fs = require('fs');
const path = require('path');
const root = process.cwd();
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'content/_shared/executable_files.json'), 'utf8'));
for (const rel of manifest.files || []) {
  const fp = path.join(root, rel);
  if (fs.existsSync(fp)) {
    fs.chmodSync(fp, 0o755);
    console.log(`chmod 755 ${rel}`);
  }
}
NODE
