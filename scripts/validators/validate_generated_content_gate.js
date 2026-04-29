#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..', '..');
const reportPath = path.join(ROOT, 'reports', 'generated_content_gate_report.json');

function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) walk(p, out);
    else if (ent.name.endsWith('.html')) out.push(p);
  }
  return out;
}
function wordCount(html) {
  return String(html || '')
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, ' ')
    .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean).length;
}
function extractMetaDescription(html) {
  const direct = String(html || '').match(/<meta[^>]+name=["']description["'][^>]+content=(["'])([\s\S]*?)\1/i);
  if (direct) return String(direct[2] || '').trim();
  const reverse = String(html || '').match(/<meta[^>]+content=(["'])([\s\S]*?)\1[^>]+name=["']description["']/i);
  if (reverse) return String(reverse[2] || '').trim();
  return '';
}
function hasMetaDescription(html) {
  return extractMetaDescription(html).length >= 60;
}
function hasCanonical(html) {
  return /<link[^>]+rel=["']canonical["'][^>]+href=["']https?:\/\/[^"']+["']/i.test(html) || /<link[^>]+href=["']https?:\/\/[^"']+["'][^>]+rel=["']canonical["']/i.test(html);
}
function validateFile(abs) {
  const rel = path.relative(ROOT, abs).replace(/\\/g, '/');
  const html = fs.readFileSync(abs, 'utf8');
  const issues = [];
  const isInsight = rel.startsWith('insights/') && rel !== 'insights/index.html';
  const minWords = isInsight ? 280 : 80;
  if (!/^\s*<!doctype html>/i.test(html)) issues.push('missing_doctype');
  if (!/<title>[^<]{8,}<\/title>/i.test(html)) issues.push('missing_title');
  if (!hasMetaDescription(html)) issues.push('missing_or_short_meta_description');
  if (!hasCanonical(html)) issues.push('missing_absolute_canonical');
  if (isInsight) {
    if (!/<!--\s*CANON_TOP\s*-->/.test(html) || !/data-canon-block=["']top["']/.test(html)) issues.push('missing_top_canonical_marker');
    if (!/<!--\s*CANON_BOTTOM\s*-->/.test(html) || !/data-canon-block=["']bottom["']/.test(html)) issues.push('missing_bottom_canonical_marker');
    if (!/data-direct-answer=["']true["']/.test(html)) issues.push('missing_direct_answer_block');
  }
  const words = wordCount(html);
  if (words < minWords) issues.push(`word_count_${words}_below_${minWords}`);
  if (/TODO|FIXME|undefined|null\s+is the official|\[object Object\]/i.test(html)) issues.push('placeholder_or_runtime_leak');
  if (/\/insights\/(dentistry|neuro|trt|uscis-medical|personal-injury)-\1-/.test(html) || /(?:^|\/)insights\/(dentistry|neuro|trt|uscis-medical|personal-injury)-\1-/.test(rel)) issues.push('double_vertical_slug');
  return issues.length ? { file: rel, issues } : null;
}

const files = [
  ...walk(path.join(ROOT, 'insights')),
  ...['index.html'].map((f) => path.join(ROOT, f)).filter((f) => fs.existsSync(f))
];
const issues = files.map(validateFile).filter(Boolean);
fs.mkdirSync(path.dirname(reportPath), { recursive: true });
fs.writeFileSync(reportPath, JSON.stringify({ checked_at: new Date().toISOString(), checked_files: files.length, issue_count: issues.length, issues }, null, 2) + '\n');
if (issues.length) {
  console.error(`Generated content gate failed (${issues.length} file(s)). See reports/generated_content_gate_report.json`);
  console.error(JSON.stringify(issues.slice(0, 20), null, 2));
  process.exit(1);
}
console.log(`Generated content gate passed (${files.length} files checked).`);
