#!/usr/bin/env node
/* eslint-disable no-console */
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const staged = JSON.parse(fs.readFileSync(path.join(ROOT,'content','_staged','pages.json'),'utf8')).pages || [];
const live = JSON.parse(fs.readFileSync(path.join(ROOT,'content','_live','pages.json'),'utf8')).pages || [];
const stagedSet = new Set(staged.map((p) => p.slug));
const liveSet = new Set(live.map((p) => p.slug));
const missing = [...stagedSet].filter((slug) => !liveSet.has(slug));
const extra = [...liveSet].filter((slug) => !stagedSet.has(slug));
if (missing.length || extra.length) {
  throw new Error(`Release batch surface drift: missing=${missing.slice(0,10).join(', ') || 'none'} extra=${extra.slice(0,10).join(', ') || 'none'}`);
}
console.log(`Release batch surface contract passed (${liveSet.size} live structural pages == staged set).`);
