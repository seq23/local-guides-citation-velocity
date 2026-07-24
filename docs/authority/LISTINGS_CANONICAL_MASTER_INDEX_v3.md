---

## **🔒 LISTINGS — TEMPLATE-BASED SYSTEM**

## **CANONICAL MASTER INDEX v3**

**(Clean Rewrite — Same Law, Clearer Prose)**

---

# **GOVERNING HEADER**

**Document Name:** LISTINGS-TBS-MASTER-INDEX-v3  
**Status:** AUTHORITATIVE · LOCKED · NON-COMPRESSIBLE  
**Effective Date:** 2026-01-16  
**Supersedes:** All prior Master Index versions, prompts, SOPs, repo comments, and informal guidance  
**Change Authority:** User-controlled only

This document is the **single source of truth** for the Listings Template-Based System (TBS).  
If a rule, permission, structure, or behavior is not written here, **it does not exist**.

---

# **ABSOLUTE GOVERNANCE LAWS (NON-NEGOTIABLE)**

### **1\. Master Authority Rule**

This document overrides:

* all prior Master Index versions  
* all SOPs  
* all repo comments  
* all prompts  
* all ChatGPT instructions  
* all verbal agreements

**If there is a conflict, this document wins.**

---

### **2\. Zero-Compression Law**

You may **not**:

* summarize sections  
* remove steps  
* collapse tables into prose  
* replace procedures with explanations  
* delete “redundant-looking” rules

Reorganization is allowed.  
Loss of operational detail is forbidden.

---

### **3\. Artifact-First Law**

Every enforceable rule **must include a concrete artifact**, such as:

* step-by-step SOP  
* checklist  
* registry table  
* verbatim template  
* failure decision tree

Rules without executable artifacts are invalid.

---

### **4\. Content-Before-Code Law**

The required sequence is immutable:

1. Architecture  
2. Content (plain text, approved)  
3. JSON conversion  
4. Generator behavior  
5. Deployment

Code without locked content is invalid.

---

### **5\. Delivery Safety Law**

No ZIP, repo, or file may be delivered unless:

* syntax-checked  
* build passes  
* validators pass  
* no unresolved tokens  
* safe for direct GitHub use

Failure on any gate \= **DO NOT DELIVER**

---

# **0\. SYSTEM DEFINITION (IMMUTABLE)**

### **What This System Is**

Listings TBS is a **template-based static publishing system** that produces:

* neutral  
* educational  
* non-endorsement  
  decision-support guides across **multiple verticals and cities**

The system exists to:

* explain complex decisions  
* reduce risk through verification and preparation  
* provide structured questions and next actions

---

### **What This System Is NOT**

This system does **not**:

* rank providers  
* recommend providers  
* sell leads  
* collect referral fees  
* provide legal or medical advice  
* operate as a marketplace

---

# **1\. BUSINESS & MONETIZATION LAW (LOCKED)**

### **1.1 Monetization Model**

Canonical sites operate on an **ads-only monetization model**.

Ads must be:

* clearly labeled  
* visually separated  
* editorially neutral

---

### **1.2 Permanently Prohibited Monetization**

The following are forbidden forever:

* sponsored directory rankings  
* pay-to-play ordering  
* featured provider endorsements  
* lead resale

---

### **1.3 Directory Exception — Personal Injury Only**

Directories are permitted **only** for the Personal Injury vertical.

**PI Directory Rules (No Exceptions):**

* exactly **5 firms per city**  
* alphabetical order  
* real firms only  
* **official website URL only**  
* no phone, address, email, or tracking links  
* **Morgan & Morgan is prohibited**

---

# **2\. ACTIVE VERTICALS (AUTHORITATIVE)**

Only the verticals listed below are active.  
Owning a domain does **not** activate a vertical.

---

### **2.1 Personal Injury (pi)**

* directory: **ALLOWED**  
* guides: **REQUIRED**  
* city pages: **REQUIRED**  
* state pages: **REQUIRED**

---

### **2.2 Dentistry (dentistry)**

* directory: **FORBIDDEN**  
* example providers only  
* state lookup: **REQUIRED**

---

### **2.3 Neuro Evaluations (neuro)**

Neuro is **one vertical**.

ADHD and Autism are **subtopics**, not separate verticals.

* directory: **FORBIDDEN**  
* example providers only  
* state lookup: **REQUIRED**

---

### **2.4 USCIS Medical (uscis)**

* directory: **FORBIDDEN**  
* example providers only  
* state lookup: **REQUIRED**

---

# **3\. DOMAIN & BRAND ARCHITECTURE (LOCKED)**

### **3.1 Canonical Domain Rule**

Each vertical has **exactly one canonical domain**.

All other domains are:

* redirects  
* defensive registrations  
* wedges

They never define structure.

---

### **3.2 Known Canonical Domains**

* Personal Injury → `theaccidentguides.com`  
* Dentistry → `dentistryguides.com`  
* Neuro → `neuroevaluationguides.com`  
* USCIS → city-domain only (no global canonical yet)

---

# **4\. REPO & GENERATOR CONTRACT (IMMUTABLE)**

### **4.1 Canonical Starting Point Rule**

**All work must begin from the latest deployed SOURCE ZIP.**

Local copies, memory, partial exports, or assumptions are invalid.

---

# **5\. RELEASE GATES (NON-NEGOTIABLE)**

### **5.1 Syntax Gate**

No delivery unless:

* valid JavaScript  
* executable under Node  
* no malformed templates

---

### **5.2 Build \+ Validator Gate**

All must pass:

* `npm run build`  
* `node scripts/validate_tbs.js`  
* updated validators ship with system changes

---

### **5.3 No-Markdown Fence Gate**

Triple backticks are forbidden in `/scripts/`.

Validator enforced.

---

**FAIL ANY GATE → DO NOT DELIVER**

---

### **⛔ END OF BATCH 1**

**(System Definition → Release Gates)**

---

# **6\. CANONICAL CONTENT INVENTORY LAW**

This section defines **what content is allowed to exist**, where it lives, and how it is reused.

No content may be created, modified, or deployed outside this inventory.

---

## **6.1 Content Primitive Types (Exhaustive)**

Only the following content types are allowed in the system:

1. **Evaluation Frameworks**  
2. **Guides**  
3. **FAQs**  
4. **Directory Listings (PI only)**  
5. **Example Provider Lists (Non-PI only)**  
6. **Global Pages**  
7. **Disclosure Blocks**  
8. **Ad Slots**  
9. **Next Steps Blocks**

If a content type is not listed here, it is forbidden.

---

## **6.2 Evaluation Frameworks (Core Asset)**

### **Definition**

An Evaluation Framework is a **neutral, process-based explanation** of how people typically evaluate a decision.

It is the **primary AI visibility asset** in the system.

---

### **Mandatory Properties**

Every evaluation framework must:

* Explain the decision **without recommending**  
* Use neutral language (“people often consider…”, “this varies by…”)  
* Be reusable across cities  
* Avoid provider mentions  
* Avoid outcomes, guarantees, or rankings

---

### **Required Coverage Areas**

Each framework must cover, in order:

1. What the service is (plain English)  
2. Who it is typically for  
3. Typical steps in the process  
4. What varies by city or state  
5. Common questions people ask  
6. Typical cost considerations (non-specific)  
7. Neutral red flags  
8. Explicit educational boundary disclaimer

---

### **Placement Rules**

* Exactly **one** evaluation framework per city page  
* Exactly **one** evaluation framework per state page  
* Never split  
* Never duplicated  
* Never placed inside ads or directories

---

## **6.3 Guides System Law**

### **Definition**

