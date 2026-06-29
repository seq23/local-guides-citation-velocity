#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const ROOT = process.cwd();
const limit = Number.parseInt(process.env.INDEXNOW_SAFE_BATCH_LIMIT || '100', 10);
const max = Number.isFinite(limit) && limit > 0 ? limit : 100;
const errors = [];
for (const file of ['.build/indexnow-priority.txt', '.build/indexnow-batch.txt']) {
  const p = path.join(ROOT, file);
  if (!fs.existsSync(p)) continue;
  const urls = fs.readFileSync(p, 'utf8').split(/\r?\n/).map(s => s.trim()).filter(Boolean);
  const budget = file.includes('priority') ? 50 : max;
  if (urls.length > budget) errors.push(`${file} has ${urls.length} URLs; max ${budget}`);
  for (const u of urls) { try { const parsed = new URL(u); if (!/^https?:$/.test(parsed.protocol)) errors.push(`${file} invalid protocol: ${u}`); } catch { errors.push(`${file} invalid URL: ${u}`); } }
}
if (errors.length) { console.error(JSON.stringify({status:'FAIL', errors}, null, 2)); process.exit(1); }
console.log(JSON.stringify({status:'PASS', maxBatch:max}, null, 2));

if (!process.exitCode) {
  const outDir = path.join(ROOT, 'artifacts', 'validation');
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, 'indexnow-batch-budget.json'), JSON.stringify({
    status: 'PASS',
    validator: 'indexnow-batch-budget',
    maxBatch: max,
    generated_at: new Date().toISOString()
  }, null, 2) + '\n');
}
