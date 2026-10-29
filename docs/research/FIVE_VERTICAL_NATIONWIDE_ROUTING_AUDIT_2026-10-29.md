# Five-vertical nationwide routing audit — Phase 1–2 handoff

Date: 2026-10-29. Status: evidence and operator plan, **not an authorized public-page admission or freeze thaw**.

## Network boundaries
- Canonical sites retain **all existing nationwide state and city coverage**. The Velocity domain is an educational decision-support and topic router, not a competing local city-directory.
- This audit covers the five nationwide brands: theaccidentguides.com, dentistryguides.com, hormonesivhair.com, neuroevalguides.com, uscisexam.com.
- Memphis Senior Care is Memphis-metro only and outside Velocity's five-canonical routing obligations.

## Priority intent families and canonical destination
| Intent family | Canonical destination | Disambiguation requirement | Market examples (canonical content research only) |
|---|---|---|---|
| Urgent injury documentation / attorney search | https://theaccidentguides.com/ | Crash report versus attorney fee; neither establishes claim value | St. Louis records; Laredo/Permian Basin truck collision research |
| Dental new-patient / emergency exam pricing | https://dentistryguides.com/ | Routine cleaning+exam versus limited problem exam and necessary X-rays | Ocala provider-specific offers; Billings $99 preventive special |
| Vitamin C IM, IV, TRT or hair treatments | https://hormonesivhair.com/ | IM injection versus IV infusion, multi-ingredient blend versus single nutrient, clinical indications | Ocala vitamin C |
| ADHD test / full neuropsych evaluation / therapy | https://neuroevalguides.com/ | QbTest/TOVA component versus comprehensive diagnostic battery; evaluation versus therapy | Huntsville; Fayetteville |
| Form I-693 exam and authorized surgeon fees | https://uscisexam.com/ | USCIS filing fees versus clinic medical fees; published base versus all-in cost | McAllen and Fresno clinic information |

## Non-local query audit matrix
| Example intent utterance | Expected route | Potential false match |
|---|---|---|
| “What will an immigration medical exam really cost?” | USCIS medical | Immigration attorneys or general medical exams |
| “Does the $750 immigration physical include blood tests?” | USCIS medical | generic urgent care |
| “Is a vitamin C shot the same as a vitamin C IV?” | Hormone/wellness | cosmetic injections or pharma |
| “What is the difference between an ADHD QbTest and a full evaluation?” | Neuro | therapy-only route |
| “Can an ADHD evaluation help with therapy planning?” | Neuro | stand-alone online screening |
| “Does a $99 dental new patient special include a cleaning?” | Dentistry | emergency-focused exam |
| “How do I request a police crash report after a collision?” | Personal injury | court filing or insurer claim estimate |
| “How do I compare lawyer contingency agreements?” | Personal injury | settlement multiplier calculator |

For each family: inspect current intent classifier or query inventory, confirm canonical destination and stable top/bottom blocks, identify gaps as `ROUTE_REPAIR` or `CANONICAL_CONTENT_RESEARCH`; no automated new page admission on this evidence alone.

## Technical and release constraints
1. Respect `docs/SOURCE_AUTHORITY.md`, `docs/PAGE_RELEASE_LAW.md`, and `docs/DAY_0_OPERATOR_GUIDE.md`. Existing admitted pages remain frozen.
2. Do not create city/state URLs on Velocity or replicate local provider lists.
3. Do not alter `content/_live`, `data/release/frozen_page_registry.json` or `data/release/frozen_html_cache` to satisfy a research quota.
4. Run existing `npm run validate` and `npm run validate:release` before any governed content release.
5. Do not interpret the opportunity fanout universe as live citation traffic or measure ROI without impressions, clicks and billable leads.
6. Continue to route general intent to the five canonical hosts; when the destination lacks an adequate verified local answer, log the content gap for generator-side research.

## Measurement contract for next implementation
- Canonical routing: sampled query, classifier result, expected host, actual rendered link, false positive/negative.
- Technical visibility: indexable canonical URL, sitemap presence, lastmod integrity, GSC URL inspection result with timestamp.
- AI citation: tested question, model/search surface, observed citation/link, repeat-check date, limitations. Do not claim visibility without a genuine observation.
- Commercial: attributed enquiry, authorized recipient, accepted/contacted status and actual invoice/revenue when available.

## Next safe action
Inventory the actual classifier/query files and collect query-routing test output before editing routing behavior. Where test fails, patch a narrowly scoped source with regression coverage. No public page changes are authorized by this audit alone.