Guides are **deep-dive educational articles** that expand on parts of the evaluation framework.

They answer “how”, “what to ask”, and “what to expect”.

---

### **Guide Categories (Canonical)**

Each vertical must support guides covering:

* Cost & fees  
* Timeline / process  
* Questions to ask  
* Red flags  
* What happens next

---

### **Guide Placement Rules**

* Guides **do not replace** evaluation frameworks  
* Guides are surfaced via:  
  * a **Guides Block**  
  * a **Guides Micro-Block** (PI state \+ city pages)  
* Guides may never be embedded inline with directories

---

### **Guide Micro-Block (Canonical Copy)**

Used on PI state and city pages:

**Start here:** Costs • Timeline • Questions to ask • Red flags

Each item links to:

* `/guides/`  
* or a relevant guide detail page

---

## **6.4 FAQ System Law**

### **Definition**

FAQs exist to **absorb long-tail AI and user questions** without polluting core content.

---

### **FAQ Rules**

* 10–12 FAQs per city page  
* Default collapsed  
* No duplicate questions across the same page  
* Neutral language only  
* No provider mentions  
* No recommendations

---

### **Required FAQ Coverage**

FAQs must include versions of:

* “How do I choose a \[provider\] in \[city/state\]?”  
* “What does it usually cost?”  
* “What should I ask?”  
* “What happens during the process?”

---

## **6.5 Directory Listings — PI ONLY**

### **Directory Definition**

A directory is a **neutral list of firms**, not an endorsement.

Directories exist **only** in the Personal Injury vertical.

---

### **Directory Rules (Hard Law)**

* Exactly **5 firms per city**  
* Alphabetical order  
* Official firm website URL only  
* No phone numbers  
* No addresses  
* No lead routing  
* No rankings  
* No badges  
* No scoring  
* **Morgan & Morgan is prohibited**

---

### **Directory Replaceability Law**

Directories are **inventory**, not sacred content.

They may be:

* Fully replaced by a sponsor  
* Collapsed entirely  
* Partially overridden (featured sponsor at top)

This behavior is controlled by sponsorship flags.

---

## **6.6 Example Provider Lists — Non-PI Verticals**

### **Definition**

Example provider lists show **what types of providers exist**, not who to choose.

---

### **Rules**

* Examples only  
* Always removable  
* Never exhaustive  
* Never framed as “best”  
* No ordering significance

---

### **Sponsor Override**

For non-PI verticals, a paid sponsor may:

* Replace examples entirely  
* Convert the page to a single-provider spotlight

---

## **6.7 Global Pages (Required Everywhere)**

Every site must include:

* About  
* Contact  
* Disclaimer  
* Editorial Policy  
* Privacy Policy  
* Methodology  
* For Providers  
* Guides Index

Missing any \= **invalid build**

---

## **6.8 Disclosure Blocks (Mandatory)**

All pages must clearly state:

* Educational only  
* No endorsements  
* No guarantees  
* Not legal or medical advice (as applicable)

Disclosure language may vary slightly by vertical but **must exist**.

---

## **6.9 Ad Slot Law**

### **Canonical Ad Slots**

Only the following ad tokens are allowed:

* `%%AD:city_hub_top%%`  
* `%%AD:city_hub_mid%%`  
* `%%AD:state_hub_top%%`  
* `%%AD:state_hub_mid%%`  
* `%%AD:global%%`

---

### **Ad Placement Rules**

* Ads must never be adjacent  
* Ads must never interrupt evaluation frameworks  
* Ads must appear **before** directories or example lists  
* Ads must be visually separated

---

## **6.10 Next Steps System Law**

Two Next Steps systems exist and **must never be conflated**.

---

### **A. User-Facing Next Steps (Public)**

Purpose: help the user proceed.

* “Get help now”  
* “Talk to a lawyer”  
* “Find a provider”

Routing logic:

* Sponsored firm if exists  
* Otherwise neutral routing

---

### **B. Sponsor-Facing Next Steps (Internal)**

Purpose: onboard paying firms.

Includes:

* Intake forms  
* Ad copy submission  
* Tracking preferences  
* Visibility controls

This system is **not rendered publicly**.

---

### **⛔ END OF BATCH 2**

**(Content Inventory → Next Steps Law)**

---

# **7\. CANONICAL PAGE FLOW CONTRACTS (NON-NEGOTIABLE)**

This section defines **exact page structure**.  
If a page deviates from its contract, the build is invalid.

Page flow exists to:

* Preserve AI visibility  
* Preserve monetization inventory  
* Prevent content drift  
* Keep sponsor value predictable

---

## **7.1 Personal Injury (PI) — CITY PAGE FLOW**

### **Canonical Order (Top → Bottom)**

1. **Hero / Intro**  
   * City \+ service context  
   * Neutral framing  
   * No provider mentions  
2. **Top Ad Slot**  
   * `%%AD:city_hub_top%%`  
   * Must appear immediately after hero  
   * Never adjacent to another ad  
3. **Evaluation Framework (AI Visibility Block)**  
   * Exactly one  
   * Neutral  
   * Process-based  
   * No calls to action  
4. **Mid Ad Slot**  
   * `%%AD:city_hub_mid%%`  
   * Must appear **after** evaluation framework  
   * Must appear **before** directory  
5. **Guides Micro-Block**  
   * Copy (canonical):  
     **Start here:** Costs • Timeline • Questions to ask • Red flags  
   * Links to `/guides/` or guide detail pages  
   * Must appear immediately above directory  
6. **Directory Listings (PI firms)**  
   * Conditional  
   * Replaceable  
   * Governed by sponsorship flags  
7. **FAQ Block**  
   * 10–12 items  
   * Default collapsed  
8. **Disclosure / Footer**

---

### **Prohibited Patterns**

* Ads adjacent to ads  
* Directory before evaluation framework  
* Guides embedded inside directory  
* Sponsor content inside framework  
* “Best” or “Top” language anywhere

---

## **7.2 Personal Injury (PI) — STATE PAGE FLOW**

State pages aggregate cities. They do **not** duplicate city-level detail.

### **Canonical Order**

1. **Hero / Intro**  
   * State-level framing  
   * Neutral  
   * No firms listed here  
2. **Top Ad Slot**  
   * `%%AD:state_hub_top%%`  
3. **Evaluation Framework**  
   * State-level context  
   * Explains how decisions vary across cities  
4. **Mid Ad Slot**  
   * `%%AD:state_hub_mid%%`  
5. **Guides Micro-Block**  
   * Same copy as city pages  
   * Same placement rule  
6. **City Directory Grid**  
   * Links to city pages  
   * No firm listings here  
7. **Disclosure / Footer**

---

### **State Page Restrictions**

* No firm-level directories  
* No rankings of cities  
* No “best city” language  
* No sponsor takeover without explicit state-level sponsorship

---

## **7.3 Non-PI CITY PAGE FLOW (Dentistry, TRT, Neuro, USCIS)**

Non-PI pages use **example providers**, not directories.

### **Canonical Order**

1. **Hero / Intro**  
2. **Top Ad Slot**  
   * `%%AD:city_hub_top%%`  
3. **Evaluation Framework**  
4. **Mid Ad Slot**  
   * `%%AD:city_hub_mid%%`  
5. **Example Providers Section**  
   * Examples only  
   * Always removable  
6. **Guides Block**  
   * Full guides block (not micro-block)  
7. **FAQs**  
8. **Disclosure / Footer**

---

### **Non-PI Restrictions**

* No directories  
* No firm comparisons  
* No rankings  
* Examples may be fully replaced by sponsor

---

# **8\. SPONSOR TAKEOVER MATRIX (CANONICAL)**

