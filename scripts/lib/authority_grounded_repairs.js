'use strict';

const crypto = require('crypto');

function unique(items) {
  return [...new Set((items || []).filter((v) => v !== undefined && v !== null && String(v).trim()).map((v) => String(v).trim()))];
}
function hash(value, len = 12) { return crypto.createHash('sha256').update(String(value || '')).digest('hex').slice(0, len); }
function rowReq(recordId, implementationPath, artifact) {
  const tabular = ['comparison_table','decision_matrix','cost_table','timeline_table','severity_matrix','scorecard','worksheet'].includes(artifact.type);
  return {
    row_id: recordId || '', query: '', implementation_path: implementationPath, source_fix: 'authority_grounded_compilation',
    required_blocks: [{ type: artifact.type, heading_exact: artifact.title, columns_exact: artifact.headers || [], min_rows: tabular ? (artifact.rows || []).length : (artifact.items || artifact.sources || []).length, placement: 'rendered_content' }],
    required_strings: unique([artifact.title, ...(artifact.headers || []), ...(artifact.items || []).slice(0, 3), ...((artifact.rows || []).flat().filter((x) => String(x).length <= 100).slice(0, 5))]),
    block_reason_if_not_possible: 'AUTHORITY_VALIDATION_FAILED'
  };
}
function finish(spec, payload) {
  const implementationPath = spec.implementation_path || spec.intended_winner_path || '';
  const recordIds = unique(spec.record_ids || [spec.record_id]);
  const artifacts = (payload.artifacts || []).map((a, i) => ({ id: a.id || `authority-${hash(`${implementationPath}:${a.title}:${i}`)}`, marker: a.marker || `authority-${hash(`${implementationPath}:${a.title}:${i}`)}`, ...a }));
  const rowRequirements = artifacts.map((a, i) => rowReq(recordIds[i] || recordIds[0] || '', implementationPath, a));
  const requiredStrings = unique(rowRequirements.flatMap((r) => r.required_strings || [])).slice(0, 80);
  return {
    implementation_path: implementationPath,
    title: payload.title,
    description: payload.description,
    answer: payload.answer,
    checklist: payload.checklist || [],
    red_flags: payload.red_flags || [],
    artifacts,
    row_requirements: rowRequirements,
    required_strings: requiredStrings,
    required_artifact_types: unique(artifacts.map((a) => a.type)),
    canonicalized_from: spec.canonicalized_from || [],
    source_record_ids: recordIds,
    source_queries: unique(spec.queries || [spec.query]),
    authority_grounded: true,
    authority_policy: 'HIGH_STAKES_PRIMARY_SOURCES_REQUIRED',
    authority_source_ids: payload.authority_source_ids,
    authority_urls: payload.authority_urls,
    authority_reviewed_at: '2026-07-24',
    authority_recheck_at: '2026-08-24'
  };
}

const SRC = {
  finder: ['SRC-USCIS-CIVIL-SURGEON', 'https://www.uscis.gov/tools/find-a-civil-surgeon'],
  i693: ['SRC-USCIS-I693', 'https://www.uscis.gov/i-693'],
  medreq: ['SRC-USCIS-MEDICAL-REQUIREMENTS', 'https://www.uscis.gov/policy-manual/volume-8-part-b-chapter-3'],
  tb: ['SRC-CDC-CIVIL-SURGEON-TB-2024', 'https://www.cdc.gov/immigrant-refugee-health/hcp/civil-surgeons/tuberculosis.html'],
  cdc: ['SRC-CDC-CIVIL-SURGEON-TECH-2024', 'https://www.cdc.gov/immigrant-refugee-health/hcp/civil-surgeons/index.html'],
  sealed: ['SRC-USCIS-CIVIL-SURGEON-SEALED-I693', 'https://www.uscis.gov/policy-manual/volume-8-part-c-chapter-3'],
  validity: ['SRC-USCIS-I693-VALIDITY-2025', 'https://content.govdelivery.com/accounts/USDHSCIS/bulletins/3e49516'],
  vaccines: ['SRC-CDC-CIVIL-SURGEON-VACCINATION-TI', 'https://www.cdc.gov/immigrant-refugee-health/hcp/civil-surgeons/vaccination.html'],
  i485: ['SRC-USCIS-I485', 'https://www.uscis.gov/i-485']
};
function sources(keys) {
  return keys.map((k) => ({ label: ({finder:'USCIS — Find a Civil Surgeon',i693:'USCIS — Form I-693',medreq:'USCIS Policy Manual — Medical Exam Requirements',tb:'CDC — TB Technical Instructions for Civil Surgeons',cdc:'CDC — Technical Instructions for Civil Surgeons',sealed:'USCIS Policy Manual — Civil Surgeon Certification',validity:'USCIS — June 11, 2025 I-693 validity update',vaccines:'CDC — Vaccination Technical Instructions for Civil Surgeons',i485:'USCIS — Form I-485, Application to Register Permanent Residence'})[k], url: SRC[k][1] }));
}
function ids(keys){ return keys.map((k)=>SRC[k][0]); }
function urls(keys){ return keys.map((k)=>SRC[k][1]); }

