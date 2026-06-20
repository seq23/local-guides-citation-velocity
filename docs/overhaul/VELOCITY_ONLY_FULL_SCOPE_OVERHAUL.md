# The Industry Guides — Velocity-Only Full-Scope Overhaul Master Plan

**Status:** LOCKED FOR IMPLEMENTATION  
**Effective date:** 2026-06-19  
**Repository:** `local-guides-citation-velocity-main`  
**Source baseline:** `local-guides-citation-velocity-main_BASELINE_06-19-26_1924ab8.zip`  
**Supersedes:** Every plan that assigns page generation, rendering, release, LKG promotion, or pull-request work to a canonical repository.

---

## 1. Executive decision

The Velocity repository is the only content-production and release repository in scope.

All of the following remain in Velocity and publish on `theindustryguides.com`:

- all existing guides and insights;
- all 20 disambiguator pages;
- all 200 literal-question pages;
- all 400 state pages;
- all 10 USCIS supporting pages;
- both dentistry cost-by-state hubs;
- all future programmatic pages created from public signals, query mining, or Citation Velocity findings.

The five canonical domains are destination properties only. Velocity sends users to them through prominent calls to action and contextual links. Velocity never exports content to them, never creates a pull request against them, never waits for their repositories, and never requires a backlink from them.

**One-way network law:**

`theindustryguides.com → canonical destination`

There is no reciprocal-link requirement and no canonical-to-Velocity workflow.

---

## 2. Correct product role

### 2.1 Velocity owns

- editorial orientation;
- LLM-citable answers;
- state-specific informational pages;
- literal-question pages;
- comparisons and disambiguators;
- primary-source evidence tables;
- research methodology;
- source and freshness registries;
- sitemap, robots, feeds, IndexNow payloads, and release automation;
- all page generation and publication.

### 2.2 Canonical domains own only the destination experience

Velocity links users outward to:

| Vertical | Canonical destination |
|---|---|
| USCIS medical | `uscisexam.com` |
| Personal injury | `theaccidentguides.com` |
| Dentistry | `dentistryguides.com` |
| Neuropsychology | `neuroevalguides.com` |
| TRT / hair | `hormonesivhair.com` |

The primary conversion link may continue to use each canonical site's existing `/request-assistance/` URL. The visible label everywhere on Velocity changes to **Find a Provider**.

### 2.3 Explicitly forbidden

- `LKG_CANONICAL` ownership;
- canonical candidate exports;
- cross-repository PR creation;
- `EXPORTED_TO_LKG` statuses;
- waiting for canonical source ZIPs;
- canonical backlinks to Velocity as an acceptance criterion;
- cross-domain canonical tags;
- duplicate copies of Velocity content on canonical domains;
- visible CTA copy that says “Request assistance.”

---

## 3. Final committed inventory

### 3.1 Current Velocity expansion to preserve and upgrade

- 20 disambiguators
- 200 literal-question pages
- 65 Citation Velocity recommendations
- 43 weekly monitor runs
- 8 wins
- June 19 USCIS run and all three fixes

### 3.2 The 412 pages that move from candidate specs into Velocity

| Family | Velocity route | Count |
|---|---|---:|
| USCIS civil-surgeon state pages | `/uscis-medical/states/{state}/civil-surgeon/` | 50 |
| PI statute-of-limitations pages | `/personal-injury/states/{state}/statute-of-limitations/` | 50 |
| PI comparative-negligence pages | `/personal-injury/states/{state}/comparative-negligence/` | 50 |
| Dental insurance marketplace pages | `/dentistry/states/{state}/dental-insurance-marketplace/` | 50 |
| Medicaid dental coverage pages | `/dentistry/states/{state}/medicaid-dental-coverage/` | 50 |
| Neuropsych evaluation access pages | `/neuro/states/{state}/neuropsychologist-finder/` | 50 |
| TRT legality pages | `/trt/states/{state}/trt-legality/` | 50 |
| Telehealth TRT rule pages | `/trt/states/{state}/telehealth-trt-rules/` | 50 |
| USCIS supporting pages | `/uscis-medical/guides/{slug}/` | 10 |
| Dentistry cost hubs | `/dentistry/{cost-hub}/` | 2 |
| **Total** |  | **412** |