This matrix defines **what sponsors can buy** and **what changes** when they do.

This is system law.

---

## **8.1 Personal Injury (Directory Model)**

### **City-Level Sponsor**

When a firm sponsors a city:

They may choose **one** of:

1. **Exclusive City Sponsor**  
   * Directory removed  
   * Replaced with:  
     * Sponsored firm profile  
     * CTA / contact flow  
2. **Featured Sponsor**  
   * Sponsor appears at top  
   * Remaining directory intact

---

### **State-Level Sponsor**

* Applies to all cities in state  
* Overrides city-level sponsors  
* May:  
  * Feature sponsor across all city pages  
  * Replace directories entirely

---

### **Global Sponsor (PI)**

* Overrides all city \+ state logic  
* Used rarely  
* High-value inventory

---

## **8.2 Non-PI Vertical Sponsorship (Examples profession)**

For Dentistry / TRT / Neuro / USCIS:

* Example providers are **always removable**  
* Sponsor may:  
  * Replace examples entirely  
  * Convert page to single-provider spotlight

---

### **Repo Status (Locked)**

✔ Directory rendering is conditional  
✔ Sponsor flags override safely  
✔ No hard dependency on directories or examples

This is **future-proof by design**.

---

# **9\. VALIDATION & SHIP GATES**

No page ships unless **all gates pass**.

---

## **9.1 Build Validation (Hard Fail)**

* `npm run validate:all` must pass  
* No unresolved tokens  
* All required zones present  
* No forbidden language  
* No schema violations

---

## **9.2 Page Contract Enforcement**

Validators must check:

* Exactly one evaluation framework  
* Ad placement order correct  
* Guides block present where required  
* Directory present or intentionally removed  
* Disclosure exists

---

## **9.3 Manual Spot-Check (Required)**

For each release:

* Open one PI city page  
* Confirm:  
  * Hero → Ad → Framework → Ad → Guides → Directory  
* Open one state page  
* Open one non-PI city page

---

### **⛔ END OF BATCH 3**

(Page Flow Contracts \+ Sponsor Matrix)

Continuing.  
Same constraints: **full rewrite, cleaner prose, identical law, no deletions.**  
This is **Batch 4**.

---

# **10\. OPERATIONS & HUMAN ACCESS CONTROL (VA-SAFE SYSTEM)**

This system is designed so that **humans cannot accidentally break it**.

Every role has:

* Explicit permissions  
* Explicit prohibitions  
* Escalation rules

If a task is not explicitly allowed, it is forbidden.

---

## **10.1 Roles Defined**

### **Owner (You)**

The only role that may:

* Change system law  
* Modify canonical templates  
* Approve sponsorship overrides  
* Unlock frozen files  
* Change validation logic

---

### **Operator (Trusted Senior)**

May:

* Execute approved changes  
* Run builds and validations  
* Patch copy **inside allowed zones**  
* Apply sponsor flags

May NOT:

* Change page flow  
* Modify evaluation frameworks  
* Remove disclosures  
* Create new monetization logic

---

### **VA (Execution-Only)**

May:

* Add cities using approved templates  
* Add example providers  
* Add PI directory entries  
* Fix typos  
* Update addresses / links

May NOT:

* Touch templates  
* Touch evaluation frameworks  
* Change order of blocks  
* Add rankings, claims, or opinions  
* Modify ad slots  
* Remove directories or guides

---

## **10.2 VA “Safe Zones” (Explicit)**

VAs may only edit:

* City configuration files  
* Provider data files  
* Example provider lists  
* FAQ entries (pre-approved format only)

All other files are **read-only**.

---

## **10.3 Forbidden Actions (Immediate Fail)**

If any of the following occur, work must be rolled back:

* Adding “best,” “top,” “award-winning”  
* Adding scores, ratings, or rankings  
* Changing block order  
* Removing evaluation framework  
* Adding CTA language inside framework  
* Inserting sponsor language without flags  
* Copying content between cities verbatim

---

## **10.4 Escalation Rule**

If a VA encounters uncertainty:

1. **Stop**  
2. Leave a comment  
3. Escalate to Operator or Owner

No improvisation is allowed.

---

# **11\. CHANGE CONTROL & VERSIONING LAW**

This system uses **software-grade governance**.

---

## **11.1 Frozen vs Mutable Files**

### **Frozen Files (Locked)**

* Evaluation frameworks  
* Page templates  
* Disclosure language  
* Validation rules  
* Canonical page flow spec

These files:

* May not be edited casually  
* Require explicit unlock \+ version bump

---

### **Mutable Files**

* City configs  
* Provider lists  
* Example lists  
* FAQs  
* Sponsorship flags

These may change freely **within rules**.

---

## **11.2 Versioning Rules**

Every material change must:

* Increment version  
* Record date  
* Record reason  
* Record author

No silent edits.

---

## **11.3 Never Rewrite, Only Add**

Evaluation frameworks follow this rule:

* Never rewrite wholesale  
* Only append or clarify  
* Preserve original structure

AI trusts **stable patterns**.

---

# **12\. AI VISIBILITY LAW (WHY THIS WORKS)**

This system is optimized for **answer extraction**, not traffic.

---

## **12.1 Definition of AI Visibility**

AI visibility means:

* AI reuses your **decision frameworks**  
* AI mirrors your **neutral language**  
* AI does not invent its own structure

You win when AI explains decisions **the way your site does**.

---

## **12.2 Why Rankings Fail**

Rankings:

* Require constant updates  
* Are suppressed by AI  
* Create compliance risk  
* Destroy neutrality

Your system avoids all four.

---

## **12.3 Monitoring Protocol (Lightweight)**

Monthly, per vertical:

1. Ask 2–3 canonical questions in ChatGPT  
2. Look for:  
   * Process language  
   * Neutral framing  
   * Absence of rankings  
3. Ask:  
   “Where does this information usually come from?”

If AI invents new steps → add clarifying copy  
If AI mirrors your framework → do nothing

---

# **13\. DISCLOSURE & COMPLIANCE (NON-OPTIONAL)**

Disclosures protect:

* You  
* Sponsors  
* Platforms  
* AI usage

---

## **13.1 Disclosure Placement**

Disclosures must appear:

* On all city pages  
* On all state pages  
* On all vertical landing pages

Never hidden. Never removed.

---

## **13.2 Disclosure Content Rules**

Disclosures must state:

* Informational purpose  
* No guarantees  
* No endorsements  
* Sponsorship transparency  
* Jurisdictional variance

No legal advice. No medical advice.

---

## **13.3 Sponsored Content Disclosure**

If sponsorship affects content:

* It must be disclosed  
* It must be visible  
* It must be unambiguous

Hidden sponsorship is forbidden.

---

# **14\. GUIDES SYSTEM (CANONICAL)**

Guides are **education assets**, not monetization assets.

---

## **14.1 Purpose of Guides**

Guides exist to:

* Deepen AI reference value  
* Answer long-form questions  
* Reduce repetition on city pages

---

## **14.2 Guides Linking Rules**

* State pages: **micro-block only**  
* City pages: **micro-block above directory**  
* Non-PI pages: full guides block

Guides are never embedded inline.

---

## **14.3 Guides Are Neutral**

* No providers  
* No CTAs  
* No sponsors  
* No rankings

Pure explanation.

---

### **⛔ END OF BATCH 4**

(Operations, Governance, AI Law, Guides)

---

# **15\. MONETIZATION SYSTEM (CANONICAL, NON-NEGOTIABLE)**

Monetization is **explicitly designed**, not bolted on.

Inventory exists to be:

