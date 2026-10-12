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
//
// Sending code (12 Oct 2026): every file under scripts/ or functions/ that calls
// api.resend.com, and every workflow in .github/workflows/, may never name
// joinwestpeek.com, westpeek.ventures or spryvc.com except on a recipient line
// (a TO / LEAD_TO constant: the owner's own inbox). The weekly search-outcomes
// report went out From os@westpeek.ventures until then. Its sender is pinned like
// the lead form's, and no sending file may read a sender from the environment.
const fs = require('fs');
const path = require('path');

const FORBIDDEN = [/spry\s*labs/i, /spryvc\.com/i, /joinwestpeek\.com/i, /westpeek\.ventures/i];
const LEAD_FROM_PIN = "const LEAD_FROM = 'The Industry Guides <hello@theindustryguides.com>';";
const SENDER_DOMAINS = [/joinwestpeek\.com/i, /westpeek\.ventures/i, /spryvc\.com/i];
const RECIPIENT_LINE = /^\s*(?:const\s+|let\s+|var\s+)?(?:LEAD_)?TO\s*=/;
const ENV_SENDER = /(?:env\.\w*FROM|environ(?:\.get)?\s*[(\[]\s*["']\w*(?:FROM|SENDER)\w*["'])/;
const WEEKLY_REPORT = 'scripts/search_console/search_outcomes_weekly.py';
const WEEKLY_FROM_PIN = 'FROM = "The Industry Guides <hello@theindustryguides.com>"';

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

  // Sending code and workflows: no West Peek / Spry domain outside a recipient line.
  // scripts/tests/ holds this check's own fixtures (forbidden on purpose); this
  // file names api.resend.com only in its description.
  const skip = new Set(['node_modules', '.git', 'tests']);
  const walkSrc = (dir, out = []) => {
    if (!fs.existsSync(dir)) return out;
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      if (skip.has(ent.name)) continue;
      const p = path.join(dir, ent.name);
      if (ent.isDirectory()) walkSrc(p, out);
      else if (ent.isFile() && /\.(m?js|ts|py|sh)$/.test(ent.name)) out.push(p);
    }
    return out;
  };
  const sendingFiles = [...walkSrc(path.join(root, 'scripts')), ...walkSrc(fnDir)]
    .filter((fp) => path.resolve(fp) !== path.resolve(__filename) && fs.readFileSync(fp, 'utf8').includes('api.resend.com'));
  const workflowFiles = walk(path.join(root, '.github', 'workflows'), (n) => /\.ya?ml$/.test(n));
  if (!sendingFiles.length) failures.push('scanned zero sending files (no scripts/ or functions/ file calls api.resend.com)');
  if (!workflowFiles.length) failures.push('scanned zero workflow files in .github/workflows/');
  for (const fp of [...sendingFiles, ...workflowFiles]) {
    const lines = fs.readFileSync(fp, 'utf8').split('\n');
    lines.forEach((line, i) => {
      const hits = SENDER_DOMAINS.filter((re) => re.test(line));
      if (hits.length && !RECIPIENT_LINE.test(line)) failures.push(`${rel(fp)}:${i + 1}: ${hits.map(String).join(', ')} outside a recipient line`);
      if (ENV_SENDER.test(line)) failures.push(`${rel(fp)}:${i + 1}: reads the sender from the environment; pin it in code`);
    });
  }
  const weekly = path.join(root, WEEKLY_REPORT);
  if (!fs.existsSync(weekly)) failures.push(`${WEEKLY_REPORT} not found: cannot check the weekly report sender`);
  else if (!fs.readFileSync(weekly, 'utf8').split('\n').includes(WEEKLY_FROM_PIN)) failures.push(`${WEEKLY_REPORT}: weekly report sender must be pinned as ${WEEKLY_FROM_PIN}`);

  return { ok: failures.length === 0, distFiles: distFiles.length, functionFiles: functionFiles.length, sendingFiles: sendingFiles.length, workflowFiles: workflowFiles.length, failures };
}

module.exports = { checkBrandSeparation, FORBIDDEN, LEAD_FROM_PIN, WEEKLY_REPORT, WEEKLY_FROM_PIN };