### 3.3 USCIS support routes

1. `/uscis-medical/guides/i-693-cost/`
2. `/uscis-medical/guides/i-693-form-explained/`
3. `/uscis-medical/guides/vaccines-required-2026/`
4. `/uscis-medical/guides/i-693-expiration/`
5. `/uscis-medical/guides/correction-and-rejection-workflow/`
6. `/uscis-medical/guides/what-to-bring/`
7. `/uscis-medical/guides/timeline-and-scheduling/`
8. `/uscis-medical/guides/fees-and-questions-to-ask/`
9. `/uscis-medical/guides/after-exam-next-steps/`
10. `/uscis-medical/guides/how-to-use-the-civil-surgeon-locator/`

The top-level `/civil-surgeon-vs-panel-physician/` remains the disambiguator. It is not duplicated as a second support page.

### 3.4 Dentistry cost hubs

- `/dentistry/invisalign-cost-by-state/`
- `/dentistry/dental-implant-cost-by-state/`

### 3.5 Final route count

The current artifact admits 1,351 routes. Adding the 412 Velocity pages produces **1,763 admitted public routes**, excluding redirect-only aliases.

---

## 4. Homepage overhaul

The homepage is rebuilt to follow the visual hierarchy of the attached reference while using truthful current data and the new CTA language.

### 4.1 Visual system

- centered editorial canvas on a soft neutral background;
- large serif masthead;
- compact verified-index/freshness status line;
- restrained navy, white, gray, and small vertical accent colors;
- generous spacing and card-based canonical routing;
- one dark data/coverage section for visual contrast;
- mobile-first stacking and a sticky mobile conversion control.

The screenshot is a structural and visual reference only. Its future-dated “November 2026” copy is not copied. Dates come from actual repository source data.

### 4.2 Homepage sections

1. **Masthead and trust strip**
   - The Industry Guides
   - current verified index date
   - independent editorial publisher statement

2. **Hero**
   - plain-language value proposition;
   - primary CTA: **Find a Provider**;
   - secondary CTA: **Browse Industry Guides**;
   - primary CTA scrolls to the vertical selector, because provider destination differs by vertical.

3. **Five vertical destination cards**
   - USCIS Civil Surgeons
   - Personal Injury Law
   - Dentistry
   - Neuro / ADHD Testing
   - Hormones, IV & Hair

   Each card contains:
   - vertical label;
   - concise description;
   - **Find a Provider** linking to the existing canonical `/request-assistance/` path;
   - **Browse Guides** linking to the Velocity vertical hub;
   - canonical domain label.

4. **Dark “What We Cover” section**
   - vertical;
   - guide count;
   - state-page count;
   - last verified date;
   - row-level **Find a Provider** action.

5. **Featured decision guides**
   - disambiguators;
   - state guides;
   - high-performing literal questions;
   - links remain on Velocity until the user chooses a provider action.

6. **Platform operations FAQ**
   - who runs the site;
   - how sources are verified;
   - how often data changes;
   - relationship to government agencies;
   - referral disclosure.

7. **Methodology and review block**
   - editorial methodology;
   - reviewer identity only where true and documented;
   - source and freshness rules;
   - no invented credentials.

8. **Closing conversion block**
   - “Find a vetted provider in your state”;
   - vertical selector;
   - **Find a Provider** buttons.

### 4.3 CTA replacement law

Visible text must never say “Request assistance.” The target URL may remain:

- `https://theaccidentguides.com/request-assistance/`
- `https://dentistryguides.com/request-assistance/`
- `https://hormonesivhair.com/request-assistance/`
- `https://neuroevalguides.com/request-assistance/`
- `https://uscisexam.com/request-assistance/`

Every visible label becomes **Find a Provider**.

A repository-wide validator searches rendered HTML and source templates for banned visible CTA language while allowing `/request-assistance/` inside URLs.

---

## 5. Routing architecture

### 5.1 Canonical destination registry

`data/routing/canonical_destination_registry.json` becomes the only source for outbound destinations.

Each vertical record includes:

- `find_provider_url`
- `canonical_root_url`
- `directory_or_finder_url`, when verified
- `guide_root_url`
- `state_route_map`, only for currently verified external URLs
- fallback order
- last link-health check

