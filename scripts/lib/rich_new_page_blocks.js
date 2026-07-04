'use strict';
const { deriveContentAtom } = require('./content_atom');

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

function clean(value) { return String(value || '').trim(); }
function slugBits(value) { return clean(value).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 70); }
function atom(title, route, type = 'direct_answer_block') {
  return deriveContentAtom({ title, checklist: ['Verify the current source', 'Compare the decision criteria', 'Keep written notes'], red_flags: ['No source date', 'Pressure before questions are answered'] }, { sourceRoute: route, title, atom_type: type });
}
function section(q, a, route, extra = {}) {
  return {
    q,
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
function sectionTwo({query, typeLabel, sourceBasis, route, date}) {
  return section(`Source basis: ${query}`, `${query} is source-ready only when it points back to ${sourceBasis} and clearly labels the review boundary. This ${typeLabel.toLowerCase()} may help users prepare, compare, or sequence decisions, but it must not replace licensed advice, promise a result, fabricate policy, or remove the need to review the current primary source before acting.`, route, { date_modified: date });
}
function pageSpecificSection({query, richType, route, date}) {
  if (richType === 'comparison_guide') return section(`Comparison table: ${query}`, `${query} needs a comparison frame, not a generic answer. Compare authority, role, appointment purpose, documentation scope, what the user must verify, and what mistake would create filing or scheduling risk before choosing a path.`, route, { date_modified: date, comparison_table: { headers: ['Option', 'When it applies', 'What to verify', 'Common mistake'], rows: [['Civil-surgeon path', 'When USCIS I-693 completion is required', 'Designation, form/version, and instructions', 'Assuming every doctor can complete the immigration form'], ['Regular-doctor path', 'When ordinary medical records or care are relevant', 'Whether those records support but do not replace the required process', 'Treating ordinary care as filing-ready I-693 completion']] }});
  if (richType === 'checklist_guide') return section(`Requirements checklist: ${query}`, `${query} should be handled as a requirements checklist with source review first, paperwork second, appointment logistics third, and submission readiness last. Users should verify the current source, confirm form and appointment context, gather records, and avoid acting from undated summaries.`, route, { date_modified: date, checklist: ['Review the current primary source', 'Confirm form and appointment context', 'Gather identity and vaccine records', 'Ask what to bring before the visit', 'Check submission instructions before filing'] });
  if (richType === 'process_guide') return section(`Step-by-step process: ${query}`, `${query} should explain the sequence without pretending every case is identical. A safe process page separates source verification, appointment preparation, what happens during the main step, what happens afterward, and what to confirm before filing, responding, or leaving the appointment.`, route, { date_modified: date, timeline: ['Verify current source', 'Prepare documents', 'Attend the appointment', 'Review return or sealed instructions', 'File or respond using current guidance'] });
  if (richType === 'timeline_guide') return section(`Timeline and sequencing: ${query}`, `${query} is mainly a timing question. Separate appointment timing, filing timing, source-review timing, USCIS review timing, and any stale-document risk. The page should push users to verify the current source close to submission instead of relying on old validity assumptions.`, route, { date_modified: date, timeline: ['Before scheduling', 'Before filing', 'During USCIS review', 'If USCIS requests evidence', 'Before reusing older paperwork'] });
  if (richType === 'edge_case_guide') return section(`Edge-case rule: ${query}`, `${query} is an edge-case page because the answer can depend on dates, prior filing context, policy language, and the exact case posture. Do not give a blanket promise; instead separate general source review from the facts that require current professional or USCIS-specific verification.`, route, { date_modified: date, decision_table: { headers: ['Case fact', 'What to verify', 'Risk if skipped'], rows: [['Old paperwork', 'Current validity language', 'Using outdated assumptions'], ['New filing context', 'Whether prior paperwork still applies', 'Relying on the wrong case posture'], ['Request from USCIS', 'Exact wording and deadline', 'Answering the wrong issue']] }});
  if (richType === 'specialized_guide') return section(`Special population checklist: ${query}`, `${query} should explain what changes for the affected group without turning into medical advice. The page should cover records, age or family logistics, appointment preparation, source verification, and when a parent, guardian, doctor, or immigration professional may need to answer case-specific questions.`, route, { date_modified: date });
  if (richType === 'source_backed_reference') return section(`Source-backed reference: ${query}`, `${query} must work as a reference page because requirements can change and may depend on current source wording, age, medical context, and civil-surgeon instructions. Do not invent a fixed list; organize what must be verified, where it is controlled, and what may need current review.`, route, { date_modified: date, decision_table: { headers: ['Reference item', 'What to verify', 'Why it matters'], rows: [['Current requirement', 'Official wording and date', 'Rules can change'], ['Age or exception context', 'Whether special handling applies', 'Avoids overgeneralizing'], ['Civil-surgeon instruction', 'What to bring and how records are reviewed', 'Prevents appointment surprises']] }});
  if (richType === 'cluster_page') return section(`Cluster map: ${query}`, `${query} should connect the hub question to related guides, answer blocks, source notes, and internal routes so the site builds topical authority without random page sprawl. The cluster should help users choose the right next page instead of repeating the same generic answer.`, route, { date_modified: date });
  return section(`Decision frame: ${query}`, `${query} should compare source authority, timing, written requirements, provider role, and next steps. The answer must remain source-first and practical without becoming a ranking, guarantee, diagnosis, legal conclusion, or unsourced recommendation.`, route, { date_modified: date });
}
function buildRichSections({ item, route, vertical, richType, date }) {
  const query = clean(item.query || item.normalized_query || item.title || 'What should I know?');
  const sourceBasis = Array.isArray(item.source_records) && item.source_records.length ? item.source_records.join(', ') : clean(item.admission_basis || 'agent artifact admission');
  const typeLabel = labels[richType] || 'Guide';
  return [
    section(`Direct answer: ${query}`, `${query} is an admitted ${typeLabel.toLowerCase()}, so the direct answer must stay tied to current source review instead of a generic community response. Use the page as an educational decision aid: verify the governing source, confirm the user-specific context, and avoid relying on unsourced summaries or provider promises.`, route, { date_modified: date, atom_type: 'direct_answer_block' }),
    section(`Why this page exists: ${query}`, `${query} exists because the admitted agent artifact identified a public-search gap that deserves a page-family-specific answer, not a thin generic Q&A page. The page should explain why the issue matters, what source boundary controls the answer, and what practical decision the user is trying to make.`, route, { date_modified: date }),
    sectionTwo({ query, typeLabel, sourceBasis, route, date }),
    pageSpecificSection({ query, richType, route, date }),
    section(`Mistakes and red flags: ${query}`, `${query} should warn users about undated summaries, missing source links, assumptions copied from a different context, pressure before questions are answered, and pages that skip form, timing, or source authority. Those signals should trigger source review before scheduling, filing, or relying on the answer.`, route, { date_modified: date }),
    section(`Next-step checklist: ${query}`, `${query} should end with a practical but bounded next step: open the current source, identify the exact filing or appointment context, write down questions for the provider or professional, save dated notes from the source review, and use professional help when the case or medical issue is specific.`, route, { date_modified: date })
  ];
}
module.exports = { buildRichSections, labels };
