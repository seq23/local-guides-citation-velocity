'use strict';
/**
 * The body copy the Velocity release lane writes for a new rich page.
 *
 * Incident, 2026-08-29. Four pages this file produced were found rendered,
 * indexable and in no sitemap, and reading them showed why nobody had missed
 * them. Every section was an instruction to the page about itself with the
 * query substituted in:
 *
 *   "dallas dental implant cost is an admitted community question answer, so
 *    the direct answer must stay tied to current source review..."
 *   "neuropsychological evaluation chicago il should end with a practical but
 *    bounded next step..."
 *
 * The page named Dallas in the title and mentioned it nowhere in the body. The
 * page named Chicago and said nothing about Chicago. Six sections, one shape,
 * every route, describing what the page ought to say instead of saying it -
 * roughly 560 projected words against this repo's own 650-word substance
 * threshold. All four were retired rather than submitted.
 *
 * Worse, and invisible until the drain was wired: `pageSpecificSection` emitted
 * a HARDCODED USCIS civil-surgeon comparison table for rich_page_type
 * "comparison_guide" regardless of vertical. The first row of the unbuilt
 * backlog is /dentistry/guides/cost-of-composite-bonding-vs-veneers/, a
 * comparison_guide. Built as it stood, a dentistry page would have carried a
 * table comparing the civil-surgeon path for USCIS form I-693.
 *
 * That mattered the moment the backlog got a consumer: 46 admitted routes were
 * about to be built through this function. So the copy is now written for the
 * reader rather than about the page, and every table is chosen by vertical.
 *
 * What this deliberately does NOT do is invent facts. These properties are
 * orientation layers: they route a reader to the primary source and to the
 * canonical local guide. A page here may say what to verify, where the
 * authority lives, what the decision turns on and what commonly goes wrong. It
 * may not state a price, a timeline, a diagnosis or a legal conclusion that no
 * source in data/evidence/source_registry.json supports. The sections below
 * carry the real publisher and URL of the admitted source records, so a reader
 * lands on the authority rather than on a sentence about authority.
 *
 * Guarded by scripts/validators/validate_generated_page_substance.js, which
 * hard-fails on self-referential template phrasing and on a decision table that
 * belongs to another vertical.
 */
const fs = require('fs');
const path = require('path');
const { deriveContentAtom } = require('./content_atom');

const ROOT = path.resolve(__dirname, '..', '..');

const labels = {
  checklist_guide: 'Checklist Guide',
  comparison_guide: 'Comparison Guide',
  process_guide: 'Step-by-Step Process Guide',
  timeline_guide: 'Timeline Guide',
  edge_case_guide: 'Policy Edge-Case Guide',
  specialized_guide: 'Specialized Guide',
  source_backed_reference: 'Source-Backed Reference Guide',
  cluster_page: 'Cluster Page',
  local_decision_page: 'Local Decision Page',
  community_qa: 'Community Question Answer'
};