### 5.2 Link resolution order

For every Velocity page:

1. most specific verified canonical page;
2. verified canonical vertical guide or directory root;
3. canonical homepage;
4. primary conversion URL at `/request-assistance/`.

The primary CTA always remains **Find a Provider**.

### 5.3 Required CTA placements

Every eligible Velocity page has:

1. above-the-fold CTA after the direct answer;
2. contextual CTA after the principal table or decision artifact;
3. state-specific or topic-specific CTA in the body;
4. end-of-page CTA module;
5. sticky mobile CTA where layout supports it.

### 5.4 One-way link rule

- Velocity links outward.
- Canonical sites do not need to link back.
- No acceptance test searches for canonical backlinks.
- No plan or page copy asks canonical owners to add backlinks.
- All Velocity pages use self-referential HTML canonical tags.

---

## 6. Programmatic content architecture

The repo remains a CommonJS static-site generator. There is no React or TanStack rewrite.

### 6.1 Source model

Add a unified page-family system:

```text
data/
  geography/states.json
  page_families/
    uscis_civil_surgeon.json
    pi_statute_of_limitations.json
    pi_comparative_negligence.json
    dentistry_insurance_marketplace.json
    dentistry_medicaid.json
    neuro_finder.json
    trt_legality.json
    trt_telehealth.json
    uscis_support.json
    dentistry_cost_hubs.json
  evidence/
    source_registry.json
    claim_registry.json
    freshness_registry.json
  routing/
    canonical_destination_registry.json
```

### 6.2 One row, one page

Each page is generated from one typed JSON row. Adding or updating a state page changes data, not rendering code.

Required fields:

- route;
- vertical;
- page family;
- state or jurisdiction;
- unique title, description, and H1;
- direct answer under 70 words;
- defensible data atom;
- primary-source references;
- dated primary fact or policy fact;
- visible comparison table, checklist, or decision tree;
- five visible FAQ entries;
- internal sibling links;
- canonical destination actions;
- date published;
- date modified;
- review date;
- recheck date;
- limitation/disclaimer block.

### 6.3 Defensible state-page atoms

| Family | Minimum atom |
|---|---|
| USCIS civil surgeon | state-specific official lookup workflow, major-city coverage table, sourced count only when available |
| PI statute of limitations | claim-type deadline table tied to official statute/court sources |
| PI negligence | rule type, threshold, recovery effect, exceptions, dated authority |
| Dental marketplace | state regulator and marketplace decision table |
| Medicaid dental | adult/child coverage table, eligibility and official provider lookup |
| Neuro finder | licensure board, insurance rules, evaluation-cost evidence, academic-center resources |
| TRT legality | state prescribing/licensure rule table and official verification path |
| Telehealth TRT | state telehealth and controlled-substance rule table with effective dates |

No row ships with “research required,” placeholders, guessed values, or unsupported counts.

### 6.4 Existing 200 question pages

All 200 remain in place and are upgraded in place:

- literal question as H1;
- direct answer under 70 words;
- one dated primary-source fact or statistic;
- one unique defensible atom;
- five visible FAQs;
- FAQ schema matching the visible five questions;
- explicit per-page provenance;
- 5–10 internal links;
- four required canonical CTA placements.

The distribution remains:

- USCIS: 40
- Neuro: 40
- Personal injury: 50
- Dentistry: 40
- TRT/Hair: 30

### 6.5 Existing 20 disambiguators

All 20 are upgraded to concrete, sourced decision pages:

- exact route contract;
- under-70-word answer;
- side-by-side comparison table;
- dated primary evidence;
- decision tree or fit test;
- five visible FAQs;
- internal links;
- canonical provider CTA.

Locked canonical routes include:

