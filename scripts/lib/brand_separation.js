'use strict';
// Brand separation: theindustryguides.com is a property of The Industry Guides
// alone (owner instruction, 12 Oct 2026). No built file in dist/ and no Pages
// Function source may name Spry Labs or a Spry/West Peek domain, and the lead
// notification's sender stays pinned in the handler, never read from config.
//
// Before 12 Oct 2026 every lead email from this site went out From
// hello@joinwestpeek.com (hardcoded in wrangler.toml), so a guides visitor's
// request was announced under another company's name.
//
// Scope, stated narrowly on purpose: dist/ and functions/ only. wrangler.toml is
// deployment config and carries the recipient (LEAD_TO = info@spryvc.com, where
// the owner reads guides leads); a recipient is never shown to a visitor, a
// sender or built page is. Scripts, data and reports are internal tooling.
const fs = require('fs');
const path = require('path');

const FORBIDDEN = [/spry\s*labs/i, /spryvc\.com/i, /joinwestpeek\.com/i, /westpeek\.ventures/i];
const LEAD_FROM_PIN = "const LEAD_FROM = 'The Industry Guides <hello@theindustryguides.com>';";

function walk(dir, keep, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) walk(p, keep, out);
    else if (ent.isFile() && keep(ent.name)) out.push(p);
  }
  return out;
}

// Returns { ok, distFiles, functionFiles, failures[] }. Zero files scanned in
// either place is a failure: a scan of nothing proves nothing.
function checkBrandSeparation({ root, distDir, functionsDir }) {
  const dist = distDir || path.join(root, 'dist');
  const fnDir = functionsDir || path.join(root, 'functions');
  const failures = [];
  const rel = (p) => path.relative(root, p).replace(/\\/g, '/');

  const distFiles = walk(dist, () => true);
  if (!distFiles.length) failures.push(`scanned zero files in ${rel(dist) || dist}/: build the site first`);
  for (const fp of distFiles) {
    const text = fs.readFileSync(fp, 'latin1');
    const hits = FORBIDDEN.filter((re) => re.test(text)).map(String);
    if (hits.length) failures.push(`${rel(fp)}: ${hits.join(', ')}`);
  }

  const functionFiles = walk(fnDir, (n) => /\.(m?js|ts)$/.test(n));
  if (!functionFiles.length) failures.push(`scanned zero Pages Function files in ${rel(fnDir) || fnDir}/`);
  for (const fp of functionFiles) {
    const text = fs.readFileSync(fp, 'utf8');
    const hits = FORBIDDEN.filter((re) => re.test(text)).map(String);
    if (hits.length) failures.push(`${rel(fp)}: ${hits.join(', ')}`);
  }

  const leadFn = functionFiles.find((fp) => path.basename(fp) === 'request-assistance.js');
  if (!leadFn) {
    failures.push('functions/api/request-assistance.js not found: cannot check the lead sender');
  } else {
    const src = fs.readFileSync(leadFn, 'utf8');
    if (!src.includes(LEAD_FROM_PIN)) failures.push(`${rel(leadFn)}: lead sender must be pinned as ${LEAD_FROM_PIN}`);
    if (/env\.EMAIL_FROM/.test(src)) failures.push(`${rel(leadFn)}: reads env.EMAIL_FROM; the sender must stay pinned in code`);
  }

  return { ok: failures.length === 0, distFiles: distFiles.length, functionFiles: functionFiles.length, failures };
}

module.exports = { checkBrandSeparation, FORBIDDEN, LEAD_FROM_PIN };