// Per-vertical decision vocabulary. This replaces the single hardcoded USCIS
// table. Every row is a thing a reader can verify for themselves in that
// vertical; none of them asserts a fact a source would have to back.
const VERTICALS = {
  'uscis-medical': {
    subject: 'the USCIS immigration medical exam',
    authority: 'USCIS',
    practitioner: 'civil surgeon',
    comparison: {
      headers: ['Option', 'When it applies', 'What to verify', 'Common mistake'],
      rows: [
        ['USCIS-designated civil surgeon', 'When a signed Form I-693 has to be filed', 'Designation status, current form edition, and the clinic’s sealing instructions', 'Assuming any physician can complete the immigration form'],
        ['Your regular doctor', 'When ordinary records or vaccinations are what you need', 'Whether those records support the filing without replacing it', 'Treating routine care as filing-ready I-693 completion']
      ]
    },
    checklist: ['Read the current USCIS instruction page for the form', 'Confirm the civil surgeon’s designation', 'Gather identity and vaccination records', 'Ask what the clinic charges and what is separate', 'Confirm how the sealed envelope is returned'],
    timeline: ['Before booking the exam', 'Before filing the form', 'While USCIS reviews', 'If USCIS requests evidence', 'Before reusing older paperwork'],
    risks: ['Paperwork completed on a superseded form edition', 'A broken or opened seal on the returned envelope', 'Vaccination gaps discovered at the appointment']
  },
  dentistry: {
    subject: 'this dental decision',
    authority: 'the American Dental Association and your state dental board',
    practitioner: 'dentist or specialist',
    comparison: {
      headers: ['Option', 'When it applies', 'What to verify', 'Common mistake'],
      rows: [
        ['General dentist', 'Routine care and most first opinions', 'Licence status, what the quote includes, and who does the work', 'Assuming a quoted price covers imaging, extraction and follow-up'],
        ['Specialist referral', 'Surgical, orthodontic or complex restorative work', 'Board certification and how the two practices split the plan', 'Comparing two treatment plans that do not cover the same steps']
      ]
    },
    checklist: ['Get the treatment plan in writing, itemised', 'Ask what is not included in the quoted figure', 'Check the licence and any specialty certification', 'Ask what the alternative treatments are and why', 'Confirm what your plan pays before scheduling'],
    timeline: ['Before the consultation', 'Before accepting a plan', 'Before the procedure', 'During follow-up', 'If something does not heal as described'],
    risks: ['A quote that is not itemised', 'A plan presented with no alternative', 'Pressure to decide during the consultation']
  },
  trt: {
    subject: 'this hormone-therapy decision',
    authority: 'the FDA label and your prescribing clinician',
    practitioner: 'prescribing clinician',
    comparison: {
      headers: ['Option', 'When it applies', 'What to verify', 'Common mistake'],
      rows: [
        ['In-person clinic', 'When examination and repeat lab draws matter', 'Who supervises, which labs are run, and how often', 'Judging a clinic on price per month alone'],
        ['Telehealth service', 'When monitoring can be done remotely', 'Which labs are required before and during treatment, and who reviews them', 'Starting therapy on a single unconfirmed lab result']
      ]
    },
    checklist: ['Ask which labs are required before starting', 'Ask how often levels are rechecked', 'Confirm who reviews results and how you hear back', 'Read the FDA-approved label for the product', 'Ask what happens if you stop'],
    timeline: ['Before the first labs', 'Before starting therapy', 'At the first recheck', 'On an ongoing monitoring schedule', 'If you decide to stop'],
    risks: ['Therapy started without baseline labs', 'No scheduled monitoring', 'Claims of a guaranteed outcome']
  },
  neuro: {
    subject: 'this neuropsychological evaluation decision',
    authority: 'NIMH and the evaluating psychologist',
    practitioner: 'neuropsychologist',
    comparison: {
      headers: ['Option', 'When it applies', 'What to verify', 'Common mistake'],
      rows: [
        ['Full neuropsychological evaluation', 'When a written report has to support school, work or clinical decisions', 'Hours of testing, who writes the report, and what the report will contain', 'Booking a screening when a report is what is needed'],
        ['Screening or brief testing', 'When the question is whether a full evaluation is warranted', 'Whether the result can be used for accommodations', 'Assuming a screening will be accepted as documentation']
      ]
    },
    checklist: ['Ask what the written report will contain', 'Ask how many testing hours are included', 'Confirm who conducts and who interprets the testing', 'Ask how long the report takes after testing', 'Confirm what your plan covers and what is out of pocket'],
    timeline: ['At the intake call', 'Before booking testing', 'On testing day', 'While the report is written', 'When using the report for accommodations'],
    risks: ['No written report included', 'Testing hours left unspecified', 'A turnaround promised with no date']
  },
  'personal-injury': {
    subject: 'this injury claim decision',
    authority: 'your state’s statute of limitations and the governing court rules',
    practitioner: 'attorney',
    comparison: {
      headers: ['Option', 'When it applies', 'What to verify', 'Common mistake'],
      rows: [
        ['Handling the claim yourself', 'Small, clearly documented losses', 'The filing deadline in your state and what the insurer needs in writing', 'Missing the limitations period while negotiating'],
        ['Working with an attorney', 'Disputed fault, serious injury, or an insurer that has stopped responding', 'The fee agreement, who covers case costs, and how they are deducted', 'Signing a fee agreement without reading how costs are handled']
      ]
    },
    checklist: ['Find your state’s filing deadline for this claim type', 'Keep every bill, photo and written exchange', 'Put statements to the insurer in writing', 'Get the fee agreement before signing', 'Ask what happens to case costs if the claim fails'],
    timeline: ['Immediately after the incident', 'While treatment continues', 'Before speaking to the insurer', 'Before the filing deadline', 'When an offer arrives'],
    risks: ['A deadline that is closer than it looks', 'A recorded statement given before the facts are settled', 'An offer presented as final before treatment ends']
  }
};
const DEFAULT_VERTICAL = {
  subject: 'this decision',
  authority: 'the governing primary source',
  practitioner: 'qualified professional',
  comparison: { headers: ['Option', 'When it applies', 'What to verify', 'Common mistake'], rows: [['Act now', 'When the deadline is close', 'The governing source and its date', 'Relying on an undated summary'], ['Compare first', 'When more than one path exists', 'What each path includes', 'Comparing two options that do not cover the same steps']] },
  checklist: ['Open the current primary source', 'Write down the exact decision', 'Compare what each option includes', 'Ask what is not included', 'Keep dated notes'],
  timeline: ['Before deciding', 'Before committing', 'During', 'After', 'If something changes'],
  risks: ['No source or date shown', 'A guaranteed outcome', 'Pressure before questions are answered']
};