- `/civil-surgeon-vs-panel-physician/`
- `/uscis-medical-exam-vs-physical/`
- `/i-693-rejection-vs-denial-vs-rfe/`
- `/neuropsych-eval-vs-iq-test-vs-psych-eval/`
- `/adhd-evaluation-vs-neuropsychological-evaluation/`
- `/school-iep-evaluation-vs-private-neuropsych-evaluation/`
- `/ssdi-eval-vs-school-iep-eval-vs-forensic-eval/`
- `/personal-injury-vs-workers-comp/`
- `/comparative-negligence-vs-contributory-negligence/`
- `/settlement-demand-vs-lawsuit-filing/`
- `/cosmetic-vs-general-dentistry/`
- `/dental-insurance-vs-medical-insurance/`
- `/dentist-vs-oral-surgeon-vs-endodontist/`
- `/dental-implant-vs-bridge-vs-denture/`
- `/invisalign-vs-braces-vs-clear-aligners/`
- `/trt-vs-clomid-vs-enclomiphene/`
- `/trt-vs-peptide-therapy/`
- `/telehealth-trt-vs-in-person-trt/`
- `/trt-vs-hair-loss-treatment/`
- `/prp-vs-microneedling-for-hair-loss/`

Existing longer routes become 301 aliases to these locked routes. They do not create duplicate indexed pages.

---

## 7. Schema policy

### 7.1 Always emitted

- publisher `Organization`;
- `WebSite` identity;
- `Article` or `WebPage` with `datePublished` and `dateModified`;
- `BreadcrumbList`.

### 7.2 Emitted when visible content supports it

- `FAQPage` for the five visible FAQs;
- `HowTo` for a real step-by-step procedure;
- `MedicalWebPage` for actual medical editorial content;
- `CollectionPage`, `ItemList`, or `Dataset` for genuine collection/data pages.

### 7.3 Prohibited

- `LegalService` on Velocity editorial pages;
- `MedicalClinic` or `LocalBusiness` for providers the publisher does not own;
- cross-domain `sameAs` between distinct brands;
- schema content absent from the visible page.

### 7.4 Network identity

Velocity declares The Industry Guides as publisher and uses truthful `brand` or `hasPart` relationships for the five destination brands. No canonical-site code changes are required.

---

## 8. Workflow overhaul

### 8.1 Delete the cross-repository machinery

Remove:

- `.github/workflows/lkg_pr_push.yml`
- `scripts/export_promotion_candidates.js`
- `scripts/community/export_lkg_candidates.js`
- `data/lkg_candidates/`
- `data/canonical_candidates/`
- promotion-candidate manifests and validators
- package scripts beginning with `lkg:`
- `export:promotion`
- any `peter-evans/create-pull-request` dependency or usage
- `LKG_REPO` and `LKG_TOKEN` secret requirements

Remove statuses and ownership values:

- `LKG_CANONICAL`
- `EXPORTED_TO_LKG`
- `BLOCKED_CANONICAL_REPO_SOURCE_ZIP_NOT_SUPPLIED`
- `CANDIDATE_SPEC_COMPLETE_RENDERING_EXTERNAL`

### 8.2 Replace with Velocity lifecycle states

- `VELOCITY_SOURCE`
- `VELOCITY_STAGED`
- `VELOCITY_ADMITTED`
- `VELOCITY_LIVE`
- `VELOCITY_QUARANTINED`
- `VELOCITY_SUPERSEDED`

### 8.3 New workflow map

#### A. `validate.yml`

Read-only validation on push and pull request. It never mutates content.

#### B. `velocity_content_release.yml`

Scheduled and manual mutation lane:

1. checkout `main`;
2. install Node 24 dependencies;
3. collect/normalize public signals;
4. generate or update Velocity source rows;
5. build all public pages;
6. run hard-fail validation;
7. regenerate sitemap, feeds, llms.txt, and IndexNow payload;
8. commit validated changes directly to `main`;
9. rebase, rebuild, revalidate, and push.

No pull request is created.

#### C. `velocity_full_rebuild.yml`

Manual/weekly full deterministic regeneration of all page families and evidence registries.

#### D. `release_batch.yml`

Retained as an operator-controlled release command, but it only admits Velocity pages.

#### E. `deploy-distribution.yml`

Deploys the exact validated Velocity artifact after a successful release workflow. It does not rebuild a different artifact.

#### F. `postdeploy_public_audit.yml`

Runs click and routing checks on:

- homepage;
- one representative page from every family;
- all five **Find a Provider** destinations;
- sitemap and robots;
- representative structured data.

### 8.4 Public-signal workflow correction

`public-signal-processing.yml` stops producing LKG candidates. It writes evidence and proposed Velocity source rows. The content release workflow admits them only after the same atom, provenance, duplication, safety, and routing gates used by every other page.

