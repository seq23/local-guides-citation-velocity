#!/usr/bin/env node
/* eslint-disable no-console */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const STATE = path.join(ROOT, 'content', '_shared', 'release_state.json');
const LIVE = path.join(ROOT, 'content', '_live', 'medium_articles.json');

function readJson(p) {
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

function writeJson(p, o) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(o, null, 2) + '\n', 'utf8');
}

function walk(dir) {
  if (!fs.existsSync(dir)) return [];
  const out = [];
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const fp = path.join(dir, ent.name);
    if (ent.isDirectory()) out.push(...walk(fp));
    else out.push(fp);
  }
  return out;
}

function scan() {
  const dir = path.join(ROOT, 'medium-articles');
  return walk(dir)
    .filter((fp) => fp.endsWith(`${path.sep}index.html`) || fp.endsWith('/index.html'))
    .map((fp) =>
      path
        .relative(ROOT, fp)
        .replace(/\\/g, '/')
        .replace(/\/index\.html$/, '/')
    )
    .sort();
}

function ensureLiveShape(live) {
  if (!live || typeof live !== 'object') live = {};
  if (!Array.isArray(live.items)) live.items = [];
  live.released_count = Number(live.released_count || live.items.length || 0);
  live.total = Number(live.total || live.items.length || 0);
  return live;
}

function ensureStateShape(state) {
  if (!state || typeof state !== 'object') state = {};
  if (!state.live || typeof state.live !== 'object') state.live = {};
  if (!state.live.medium_articles || typeof state.live.medium_articles !== 'object') {
    state.live.medium_articles = {};
  }
  if (!Array.isArray(state.live.medium_articles.released_paths)) {
    state.live.medium_articles.released_paths = [];
  }
  state.live.medium_articles.released_count = Number(
    state.live.medium_articles.released_count ||
      state.live.medium_articles.released_paths.length ||
      0
  );
  return state;
}

function main() {
  const batchSize = Number(process.argv[2] || 1);

  const state = ensureStateShape(readJson(STATE));
  const live = ensureLiveShape(readJson(LIVE));

  const allPaths = scan();
  const releasedSet = new Set(state.live.medium_articles.released_paths || []);

  const unreleased = allPaths.filter((p) => !releasedSet.has(p));
  const toRelease = unreleased.slice(0, Math.max(0, batchSize));

  for (const relPath of toRelease) {
    releasedSet.add(relPath);
    if (!live.items.some((x) => String(x.publish_path || '') === relPath)) {
      live.items.push({ publish_path: relPath });
    }
  }

  live.items.sort((a, b) =>
    String(a.publish_path || '').localeCompare(String(b.publish_path || ''))
  );
  live.released_count = live.items.length;
  live.total = allPaths.length;

  state.live.medium_articles.released_paths = Array.from(releasedSet).sort();
  state.live.medium_articles.released_count = state.live.medium_articles.released_paths.length;
  state.live.medium_articles.total = allPaths.length;

  writeJson(LIVE, live);
  writeJson(STATE, state);

  console.log(
    `Released medium articles: ${state.live.medium_articles.released_count}/${allPaths.length} (added ${toRelease.length}).`
  );
}

main();