* Sold  
* Overridden  
* Removed  
* Replaced

Nothing is sacred except **system law**.

---

## **15.1 Inventory Types (Authoritative)**

### **A. City-Level Inventory**

Applies to a single city page.

Includes:

* Top ad slot  
* Mid ad slot  
* Directory control (PI only)  
* Example list control (non-PI)

---

### **B. State-Level Inventory**

Applies to all city pages in a state **plus** the state page.

Includes:

* State page ad slots  
* All city ad slots in that state  
* Directory or example overrides (vertical-dependent)

---

### **C. Global Inventory**

Applies to:

* All states  
* All cities  
* Entire vertical

Includes:

* Global ad placement  
* Default routing override  
* Brand-level visibility

---

## **15.2 PI Vertical — Directory Is Inventory**

The PI directory is **not content**.  
It is **inventory**.

---

### **When a PI Sponsor Pays (City)**

They may choose **one** of the following:

#### **Option 1 — Directory Takeover (Exclusive)**

* Directory collapses  
* Replaced with:  
  * Sponsored firm profile  
  * Contact CTA  
  * Intake routing

No other firms appear.

---

#### **Option 2 — Featured Placement**

* Sponsor appears at top  
* Remaining directory stays visible  
* Sponsor visually distinguished

---

#### **Option 3 — Full Removal**

* Directory removed entirely  
* Page becomes single-provider spotlight

Used for:

* Premium buys  
* Sensitive markets  
* Sponsor preference

---

## **15.3 Non-PI Verticals — Examples Model**

Non-PI verticals never use directories.

They use:

* Example providers  
* Illustrative lists  
* Educational references

These are **always removable**.

---

### **When a Non-PI Sponsor Pays**

They may:

* Replace examples entirely  
* Convert page to single-provider spotlight  
* Suppress examples altogether

Examples are **never guaranteed**.

---

## **15.4 Sponsorship Flags (System Control)**

All monetization actions are controlled via flags.

Examples:

* `has_city_sponsor`  
* `has_state_sponsor`  
* `has_global_sponsor`  
* `directory_override`  
* `example_override`

No hard-coded logic.  
No manual hacks.

---

# **16\. NEXT STEPS SYSTEM (DUAL-TRACK)**

There are **two separate Next Steps flows**.

They must never be conflated.

---

## **16.1 User-Facing Next Steps (Public)**

Purpose:

* Help users act  
* Route inquiries appropriately

Appears on:

* City pages  
* State pages (PI only)

Behavior:

* If sponsor exists → route to sponsor  
* If no sponsor → neutral routing

Examples:

* “Get help now”  
* “Talk to a professional”

---

## **16.2 Sponsor-Facing Next Steps (Internal)**

Purpose:

* Onboard sponsors  
* Capture preferences  
* Control visibility

Includes:

* Intake form  
* Ad copy submission  
* CTA preferences  
* Tracking options  
* Scope selection (city / state / global)

This flow:

* Is never public  
* Lives as an ops workflow  
* May be Zapier / CRM / email driven

---

## **16.3 Separation Rule (Critical)**

User Next Steps ≠ Sponsor Onboarding.

They must:

* Use different endpoints  
* Use different language  
* Never appear together

---

# **17\. PAGE FLOW LAW (CANONICAL ORDER)**

Page flow is **locked system law**.

---

## **17.1 PI City Page Flow (Authoritative)**

1. Hero / Intro  
2. **Top Ad Slot**  
3. AI Visibility / Evaluation Framework  
4. **Mid Ad Slot**  
5. Guides Micro-Block  
6. Directory (if present)  
7. FAQs  
8. Disclosure / Footer

Ads are **never adjacent**.  
Evaluation always precedes listings.

---

## **17.2 PI State Page Flow**

1. Hero / Intro  
2. **Top Ad Slot**  
3. AI Visibility / Evaluation Framework  
4. **Mid Ad Slot**  
5. Guides Micro-Block  
6. City Grid  
7. Disclosure / Footer

No directories on state pages.

---

## **17.3 Non-PI City Page Flow**

1. Hero / Intro  
2. **Top Ad Slot**  
3. AI Visibility Framework  
4. **Mid Ad Slot**  
5. Guides Block (full)  
6. Example Providers (if any)  
7. FAQs  
8. Disclosure / Footer

---

# **18\. DUPLICATE CONTENT PREVENTION**

Duplicate content is a hard failure.

---

## **18.1 What Must Be Unique**

* City intros  
* City context paragraphs  
* Jurisdictional notes  
* Local considerations

---

## **18.2 What May Be Reused**

* Evaluation frameworks  
* Disclosure language  
* Structural blocks  
* Guides

Reuse structure, not prose.

---

# **19\. EDGE CASES & OVERRIDES**

Edge cases are expected.  
They are handled explicitly.

---

## **19.1 Low-Population Cities**

If a city cannot support:

* Directory depth  
* Example variety

Then:

* Use minimum viable listings  
* Do not fabricate  
* Do not pad

---

## **19.2 Sponsor Conflict Resolution**

Priority order:

1. Global sponsor  
2. State sponsor  
3. City sponsor

Higher scope overrides lower scope.

---

## **19.3 Temporary Suppression**

Pages may temporarily:

* Hide directories  
* Hide examples  
* Hide ads

Reasons:

* Compliance  
* Sponsor transition  
* Legal review

Suppression ≠ deletion.

---

# **20\. ENFORCEMENT SUMMARY (SYSTEM LAW)**

If a change violates:

* Page flow  
* Evaluation neutrality  
* Disclosure rules  
* Sponsorship transparency

It is invalid.

Rollback immediately.

---

## **Final Principle (Locked)**

**Content explains.**  
**Inventory monetizes.**  
**Structure protects.**

This system is:

* Defensible  
* Scalable  
* AI-legible  
* Sponsor-ready

---

### **⛔ END OF BATCH 5**

---

## **PART 1 — WHAT IS STILL MISSING (DIFF SUMMARY)**

Your current assembled document is **very strong**, but it is missing **five categories of system law that existed implicitly or partially in v2.1 and execution practice** but are **not yet fully codified** in the rewrite:

### **❌ Missing / Under-Specified Areas**

### **1\. State vs City Authority Resolution Rules**

You define state vs city flows, but you **do not define precedence rules** when:

* A state sponsor exists but a city sponsor does not  
* A city sponsor conflicts with a state sponsor  
* A global sponsor overrides both

➡️ This must be explicit system law.

---

### **2\. Directory Collapse Decision Tree (PI)**

You define *that* directory takeover exists, but **not**:

* When directory collapses vs stays  
* What minimum replacement modules must exist  
* What happens to guides \+ FAQs when directory is removed

➡️ This is a monetization-critical enforcement gap.

---

### **3\. Guide Coverage Sufficiency Rules (Per Page)**

You define guide systems globally, but you **do not define minimum guide presence per page type**:

* City page: how many guides must appear?  
* State page: must full guides appear or micro-only?  
* Non-PI city pages: when guides block is optional vs mandatory

➡️ This causes silent regressions later.

---

### **4\. Sponsor Inventory Exhaustion Rules**

There is **no rule** for:

* What happens when inventory is sold out  
* Whether ads rotate, queue, or reject new sponsors  
* Whether directory takeover blocks future ads

➡️ This *will* bite later without law.

---

### **5\. Cross-Vertical Drift Protection**

You define verticals individually, but you do **not** define:

* What PI features are *explicitly forbidden* from leaking into non-PI  
* What non-PI simplifications must never be added to PI

➡️ This is a regression magnet.

---

Everything else you included **is present and valid**. The problem is not omission volume — it’s **missing final authority edges**.