### 8.5 Release behavior

Performance signals never decide whether the approved 412 pages are built. The full scope is built. Validation may block a defective page until the defect is repaired; it cannot delete approved scope or redirect work to another repository.

---

## 9. Backlink and disavow integration

The uploaded package contains an actionable `theindustryguides.com-disavow.txt` with these seven domains:

```text
domain:analyticshaven.top
domain:anchorurl.cloud
domain:backlinks-checker.com
domain:creativeposts.top
domain:fiverr-affordable-seo-services.site
domain:metamagic.top
domain:screenshots.wiki
```

### 9.1 Import rules

- preserve the uploaded package unchanged under `evidence/backlinks/source_packages/`;
- store its SHA-256;
- generate the operative file at `seo/disavow/theindustryguides.com-disavow.txt`;
- include the seven domain directives from the package's actionable file;
- remove the impossible future “Generated: 2026-11-19” date from the operative copy;
- record `effective_date: 2026-06-19` and the source package hash;
- flag the package README's contradictory treatment of `backlinks-checker.com` in an evidence note, while following the actionable file supplied by the user;
- user manually uploads the final file to Google Search Console.

### 9.2 Repo validation

Hard fail if:

- the operative file is header-only;
- any of the seven imported domain directives is missing;
- URL-level directives are used where the source specifies domain-level disavowal;
- the source package hash is not recorded.

### 9.3 Future audits

A 90-day re-audit reminder is recorded as a strong warning, not a release blocker.

---

## 10. Search-engine handoff

The user will manually submit to GSC and Bing.

The repository therefore produces, but does not submit:

- current sitemap URL;
- sitemap index and segmented sitemap inventory;
- robots URL;
- disavow file;
- IndexNow URL list and key verification;
- GSC submission checklist;
- Bing submission checklist;
- release timestamp and route counts.

Credential absence is not a blocker and no workflow requests GSC or Bing secrets.

IndexNow may remain programmatic for Velocity when its existing key and endpoint contract are valid.

---

## 11. Validation simplification and enforcement

### 11.1 Hard failures

1. 412 Velocity pages are not generated.
2. Any 412 record remains in a canonical-candidate directory.
3. LKG/PR workflow or `create-pull-request` usage remains.
4. Any visible “Request assistance” CTA remains.
5. Any eligible page lacks **Find a Provider**.
6. Any page routes to the wrong vertical destination.
7. A Velocity page uses a cross-domain HTML canonical tag.
8. A plan or validator requires a canonical backlink.
9. A state row has placeholder or research-required status.
10. A regulated claim lacks primary-source provenance and an as-of date.
11. A question page has fewer than five visible FAQs.
12. A disambiguator lacks a concrete comparison table.
13. A new page lacks a unique defensible atom.
14. Duplicate intent routes are indexable instead of redirected.
15. Homepage lacks required sections or provider actions.
16. Sitemap omits an admitted route.
17. Rendered schema disagrees with visible content.
18. The disavow file is empty or missing imported domains.
19. The 65/43/8 and June 19 USCIS fixtures regress.
20. Build output is not deterministic.

### 11.2 Strong warnings

- canonical destination live health check fails but a safe fallback exists;
- state/legal/medical evidence approaches its recheck date;
- backlink audit is older than 90 days;
- IndexNow submission is unavailable;
- visual regression differs outside approved homepage changes.

### 11.3 Soft warnings

- optional outreach metadata missing;
- non-critical descriptive anchor opportunity;
- content optimization opportunity that does not undermine correctness.

### 11.4 Registry updates

Every added or retired validator must be admitted in `_validation_registry.json`; the severity matrix remains a generated projection. Retired LKG validators remain recorded as `INFO/RETIRED` with their Velocity replacements.

---

## 12. Implementation phases

Phases control dependency order only. They are not permission gates.

### Phase 1 — Authority reset and cleanup

- update repo identity and lifecycle contracts;
- record architecture decision: Velocity-only publication;
- delete LKG/PR workflow and scripts;
- remove canonical-candidate exports;
- migrate 412 specs into Velocity source registries;
- import the real disavow package;
- replace CTA language and validator names.

### Phase 2 — Generator and evidence model

