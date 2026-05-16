#!/usr/bin/env node
/* eslint-disable no-console */
'use strict';

const fs = require('fs');
const path = require('path');

const root = process.cwd();
const ledgerRel = 'data/report_fixes/velocity_citation_agent_2026_05.json';
const ledgerPath = path.join(root, ledgerRel);
const failures = [];

function exists(rel) {
  return fs.existsSync(path.join(root, rel));
}

function read(rel) {
  const abs = path.join(root, rel);
  if (!fs.existsSync(abs)) {
    failures.push(`${rel} missing`);
    return '';
  }
  return fs.readFileSync(abs, 'utf8');
}

function normalizeMarkerList(value) {
  return Array.from(new Set((Array.isArray(value) ? value : []).filter(Boolean).map(String)));
}

function recordFailure(id, layer, rel, marker) {
  failures.push(`${id} ${layer} missing marker in ${rel}: ${marker}`);
}

function checkLayer({ id, layer, rel, markers }) {
  const text = read(rel);
  if (!text) return false;
  let ok = true;
  for (const marker of markers) {
    if (!text.includes(marker)) {
      recordFailure(id, layer, rel, marker);
      ok = false;
    }
  }
  return ok;
}

function traceRecord(fix) {
  const id = fix.id || fix.url || fix.renderedPath || 'unnamed-fix';
  const renderedPath = fix.renderedPath || String(fix.url || '').replace(/^https?:\/\/[^/]+\//, '').replace(/\/$/, '/index.html');
  const sourceFiles = Array.isArray(fix.sourceFiles) && fix.sourceFiles.length
    ? fix.sourceFiles
    : Array.isArray(fix.source_target)
      ? fix.source_target.map((item) => String(item).split(':')[0]).filter((item) => item.endsWith('.json'))
      : [];

  const sourceMarkers = normalizeMarkerList(fix.requiredSourceMarkers || fix.required_markers);
  const liveMarkers = normalizeMarkerList(fix.requiredLiveMarkers || fix.required_markers);
  const stagedMarkers = normalizeMarkerList(fix.requiredStagedMarkers || fix.required_markers);
  const renderedMarkers = normalizeMarkerList(fix.requiredRenderedMarkers || fix.required_markers);

  const traceLines = [];
  let ok = true;

  if (!sourceFiles.length) {
    failures.push(`${id} SOURCE missing sourceFiles declaration`);
    ok = false;
  } else {
    for (const sourceFile of sourceFiles) {
      ok = checkLayer({ id, layer: 'SOURCE', rel: sourceFile, markers: sourceMarkers }) && ok;
    }
  }

  const livePath = fix.liveManifestPath || 'content/_live/pages.json';
  const stagedPath = fix.stagedManifestPath || 'content/_staged/pages.json';
  ok = checkLayer({ id, layer: 'LIVE MANIFEST', rel: livePath, markers: liveMarkers }) && ok;
  ok = checkLayer({ id, layer: 'STAGED MANIFEST', rel: stagedPath, markers: stagedMarkers }) && ok;

  if (!renderedPath || !exists(renderedPath)) {
    failures.push(`${id} RENDERED HTML missing renderedPath: ${renderedPath || '(none)'}`);
    ok = false;
  } else {
    ok = checkLayer({ id, layer: 'RENDERED HTML', rel: renderedPath, markers: renderedMarkers }) && ok;
  }

  traceLines.push(`TRACE ${id}: ${ok ? 'PASS' : 'FAIL'}`);
  console.log(traceLines.join('\n'));
}

const ledgerText = read(ledgerRel);
if (ledgerText) {
  let ledger;
  try {
    ledger = JSON.parse(ledgerText);
  } catch (err) {
    failures.push(`${ledgerRel} invalid JSON: ${err.message}`);
  }

  if (ledger) {
    const fixes = Array.isArray(ledger.fixes) ? ledger.fixes : [];
    const traceFixes = fixes.filter((fix) => fix.trace_required || fix.renderedPath || fix.sourceFiles);
    if (!traceFixes.length) failures.push('No trace-enabled citation-agent fixes found in ledger');
    for (const fix of traceFixes) traceRecord(fix);
  }
}

if (failures.length) {
  console.error('Citation-agent source-to-render trace FAIL');
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exit(1);
}

console.log('Citation-agent source-to-render trace PASS');