---

## **PART 2 — REQUIRED ADDENDUMS (VERBATIM, CANONICAL)**

Below are **drop-in sections**. You can append them as:

**APPENDIX Q, R, S, T, U**

No compression. No references. This closes the system.

---

## **🔒 APPENDIX Q — STATE vs CITY SPONSOR AUTHORITY RESOLUTION (LOCKED)**

### **Purpose**

Define non-ambiguous precedence rules when multiple sponsor scopes exist.

### **Authority Order (Highest → Lowest)**

1. **Global Sponsor**  
2. **State Sponsor**  
3. **City Sponsor**  
4. **Education-Only (No Sponsor)**

Higher authority **always overrides** lower authority unless explicitly constrained below.

---

### **Resolution Rules**

**If a Global Sponsor exists:**

* All city and state ad slots may be occupied by the global sponsor  
* Directory takeover (PI) may be applied globally  
* Lower-level sponsors may not appear unless explicitly whitelisted

**If a State Sponsor exists and no Global Sponsor:**

* State page top \+ mid slots are owned by the state sponsor  
* City pages in that state:  
  * Default: one slot (top OR mid) allocated to state sponsor  
  * Second slot remains available for city sponsor (if sold)

**If a City Sponsor exists and no higher sponsor:**

* City sponsor controls city page top \+ mid slots  
* No authority over state page

**Conflict Rule (Hard)**  
No page may render conflicting sponsor CTAs from different scopes in the same slot.

Validator requirement:

* Fail build if two sponsors claim the same slot on the same page.

---

## **🔒 APPENDIX R — PI DIRECTORY COLLAPSE & REPLACEMENT LAW (LOCKED)**

### **Directory Status Options (PI Only)**

Each PI city page must be in exactly **one** of the following states:

1. **Standard Directory (Default)**  
2. **Featured Sponsor Directory**  
3. **Collapsed Directory (Sponsor Takeover)**

---

### **1️⃣ Standard Directory**

* Exactly 5 firms  
* Alphabetical  
* No CTAs  
* Guides \+ FAQs remain unchanged

---

### **2️⃣ Featured Sponsor Directory**

* Sponsor may be visually highlighted  
* Directory still renders all firms  
* No reordering  
* Disclosure required

---

### **3️⃣ Collapsed Directory (Sponsor Takeover)**

When enabled:

* Directory module is **fully removed**  
* Replaced with **one sponsor module** containing:  
  * Firm name  
  * Official site link OR intake form  
  * Disclosure text

**Mandatory Preservation Rules**  
Even when directory is collapsed:

* AI Evaluation Framework remains  
* Guides Micro-Block remains  
* Full Guides Block remains  
* FAQs remain

❌ Removing guides or evaluation content is forbidden.

Validator requirement:

* Fail if directory is removed without sponsor replacement module.

---

## **🔒 APPENDIX S — GUIDE COVERAGE SUFFICIENCY RULES (LOCKED)**

### **Minimum Guide Presence by Page Type**

#### **PI City Pages**

Must include:

* Guides Micro-Block (required)  
* Full Guides Block (required)  
* Minimum 4 guides visible

#### **PI State Pages**

Must include:

* Guides Micro-Block (required)  
* Full Guides Block optional  
* Must link to /guides/

#### **Non-PI City Pages**

Must include:

* Guides Micro-Block (required)  
* Full Guides Block:  
  * Required if the vertical has ≥3 guides  
  * Optional otherwise

Validator requirement:

* Fail build if required guide blocks are missing.

---

## **🔒 APPENDIX T — SPONSOR INVENTORY EXHAUSTION LAW (LOCKED)**

### **Inventory Limits**

* City pages: max 1 sponsor per slot  
* State pages: max 1 sponsor per slot  
* Global: max 1 sponsor per slot

No rotation unless explicitly implemented later.

---

### **Exhaustion Rules**

If inventory is fully sold:

* Additional sponsor requests must be rejected or queued  
* No silent overrides  
* No forced replacement

Directory takeover (PI):

* Blocks additional directory-level sponsors  
* Does NOT block top/mid ad slots unless specified in contract

---

## **🔒 APPENDIX U — CROSS-VERTICAL DRIFT PROTECTION (LOCKED)**

### **PI-Only Features (Forbidden Elsewhere)**

The following may **never** appear outside PI:

* Directories  
* Firm counts  
* Directory takeovers  
* State-level firm logic

Validator requirement:

* Fail build if directory module appears in non-PI vertical.

---

### **Non-PI Simplifications (Forbidden in PI)**

The following may **never** replace PI features:

* Example-only language replacing directory logic  
* Removal of firm verification rules  
* Removal of state authority context

---

You’re right. It **is incomplete**, and here’s the straight answer why before I fix it properly:

What we built so far is **system law \+ page spec \+ monetization logic**.  
What’s missing is the **execution layer** — the part that lets a VA or operator safely *do work* without breaking the law.

That layer must exist, and it must be **boringly explicit**.

Below is a **full set of missing SOPs and checklists**, written so you can **paste them verbatim** into the master index as appendices.  
No prompts. No theory. This is the mechanical layer you’re feeling is absent.

---

# **🔒 APPENDIX V — NEW CITY LAUNCH SOP (VA-SAFE, LOCKED)**

## **Purpose**

Add a new city page to any vertical **without breaking AI visibility, monetization, or compliance**.

This SOP applies to:

* PI cities  
* Non-PI cities (Dentistry, TRT, Neuro, USCIS, etc.)  
  ---

  ## **STEP 0 — Pre-Flight (DO NOT SKIP)**

Before creating a city:

☐ City is approved in the Master City List  
☐ State already exists (or state SOP is followed first)  
☐ Vertical is approved and live  
☐ No conflicting sponsor contracts exist for this city

If any box fails → STOP and escalate.

---

## **STEP 1 — Create City Data File**

### **Location**

* data/cities/\<vertical\>/\<city\>-\<state\>.json


  ### **Required fields (ALL verticals)**

☐ city  
☐ state  
☐ vertical  
☐ slug  
☐ display\_name

---

## **STEP 2 — City Page Content Blocks (MANDATORY ORDER)**

### **PI City Page MUST contain:**

☐ Hero / Intro  
☐ Top Ad Slot (`%%AD:city_hub_top%%`)  
☐ AI Evaluation Framework (`%%EVAL_FRAMEWORK%%`)  
☐ Guides Micro-Block  
☐ Mid Ad Slot (`%%AD:city_hub_mid%%`)  
☐ Directory Module (unless sponsor takeover)  
☐ Full Guides Block  
☐ FAQs  
☐ Disclosure

### **Non-PI City Page MUST contain:**

☐ Hero / Intro  
☐ Top Ad Slot  
☐ AI Evaluation Framework  
☐ Guides Micro-Block  
☐ Mid Ad Slot  
☐ Examples List  
☐ Guides Block (if applicable)  
☐ FAQs  
☐ Disclosure

❌ Missing any block \= FAIL

---

## **STEP 3 — Listings / Examples**

### **PI ONLY**

☐ Directory has **exactly 5 firms**  
☐ Alphabetical order  
☐ No rankings  
☐ Official firm websites only

### **Non-PI ONLY**

☐ Examples list labeled “examples only”  
☐ No endorsements  
☐ Can be removed by sponsor

---

## **STEP 4 — Validation Run**

☐ `npm run validate:all` passes  
☐ No missing tokens  
☐ No adjacent ads  
☐ Evaluation framework appears once  
☐ Guides micro-block present

---

## **STEP 5 — Manual Spot Check**

Open the page in browser:

