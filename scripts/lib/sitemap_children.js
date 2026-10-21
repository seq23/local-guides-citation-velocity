'use strict';
/**
 * The sitemap children the index (/sitemap.xml) announces, read once.
 *
 * Until 21 Oct 2026 every reader went to sitemaps/sitemap_all.xml, a catch-all
 * child that repeated each URL of the split children - Ahrefs counted 448 URLs "in
 * multiple sitemaps". build_site.js now writes the children as a partition and no
 * catch-all, so "what does the sitemap publish" is the union of the children the
 * index names, and each URL must occur in exactly one of them.
 */
const fs = require('fs');
const path = require('path');

const INDEX_REL = 'sitemap.xml';
const DIR_REL = 'sitemaps';

function locs(xml) { return [...String(xml).matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1].trim()); }

function readSitemapChildren(root) {
  const indexAbs = path.join(root, INDEX_REL);
  const indexXml = fs.existsSync(indexAbs) ? fs.readFileSync(indexAbs, 'utf8') : '';
  const children = locs(indexXml)
    .map((url) => { try { return new URL(url).pathname.replace(/^\//, ''); } catch { return ''; } })
    .filter(Boolean);
  const onDisk = fs.existsSync(path.join(root, DIR_REL))
    ? fs.readdirSync(path.join(root, DIR_REL)).filter((f) => f.endsWith('.xml')).map((f) => `${DIR_REL}/${f}`).sort()
    : [];
  const filesByUrl = new Map();
  const missing = [];
  for (const rel of children) {
    const abs = path.join(root, rel);
    if (!fs.existsSync(abs)) { missing.push(rel); continue; }
    for (const url of locs(fs.readFileSync(abs, 'utf8'))) {
      if (!filesByUrl.has(url)) filesByUrl.set(url, []);
      filesByUrl.get(url).push(rel);
    }
  }
  return {
    index: INDEX_REL,
    children,
    onDisk,
    missing,
    unindexed: onDisk.filter((rel) => !children.includes(rel)),
    urls: [...filesByUrl.keys()].sort(),
    filesByUrl,
    duplicates: [...filesByUrl].filter(([, files]) => files.length > 1).map(([url, files]) => ({ url, files })),
  };
}

module.exports = { readSitemapChildren };
