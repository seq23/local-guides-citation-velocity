#!/usr/bin/env node
/* eslint-disable no-console */
'use strict';

function dedupeByNormalized(items) {
  const seen = new Map();
  const unique = [];
  const duplicates = [];
  for (const item of items || []) {
    const key = `${item.vertical}::${item.normalized_query}`;
    if (seen.has(key)) {
      duplicates.push({ kept: seen.get(key), dropped: item });
      continue;
    }
    seen.set(key, item.id || item.query || key);
    unique.push(item);
  }
  return { unique, duplicates };
}

module.exports = { dedupeByNormalized };
