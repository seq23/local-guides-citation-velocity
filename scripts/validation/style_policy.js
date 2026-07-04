use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '../..');
const POLICY_PATH = path.join(ROOT, 'data/validation/content_quality_policy.json');
function loadContentQualityPolicy(){ try { return JSON.parse(fs.readFileSync(POLICY_PATH, 'utf8')); } catch { return { paragraphs: {}, hard_fail_categories: [], warning_categories: [] }; } }
function classifyParagraphLength(sentenceCount, kind = 'normal_article'){
  const policy = loadContentQualityPolicy();
  const rule = policy.paragraphs?.[kind] || policy.paragraphs?.normal_article || { pass_max_sentences: 5, warn_max_sentences: 7, fail_min_sentences: 8 };
  if (rule.fail_only_if_malformed) return { severity: 'WARN', blocks: false, reason: 'cta_or_footer_style_only' };
  if (Number(sentenceCount) >= Number(rule.fail_min_sentences || 8)) return { severity: 'FAIL', blocks: true, reason: 'extreme_paragraph_length' };
  if (Number(sentenceCount) > Number(rule.pass_max_sentences || 5)) return { severity: 'WARN', blocks: false, reason: 'minor_paragraph_length' };
  return { severity: 'PASS', blocks: false, reason: 'within_policy' };
}
function isCosmeticIssue(category){ const p=loadContentQualityPolicy(); return (p.warning_categories || []).includes(category); }
function shouldBlockIssue(category){ const p=loadContentQualityPolicy(); if ((p.hard_fail_categories || []).includes(category)) return true; if (isCosmeticIssue(category)) return false; return !/minor|style|format|paragraph|heading|cta|word_count/i.test(String(category||'')); }
module.exports = { loadContentQualityPolicy, classifyParagraphLength, isCosmeticIssue, shouldBlockIssue };
