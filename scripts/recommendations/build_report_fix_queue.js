#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..', '..');
const inventoryPath = path.join(ROOT, 'reports', 'velocity_ai_report_inventory.json');
const outPath = path.join(ROOT, 'reports', 'report_fix_queue.json');
const inventory = JSON.parse(fs.readFileSync(inventoryPath, 'utf8'));
const items = (inventory.items || []).filter((item) => item.status === 'new_fix' && item.classification !== 'wrong_repo');
const out = {
  generated_at: new Date().toISOString(),
  repo: inventory.repo,
  items: items.map((item) => ({
    id: item.id,
    vertical: item.vertical,
    intended_url: item.intended_url,
    mapped_slug: item.mapped_slug,
    classification: item.classification,
    status: item.status,
    target_files: item.target_files,
    inspect_first: true,
    write_mode: 'source_only'
  }))
};
fs.writeFileSync(outPath, JSON.stringify(out, null, 2) + '\n', 'utf8');
console.log(`REPORT FIX QUEUE BUILT: ${out.items.length} items`);
