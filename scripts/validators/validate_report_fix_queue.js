#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const inventoryPath = path.join(ROOT, 'reports', 'velocity_ai_report_inventory.json');
const queuePath = path.join(ROOT, 'reports', 'report_fix_queue.json');

if (!fs.existsSync(inventoryPath)) throw new Error('missing velocity_ai_report_inventory.json');
if (!fs.existsSync(queuePath)) throw new Error('missing report_fix_queue.json');

const inventory = JSON.parse(fs.readFileSync(inventoryPath, 'utf8'));
const queue = JSON.parse(fs.readFileSync(queuePath, 'utf8'));

const expectedItems = (inventory.items || []).filter((item) => item.status === 'new_fix' && item.classification !== 'wrong_repo');
const queueItems = Array.isArray(queue.items) ? queue.items : [];

if (!queueItems.length) throw new Error('report fix queue is empty');
if (queueItems.length !== expectedItems.length) {
  throw new Error(`report fix queue drift: expected ${expectedItems.length} actionable items, found ${queueItems.length}`);
}

const expectedById = new Map(expectedItems.map((item) => [item.id, item]));
for (const item of queueItems) {
  if (!item.id) throw new Error('queue item missing id');
  const expected = expectedById.get(item.id);
  if (!expected) throw new Error(`queue item not backed by actionable inventory row: ${item.id}`);
  if (item.inspect_first !== true) throw new Error(`queue item must enforce inspect_first=true: ${item.id}`);
  if (item.write_mode !== 'source_only') throw new Error(`queue item must enforce write_mode=source_only: ${item.id}`);
  if (item.mapped_slug !== expected.mapped_slug) throw new Error(`queue mapped_slug drift for ${item.id}`);
  if (!Array.isArray(item.target_files) || !item.target_files.length) throw new Error(`queue item missing target_files: ${item.id}`);
  if (JSON.stringify(item.target_files) != JSON.stringify(expected.target_files)) {
    throw new Error(`queue target_files drift for ${item.id}`);
  }
  for (const rel of item.target_files) {
    const full = path.join(ROOT, rel);
    if (!fs.existsSync(full)) throw new Error(`queue target missing on disk for ${item.id}: ${rel}`);
  }
}

console.log(`REPORT FIX QUEUE PASS: ${queueItems.length} items checked against inventory`);
