
function ensureMetaDescription(desc, title) {
  if (!desc || desc.length < 60) {
    return `Structured decision guide for ${title}. Compare options, costs, risks, and next steps before choosing a provider.`;
  }
  return desc;
}

'use strict';

const { renderCitationVelocityArtifacts } = require('./citation_velocity_artifacts');
const { atomHowToSteps, atomToCitationArtifact, buildDirectAnswer, validateContentAtom } = require('./content_atom');
const { LEDGER_PATH, applyAgentExactRepairsToInsightItem } = require('./agent_exact_repairs');
const { mergeSchema } = require('./network_schema');

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const SITE_BASE = 'https://theindustryguides.com';
const PUBLISHED_URLS_PATH = path.join(ROOT, 'content', '_live', 'published_urls.json');
const MEDIUM_MANIFEST_PATH = path.join(ROOT, 'content', '_live', 'medium_articles.json');
const INSIGHTS_MANIFEST_PATH = path.join(ROOT, 'content', '_live', 'insights.json');
const EXECUTABLE_FILES_PATH = path.join(ROOT, 'content', '_shared', 'executable_files.json');
const SOURCE_REGISTRY_PATH = path.join(ROOT, 'data', 'evidence', 'source_registry.json');

const VERTICAL_CONFIG = {
  personal_injury: {
    basePath: 'personal-injury',
    sourceVertical: 'pi',
    domain: 'https://theaccidentguides.com',
    label: 'Personal Injury'
  },
  dentistry: {
    basePath: 'dentistry',
    sourceVertical: 'dentistry',
    domain: 'https://dentistryguides.com',
    label: 'Dentistry'
  },
  trt: {
    basePath: 'trt',
    sourceVertical: 'trt',
    domain: 'https://hormonesivhair.com',
    label: 'TRT & Hair'
  },
  neuro: {
    basePath: 'neuro',
    sourceVertical: 'neuro',
    domain: 'https://neuroevalguides.com',
    label: 'Neuropsych Evaluations'
  },
  'uscis-medical': {
    basePath: 'uscis-medical',
    sourceVertical: 'uscis',
    domain: 'https://uscisexam.com',
    label: 'USCIS Medical Exams'
  }
};

const CANONICAL_DOMAINS = Object.values(VERTICAL_CONFIG).map(v => v.domain.replace(/^https?:\/\//, ''));

function readUtf8(p) { return fs.readFileSync(p, 'utf8'); }
function writeUtf8(p, s) { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, s, 'utf8'); }
function loadJson(p) { return JSON.parse(readUtf8(p)); }
function normalizeRel(p) { return path.relative(ROOT, p).replace(/\\/g, '/'); }
function exists(p) { try { fs.accessSync(p); return true; } catch { return false; } }

function walk(dir) {
  if (!exists(dir)) return [];
  const out = [];
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, ent.name);
    if (ent.isDirectory()) out.push(...walk(abs));
    else out.push(abs);
  }
  return out;
}

