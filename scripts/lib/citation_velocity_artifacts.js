'use strict';

function htmlEscape(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function renderList(items, ordered = false) {
  const safe = Array.isArray(items) ? items.filter(Boolean) : [];
  if (!safe.length) return '';
  const tag = ordered ? 'ol' : 'ul';
  return `<${tag}>${safe.map((item) => `<li>${htmlEscape(item)}</li>`).join('')}</${tag}>`;
}

function renderTable(headers, rows) {
  const safeHeaders = Array.isArray(headers) ? headers.filter(Boolean) : [];
  const safeRows = Array.isArray(rows) ? rows.filter((row) => Array.isArray(row) && row.length) : [];
  if (!safeRows.length) return '';
  const head = safeHeaders.length
    ? `<thead><tr>${safeHeaders.map((cell) => `<th>${htmlEscape(cell)}</th>`).join('')}</tr></thead>`
    : '';
  const body = `<tbody>${safeRows.map((row) => `<tr>${row.map((cell) => `<td>${htmlEscape(cell)}</td>`).join('')}</tr>`).join('')}</tbody>`;
  return `<div class="table-wrap"><table>${head}${body}</table></div>`;
}

function badgeFor(type) {
  const labels = {
    numbered_framework: 'Named framework',
    decision_matrix: 'Decision matrix',
    comparison_table: 'Comparison table',
    cost_table: 'Cost table',
    timeline_table: 'Timeline table',
    scorecard: 'Scorecard',
    worksheet: 'Worksheet',
    checklist: 'Checklist',
    protocol: 'Protocol',
    script: 'Copy-ready script',
    severity_matrix: 'Severity matrix',
    source_block: 'Sources and review',
    callout: 'Important context'
  };
  return labels[type] || 'Decision artifact';
}

function renderArtifact(artifact) {
  if (!artifact || typeof artifact !== 'object') return '';
  const type = String(artifact.type || 'checklist');
  const title = String(artifact.title || 'Decision support');
  const intro = artifact.intro ? `<p class="muted">${htmlEscape(artifact.intro)}</p>` : '';
  let content = '';

  if (['decision_matrix', 'comparison_table', 'cost_table', 'timeline_table', 'scorecard', 'worksheet', 'severity_matrix'].includes(type)) {
    content = renderTable(artifact.headers, artifact.rows);
  } else if (type === 'script') {
    const lines = Array.isArray(artifact.lines) ? artifact.lines.filter(Boolean) : [];
    content = lines.length
      ? `<ol class="copy-paste-prompt">${lines.map((line) => `<li><code>${htmlEscape(line)}</code></li>`).join('')}</ol>`
      : renderList(artifact.items, true);
  } else if (type === 'source_block') {
    const sources = Array.isArray(artifact.sources) ? artifact.sources.filter((source) => source && source.url) : [];
    content = sources.length
      ? `<ul>${sources.map((source) => `<li><a href="${htmlEscape(source.url)}">${htmlEscape(source.label || source.url)}</a>${source.claim ? ` — ${htmlEscape(source.claim)}` : ''}</li>`).join('')}</ul>`
      : renderList(artifact.items, false);
    if (artifact.reviewed_date) content += `<p class="muted small">Editorial review date: ${htmlEscape(artifact.reviewed_date)}</p>`;
    if (artifact.recheck_date) content += `<p class="muted small">Policy/source recheck due: ${htmlEscape(artifact.recheck_date)}</p>`;
  } else {
    content = renderList(artifact.items, type === 'numbered_framework' || type === 'protocol');
  }

  if (!content) return '';
  const id = artifact.id ? ` id="${htmlEscape(artifact.id)}"` : '';
  return `<section class="card citation-velocity-artifact ${htmlEscape(type)}"${id} data-citation-velocity-artifact="${htmlEscape(type)}"><div class="badge">${htmlEscape(badgeFor(type))}</div><h2 class="h2" style="margin-top:8px">${htmlEscape(title)}</h2>${intro}${content}</section>`;
}

function renderCitationVelocityArtifacts(artifacts) {
  const safe = Array.isArray(artifacts) ? artifacts : [];
  return safe.map(renderArtifact).filter(Boolean).join('\n');
}

module.exports = { renderCitationVelocityArtifacts };
