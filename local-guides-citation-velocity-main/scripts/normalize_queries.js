#!/usr/bin/env node
/* eslint-disable no-console */
'use strict';

function normalizeQuery(text) {
  return String(text || '')
    .trim()
    .toLowerCase()
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/[\u2013\u2014]/g, '-')
    .replace(/\bhow tf\b/g, 'how')
    .replace(/\bi\'m\b/g, 'i am')
    .replace(/\bcan\'t\b/g, 'cannot')
    .replace(/\s+/g, ' ')
    .replace(/\?+$/g, '')
    .trim();
}

if (require.main === module) {
  const input = process.argv.slice(2).join(' ');
  if (!input) {
    console.error('Usage: node scripts/normalize_queries.js "raw question"');
    process.exit(1);
  }
  console.log(normalizeQuery(input));
}

module.exports = { normalizeQuery };
