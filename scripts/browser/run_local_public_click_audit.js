#!/usr/bin/env node
'use strict';

const fs = require('fs');
const http = require('http');
const path = require('path');
const { spawn } = require('child_process');

const ROOT = path.resolve(__dirname, '../..');
const MIME = new Map([
  ['.css', 'text/css; charset=utf-8'],
  ['.html', 'text/html; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.png', 'image/png'],
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.svg', 'image/svg+xml'],
  ['.txt', 'text/plain; charset=utf-8'],
  ['.xml', 'application/xml; charset=utf-8'],
]);

function resolveRequestPath(requestUrl = '/') {
  let pathname = '/';
  try {
    pathname = new URL(requestUrl, 'http://127.0.0.1').pathname;
  } catch {
    pathname = '/';
  }

  const decoded = decodeURIComponent(pathname);
  const clean = path.normalize(decoded).replace(/^(\.\.[/\\])+/, '').replace(/^[/\\]+/, '');
  const candidates = [];
  if (!clean || clean === '.') {
    candidates.push('index.html');
  } else {
    candidates.push(clean);
    if (clean.endsWith(path.sep) || decoded.endsWith('/')) candidates.push(path.join(clean, 'index.html'));
    if (!path.extname(clean)) {
      candidates.push(`${clean}.html`);
      candidates.push(path.join(clean, 'index.html'));
    }
  }

  for (const rel of candidates) {
    const abs = path.resolve(ROOT, rel);
    if (!abs.startsWith(ROOT + path.sep) && abs !== ROOT) continue;
    if (fs.existsSync(abs) && fs.statSync(abs).isFile()) return abs;
  }
  return null;
}

function createServer() {
  return http.createServer((req, res) => {
    const file = resolveRequestPath(req.url);
    if (!file) {
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
      res.end('Not found');
      return;
    }
    res.writeHead(200, {
      'content-type': MIME.get(path.extname(file).toLowerCase()) || 'application/octet-stream',
      'cache-control': 'no-store',
    });
    fs.createReadStream(file).pipe(res);
  });
}

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve(server.address().port));
  });
}

function runAudit(baseUrl) {
  return new Promise(resolve => {
    const child = spawn(process.execPath, ['scripts/browser/public_click_audit.js'], {
      cwd: ROOT,
      stdio: 'inherit',
      env: {
        ...process.env,
        NODE_OPTIONS: process.env.NODE_OPTIONS || '--max-old-space-size=3072',
        PLAYWRIGHT_BASE_URL: baseUrl,
        POSTDEPLOY_BASE_URL: baseUrl,
        PUBLIC_BASE_URL: baseUrl,
        LOCAL_SNAPSHOT_AUDIT_BASE_URL: baseUrl,
      },
    });
    child.on('close', code => resolve(code || 0));
    child.on('error', error => {
      console.error(error);
      resolve(1);
    });
  });
}

(async () => {
  const server = createServer();
  const port = await listen(server);
  const baseUrl = `http://127.0.0.1:${port}`;
  console.log(`LOCAL SNAPSHOT PUBLIC CLICK AUDIT BASE: ${baseUrl}`);
  try {
    const code = await runAudit(baseUrl);
    process.exitCode = code;
  } finally {
    server.close();
  }
})().catch(error => {
  console.error(error);
  process.exit(1);
});