function authorityGroundedEntryForSpec(spec) {
  const p = String(spec.implementation_path || spec.intended_winner_path || '');
  if (!p.startsWith('uscis-medical/')) return null;

  if (p.includes('community-questions/what-is-the-uscis-medical-exam-and-who-performs-it')) {
    const keys=['finder','medreq','cdc'];
    return finish(spec, {
      title:'Can I Use My Regular Family Doctor for the USCIS Medical Exam?',
      description:'A plain-language guide to who may perform a USCIS immigration medical exam in the United States and how to verify a doctor’s civil surgeon designation.',
      answer:'No—unless your regular family doctor is currently designated by USCIS as a civil surgeon. For adjustment-of-status medical exams in the United States, use a USCIS-designated civil surgeon; overseas immigrant-visa medical exams are generally handled by panel physicians.',
      checklist:['Use the official USCIS civil surgeon locator before booking.','Confirm the clinic is completing Form I-693 for your immigration category.','Ask what identity, vaccination, and medical records to bring.','Keep a copy of the completed medical documentation provided to you.'],
      red_flags:['The clinic cannot be found or verified through the official USCIS civil surgeon process.','A provider says any regular doctor can certify Form I-693 without USCIS designation.'],
      authority_source_ids:ids(keys), authority_urls:urls(keys),
      artifacts:[
        {type:'callout',title:'Can I use my family doctor?',intro:'The doctor’s USCIS designation—not whether they are your usual physician—is the controlling question.',items:['A regular family doctor may perform the U.S. adjustment-of-status immigration medical exam only if that physician is currently designated by USCIS as a civil surgeon.']},
        {type:'comparison_table',title:'Civil Surgeon vs. Panel Physician',headers:['Where the immigration process occurs','Who generally performs the medical exam','How to verify'],rows:[['Inside the United States for adjustment of status','USCIS-designated civil surgeon','Use the USCIS Find a Civil Surgeon tool'],['Outside the United States for immigrant-visa processing','Department of State panel physician','Follow the U.S. embassy or consulate medical-exam instructions']]},
        {type:'checklist',title:'Before You Book the Exam',items:['Verify the physician through the official USCIS locator.','Confirm the office completes Form I-693 immigration medical examinations.','Ask what records, identification, vaccination history, testing, and fees are required before the appointment.']},
        {type:'source_block',title:'Primary Sources',sources:sources(keys),reviewed_date:'2026-07-24',recheck_date:'2026-08-24'}
      ]
    });
  }

  if (p === 'uscis-medical/cost/index.html') {
    const keys=['finder','i693'];
    return finish(spec, {
      title:'USCIS Medical Exam Cost: What to Verify Before You Book',
      description:'How to compare civil surgeon quotes for the I-693 medical exam without relying on unsupported nationwide price claims.',
      answer:'There is no single nationwide civil-surgeon price published by USCIS for the I-693 medical examination. Clinic charges can vary based on what the quoted price includes, so compare written estimates for the exam, required testing, vaccinations, follow-up, and form completion before you book.',
      checklist:['Ask for a written itemized quote.','Confirm whether required lab testing is included.','Confirm whether vaccines or vaccine review are included or billed separately.','Ask whether follow-up visits or form corrections can create additional charges.','Check your health plan directly before assuming any exam, lab, or vaccination charge is covered.'],
      red_flags:['A quote does not say what testing or vaccinations are included.','A clinic presents a single price as a USCIS-set national fee.','Insurance coverage is promised without checking the specific plan and service.'],
      authority_source_ids:ids(keys), authority_urls:urls(keys),
      artifacts:[
        {type:'cost_table',title:'What to Ask About in a Civil Surgeon Quote',headers:['Cost component','What to verify'],rows:[['Civil surgeon examination','Is the medical examination and Form I-693 completion included?'],['Required testing','Which tests are included and which are billed separately?'],['Vaccination review or vaccines','Are record review and any needed vaccines included or separate?'],['Follow-up','Are result review, follow-up visits, or corrections included?']]},
        {type:'callout',title:'Does Health Insurance Cover It?',items:['Coverage is plan- and service-specific. Do not assume the immigration medical exam fee, laboratory work, or vaccinations are covered; verify each charge with the clinic and your insurer before the visit.']},
        {type:'checklist',title:'Compare Quotes on the Same Basis',items:['Request the same itemized categories from each civil surgeon office.','Compare what is included, not just the headline price.','Keep the written quote and ask how unexpected testing or vaccine needs change the total.']},
        {type:'source_block',title:'Primary Sources',sources:sources(keys),reviewed_date:'2026-07-24',recheck_date:'2026-08-24'}
      ]
    });
  }

  if (p === 'uscis-medical/delays-rfe/index.html') {
    const keys=['i693','sealed','cdc'];
    return finish(spec, {
      title:'How to Reduce Avoidable I-693 Delays and RFE Risk',
      description:'A source-grounded checklist for avoiding common Form I-693 submission problems without relying on outdated filing rules.',
      answer:'The safest way to reduce avoidable I-693 delay risk is to use the current USCIS form instructions, complete the examination with the correct civil surgeon, follow CDC medical requirements, preserve the sealed form as instructed, and respond exactly to any USCIS notice you receive.',
      checklist:['Verify the physician is authorized for the required immigration medical exam.','Use the current Form I-693 edition and follow its filing instructions.','Make sure required medical testing and vaccination documentation are completed under current CDC technical instructions.','Do not open or alter a sealed I-693 that must remain sealed for USCIS.','Keep your copy and respond to any RFE using the notice-specific deadline and instructions.'],
      red_flags:['Advice repeats the old pre-March-31-2023 “60-day” civil-surgeon signature submission rule as current law.','A sealed envelope has been opened or altered.','A required signature, certification, or medical follow-up is missing.','A response strategy ignores the actual instructions in an RFE or USCIS filing notice.'],
      authority_source_ids:ids(keys), authority_urls:urls(keys),
      artifacts:[
        {type:'checklist',title:'How to Avoid Avoidable I-693 Delays',items:['Confirm the civil surgeon and form edition before the exam.','Complete required CDC-directed testing and vaccination review.','Review your copy for obvious missing information before filing, without opening the sealed USCIS copy.','Follow the current USCIS filing instructions for when and how to submit Form I-693.','If USCIS sends an RFE, follow that notice exactly and keep proof of your response.']},
        {type:'decision_matrix',title:'If You Find a Possible I-693 Problem',headers:['Situation','Next step'],rows:[['You notice an issue before the sealed form is submitted','Contact the civil surgeon’s office and ask whether a corrected form is required.'],['The USCIS copy is sealed','Do not open or alter the sealed envelope; use your personal copy to review what you can.'],['USCIS sends an RFE','Follow the RFE instructions and deadline; obtain corrected medical documentation if the notice requires it.']]},
        {type:'callout',title:'Do Not Use the Old 60-Day Rule',items:['USCIS removed the former requirement tying a civil surgeon’s signature to filing within 60 days. Use current Form I-693 instructions and current USCIS policy instead of repeating that superseded rule.']},
        {type:'source_block',title:'Primary Sources',sources:sources(keys),reviewed_date:'2026-07-24',recheck_date:'2026-08-24'}
      ]
    });
  }

  if (p === 'uscis-medical/exam-day-documents/index.html') {
    const keys=['i693','sealed','cdc'];
    return finish(spec, {
      title:'What Happens at the USCIS Medical Exam and How to Handle the Sealed I-693',
      description:'A practical exam-day and sealed-envelope guide grounded in USCIS and CDC requirements for civil surgeon examinations.',
      answer:'The civil surgeon reviews your medical and vaccination history, performs the required examination and testing under CDC technical instructions, completes Form I-693 when the medical requirements are satisfied, and provides the USCIS copy according to the form’s sealing instructions. Do not open or alter a sealed USCIS copy.',
      checklist:['Bring the identification and medical or vaccination records the civil surgeon requests.','Ask what testing is required and when results are expected.','Ask for your personal copy of the completed medical documentation.','Inspect the outside of the USCIS envelope for obvious damage, but do not open it.','Follow USCIS filing instructions for delivery of the sealed form.'],
      red_flags:['The sealed USCIS copy has been opened or altered.','The clinic cannot explain what remains outstanding before Form I-693 can be completed.','A promised timeline is treated as universal even though testing or required follow-up is still pending.'],
      authority_source_ids:ids(keys), authority_urls:urls(keys),
      artifacts:[
        {type:'numbered_framework',title:'What Happens During the USCIS Medical Exam',items:['Check-in and identity/document review.','Medical and vaccination history review.','Physical examination and required disease screening under CDC technical instructions.','Any required laboratory, imaging, vaccination, or follow-up steps.','Civil surgeon completion and certification of Form I-693 after required components are complete.','Delivery of the USCIS copy according to the form’s sealing instructions, plus your personal copy when provided.']},
        {type:'checklist',title:'How to Protect a Sealed I-693',items:['Do not open or alter the sealed USCIS copy.','Keep it protected from damage or moisture.','Keep your personal copy separate from the sealed USCIS copy.','Follow the current USCIS filing instructions or RFE/interview instructions for submission.']},
        {type:'callout',title:'How Long Can the Process Take?',items:['Timing varies by appointment availability and whether required tests, vaccinations, imaging, or follow-up must be completed before the civil surgeon can finish Form I-693. Ask the specific civil surgeon office for its current turnaround and what could extend it.']},
        {type:'source_block',title:'Primary Sources',sources:sources(keys),reviewed_date:'2026-07-24',recheck_date:'2026-08-24'}
      ]
    });
  }

  if (p === 'uscis-medical/index.html') {
    const keys=['medreq','tb','cdc','finder','i693'];
    return finish(spec, {
      title:'USCIS Medical Exam: Civil Surgeon, I-693, and TB Testing Basics',
      description:'A current overview of the USCIS immigration medical exam, who performs it in the United States, and the CDC tuberculosis screening rules civil surgeons must follow.',
      answer:'For adjustment of status in the United States, the immigration medical exam is generally completed by a USCIS-designated civil surgeon using Form I-693 and CDC technical instructions. For tuberculosis screening, all applicants age 2 or older must receive an IGRA blood test; a positive IGRA, known HIV infection, or TB signs or symptoms requires a chest X-ray, with additional public-health evaluation when indicated.',
      checklist:['Verify the civil surgeon through USCIS.','Bring requested identity, vaccination, and medical records.','Expect CDC-required screening based on your age and medical findings.','For applicants age 2 or older, expect an IGRA blood test for TB screening.','Follow any required chest X-ray or health-department follow-up before the medical exam can be finalized.'],
      red_flags:['A U.S. adjustment-of-status exam is offered by a doctor who is not properly designated as a civil surgeon.','A clinic says a tuberculin skin test can simply replace the required IGRA for an applicant age 2 or older.','A positive IGRA is treated as the final diagnosis without the required next-step evaluation.','The page or provider repeats superseded I-693 policy as current.'],
      authority_source_ids:ids(keys), authority_urls:urls(keys),
      artifacts:[
        {type:'comparison_table',title:'Who Performs the Immigration Medical Exam?',headers:['Process','Medical examiner'],rows:[['Adjustment of status in the United States','USCIS-designated civil surgeon'],['Immigrant-visa processing abroad','Department of State panel physician'],['Benefit categories with special medical-exam rules','Follow the benefit-specific USCIS or Department of State instructions before scheduling']]},
        {type:'protocol',title:'TB Screening for Applicants Age 2 or Older',items:['An IGRA blood test is required under the CDC civil surgeon technical instructions.','If the IGRA is positive—or if there are TB signs or symptoms or known HIV infection—a chest X-ray is required.','Certain chest X-ray findings, symptoms, or other risk findings require referral to the health department for further TB evaluation.','A prior positive skin test does not replace the required IGRA for applicants age 2 or older.']},
        {type:'decision_matrix',title:'What Happens After the IGRA?',headers:['Result or finding','Typical required next step under CDC instructions'],rows:[['Negative IGRA with no TB symptoms or known HIV infection','No chest X-ray is required for TB screening solely because of the IGRA result.'],['Positive IGRA','Chest X-ray is required.'],['TB symptoms or known HIV infection','Chest X-ray is required; additional evaluation may be required.'],['Chest X-ray or clinical findings suggest infectious TB','Health-department referral and sputum evaluation are required before clearance.']]},
        {type:'source_block',title:'Primary Sources',sources:sources(keys),reviewed_date:'2026-07-24',recheck_date:'2026-08-24'}
      ]
    });
  }
  // 2026-09-09. This route had a semantic entry once - the fix ledger still records
  // semantic_repair_status SEMANTICALLY_APPLIED for it - but the entry was lost before
  // the manifest became durable on 2026-09-01, and every recompile since has REFUSED
  // to re-author it because no grounded template covered the route. The page kept
  // delivering the previous run's marker while the ledger minted a new one, and
  // `agent_7b5d43b6820884d4:repair_not_proven` took run 34409865197 red.
  //
  // The first artifact deliberately reuses the type and title the accepted output
  // already carries ('checklist' / 'Current I-693 Validity Rule (as of June 11, 2025)')
  // so mergeAcceptedArtifacts REPLACES that block in place rather than appending a
  // second copy beside it. What it replaces is worth replacing: the generic compiler
  // had filled it with fragments of the EDIT instruction itself - "Both date
  // thresholds", "Written for direct LLM extraction" - which is internal process text
  // on a public page. This is the same content stated from the primary sources.
  if (p === 'uscis-medical/timeline-validity/index.html') {
    const keys=['validity','i693','medreq'];
    return finish(spec, {
      title:'How Long Is the I-693 Medical Exam Valid? Current USCIS Validity Rules',
      description:'The current I-693 validity rules split by civil surgeon signature date, including the November 1, 2023 cut-off and the June 11, 2025 USCIS policy update tying validity to the pending application.',
      answer:'It depends on when the civil surgeon signed the form. For a Form I-693 signed before November 1, 2023, the earlier fixed validity period and filing-date conditions may still apply. For a form properly completed and signed on or after November 1, 2023, USCIS removed the fixed expiration period, and under the June 11, 2025 policy update the I-693 generally remains valid only while the benefit application it was submitted with is still pending. If that application is withdrawn, rejected, or denied, USCIS may require a new medical examination and a new sealed I-693 for a later filing.',
      checklist:[
        'Find the civil surgeon signature date on your copy of Form I-693.',
        'Determine which policy period applies: signed before November 1, 2023, or on or after that date.',
        'Confirm the I-693 was submitted with, or in support of, a benefit application that is still pending.',
        'If the associated application was withdrawn, rejected, or denied, check whether a new exam is required before refiling.',
        'Check the current Form I-693 page and USCIS Policy Manual before relying on any validity period, because this policy has changed twice since 2023.'
      ],
      red_flags:[
        'Guidance states a flat two-year expiration as the current rule without naming the November 1, 2023 signature cut-off.',
        'Guidance repeats the removed "no expiration" rule without the June 11, 2025 pending-application condition.',
        'A validity answer is given without asking for the civil surgeon signature date.',
        'A prior I-693 is assumed to carry over to a new filing after the earlier application was withdrawn or denied.'
      ],
      authority_source_ids:ids(keys), authority_urls:urls(keys),
      artifacts:[
        {type:'checklist',title:'Current I-693 Validity Rule (as of June 11, 2025)',intro:'Two facts decide the answer: the civil surgeon signature date, and whether the application the form was filed with is still pending.',items:[
          'Signed before November 1, 2023: the earlier fixed validity period and filing-date conditions may still apply — verify against the current Policy Manual.',
          'Signed on or after November 1, 2023: USCIS removed the fixed expiration period for a properly completed and signed Form I-693.',
          'Under the June 11, 2025 policy update, that form generally stays valid only while the benefit application it was submitted with remains pending.',
          'If that application is withdrawn, rejected, or denied, USCIS may require a new examination and a new sealed I-693 for a later filing.',
          'Policy has changed twice since 2023, so confirm the current rule on the USCIS Form I-693 page before relying on any validity period.'
        ]},
        {type:'timeline_table',title:'Which I-693 Validity Rule Applies to You',headers:['Civil surgeon signature date','What USCIS policy provides','What to verify'],rows:[
          ['Before November 1, 2023','The earlier fixed validity period and filing-date conditions may apply.','The signature date, the filing date, and the current Policy Manual text for that period.'],
          ['On or after November 1, 2023','USCIS removed the fixed expiration period for a properly completed and signed form.','That the form was properly completed, signed, and submitted in support of a benefit application.'],
          ['On or after November 1, 2023, application no longer pending','Validity is tied to the pending application under the June 11, 2025 update.','Whether the associated application was withdrawn, rejected, or denied, and whether a new exam is required.']
        ]},
        {type:'decision_matrix',title:'Do You Need a New I-693?',headers:['Your situation','Next step'],rows:[
          ['The application you filed the I-693 with is still pending','No new exam is required solely because time has passed; keep following any USCIS notice you receive.'],
          ['That application was withdrawn, rejected, or denied and you are refiling','Check whether USCIS requires a new medical examination and a new sealed I-693 for the new filing.'],
          ['USCIS issued an RFE about the medical evidence','Follow the notice and its deadline exactly; obtain corrected or updated medical documentation if the notice requires it.'],
          ['The sealed packet was opened, damaged, or lost','Contact the civil surgeon’s office about a replacement sealed form before filing.']
        ]},
        {type:'source_block',title:'Primary Sources',sources:sources(keys),reviewed_date:'2026-07-24',recheck_date:'2026-08-24'}
      ]
    });
  }

  if (p === 'uscis-medical/civil-surgeon-near-me/index.html') {
    const keys=['finder','i693','medreq'];
    return finish(spec, {
      title:'How to Find and Verify a USCIS-Designated Civil Surgeon',
      description:'A source-grounded guide to locating a USCIS-designated civil surgeon, confirming the office performs Form I-693 examinations, and comparing appointment requirements before booking.',
      answer:'For an adjustment-of-status immigration medical exam in the United States, start with the official USCIS Find a Civil Surgeon tool. Search your location, review the listed physicians, and contact an office directly to confirm that it currently performs Form I-693 examinations and to ask what records, testing, vaccinations, fees, and follow-up may be required.',
      checklist:[
        'Use the official USCIS Find a Civil Surgeon locator.',
        'Search by ZIP code, city, or address.',
        'Confirm the listed office currently performs Form I-693 examinations.',
        'Ask what identification, vaccination, medical records, testing, fees, and follow-up are required.',
        'Request appointment instructions and fee inclusions in writing when available.'
      ],
      red_flags:[
        'The physician cannot be verified through the official USCIS civil surgeon process.',
        'An office says any regular doctor may complete Form I-693 without USCIS designation.',
        'The office cannot explain whether it currently performs immigration medical examinations.',
        'The quoted fee does not explain which examination, testing, vaccination, follow-up, or correction services are included.'
      ],
      authority_source_ids:ids(keys),
      authority_urls:urls(keys),
      artifacts:[
        {
          type:'numbered_framework',
          title:'How to Find a USCIS-Designated Civil Surgeon Near You',
          items:[
            'Open the official USCIS Find a Civil Surgeon tool.',
            'Enter your ZIP code, city, or address to review nearby listed physicians.',
            'Open the available listing details and contact the office.',
            'Confirm that the physician currently performs Form I-693 immigration medical examinations.',
            'Ask what records, testing, vaccinations, fees, and follow-up the office requires before booking.'
          ]
        },
        {
          type:'checklist',
          title:'How to Verify a Civil Surgeon Before Booking',
          items:[
            'Confirm the physician appears through the official USCIS locator.',
            'Confirm the office completes Form I-693 for adjustment-of-status applicants.',
            'Ask which identification, medical, and vaccination records to bring.',
            'Request a written explanation of what the quoted fee includes.',
            'Ask how the office handles required testing, missing vaccination records, follow-up, and form corrections.'
          ]
        },
        {
          type:'comparison_table',
          title:'Questions to Ask Each Civil Surgeon Office',
          headers:['Question','What to confirm','Why it matters'],
          rows:[
            ['Do you currently perform Form I-693 examinations?','The listed physician and office currently provide the required immigration medical service.','A USCIS listing does not replace confirming the office service and appointment availability.'],
            ['What does the quoted fee include?','Whether the examination, testing, vaccination review, follow-up, and form completion are included or billed separately.','Comparing the same categories prevents misleading headline-price comparisons.'],
            ['What records should I bring?','Required identification, vaccination history, medical records, and immigration documents.','Missing records may require additional steps before the form can be completed.'],
            ['How are follow-up and corrections handled?','Whether result review, additional visits, or form corrections may involve separate procedures or charges.','The total process may extend beyond the first appointment.']
          ]
        },
        {
          type:'source_block',
          title:'Primary Sources',
          sources:sources(keys),
          reviewed_date:'2026-07-24',
          recheck_date:'2026-08-24'
        }
      ]
    });
  }

  // 2026-09-10. Fourteen routes grounded INDIVIDUALLY, not from one template.
  //
  // 22 live uscis-medical routes carried agent rows with no grounded entry, so every
  // one of them was a refusal the compiler had to make and a route that could never
  // be released. The obvious repair - one generated template applied across all of
  // them - is the one repair that must not be made: these are distinct long-tail
  // pages whose entire purpose is being cited, and near-identical copy across 22
  // cited pages destroys more citation value than 22 named stops ever cost.
  //
  // So each route below is written to its OWN question, against the primary sources
  // that actually answer that question, with its own artifact types and tables. The
  // eight routes that could not be honestly distinguished stay named stops with
  // their reasons recorded in data/report_fixes/uscis_authority_grounding_register.json.
  // uscis-authority-grounding-coverage enforces both halves, including a pairwise
  // near-duplicate check that fails if any two grounded uscis entries converge.

  if (p === 'uscis-medical/clusters/civil-surgeon-vs-regular-doctor-for-immigration-medical/index.html') {
    const keys=['finder','medreq','i693'];
    return finish(spec, {
      title:'Civil Surgeon vs. Regular Doctor: Which One Can Complete Form I-693?',
      description:'What the USCIS civil surgeon designation actually is, why an ordinary medical licence does not substitute for it, and how to check a physician’s designation before booking.',
      answer:'A civil surgeon is a physician USCIS has specifically designated to perform the U.S. immigration medical examination and certify Form I-693. A regular doctor’s state medical licence does not carry that authority: unless that same physician currently holds the USCIS designation, they cannot complete the form for adjustment of status, no matter how long they have treated you.',
      checklist:['Separate the two questions: is the physician licensed, and is the physician USCIS-designated.','Look the physician up through the official USCIS civil surgeon process rather than trusting a clinic’s own claim.','Confirm the designation is current, not one the office held in the past.','Confirm the office performs Form I-693 examinations for your immigration category.','Keep a record of how and when you verified the designation.'],
      red_flags:['A clinic argues that any licensed physician can certify Form I-693.','A designation is described in the past tense, or the office cannot say when it was last confirmed.','Only a screenshot or a printed certificate is offered instead of verification through the official USCIS process.','A physician offers to complete the form for a U.S. adjustment-of-status case while describing themselves as a panel physician.'],
      authority_source_ids:ids(keys), authority_urls:urls(keys),
      artifacts:[
        {type:'comparison_table',title:'Civil Surgeon vs. Regular Doctor',headers:['','Civil surgeon','Regular licensed doctor'],rows:[
          ['May certify Form I-693 for adjustment of status','Yes, while the USCIS designation is current','No, unless that physician also holds the current designation'],
          ['Source of the authority','A designation granted by USCIS','A state medical licence, which is a different thing'],
          ['How you confirm it','Through the official USCIS civil surgeon process','A licence lookup tells you nothing about I-693 authority'],
          ['Follows CDC technical instructions for the exam','Yes','Not required to, and generally does not']
        ]},
        {type:'decision_matrix',title:'Which Physician Does Your Case Need?',headers:['Your situation','Who performs the exam'],rows:[
          ['Adjusting status inside the United States','A USCIS-designated civil surgeon'],
          ['Immigrant-visa processing at a consulate abroad','A Department of State panel physician'],
          ['Your usual doctor happens to hold the current USCIS designation','That doctor may perform it — verify the designation first, not the relationship'],
          ['Your usual doctor is not designated','The exam must be done by a designated civil surgeon; your doctor’s records can still be brought to that appointment']
        ]},
        {type:'checklist',title:'Verify Before You Book',items:['Search the official USCIS civil surgeon listing for the physician and office.','Call the office and confirm they currently perform Form I-693 examinations.','Ask whether the designated physician personally signs the form.','Note the date you verified, so an RFE later can be answered with specifics.']},
        {type:'source_block',title:'Primary Sources',sources:sources(keys),reviewed_date:'2026-07-24',recheck_date:'2026-08-24'}
      ]
    });
  }

  if (p === 'uscis-medical/community-questions/how-long-is-the-i-693-medical-exam-valid-for-green-card-application/index.html') {
    const keys=['validity','i693','medreq'];
    return finish(spec, {
      title:'How Long Is the I-693 Valid for a Green Card Application?',
      description:'The one fact that decides I-693 validity for a pending green card application, and why answers published before June 2025 are unsafe to rely on.',
      answer:'Validity turns on the civil surgeon’s signature date and on whether the application the form was filed with is still pending. For a Form I-693 properly completed and signed on or after November 1, 2023, USCIS removed the former fixed expiration period; under the June 11, 2025 policy update that form generally stays valid only while the associated benefit application remains pending. Forms signed before November 1, 2023 may still fall under the earlier rules.',
      checklist:['Read the civil surgeon signature date off your own copy of the form.','Establish whether the green card application it supports is still pending.','Do not rely on a validity answer published before June 11, 2025 without re-checking it.','If the supporting application was withdrawn, rejected, or denied, check whether a fresh exam is needed before refiling.','Confirm the rule on the current USCIS Form I-693 page before acting on any date.'],
      red_flags:['An answer gives a flat number of years without asking when the form was signed.','An answer states the I-693 “never expires” without the pending-application condition added in June 2025.','A clinic or forum post cites a rule USCIS has since superseded.','A previously filed I-693 is assumed to carry over automatically to a new application.'],
      authority_source_ids:ids(keys), authority_urls:urls(keys),
      artifacts:[
        {type:'decision_matrix',title:'Is Your I-693 Still Valid?',headers:['Signature date and case status','What current policy provides'],rows:[
          ['Signed on or after November 1, 2023, application still pending','No fixed expiration period applies; validity is tied to the pending application.'],
          ['Signed on or after November 1, 2023, application no longer pending','USCIS may require a new examination and a new sealed form for any later filing.'],
          ['Signed before November 1, 2023','The earlier fixed validity period and filing-date conditions may still apply — check the Policy Manual for that period.'],
          ['You cannot find the signature date','Ask the civil surgeon’s office for your copy before assuming any validity period.']
        ]},
        {type:'checklist',title:'Two Facts Settle the Question',items:['The date the civil surgeon signed Form I-693.','Whether the benefit application the form was submitted with is still pending.','Everything else — how long ago the exam happened, how old the vaccinations are — is secondary to those two facts.','This policy changed in 2023 and again in June 2025, so verify against the current USCIS page rather than an older summary.']},
        {type:'source_block',title:'Primary Sources',sources:sources(keys),reviewed_date:'2026-07-24',recheck_date:'2026-08-24'}
      ]
    });
  }

  if (p === 'uscis-medical/community-questions/how-to-find-a-uscis-authorized-doctor-who-speaks-another-language/index.html') {
    const keys=['finder','i693','medreq'];
    return finish(spec, {
      title:'Finding a USCIS Civil Surgeon Who Speaks Your Language',
      description:'How to combine the official USCIS civil surgeon locator with language needs, and what to arrange when no designated physician speaks your language.',
      answer:'Start from the official USCIS civil surgeon locator, because designation — not language — is the requirement that cannot be waived. Language is then arranged around that list: call the designated offices in your area and ask which languages the clinical staff speak, and if none matches, ask the office what interpreter arrangements they accept for the examination.',
      checklist:['Build your shortlist from the official USCIS civil surgeon listing first.','Call each office and ask which languages the examining physician and clinical staff speak.','If no designated office matches your language, ask what interpreter arrangements the office accepts.','Ask whether the office requires the interpreter to be an adult, or a professional rather than a family member.','Confirm the language arrangement when you book, not when you arrive.'],
      red_flags:['A non-designated clinic is recommended because it speaks your language — designation is not negotiable.','An office says an interpreter is unnecessary when you cannot follow the medical history questions.','A child is proposed as the interpreter for a medical examination.','Language is arranged only verbally and is not confirmed at booking.'],
      authority_source_ids:ids(keys), authority_urls:urls(keys),
      artifacts:[
        {type:'checklist',title:'Order of Operations',items:['Designation first: search the official USCIS civil surgeon listing for your area.','Language second: call the designated offices on that list and ask about languages spoken.','Interpretation third: if no match, ask each office what interpreter arrangement it accepts.','Confirm at booking, and ask what to bring so the medical history can be taken accurately.']},
        {type:'comparison_table',title:'Ways to Cover a Language Gap',headers:['Option','What to confirm with the office'],rows:[
          ['A designated office with staff who speak your language','That the examining physician, not only reception, can take the history in that language.'],
          ['An interpreter the clinic provides or arranges','Whether it must be booked in advance and whether a separate charge applies.'],
          ['An interpreter you bring','Any office rules on who may interpret, including age and relationship restrictions.'],
          ['Translated records you bring','Whether translations of vaccination or medical records are accepted, and in what form.']
        ]},
        {type:'callout',title:'Designation Is the Constraint, Language Is the Preference',items:['A physician who speaks your language but is not a currently designated civil surgeon cannot complete Form I-693 for adjustment of status. Choose from the designated list, then solve language within it.']},
        {type:'source_block',title:'Primary Sources',sources:sources(keys),reviewed_date:'2026-07-24',recheck_date:'2026-08-24'}
      ]
    });
  }

  if (p === 'uscis-medical/community-questions/how-to-verify-a-civil-surgeon-is-authorized-by-uscis/index.html') {
    const keys=['finder','medreq','i693'];
    return finish(spec, {
      title:'How to Verify a Civil Surgeon Is Currently Authorized by USCIS',
      description:'A verification procedure for confirming a physician’s current USCIS civil surgeon designation, and what evidence is not proof.',
      answer:'Verify through the official USCIS civil surgeon process rather than through anything the clinic supplies. A designation is specific to a physician and can change over time, so what matters is that the physician you will actually see is listed as currently designated — not that the practice was designated at some point, and not that a certificate is displayed on the wall.',
      checklist:['Look the physician up through the official USCIS civil surgeon listing.','Match the individual physician’s name, not only the clinic name.','Confirm the designation is current as of today.','Ask the office to confirm that the listed physician is the one who will examine and sign.','Record the date and method of your verification.'],
      red_flags:['A wall certificate, screenshot, or brochure is offered in place of verification through USCIS.','The clinic is listed but the physician who will actually examine you is not.','The office will not say which physician signs the form.','A designation is described as pending, renewing, or recently lapsed.'],
      authority_source_ids:ids(keys), authority_urls:urls(keys),
      artifacts:[
        {type:'protocol',title:'Verification Procedure',items:['Search the official USCIS civil surgeon listing for your area.','Find the individual physician by name, not just the practice.','Confirm the entry is current rather than a cached or historical result.','Telephone the office and confirm that physician performs and signs Form I-693 examinations.','Note the date you verified, and keep it with your immigration records.']},
        {type:'comparison_table',title:'What Counts as Proof',headers:['Evidence','Does it verify current designation?'],rows:[
          ['The physician appears in the official USCIS civil surgeon listing today','Yes — this is the verification USCIS provides.'],
          ['A framed certificate in the waiting room','No — it shows nothing about current status.'],
          ['A state medical licence lookup','No — licensure and USCIS designation are different things.'],
          ['A review site or directory listing the clinic as “USCIS approved”','No — third-party directories are not the designation record.']
        ]},
        {type:'callout',title:'Verify the Physician, Not the Practice',items:['USCIS designates individual physicians. A practice with one designated physician does not make every physician in that practice able to certify Form I-693, so confirm the name of the doctor who will examine you.']},
        {type:'source_block',title:'Primary Sources',sources:sources(keys),reviewed_date:'2026-07-24',recheck_date:'2026-08-24'}
      ]
    });
  }

  if (p === 'uscis-medical/community-questions/list-of-items-to-bring-to-uscis-medical-exam-appointment/index.html') {
    const keys=['i693','vaccines','cdc'];
    return finish(spec, {
      title:'What to Bring to the USCIS Medical Exam Appointment',
      description:'What to gather before an I-693 appointment, why the vaccination record matters most, and how to confirm the list with the specific civil surgeon office.',
      answer:'Bring government-issued photo identification, your complete vaccination records, any relevant medical history including past tuberculosis testing or treatment, a list of current medications, and whatever the civil surgeon office told you to bring when you booked. The vaccination record is the item that most often decides whether the appointment can be completed in one visit, because missing documentation may mean vaccines are administered or the review is deferred.',
      checklist:['Government-issued photo identification.','Complete written vaccination records, including records from other countries.','Records of any previous tuberculosis testing, treatment, or chest imaging.','A list of current medications and known medical conditions.','The office’s own pre-appointment instructions, plus its payment method.'],
      red_flags:['An office publishes no pre-appointment instruction list at all.','You are told vaccination records are unnecessary before the record has been reviewed.','You are advised to leave existing TB testing history at home.','The list you were given is generic and was never confirmed for your appointment.'],
      authority_source_ids:ids(keys), authority_urls:urls(keys),
      artifacts:[
        {type:'checklist',title:'Bring to the Appointment',items:['Photo identification.','Vaccination records — the full history, including doses received abroad.','Prior tuberculosis test results, treatment records, or chest X-ray reports.','A written list of current medications and diagnoses.','Any documentation the office specifically requested when you booked.','The payment method the office accepts.']},
        {type:'decision_matrix',title:'Why Each Item Matters',headers:['What you bring','What it prevents'],rows:[
          ['Complete vaccination records','Repeat doses, a deferred review, or a second appointment.'],
          ['Prior TB testing and treatment history','Repeat testing, and confusion over an earlier positive result.'],
          ['Photo identification','An appointment that cannot proceed at check-in.'],
          ['Medication and condition list','An incomplete medical history on the form.'],
          ['The office’s own instructions','Arriving without something only that office requires.']
        ]},
        {type:'callout',title:'Confirm the List With Your Own Office',items:['Requirements vary between civil surgeon offices, and the office you booked is the authority on what its appointment needs. Ask for its list when you book, and treat any general list as a starting point rather than a substitute.']},
        {type:'source_block',title:'Primary Sources',sources:sources(keys),reviewed_date:'2026-07-24',recheck_date:'2026-08-24'}
      ]
    });
  }

  if (p === 'uscis-medical/guides/can-i-use-an-old-i-693-for-a-new-green-card-application/index.html') {
    const keys=['validity','sealed','i693'];
    return finish(spec, {
      title:'Can You Reuse an Old I-693 for a New Green Card Application?',
      description:'What happens to a previously completed Form I-693 when the application it supported ends, and what to check before reusing it on a new filing.',
      answer:'Usually not, and the reason is not age. Under the June 11, 2025 USCIS policy update, a properly completed Form I-693 signed on or after November 1, 2023 generally remains valid only while the benefit application it was submitted with is pending. Once that application is withdrawn, rejected, or denied, USCIS may require a new examination and a new sealed form for the later filing — so the question to answer is what happened to the earlier case, not how old the form is.',
      checklist:['Establish what happened to the application the earlier I-693 was filed with.','Find the civil surgeon signature date on your copy.','Check whether the sealed USCIS copy still exists, unopened, in your possession.','Ask whether USCIS returned or retained the earlier form.','Confirm the current rule on the USCIS Form I-693 page before assuming reuse is possible.'],
      red_flags:['Reuse is assumed simply because the form is recent.','The sealed envelope was opened to check what was inside.','A prior denial or withdrawal is treated as irrelevant to the medical evidence.','Advice about reuse is taken from a source that predates the June 11, 2025 update.'],
      authority_source_ids:ids(keys), authority_urls:urls(keys),
      artifacts:[
        {type:'decision_matrix',title:'Can the Earlier Form Be Reused?',headers:['What happened to the earlier application','What to expect'],rows:[
          ['Still pending, and you are not refiling','The form generally remains valid with that pending application; nothing needs redoing on time grounds alone.'],
          ['Withdrawn by you','Treat a new examination as likely required for the new filing; confirm before filing.'],
          ['Rejected or denied','USCIS may require a new examination and a new sealed I-693 for the new application.'],
          ['You never filed the form with any application','Check the signature date and the current rule before relying on it.']
        ]},
        {type:'checklist',title:'Before You Rely on an Old Form',items:['Confirm the status of the application it was originally filed with.','Confirm the sealed USCIS copy is intact and unopened.','Confirm the signature date and which policy period applies to it.','Ask the civil surgeon office what it would take to obtain a fresh sealed form if one is needed.','Verify against the current USCIS Form I-693 page rather than an older answer.']},
        {type:'callout',title:'Never Open the Sealed Envelope to Check',items:['The sealed copy is prepared for USCIS. Opening it to inspect the contents can make the form unusable, and your personal copy is what you should be reading instead.']},
        {type:'source_block',title:'Primary Sources',sources:sources(keys),reviewed_date:'2026-07-24',recheck_date:'2026-08-24'}
      ]
    });
  }

  if (p === 'uscis-medical/guides/do-i-have-to-get-undressed-for-the-uscis-physical-exam/index.html') {
    const keys=['cdc','i693','medreq'];
    return finish(spec, {
      title:'Do You Have to Undress for the USCIS Physical Exam?',
      description:'What the immigration medical examination physically involves, why partial undressing may be needed, and what you can ask for regarding privacy.',
      answer:'Partial undressing is often necessary, because the civil surgeon must perform a physical examination following CDC technical instructions rather than a paperwork review. What that involves in practice varies with your age, medical history, and findings. You can ask the office in advance what its examination involves, and you can ask about privacy accommodations such as a gown, a chaperone, or a same-sex examiner.',
      checklist:['Ask the office in advance what its physical examination involves.','Ask whether a gown is provided and what clothing to wear.','Ask whether a chaperone can be present during the examination.','Ask whether a same-sex examiner or chaperone can be arranged.','Raise any concern before the appointment rather than at the examination itself.'],
      red_flags:['An office refuses to describe what its examination involves before you arrive.','A chaperone is refused without explanation.','You are told there is no physical examination at all — the exam is not a records review.','You are pressured to proceed while a stated concern is unresolved.'],
      authority_source_ids:ids(keys), authority_urls:urls(keys),
      artifacts:[
        {type:'callout',title:'It Is a Real Physical Examination',items:['The civil surgeon examines you under CDC technical instructions, not from your paperwork alone. That is why some undressing may be required, and why the extent varies with age, history, and clinical findings.']},
        {type:'checklist',title:'Questions to Ask When You Book',items:['What does your physical examination involve?','Is a gown provided, and what should I wear?','May I have a chaperone present?','Can a same-sex examiner or chaperone be arranged?','How long should I expect the appointment to take?']},
        {type:'comparison_table',title:'Privacy Requests You Can Make',headers:['Request','Why offices are usually able to accommodate it'],rows:[
          ['A gown rather than fully removing clothing','Standard clinical practice in most examination settings.'],
          ['A chaperone in the room','A common clinical safeguard; ask when booking so staffing can be arranged.'],
          ['A same-sex examiner or chaperone','May depend on which physicians the office has available on that day.'],
          ['An explanation before each step','Reasonable to expect, and easier to arrange if raised at booking.']
        ]},
        {type:'source_block',title:'Primary Sources',sources:sources(keys),reviewed_date:'2026-07-24',recheck_date:'2026-08-24'}
      ]
    });
  }

  if (p === 'uscis-medical/guides/form-i-693-medical-exam-cost/index.html') {
    const keys=['i693','i485','finder'];
    return finish(spec, {
      title:'Form I-693 Cost: The Clinic Fee and the USCIS Filing Fee Are Not the Same Thing',
      description:'Separating the civil surgeon’s clinic charge from USCIS filing fees, and what the quoted I-693 price does and does not cover.',
      answer:'There are two different money questions and they are constantly confused. The civil surgeon’s charge for performing the examination and completing Form I-693 is set by that clinic, not by USCIS, and USCIS publishes no national price for it. Separately, USCIS filing fees are set by USCIS and are published on its form pages — check the current fee for the application you are filing rather than assuming the medical exam carries one.',
      checklist:['Treat the clinic charge and any USCIS filing fee as two separate questions.','Ask the civil surgeon office for its charge in writing, itemised.','Ask specifically what is bundled and what is billed afterwards.','Check current USCIS fees on the official form page for the application you are filing.','Do not treat any quoted figure as a government-set national price.'],
      red_flags:['A clinic presents its own price as a USCIS-set fee.','A quote does not distinguish the examination from testing and vaccinations.','A price is quoted without saying what happens if additional testing is required.','A source states a single nationwide figure as the cost of the exam.'],
      authority_source_ids:ids(keys), authority_urls:urls(keys),
      artifacts:[
        {type:'comparison_table',title:'Two Different Charges',headers:['','Civil surgeon clinic charge','USCIS filing fee'],rows:[
          ['Who sets it','The individual clinic','USCIS'],
          ['Is there a published national figure','No','Yes — on the official USCIS form page'],
          ['What it pays for','The examination, testing, vaccinations, and completing the form','Adjudication of the immigration application you file'],
          ['Where to confirm it','In writing from the office, before booking','On the current USCIS page for that form']
        ]},
        {type:'cost_table',title:'What to Get Itemised in Writing',headers:['Line item','What to ask'],rows:[
          ['Examination and form completion','Is completing and sealing Form I-693 included in the quoted figure?'],
          ['Required laboratory testing','Which tests are in the price and which are billed separately?'],
          ['Vaccinations and record review','Is reviewing the record included, and are any needed vaccines extra?'],
          ['Additional testing if findings require it','What happens to the price if follow-up testing or imaging is needed?'],
          ['Corrections or a replacement sealed form','Is there a charge if the form must be corrected or reissued?']
        ]},
        {type:'callout',title:'Insurance Is a Third Question Again',items:['Whether a health plan covers any part of the examination, laboratory work, or vaccinations is specific to that plan and that service. Verify each charge with the clinic and the insurer separately rather than assuming coverage.']},
        {type:'source_block',title:'Primary Sources',sources:sources(keys),reviewed_date:'2026-07-24',recheck_date:'2026-08-24'}
      ]
    });
  }

  if (p === 'uscis-medical/guides/i-693-medical-exam-for-adjustment-of-status-timeline/index.html') {
    const keys=['i693','i485','validity'];
    return finish(spec, {
      title:'Where the I-693 Fits in the Adjustment of Status Timeline',
      description:'How the medical examination sequences against the Form I-485 filing, and why the old 60-day signature rule no longer drives the timing.',
      answer:'The I-693 can be filed together with Form I-485 or provided later in response to a USCIS request, and current USCIS instructions — not the superseded 60-day signature rule — govern when it should be submitted. Because a form signed on or after November 1, 2023 no longer carries a fixed expiration period but is tied to the pending application, the timing question is about the filing instructions and any notice you receive, not about racing a countdown.',
      checklist:['Read the current filing instructions on the USCIS Form I-693 page before scheduling.','Decide whether you are filing the form with the I-485 or supplying it later.','Book the civil surgeon appointment with enough margin for follow-up testing.','Keep the sealed form intact until it is filed.','If USCIS requests the form, follow that notice’s instructions and deadline exactly.'],
      red_flags:['Timing advice relies on the removed 60-day civil surgeon signature rule.','An exam is rushed to beat an expiration period that no longer applies to the form.','A notice from USCIS is answered on a general timeline rather than the deadline it states.','The sealed form is opened while waiting to file.'],
      authority_source_ids:ids(keys), authority_urls:urls(keys),
      artifacts:[
        {type:'timeline_table',title:'Sequencing the Medical Exam',headers:['Stage','What happens','What to verify'],rows:[
          ['Before booking','You read the current Form I-693 filing instructions.','Whether you will file the form with the I-485 or later.'],
          ['The appointment','The civil surgeon examines you and orders any required testing.','How long the office needs to complete and seal the form.'],
          ['Follow-up','Any required testing, imaging, or vaccination is completed.','Whether follow-up is needed before the form can be finalised.'],
          ['Filing','The sealed form is submitted per current USCIS instructions.','That the envelope is unopened and filed as instructed.'],
          ['After filing','USCIS may issue a notice or request about the medical evidence.','The specific deadline and instructions on that notice.']
        ]},
        {type:'callout',title:'The 60-Day Rule Is Gone',items:['USCIS removed the former requirement tying the civil surgeon’s signature date to a 60-day filing window. Timeline advice that still depends on it is out of date, and following it can cause an unnecessary repeat examination.']},
        {type:'checklist',title:'Build Margin Into the Schedule',items:['Ask the office how long it takes to return the completed sealed form.','Ask what happens to the timeline if follow-up testing is required.','Ask whether missing vaccination records would extend the process.','Do not schedule on the assumption that one visit always completes the exam.']},
        {type:'source_block',title:'Primary Sources',sources:sources(keys),reviewed_date:'2026-07-24',recheck_date:'2026-08-24'}
      ]
    });
  }

  if (p === 'uscis-medical/guides/i-693-medical-exam-for-children-immigration-requirements/index.html') {
    const keys=['vaccines','tb','cdc'];
    return finish(spec, {
      title:'The I-693 Medical Exam for Children: What Is Different by Age',
      description:'How the immigration medical examination differs for children, including the age threshold for TB blood testing and how age-appropriate vaccination is assessed.',
      answer:'A child’s examination follows the same CDC technical instructions as an adult’s, but several requirements are age-dependent. Tuberculosis screening by IGRA blood test applies to applicants age 2 or older, and vaccination requirements are assessed against what is age-appropriate for that child rather than against a single fixed list — which is why a complete childhood immunisation record is the most valuable thing to bring.',
      checklist:['Bring the child’s complete immunisation record, including doses given in another country.','Expect TB screening rules to depend on the child’s age.','Ask the office in advance what it needs for a child’s appointment.','Bring records of any chronic condition, specialist care, or prior TB testing.','Ask whether any needed vaccines can be given at the visit or must be arranged separately.'],
      red_flags:['A child’s vaccination record is treated as unnecessary.','An age-based requirement is applied without asking the child’s age.','A single adult checklist is applied to a young child without adjustment.','A prior positive TB test in an older child is dismissed without the required follow-up.'],
      authority_source_ids:ids(keys), authority_urls:urls(keys),
      artifacts:[
        {type:'decision_matrix',title:'What Changes With the Child’s Age',headers:['Age','What to expect under CDC technical instructions'],rows:[
          ['Under 2 years','TB screening by IGRA blood test is not required on the same basis as for older applicants; vaccination is assessed against what is age-appropriate.'],
          ['Age 2 or older','An IGRA blood test is required for TB screening; a positive result requires a chest X-ray and further evaluation.'],
          ['Any age','Vaccination requirements are assessed against the age-appropriate schedule, not a single fixed list.'],
          ['Any age, with a chronic condition','Bring specialist records; the civil surgeon may need them to complete the form.']
        ]},
        {type:'checklist',title:'Bring for a Child’s Appointment',items:['The complete immunisation record, including overseas doses.','Records of any previous TB testing or treatment.','Details of chronic conditions, specialist care, and current medications.','Photo identification for the child as the office requires.','Whatever that specific civil surgeon office asked for when you booked.']},
        {type:'callout',title:'The Immunisation Record Does the Most Work',items:['Age-appropriate vaccination is judged from documentation. A complete written record is what prevents repeat doses, a deferred review, or a second appointment for a child.']},
        {type:'source_block',title:'Primary Sources',sources:sources(keys),reviewed_date:'2026-07-24',recheck_date:'2026-08-24'}
      ]
    });
  }

  if (p === 'uscis-medical/guides/i-693-medical-exam-requirements-checklist/index.html') {
    const keys=['i693','medreq','cdc'];
    return finish(spec, {
      title:'I-693 Medical Exam Requirements: The Full Checklist',
      description:'The complete set of requirements the I-693 examination has to satisfy, organised by who is responsible for each one.',
      answer:'The requirements split cleanly by who owns them. You are responsible for using a currently designated civil surgeon, bringing documentation, and filing the sealed form under current instructions. The civil surgeon is responsible for examining you under CDC technical instructions, completing the current edition of Form I-693, certifying it, and sealing it. Confusing the two is what produces most avoidable problems.',
      checklist:['Use a currently designated civil surgeon, verified through USCIS.','Bring identification, vaccination records, and relevant medical history.','Complete any required testing, imaging, or vaccination the exam identifies.','Receive the sealed form and keep it unopened.','File under the current USCIS instructions and respond to any notice exactly.'],
      red_flags:['A requirement is assumed from an old edition of the form or an outdated summary.','The sealed envelope is opened before filing.','Required follow-up is skipped so the form can be filed sooner.','The physician is not verified as currently designated.'],
      authority_source_ids:ids(keys), authority_urls:urls(keys),
      artifacts:[
        {type:'comparison_table',title:'Who Is Responsible for What',headers:['Requirement','Yours','The civil surgeon’s'],rows:[
          ['Using a currently designated civil surgeon','Verify the designation before booking','Hold and maintain the USCIS designation'],
          ['Documentation','Bring identification, vaccination, and medical records','Review what you bring and record it on the form'],
          ['The examination itself','Attend and complete required follow-up','Examine you under CDC technical instructions'],
          ['The form','Keep your copy and keep the USCIS copy sealed','Complete the current edition, certify, and seal it'],
          ['Filing','File under current USCIS instructions','Not the clinic’s responsibility']
        ]},
        {type:'checklist',title:'Before the Appointment',items:['Verify the civil surgeon’s current designation through USCIS.','Gather identification, full vaccination records, and TB history.','Ask the office for its own pre-appointment requirements.','Confirm what the quoted charge includes.']},
        {type:'checklist',title:'After the Appointment',items:['Confirm any required follow-up testing or vaccination is complete.','Collect the sealed USCIS copy and keep it unopened.','Keep your own copy and read it for obvious omissions.','File under the current USCIS instructions, and answer any notice on its own deadline.']},
        {type:'source_block',title:'Primary Sources',sources:sources(keys),reviewed_date:'2026-07-24',recheck_date:'2026-08-24'}
      ]
    });
  }

  if (p === 'uscis-medical/guides/uscis-civil-surgeon-near-me/index.html') {
    const keys=['finder','i693'];
    return finish(spec, {
      title:'Searching for a Civil Surgeon Near You: How the USCIS Locator Works',
      description:'How to run and read a USCIS civil surgeon locator search, what the results do and do not tell you, and when to widen the radius.',
      answer:'Use the official USCIS Find a Civil Surgeon tool and search by location. The results tell you which physicians hold the designation and where they are listed — they do not tell you a clinic’s current appointment availability, price, or languages. Treat the search result as the shortlist, and settle everything else by telephoning the offices on it.',
      checklist:['Search the official USCIS locator by your location.','Widen the search radius if few results appear nearby.','Read each result as a designation record, not an availability or price listing.','Telephone the offices on the shortlist to confirm availability and requirements.','Re-check the listing if any result looks stale before you book.'],
      red_flags:['A directory that is not the official USCIS tool is used as the source of truth.','A search result is treated as confirmation that the office has appointments.','A price or wait time is inferred from the listing itself.','Only one result is contacted, with no fallback if that office cannot see you.'],
      authority_source_ids:ids(keys), authority_urls:urls(keys),
      artifacts:[
        {type:'protocol',title:'Running the Search',items:['Open the official USCIS Find a Civil Surgeon tool.','Search by your location, and note the radius the tool applied.','Widen the radius if the nearby result count is low.','Record the physician names, not just the clinic names.','Contact several offices rather than only the closest one.']},
        {type:'comparison_table',title:'What the Search Result Tells You',headers:['Question','Answered by the locator?'],rows:[
          ['Is this physician designated by USCIS','Yes — that is what the listing records.'],
          ['Does the office have appointments soon','No — call the office.'],
          ['What will it cost','No — ask the office for a written itemised quote.'],
          ['What languages are spoken','No — ask the office.'],
          ['What to bring to the appointment','No — ask the office for its own list.']
        ]},
        {type:'checklist',title:'Turning the Shortlist Into a Booking',items:['Call each shortlisted office and confirm it performs Form I-693 examinations.','Ask about the next available appointment and about total expected turnaround.','Ask for the charge in writing and what it includes.','Ask for that office’s pre-appointment document list.','Keep a second option, in case the first office cannot complete the exam in time.']},
        {type:'source_block',title:'Primary Sources',sources:sources(keys),reviewed_date:'2026-07-24',recheck_date:'2026-08-24'}
      ]
    });
  }

  if (p === 'uscis-medical/guides/what-happens-at-the-i-693-medical-exam-step-by-step/index.html') {
    const keys=['cdc','tb','i693'];
    return finish(spec, {
      title:'What Happens at the I-693 Medical Exam, Step by Step',
      description:'The sequence of an immigration medical examination appointment, from check-in through the sealed form, and where the process can pause.',
      answer:'The appointment moves through check-in and identity verification, a medical history, a physical examination performed under CDC technical instructions, required testing such as tuberculosis screening, a vaccination record review with any needed doses, and finally completion and sealing of Form I-693. It does not always finish in one visit: testing results, imaging, or missing vaccination records can pause the process before the form can be certified.',
      checklist:['Bring identification, vaccination records, and medical history to check-in.','Expect a medical history to be taken before the physical examination.','Expect required testing based on your age and findings.','Expect the vaccination record to be reviewed and gaps addressed.','Expect the sealed form only once every required step is complete.'],
      red_flags:['A form is certified before required testing results are back.','No physical examination is performed at all.','The vaccination record is not reviewed.','The sealed envelope is handed over opened, or you are told to open it.'],
      authority_source_ids:ids(keys), authority_urls:urls(keys),
      artifacts:[
        {type:'protocol',title:'The Appointment, in Order',items:['Check-in and identity verification.','Medical history, including medications, conditions, and prior TB testing.','Physical examination under CDC technical instructions.','Required testing, including tuberculosis screening as your age and findings require.','Vaccination record review, and any doses needed to meet requirements.','Completion, certification, and sealing of Form I-693 once every step is finished.']},
        {type:'decision_matrix',title:'Where the Process Can Pause',headers:['What comes up','What typically happens next'],rows:[
          ['Testing results are not back yet','The form is not certified until results are available.'],
          ['A screening result requires imaging or further evaluation','That evaluation must be completed before the exam can be finalised.'],
          ['Vaccination records are incomplete','Doses may be given, or the review deferred until records are produced.'],
          ['A finding needs a public-health referral','The referral must be resolved before certification.']
        ]},
        {type:'callout',title:'One Visit Is Not Guaranteed',items:['Plan for the possibility of a second visit. Testing, imaging, and vaccination gaps are ordinary parts of this examination, not signs that something has gone wrong.']},
        {type:'source_block',title:'Primary Sources',sources:sources(keys),reviewed_date:'2026-07-24',recheck_date:'2026-08-24'}
      ]
    });
  }

  if (p === 'uscis-medical/guides/what-vaccines-are-required-for-the-uscis-medical-exam/index.html') {
    const keys=['vaccines','cdc','medreq'];
    return finish(spec, {
      title:'Which Vaccines Are Required for the USCIS Medical Exam?',
      description:'How vaccination requirements for the immigration medical exam are actually determined, why the list is not fixed, and what documentation decides the outcome.',
      answer:'There is no single fixed list that applies to everyone. The civil surgeon assesses vaccination against the CDC vaccination technical instructions, applied to what is age-appropriate and medically appropriate for you — and requirements have changed over time, including the removal of the COVID-19 vaccination requirement. Because the assessment is made from documentation, a complete written vaccination record is what most determines whether you need further doses.',
      checklist:['Bring your complete written vaccination history, including doses given abroad.','Expect the assessment to be based on what is age-appropriate for you.','Ask the office which required vaccines it can administer at the visit.','Ask what happens if records are missing or incomplete.','Check the current CDC technical instructions rather than an older list.'],
      red_flags:['A fixed universal vaccine list is presented as current without reference to age or medical appropriateness.','A source still lists the COVID-19 vaccination as required.','Missing records are treated as equivalent to no vaccinations without discussion.','A clinic will not say which vaccines it can give on site.'],
      authority_source_ids:ids(keys), authority_urls:urls(keys),
      artifacts:[
        {type:'callout',title:'The List Is Not Fixed',items:['Vaccination requirements for the immigration medical exam are assessed under the CDC vaccination technical instructions against what is age-appropriate and medically appropriate for the individual, and those instructions have changed over time — including the removal of the COVID-19 vaccination requirement. Check the current instructions rather than an older summary.']},
        {type:'decision_matrix',title:'What Your Records Decide',headers:['What you can document','What usually follows'],rows:[
          ['A complete, dated vaccination record','The civil surgeon assesses against it; fewer doses are typically needed.'],
          ['Partial records','Missing items may be given at the visit, or the review deferred until records are found.'],
          ['No records at all','Expect the assessment to proceed as though undocumented doses were not given.'],
          ['Records in another language','Ask the office in advance whether a translation is required and in what form.'],
          ['A documented medical contraindication','Discuss it with the civil surgeon, who records how the requirement is addressed.']
        ]},
        {type:'checklist',title:'Before the Appointment',items:['Collect every vaccination record you can obtain, including from other countries.','Ask the office whether translations of foreign records are needed.','Ask which required vaccines the office can administer on site.','Ask whether any needed vaccine is billed separately from the exam.','Confirm requirements against the current CDC vaccination technical instructions.']},
        {type:'source_block',title:'Primary Sources',sources:sources(keys),reviewed_date:'2026-07-24',recheck_date:'2026-08-24'}
      ]
    });
  }

  // Promoted on 2026-09-11, and a genuinely different question from
  // what-vaccines-are-required-for-the-uscis-medical-exam. That page answers which
  // vaccines are assessed; this one answers what happens when the documentation is
  // not there, which is a separate decision with separate evidence - titers,
  // re-vaccination, foreign records, and the two waiver routes. Recording it as
  // NEAR_DUPLICATE_OF_GROUNDED_ROUTE would have been the cheap move and the wrong
  // one: a named stop is for a route grounding would be wrong for, not a route
  // grounding is merely more work for.
  if (p === 'uscis-medical/guides/what-if-i-am-missing-vaccine-records-for-uscis-medical-exam/index.html') {
    const keys=['vaccines','cdc','i693','medreq'];
    return finish(spec, {
      title:'What If I Am Missing Vaccine Records for the USCIS Medical Exam?',
      description:'What a civil surgeon does when vaccination documentation is incomplete or unavailable, which alternatives to a written record are recognised, and how to prepare so a records gap does not become a delay.',
      answer:'Missing records do not stop the exam; they change what happens at it. Vaccination is assessed from documentation, so where a written record cannot be produced the civil surgeon works from what can be evidenced instead — commonly serologic testing showing immunity, or administering the doses at the visit. Confirm the current approach for your situation against the CDC vaccination technical instructions for civil surgeons, because what is acceptable evidence is set there rather than by the clinic.',
      checklist:['Request records from every source before the appointment: prior clinics, schools, employers, state or national immunisation registries, and health authorities in any country you have lived in.','Ask the civil surgeon\'s office, in advance, whether blood testing for immunity is offered and for which vaccines.','Ask whether foreign-language records need translation and in what form.','Ask which vaccines the office can administer on site and what each is billed at, separately from the exam fee.','Ask what the office does when a record is partial rather than absent.','Check the current CDC vaccination technical instructions rather than an older summary.'],
      red_flags:['You are told missing records automatically mean starting the whole schedule again, with no discussion of testing or partial credit.','The office will not say which vaccines it can administer or what they cost until you are in the chair.','Serologic testing is presented as available for every vaccine, or as available for none.','A clinic claims it can waive a requirement itself. Waivers are decided by USCIS on the appropriate form, not by the examining physician.','Requirements are quoted from a fixed list with no reference to what is age-appropriate and medically appropriate for you.'],
      authority_source_ids:ids(keys), authority_urls:urls(keys),
      artifacts:[
        {type:'callout',title:'A Records Gap Is an Ordinary Event',items:['Incomplete vaccination documentation is a routine part of immigration medical examinations, not a disqualification. What it changes is the evidence the civil surgeon works from, and possibly whether more than one visit is needed. Undocumented doses are generally assessed as though they were not given, which is why obtaining the record — or evidence in place of it — is worth the effort before the appointment.']},
        {type:'decision_matrix',title:'What You Can Evidence, and What Usually Follows',headers:['Your situation','What the civil surgeon generally works from','What to ask before the visit'],rows:[
          ['Complete, dated written record','The record itself; only gaps against what is age-appropriate are addressed.','Whether any dose is now out of date.'],
          ['Partial record','The documented doses, plus whatever is needed to close the gap.','Whether the remaining doses can be given on site.'],
          ['No record, but you believe you were vaccinated','Serologic testing is commonly used to evidence immunity for several vaccines; where immunity cannot be shown, doses are given.','Whether the office draws titers, for which vaccines, and at what cost.'],
          ['Records exist abroad or in another language','The record once it is produced, subject to the office\'s translation requirements.','Whether a translation is required and in what form.'],
          ['A medical reason not to vaccinate','A documented contraindication, recorded by the civil surgeon.','Bring the documenting clinician\'s letter.'],
          ['A religious or moral objection to vaccination','Not a matter for the civil surgeon: this is a waiver decided by USCIS.','Which form applies to your category, and its timing.']
        ]},
        {type:'checklist',title:'Before the Appointment',items:['Contact prior clinics, schools, employers and any state or national immunisation registry that may hold your record.','Request records from health authorities in every country you have lived in, allowing time for the reply.','Ask the office whether it offers blood testing for immunity, and for which vaccines.','Ask which vaccines it can administer on the day, and the cost of each.','Ask whether a second visit is likely in your situation, and what would trigger it.','Bring any partial record you do have rather than leaving it behind because it is incomplete.']},
        {type:'callout',title:'Waivers Are Decided by USCIS, Not the Clinic',items:['Two situations are handled by waiver rather than by the examining physician: a documented medical contraindication, and a religious or moral objection to vaccination. A clinic cannot grant either. Confirm on the USCIS pages for Form I-693 and your immigration category which form applies and when it must be filed, because filing it late is a common source of delay.']},
        {type:'source_block',title:'Primary Sources',sources:sources(keys),reviewed_date:'2026-07-24',recheck_date:'2026-08-24'}
      ]
    });
  }

  return null;
}

module.exports = { authorityGroundedEntryForSpec };
