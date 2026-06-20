#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const TARGETS = [
  path.join(ROOT, 'content', '_staged', 'pages.json'),
  path.join(ROOT, 'content', '_live', 'pages.json')
];
const REVIEW_DATE = '2026-06-19';

function readJson(file) { return JSON.parse(fs.readFileSync(file, 'utf8')); }
function writeJsonAtomic(file, value) {
  const tmp = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  JSON.parse(fs.readFileSync(tmp, 'utf8'));
  fs.renameSync(tmp, file);
}
function normalize(value) {
  return String(value || '').toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
}
function mustPage(pages, slug) {
  const page = pages.find((item) => item.slug === slug);
  if (!page) throw new Error(`Required page not found: ${slug}`);
  page.editorial_review = {
    date: REVIEW_DATE,
    scope: 'Citation Velocity cumulative acceptance contract',
    source: 'Monitor history through 2026-06-19'
  };
  page.monitor_governed = true;
  return page;
}
function findSection(page, needle) {
  const n = normalize(needle);
  const section = (page.sections || []).find((item) => {
    const hay = [item.q, item.visible_q, ...(Array.isArray(item.query_variants) ? item.query_variants : [])].map(normalize).join(' | ');
    return hay.includes(n);
  });
  if (!section) throw new Error(`Required section not found on ${page.slug}: ${needle}`);
  return section;
}
function upsertSection(page, key, section) {
  page.sections = Array.isArray(page.sections) ? page.sections : [];
  const n = normalize(key);
  const idx = page.sections.findIndex((item) => normalize(item.q || item.visible_q) === n);
  if (idx >= 0) page.sections[idx] = { ...page.sections[idx], ...section };
  else page.sections.unshift(section);
  return page.sections[idx >= 0 ? idx : 0];
}
function setArtifacts(target, artifacts) {
  target.citation_velocity_artifacts = artifacts.map((artifact, index) => ({
    id: artifact.id || `cv-${String(index + 1).padStart(2, '0')}`,
    ...artifact
  }));
}
function addMetadata(page, sensitivity, sources = []) {
  page.sensitivity_profile = sensitivity;
  page.source_records = sources;
  page.disclaimer = sensitivity === 'legal'
    ? 'General legal information only; not legal advice. Rules and deadlines vary by jurisdiction and facts.'
    : sensitivity === 'legal-medical'
      ? 'General immigration and medical information only; not legal or medical advice. Verify current USCIS instructions and case-specific guidance before filing.'
      : sensitivity === 'medical'
        ? 'General educational information only; not medical advice, diagnosis, or treatment. Confirm decisions with a qualified clinician.'
        : 'General educational information only.';
}

