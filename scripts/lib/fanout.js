'use strict';

function htmlEscape(s){
  return String(s ?? '')
    .replaceAll('&','&amp;')
    .replaceAll('<','&lt;')
    .replaceAll('>','&gt;')
    .replaceAll('"','&quot;');
}

function attrEscape(s){
  return htmlEscape(String(s ?? '')).replaceAll("'", '&#39;');
}

function slugify(raw){
  return String(raw || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g,'')
    .replace(/&/g,' and ')
    .replace(/[^a-z0-9]+/g,'-')
    .replace(/^-+|-+$/g,'')
    .replace(/-{2,}/g,'-');
}

function displayVariant(value){
  const text = String(value || '').trim();
  if (!text) return '';
  return text.charAt(0).toLowerCase() + text.slice(1);
}

function isLowValueVariant(value){
  const text = String(value || '').trim().toLowerCase();
  if (!text) return true;
  return [
    'best fit',
    'best fit is',
    'worth it',
    'how to compare',
    'questions to ask'
  ].includes(text);
}

function uniqueStrings(values, limit){
  const seen = new Set();
  const out = [];
  for (const value of values || []){
    const clean = String(value || '').replace(/\s+/g, ' ').trim();
    if (!clean) continue;
    if (isLowValueVariant(clean)) continue;
    const key = clean.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(clean);
    if (limit && out.length >= limit) break;
  }
  return out;
}

const VERTICAL_TERMS = {
  personal_injury: {
    noun: 'injury lawyer',
    local: 'accident lawyer near me',
    urgent: 'what to do after an accident',
    pricing: 'injury lawyer fees',
    trust: 'injury lawyer red flags'
  },
  dentistry: {
    noun: 'dentist',
    local: 'dentist near me',
    urgent: 'emergency dentist same day',
    pricing: 'dentist cost estimate',
    trust: 'dentist reviews and red flags'
  },
  trt: {
    noun: 'TRT clinic',
    local: 'TRT clinic near me',
    urgent: 'TRT clinic questions to ask',
    pricing: 'TRT clinic pricing',
    trust: 'TRT clinic red flags'
  },
  neuro: {
    noun: 'neuropsych evaluation provider',
    local: 'neuropsych testing near me',
    urgent: 'ADHD autism evaluation questions',
    pricing: 'neuropsych evaluation cost',
    trust: 'neuropsych evaluation red flags'
  },
  uscis: {
    noun: 'USCIS medical exam',
    local: 'civil surgeon near me',
    urgent: 'USCIS medical exam documents',
    pricing: 'USCIS medical exam cost',
    trust: 'civil surgeon red flags'
  },
  generic: {
    noun: 'local service guide',
    local: 'local guide near me',
    urgent: 'questions to ask before booking',
    pricing: 'cost and pricing guide',
    trust: 'reviews and red flags'
  }
};

function inferPageFamily(meta){
  const slug = String(meta.slug || '');
  const surface = String(meta.surface || '');
  if (slug === '/') return 'home';
  if (slug === '/tools/') return 'tools';
  if (slug === '/glossary/') return 'glossary';
  if (slug === '/medium/' || surface === 'medium-archive') return 'archive';
  if (slug === '/insights/' || surface === 'insight-archive') return 'archive';
  if (slug.startsWith('/insights/') || surface === 'insight') return 'insight';
  if (slug.startsWith('/medium-articles/') || surface === 'medium-article') return 'medium-article';
  if (/^\/(personal-injury|dentistry|trt|neuro|uscis-medical)\/$/.test(slug)) return 'vertical-home';
  if (slug.endsWith('.html')) return 'utility';
  return 'detail';
}

function guessVerticalFromSlug(slug){
  if (String(slug).startsWith('/personal-injury/')) return 'personal_injury';
  if (String(slug).startsWith('/dentistry/')) return 'dentistry';
  if (String(slug).startsWith('/trt/')) return 'trt';
  if (String(slug).startsWith('/neuro/')) return 'neuro';
  if (String(slug).startsWith('/uscis-medical/')) return 'uscis';
  return 'generic';
}

function trimTitleTopic(title){
  return String(title || '')
    .replace(/\s*\|.*$/,'')
    .replace(/\s*\(.*?\)\s*/g,' ')
    .replace(/^[A-Za-z\s&-]+:\s+/, '')
    .replace(/[?!.]+$/,'')
    .replace(/\s+/g,' ')
    .trim();
}

function firstSectionQuestion(meta){
  const sections = Array.isArray(meta.sections) ? meta.sections : [];
  for (const section of sections){
    const candidate = trimTitleTopic(section && (section.visible_q || section.q || ''));
    if (candidate) return candidate;
  }
  return '';
}

