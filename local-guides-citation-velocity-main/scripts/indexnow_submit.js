#!/usr/bin/env node
/* eslint-disable no-console */
'use strict';

const fs = require('fs');
const path = require('path');
const https = require('https');
const { execSync } = require('child_process');

const HOST = process.env.INDEXNOW_HOST || 'theindustryguides.com';
const KEY_PATH = process.env.INDEXNOW_KEY_PATH || path.join(process.cwd(), 'indexnow.txt');
const INVENTORY_PATH = process.env.INDEXNOW_PUBLISHED_URLS || path.join(process.cwd(), 'content', '_live', 'published_urls.json');
const PREV_INVENTORY_PATH = process.env.INDEXNOW_PREVIOUS_PUBLISHED_URLS || path.join(process.cwd(), '.build', 'published_urls.previous.json');
const DRY_RUN = /^(1|true|yes|y|on)$/i.test(String(process.env.INDEXNOW_DRY_RUN || process.env.INDEXNOW_DRY || ''));
const ENDPOINT = process.env.INDEXNOW_ENDPOINT || 'https://www.bing.com/indexnow';
const MODE = String(process.env.INDEXNOW_MODE || 'full').toLowerCase();

function readText(p) { return fs.readFileSync(p, 'utf8'); }
function fileExists(p) { try { fs.accessSync(p, fs.constants.F_OK); return true; } catch { return false; } }
function uniq(arr) { return Array.from(new Set(arr)); }
function chunk(arr, size) { const out = []; for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size)); return out; }
function loadInventory(p) {
  if (!fileExists(p)) return [];
  try {
    const payload = JSON.parse(readText(p));
    return Array.isArray(payload.items) ? payload.items.map((item) => item.url).filter(Boolean) : [];
  } catch {
    return [];
  }
}
function urlsFromChangedFiles(files, currentInventory) {
  const out = [];
  const inventoryByPath = new Map();
  currentInventory.forEach((url) => inventoryByPath.set(new URL(url).pathname, url));
  for (const raw of files) {
    const f = String(raw || '').trim().replace(/\\/g, '/');
    if (!f || f.startsWith('.git/')) continue;
    let pathCandidate = null;
    if (f.endsWith('/index.html')) pathCandidate = '/' + f.replace(/\/index\.html$/i, '/');
    else if (f.endsWith('.html') || f === 'robots.txt' || f === 'feed.xml' || f === 'feed.json' || f.endsWith('.xml')) pathCandidate = '/' + f.replace(/^\/+/, '');
    if (pathCandidate && inventoryByPath.has(pathCandidate)) out.push(inventoryByPath.get(pathCandidate));
  }
  return out;
}
function computeDeletionUrls(previousInventory, currentInventory) {
  const current = new Set(currentInventory);
  return previousInventory.filter((url) => !current.has(url));
}
function postJson(url, body) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const data = Buffer.from(JSON.stringify(body), 'utf8');
    const req = https.request({
      protocol: u.protocol,
      hostname: u.hostname,
      path: u.pathname + (u.search || ''),
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': data.length }
    }, (res) => {
      const chunks = [];
      res.on('data', (d) => chunks.push(d));
      res.on('end', () => resolve({ statusCode: res.statusCode, body: Buffer.concat(chunks).toString('utf8') }));
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

(async function main() {
  try {
    if (!fileExists(KEY_PATH)) { console.log(`[IndexNow] SKIP: key file missing at ${KEY_PATH}`); process.exit(0); }
    const key = readText(KEY_PATH).trim();
    if (!key) { console.log('[IndexNow] SKIP: key is empty'); process.exit(0); }

    const currentInventory = uniq(loadInventory(INVENTORY_PATH)).filter((u) => u.startsWith(`https://${HOST}/`));
    if (!currentInventory.length) { console.log('[IndexNow] SKIP: published URL inventory is empty'); process.exit(0); }

    let urls = currentInventory.slice();
    if (MODE === 'delta') {
      try {
        const changed = String(execSync('git diff --cached --name-only --diff-filter=AM', { encoding: 'utf8' }) || '')
          .split('\n').map((x) => x.trim()).filter(Boolean);
        urls = uniq(urlsFromChangedFiles(changed, currentInventory));
        console.log(`[IndexNow] MODE=delta staged_files=${changed.length} urls=${urls.length}`);
      } catch {
        console.log('[IndexNow] MODE=delta NOTE: unable to read staged diff; falling back to full inventory');
      }
    }

    const deletionUrls = MODE === 'delta' ? uniq(computeDeletionUrls(loadInventory(PREV_INVENTORY_PATH), currentInventory)).filter((u) => u.startsWith(`https://${HOST}/`)) : [];
    const submitUrls = uniq(urls.concat(deletionUrls));
    if (!submitUrls.length) { console.log('[IndexNow] SKIP: no URLs found to submit'); process.exit(0); }

    const batches = chunk(submitUrls, 200);
    console.log(`[IndexNow] Host=${HOST} URLs=${submitUrls.length} Batches=${batches.length} Endpoint=${ENDPOINT}`);
    let ok = 0; let fail = 0;
    for (let i = 0; i < batches.length; i += 1) {
      const urlList = batches[i];
      const payload = { host: HOST, key, urlList };
      if (DRY_RUN) { ok += 1; console.log(`[IndexNow] Batch ${i + 1}/${batches.length}: DRY_RUN urls=${urlList.length}`); continue; }
      try {
        const resp = await postJson(ENDPOINT, payload);
        const sc = resp.statusCode || 0;
        if (sc >= 200 && sc < 300) { ok += 1; console.log(`[IndexNow] Batch ${i + 1}/${batches.length}: OK (HTTP ${sc}) urls=${urlList.length}`); }
        else { fail += 1; console.log(`[IndexNow] Batch ${i + 1}/${batches.length}: FAIL (HTTP ${sc}) urls=${urlList.length}`); if (resp.body && resp.body.trim()) console.log(`[IndexNow] Response body (truncated 500): ${resp.body.trim().slice(0, 500)}`); }
      } catch (e) {
        fail += 1;
        console.log(`[IndexNow] Batch ${i + 1}/${batches.length}: ERROR urls=${urlList.length}`);
        console.log(String(e && e.stack ? e.stack : e));
      }
    }
    console.log(`[IndexNow] Done. OK=${ok} FAIL=${fail} deletions=${deletionUrls.length} (warn-only)`);
    process.exit(0);
  } catch (e) {
    console.log('[IndexNow] Fatal error (warn-only):');
    console.log(String(e && e.stack ? e.stack : e));
    process.exit(0);
  }
})();
