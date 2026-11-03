'use strict';
// Shared presentation rule: facts and FAQ answers come from the page's existing
// source-backed content. No synthetic prices, timeframes, authors or review dates.
const { resolveLinks } = require('./search_rescue');
const { sayOnce, dropRepeatedFurniture, trimTitleEcho, normalize } = require('./say_once');
const openings = require('../../config/search_rescue_openings.json');
const esc = s => String(s).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('"', '&quot;');
const plain = s => String(s).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
function removeSections(html, openingPattern) {
  let match;
  while ((match = openingPattern.exec(html))) {
    const tokens = /<\/?section\b[^>]*>/gi;
    tokens.lastIndex = match.index;
    let depth = 0, token, end;
    while ((token = tokens.exec(html))) {
      depth += token[0].startsWith('</') ? -1 : 1;
      if (!depth) { end = tokens.lastIndex; break; }
    }
    if (!end) throw new Error('Search rescue: unbalanced section');
    html = html.slice(0, match.index) + html.slice(end);
    openingPattern.lastIndex = 0;
  }
  return html;
}
/**
 * A FAQPage that claims questions the page never shows.
 *
 * Search Readiness b5 ("a visible FAQ when FAQPage schema exists") failed
 * /senior-living/ on 2 of its 3 schema questions, /uscis-medical/ on 6 of 12. The
 * schema was built from the page's own answer records, but only the first question
 * was ever rendered, so the markup promised an answer engine a FAQ the reader could
 * not find -- which is the one thing Google's FAQ guidance says not to do.
 *
 * The answers are already on the page, in its schema, drawn from its own content, so
 * this renders the ones that are missing rather than trimming the schema down to the
 * one that showed: a question worth declaring is worth showing, and dropping two
 * real answers to make a checklist pass would make the page worse. Nothing is
 * invented -- every question and answer here comes out of the page's own JSON-LD.
 */
