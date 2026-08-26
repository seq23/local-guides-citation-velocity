#!/usr/bin/env node
'use strict';
/**
 * Page record identity contract.
 *
 * One route must be described by exactly one record. The defect this prevents:
 * a route ends up with two records - a content record carrying the sections and
 * a zero-section stub carrying the route metadata. Both then satisfy any
 * slug-keyed lookup, so which one a consumer sees depends on iteration order,
 * and a repair script that writes "the record for this route" can write into the
 * empty one and fabricate content into a page that already had some.
 *
 * Checks, over content/_live/pages.json and content/_staged/pages.json:
 *   1. no route (path, else slug) is claimed by more than one record
 *   2. a record that owns a path has slug === path, which is the convention the
 *      rest of the corpus follows
 *   3. no admitted record lacks both sections and cluster backing, which would
 *      leave the renderer nothing to build the page from
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const FILES = ['content/_live/pages.json', 'content/_staged/pages.json'];
const EVIDENCE = 'artifacts/validation/page-record-identity.json';

function routeOf(record) {
  return record.path || record.slug || null;
}

function isInsight(record) {
  return typeof record.path === 'string' && record.path.startsWith('/insights/');
}

function checkFile(relPath) {
  const abs = path.join(ROOT, relPath);
  if (!fs.existsSync(abs)) return {file: relPath, status: 'SKIP', reason: 'file absent', failures: []};

  const pages = (JSON.parse(fs.readFileSync(abs, 'utf8')).pages) || [];
  const seen = new Map();
  const failures = [];

  pages.forEach((record, index) => {
    const route = routeOf(record);
    if (!route) {
      failures.push({rule: 'route_missing', index, detail: 'record declares neither path nor slug'});
      return;
    }
    if (seen.has(route)) {
      const first = seen.get(route);
      failures.push({
        rule: 'duplicate_route', route,
        detail: `claimed by record ${first.index} (${first.sections} sections) and record ${index} (${(record.sections || []).length} sections)`,
      });
    } else {
      seen.set(route, {index, sections: (record.sections || []).length});
    }

    // /insights/* records deliberately carry two identities: path is the
    // published insight URL, slug is the cluster-program id. build_site.js
    // filters them out of the atlas for the same reason, so the slug === path
    // convention is asserted only over the atlas records that follow it.
    if (record.path && !isInsight(record) && record.slug !== record.path) {
      failures.push({
        rule: 'slug_path_mismatch', route,
        detail: `slug ${JSON.stringify(record.slug)} does not equal path ${JSON.stringify(record.path)}`,
      });
    }

    // Zero sections is legitimate when the route is cluster-backed: the atlas
    // renderer builds those pages from the cluster registry rather than from
    // record sections. What is never renderable is an admitted record with
    // neither sections nor a cluster to build from.
    const renderable = (record.sections || []).length || record.cluster_id || record.cluster;
    if (record.publication_status === 'ADMITTED' && !renderable) {
      failures.push({
        rule: 'admitted_without_content_source', route,
        detail: 'record is ADMITTED but has neither sections nor cluster backing, so it can only render as a skeleton',
      });
    }
  });

  return {file: relPath, status: failures.length ? 'FAIL' : 'PASS', records: pages.length, failures};
}

const results = FILES.map(checkFile);
const failed = results.filter(r => r.status === 'FAIL');

fs.mkdirSync(path.join(ROOT, path.dirname(EVIDENCE)), {recursive: true});
fs.writeFileSync(
  path.join(ROOT, EVIDENCE),
  `${JSON.stringify({status: failed.length ? 'FAIL' : 'PASS', checked: results}, null, 2)}\n`,
);

for (const r of results) {
  console.log(`[page-record-identity] ${r.status}: ${r.file}${r.records != null ? ` (${r.records} records)` : ''}`);
  for (const f of r.failures.slice(0, 20)) console.log(`    ${f.rule}: ${f.route || `index ${f.index}`} - ${f.detail}`);
  if (r.failures.length > 20) console.log(`    ...and ${r.failures.length - 20} more`);
}

if (failed.length) {
  console.error('PAGE RECORD IDENTITY FAIL');
  process.exit(1);
}
console.log('PAGE RECORD IDENTITY PASS');
