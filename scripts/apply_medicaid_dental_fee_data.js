#!/usr/bin/env node
'use strict';
/**
 * Put official state Medicaid dental reimbursement rates onto the 100 dentistry
 * state pages.
 *
 * THE RULE THIS SCRIPT EXISTS TO ENFORCE
 * --------------------------------------
 * A Medicaid reimbursement rate is what a state pays a dental provider. It is
 * NOT what a patient pays, and the two differ by a large and variable margin.
 * Every figure this script emits is written as a complete sentence that names
 * the state and says the money goes to the dentist, because those cells are
 * reused outside their table: the page's HowTo structured data quotes the
 * second cell of every row verbatim, so a bare "$45.45" there would travel to
 * an answer engine with nothing attached saying what it is.
 *
 * Figures land only on the Medicaid pages, where the reimbursement framing is
 * native to the question. The marketplace pages get the same state's adult
 * benefit scope, quoted from the state, and no dollar figures at all - a
 * reimbursement rate has no business on a page about buying commercial dental
 * cover.
 *
 * States without a public schedule say so on their own page and carry no
 * figures. That is a supported outcome, not a gap to fill.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const VERIFIED = '2026-08-26';
const read = (rel) => JSON.parse(fs.readFileSync(path.join(ROOT, rel), 'utf8'));
const write = (rel, value) =>
  fs.writeFileSync(path.join(ROOT, rel), JSON.stringify(value, null, 2) + '\n');

const DATA = 'data/evidence/medicaid_dental_fee_schedules.json';
const SOURCES = 'data/evidence/source_registry.json';
const STATE_SOURCES = 'data/evidence/state_source_registry.json';
const SPECS = 'data/page_families/velocity_page_specs.json';

const money = (n) => `$${Number(n).toLocaleString('en-US', {
  minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const SCOPE_SENTENCE = {
  comprehensive: 'a comprehensive adult dental benefit',
  limited: 'a limited adult dental benefit',
  'emergency-only': 'an emergency-only adult dental benefit',
  none: 'no routine adult dental benefit',
};

// Procedures a reader actually searches for, in the order they should be read.
const HEADLINE = ['D1110', 'D0120', 'D2740', 'D3330', 'D7140', 'D6010'];

function pickRows(state) {
  // Lead with the procedures people search for, then fill out the rest so the
  // table is a schedule and not a teaser.
  const byCode = new Map(state.procedures.map((p) => [p.cdt_code, p]));
  const lead = HEADLINE.map((c) => byCode.get(c)).filter(Boolean);
  const rest = state.procedures.filter((p) => !HEADLINE.includes(p.cdt_code));
  return [...lead, ...rest];
}

function feeTableAtom(state, existing) {
  const name = state.state;
  const banded = state.procedures.some((p) => p.amounts.child !== undefined
    || p.amounts.adult !== undefined);
  const effective = state.effective_date
    ? `effective ${state.effective_date}`
    : 'see the schedule for per-code effective dates';

  let headers;
  let rows;
  if (banded) {
    headers = ['Procedure (CDT code)',
      'Paid to the dentist for a patient under 21',
      'Paid to the dentist for a patient 21 and over'];
    rows = pickRows(state).map((p) => {
      const child = p.amounts.child !== undefined
        ? `${name} Medicaid pays a dentist ${money(p.amounts.child)} for a patient under 21`
        : 'No rate listed for this age group';
      const adult = p.amounts.adult !== undefined
        ? `${money(p.amounts.adult)} paid to the dentist for a patient 21 and over`
        : 'No rate listed for this age group';
      return [`${p.procedure} (CDT ${p.cdt_code})`, child, adult];
    });
  } else {
    headers = ['Procedure (CDT code)',
      `What ${name} Medicaid pays the dentist`, 'Rate basis'];
    rows = pickRows(state).map((p) => [
      `${p.procedure} (CDT ${p.cdt_code})`,
      `${name} Medicaid pays a dentist ${money(p.amounts.all)}`,
      `State reimbursement, ${effective}`,
    ]);
  }

  return Object.assign({}, existing, {
    type: 'original_comparison_table',
    title: `${name} Medicaid dental reimbursement: what the program pays a dentist, not what a patient pays`,
    headers,
    rows,
    steps: undefined,
    source_basis: {
      method: 'official_state_medicaid_fee_schedule',
      source_route: state.slug ? `/dentistry/states/${state.slug}/medicaid-dental-coverage/` : '/',
      source_fields: ['medicaid_dental_fee_schedules', 'state_authority', 'source_records'],
      factual_claim_scope: `Reimbursement amounts published by ${state.publisher} in ${state.schedule_title}. `
        + 'Each amount is the state\'s payment to a dental provider and is not a price a patient pays. '
        + 'No consumer price is stated or implied.',
    },
  });
}

function datedFactPublished(state) {
  const scope = SCOPE_SENTENCE[state.adult_dental_benefit.scope];
  const effective = state.effective_date
    ? `The schedule is effective ${state.effective_date}.`
    : `${state.effective_date_text}`;
  const scopeText = scope
    ? ` ${state.state} operates ${scope} for adults 21 and over; children's dental care is required federally under EPSDT.`
    : '';
  return `${state.state} Medicaid dental reimbursement rates on this page are taken from ${state.schedule_title}, `
    + `published by ${state.publisher}, and retrieved ${VERIFIED}. ${effective} `
    + 'Every amount shown is what the state pays a dental provider for the procedure. It is not a price a patient pays, '
    + `and self-pay and insured prices are typically far higher.${scopeText} Verified ${VERIFIED}.`;
}

function datedFactMissing(state) {
  const scope = SCOPE_SENTENCE[state.adult_dental_benefit.scope];
  const scopeText = scope
    ? ` ${state.state} operates ${scope} for adults 21 and over; children's dental care is required federally under EPSDT.`
    : '';
  return `${state.state} does not publish a Medicaid dental fee schedule this guide can cite, so no ${state.state} `
    + `reimbursement figures appear here. ${state.reason_no_figures}`
    + `${scopeText} No figure has been estimated, averaged, or carried over from another state. Verified ${VERIFIED}.`;
}

function applyState(state, specByRoute, sourceIds) {
  const slug = state.slug;
  const medicaidRoute = `/dentistry/states/${slug}/medicaid-dental-coverage/`;
  const marketRoute = `/dentistry/states/${slug}/dental-insurance-marketplace/`;
  const med = specByRoute.get(medicaidRoute);
  const market = specByRoute.get(marketRoute);
  if (!med) throw new Error(`missing medicaid spec for ${slug}`);
  if (!market) throw new Error(`missing marketplace spec for ${slug}`);

  const published = state.status === 'PUBLISHED';
  const scope = SCOPE_SENTENCE[state.adult_dental_benefit.scope];

  // --- Medicaid page -------------------------------------------------------
  med.dated_primary_fact = published ? datedFactPublished(state) : datedFactMissing(state);
  if (published) med.content_atom = feeTableAtom(state, med.content_atom);

  const feeId = sourceIds.fee.get(slug);
  const benefitId = sourceIds.benefit.get(slug);
  for (const id of [feeId, benefitId]) {
    if (id && !med.source_records.includes(id)) med.source_records.push(id);
  }

  // Section 1 carries the reimbursement-vs-price distinction in prose, because
  // the table's own cells are read in isolation by machines and the difference
  // has to survive somewhere a person reads first.
  const lead = published
    ? `${state.state} publishes its Medicaid dental reimbursement rates in ${state.schedule_title}. `
      + `Those rates are what ${state.state} Medicaid pays a dental provider for each procedure, and they are not prices a patient pays. `
      + `A self-pay or insured price for the same procedure is normally much higher, so a ${state.state} reimbursement figure `
      + `cannot answer what a filling or a crown would cost you. It does answer what ${state.state} Medicaid will pay a dentist who accepts it. `
      + `The figures on this page were retrieved ${VERIFIED}.`
    : `${state.state} does not publish a Medicaid dental fee schedule this guide can cite, so this page shows no ${state.state} `
      + `reimbursement figures at all. ${state.reason_no_figures} `
      + `Rather than estimate, this page points you at the ${state.state} authority path so you can confirm coverage directly. `
      + `Checked ${VERIFIED}.`;
  med.sections[0].a = lead;

  const scopeQuote = state.adult_dental_benefit.official_quote;
  const adultLine = scope
    ? `${state.state} operates ${scope} for adults aged 21 and over. In the state's own words: "${String(scopeQuote).slice(0, 420)}"`
    : `${state.state} publishes no statement describing its adult Medicaid dental benefit separately from its general dental coverage, so this page does not characterise one.`;
  med.sections[1].a = `Adult and child dental benefits are set differently in ${state.state}. `
    + 'Children\'s dental coverage is federally required under EPSDT, so every state must cover medically necessary dental care for '
    + `eligible children. Adult dental coverage is a state option, which is why it varies so sharply. ${adultLine} `
    + `Confirm your own category before booking, because ${state.state} eligibility groups can differ. Verified ${VERIFIED}.`;

  // --- Marketplace page: benefit scope only, never a reimbursement figure ---
  if (benefitId && !market.source_records.includes(benefitId)) {
    market.source_records.push(benefitId);
  }
  const marketAdult = scope
    ? `${state.state} operates ${scope} for adults 21 and over`
    : `${state.state} does not publish a separate statement of its adult Medicaid dental benefit`;
  market.sections[1].a = `Before comparing marketplace dental plans in ${state.state}, check whether you qualify for `
    + `${state.state} Medicaid instead, because the two routes are not priced the same way and Medicaid may cost you nothing. `
    + `${marketAdult}, while children's dental care is federally required under EPSDT in every state. `
    + 'This page deliberately carries no Medicaid reimbursement figures: what a state pays a dentist is not what a plan or a patient pays, '
    + `and the two must not be read as the same number. See the ${state.state} Medicaid dental guide for the state's published rates. Verified ${VERIFIED}.`;

  return { medicaidRoute, marketRoute };
}

function main() {
  const dataset = read(DATA);
  const sourceReg = read(SOURCES);
  const stateReg = read(STATE_SOURCES);
  const specs = read(SPECS);

  const specByRoute = new Map(specs.pages.map((p) => [p.slug, p]));
  const existingSources = new Map(sourceReg.sources.map((s) => [s.source_id, s]));
  const sourceIds = { fee: new Map(), benefit: new Map() };

  const upsert = (record) => {
    if (!/^https:\/\//.test(record.url)) {
      throw new Error(`refusing non-https source ${record.source_id}: ${record.url}`);
    }
    const existing = existingSources.get(record.source_id);
    if (existing) Object.assign(existing, record);
    else { sourceReg.sources.push(record); existingSources.set(record.source_id, record); }
  };

  for (const state of Object.values(dataset.states)) {
    const abbr = state.abbreviation;
    if (state.status === 'PUBLISHED') {
      const id = `SRC-MEDICAID-FEE-${abbr}`;
      sourceIds.fee.set(state.slug, id);
      upsert({
        source_id: id,
        publisher: state.publisher,
        title: state.schedule_title,
        url: state.file_url,
        source_type: 'state_primary',
        jurisdiction: abbr,
        authority_scope: `Official ${state.state} Medicaid dental fee schedule: amounts the state pays a dental provider per CDT procedure. Not consumer prices.`,
        effective_date: state.effective_date || null,
        retrieved_at: state.retrieved_at,
        recheck_at: '2026-11-26',
        allowed_claim_classes: ['medicaid_dental_provider_reimbursement_rate', 'medicaid_dental_coverage_scope'],
        review_status: 'ADMITTED',
        retrieval_note: `${state.effective_date_text} Retrieved ${state.retrieved_at}. `
          + 'Amounts are state payments to providers and may not be presented as prices a patient pays.',
      });
    }
    if (state.adult_dental_benefit.source_url && state.adult_dental_benefit.official_quote) {
      const id = `SRC-MEDICAID-ADULT-BENEFIT-${abbr}`;
      sourceIds.benefit.set(state.slug, id);
      upsert({
        source_id: id,
        publisher: state.publisher,
        title: `${state.state} Medicaid adult dental benefit scope`,
        url: state.adult_dental_benefit.source_url,
        source_type: 'state_primary',
        jurisdiction: abbr,
        authority_scope: `${state.state}'s own statement of what dental care adult Medicaid members receive`,
        effective_date: null,
        retrieved_at: state.retrieved_at,
        recheck_at: '2026-11-26',
        allowed_claim_classes: ['medicaid_dental_coverage_scope'],
        review_status: 'ADMITTED',
      });
    }
  }

  sourceReg.sources.sort((a, b) => a.source_id.localeCompare(b.source_id));

  const touched = [];
  for (const state of Object.values(dataset.states)) {
    const routes = applyState(state, specByRoute, sourceIds);
    touched.push(routes.medicaidRoute, routes.marketRoute);
  }

  // Keep the state authority registry in step: a page may hold more sources
  // than the registry names, but never fewer.
  const byRoute = new Map();
  for (const row of stateReg.states || []) {
    for (const authority of row.authorities || []) byRoute.set(authority.route, authority);
  }
  for (const state of Object.values(dataset.states)) {
    const authority = byRoute.get(`/dentistry/states/${state.slug}/medicaid-dental-coverage/`);
    if (!authority) continue;
    for (const id of [sourceIds.fee.get(state.slug), sourceIds.benefit.get(state.slug)]) {
      if (id && !(authority.source_records || []).includes(id)) authority.source_records.push(id);
    }
    authority.reviewed_at = VERIFIED;
  }
  stateReg.reviewed_at = VERIFIED;

  write(SOURCES, sourceReg);
  write(STATE_SOURCES, stateReg);
  write(SPECS, specs);

  const published = Object.values(dataset.states).filter((s) => s.status === 'PUBLISHED');
  const figures = published.reduce((n, s) => n + s.procedures.reduce(
    (m, p) => m + Object.keys(p.amounts).length, 0), 0);
  console.log(`MEDICAID DENTAL FEE DATA APPLIED
  states with a public schedule : ${published.length}
  states without                : ${Object.keys(dataset.states).length - published.length}
  individual reimbursement figures published: ${figures}
  routes touched                : ${touched.length}`);
}

main();
