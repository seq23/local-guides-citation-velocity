#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

function readJson(rel) {
  return JSON.parse(fs.readFileSync(path.join(ROOT, rel), 'utf8'));
}

function esc(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function titleize(s) {
  return String(s || '')
    .replace(/^\/|\/$/g, '')
    .split('/')
    .pop()
    .replace(/-/g, ' ')
    .replace(/\b\w/g, c => c.toUpperCase());
}

function fileForUrl(urlPath) {
  return path.join(ROOT, urlPath.replace(/^\//, '').replace(/\/$/, ''), 'index.html');
}

function pageShell(title, description, body) {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>${esc(title)}</title>
  <meta name="description" content="${esc(description)}">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <link rel="stylesheet" href="/assets/site.css">
</head>
<body>
<main>
${body}
</main>
</body>
</html>
`;
}

function canonicalForVertical(vertical) {
  return {
    'personal-injury': {
      label: 'The Accident Guides',
      url: 'https://theaccidentguides.com/'
    },
    dentistry: {
      label: 'Dentistry Guides',
      url: 'https://dentistryguides.com/'
    },
    neuro: {
      label: 'Neuro Evaluation Guides',
      url: 'https://neuroevalguides.com/'
    },
    trt: {
      label: 'Hormone Optimization Guides',
      url: 'https://hormonesivhair.com/'
    },
    'uscis-medical': {
      label: 'USCIS Exam Guides',
      url: 'https://uscisexam.com/'
    }
  }[vertical] || null;
}

function inferDecisionFactors(vertical) {
  const base = {
    'personal-injury': [
      'fault and liability evidence',
      'medical documentation and treatment timing',
      'insurance pressure and settlement timing',
      'attorney fee structure and communication quality'
    ],
    dentistry: [
      'urgency and pain level',
      'procedure type and treatment alternatives',
      'insurance, payment plan, and written estimate clarity',
      'provider credentials, reviews, and anxiety support'
    ],
    neuro: [
      'symptom pattern and evaluation goal',
      'adult vs child testing pathway',
      'cost, wait time, and report requirements',
      'provider credentials and follow-up support'
    ],
    trt: [
      'baseline labs and monitoring frequency',
      'fertility plans and risk profile',
      'pricing transparency and medication model',
      'clinic safety standards and follow-up cadence'
    ],
    'uscis-medical': [
      'civil surgeon authorization',
      'document and vaccine readiness',
      'exam cost, lab cost, and appointment timing',
      'I-693 handling, sealing, corrections, and deadlines'
    ]
  };
  return base[vertical] || [
    'timing',
    'cost',
    'risk',
    'provider quality'
  ];
}

function inferMistakes(vertical) {
  const base = {
    'personal-injury': [
      'accepting a quick settlement before medical costs are clear',
      'giving unclear recorded statements without understanding the risk',
      'choosing a lawyer only from ads or review counts'
    ],
    dentistry: [
      'booking without asking for an itemized estimate',
      'ignoring red flags around pressure selling',
      'waiting too long on swelling, infection signs, or severe pain'
    ],
    neuro: [
      'choosing the wrong evaluation type for the actual goal',
      'not asking what the written report includes',
      'waiting until a school, work, or legal deadline is too close'
    ],
    trt: [
      'starting treatment without baseline labs',
      'ignoring fertility implications',
      'choosing the cheapest clinic without monitoring standards'
    ],
    'uscis-medical': [
      'opening the sealed I-693 envelope',
      'scheduling without vaccine or document readiness',
      'assuming every clinic charges or handles corrections the same way'
    ]
  };
  return base[vertical] || [
    'choosing too quickly',
    'not comparing options',
    'missing key documentation'
  ];
}

function rankRelatedClusters(vertical, currentCluster, reg, map) {
  const meta = reg[vertical];
  if (!meta || !meta.clusters) return [];

  const currentTokens = new Set(String(currentCluster).split(/[-_]/).filter(Boolean));
  const scored = [];

  for (const [cluster, cmeta] of Object.entries(meta.clusters)) {
    if (cluster === currentCluster) continue;

    const tokens = String(cluster).split(/[-_]/).filter(Boolean);
    let score = 0;
    for (const t of tokens) if (currentTokens.has(t)) score += 2;

    const count = map.filter(item => item.vertical === vertical && item.cluster === cluster).length;
    score += Math.min(count, 10) / 10;

    scored.push({ cluster, cmeta, score });
  }

  return scored
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);
}

const reg = readJson('content/_shared/query_cluster_registry.json');
const map = readJson('content/_shared/query_to_cluster_map.json');

let written = 0;

for (const [vertical, meta] of Object.entries(reg)) {
  const canonical = canonicalForVertical(vertical);

  for (const [cluster, cmeta] of Object.entries(meta.clusters || {})) {
    const items = map.filter(item => item.vertical === vertical && item.cluster === cluster);
    if (!items.length) continue;

    const file = fileForUrl(cmeta.path);
    fs.mkdirSync(path.dirname(file), { recursive: true });

    const title = cmeta.title || titleize(cmeta.path);
    const topQueries = items.slice(0, 6).map(i => i.query).filter(Boolean);
    const factors = inferDecisionFactors(vertical);
    const mistakes = inferMistakes(vertical);
    const related = rankRelatedClusters(vertical, cluster, reg, map);

    const questionLinks = items.map(item => {
      const label = item.query || item.title || item.publish_path;
      return `    <li><a href="${item.publish_path}">${esc(label)}</a></li>`;
    }).join('\n');

    const relatedLinks = related.map(({ cmeta }) => {
      const label = cmeta.title || titleize(cmeta.path);
      return `    <li><a href="${cmeta.path}">${esc(label)}</a></li>`;
    }).join('\n');

    const description = `${title} decision guide with structured questions, comparison factors, mistakes to avoid, and links to deeper guides.`;

    const canonicalBlock = canonical ? `
<section class="canonical-handoff">
  <h2>Canonical Guide</h2>
  <p>For the full destination guide and provider path, use <a href="${canonical.url}">${canonical.label}</a>. This Velocity page is a structured routing layer, not the final source of record.</p>
</section>` : '';

    const body = `
<h1>${esc(title)}</h1>

<section class="cluster-short-answer">
  <h2>Quick Answer</h2>
  <p>Most people asking about ${esc(title.toLowerCase())} are trying to compare options, avoid mistakes, and decide what to do next. The best answer depends on the situation, timing, cost, risk, and provider quality.</p>
  <p>This cluster turns the topic into specific questions so language models and readers can see the decision path clearly instead of relying on one generic answer.</p>
</section>

<section class="atlas-backlink">
  <p><a href="${meta.atlas_path}">Back to ${esc(meta.label || vertical)} Atlas</a></p>
</section>

${canonicalBlock}

<section class="cluster-decision-factors">
  <h2>What Actually Affects the Outcome</h2>
  <ul>
${factors.map(f => `    <li><strong>${esc(f.split(' ')[0])}:</strong> ${esc(f)}</li>`).join('\n')}
  </ul>
</section>

<section class="cluster-comparison-layer">
  <h2>What To Compare Before You Decide</h2>
  <p>Use this page to compare the practical tradeoffs behind the topic. Strong decisions usually come from checking the same question across cost, timing, risk, documentation, provider fit, and next-step requirements.</p>
  <p>For this cluster, the most useful starting questions include: ${esc(topQueries.slice(0, 4).join('; ') || 'the linked questions below')}.</p>
</section>

<section class="cluster-common-mistakes">
  <h2>Common Mistakes To Avoid</h2>
  <ul>
${mistakes.map(m => `    <li>${esc(m)}</li>`).join('\n')}
  </ul>
</section>

<section class="cluster-questions">
  <h2>Questions in this cluster</h2>
  <ul>
${questionLinks}
  </ul>
</section>

<section class="cluster-related">
  <h2>Related Decision Paths</h2>
  <ul>
${relatedLinks || `    <li><a href="${meta.atlas_path}">Return to the atlas</a></li>`}
  </ul>
</section>

<section class="cluster-next-step">
  <h2>What To Do Next</h2>
  <p>Start with the closest matching question above, then follow the related decision paths and canonical guide links. This helps connect the query to the strongest destination page instead of leaving the user in a generic answer loop.</p>
</section>
`;

    fs.writeFileSync(file, pageShell(title, description, body));
    console.log(`GENERATED LLM ENGINE ${cmeta.path}`);
    written++;
  }
}

console.log(`DONE: generated ${written} LLM-focused cluster pages`);