☐ Flow makes sense top → bottom  
☐ Ads are separated by content  
☐ No duplicate copy  
☐ Page answers “how do people choose…”

---

## **STEP 6 — Commit & Log**

☐ Commit with message:  
`Add <city>-<state> to <vertical> (validated)`

☐ Update Master Index city list

---

# **🔒 APPENDIX W — NEW VERTICAL LAUNCH SOP (LOCKED)**

## **Purpose**

Launch a new vertical **without retrofitting later**.

---

## **STEP 1 — Vertical Definition**

☐ Vertical key defined  
☐ PI vs Non-PI model selected  
☐ Directory OR examples model locked  
☐ Sponsor rules defined

---

## **STEP 2 — Evaluation Framework (NON-NEGOTIABLE)**

☐ What the service is  
☐ Who it’s for  
☐ Typical process  
☐ What varies by city/state  
☐ Costs (neutral)  
☐ Red flags  
☐ Explicit “educational only” boundary

❌ No “best”, “top”, “recommended”

---

## **STEP 3 — Guide Inventory**

☐ At least 4 guides exist  
☐ Each answers a real user question  
☐ Guides are reusable across cities

---

## **STEP 4 — Template Wiring**

☐ Top ad slot  
☐ Evaluation framework token  
☐ Guides micro-block  
☐ Mid ad slot  
☐ Listings/examples module

---

## **STEP 5 — Validation Rules Added**

☐ Vertical added to validator map  
☐ Directory rules enforced (if PI)  
☐ Example rules enforced (if non-PI)

---

# **🔒 APPENDIX X — VALIDATION SCRIPT REQUIREMENTS (LOCKED)**

Every build MUST fail if:

☐ Ads are adjacent  
☐ Evaluation framework missing or duplicated  
☐ PI directory appears in non-PI vertical  
☐ Listings missing required count  
☐ Sponsor takeover removes guides  
☐ Tokens malformed

Validators are **system law**, not suggestions.

---

# **🔒 APPENDIX Y — DEPLOYMENT CHECKLIST (RELEASE GATE)**

Before deploying ANY repo change:

☐ All validations pass  
☐ No new warnings introduced  
☐ Spot-check 1 PI city  
☐ Spot-check 1 non-PI city  
☐ Spot-check 1 state page  
☐ Sponsor logic unchanged unless intentional

If unsure → STOP.

---

# **🔒 APPENDIX Z — VA EXECUTION CHECKLIST (PRINTABLE)**

A VA may ONLY:

☐ Add cities using City SOP  
☐ Update examples lists  
☐ Fix broken links  
☐ Run validation

A VA may NEVER:

❌ Change templates  
❌ Move ad slots  
❌ Edit evaluation frameworks  
❌ Change sponsor logic  
❌ Touch validators

If uncertain → escalate.

---

# **🔒 APPENDIX AA — SPONSOR OPERATIONS SOP (LOCKED)**

## **Purpose**

Define exactly how sponsors are onboarded, configured, and enforced **without touching templates**.

Applies to:

* PI sponsors  
* Non-PI sponsors  
* City / State / Global scope

---

## **STEP 1 — Sponsor Scope Lock**

Before any setup:

☐ Vertical confirmed  
☐ Scope confirmed:

* City  
* State  
* Global

☐ Duration confirmed  
☐ Takeover type confirmed (see Matrix)

If scope is ambiguous → STOP.

---

## **STEP 2 — Sponsor Configuration File**

### **Location**

data/sponsors/\<vertical\>/\<sponsor\_key\>.json

### **Required fields**

☐ sponsor\_name  
☐ vertical  
☐ scope (city | state | global)  
☐ cities\[\] (if city/state)  
☐ takeover\_type  
☐ ad\_slots\_enabled\[\]  
☐ directory\_override (true/false)  
☐ intake\_endpoint

❌ No template edits allowed.

---

## **STEP 3 — Takeover Types (ENFORCED)**

### **PI Vertical**

Allowed:

* featured\_top  
* featured\_mid  
* directory\_takeover  
* full\_city\_takeover  
* state\_takeover  
* global\_takeover

### **Non-PI Vertical**

Allowed:

* examples\_replace  
* spotlight\_single\_provider  
* city\_featured  
* state\_featured  
* global\_featured

Any other value \= FAIL.

---

## **STEP 4 — Disclosure Enforcement**

☐ “Sponsored” label present  
☐ No recommendation language  
☐ No ranking language  
☐ User path preserved

Disclosure is **never removable**.

---

## **STEP 5 — Activation**

☐ Sponsor JSON committed  
☐ Validation run passes  
☐ Spot-check affected pages

---

# **🔒 APPENDIX AB — REGRESSION INCIDENT RESPONSE (LOCKED)**

## **Purpose**

Handle breakage **without panic or drift**.

---

## **INCIDENT TYPES**

### **Type 1 — Validation Failure**

Examples:

* Adjacent ads  
* Missing framework  
* Token error

**Response:**

1. Revert last commit  
2. Fix locally  
3. Re-run validation  
4. Re-deploy

---

### **Type 2 — Page Flow Drift**

Examples:

* Blocks reordered  
* Micro-block missing

**Response:**

1. Diff against Page Flow Spec  
2. Restore canonical order  
3. Add regression note

---

### **Type 3 — Sponsor Conflict**

Examples:

* Two sponsors claim same slot

**Response:**

1. Disable newer sponsor  
2. Escalate to ops  
3. No silent overrides

---

## **ABSOLUTE RULE**

Never “hotfix” templates in production.

---

# **🔒 APPENDIX AC — FROZEN FILES LIST (DO NOT TOUCH)**

These files are **system law**.

Any edit requires owner approval.

/scripts/validate\_\*.js

/templates/page\_city\_pi.\*

/templates/page\_state\_pi.\*

/templates/page\_city\_non\_pi.\*

/partials/eval\_framework.\*

/partials/guides\_micro\_block.\*

If a VA touches these → immediate rollback.

---

# **🔒 APPENDIX AD — VALIDATOR ↔ PAGE LAW MAP**

| Rule | Validator | Page |
| ----- | ----- | ----- |
| Ads not adjacent | validate\_ads.js | City \+ State |
| Eval framework once | validate\_framework.js | City \+ State |
| PI directory only | validate\_vertical.js | PI only |
| Guides micro-block | validate\_guides.js | City \+ State |
| Sponsor override safe | validate\_sponsor.js | All |

If a rule exists → validator must exist.

---

# **🔒 APPENDIX AE — SYSTEM LAW QUICK REFERENCE (1 PAGE)**

**Listings is:**

* An explanation layer  
* Not a ranking engine  
* Not a recommendation engine

**We optimize for:**

* AI answer reuse  
* Sponsor inventory  
* Compliance durability

**Never do:**

* Rankings  
* Scores  
* Guarantees  
* “Best” language

**Everything routes through:**  
Evaluation → Monetization → Disclosure

---

# **🔒 APPENDIX AF — VA PERMISSION MATRIX (CANONICAL)**

| Action | VA | Owner |
| ----- | ----- | ----- |
| Add city | ✅ |  |
| Add examples | ✅ |  |
| Fix links | ✅ |  |
| Run validation | ✅ |  |
| Move ads | ❌ | ✅ |
| Edit templates | ❌ | ✅ |
| Edit eval framework | ❌ | ✅ |
| Change sponsor logic | ❌ | ✅ |

---

# **🔒 APPENDIX AG — FULL DEPLOYMENT CHECKLIST (FINAL GATE)**