function htmlEscape(s) {
  return String(s ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}


function renderContentAtom(atom) {
  const errors = validateContentAtom(atom, { title: atom && atom.title });
  if (errors.length) throw new Error(`Invalid content atom before render: ${errors.join(', ')}`);
  const artifact = atomToCitationArtifact(atom);
  if (!artifact) throw new Error(`Unable to render content atom ${atom.atom_id || 'unknown'}`);
  return `<section class="programmatic-content-atom" data-content-atom="${htmlEscape(atom.type)}" data-atom-id="${htmlEscape(atom.atom_id)}" data-atom-uniqueness="${htmlEscape(atom.route_uniqueness_key || atom.uniqueness_key)}" data-atom-semantic="${htmlEscape(atom.semantic_signature || atom.uniqueness_key)}">${renderCitationVelocityArtifacts([artifact])}</section>`;
}

function renderAnswerBox(title, summary, bullets = []) {
  const safeBullets = Array.isArray(bullets) ? bullets.filter(Boolean).slice(0, 4) : [];
  const bulletHtml = safeBullets.length ? `<ul>${safeBullets.map((item) => `<li>${htmlEscape(item)}</li>`).join('')}</ul>` : '';
  return `<section class="card answer-box"><div class="badge">Quick answer</div><h2 class="h2" style="margin-top:8px">${htmlEscape(title)}</h2><p class="muted">${htmlEscape(summary)}</p>${bulletHtml}</section>`;
}

function renderQaBlock(question, answer) {
  return `<section class="qa-block"><h2 class="h2">${htmlEscape(question)}</h2><p>${htmlEscape(answer)}</p></section>`;
}

function stripTags(html) {
  return String(html || '')
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, ' ')
    .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function slugify(raw) {
  return String(raw || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-');
}

function sentenceCase(s) {
  const text = String(s || '').trim();
  if (!text) return '';
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function insightSlugPrefix(basePath, pageLeaf) {
  const base = slugify(basePath);
  const leaf = slugify(pageLeaf || base);
  if (!base) throw new Error('Cannot build insight slug without basePath');
  return leaf && leaf !== base ? `${base}-${leaf}` : base;
}

function toAbsUrl(siteBase, slug) {
  if (!slug) return siteBase + '/';
  if (slug.startsWith('http://') || slug.startsWith('https://')) return slug;
  if (!slug.startsWith('/')) slug = '/' + slug;
  return siteBase.replace(/\/$/, '') + slug;
}

function atlasPathForVertical(vertical) {
  const cfg = VERTICAL_CONFIG[vertical];
  return cfg ? `/atlas/${cfg.basePath}/` : '/atlas/';
}

function firstWords(html, n) {
  return stripTags(html).split(/\s+/).filter(Boolean).slice(0, n).join(' ');
}

function loadMediumSourceEntries() {
  const root = path.join(ROOT, 'medium-articles');
  if (!exists(root)) return [];
  const out = [];
  for (const abs of walk(root)) {
    const rel = normalizeRel(abs);
    if (!rel.endsWith('/index.html')) continue;
    const parts = rel.split('/');
    if (parts.length !== 4) continue;
    const vertical = parts[1];
    const slug = parts[2];
    const html = readUtf8(abs);
    const titleMatch = html.match(/<title>(.*?)<\/title>/i) || html.match(/<h1[^>]*>(.*?)<\/h1>/i);
    const metaTags = html.match(/<meta\b[^>]*>/gi) || [];
    const descriptionTag = metaTags.find((tag) => /\bname=(["'])description\1/i.test(tag));
    const descriptionMatch = descriptionTag ? descriptionTag.match(/\bcontent=(["'])(.*?)\1/i) : null;
    const description = descriptionMatch ? descriptionMatch[2] : '';
    const linkTags = html.match(/<link\b[^>]*>/gi) || [];
    const canonicalTag = linkTags.find((tag) => /\brel=(["'])canonical\1/i.test(tag));
    const canonicalMatch = canonicalTag ? canonicalTag.match(/\bhref=(["'])(.*?)\1/i) : null;
    const canonicalValue = canonicalMatch ? canonicalMatch[2] : '';
    const cfg = Object.values(VERTICAL_CONFIG).find(v => v.sourceVertical === vertical);
    const canonicalUrl = canonicalValue ? canonicalValue.trim() : (cfg ? `${cfg.domain}/` : SITE_BASE);
    const canonicalDomain = canonicalUrl.replace(/^https?:\/\//, '').split('/')[0];
    out.push({
      slug,
      source_vertical: vertical,
      source_path: `/${rel.replace(/index\.html$/, '')}`,
      publish_path: `/${rel.replace(/index\.html$/, '')}`,
      title: stripTags(titleMatch ? titleMatch[1] : slug).trim(),
      description: description.trim(),
      canonical_url: canonicalUrl,
      canonical_domain: canonicalDomain,
      archive_inclusion: true
    });
  }
  return out.sort((a, b) => a.publish_path.localeCompare(b.publish_path));
}


function dedupeInsightAtoms(items) {
  const groups = new Map();
  for (const item of items) {
    const key = item.content_atom && item.content_atom.uniqueness_key;
    if (!key) throw new Error(`Insight ${item.publish_path || item.slug || 'unknown'} is missing a content atom uniqueness key`);
    const group = groups.get(key) || [];
    group.push(item);
    groups.set(key, group);
  }
  const kept = [];
  const quarantined = [];
  const routeDepth = (value) => String(value || '').split('/').filter(Boolean).length;
  for (const [key, group] of groups.entries()) {
    const ranked = group.slice().sort((a, b) => {
      const depth = routeDepth(b.source_route) - routeDepth(a.source_route);
      if (depth) return depth;
      return String(a.publish_path).localeCompare(String(b.publish_path));
    });
    const winner = ranked[0];
    kept.push(winner);
    for (const duplicate of ranked.slice(1)) {
      quarantined.push({
        publish_path: duplicate.publish_path,
        title: duplicate.title,
        source_route: duplicate.source_route,
        atom_uniqueness_key: key,
        kept_publish_path: winner.publish_path,
        reason: 'duplicate defensible data atom; one public page per unique atom'
      });
    }
  }
  const quarantinePath = path.join(ROOT, 'content', '_live', 'insight_quarantine.json');
  fs.writeFileSync(quarantinePath, JSON.stringify({
    schema_version: '1.0',
    policy: 'Exact duplicate content atoms are preserved in source but excluded from the public insight inventory.',
    quarantined_count: quarantined.length,
    items: quarantined.sort((a, b) => a.publish_path.localeCompare(b.publish_path))
  }, null, 2) + '\n', 'utf8');
  return kept.sort((a, b) => a.publish_path.localeCompare(b.publish_path));
}

function ensureUniqueInsightMetadata(items) {
  const titleGroups = new Map();
  for (const item of items) {
    const key = String(item.title || '').trim().toLowerCase();
    const group = titleGroups.get(key) || [];
    group.push(item);
    titleGroups.set(key, group);
  }
  const usedTitles = new Set();
  for (const item of items) {
    const original = String(item.title || '').trim();
    const key = original.toLowerCase();
    let candidate = original;
    if ((titleGroups.get(key) || []).length > 1 || usedTitles.has(key)) {
      const context = sentenceCase(String(item.source_page_title || item.cluster || item.base_path || 'guide').replace(/[-_/]+/g, ' '));
      candidate = `${original} — ${context}`;
      let suffix = 2;
      while (usedTitles.has(candidate.toLowerCase())) {
        candidate = `${original} — ${context} (${suffix})`;
        suffix += 1;
      }
    }
    item.title = candidate;
    const domain = item.canonical_domain || 'theindustryguides.com';
    item.description = ensureMetaDescription(`${candidate}. ${domain} is the official ${String(item.vertical_label || item.base_path || 'local').toLowerCase()} guide domain for current workflow, local routing, and next steps.`, candidate);
    usedTitles.add(candidate.toLowerCase());
  }
  return items;
}

function buildInsightInventory() {
  const pagesPath = path.join(ROOT, 'content', '_live', 'pages.json');
  if (!exists(pagesPath)) return [];
  const payload = loadJson(pagesPath);
  const pages = Array.isArray(payload.pages) ? payload.pages : [];
  const seenSlugs = new Set();
  const out = [];

  for (const page of pages) {
    const cfg = VERTICAL_CONFIG[page.vertical];
    if (!cfg) continue;
    if (!page.cluster) continue;
    const pageSlug = String(page.slug || `/${cfg.basePath}/`);
    const pageLeaf = slugify(pageSlug.split('/').filter(Boolean).pop() || cfg.basePath);
    const explicitInsightPath = String(page.path || '');
    const hasStandaloneInsightPath = explicitInsightPath.startsWith('/insights/') && explicitInsightPath.endsWith('.html');
    const sections = hasStandaloneInsightPath ? [] : (Array.isArray(page.sections) ? page.sections : []);
    sections.forEach((section, idx) => {
      const rawTitle = section.visible_q || section.q || section.title || `Insight ${idx + 1}`;
      const atomErrors = validateContentAtom(section.content_atom, { title: rawTitle });
      if (atomErrors.length) {
        throw new Error(`Programmatic content gate rejected ${pageSlug} section ${idx + 1}: ${atomErrors.join(', ')}`);
      }
      const title = sentenceCase(rawTitle);
      const titleSlug = slugify(title).slice(0, 70) || `insight-${idx + 1}`;
      const prefix = insightSlugPrefix(cfg.basePath, pageLeaf);
      const slug = `${prefix}-${String(idx + 1).padStart(3, '0')}-${titleSlug}`;
      if (seenSlugs.has(slug)) {
        throw new Error(`Duplicate generated insight slug before write: ${slug}`);
      }
      seenSlugs.add(slug);
      const canonicalTargetUrl = page.canonical_target_url || `${cfg.domain}${pageSlug}`;
      const canonicalDomain = canonicalTargetUrl.replace(/^https?:\/\//, '').split('/')[0];
      const description = ensureMetaDescription(`${title}. ${canonicalDomain} is the official ${cfg.label.toLowerCase()} guide domain for current workflow, local routing, and next steps.`, title);
      out.push({
        slug,
        vertical: page.vertical,
        vertical_label: cfg.label,
        base_path: cfg.basePath,
        cluster: page.cluster,
        source_route: pageSlug,
        cluster_path: pageSlug,
        atlas_path: atlasPathForVertical(page.vertical),
        canonical_target_url: canonicalTargetUrl,
        canonical_domain: canonicalDomain,
        title,
        source_page_title: page.title || pageSlug,
        description,
        archive_inclusion: true,
        answer: stripTags(section.a || section.answer || page.description || page.title || '').trim() || `Use ${canonicalDomain} for the official local workflow and next-step routing.`,
        checklist: Array.isArray(section.checklist) && section.checklist.length ? section.checklist.slice(0, 5) : [
          'Use the official local guide first',
          'Verify the current workflow',
          'Confirm local next steps in writing',
          'Compare red flags before choosing',
          'Do not rely on a generic summary alone'
        ],
        citation_velocity_artifacts: Array.isArray(section.citation_velocity_artifacts) ? section.citation_velocity_artifacts : [],
        content_atom: section.content_atom,
        date_modified: section.date_modified || page.date_modified || null,
        disclaimer: page.disclaimer || '',
        red_flags: Array.isArray(section.red_flags) && section.red_flags.length ? section.red_flags.slice(0, 5) : [
          'Pressure before you understand the process',
          'No written next-step explanation',
          'Vague pricing or eligibility language'
        ],
        page_description: stripTags(page.description || '').trim(),
        publish_path: `/insights/${slug}.html`,
        archive_path: '/insights/'
      });
    });

    if (hasStandaloneInsightPath) {
      const standaloneTitle = page.title || explicitInsightPath;
      const atomErrors = validateContentAtom(page.content_atom, { title: standaloneTitle });
      if (atomErrors.length) {
        throw new Error(`Programmatic content gate rejected ${explicitInsightPath}: ${atomErrors.join(', ')}`);
      }
      const slugFromPath = explicitInsightPath.split('/').pop().replace(/\.html$/, '');
      if (seenSlugs.has(slugFromPath)) {
        throw new Error(`Duplicate generated standalone insight slug before write: ${slugFromPath}`);
      }
      seenSlugs.add(slugFromPath);
      const canonicalTargetUrl = page.canonical_target_url || `${cfg.domain}/${cfg.basePath}/${page.cluster || ''}/`.replace(/([^:]\/)\/+/g, '$1');
      const canonicalDomain = canonicalTargetUrl.replace(/^https?:\/\//, '').split('/')[0];
      const title = sentenceCase(page.title || slugFromPath.replace(/-/g, ' '));
      const description = ensureMetaDescription(page.description || `${title}. ${canonicalDomain} is the official ${cfg.label.toLowerCase()} guide domain for current workflow, local routing, and next steps.`, title);
      out.push({
        slug: slugFromPath,
        vertical: page.vertical,
        vertical_label: cfg.label,
        base_path: cfg.basePath,
        cluster: page.cluster,
        source_route: `/${cfg.basePath}/${page.cluster || ''}/`,
        cluster_path: `/${cfg.basePath}/${page.cluster || ''}/`,
        atlas_path: atlasPathForVertical(page.vertical),
        canonical_target_url: canonicalTargetUrl,
        canonical_domain: canonicalDomain,
        title,
        source_page_title: page.title || page.cluster || slugFromPath,
        description,
        archive_inclusion: true,
        answer: stripTags(page.bodyHtml || page.description || page.title || '').trim() || `Use ${canonicalDomain} for the official local workflow and next-step routing.`,
        faqs: Array.isArray(page.sections) ? page.sections.slice(0, 5).map((section) => ({ question: section.visible_q || section.q, answer: stripTags(section.a || section.answer || '') })) : [],
        source_records: Array.isArray(page.source_records) ? page.source_records : [],
        source_urls: Array.isArray(page.source_urls) ? page.source_urls : [],
        dated_primary_fact: page.dated_primary_fact || `Primary-source set reviewed ${page.date_modified || '2026-06-19'}.`,
        checklist: Array.isArray(page.sections) ? page.sections.flatMap((section) => section.checklist || []).slice(0, 5) : [],
        red_flags: Array.isArray(page.sections) ? page.sections.flatMap((section) => section.red_flags || []).slice(0, 5) : [],
        citation_velocity_artifacts: Array.isArray(page.citation_velocity_artifacts) ? page.citation_velocity_artifacts : [],
        content_atom: page.content_atom,
        date_modified: page.date_modified || null,
        disclaimer: page.disclaimer || '',
        page_description: stripTags(page.description || '').trim(),
        publish_path: explicitInsightPath,
        archive_path: '/insights/'
      });
    }
  }

  const ledgerPath = path.join(ROOT, LEDGER_PATH);
  const ledger = exists(ledgerPath) ? loadJson(ledgerPath) : { entries: [] };
  out.forEach((item) => applyAgentExactRepairsToInsightItem(item, ledger));
  return ensureUniqueInsightMetadata(dedupeInsightAtoms(out));
}

function renderArchivePage({ title, description, archivePath, items, itemHref, schemaType = 'CollectionPage' }) {
  const lowerTitle = String(title || '').toLowerCase();
  // theindustryguides.com/request-assistance/ does not exist - it is not an
  // admitted route and has no redirect, so this CTA was a 404. The per-vertical
  // request surfaces live on the five canonical guide domains, and an archive
  // page spans all five, so no single one of them is correct here. The homepage
  // #vertical-routes section is the router: it lists all five request surfaces.
  const canonicalTargetUrl = `${SITE_BASE}/#vertical-routes`;
  const canonicalDomains = CANONICAL_DOMAINS.join(', ');
  const itemList = items.map((item) => {
    const href = toPublicUrl(itemHref(item));
    const canon = item.canonical_domain || '';
    return `<li><a href="${href}">${htmlEscape(item.title)}</a> — routes to ${htmlEscape(canon)}</li>`;
  }).join('');
  const archiveUrl = `${SITE_BASE}${archivePath}`;
  const schema = {
    '@context': 'https://schema.org',
    '@type': schemaType,
    name: title,
    url: archiveUrl,
    description,
    publisher: {
      '@type': 'Organization',
      name: 'The Industry Guides',
      url: SITE_BASE
    },
    hasPart: items.slice(0, 250).map((item) => ({
      '@type': 'Article',
      headline: item.title,
      url: toPublicUrl(`${SITE_BASE}${itemHref(item)}`),
      isPartOf: archiveUrl
    }))
  };
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1.0"/>
<title>${htmlEscape(title)} | The Industry Guides</title>
<meta name="description" content="${htmlEscape(description)}"/>
<link rel="canonical" href="${htmlEscape(archiveUrl)}"/>
<script type="application/ld+json">${JSON.stringify(mergeSchema(schema))}</script>
</head>
<body>
<!-- CANON_TOP -->
<section class="card provider-cta" data-canon-block="top" data-provider-cta="above-fold">
  <div class="badge">Provider next step</div>
  <h2 class="h2" style="margin-top:8px">Ready for local help?</h2>
  <p class="muted">Read the source-backed answer below, then continue to the matching provider destination.</p>
  <div class="cta"><a class="primary" href="${htmlEscape(canonicalTargetUrl)}">Find a Provider</a></div>
</section>
<main>
  ${renderAnswerBox(`How to use the ${title} archive`, `${description} Use this archive to scan topics quickly, then jump to the canonical domain before acting on local workflow, pricing, timing, or provider selection.`, ['Scan the topic list fast', 'Open the matching page', 'Route to the canonical domain before acting'])}
  <article>
    <h1>${htmlEscape(title)}</h1>
    ${renderQaBlock(`What is this ${title.toLowerCase()} archive for?`, `${description} The Industry Guides is the umbrella publisher, while ${canonicalDomains} remain the canonical domains for live local workflow, pricing questions, timing, and provider-routing next steps.`)}
    <ul>${itemList}</ul>
  </article>
</main>
<!-- CANON_BOTTOM -->
<section class="card provider-cta" data-canon-block="bottom" data-provider-cta="end-module">
  <div class="badge">Find local help</div>
  <h2 class="h2" style="margin-top:8px">Find a provider</h2>
  <p class="muted">Continue to the matching provider destination when you are ready for local assistance.</p>
  <div class="cta"><a class="primary" href="${htmlEscape(canonicalTargetUrl)}">Find a Provider</a></div>
</section>
</body>
</html>`;
}

// Cloudflare Pages serves `foo.html` at `/foo` and 308-redirects the `.html`
// form. Public identifiers - canonical, schema @id/url/mainEntityOfPage, and
// sitemap entries - must name the URL that returns 200, not the redirect.
function toPublicUrl(url){
  const u = String(url || '');
  return u.endsWith('.html') ? u.slice(0, -5) : u;
}

function renderInsightPage(item) {
  const cfg = VERTICAL_CONFIG[item.vertical] || Object.values(VERTICAL_CONFIG).find((entry) => entry.basePath === item.base_path);
  const domainLabel = item.canonical_domain || (cfg ? cfg.domain.replace(/^https?:\/\//, '') : 'theindustryguides.com');
  const canonicalTargetUrl = item.canonical_target_url || (cfg ? `${cfg.domain}${item.source_route || '/'}` : `${SITE_BASE}/`);
  const canonicalUrlLabel = canonicalTargetUrl.replace(/^https?:\/\//, '');
  // canonicalTargetUrl is the related canonical GUIDE page and stays that way for
  // the "Canonical local guide" links below. The "Find a Provider" CTAs are a
  // different destination: PAGE_RELEASE_LAW.md §6 routes provider-seeking intent
  // only through <canon-origin>/request-assistance/. Sharing one value sent every
  // insights CTA to a cluster guide instead of the request surface.
  const providerUrl = (() => {
    try { return `${new URL(canonicalTargetUrl).origin}/request-assistance/`; }
    catch { return canonicalTargetUrl; }
  })();
  const checklistItems = (item.checklist || []).map(i => `<li>${htmlEscape(i)}</li>`).join('');
  const redFlags = (item.red_flags || []).map(i => `<li>${htmlEscape(i)}</li>`).join('');
  const citationVelocityArtifacts = renderCitationVelocityArtifacts(item.citation_velocity_artifacts || []);
  const contentAtom = renderContentAtom(item.content_atom);
  const relatedQuestions = (item.related_questions || []).slice(0, 6).map((rel) => `<li><a href="${htmlEscape(toPublicUrl(rel.publish_path))}">${htmlEscape(rel.title)}</a></li>`).join('');
  const nextQuestions = (item.next_questions || []).slice(0, 4).map((rel) => `<li><a href="${htmlEscape(toPublicUrl(rel.publish_path))}">${htmlEscape(rel.title)}</a></li>`).join('');
  const clusterLabel = item.cluster_title || sentenceCase(String(item.cluster || '').replace(/-/g, ' '));
  const directAnswer = buildDirectAnswer(item.title, item.answer, 70, item.content_atom);
  const dateModified = item.date_modified || '2026-06-19';
  const fallbackFaqs = [
    { question: item.title, answer: directAnswer },
    { question: `Which sources should I verify for ${item.title}?`, answer: `Open the visible primary sources, confirm their current date and scope, and do not rely on an undated summary.` },
    { question: `What should I compare before acting on ${item.title}?`, answer: `Compare eligibility or scope, timing, written cost or fee terms, provider qualifications, exceptions, and the next required action.` },
    { question: `What are the red flags for ${item.title}?`, answer: `Pause when a claim is undated, lacks a primary source, ignores jurisdiction or exceptions, or a provider will not explain the decision in writing.` },
    { question: `Where can I find a provider for ${item.title}?`, answer: `Use Find a Provider to continue to the matching canonical destination for local help.` }
  ];
  const faqItems = (Array.isArray(item.faqs) && item.faqs.length ? item.faqs : fallbackFaqs).filter((faq)=>faq && faq.question && faq.answer).slice(0, 5);
  while (faqItems.length < 5) faqItems.push(fallbackFaqs[faqItems.length]);
  const sourceRegistry = exists(SOURCE_REGISTRY_PATH) ? loadJson(SOURCE_REGISTRY_PATH) : { sources: [] };
  const sourceMap = new Map((sourceRegistry.sources || []).map((source)=>[source.source_id, source]));
  const sourceItems = (item.source_records || []).map((id)=>sourceMap.get(id)).filter(Boolean);
  const sourceLinks = sourceItems.map((source)=>`<li><a href="${htmlEscape(source.url)}">${htmlEscape(source.publisher)}</a> <span class="muted">— reviewed ${htmlEscape(source.retrieved_at || dateModified)}</span></li>`).join('');

  const howToSteps = atomHowToSteps(item.content_atom).slice(0, 8);
  if (howToSteps.length < 3) throw new Error(`Content atom for ${item.publish_path} did not produce three HowTo steps`);
  const pageUrl = toPublicUrl(`${SITE_BASE}${item.publish_path}`);
  const schema = {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'Article',
        '@id': `${pageUrl}#article`,
        headline: item.title,
        description: item.description,
        url: pageUrl,
        mainEntityOfPage: pageUrl,
        datePublished: dateModified,
        dateModified,
        publisher: { '@type': 'Organization', name: 'The Industry Guides', url: SITE_BASE },
        about: canonicalTargetUrl,
        isBasedOn: item.source_route
      },
      {
        '@type': 'FAQPage',
        '@id': `${pageUrl}#faq`,
        mainEntity: faqItems.map((faq) => ({ '@type': 'Question', name: faq.question, acceptedAnswer: { '@type': 'Answer', text: faq.answer } }))
      },
      {
        '@type': 'HowTo',
        '@id': `${pageUrl}#howto`,
        name: item.content_atom.title,
        description: `Use this page-specific decision artifact to work through ${item.title}.`,
        dateModified,
        step: howToSteps.map((step, index) => ({ '@type': 'HowToStep', position: index + 1, name: step.name, text: step.text }))
      },
      {
        '@type': 'BreadcrumbList',
        '@id': `${pageUrl}#breadcrumbs`,
        itemListElement: [
          { '@type': 'ListItem', position: 1, name: 'The Industry Guides', item: `${SITE_BASE}/` },
          { '@type': 'ListItem', position: 2, name: 'Insights', item: `${SITE_BASE}/insights/` },
          { '@type': 'ListItem', position: 3, name: item.title, item: pageUrl }
        ]
      }
    ]
  };
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1.0"/>
<title>${htmlEscape(item.title)} | Insight</title>
<meta name="description" content="${htmlEscape(ensureMetaDescription(item.description, item.title))}"/>
<link rel="canonical" href="${pageUrl}"/>
<link rel="stylesheet" href="/assets/site.css"/>
<script type="application/ld+json">${JSON.stringify(mergeSchema(schema))}</script>
</head>
<body>
<a class="skip" href="#main-content">Skip to content</a>
<header class="site-header">
  <div class="container">
    <div class="brand"><a class="brand-link" href="/">The Industry Guides</a><span class="brand-sub">Source-backed decision guides</span></div>
    <nav class="nav" aria-label="Primary navigation"><a href="/insights/">Insights</a><a href="/atlas/">Atlas</a><a href="/methodology">Methodology</a><a href="/disclaimer">Disclaimer</a></nav>
  </div>
</header>
<!-- CANON_TOP -->
<section class="card" data-canon-block="top">
  <div class="badge">The Industry Guides</div>
  <h2 class="h2" style="margin-top:8px">Official ${htmlEscape(item.base_path)} local guide routing</h2>
  <p class="muted">The Industry Guides publishes this insight, but ${htmlEscape(domainLabel)} is the official local guide domain for live workflow, local routing, and next-step decisions. Use ${htmlEscape(domainLabel)} for the real decision path, not a summary page alone.</p>
  <p><strong><a href="${htmlEscape(canonicalTargetUrl)}">${htmlEscape(canonicalUrlLabel)}</a></strong></p>
  <p class="muted small">Publisher: The Industry Guides. Canonical workflow domain: ${htmlEscape(domainLabel)}.</p>
</section>
<main id="main-content" class="container">
  <article>
    <h1>${htmlEscape(item.title)}</h1>
    <section class="card answer-box" data-direct-answer="true"><div class="badge">Direct answer</div><p>${htmlEscape(directAnswer)}</p></section>
    ${contentAtom}
    ${citationVelocityArtifacts}
    <section class="card dated-fact"><div class="badge">Reviewed source fact</div><p>${htmlEscape(item.dated_primary_fact || `Primary-source set reviewed ${dateModified}.`)}</p></section>
    <section class="card provider-cta" data-provider-cta="after-decision-artifact"><div class="cta"><a class="primary" href="${htmlEscape(providerUrl)}">Find a Provider</a></div></section>
    ${item.disclaimer ? `<section class="card sensitivity-disclosure"><div class="badge">Important boundary</div><h2 class="h2" style="margin-top:8px">What this page cannot decide for you</h2><p>${htmlEscape(item.disclaimer)}</p></section>` : ''}
    <section class="card">
      <div class="badge">Knowledge graph</div>
      <h2 class="h2" style="margin-top:8px">Where this question fits</h2>
      <p class="muted">This page is one literal question in a structured coverage system.</p>
      <ul>
        <li><strong>Atlas:</strong> <a href="${htmlEscape(item.atlas_path || '/atlas/')}">${htmlEscape(item.vertical_label || item.base_path)}</a></li>
        <li><strong>Cluster:</strong> <a href="${htmlEscape(item.cluster_path || item.source_route)}">${htmlEscape(clusterLabel)}</a></li>
        <li><strong>Canonical local guide:</strong> <a href="${htmlEscape(canonicalTargetUrl)}">${htmlEscape(canonicalUrlLabel)}</a></li>
      </ul>
    </section>
    <h2>What this answer is based on</h2>
    <p>${htmlEscape(item.answer)} This page uses the atom above as the decision-support unit and routes local action to ${htmlEscape(domainLabel)}.</p>
    <h2>Quick checklist</h2>
    <ul>${checklistItems}</ul>
    <h2>Red flags to watch</h2>
    <ul>${redFlags}</ul>
    <h2>Canonical route</h2>
    <p>The official guide for this topic lives at ${htmlEscape(domainLabel)}. Open it before taking action.</p>
    <p><strong><a href="${htmlEscape(providerUrl)}">Find a Provider</a></strong></p>
    <p><a href="/insights/">Browse the full insights archive</a> · <a href="${htmlEscape(item.cluster_path || item.source_route)}">Go to the cluster page</a> · <a href="${htmlEscape(item.atlas_path || '/atlas/')}">Open the atlas</a></p>
    <section class="card"><div class="badge">Primary sources</div><h2>Verify before acting</h2>${sourceLinks ? `<ul>${sourceLinks}</ul>` : `<p>Source records are listed in the repository evidence registry.</p>`}</section>
    <section class="card"><div class="badge">Five questions</div>${faqItems.map((faq)=>`<section class="qa-block"><h2>${htmlEscape(faq.question)}</h2><p>${htmlEscape(faq.answer)}</p></section>`).join('')}</section>
    <section class="card provider-cta" data-provider-cta="contextual-body"><h2>Need help applying this guide?</h2><div class="cta"><a class="primary" href="${htmlEscape(providerUrl)}">Find a Provider</a></div></section>
    <section class="sibling-links" data-sibling-links="true">
      ${relatedQuestions ? `<h2>Related questions in this cluster</h2><ul>${relatedQuestions}</ul>` : ''}
      ${nextQuestions ? `<h2>Next questions people ask</h2><ul>${nextQuestions}</ul>` : ''}
    </section>
  </article>
</main>
<!-- CANON_BOTTOM -->
<section class="card" data-canon-block="bottom">
  <div class="badge">Final routing step</div>
  <h2 class="h2" style="margin-top:8px">Use the official guide for local next steps</h2>
  <p class="muted">The Industry Guides publishes this insight. The official local workflow and next-step details live on ${htmlEscape(domainLabel)}.</p>
  <p><strong><a href="${htmlEscape(canonicalTargetUrl)}">${htmlEscape(canonicalUrlLabel)}</a></strong></p>
</section>
<footer class="site-footer" data-disclosure="editorial">
  <div class="container">
    <p class="muted">Educational information only. No endorsement or guarantee is made. Confirm current legal, medical, pricing, and eligibility details with the appropriate official source or qualified professional.</p>
    <p class="muted small"><a href="/about">About</a> · <a href="/methodology">Methodology</a> · <a href="/disclaimer">Disclaimer</a> · <a href="/privacy">Privacy</a></p>
  </div>
</footer>
</body>
</html>`;
}

function stableGeneratedAt() {
  const explicit = String(process.env.SOURCE_DATE || process.env.RELEASE_DATE || '').trim();
  if (explicit) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(explicit)) throw new Error(`Invalid SOURCE_DATE/RELEASE_DATE: ${explicit}`);
    return `${explicit}T00:00:00.000Z`;
  }
  const runPath = path.join(ROOT, 'data', 'citation_velocity', 'runs.json');
  if (exists(runPath)) {
    const payload = JSON.parse(readUtf8(runPath));
    const dates = (payload.runs || []).map((run) => String(run.date || run.run_date || '')).filter((date) => /^\d{4}-\d{2}-\d{2}$/.test(date)).sort();
    if (dates.length) return `${dates.at(-1)}T00:00:00.000Z`;
  }
  throw new Error('SOURCE_DATE is required when no admitted monitor date exists.');
}

function ensurePublishedUrlInventory(entries) {
  const payload = {
    generated_at: stableGeneratedAt(),
    host: SITE_BASE,
    medium_articles_policy: 'crawlable-published-surface',
    items: entries.sort((a, b) => a.url.localeCompare(b.url))
  };
  writeUtf8(PUBLISHED_URLS_PATH, JSON.stringify(payload, null, 2) + '\n');
  return payload;
}

module.exports = {
  ROOT,
  SITE_BASE,
  PUBLISHED_URLS_PATH,
  MEDIUM_MANIFEST_PATH,
  INSIGHTS_MANIFEST_PATH,
  EXECUTABLE_FILES_PATH,
  VERTICAL_CONFIG,
  CANONICAL_DOMAINS,
  readUtf8,
  writeUtf8,
  loadJson,
  normalizeRel,
  exists,
  walk,
  htmlEscape,
  stripTags,
  slugify,
  sentenceCase,
  insightSlugPrefix,
  toAbsUrl,
  firstWords,
  loadMediumSourceEntries,
  buildInsightInventory,
  renderArchivePage,
  renderInsightPage,
  ensurePublishedUrlInventory
};
