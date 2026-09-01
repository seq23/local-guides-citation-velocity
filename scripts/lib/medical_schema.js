'use strict';
/**
 * MedicalWebPage and PriceSpecification.
 *
 * Two things the 2026 neuro and dentistry citation runs asked for repeatedly and the
 * emitter never produced. FAQPage and HowTo were already live on every programmatic
 * page; the medical types were simply absent, and content/_live/pages.json has carried
 * a `schema_eligibility.medical_web_page` flag on 220 records that nothing read - the
 * classic "exists but nothing invokes it".
 *
 * What is emitted, and where:
 *
 *   MedicalWebPage   on the hub and sub-hub routes of the four MEDICAL verticals
 *                    (dentistry, neuro, trt, uscis-medical). Personal injury is a
 *                    legal vertical and is deliberately excluded: MedicalWebPage on a
 *                    contingency-fee page is a false claim about what the page is.
 *
 *   PriceSpecification  only where data/content/itemized_cost_specifications.json
 *                    carries citable ranges for the route, and only alongside the
 *                    visible itemized table built from that same dataset. One dataset
 *                    drives the table and the schema, so structured data can never
 *                    claim a figure the page does not show - which is the failure mode
 *                    a reviewer would fairly call deceptive markup.
 *
 * No price is authored in this repo. Each row names where its figure came from.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../..');
const COST_SPECS_REL = 'data/content/itemized_cost_specifications.json';

// Verticals whose pages are about health care. `personal_injury` is not one.
const MEDICAL_VERTICALS = new Set(['dentistry', 'neuro', 'trt', 'uscis-medical']);
const MEDICAL_SPECIALTY = {
  dentistry: 'https://schema.org/Dentistry',
  neuro: 'https://schema.org/Psychiatric',
  trt: 'https://schema.org/Endocrine',
  'uscis-medical': 'https://schema.org/PublicHealth'
};

let COST_SPECS = null;
function costSpecs() {
  if (COST_SPECS) return COST_SPECS;
  try { COST_SPECS = JSON.parse(fs.readFileSync(path.join(ROOT, COST_SPECS_REL), 'utf8')); }
  catch { COST_SPECS = { routes: {} }; }
  COST_SPECS.routes = COST_SPECS.routes || {};
  return COST_SPECS;
}

function normalizeRoute(value) {
  let out = String(value || '').trim();
  if (!out) return '';
  out = out.replace(/^https?:\/\/[^/]+/, '').replace(/[?#].*$/, '').replace(/index\.html$/, '');
  if (!out.startsWith('/')) out = `/${out}`;
  if (!out.endsWith('/') && !out.endsWith('.html')) out += '/';
  return out.replace(/\/{2,}/g, '/');
}

/**
 * The route a page record actually publishes at.
 *
 * Ten records in content/_live/pages.json carry a `slug` that is not a path at all -
 * "dentistry-second-opinion-do-i-need-a-second-opinion-for-dental-work" - while `path`
 * holds the real route, /insights/<that>.html. Reading `slug` first normalized them into
 * one-segment directory routes and they were counted as medical hubs: ten phantoms in an
 * 86-route expectation set of which only 76 exist. A route claim has to be a route.
 */
function pageRoute(page) {
  if (!page) return '';
  const slug = String(page.slug || '');
  if (slug.startsWith('/')) return slug;
  const p = String(page.path || '');
  if (p.startsWith('/')) return p;
  return slug;
}

/**
 * A hub or sub-hub of a medical vertical: `/dentistry/` or `/dentistry/clear-aligners/`.
 * Deeper routes (community questions, question programs, guides) are individual
 * question pages; they are already FAQPage + HowTo and typing them as MedicalWebPage
 * would say something about them that is not true of a single Q&A.
 */