function showSchemaFaq(html) {
  const visible = plain(String(html).replace(/<script[\s\S]*?<\/script>/gi, ' ')).toLowerCase();
  const questions = [];
  for (const block of String(html).matchAll(/<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    let data; try { data = JSON.parse(block[1]); } catch { continue; }
    const stack = [data];
    while (stack.length) {
      const node = stack.pop();
      if (Array.isArray(node)) { stack.push(...node); continue; }
      if (!node || typeof node !== 'object') continue;
      if (Array.isArray(node['@graph'])) stack.push(...node['@graph']);
      if (![].concat(node['@type'] || []).includes('FAQPage')) continue;
      for (const q of [].concat(node.mainEntity || [])) {
        const name = String(q?.name || '').replace(/\s+/g, ' ').trim();
        const answer = String(q?.acceptedAnswer?.text || '').replace(/\s+/g, ' ').trim();
        if (name && answer) questions.push({ name, answer });
      }
    }
  }
  // ONE QUESTION PER ANSWER. /uscis-medical/ declared twelve questions and gave six
  // of them the same answer word for word, so rendering each missing one put that
  // answer on the page six times and traded a b5 failure for a filler failure.
  // A second question with an answer already on the page is not a second answer; it
  // is the same answer asked for twice, and the page keeps the first.
  const byAnswer = new Set();
  const distinct = [];
  for (const q of questions) {
    const key = normalize(q.answer);
    if (byAnswer.has(key)) continue;
    byAnswer.add(key);
    distinct.push(q);
  }
  // The sampler looks for the first 60 characters of the question, so match on that.
  const missing = distinct.filter((q) => !visible.includes(q.name.toLowerCase().slice(0, 60)));
  const items = missing
    .map((q) => `<section class="qa-block" data-faq="true"><h3>${esc(q.name)}</h3><p>${esc(q.answer)}</p></section>`)
    .join('');
  // The schema now says exactly what the page shows, both drawn from `distinct`, so
  // the two cannot promise an answer engine a question the reader cannot find.
  const rebuilt = String(html).replace(/<script\b([^>]*type=["']application\/ld\+json["'][^>]*)>([\s\S]*?)<\/script>/gi, (all, attrs, raw) => {
    let data; try { data = JSON.parse(raw); } catch { return all; }
    let touched = false;
    const visit = (node) => {
      if (!node || typeof node !== 'object') return;
      if ([].concat(node['@type'] || []).includes('FAQPage') && Array.isArray(node.mainEntity)) {
        node.mainEntity = distinct.map((q) => ({ '@type': 'Question', name: q.name, acceptedAnswer: { '@type': 'Answer', text: q.answer } }));
        touched = true;
      }
      Object.values(node).forEach((v) => { if (Array.isArray(v)) v.forEach(visit); else if (v && typeof v === 'object') visit(v); });
    };
    visit(data);
    return touched ? `<script${attrs}>${JSON.stringify(data).replaceAll('<', '\\u003c')}</script>` : all;
  });
  if (!items) return rebuilt;
  return rebuilt.replace(/<\/main>/i, `<section class="card" data-faq="true" data-schema-faq="true"><h2>Frequently asked questions</h2>${items}</section></main>`);
}

/**
 * The opening definition on a page the content shaper does not touch.
 *
 * `shape()` only runs on content pages (`isContent` in apply_search_rescue.js), so
 * the site's global pages -- /glossary/, /tools/ and friends -- never had an opening
 * written for them. /glossary/ opened on "Short definitions in plain English. For
 * official local guides and directories, use the canonical domains.": 23 words that
 * define nothing, which is what Search Readiness b4 and d1 failed it for on 3 Nov
 * 2026, and it was the one page of the five sampled that no template fix reached.
 *
 * A Quick answer block, a provider CTA and a rebuilt FAQ would all be wrong on a
 * glossary or a methodology note, so this adds the one thing those pages were
 * missing and nothing else: the definition paragraph, from the same
 * config/search_rescue_openings.json the content pages already read, inserted
 * straight after the H1. A route with no entry there is returned untouched, so this
 * can never invent an opening for a page nobody has written one for.
 */
function withOpeningDefinition(html, route) {
  const override = openings[route];
  if (!override || !override.definition) return html;
  const paragraph = `<p class="definition" data-definition="true">${esc(override.definition)}</p>`;
  const existing = html.match(/<p\b[^>]*(?:data-definition=["']true["']|class=["'][^"']*definition[^"']*["'])[^>]*>[\s\S]*?<\/p>/i);
  if (existing) return html.replace(existing[0], paragraph);
  const h1 = html.match(/<h1\b[^>]*>[\s\S]*?<\/h1>/i);
  if (!h1) return html;
  return html.replace(h1[0], `${h1[0]}${paragraph}`);
}

function shape(html, { route, description, date, published, title }) {
  const inputHash = require('crypto').createHash('sha256').update(JSON.stringify({ route, description, date, published, title, revision: 22, opening: openings[route] })).digest('hex');
  if (html.includes(`data-search-rescue-input="${inputHash}"`)) return resolveLinks(html);
  const preservedInline = (html.match(/<p class="canonical-guide-inline"[^>]*>[\s\S]*?<\/p>/i) || [''])[0];
  const preservedAnswer = html.match(/(?:data-direct-answer=["']true["'][^>]*>|class=["'][^"']*answer-box[^"']*["'][^>]*>)[\s\S]*?<p\b[^>]*>([\s\S]*?)<\/p>/i);
  html = removeSections(html, /<section\b[^>]*data-search-rescue-shape="[1234]"[^>]*>/gi);
  html = removeSections(html, /<section\b[^>]*data-search-rescue-faq="true"[^>]*>/gi);
  if (!/<h1\b/i.test(html)) throw new Error(`Search rescue: missing H1 ${route}`);
  const h1 = html.match(/<h1\b[^>]*>[\s\S]*?<\/h1>/i)[0];
  // Reuse the supplied definition when present; otherwise use the page-specific
  // introduction, never pad to a word quota with shared marketing copy.
  const definition = html.match(/<p\b[^>]*(?:data-definition=["']true["']|class=["'][^"']*definition[^"']*["'])[^>]*>[\s\S]*?<\/p>/i);
  const answer = html.match(/(?:data-direct-answer=["']true["'][^>]*>|class=["'][^"']*answer-box[^"']*["'][^>]*>)[\s\S]*?<p\b[^>]*>([\s\S]*?)<\/p>/i);
  const override = openings[route];
  const regionalSenior = route.startsWith('/senior-living/') && route !== '/senior-living/';
  const definitionClass = regionalSenior ? 'muted' : 'definition';
  const intro = override ? `<p class="${definitionClass}" data-definition="true">${esc(override.definition)}</p>` : definition ? definition[0].replace(/<p\b[^>]*>/i, `<p class="${definitionClass}" data-definition="true">`) : `<p class="${definitionClass}" data-definition="true">${esc(description)}</p>`;
  // The Quick answer is rendered in full here and trimmed by `sayOnce` at the end
  // of this function: it is ranked below the slots that own a sentence, so what
  // survives is whatever the definition and the page's own sections did not
  // already say. An emptied paragraph is dropped and the section stays.
  const summary = override ? esc(override.answer) : answer ? answer[1] : preservedAnswer ? preservedAnswer[1] : esc(description);
  const guideInline = preservedInline;
  let next = html;
  if (definition) next = next.replace(definition[0], '');
  next = removeSections(next, /<section\b[^>]*data-direct-answer="true"[^>]*>/gi);
  // A routing warning previously preceded main, burying the answer. Preserve
  // its disclosure and canonical markers, but put the useful answer first.
  const preamble = next.match(/<!-- CANON_TOP -->([\s\S]*?)<main\b/i);
  if (preamble) next = next.replace(preamble[0], '<main');
  // The answer belongs with the H1, ahead of warning/route cards and bylines.
  const main = next.match(/<main\b[^>]*>/i);
  if (!main) throw new Error(`Search rescue: missing main ${route}`);
  next = next.replace(h1, '');
  const checks = override?.checks ? `<h2>What should I check before deciding?</h2><ul>${override.checks.map(c => `<li>${esc(c)}</li>`).join('')}</ul>` : '';
  let opening = main[0], beforeArticle = '';
  if (regionalSenior) {
    const article = next.match(/<main\b[^>]*>([\s\S]*?)(<article id="guide-content">)/i);
    if (!article) throw new Error(`Search rescue: missing regional article ${route}`);
    beforeArticle = article[1];
    next = next.replace(article[0], main[0] + article[2]);
    opening = article[2];
  }
  next = next.replace(opening, `${opening}${h1}${intro}<section class="quick-answer answer-box" data-direct-answer="true" data-search-rescue-shape="4" data-search-rescue-input="${inputHash}"><h2>Quick answer</h2>${summary ? `<p>${summary}</p>` : ''}${guideInline}<p><strong>What this guide is best for:</strong> preparing questions about ${esc(plain(title || h1))} before making a decision.</p>${checks}</section>${preamble ? preamble[1] : ''}${beforeArticle}`);
  // Replace the insight family's generic five-question template with visible,
  // source-backed questions. Schema is rebuilt from these same answer records.
  const faq = override?.checks && route.startsWith('/insights/') ? [
    { question: plain(title || h1).replace(/[?.]+$/, '') + '?', answer: override.answer + ' ' + override.checks[0] },
    { question: 'What does this assessment or decision involve?', answer: override.definition },
    { question: 'What should I confirm before taking the next step?', answer: override.checks.join(' ') + ' Use the named primary sources below and ask the professional responsible for your situation to explain any uncertainty before you book, pay or agree to a plan.' }
  ] : null;
  if (faq) {
    next = removeSections(next, /<section class="card"><div class="badge">Five questions<\/div>/g);
    const visible = `<section class="card" data-faq="true" data-search-rescue-faq="true"><h2>Frequently asked questions</h2>${faq.map(q => `<section class="qa-block"><h3>${esc(q.question)}</h3><p>${esc(q.answer)}</p></section>`).join('')}</section>`;
    next = next.replace(/<\/main>/i, visible + '</main>');
  }
  next = next.replace(/<section class="qa-block">/g, '<section class="qa-block" data-faq="true">');
  // Every question the page's own FAQPage schema declares is rendered for the reader.
  next = showSchemaFaq(next);
  next = next.replace(/<h2([^>]*)>([^<]+)<\/h2>/g, (all, attrs, text) => {
    const names = { 'Primary sources': 'Which sources support this guide?', 'Related guides': 'What should I read next?', 'Decision checklist': 'What should I check before deciding?', 'Red flags': 'Which warning signs should I check?', 'Decision questions': 'What questions should I ask?', 'Verify the rule before acting': 'How can I verify the rule before acting?', 'What this page recommends': 'What does this page recommend?', 'Related decision paths people also use': 'Which related decisions should I consider?', 'Where this question fits': 'How does this question fit the wider topic?', 'Related questions in this cluster': 'What related questions should I ask?', 'Next questions people ask': 'What should I ask next?' };
    const heading = text.trim();
    if (['Quick answer', 'Frequently asked questions'].includes(heading) || heading.endsWith('?')) return all;
    const question = names[heading] || (heading.includes('Evidence-to-Action') ? 'How can I apply this decision framework?' : `What should I know about ${heading.charAt(0).toLowerCase() + heading.slice(1)}?`);
    return `<h2${attrs}>${question}</h2>`;
  });
  // Preserve existing visible FAQ and its single matching schema block. Add
  // speakable to the WebPage/Article, rather than a second FAQPage.
  next = next.replace(/<script\b([^>]*type=["']application\/ld\+json["'][^>]*)>([\s\S]*?)<\/script>/gi, (all, attrs, raw) => {
    let data; try { data = JSON.parse(raw); } catch { return all; }
    const visit = node => {
      if (!node || typeof node !== 'object') return;
      const types = [].concat(node['@type'] || []);
      if (faq && types.includes('FAQPage')) node.mainEntity = faq.map(q => ({ '@type': 'Question', name: q.question, acceptedAnswer: { '@type': 'Answer', text: q.answer } }));
      if (types.some(t => ['Article', 'WebPage', 'MedicalWebPage'].includes(t))) {
        node.dateModified = date;
        node.speakable = { '@type': 'SpeakableSpecification', cssSelector: ['[data-definition]', '.quick-answer', '[data-faq]'] };
        if (types.includes('Article')) { node.author = { '@type': 'Organization', name: 'The Industry Guides', url: 'https://theindustryguides.com/about' }; }
      }
      Object.values(node).forEach(v => { if (Array.isArray(v)) v.forEach(visit); else if (v && typeof v === 'object') visit(v); });
    };
    visit(data); return `<script${attrs}>${JSON.stringify(data).replaceAll('<', '\\u003c')}</script>`;
  });
  next = next.replace(/<p\b[^>]*data-editorial-byline=["']true["'][^>]*>[\s\S]*?<\/p>/gi, '');
  let nextStep = false;
  next = next.replace(/<section\b([^>]*class="[^"]*provider-cta[^"]*"[^>]*)>/gi, (all, attrs) => {
    attrs = attrs.replace(/\sdata-next-step="true"/g, '').replace(/\sstyle="border:0;box-shadow:none;background:transparent"/g, '');
    if (!nextStep) { nextStep = true; return `<section${attrs} data-next-step="true">`; }
    // Preserve existing canonical markers and links; only one CTA is a box.
    const style = ' style="border:0;box-shadow:none;background:transparent"';
    return `<section${attrs.includes(' data-closing-cta=') ? attrs.replace(' data-closing-cta=', style + ' data-closing-cta=') : attrs + style}>`;
  });
  const stamp = `<p class="editorial-byline" data-editorial-byline="true">By <a href="/about">The Industry Guides</a>${published ? ` · Published <time datetime="${esc(published)}">${esc(published)}</time>` : ''} · Updated <time datetime="${esc(date)}">${esc(date)}</time></p>`;
  next = next.replace(/<\/main>/i, `${stamp}</main>`);
  // Last, so it sees every slot this function and the page builder produced.
  const pageTitle = plain(title || h1);
  return resolveLinks(sayOnce(dropRepeatedFurniture(trimTitleEcho(next, pageTitle), pageTitle)));
}
module.exports = { shape, withOpeningDefinition, plain };
