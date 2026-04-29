#!/usr/bin/env node
'use strict';
const { readJson, writeJsonChecked, slugify } = require('./lib/llm_utils');
const manifest = readJson('content/_live/insights.json', null);
if (!manifest || !Array.isArray(manifest.items)) throw new Error('content/_live/insights.json missing items; run build before answer block extraction');
const blocks = manifest.items.map((item) => {
  const answer = [item.answer, item.description, item.page_description].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
  return {
    id: slugify(item.slug || item.publish_path),
    source_path: String(item.publish_path || '').replace(/^\//, ''),
    url: item.publish_path,
    title: item.title || item.slug,
    vertical: item.vertical || null,
    cluster: item.cluster || null,
    answer_block: answer.slice(0, 1400)
  };
}).filter((x) => x.url && x.answer_block);
if (!blocks.length) throw new Error('No answer blocks extracted from content/_live/insights.json');
writeJsonChecked('dist/llm/answer_blocks.json', blocks);
console.log(`Extracted ${blocks.length} answer blocks`);