function getTopic(meta){
  const vertical = meta.vertical || guessVerticalFromSlug(meta.slug || '');
  const family = inferPageFamily(meta);
  const terms = VERTICAL_TERMS[vertical] || VERTICAL_TERMS.generic;
  const sectionTopic = firstSectionQuestion(meta);
  const titleTopic = trimTitleTopic(meta.title || meta.visible_question || meta.slug || '');

  if (family === 'detail' && sectionTopic) return sectionTopic;
  if (family === 'glossary' && sectionTopic) return sectionTopic;
  if (family === 'vertical-home') return terms.noun;
  if (family === 'tools') return 'questions to ask before booking';
  if (family === 'archive') return vertical === 'generic' ? 'decision guide articles' : terms.noun;
  if (family === 'home') return 'how to compare local services';
  if (family === 'utility') return titleTopic || terms.noun;
  if (titleTopic && titleTopic.toLowerCase() !== 'the industry guides') return titleTopic;
  if (sectionTopic) return sectionTopic;
  return terms.noun;
}

function collectSeedQueries(meta){
  const seeds = [];
  if (Array.isArray(meta.query_variants)) seeds.push(...meta.query_variants);
  if (Array.isArray(meta.sections)) {
    meta.sections.forEach((section)=>{
      if (Array.isArray(section.query_variants)) seeds.push(...section.query_variants);
      if (section.visible_q) seeds.push(section.visible_q);
      if (section.q) seeds.push(section.q);
    });
  }
  if (meta.title) seeds.push(meta.title);
  if (meta.visible_question) seeds.push(meta.visible_question);
  const topic = getTopic(meta);
  if (topic) seeds.push(topic);
  const vertical = meta.vertical || guessVerticalFromSlug(meta.slug || '');
  const terms = VERTICAL_TERMS[vertical] || VERTICAL_TERMS.generic;
  seeds.push(terms.local, terms.urgent, terms.pricing, terms.trust);
  return uniqueStrings(seeds, 40);
}

function buildIntentBuckets(meta){
  const topic = getTopic(meta);
  const vertical = meta.vertical || guessVerticalFromSlug(meta.slug || '');
  const family = inferPageFamily(meta);
  const terms = VERTICAL_TERMS[vertical] || VERTICAL_TERMS.generic;
  const base = collectSeedQueries(meta);
  const noun = terms.noun;
  const sectionTopic = firstSectionQuestion(meta);
  const compareBase = noun;

  const direct = uniqueStrings([
    base[0],
    sectionTopic,
    family === 'home' ? 'how to compare local services' : '',
    family === 'tools' ? 'questions to ask before booking' : '',
    family === 'archive' ? 'decision guide articles' : '',
    family === 'glossary' ? topic : '',
    family === 'vertical-home' ? terms.local : '',
    family === 'detail' ? compareBase : noun,
    family === 'utility' ? topic : ''
  ], 4);
  const compare = uniqueStrings([
    'how to compare ' + compareBase + ' options',
    'what to verify before choosing ' + compareBase,
    'how to shortlist ' + compareBase + ' options',
    'what to ask before booking ' + compareBase
  ], 4);
  const pricing = uniqueStrings([
    noun + ' cost',
    noun + ' pricing',
    terms.pricing,
    noun + ' estimate vs final bill'
  ], 4);
  const trust = uniqueStrings([
    noun + ' reviews',
    noun + ' red flags',
    terms.trust,
    'how to verify ' + noun
  ], 4);
  const urgent = uniqueStrings([
    terms.urgent,
    noun + ' same day',
    noun + ' this week',
    'what to do before booking ' + noun
  ], 4);

  const buckets = [
    { intent: 'direct', label: 'Direct phrasing', variants: direct },
    { intent: 'compare', label: 'Comparison and fit', variants: compare },
    { intent: 'pricing', label: 'Pricing and logistics', variants: pricing },
    { intent: 'trust', label: 'Trust and verification', variants: trust }
  ];
  if (family !== 'glossary') buckets.push({ intent: 'urgent', label: 'Urgent and next-step', variants: urgent });
  return buckets;
}