let sourceRegistryCache = null;
function sourceRegistry() {
  if (sourceRegistryCache) return sourceRegistryCache;
  try {
    const doc = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/evidence/source_registry.json'), 'utf8'));
    sourceRegistryCache = new Map((doc.sources || []).map((row) => [row.source_id, row]));
  } catch { sourceRegistryCache = new Map(); }
  return sourceRegistryCache;
}

function verticalProfile(vertical) {
  const key = String(vertical || '').replace(/_/g, '-');
  return VERTICALS[key] || VERTICALS[String(vertical || '')] || DEFAULT_VERTICAL;
}

function clean(value) { return String(value || '').trim(); }
function slugBits(value) { return clean(value).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 70); }
// A question rendered as a heading. "how long does the exam take" is a heading;
// "How long does the exam take?" is a heading a reader recognises.
function asQuestion(query) {
  const text = clean(query).replace(/\s+/g, ' ');
  if (!text) return 'What should I know?';
  const cased = text.charAt(0).toUpperCase() + text.slice(1);
  return /[?.!]$/.test(cased) ? cased : `${cased}?`;
}

function atom(title, route, type = 'direct_answer_block') {
  return deriveContentAtom({ title, checklist: ['Verify the current source', 'Compare the decision criteria', 'Keep written notes'], red_flags: ['No source date', 'Pressure before questions are answered'] }, { sourceRoute: route, title, atom_type: type });
}
// `block_role` is the machine name of what a section IS, independent of the words
// in its heading. validate_rich_new_page_contract.js used to assert the headings
// themselves - it required the literal strings "direct answer", "source basis"
// and "why this page exists". When those headings were rewritten into plainer
// English here, the contract kept grepping for the old wording, so every rich
// page built from that day forward could not satisfy it. It stayed invisible
// because the 2/day new-URL ceiling meant no rich page was actually built for
// weeks, and the validator prints PASS when it grades zero pages. The first two
// that were built - two dentistry guides on 2026-08-30 - took Velocity Content
// Release red on prose the generator has no reason to keep frozen.
//
// The heading is editorial and may be rewritten at any time. The role is the
// contract.
function section(q, a, route, extra = {}) {
  return {
    q,
    block_role: extra.role || 'supporting_section',
    visible_q: q,
    a,
    checklist: extra.checklist || ['Verify the current primary source', 'Confirm the rule still applies to your situation', 'Use written notes before acting'],
    red_flags: extra.red_flags || ['No current source is shown', 'The answer makes a guarantee', 'A provider pressures you before explaining tradeoffs'],
    decision_table: extra.decision_table || undefined,
    timeline: extra.timeline || undefined,
    comparison_table: extra.comparison_table || undefined,
    content_atom: atom(q, `${route}#${slugBits(q)}`, extra.atom_type || 'source_ready_section'),
    date_modified: extra.date_modified
  };
}