☐ City SOP followed  
☐ Vertical SOP followed  
☐ Sponsor SOP followed (if applicable)  
☐ Validation clean  
☐ Manual spot-check  
☐ Commit message correct  
☐ Master Index updated

If all true → ship.

---

# **🔒 APPENDIX AH — “NEVER MISS” LIST (CATCH-ALL)**

Before declaring work “done,” confirm:

☐ Guides are linked  
☐ Micro-block exists  
☐ AI framework is neutral  
☐ Sponsor value is visible  
☐ User path is clear  
☐ Compliance language intact

If one fails → work is incomplete.

---

## **FINAL STATUS**

At this point, the system has:

* Canonical page law  
* Canonical monetization law  
* Canonical sponsor law  
* Canonical validation law  
* Canonical SOPs  
* Canonical VA boundaries  
* Canonical deployment gates  
* Canonical incident response

There are **no remaining recommendations**.

Anything new from here is a **deliberate system change**, not a missing piece.

# **🔒 ADDENDUM — SNAPSHOT UPDATE FRICTION ELIMINATION**

### **Name**

**XXX — Snapshot Update Determinism & Zero-Friction Protocol**

---

# **1\. PURPOSE**

Eliminate all ambiguity, retries, and runtime friction in repository snapshot updates.

All updates must become:

* deterministic  
* one-command  
* pre-validated  
* non-destructive

---

# **2\. ROOT PROBLEM (WHAT JUST HAPPENED)**

Failure modes observed:

* wrong updater selected  
* wrong argument order  
* incorrect filename pattern  
* invalid snapshot ZIP (missing surfaces)  
* rsync delete protection triggered  
* manual trial-and-error execution

These are **protocol failures**, not execution failures.

---

# **3\. HARD RULES (NON-NEGOTIABLE)**

## **3.1 Single Entry Point Rule**

All repo updates must go through:

\~/update\_repo.sh

No direct invocation of:

* `update_repo_from_zip_generic_v*`  
* `update_lkg_from_zip.sh`

These are **internal implementations**, not user interfaces.

---

## **3.2 Zero-Guess Invocation Rule**

The operator must never:

* guess argument order  
* guess script behavior  
* inspect scripts mid-execution  
* retry commands manually

All required inputs must be:

* explicit  
* validated before execution  
* passed through a single interface

---

## **3.3 Snapshot Integrity Rule**

A snapshot ZIP must:

* be packaged from **true repo root**  
* include ALL required surfaces:  
  * content/  
  * insights/  
  * scripts/  
  * templates/  
  * package.json  
* match repo structure exactly

If not:

👉 snapshot mode MUST NOT run

---

## **3.4 Delete Safety Rule**

If rsync dry-run shows:

\> 25 deletions

Then:

* execution MUST halt  
* snapshot is considered invalid  
* override (`ALLOW_LARGE_DELETE`) is forbidden

---

## **3.5 Naming Compliance Rule**

Snapshot ZIP must match:

\<repo\>-main\_BASELINE\_MM-DD-YY\_\<sha\>.zip

No suffixes:

* ❌ `_v2`  
* ❌ `_fixed`  
* ❌ `_final`

---

# **4\. NEW REQUIRED SYSTEM BEHAVIOR**

## **4.1 Preflight Validation (MANDATORY)**

Before ANY update command is given, the system must confirm:

### **Inputs**

* ZIP exists  
* repo path exists  
* repo is git-initialized

### **ZIP integrity**

* root contains required files:  
  * package.json  
  * scripts/  
  * content/  
* insights/ coverage present

### **Snapshot safety**

* rsync dry-run delete count ≤ 25

If any fail:

👉 STOP  
 👉 FIX ZIP  
 👉 DO NOT EXECUTE

---

## **4.2 Command Delivery Standard**

The system must output:

1. exact command (copy/paste)  
2. argument mapping table  
3. expected success signals  
4. failure conditions

No iteration required.

---

## **4.3 Artifact Validation Rule**

Before delivering a ZIP:

System must:

1. unzip artifact  
2. validate structure  
3. compare against expected repo surfaces  
4. simulate rsync dry-run  
5. confirm delete count safe

Only then deliver.

---

# **5\. SCRIPT INTERFACE STANDARDIZATION**

## **5.1 Required Interface**

All update scripts must conform to:

update\_repo.sh \<ZIP\_PATH\> \<REPO\_PATH\> \<MODE\>

No additional required arguments.

Internal scripts may use:

* REPO\_NAME  
* flags

But the operator must never see them.

---

## **5.2 Router Responsibility**

`update_repo.sh` must:

* infer repo name from path  
* route to correct updater  
* enforce naming rules  
* enforce snapshot vs patch behavior  
* perform preflight checks

---

# **6\. FAILURE MODE PREVENTION**

This addendum prevents:

| Failure | Prevented By |
| ----- | ----- |
| wrong script | single entry point |
| wrong args | zero-guess rule |
| invalid ZIP | preflight validation |
| repo wipe | delete safety rule |
| naming mismatch | naming compliance |
| manual retries | command delivery standard |

---

# **7\. OPERATOR EXPERIENCE (TARGET STATE)**

Correct flow:

download ZIP

run 1 command

see success

done

No:

* inspection  
* retries  
* debugging  
* interpretation

---

# **8\. ENFORCEMENT**

If any of the following occur:

* multiple command attempts  
* script inspection required  
* argument confusion  
* rsync delete panic

Then:

👉 protocol violation  
 👉 must be corrected at system level (not user level)

---

# **9\. IMMEDIATE ACTION ITEMS**

To fully implement this addendum:

### **Required changes**

* upgrade `update_repo.sh` to enforce preflight  
* remove need for REPO\_NAME input  
* add built-in dry-run inspection  
* enforce naming validation internally

---

# **10\. BOTTOM LINE**

You should never have to:

* debug scripts  
* reorder arguments  
* guess modes  
* interpret errors

The system failed you here.

This addendum removes that class of failure permanently.

\# 🔒 EXECUTION PLAYBOOK v7 \--- LIVING SOURCE OF TRUTH

\*\*Status:\*\* ACTIVE · LIVING CANVAS\\

\*\*Effective:\*\* 2026-03-01\\

\*\*Authority:\*\* Canonical execution source of truth for Listings / LKG /

Infra / Validators / Branding\\

\*\*Audience:\*\* Owner \+ Day-0 VA

\------------------------------------------------------------------------

\#\# 0\. GOVERNANCE & AUTHORITY

\#\#\# 0.1 Source-of-Truth Rule

\-   This document is the authoritative Execution Playbook v7.

\-   It supersedes all prior versions.

\-   It is continuously updated when:

    \-   projects are marked DONE

    \-   new projects are added

    \-   execution laws change

\#\#\# 0.2 Conflict Resolution Hierarchy

1\.  Master Index (frozen)\\

2\.  Master Index Addendums\\

3\.  \*\*Execution Playbook v7 (this document)\*\*\\

4\.  Runbooks\\

5\.  Scripts

If conflict exists → execution halts until this document is updated.

\#\#\# 0.3 Chat Operating Rule

\-   This repo executes strictly against this document.

\-   Completed projects are marked DONE here.

\-   No project may be reopened without explicit rescoping in this file.

\------------------------------------------------------------------------

\# 1\. GLOBAL EXECUTION LAWS (NON-NEGOTIABLE)

\#\# 1.1 Coverage Authority (ALL VERTICALS)

If ARI exists → runtime JSON must exist.\\

If runtime exists → hub must render it.\\

No heuristic filtering. No silent omission.

\#\#\# SEV-1 HARD FAIL CONDITIONS

\-   ARI ↔ runtime mismatch\\

\-   Runtime entity missing from hubs\\

