'use strict';
/**
 * Read citation-velocity artifacts back OUT of rendered HTML.
 *
 * scripts/lib/citation_velocity_artifacts.js is the only writer of these blocks and
 * its markup is unambiguous, so the transform is invertible: every field the renderer
 * emits (type, id, title, intro, headers, rows, items, lines, sources) can be read
 * back and re-rendered to the same bytes.
 *
 * This exists because the frozen store was holding the only copy of 1.1 MB of
 * delivered artifact content across 249 accepted routes - see
 * scripts/validators/validate_frozen_content_recoverability.js for how that happened.
 * Recovery is a parse of the accepted output, not a re-derivation from an upstream
 * that no longer has the data.
 */

const SECTION_RX = /<section class="card citation-velocity-artifact ([a-z_]+)"(?: id="([^"]*)")? data-citation-velocity-artifact="[a-z_]+">([\s\S]*?)<\/section>/g;
const TABLE_TYPES = new Set(['decision_matrix', 'comparison_table', 'cost_table', 'timeline_table', 'scorecard', 'worksheet', 'severity_matrix']);

function unescapeHtml(value) {
  return String(value == null ? '' : value)
    .replaceAll('&quot;', '"')
    .replaceAll('&#39;', "'")
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    // & last: unescaping it first would turn "&amp;lt;" into "<".
    .replaceAll('&amp;', '&');
}
function textOf(html) { return unescapeHtml(String(html || '').replace(/<[^>]+>/g, '')); }

function parseRows(body) {
  const table = body.match(/<div class="table-wrap"><table>([\s\S]*?)<\/table><\/div>/);
  if (!table) return null;
  const inner = table[1];
  const headers = [...(inner.match(/<thead><tr>([\s\S]*?)<\/tr><\/thead>/) || [null, ''])[1].matchAll(/<th>([\s\S]*?)<\/th>/g)].map((m) => textOf(m[1]));
  const bodyHtml = (inner.match(/<tbody>([\s\S]*?)<\/tbody>/) || [null, ''])[1];
  const rows = [...bodyHtml.matchAll(/<tr>([\s\S]*?)<\/tr>/g)]
    .map((m) => [...m[1].matchAll(/<td>([\s\S]*?)<\/td>/g)].map((c) => textOf(c[1])));
  return { headers, rows };
}

function parseListItems(body, ordered) {
  const tag = ordered ? 'ol' : 'ul';
  const list = body.match(new RegExp(`<${tag}(?: class="[^"]*")?>([\\s\\S]*?)</${tag}>`));
  if (!list) return [];
  return [...list[1].matchAll(/<li>([\s\S]*?)<\/li>/g)].map((m) => textOf(m[1]));
}

function artifactFromSection(type, id, body) {
  const title = textOf((body.match(/<h2 class="h2" style="margin-top:8px">([\s\S]*?)<\/h2>/) || [])[1] || '');
  if (!title) return null;
  const introMatch = body.match(/<\/h2><p class="muted">([\s\S]*?)<\/p>/);
  const artifact = { type, title };
  if (id) { artifact.id = id; artifact.marker = id; }
  if (introMatch) artifact.intro = textOf(introMatch[1]);

  if (TABLE_TYPES.has(type)) {
    const parsed = parseRows(body);
    if (!parsed || !parsed.rows.length) return null;
    artifact.headers = parsed.headers;
    artifact.rows = parsed.rows;
  } else if (type === 'script') {
    const codeLines = [...body.matchAll(/<li><code>([\s\S]*?)<\/code><\/li>/g)].map((m) => textOf(m[1]));
    if (codeLines.length) artifact.lines = codeLines;
    else {
      const items = parseListItems(body, true);
      if (!items.length) return null;
      artifact.items = items;
    }
  } else if (type === 'source_block') {
    const sources = [...body.matchAll(/<li><a href="([^"]*)">([\s\S]*?)<\/a>(?: — ([\s\S]*?))?<\/li>/g)]
      .map((m) => ({ url: unescapeHtml(m[1]), label: textOf(m[2]), ...(m[3] ? { claim: textOf(m[3]) } : {}) }));
    if (sources.length) artifact.sources = sources;
    else {
      const items = parseListItems(body, false);
      if (!items.length) return null;
      artifact.items = items;
    }
    const reviewed = body.match(/Editorial review date: ([\s\S]*?)<\/p>/);
    if (reviewed) artifact.reviewed_date = textOf(reviewed[1]);
    const recheck = body.match(/Policy\/source recheck due: ([\s\S]*?)<\/p>/);
    if (recheck) artifact.recheck_date = textOf(recheck[1]);
  } else {
    const ordered = type === 'numbered_framework' || type === 'protocol';
    const items = parseListItems(body, ordered);
    if (!items.length) return null;
    artifact.items = items;
  }
  return artifact;
}

// The content atom renders its ONE artifact inside a
// <section class="programmatic-content-atom"> wrapper, using the same markup. That
// block is derived fresh from the page's content_atom on every build - it is not at
// risk and it is not this store's business. Recovering it and merging it back at the
// page level would publish the atom twice on every page that has one.
const ATOM_WRAPPER_RX = /<section class="programmatic-content-atom"[^>]*>[\s\S]*?<\/section><\/section>/g;
function stripContentAtomBlocks(html) { return String(html || '').replace(ATOM_WRAPPER_RX, ''); }

/** Every page-level citation-velocity artifact rendered in `html`, in document order. */
function artifactsFromRenderedHtml(html) {
  const out = [];
  const scanned = stripContentAtomBlocks(html);
  SECTION_RX.lastIndex = 0;
  let m;
  while ((m = SECTION_RX.exec(scanned))) {
    const artifact = artifactFromSection(m[1], m[2] || '', m[3]);
    if (artifact) out.push(artifact);
  }
  return out;
}

/** Stable identity for "the same artifact", independent of the id the pipeline assigned. */
function artifactKey(artifact) {
  return `${String(artifact && artifact.type || '')}|${String(artifact && artifact.title || '').trim()}`;
}

module.exports = { artifactsFromRenderedHtml, artifactKey, unescapeHtml, stripContentAtomBlocks };