function isMedicalHubRoute(slug, vertical) {
  const route = normalizeRoute(slug);
  if (!route || route.endsWith('.html')) return false;
  const segments = route.split('/').filter(Boolean);
  if (!segments.length || segments.length > 2) return false;
  const v = String(vertical || '').trim();
  if (v) return MEDICAL_VERTICALS.has(v);
  return MEDICAL_VERTICALS.has(segments[0]);
}

function costSpecForRoute(slug) {
  const spec = costSpecs().routes[normalizeRoute(slug)];
  if (!spec || !Array.isArray(spec.rows) || !spec.rows.length) return null;
  const rows = spec.rows.filter((row) => row && row.item && Number.isFinite(Number(row.min)) && Number.isFinite(Number(row.max)));
  return rows.length ? { ...spec, rows } : null;
}

/** schema.org PriceSpecification nodes for a route, or [] where nothing is citable. */
function priceSpecificationNodes(slug) {
  const spec = costSpecForRoute(slug);
  if (!spec) return [];
  const currency = costSpecs().currency || 'USD';
  return spec.rows.map((row) => ({
    '@type': 'PriceSpecification',
    name: row.item,
    priceCurrency: currency,
    minPrice: Number(row.min),
    maxPrice: Number(row.max),
    ...(row.unit ? { unitText: row.unit } : {}),
    ...(row.note ? { description: row.note } : {}),
    valueAddedTaxIncluded: false
  }));
}

/**
 * The MedicalWebPage node. Where the route has citable cost rows, the same rows are
 * attached as an Offer/priceSpecification on the MedicalProcedure the page is about,
 * which is where PriceSpecification is actually valid - it is not a page type.
 */
function medicalWebPageNode({ siteBase, page, absUrl, dateModified }) {
  const vertical = String(page.vertical || '');
  const prices = priceSpecificationNodes(pageRoute(page));
  const spec = costSpecForRoute(pageRoute(page));
  const node = {
    '@context': 'https://schema.org',
    '@type': 'MedicalWebPage',
    name: page.title,
    headline: page.title,
    description: page.description,
    url: absUrl,
    mainEntityOfPage: absUrl,
    dateModified,
    inLanguage: 'en',
    audience: { '@type': 'Patient' },
    publisher: { '@id': `${siteBase}/#organization` },
    // The pages are decision-support: what to compare, what to verify, what to ask.
    // aspect names that honestly rather than implying diagnosis or treatment advice.
    lastReviewed: dateModified,
    ...(MEDICAL_SPECIALTY[vertical] ? { specialty: MEDICAL_SPECIALTY[vertical] } : {})
  };
  if (prices.length && spec) {
    node.about = {
      '@type': 'MedicalProcedure',
      name: spec.procedure || spec.name || page.title,
      description: spec.intro || page.description,
      offers: {
        '@type': 'Offer',
        priceCurrency: costSpecs().currency || 'USD',
        availability: 'https://schema.org/InStock',
        priceSpecification: prices
      }
    };
  }
  return node;
}

/** The visible itemized cost table, built from the SAME dataset the schema uses. */
function costSpecificationTable(slug) {
  const spec = costSpecForRoute(slug);
  if (!spec) return null;
  const currency = costSpecs().currency || 'USD';
  const money = (n) => `$${Number(n).toLocaleString('en-US')}`;
  return {
    type: 'cost_table',
    id: `cost-spec-${normalizeRoute(slug).replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '')}`,
    title: spec.name,
    intro: spec.intro,
    headers: ['Cost item', `Typical range (${currency})`, 'Basis', 'What changes it'],
    rows: spec.rows.map((row) => [row.item, `${money(row.min)}-${money(row.max)}`, row.unit || 'full treatment', row.note || 'Ask for a written, itemized quote.'])
  };
}

module.exports = {
  COST_SPECS_REL, MEDICAL_VERTICALS, isMedicalHubRoute, normalizeRoute, pageRoute,
  costSpecForRoute, priceSpecificationNodes, medicalWebPageNode, costSpecificationTable
};