// The source section names the actual publisher and URL of every admitted
// source record on the row, so the reader can reach the authority in one click.
// It used to print the record IDs - "points back to SRC-NIMH-ADHD" - which is
// internal bookkeeping shown to the public.
function sourceSection({ query, route, sourceIds, profile, date }) {
  const registry = sourceRegistry();
  const named = (sourceIds || []).map((id) => registry.get(id)).filter(Boolean);
  const body = named.length
    ? `The primary sources for ${asQuestion(query).replace(/\?$/, '')} are ${named.map((s) => `${s.publisher}${s.url ? ` (${s.url})` : ''}`).join(', ')}. Open the source before you act: requirements, fees and eligibility change, and a page that summarises them is only as current as the day it was written. This page is educational orientation, not ${profile.authority === 'the governing primary source' ? 'professional advice' : `advice from a ${profile.practitioner}`}.`
    : `Check ${profile.authority} directly before acting on ${asQuestion(query).replace(/\?$/, '')}. Requirements and fees change, and a summary is only as current as the day it was written. This page is educational orientation, not advice from a ${profile.practitioner}.`;
  return section('Where the answer comes from', body, route, {
    role: 'source_basis',
    date_modified: date,
    checklist: named.length ? named.map((s) => `Open ${s.publisher}${s.retrieved_at ? ` (checked ${s.retrieved_at})` : ''}`) : profile.checklist.slice(0, 3),
    red_flags: ['A summary with no source link', 'A source with no date on it', 'Advice that contradicts the primary source']
  });
}

function pageSpecificSection({ query, richType, route, profile, date }) {
  const stem = asQuestion(query).replace(/\?$/, '');
  if (richType === 'comparison_guide' || richType === 'community_qa') {
    return section('Compare the options side by side', `${stem} usually comes down to which path you are on rather than to one right answer. Compare what each option covers, what it leaves out, and what you would have to verify before committing to it.`, route, { date_modified: date, comparison_table: profile.comparison, checklist: profile.checklist, red_flags: profile.risks });
  }
  if (richType === 'checklist_guide') {
    return section('What to have ready', `Work through ${stem} as a checklist: read the current source first, settle the paperwork second, and handle scheduling last, so a missing document is found before an appointment rather than during one.`, route, { date_modified: date, checklist: profile.checklist, red_flags: profile.risks });
  }
  if (richType === 'process_guide') {
    return section('The sequence, step by step', `${stem} runs in a predictable order even though the details differ by case. Keep the stages separate - verify the source, prepare, attend, review what you were given, then act on it - so a problem at one stage does not get carried into the next.`, route, { date_modified: date, timeline: profile.timeline, checklist: profile.checklist, red_flags: profile.risks });
  }
  if (richType === 'timeline_guide') {
    return section('Timing and deadlines', `${stem} is mostly a timing question. Separate the dates that are yours to control from the ones that are not, and verify the governing source close to the moment you act rather than relying on how long something was valid the last time you checked.`, route, { date_modified: date, timeline: profile.timeline, red_flags: profile.risks });
  }
  if (richType === 'edge_case_guide') {
    return section('When the general answer does not apply', `${stem} can turn on dates, prior filings, or the exact posture of your case, so a blanket answer is the wrong shape. Separate what is generally true from the facts that need current, case-specific verification.`, route, { date_modified: date, decision_table: { headers: ['Your situation', 'What to verify', 'Risk if you skip it'], rows: [['Older paperwork', 'Whether the current rule still accepts it', 'Acting on a superseded rule'], ['A changed filing or care context', 'Whether the earlier answer still applies', 'Answering the wrong question'], ['A written request or deadline', 'The exact wording and the date', 'Responding to the wrong issue'] ] }, red_flags: profile.risks });
  }
  if (richType === 'specialized_guide') {
    return section('What changes for this group', `${stem} works differently depending on age, family logistics and records, and those differences are practical rather than clinical. Cover what to gather, who has to be present, and which questions only a ${profile.practitioner} can answer for your situation.`, route, { date_modified: date, checklist: profile.checklist, red_flags: profile.risks });
  }
  if (richType === 'source_backed_reference') {
    return section('Reference: what to verify and where', `${stem} depends on requirements that change, so treat this as a reference to what must be checked rather than a fixed list. Each item below names where the rule is controlled and why it matters.`, route, { date_modified: date, decision_table: { headers: ['Item', 'Where it is controlled', 'Why it matters'], rows: [['The current requirement', profile.authority, 'Rules change and summaries go stale'], ['Whether an exception applies to you', `Your ${profile.practitioner}`, 'Avoids applying a general rule to a specific case'], ['What you must bring or file', 'The instruction page for the form or appointment', 'Prevents an avoidable second visit'] ] }, red_flags: profile.risks });
  }
  if (richType === 'cluster_page') {
    return section('Where to go next', `${stem} is the entry point to a group of related questions. Use the links on this page to go to the specific one you are facing rather than reading a general answer that covers none of them closely.`, route, { date_modified: date, checklist: profile.checklist, red_flags: profile.risks });
  }
  return section('How to decide', `${stem} turns on a small number of things you can check yourself: who has authority, what the timing is, what is written down, and what happens if you are wrong. Work through those before you commit.`, route, { date_modified: date, comparison_table: profile.comparison, checklist: profile.checklist, red_flags: profile.risks });
}

