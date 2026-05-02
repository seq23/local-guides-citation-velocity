#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..', '..');
const queue = JSON.parse(fs.readFileSync(path.join(ROOT, 'reports', 'report_fix_queue.json'), 'utf8'));
const inspect = process.argv.includes('--inspect');
if (inspect) {
  const summary = queue.items.map((item) => ({ id: item.id, mapped_slug: item.mapped_slug, target_files: item.target_files }));
  console.log(JSON.stringify({ mode: 'inspect', items: summary }, null, 2));
  process.exit(0);
}
console.log('This lane applies source-layer fixes only. Use repo execution passes to modify source files, then rebuild.');