- implement page-family data contracts;
- implement state registry;
- implement evidence, claim, and freshness registries;
- implement canonical destination resolver;
- update renderer and schema generator;
- add exact-route redirects.

### Phase 3 — Build all 412 pages

- complete every state row with primary-source data;
- generate all 400 state pages;
- generate 10 USCIS supporting guides;
- generate 2 dentistry cost hubs;
- route all pages to the correct canonical destination;
- rebuild sitemap, feeds, llms exports, answer blocks, and entity graph.

### Phase 4 — Upgrade the existing 220-page expansion

- rewrite 200 questions with dated evidence and five FAQs;
- upgrade 20 disambiguators with sourced tables and exact routes;
- add all required CTAs and internal links;
- preserve historical Citation Velocity wins.

### Phase 5 — Homepage and navigation overhaul

- replace the existing routing-first page with the reference-inspired editorial index;
- enforce **Find a Provider** language;
- add coverage table, operations FAQ, methodology block, and closing CTA;
- add responsive and sticky-mobile behavior.

### Phase 6 — Workflow and release conversion

- install Velocity-only release workflows;
- remove PR creation;
- convert public signals into Velocity source updates;
- validate direct-to-main release behavior;
- ensure deployment consumes the exact validated artifact.

### Phase 7 — Full validation and artifact delivery

- run build and complete registry suite;
- run deterministic comparison;
- verify route counts and sitemap parity;
- run browser contract and local click suite when available;
- package full baseline ZIP;
- reopen ZIP and rerun artifact-safe checks;
- deliver manual GSC/Bing/disavow handoff package.

---

## 13. Completion definition

The overhaul is complete only when:

- all 412 formerly external pages render on `theindustryguides.com`;
- the final public inventory contains 1,763 admitted routes;
- all 200 question pages contain five FAQs and dated primary evidence;
- all 20 disambiguators use exact route contracts and sourced comparison atoms;
- the homepage matches the approved editorial/routing architecture;
- visible CTA language is **Find a Provider** everywhere;
- all provider CTAs route one-way to the correct canonical site;
- no LKG, promotion export, cross-repo PR, or canonical backlink requirement remains;
- the seven-domain disavow file is present and ready for manual upload;
- GSC/Bing handoff files are complete without credential dependencies;
- all hard-fail validators pass;
- the ZIP is structurally checked and reopened successfully.

---

## 14. Prior partial/blocked-item resolution

| Prior audit item | New disposition |
|---|---|
| 412 canonical specifications | **RESOLVED BY DESIGN:** become 412 Velocity pages |
| Canonical source ZIPs missing | **NOT APPLICABLE** |
| Canonical rendering/deployment | **NOT APPLICABLE** |
| Canonical robots/sitemaps | **NOT APPLICABLE** |
| Canonical backlinks to Velocity | **FORBIDDEN** |
| LKG candidate export | **RETIRED** |
| LKG pull request | **RETIRED** |
| Question pages with one FAQ | **REQUIRED FIX:** five visible FAQs |
| Question pages without dated evidence | **REQUIRED FIX:** dated primary-source evidence |
| Generic disambiguator tables | **REQUIRED FIX:** sourced decision tables |
| Missing `/trt-vs-hair-loss-treatment/` | **REQUIRED FIX:** create exact route |
| Long-form route mismatches | **REQUIRED FIX:** locked short routes + redirects |
| Header-only disavow files | **REQUIRED FIX:** import seven supplied domains |
| GSC/Bing credentials absent | **NOT A REPO BLOCKER:** user submits manually |
| “Request assistance” CTA | **REQUIRED FIX:** visible text becomes Find a Provider |
| Homepage does not match destination-index model | **REQUIRED FIX:** full homepage redesign |
| Cross-domain `sameAs` | **NOT APPLICABLE:** use truthful brand relationships |
| Blanket `LegalService` schema | **NOT APPLICABLE:** Velocity is editorial, not a law firm |

---

## 15. Final architectural law

**Velocity publishes. Velocity earns citations. Velocity owns every page. Velocity releases itself. Canonical sites receive qualified outbound traffic. Nothing is promoted to LKG, nothing opens a cross-repo PR, and nothing waits for a canonical repository.**
