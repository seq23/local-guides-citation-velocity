#!/usr/bin/env node
/* eslint-disable no-console */
'use strict';
const fs = require('fs');
const path = require('path');
const { normalizeQuery } = require('./normalize_queries');
const { dedupeByNormalized } = require('./dedupe_queries');
const { VERTICAL_CONFIG } = require('./lib/publish_contract');
const { deriveContentAtom } = require('./lib/content_atom');

const ROOT = path.resolve(__dirname, '..');
const STAGED_DIR = path.join(ROOT, 'content', '_staged');
const PAGES_PATH = path.join(STAGED_DIR, 'pages.json');
const REGISTRY_PATH = path.join(ROOT, 'content', '_shared', 'query_cluster_registry.json');
const DEBUG_OUT = path.join(STAGED_DIR, 'compiled_query_pages.json');

function readJson(p) { return JSON.parse(fs.readFileSync(p, 'utf8')); }
function writeJson(p, o) { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, JSON.stringify(o, null, 2) + '\n', 'utf8'); }

function titleCase(text) {
  return String(text || '').replace(/\b\w/g, (m) => m.toUpperCase());
}

function canonicalTargetUrl(raw, cfg) {
  const value = String(raw || '').trim();
  if (!value) return cfg.domain;
  if (/^https?:\/\//i.test(value)) return value;
  if (value.startsWith('/')) return `${cfg.domain.replace(/\/$/, '')}${value}`;
  return value;
}

function getVerticalSourceKey(key) {
  return key === 'personal_injury' ? 'pi' : key;
}

function findInputFiles() {
  return fs.readdirSync(STAGED_DIR)
    .filter((name) => /^reddit_queries_.+\.json$/.test(name))
    .map((name) => path.join(STAGED_DIR, name))
    .sort();
}

function questionAnswer(verticalKey, clusterKey, q) {
  const verticalLabel = VERTICAL_CONFIG[verticalKey].label;
  const domain = VERTICAL_CONFIG[verticalKey].domain.replace(/^https?:\/\//, '');
  const lowerQ = String(q || '').toLowerCase();
  if (verticalKey === 'trt' && clusterKey.startsWith('peptide-')) {
    let opener = 'Start with the plain-language version of the decision: what is the clinic actually offering, what does it cost, and what happens after the first consult?';
    if (/(best|top)/.test(lowerQ)) opener = 'When people say best or top, the useful move is not trusting hype. It is checking who runs the program, what is included, and whether the clinic explains the basics in normal language.';
    else if (/cost|expensive|insurance|monthly/.test(lowerQ)) opener = 'Peptide pricing can look simple at first and then grow once consults, meds, follow-up, or add-ons are layered in.';
    else if (/safe|legal|danger|risk|legit/.test(lowerQ)) opener = 'This is the slow-down category. Look for clear program basics, honest limits, and a clinic that explains risks without acting weird about simple questions.';
    else if (/what are|what is peptide therapy|why are|what do peptides do/.test(lowerQ)) opener = 'Most people are not asking for a science lecture. They want to know what clinics mean when they talk about peptide programs and whether the category is worth looking into at all.';
    else if (/vs trt|vs iv|should i do trt or peptides/.test(lowerQ)) opener = 'These programs get compared because they are often sold by overlapping clinics, but the real question is what goal you are solving, what monitoring happens, and what the monthly path looks like.';
    return `${opener} This page gives a short consumer answer first, then routes you to ${domain} for the official local TRT, IV, and hair workflow, pricing context, and next-step clinic comparison.`;
  }
  const clusterHints = {
    'process-timeline': 'timing, the next procedural step, and what usually creates delay',
    'insurance-fault': 'fault rules, insurer communication, and what not to say too early',
    'evidence-documents': 'the minimum records, photos, and paperwork that protect your position',
    'medical-treatment': 'treatment timing, follow-up, and how care decisions affect the overall path',
    'settlement-offers': 'whether the offer is early, incomplete, or missing important categories of damage',
    'treatment-comparison': 'what changes between options, what is reversible, and what long-term maintenance looks like',
    'recovery-aftercare': 'what is expected, what is temporary, and what means you should call back sooner',
    'insurance-billing': 'what is estimated, what is guaranteed, and which costs are still fluid',
    'pediatric-family': 'how the visit is staged, what reduces friction, and how to prep the family',
    'cosmetic-restorative': 'durability, maintenance, fit, and how to compare proposals safely',
    'choosing-a-dentist': 'provider type, written treatment plan clarity, pricing transparency, and whether the office feels trustworthy under pressure',
    'dental-bridge-vs-implant': 'how each option is supported, what happens to nearby teeth and bone, how cost changes, and who is a fit for each path',
    'clear-aligners': 'case complexity, treatment control, compliance, visibility, and whether aligners or braces are the better fit',
    'dental-red-flags': 'pressure, vague pricing, weak explanations, and the warning signs that a dental office may be a bad fit',
    'cost-financing': 'single implant vs larger implant plans, what is included in the estimate, and whether financing hides the real total',
    'root-canal-treatment': 'pain during treatment, soreness after treatment, how long the procedure usually takes, and what follow-up restoration is needed',
    'labs-dosing': 'when data is mature enough to review and why changing too fast can make interpretation harder',
    'side-effects-monitoring': 'what should be watched over time and which symptoms deserve a real follow-up',
    'fertility-pct': 'whether family-planning goals were discussed before treatment choices are locked in',
    'clinic-selection': 'whether the program explains monitoring, pricing, and response to side effects clearly',
    'medication-costs': 'what the base price includes and which add-ons quietly raise the total',
    'peptide-clinic-selection': 'how clinics frame peptide programs, what a real consult should look like, and how to compare local options without guessing',
    'peptide-cost-safety': 'what peptide programs usually cost, what safety questions matter, and where hype should make you slow down',
    'peptide-types-uses': 'what peptide programs are, why people look into them, and how clinics usually describe different categories without making them all sound the same',
    'peptide-red-flags': 'sales pressure, weak monitoring, vague pricing, and the warning signs that a peptide clinic may be a bad fit',
    'adhd-testing': 'what the evaluation includes, who is a fit, and what happens after testing is complete',
    'autism-evaluation': 'the scope of the evaluation, the history that helps, and when a specialist fit matters most',
    'insurance-school-docs': 'what insurers, schools, and employers often need documented in writing',
    'adult-vs-child': 'how the pathway changes by age, context, and what support comes after results',
    'report-results': 'when the report arrives, how results are explained, and what you can do with them next',
    'therapy-after-evaluation': 'the handoff from diagnosis to support, what records help, and whether therapy is the real next step',
    'adhd-therapy-selection': 'provider fit, ADHD-specific experience, and how therapy differs from coaching or medication support',
    'autism-therapy-selection': 'setting, supervision, parent communication, and how different therapy models are compared safely',
    'therapy-red-flags-and-fit': 'warning signs, turnover, supervision, communication, and what poor therapy fit looks like early',
    'timeline-validity': 'how the filing timeline works and when timing becomes the real problem',
    'vaccines-labs': 'which records help, what may be repeated, and what can slow the visit down',
    'correction-mistakes': 'who fixes what, how sealed packets are handled, and what must not be opened casually',
    'exam-day-documents': 'what to bring, how the visit usually flows, and what should be confirmed before leaving',
    'after-exam-filing': 'submission timing, packet handling, and what to do if USCIS asks for more later'
  };
  return `For ${titleCase(verticalLabel)} decisions, start by clarifying ${clusterHints[clusterKey] || 'the exact decision point and what changes the next step'}. This page gives a short framing answer first, then routes you to ${domain} for the official local workflow and current next-step details.`;
}

function clusterLead(verticalKey, clusterKey) {
  const verticalLabel = VERTICAL_CONFIG[verticalKey].label;
  if (verticalKey === 'trt' && clusterKey.startsWith('peptide-')) {
    return `${verticalLabel} quick answers for ${clusterKey.replace(/-/g, ' ')}. These are short, plain-English routing answers built from real consumer phrasing about peptide clinics, costs, safety, and what to do next before you use the canonical local guide.`;
  }
  return `${verticalLabel} quick answers for ${clusterKey.replace(/-/g, ' ')}. These are short routing answers built from repeated consumer-style questions and grouped so you can scan the pattern fast before using the canonical local guide.`;
}

function compile() {
  const registry = readJson(REGISTRY_PATH);
  const stagedPages = readJson(PAGES_PATH);
  const seedPages = (stagedPages.pages || []).filter((p) => !p.query_compiler_generated);
  const items = [];

  for (const fp of findInputFiles()) {
    const payload = readJson(fp);
    for (const item of payload.items || []) items.push(item);
  }

  const normalized = items.map((item) => ({ ...item, normalized_query: normalizeQuery(item.normalized_query || item.query) }));
  const { unique, duplicates } = dedupeByNormalized(normalized);
  if (duplicates.length) {
    throw new Error(`Duplicate normalized queries found: ${duplicates.length}`);
  }

  const grouped = new Map();
  for (const item of unique) {
    const registryVertical = registry[item.vertical];
    if (!registryVertical) throw new Error(`Unknown vertical in staged query: ${item.vertical}`);
    if (!registryVertical.clusters[item.cluster]) throw new Error(`Unknown cluster ${item.cluster} for ${item.vertical}`);
    const key = `${item.vertical}::${item.cluster}`;
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(item);
  }

  const compiledPages = [];
  for (const [key, clusterItems] of [...grouped.entries()].sort()) {
    const [verticalKey, clusterKey] = key.split('::');
    const reg = registry[verticalKey];
    const cfg = VERTICAL_CONFIG[verticalKey];
    const clusterMeta = reg.clusters[clusterKey];
    const slug = `/${cfg.basePath}/${clusterKey}/`;
    const mutationDate = String(process.env.SOURCE_DATE || new Date().toISOString().slice(0, 10));
    const sections = clusterItems.map((item, itemIndex) => {
      const section = {
        q: item.query,
        visible_q: titleCase(item.normalized_query),
        query_variants: [item.query],
        a: item.answer || questionAnswer(verticalKey, clusterKey, item.query),
        checklist: item.checklist || [],
        red_flags: item.red_flags || [],
        intent_type: item.intent_type,
        source_type: item.source_type,
        source_bucket: item.source_bucket,
        normalized_query: item.normalized_query,
        canonical_target_url: canonicalTargetUrl(item.notes, cfg),
        date_modified: mutationDate
      };
      section.content_atom = deriveContentAtom(section, { sourceRoute: `${slug}#section-${itemIndex + 1}`, title: section.visible_q || section.q });
      return section;
    });
    const compiledPage = {
      slug,
      vertical: verticalKey,
      title: clusterMeta.title,
      description: clusterMeta.description,
      compiler_source: 'reddit_queries',
      query_compiler_generated: true,
      cluster: clusterKey,
      canonical_target_url: canonicalTargetUrl((clusterItems.find((item) => item.notes) || {}).notes, cfg),
      related_links: [],
      sections,
      date_modified: mutationDate
    };
    compiledPage.content_atom = deriveContentAtom({
      title: compiledPage.title,
      a: compiledPage.description,
      checklist: sections.slice(0, 5).map((section) => section.visible_q || section.q),
      red_flags: ['The page cannot explain how its questions differ from sibling clusters.']
    }, { sourceRoute: slug, title: compiledPage.title });
    compiledPages.push(compiledPage);
  }

  const byVertical = new Map();
  for (const page of compiledPages) {
    if (!byVertical.has(page.vertical)) byVertical.set(page.vertical, []);
    byVertical.get(page.vertical).push(page);
  }
  for (const pages of byVertical.values()) {
    pages.sort((a, b) => a.slug.localeCompare(b.slug));
    for (let i = 0; i < pages.length; i += 1) {
      const peers = pages.filter((_, idx) => idx !== i).slice(0, 2);
      pages[i].related_links = peers.map((peer) => ({ slug: peer.slug, label: peer.title }));
    }
  }

  const output = { pages: [...seedPages, ...compiledPages].sort((a, b) => a.slug.localeCompare(b.slug)) };
  writeJson(PAGES_PATH, output);
  const { applyCitationAgentFixes } = require('./apply_citation_agent_fixes_2026_05');
  applyCitationAgentFixes({ targets: ['content/_staged/pages.json'] });
  writeJson(DEBUG_OUT, { generated_at: new Date().toISOString(), generated_pages: compiledPages.length, pages: compiledPages });
  console.log(`Compiled ${compiledPages.length} query-cluster pages from ${unique.length} staged queries.`);
}

if (require.main === module) compile();
module.exports = { compile };