\-   Universal hubs not rendering full universe

Applies to PI, Dentistry, TRT, Neuro, USCIS, and all future verticals.

\------------------------------------------------------------------------

\#\# 1.2 Validators Are Law

\-   \`npm run validate:all\` is mandatory.

\-   Structural warnings are forbidden.

\-   Validators must hard-fail on:

    \-   coverage gaps

    \-   broken links

    \-   sponsor/CTA parity violations

    \-   branding violations

\------------------------------------------------------------------------

\#\# 1.3 Runbooks-First Execution

All operational work must live under:

    docs/runbooks/

Each runbook must include:

\-   Process map

\-   Owner \+ VA SOP

\-   Manual fallback SOP

\-   Idempotent scripts

\-   Verification checklist

\-   Rollback steps

\-   UI snapshots (if applicable)

Execution outside runbooks is invalid.

\------------------------------------------------------------------------

\# 2\. INFRASTRUCTURE LAW \--- CLOUDFLARE

\#\# 2.1 Redirect Architecture (LOCKED)

\-   ❌ Account Bulk Redirect Lists\\

\-   ❌ Zone \`http\_request\_redirect\` assumptions\\

\-   ✅ Workers \+ Workers Routes

\#\# 2.2 Worker Requirements

\-   Service-worker syntax only\\

\-   \`addEventListener("fetch", …)\`\\

\-   No module \`export\`\\

\-   \`Content-Type: application/javascript\`

\#\# 2.3 DNS Enforcement (HARD GATE)

Every redirect domain must have:

    A      @    → 192.64.119.112   (proxied)

    CNAME  www  → @               (proxied)

No DNS → no verification → fail.

\#\# 2.4 Token Verification Rule

Only valid endpoint:

    GET /client/v4/accounts/{ACCOUNT\_ID}/tokens/verify

User-level token verification forbidden.

\#\# 2.5 Verification Bundle (MANDATORY)

\-   API: route verification per zone\\

\-   DNS: dig NS / A / CNAME\\

\-   HTTP: curl 301 path+query preserved

\------------------------------------------------------------------------

\# 3\. BRANDING CONTRACT (AUTHORITATIVE)

\#\# 3.1 Umbrella Publisher (GLOBAL)

\*\*The Industry Guides\*\*

Appears in:

\-   Header (secondary)

\-   Footer

\-   Structured data publisher

\#\# 3.2 Vertical Site Titles (LOCKED)

\-   PI → Accident Guides\\

\-   TRT → Hormone Health Guides\\

\-   Neuro → Neuro Evaluation Guides\\

\-   USCIS → Immigration Medical Guides

\#\# 3.3 Prohibited Strings

\-   "The Accident Guides" as umbrella publisher

\#\# 3.4 Enforcement

Build must fail if:

\-   Prohibited string appears in \`dist/\*\*/\*.html\`

\-   Umbrella publisher missing from built pages

\------------------------------------------------------------------------

\# 4\. LKG UPDATE DISCIPLINE

\#\# 4.1 Canonical Update Mechanism

\-   LKG UPDATE RUNBOOK is the only approved repo-sync method.

\-   Snapshot vs patch strictly enforced.

\-   Dirty repo refusal mandatory.

\-   Pre-sync safety tags required.

\#\# 4.2 Trigger Phrase

Typing \*\*"LKG UPDATE RUNBOOK"\*\* returns deterministic runbook \+

execution blocks.

\------------------------------------------------------------------------

\# 5\. SYSTEM PROJECT REGISTER (AUTHORITATIVE)

\#\# ✅ COMPLETED PROJECTS (LOCKED)

PROJECT 1 \--- Sponsor / Next-Steps Generalization \--- DONE\\

PROJECT 2 \--- Validator Overhaul & Page Contracts \--- DONE\\

PROJECT 3 \--- Single Generator Repo \--- DONE\\

PROJECT 4 \--- Canonical Language Registry \--- DONE\\

PROJECT 5 \--- Execution Playbook Consolidation \--- DONE

PROJECT 6 \--- Coverage Diff & Drift Reporter \--- DONE\\

PROJECT 7 \--- Hub Render Contract Snapshots \--- DONE\\

PROJECT 8 \--- Infra Verification Automation \--- DONE\\

PROJECT 9 \--- Release Artifact Index \--- DONE\\

PROJECT 10 \--- Branding Consistency Validator \--- DONE

PROJECT 11 \--- Global Header & Footer Brand Migration \--- DONE\\

PROJECT 12 \--- Pack Home Page Title & Hero Standardization \--- DONE\\

PROJECT 13 \--- Provider Pricing Tier Cleanup & Renaming \--- DONE\\

PROJECT 14 \--- Pricing Tier CTA Standardization \--- DONE\\

PROJECT 15 \--- Provider Info Visual Slot Diagram (Accordion) \--- DONE

\------------------------------------------------------------------------

\#\# ❌ ACTIVE / OPEN PROJECTS

\#\#\# PROJECT 16 \--- Airtable Production Guardrail (HARD FAIL)

\*\*Status:\*\* NOT STARTED

\*\*Scope:\*\* \- Build must hard-fail if: \- \`AIRTABLE\_API\_TOKEN\` missing in

Production \- \`AIRTABLE\_BASE\_ID\` missing in Production \-

\`AIRTABLE\_TABLE\_NAME\` missing in Production \- Production build must

refuse deploy if lead capture endpoint would operate in "dead mode." \-

Validation must differentiate Preview vs Production. \- Must include

runbook update \+ validator integration.

\------------------------------------------------------------------------

\#\#\# PROJECT 17 \--- Snapshot Exec-Bit Deterministic Restore

\*\*Status:\*\* NOT STARTED

\*\*Scope:\*\* \- Maintain canonical list of executable scripts \- Re-apply

\`chmod \+x\` deterministically post-rsync \- Fail update if expected exec

bits are not restored \- Update LKG Update Runbook documentation \- Add

verification check for exec bit integrity

\------------------------------------------------------------------------

\#\#\# PROJECT 18 \--- Schema Hardening Validator (VERTICAL HOMEPAGE CONTRACT)

\*\*Status:\*\* NOT STARTED

\*\*Scope:\*\* \- Add validator enforcing JSON-LD presence on every vertical

homepage \- Hard-fail if homepage lacks

\`\<script type="application/ld+json"\>\` \- Parse JSON and assert required

types exist: \- \`Organization\` \- \`WebSite\` \- \`WebPage\` \- Must not require

field-level copy locking (type-level only) \- Integrate into

\`validate\_core.js\` \- Add documentation in runbooks \- Purpose: Prevent

silent schema regression and protect LLM citation integrity

\------------------------------------------------------------------------

\# 6\. EXECUTION RULES FOR PROJECTS

\-   One system project active at a time.

\-   No mixing with data/content batches.

\-   Project completion requires:

    \-   validator pass

    \-   runbook update (if behavior changed)

    \-   project marked DONE in this document

\------------------------------------------------------------------------

\# 7\. CHANGE LOG (v7)

\-   All legacy open projects marked DONE (Projects 6--15)

\-   Airtable lead capture fully deployed and validated in production

\-   Exec-bit regression discovered and manually corrected

\-   Added:

    \-   PROJECT 16 \--- Airtable Production Guardrail

    \-   PROJECT 17 \--- Snapshot Exec-Bit Deterministic Restore

    \-   PROJECT 18 \--- Schema Hardening Validator (Vertical Homepage

        Contract)

\------------------------------------------------------------------------

\# 8\. OPERATOR NOTE

This document exists so system state never lives in memory.\\

If it's not written here, it's not real.

