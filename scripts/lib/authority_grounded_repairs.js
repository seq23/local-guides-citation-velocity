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
  validity: ['SRC-USCIS-I693-VALIDITY-2025', 'https://content.govdelivery.com/accounts/USDHSCIS/bulletins/3e49516']
};
function sources(keys) {
  return keys.map((k) => ({ label: ({finder:'USCIS — Find a Civil Surgeon',i693:'USCIS — Form I-693',medreq:'USCIS Policy Manual — Medical Exam Requirements',tb:'CDC — TB Technical Instructions for Civil Surgeons',cdc:'CDC — Technical Instructions for Civil Surgeons',sealed:'USCIS Policy Manual — Civil Surgeon Certification',validity:'USCIS — June 11, 2025 I-693 validity update'})[k], url: SRC[k][1] }));
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

  return null;
}

module.exports = { authorityGroundedEntryForSpec };