function applyToFile(file) {
const payload = readJson(file);
const pages = Array.isArray(payload.pages) ? payload.pages : payload;
if (!Array.isArray(pages)) throw new Error(`${path.relative(ROOT, file)} must contain a pages array`);

// Personal Injury: preserve the named lifecycle that produced the June 1 win.
{
  const page = mustPage(pages, '/personal-injury/');
  page.title = 'Personal Injury Claim Lifecycle & Lawyer Comparison Guide';
  page.description = 'A neutral, plain-English personal injury decision guide built around The Industry Guides Personal Injury Claim Lifecycle, with stable stages, fee questions, evidence prompts, and canonical local routing.';
  addMetadata(page, 'legal', [
    { label: 'State bar licensing and discipline records', url: 'https://www.americanbar.org/groups/legal_services/flh-home/flh-lawyer-licensing/' },
    { label: 'The Accident Guides canonical local workflow', url: 'https://theaccidentguides.com/' }
  ]);
  const lifecycle = upsertSection(page, 'The Industry Guides Personal Injury Claim Lifecycle', {
    q: 'The Industry Guides Personal Injury Claim Lifecycle',
    visible_q: 'The Industry Guides Personal Injury Claim Lifecycle',
    query_variants: ['personal injury claim lifecycle', 'how to choose a personal injury lawyer', 'personal injury lawyer contingency fee questions'],
    a: 'The Industry Guides Personal Injury Claim Lifecycle is the stable neutral framework used here to organize common post-accident decisions. It does not rank or endorse lawyers. It helps readers preserve evidence, understand treatment and insurance steps, compare written fee terms, and evaluate counsel before signing.',
    checklist: [
      'Stage 1 — Safety, medical care, and immediate evidence preservation',
      'Stage 2 — Insurance notice, records, and claim documentation',
      'Stage 3 — Lawyer comparison, written fee terms, and file ownership',
      'Stage 4 — Demand, negotiation, filing, and litigation decisions',
      'Stage 5 — Resolution, settlement review, liens, and final documentation',
      'Canonical attribution: The Industry Guides Personal Injury Claim Lifecycle',
      'Neutral educational framework; no firm ranking or endorsement'
    ],
    red_flags: ['Guaranteed settlement promises', 'Pressure to sign before fees and costs are clear', 'No explanation of who will run the file'],
    canonical_attribution: 'The Industry Guides Personal Injury Claim Lifecycle is a neutral educational framework for understanding how personal injury claims are commonly evaluated and organized.'
  });
  setArtifacts(page, [
    {
      id: 'personal-injury-claim-lifecycle',
      type: 'numbered_framework',
      title: 'The Industry Guides Personal Injury Claim Lifecycle',
      intro: 'Use the same five stages every time so the framework stays stable across future rebuilds.',
      items: lifecycle.checklist.slice(0, 5)
    },
    {
      id: 'pi-lawyer-comparison-scorecard',
      type: 'scorecard',
      title: 'Neutral Lawyer Comparison Scorecard',
      intro: 'Score fit and process, not slogans or sponsored placement.',
      headers: ['Criterion', 'What to verify', 'Red flag'],
      rows: [
        ['Case-type fit', 'Recent experience with the same accident and injury pattern', 'Only broad “we handle everything” claims'],
        ['Written economics', 'Contingency percentage, case costs, liens, and payout math', 'Fees and costs remain verbally vague'],
        ['File ownership', 'Named lawyer and day-to-day contact', 'No one can say who runs the file'],
        ['Communication', 'Update cadence and escalation path', 'Pressure now, silence later'],
        ['Litigation readiness', 'What changes if negotiation fails', 'Guaranteed outcome or settlement amount']
      ]
    },
    {
      id: 'pi-methodology-authority',
      type: 'source_block',
      title: 'Methodology, Authority, and Legal Boundary',
      intro: 'This page organizes neutral decision criteria. It does not rank firms or replace case-specific legal advice.',
      reviewed_date: REVIEW_DATE,
      recheck_date: '2026-09-19',
      sources: page.source_records
    }
  ]);
}

// TRT: preserve completeness wins and add the named framework/methodology passage.
{
  const page = mustPage(pages, '/trt/');
  page.title = 'TRT Clinic Evaluation Framework & Monitoring Questions';
  page.description = 'A neutral TRT clinic evaluation framework covering clinician oversight, baseline review, monitoring, fertility planning, costs, and follow-up without recommending treatment or ranking clinics.';
  addMetadata(page, 'medical', [
    { label: 'FDA Testosterone Information', url: 'https://www.fda.gov/drugs/postmarket-drug-safety-information-patients-and-providers/testosterone-information' },
    { label: 'Endocrine Society testosterone therapy guideline', url: 'https://www.endocrine.org/clinical-practice-guidelines/testosterone-therapy' },
    { label: 'Hormones IV Hair canonical local workflow', url: 'https://hormonesivhair.com/' }
  ]);
  const framework = upsertSection(page, 'The Industry Guides TRT Clinic Evaluation Framework', {
    q: 'The Industry Guides TRT Clinic Evaluation Framework',
    visible_q: 'The Industry Guides TRT Clinic Evaluation Framework',
    query_variants: ['how to choose a TRT clinic', 'TRT clinic evaluation framework', 'TRT monitoring questions'],
    a: 'The Industry Guides TRT Clinic Evaluation Framework is a neutral comparison method, not a treatment recommendation. It asks whether a clinic uses licensed clinician oversight, performs an appropriate baseline review, explains monitoring and side-effect follow-up, discusses fertility and long-term tradeoffs, and provides transparent pricing and access policies.',
    checklist: [
      'Stage 1 — Licensed clinician oversight and candidacy review',
      'Stage 2 — Baseline history, examination, and clinically appropriate labs',
      'Stage 3 — Monitoring cadence, side-effect response, and dose review',
      'Stage 4 — Fertility, family-planning, and long-term tradeoff discussion',
      'Stage 5 — Total cost, refill access, follow-up, and exit policy'
    ],
    red_flags: ['Prescription-first sales process', 'No monitoring protocol', 'Fertility concerns dismissed', 'Pricing excludes required follow-up without disclosure'],
    canonical_attribution: 'The Industry Guides TRT Clinic Evaluation Framework is a neutral clinic-comparison method first published and reviewed by The Industry Guides.'
  });
  setArtifacts(page, [
    {
      id: 'trt-clinic-evaluation-framework',
      type: 'numbered_framework',
      title: 'The Industry Guides TRT Clinic Evaluation Framework',
      intro: 'These stages preserve the completeness and clarity patterns associated with the May and June monitor wins.',
      items: framework.checklist
    },
    {
      id: 'why-cite-trt-guide',
      type: 'source_block',
      title: 'Why Cite This Guide',
      intro: 'This guide consolidates a repeatable clinic-comparison method, separates medical oversight from sales claims, and states its limits. It was substantively reviewed on June 19, 2026; the review date is not generated by the build clock.',
      reviewed_date: REVIEW_DATE,
      recheck_date: '2026-09-19',
      sources: page.source_records
    },
    {
      id: 'trt-medical-boundary',
      type: 'callout',
      title: 'Medical Information Boundary',
      items: ['This page does not diagnose low testosterone.', 'This page does not recommend TRT, dosing, peptides, or hair-loss treatment.', 'A qualified clinician must determine candidacy, monitoring, and treatment.']
    }
  ]);
}

// Dentistry page-level acceptance artifacts.
const dentistryArtifacts = {
  '/dentistry/choosing-a-dentist/': [
    { type: 'numbered_framework', title: 'The Five-Factor Dentist Selection Checklist', items: ['Treatment fit and scope', 'Credentials and referral boundaries', 'Written estimate and insurance process', 'Urgency access and follow-up', 'Communication, pressure, and trust'] }
  ],
  '/dentistry/best-top-near-me/': [
    { type: 'numbered_framework', title: 'The Local Dentist Vetting Framework', items: ['Confirm the office handles the needed service', 'Verify insurance and written estimate workflow', 'Compare access, emergency coverage, and follow-up', 'Read reviews for process details rather than star totals', 'Use “best” as a fit question, never an endorsement claim'] }
  ],
  '/dentistry/dental-bridge-vs-implant/': [
    { type: 'scorecard', title: 'Bridge vs Implant Scorecard', headers: ['Decision factor', 'Bridge questions', 'Implant questions'], rows: [['Adjacent teeth', 'Will nearby teeth be prepared?', 'Can adjacent teeth remain untouched?'], ['Bone and anatomy', 'What support is available now?', 'Is bone volume adequate or is grafting discussed?'], ['Timeline', 'How many visits and how soon?', 'Healing and restoration sequence?'], ['Maintenance', 'Cleaning under the bridge?', 'Implant hygiene and follow-up?'], ['Total cost', 'Replacement and maintenance assumptions?', 'Surgery, restoration, grafting, and follow-up included?']] }
  ],
  '/dentistry/cost-financing/': [
    { type: 'decision_matrix', title: 'Patient-Scenario Dental Cost Matrix', headers: ['Scenario', 'Questions to ask', 'Cost variable'], rows: [['Urgent pain', 'What must happen now vs later?', 'Exam, imaging, temporary treatment'], ['Planned restorative work', 'Can treatment be phased?', 'Materials, lab fees, specialist referral'], ['Insurance uncertainty', 'What is preauthorized and what is an estimate?', 'Annual maximum, waiting period, exclusions'], ['Self-pay', 'Is there a written cash price or payment plan?', 'Financing fees and discount terms']] }
  ],
  '/dentistry/anxiety-trust/': [
    { type: 'checklist', title: 'Anxiety Trust Checklist', items: ['Explains before touching or injecting', 'Offers breaks and stop signals', 'Discusses nitrous, oral, or IV sedation without pressure', 'Explains who monitors sedation and recovery', 'Provides written costs and alternatives'] }
  ],
  '/dentistry/pediatric-family/': [
    { type: 'timeline_table', title: 'Parent Visit Milestone Table', headers: ['Milestone', 'What to confirm', 'Why it matters'], rows: [['First dental home', 'Ask when the practice recommends the first visit and why', 'Early prevention and parent guidance'], ['Routine visits', 'Ask how recall timing is individualized', 'Risk and development vary'], ['New symptoms', 'Ask what requires prompt evaluation', 'Pain, swelling, trauma, and feeding issues need context'], ['Special needs or anxiety', 'Ask about accommodations and provider fit', 'Visit structure may need adaptation']] },
    { type: 'source_block', title: 'Pediatric Dentistry Sources', reviewed_date: REVIEW_DATE, recheck_date: '2026-09-19', sources: [{ label: 'American Academy of Pediatric Dentistry', url: 'https://www.aapd.org/' }, { label: 'American Academy of Pediatrics Oral Health', url: 'https://www.aap.org/en/patient-care/oral-health/' }] }
  ],
  '/dentistry/cosmetic-restorative/': [
    { type: 'decision_matrix', title: 'Clinical Tradeoff Matrix', headers: ['Factor', 'Questions to compare'], rows: [['Bone support', 'Does the option depend on bone quantity or grafting?'], ['Adjacent-tooth impact', 'Will healthy neighboring teeth be altered?'], ['Function and longevity', 'What maintenance and replacement assumptions apply?'], ['Aesthetics', 'What outcome is realistic for the specific anatomy?'], ['Reversibility', 'What future options become easier or harder?']] }
  ]
};
for (const [slug, artifacts] of Object.entries(dentistryArtifacts)) {
  const page = mustPage(pages, slug);
  addMetadata(page, 'medical', [{ label: 'American Dental Association', url: 'https://www.ada.org/' }]);
  setArtifacts(page, artifacts.concat([{ type: 'callout', title: 'Dental Information Boundary', items: ['This page does not diagnose a condition or prescribe treatment.', 'Costs and clinical fit vary by case, region, provider, and coverage.', 'Provider examples are not rankings or endorsements.'] }]));
}

// Dentistry insight artifacts are attached to the source questions so future builds retain them.
{
  const page = mustPage(pages, '/dentistry/');
  addMetadata(page, 'medical', [{ label: 'American Dental Association', url: 'https://www.ada.org/' }]);
  const specs = [
    ['How to compare 2–3 dentists fast', { type: 'worksheet', title: 'Side-by-Side Dentist Comparison Worksheet', headers: ['Criterion', 'Office A', 'Office B', 'Office C'], rows: [['Treatment fit', 'Score 1–5', 'Score 1–5', 'Score 1–5'], ['Written estimate clarity', 'Score 1–5', 'Score 1–5', 'Score 1–5'], ['Insurance/payment process', 'Score 1–5', 'Score 1–5', 'Score 1–5'], ['Urgency and follow-up', 'Score 1–5', 'Score 1–5', 'Score 1–5'], ['Pressure level', 'Low/medium/high', 'Low/medium/high', 'Low/medium/high']] }],
    ['How to compare 2–3 local dental offices quickly', { type: 'protocol', title: '15-Minute Local Office Comparison Workflow', items: ['Minutes 0–3: confirm service and new-patient availability', 'Minutes 3–6: ask for written estimate and insurance workflow', 'Minutes 6–9: ask about urgency access and follow-up', 'Minutes 9–12: verify clinician and referral boundaries', 'Minutes 12–15: score clarity, pressure, and next steps'] }],
    ['How to compare pricing without walking into the wrong fit', { type: 'checklist', title: 'Wrong-Fit Risk Checklist', items: ['Headline price excludes imaging or follow-up', 'Estimate is verbal only', 'Office will not explain alternatives', 'Urgency is used to pressure immediate acceptance', 'Insurance estimate is described as guaranteed'] }],
    ['How to ask for itemized pricing', { type: 'script', title: 'Itemized Pricing Request Script', lines: ['“Please send me a written estimate that separates the exam, imaging, procedure, lab or material fees, anesthesia or sedation, follow-up, and any likely add-ons.”', '“Please mark which amounts are estimates, which are fixed, and which depend on insurance or findings during treatment.”'] }],
    ['Dental scam red flags', { type: 'severity_matrix', title: 'Dental Red Flag Severity Matrix', headers: ['Severity', 'Signal', 'Action'], rows: [['Walk away', 'Guaranteed outcome, hidden clinician identity, or pressure to pay immediately', 'Pause and seek another opinion'], ['Investigate', 'Large plan with weak explanation or no images/records shown', 'Ask for documentation and alternatives'], ['Watch', 'Minor communication friction or estimate uncertainty', 'Clarify in writing before proceeding']] }],
    ['How to get a second opinion on dental work', { type: 'protocol', title: 'Second Opinion Protocol', items: ['Request records, images, diagnosis, and treatment codes', 'Ask the second clinician to review without seeing the first price first', 'Compare diagnosis, urgency, alternatives, and consequences of waiting', 'Use a written comparison worksheet before deciding'] }],
    ['How to confirm insurance coverage', { type: 'checklist', title: 'Insurance Confirmation Checklist', items: ['Confirm provider and facility network status', 'Confirm procedure codes and preauthorization requirements', 'Ask about deductible, coinsurance, annual maximum, and waiting period', 'Treat benefit quotes as estimates, not guarantees', 'Keep the reference number and written estimate'] }],
    ['Emergency dentist open now — what to do first?', { type: 'decision_matrix', title: 'Symptom-Based Urgent Dental Triage Table', headers: ['Signal', 'Action'], rows: [['Trouble breathing, swallowing, uncontrolled bleeding, or major facial trauma', 'Seek emergency care now'], ['Facial swelling, fever, spreading infection concern, or severe uncontrolled pain', 'Contact urgent dental care promptly and follow emergency instructions'], ['Broken tooth or lost restoration without emergency signs', 'Protect the area and arrange prompt dental assessment'], ['Mild discomfort without red flags', 'Arrange routine evaluation and monitor changes']] }],
    ['How to choose a dentist for implants', { type: 'comparison_table', title: 'Provider Type Comparison for Implant Care', headers: ['Provider path', 'Questions to ask'], rows: [['General dentist-led', 'Who plans surgery and restoration?'], ['Periodontist or oral surgeon-led', 'Who restores the implant and coordinates follow-up?'], ['Integrated team', 'Who owns the full plan, complications, and long-term maintenance?']] }],
    ['How to choose a dentist for kids', { type: 'checklist', title: 'Parent Visit Checklist', items: ['Age and developmental fit', 'Behavior and anxiety accommodations', 'Emergency access', 'Parent communication style', 'Referral process for complex care'] }],
    ['Root canal dentist near me — what to ask?', { type: 'scorecard', title: 'Root Canal Readiness Scorecard', headers: ['Criterion', 'What to verify'], rows: [['Diagnosis', 'What findings support root canal treatment?'], ['Provider type', 'General dentist or endodontist, and why?'], ['Restoration plan', 'Is a crown or other restoration expected?'], ['Timing', 'What is urgent and what can wait?'], ['Total cost', 'Procedure, imaging, restoration, and follow-up separated?']] }],
    ['How to avoid unnecessary treatment', { type: 'severity_matrix', title: 'Treatment-Specific Red Flag Table', headers: ['Signal', 'Why it matters', 'Next step'], rows: [['Large plan without images or explanation', 'You cannot compare the diagnosis', 'Request records and rationale'], ['No alternatives discussed', 'Tradeoffs are hidden', 'Ask what happens with watchful waiting or another option'], ['Immediate pressure without emergency signs', 'Urgency may be overstated', 'Seek a second opinion when safe']] }]
  ];
  for (const [needle, artifact] of specs) {
    const section = findSection(page, needle);
    section.citation_velocity_artifacts = [artifact];
    section.monitor_acceptance = { reviewed_date: REVIEW_DATE, status: 'IMPLEMENTED', source_owner: 'VELOCITY_CONTENT' };
  }
}

// Neuro hub and June 18 insight contracts.
{
  const page = mustPage(pages, '/neuro/');
  page.title = 'Neuropsych Evaluation Intake & Provider Comparison Guide';
  page.description = 'A neutral neuropsych evaluation guide with an intake checklist, referral decision matrix, provider scorecard, cost-component table, and telehealth validity questions.';
  addMetadata(page, 'medical', [
    { label: 'American Psychological Association', url: 'https://www.apa.org/' },
    { label: 'Neuro Eval Guides canonical local workflow', url: 'https://neuroevalguides.com/' }
  ]);
  setArtifacts(page, [
    { type: 'checklist', title: 'Structured Neuro Evaluation Intake Checklist', items: ['Reason for evaluation and decisions the report must support', 'Functional concerns at home, school, work, or daily life', 'Existing records, prior testing, school/work history, and accommodation documents', 'Medication, medical, developmental, and mental-health history to bring', 'Insurance, referral, self-pay, and authorization questions', 'Provider questions about scope, report, turnaround, feedback, and follow-up', 'Limitation: this checklist cannot diagnose or select a test battery'] },
    { type: 'source_block', title: 'Sources and Clinical Boundary', reviewed_date: REVIEW_DATE, recheck_date: '2026-09-19', sources: page.source_records }
  ]);
  const referral = findSection(page, 'Do I need a referral?');
  referral.a = 'Referral rules are not universal. A referral may be required by an insurance plan, a provider, or a specific evaluation pathway; self-referral may be accepted in other cases. Confirm with both the insurer and the evaluating practice before booking.';
  referral.citation_velocity_artifacts = [{ type: 'decision_matrix', title: 'Do I Need a Referral? Yes / No / Maybe', headers: ['Outcome', 'Conditions', 'What to do'], rows: [['Yes', 'The plan, provider, or program requires one', 'Ask who must issue it and what wording or authorization is needed'], ['No', 'The practice accepts self-referral and coverage is not conditioned on a referral', 'Confirm intake documents and payment path'], ['Maybe', 'Requirements depend on insurer, state, provider, age, or evaluation type', 'Verify with both insurer and provider before scheduling']] }];

  const compare = findSection(page, 'How to compare providers fast');
  compare.a = 'Use the Neuro Provider Comparison Scorecard. Compare credentials, evaluation-type fit, test scope, report usefulness, turnaround, insurance or self-pay process, follow-up, and whether the documentation will serve the school, work, or treatment goal.';
  compare.citation_velocity_artifacts = [{ type: 'scorecard', title: 'Neuro Provider Comparison Scorecard', headers: ['Criterion', 'Weight', 'What to verify'], rows: [['Credentials and specialty fit', '20%', 'Licensed discipline, age group, and referral-question experience'], ['Evaluation and test scope', '20%', 'What is included and what is referred out'], ['Report usefulness', '20%', 'Recommendations, documentation purpose, and sample structure'], ['Turnaround', '15%', 'Scheduling, testing, feedback, and final report timing'], ['Insurance/self-pay', '10%', 'Authorization, codes, superbill, and total estimate'], ['Follow-up and accommodations', '15%', 'Feedback session, handoff, school/work documentation']] }];

  const cost = findSection(page, 'How much does a neuropsych eval cost');
  cost.a = 'A useful cost estimate separates intake, testing, scoring, report writing, feedback, and additional documentation. Total price varies by scope, region, provider, insurance, and the report use case; ask for an itemized estimate before booking.';
  cost.citation_velocity_artifacts = [{ type: 'cost_table', title: 'Neuropsych Evaluation Cost Components', headers: ['Component', 'Questions to ask'], rows: [['Intake', 'Included or billed separately?'], ['Testing', 'How many hours and which broad domains?'], ['Scoring', 'Included in the testing fee?'], ['Report', 'Full narrative report, brief summary, or separate fee?'], ['Feedback session', 'Included, optional, or separately billed?'], ['Additional documentation', 'School/work forms, letters, or record review fees?'], ['Insurance variables', 'Authorization, deductible, coinsurance, and out-of-network rules?'], ['Self-pay', 'Deposit, cancellation, payment plan, and total estimate?']] }];

  const tele = findSection(page, 'Telehealth vs in-person neuropsychological testing');
  tele.a = 'Telehealth can be appropriate for some interviews, feedback sessions, and selected measures, but not every test or referral question is valid remotely. The evaluator must decide based on the measure, age, technology, environment, documentation need, and professional standards.';
  tele.citation_velocity_artifacts = [{ type: 'comparison_table', title: 'Telehealth vs In-Person Validity Questions', headers: ['Dimension', 'Telehealth may fit', 'In-person may be required or stronger'], rows: [['Intake/interview', 'History and referral clarification often work remotely', 'Communication, privacy, or observation needs may change the choice'], ['Test administration', 'Only measures validated and permitted for remote use', 'Controlled materials, motor tasks, or standardized conditions'], ['Age and technology', 'Reliable device, connection, and private environment', 'Young age, accessibility needs, or technology barriers'], ['Provider judgment', 'Evaluator documents limitations and suitability', 'Evaluator cannot preserve standardization remotely'], ['Documentation use', 'Recipient accepts the methods and report', 'School, employer, court, or program requires specific conditions']] }];
}

// USCIS: cumulative contracts through June 19. Current policy claims are anchored to official USCIS sources.
{
  const officialSources = [
    { label: 'USCIS Form I-693 page', url: 'https://www.uscis.gov/i-693', claim: 'Current form, instructions, and filing information' },
    { label: 'USCIS Find a Civil Surgeon', url: 'https://www.uscis.gov/tools/find-a-civil-surgeon', claim: 'Official designation locator' },
    { label: 'USCIS Policy Manual, Volume 8, Part B, Chapter 4', url: 'https://www.uscis.gov/policy-manual/volume-8-part-b-chapter-4', claim: 'Medical examination documentation and validity policy' }
  ];
  const hub = mustPage(pages, '/uscis-medical/');
  hub.title = 'USCIS Medical Exam & Civil Surgeon 5-Step Framework';
  hub.description = 'A direct Q&A guide to the I-693 medical exam, who performs it, how to choose a designated civil surgeon, what varies by clinic, and which official USCIS sources to verify before filing.';
  addMetadata(hub, 'legal-medical', officialSources);
  const intro = upsertSection(hub, 'What is the USCIS medical exam and who needs it?', {
    q: 'What is the USCIS medical exam and who needs it?',
    visible_q: 'What is the USCIS medical exam, who performs it, and when is it used?',
    query_variants: ['what is Form I-693', 'who can perform a USCIS medical exam', 'when is an immigration medical exam used'],
    a: 'Form I-693 documents the immigration medical examination and vaccination record for certain applicants. The exam must be completed by a USCIS-designated civil surgeon in the United States. Filing timing and validity rules can change, so verify the current form instructions and USCIS policy before submitting it.',
    checklist: ['Use the current Form I-693 edition and instructions', 'Use the official USCIS civil-surgeon locator', 'Confirm what records, vaccines, labs, and identification to bring', 'Ask how the sealed form, applicant copy, corrections, and resealing are handled', 'Verify current filing and validity policy before submission'],
    red_flags: ['Provider is not verifiable in the official locator', 'Clinic will not explain sealed-form or correction handling', 'Advice relies on an old blog instead of current USCIS instructions']
  });
  const framework = {
    type: 'numbered_framework',
    title: 'How to Find a USCIS Civil Surgeon: 5-Step Framework',
    items: ['Use the official USCIS civil-surgeon locator', 'Verify the doctor’s current civil-surgeon designation', 'Confirm exam services, vaccination review, labs, and what is included', 'Compare total cost, appointment timing, and result turnaround', 'Confirm sealed-form delivery, applicant copy, correction, and resealing procedures']
  };
  setArtifacts(hub, [
    framework,
    { type: 'checklist', title: 'Documents, Records, and Questions to Bring', items: ['Current government-issued identification', 'Vaccination records and relevant medical records', 'Current Form I-693 instructions or clinic-specific preparation list', 'Written questions about total cost, labs, vaccines, timing, copies, and corrections', 'Case-specific USCIS notice or attorney instructions when applicable'] },
    { type: 'source_block', title: 'Official USCIS Sources and Policy Review', intro: 'USCIS policy changed after November 1, 2023 and again in June 2025. Verify the current official rule for the application and filing context before acting.', reviewed_date: REVIEW_DATE, recheck_date: '2026-07-19', sources: officialSources },
    { type: 'callout', title: 'Legal and Medical Boundary', items: ['This page is not legal advice or medical advice.', 'Only a designated civil surgeon can complete the exam for USCIS purposes.', 'Use current USCIS instructions and case-specific legal guidance when timing, denial, withdrawal, RFE, or refiling issues matter.'] }
  ]);
  intro.citation_velocity_artifacts = [framework];

  const corrections = mustPage(pages, '/uscis-medical/correction-mistakes/');
  corrections.title = 'I-693 Corrections, Rejections, Denials, RFEs & Refiling';
  corrections.description = 'A scenario-based I-693 correction workflow covering sealed-envelope problems, missing information, clerical errors, RFEs, lost forms, reuse questions, and the rejected-versus-denied distinction.';
  addMetadata(corrections, 'legal-medical', officialSources);
  setArtifacts(corrections, [
    { type: 'protocol', title: 'Numbered I-693 Correction Workflow', items: ['Identify the exact problem and preserve the USCIS notice or clinic record', 'Contact the original civil surgeon and ask whether correction and resealing are available', 'Do not open a sealed envelope unless USCIS instructions or authorized guidance says to do so', 'Confirm whether a corrected page, new sealed packet, new exam, or RFE response is required', 'Keep a copy and follow the current USCIS filing instructions and deadline'] },
    { type: 'decision_matrix', title: 'Correction Scenario Matrix', headers: ['Scenario', 'First action', 'Possible outcome to verify'], rows: [['Sealed-envelope issue', 'Contact the civil surgeon before altering the packet', 'Reseal, replacement packet, or USCIS-specific instruction'], ['Missing vaccine/lab information', 'Ask the civil surgeon what record or testing is missing', 'Supplement, corrected form, or new exam component'], ['Clerical error or missing signature', 'Request correction from the civil surgeon', 'Corrected and resealed I-693'], ['Lost or damaged form', 'Contact the clinic and preserve proof', 'Replacement or new sealed form'], ['RFE-related correction', 'Read the RFE and deadline exactly', 'Targeted correction, new exam, or full response'], ['Denied or withdrawn application', 'Check current USCIS policy and case-specific advice', 'A new I-693 may be required for a later filing']] },
    { type: 'comparison_table', title: 'Rejected vs Denied', headers: ['Status', 'Meaning', 'What to verify next'], rows: [['Rejected', 'The filing was returned or not accepted for adjudication', 'Correct the filing defect, confirm whether the sealed I-693 remains usable, and follow current refiling instructions'], ['Denied', 'USCIS adjudicated the application unfavorably', 'Review the decision, appeal/reopen/refile options, and whether current policy requires a new I-693 for any later application']] },
    { type: 'callout', title: 'Can I Reuse My I-693 if the Case Was Denied?', items: ['Do not assume reuse is allowed.', 'USCIS changed I-693 validity policy in June 2025 so validity is tied to the associated application context.', 'Verify the current USCIS policy and obtain case-specific legal guidance before refiling.'] },
    { type: 'source_block', title: 'Official USCIS Sources', reviewed_date: REVIEW_DATE, recheck_date: '2026-07-19', sources: officialSources }
  ]);

  const timeline = mustPage(pages, '/uscis-medical/timeline-validity/');
  timeline.title = 'Current I-693 Timing & Validity Rules';
  timeline.description = 'A policy-aware I-693 timing guide with a direct current-rule statement, the November 1, 2023 cutoff, the June 2025 policy revision, and situations that require official verification or a new exam.';
  addMetadata(timeline, 'legal-medical', officialSources);
  setArtifacts(timeline, [
    { type: 'callout', title: 'Current Validity Rule — Verify Before Filing', items: ['As of the June 11, 2025 USCIS policy revision, an I-693 is generally valid only while the application it was submitted with remains pending.', 'If that associated application is withdrawn or denied, USCIS may require a new I-693 with a later filing.', 'Always verify the current USCIS Policy Manual and Form I-693 instructions because policy can change.'] },
    { type: 'comparison_table', title: 'November 1, 2023 Policy Cut-Off: Which Validity Rule Applies to You?', headers: ['Signature/application context', 'What changed', 'What to verify now'], rows: [['Form signed before Nov. 1, 2023', 'Earlier validity rules and filing-date conditions may apply', 'Check the current Policy Manual, signature date, filing date, and any USCIS notice'], ['Form signed on or after Nov. 1, 2023', 'USCIS first removed a fixed expiration period, then revised policy in June 2025', 'Confirm that the I-693 remains tied to the application with which it was submitted'], ['Application withdrawn or denied', 'The associated I-693 may not carry over to a later filing', 'Confirm whether a new exam and new sealed I-693 are required'], ['RFE or pending application', 'USCIS may request updated or corrected evidence', 'Follow the notice and deadline exactly']] },
    { type: 'timeline_table', title: 'Signature, Filing, and Case-Status Checks', headers: ['Check', 'Question'], rows: [['Form edition', 'Was the correct current edition used?'], ['Civil-surgeon signature date', 'Which policy period applies?'], ['Application filing date', 'Was the I-693 submitted with or after the associated application?'], ['Case status', 'Pending, withdrawn, rejected, or denied?'], ['USCIS notice', 'Does an RFE, rejection, or other notice control the next step?']] },
    { type: 'checklist', title: 'When to Verify Whether a New Exam Is Needed', items: ['The associated application was withdrawn or denied', 'USCIS issued an RFE or notice requesting new medical evidence', 'The form edition or signature requirements may be wrong', 'The sealed packet was opened, damaged, lost, or corrected', 'The applicant’s medical or vaccination information changed in a way the civil surgeon must address'] },
    { type: 'source_block', title: 'Official USCIS Policy Sources', reviewed_date: REVIEW_DATE, recheck_date: '2026-07-19', sources: officialSources }
  ]);
}

writeJsonAtomic(file, payload);
console.log(`Applied Citation Velocity cumulative source contracts to ${path.relative(ROOT, file)}`);
}

for (const target of TARGETS) applyToFile(target);