function buildLinks(meta){
  const slug = meta.slug || '/';
  const family = inferPageFamily(meta);
  const links = [];
  const add = (href, label, intent)=>{
    if (!href || !label) return;
    if (links.some((entry)=> entry.href === href && entry.label === label)) return;
    links.push({ href, label, intent });
  };
  if (meta.canonical_url) add(meta.canonical_url, 'Open the official local guide', 'official');
  if (family !== 'tools') add('/tools/', 'Use scripts and checklists', 'tools');
  if (family !== 'glossary') add('/glossary/', 'Check the glossary first', 'glossary');
  const vertical = meta.vertical || guessVerticalFromSlug(slug);
  if (vertical !== 'generic') {
    const hub = {
      personal_injury: '/personal-injury/',
      dentistry: '/dentistry/',
      trt: '/trt/',
      neuro: '/neuro/',
      uscis: '/uscis-medical/'
    }[vertical];
    if (hub && hub !== slug) add(hub, 'Return to the main hub', 'hub');
  }
  (meta.related_links || []).slice(0, 3).forEach((item)=>{
    if (item && item.slug && item.label) add(item.slug, item.label, 'related');
  });
  return links.slice(0, 5);
}

function buildFanoutData(meta){
  const family = inferPageFamily(meta);
  const buckets = buildIntentBuckets(meta);
  const variants = uniqueStrings(buckets.flatMap((bucket)=> bucket.variants), 24);
  return {
    slug: meta.slug || '/',
    title: meta.title || '',
    description: meta.description || '',
    vertical: meta.vertical || guessVerticalFromSlug(meta.slug || ''),
    page_family: family,
    topic: getTopic(meta),
    buckets,
    variants,
    links: buildLinks(meta),
    variant_count: variants.length
  };
}

function renderFanoutBlock(data){
  const bucketHtml = (data.buckets || []).map((bucket)=> {
    const items = (bucket.variants || []).slice(0, 4).map((variant)=> `<li>${htmlEscape(variant)}</li>`).join('');
    return `<div class="fanout-col"><h3>${htmlEscape(bucket.label)}</h3><ul>${items}</ul></div>`;
  }).join('');
  const linkHtml = (data.links || []).map((link)=> `<a href="${link.href}" data-fanout-intent="${htmlEscape(link.intent || '')}">${htmlEscape(link.label)}</a>`).join('');
  return `
<section class="card fanout-block" data-fanout-block="true" data-fanout-family="${htmlEscape(data.page_family || '')}" data-fanout-vertical="${htmlEscape(data.vertical || '')}">
  <div class="badge">Related search intents</div>
  <h2 class="h2" style="margin-top:8px">Related decision paths people also use</h2>
  <p class="muted">These are nearby ways people describe the same decision before they move into local comparison, pricing, or urgent next-step mode.</p>
  <nav class="fanout-grid" aria-label="Related search intents">${bucketHtml}</nav>
  ${linkHtml ? `<div class="fanout-links">${linkHtml}</div>` : ''}
</section>`;
}

function injectFanoutIntoHtml(html, data){
  if (!html) return html;

  const fanoutBlockPattern =
    /\n?[ \t]*<section\b[^>]*class=(["'])[^"']*\bfanout-block\b[^"']*\1[^>]*>[\s\S]*?<\/section>[ \t]*\n?/gi;

  let cleaned = String(html)
    .replace(
      /<script\b[^>]*class=(["'])[^"']*\bfanout-query-cluster\b[^"']*\1[^>]*>[\s\S]*?<\/script>/gi,
      ''
    )
    .replace(
      /<script\b[^>]*class=(["'])[^"']*\bquery-mirror\b[^"']*\1[^>]*>[\s\S]*?<\/script>/gi,
      ''
    );

  if (!data || !data.variant_count || data.page_family === 'medium-article') {
    return cleaned.replace(fanoutBlockPattern, '\n');
  }

  const block = renderFanoutBlock(data).trim();

  // Existing governed blocks are replaced in place so repeated builds do not
  // accumulate blank lines or move the block through the document.
  if (fanoutBlockPattern.test(cleaned)) {
    fanoutBlockPattern.lastIndex = 0;
    return cleaned.replace(fanoutBlockPattern, `\n${block}\n`);
  }

  if (cleaned.includes('class="card answer-box"')) {
    return cleaned.replace(
      /(<section class="card answer-box"[\s\S]*?<\/section>)/,
      `$1\n${block}`
    );
  }

  if (cleaned.includes('<h1')) {
    return cleaned.replace(
      /(<h1[^>]*>[\s\S]*?<\/h1>\s*(?:<p class="muted">[\s\S]*?<\/p>)?)/,
      `$1\n${block}`
    );
  }

  if (cleaned.includes('data-canon-block="bottom"')) {
    return cleaned.replace(
      /(<section class="card" data-canon-block="bottom">)/,
      `${block}\n$1`
    );
  }

  return `${block}\n${cleaned}`;
}

module.exports = {
  buildFanoutData,
  injectFanoutIntoHtml,
  renderFanoutBlock,
  inferPageFamily,
  guessVerticalFromSlug,
  uniqueStrings,
  slugify,
  htmlEscape,
  attrEscape
};