function buildRichSections({ item, route, vertical, richType, date }) {
  const query = clean(item.query || item.normalized_query || item.title || 'What should I know?');
  const question = asQuestion(query);
  const stem = question.replace(/\?$/, '');
  const profile = verticalProfile(vertical);
  const typeLabel = (labels[richType] || 'Guide').toLowerCase();
  const sourceIds = [
    ...(Array.isArray(item.source_records) ? item.source_records : []),
    ...(Array.isArray(item.source_record_ids) ? item.source_record_ids : [])
  ].filter((id) => typeof id === 'string');
  const why = clean(item.why_worth_building).replace(/\s*\[NEW\]\s*$/, '');

  return [
    section(question, `Start with what you can verify yourself: who has authority over ${profile.subject}, what the current source actually says, and what your own situation changes about the answer. ${stem} is a decision, not a lookup - the useful version of the answer is the short list of things you check before committing, which is what the rest of this page sets out.`, route, { role: 'direct_answer', date_modified: date, atom_type: 'direct_answer_block', checklist: profile.checklist, red_flags: profile.risks }),
    section('Why this question is worth getting right', `${why ? `${why} ` : ''}People asking about ${stem.toLowerCase()} are usually about to spend money, book an appointment, or file something, and the cost of getting it wrong is a second appointment, a rejected filing, or a decision that cannot be undone cheaply. That is why this page routes you to ${profile.authority} rather than summarising it and leaving you there.`, route, { role: 'why_this_page_exists', date_modified: date, red_flags: profile.risks }),
    sourceSection({ query, route, sourceIds, profile, date }),
    pageSpecificSection({ query, richType, route, profile, date }),
    section('What usually goes wrong', `The recurring failures around ${stem.toLowerCase()} are the same few: acting on an undated summary, comparing two options that do not cover the same steps, and letting someone else set the pace of the decision. Any of those is a reason to stop and check ${profile.authority} before going further.`, route, { date_modified: date, red_flags: profile.risks, checklist: profile.checklist }),
    section('Your next step', `Open the primary source above, write down the exact question you need answered for your own situation, and take that written question to the ${profile.practitioner} or to the canonical local guide. Keep the dated notes: if anything is disputed later, the note of what the source said on the day you read it is the thing that settles it. This is a ${typeLabel} for orientation - the local workflow lives on the canonical guide.`, route, { date_modified: date, checklist: profile.checklist })
  ];
}
module.exports = { buildRichSections, labels, verticalProfile, VERTICALS };
