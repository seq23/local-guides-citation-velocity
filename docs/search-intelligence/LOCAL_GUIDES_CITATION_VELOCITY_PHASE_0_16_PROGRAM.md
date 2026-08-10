# LOCAL GUIDES CITATION VELOCITY
# REVISED FULL IMPLEMENTATION PROGRAM

## Objective

Bring `local-guides-citation-velocity` to the optimal target identified by Claude while adding:

- a p-n-p-style closed-loop Query/Search Intelligence system
- SEO / AEO / GEO diagnosis and feedback
- bounded self-healing
- delayed retesting and outcome truth
- verified external citation accounting
- strong separation from the existing Agent Runs system
- validator simplification and anti-petty-blocker governance
- deep validation of the full resulting system

The existing Agent Runs process remains intact.

The final artifact should implement **all phases**, not only Phase 1–2.

---

# PHASE 0 — VALIDATOR SIMPLIFICATION + RELEASE-GATE RATIONALIZATION

## Goal

Make the validation system proportionate to what Local Guides is actually building.

The principle is:

> Validators should block real risk, not developer inconvenience.

The repo should retain strong validation, but remove:

- duplicate validators
- overlapping validators that prove the same thing
- validators based on brittle exact strings
- hard failures on cosmetic conditions
- exact-count assumptions that naturally change with generated content
- validators that require generated/runtime artifacts to already exist in a clean baseline
- failures caused solely by missing optional provider credentials
- historical-content debt blocking unrelated safe work
- warnings incorrectly behaving like release failures

---

## 0.1 — FULL VALIDATOR INVENTORY

Build one machine-readable inventory of every validator.

For each validator record:

```text
validator_id
script
file
purpose
proof_layer
severity
blocks_release
dependencies
external_provider_required
generated_state_required
overlaps_with
failure_materiality
recommended_action
```

Classify every validator as:

```text
KEEP_HARD_FAIL
KEEP_WARNING
MERGE
SIMPLIFY
RETIRE
REWRITE
```

---

# 0.2 — MATERIALITY LAW

A validator may be a **HARD FAIL** only when failure means one of these things:

### Repository integrity
- build cannot complete
- required route/file is absent
- malformed governed data
- invalid schema that runtime depends upon

### Public runtime integrity
- material route 404/500
- redirect loop
- wrong canonical ownership
- broken sitemap/robots contract
- broken critical navigation
- deployment artifact is invalid

### Agent provenance integrity
- Agent Runs history altered improperly
- source records disappear
- normalized-agent accounting breaks
- existing agent lineage cannot be reproduced

### Search Intelligence truth integrity
- fake external evidence
- `UNKNOWN` treated as `PASS`
- improvement claimed without before/after evidence
- repair counted without actual file mutation
- query has conflicting canonical owners
- telemetry values fabricated

### Regulated-content integrity
- unsupported regulated factual claim
- required source missing
- prohibited guarantee
- required disclaimer missing where governed

### Self-healing safety
- protected path touched
- repair outside allowed scope
- no before snapshot
- rollback provenance unavailable
- mutation occurs during cooldown without authorized exception

### Security required for existing functionality
Only if failure actually breaks an existing functional security boundary.

Generic hardening should not become a release blocker.

---

# 0.3 — STRONG WARNING CLASS

These should generally warn rather than stop release:

- cosmetic HTML differences
- optional metadata polish
- minor accessibility polish without functional breakage
- stale but non-authoritative documentation
- optional provider not configured
- missing GSC credentials
- missing Bing credentials
- missing optional competitor telemetry
- external observation unavailable
- low-content-performance signal
- imperfect keyword alignment
- weak CTR
- old content needing refresh
- historical duplicate debt not touched by current artifact
- noncritical image optimization
- recommendations about future improvements

Warnings must remain visible.

They simply should not behave like catastrophic release failures.

---

# 0.4 — INFO / OBSERVATION CLASS

Some things are not failures at all.

Examples:

```text
GSC_NOT_CONFIGURED
BING_NOT_CONFIGURED
NO_EXTERNAL_CITATION_EVIDENCE
NO_RETEST_DATA_YET
INCONCLUSIVE
NO_QUERY_SIGNAL
NO_AGENT_SIGNAL
```

These should be recorded as truthful states.

They should never be converted into:

```text
PASS
```

and should never automatically become:

```text
FAIL
```

unless the current operation specifically requires that provider.

---

# 0.5 — REMOVE BRITTLE VALIDATION PATTERNS

Audit and replace validators that depend on things like:

### Exact page counts

Bad:

```text
expected exactly 2439 pages
```

Better:

```text
all admitted pages exist
all generated routes are represented in route manifest
no unexpected route ownership conflict exists
```

### Exact strings

Bad:

```text
page must contain exact sentence X
```

unless the sentence itself is a governing legal requirement.

Better:

Validate the actual semantic/structural requirement:

```text
required disclosure block exists
required source reference exists
required direct-answer region exists
```

### Generated artifacts required in baseline ZIP

If:

```text
.build/
dist/
cache/
generated runtime receipt
```

is supposed to be produced during build, the clean snapshot validator should not require it before build.

Instead:

```text
source contract
→ build
→ generated-output validator
```

---

# 0.6 — ELIMINATE DUPLICATE VALIDATION

Where multiple validators prove the same property:

```text
merge or establish one authoritative validator
```

Examples likely to inspect carefully:

- route integrity
- canonical ownership
- sitemap coverage
- page-count parity
- source registry
- disclosure coverage
- query ownership
- generated page integrity
- workflow inventory

Do not run the same substantive check three times under different names.

---

# 0.7 — VALIDATOR REGISTRY

Create one authoritative registry:

```text
_repo_validation_registry.json
```

or use the repo's existing registry if already present.

Each validator declares:

```text
id
script
severity
blocks_release
proof_layer
requires_provider
requires_build
```

The orchestrator reads this registry.

No hardcoded second severity system.

---

# 0.8 — SEVERITY-AWARE ORCHESTRATOR

Expected behavior:

## HARD_FAIL

```text
run
↓
failure
↓
stop relevant release
```

## STRONG_WARNING

```text
run
↓
failure
↓
record
↓
continue
```

## INFO

```text
record state
↓
continue
```

At completion produce one summary:

```text
hard_failures
warnings
informational_states
passed
provider_unavailable
not_applicable
```

---

# 0.9 — ANTI-PETTY-BLOCKER TEST PACK

The validator system itself must be tested.

Required cases:

1. cosmetic warning fails → release continues
2. optional provider absent → release continues as NOT_CONFIGURED
3. real canonical conflict → release blocks
4. Agent Run protected path mutation → blocks
5. unsupported regulated claim → blocks
6. missing external telemetry → INCONCLUSIVE
7. historical thin page unrelated to current repair → does not block unrelated safe release
8. newly created thin page → blocks
9. repair claims APPLIED without changing file → blocks
10. build-generated file missing before build → does not block
11. required build output missing after build → blocks
12. duplicate validators in registry → governance validator fails
13. unregistered blocking validator → governance validator fails
14. STRONG_WARNING incorrectly marked blocksRelease=true → governance validator fails
15. UNKNOWN accidentally interpreted as healthy → blocks

---

# PHASE 1 — AGENT-RUN SEPARATION CONTRACT

Preserve the current Agent Runs process exactly.

Protected areas include all real current equivalents of:

```text
data/report_fixes/agent_runs/**
data/report_fixes/normalized_agent_runs/**
data/report_fixes/source_record_ledgers/**
data/report_fixes/agent_exact_semantic_manifests/**
agent acceptance manifests
agent processing libraries
```

Add a separation validator proving that Search Intelligence cannot mutate these paths.

Search Intelligence may consume agent outputs read-only.

---

# PHASE 2 — TARGET QUERY + PERFORMANCE TRUTH LAYER

Build:

```text
target_query_set.json
provider_truth_snapshot.json
gsc_truth.json
live_search_observations.json
```

Each monitored query receives one canonical page owner.

Inputs include:

- current pages
- known search queries
- GSC
- Agent Run gaps
- priority verticals
- weak-answer pages
- indexing opportunities
- content-refresh needs
- competitor gaps where evidence exists

No fabricated external evidence.

---

# PHASE 3 — SEO / AEO / GEO DIAGNOSIS

Build an actual diagnosis engine.

## SEO

Evaluate:

- ownership
- canonical
- title
- H1
- internal links
- crawlability
- sitemap
- indexability
- cannibalization
- freshness
- local intent
- content depth

## AEO

Evaluate:

- direct answer quality
- extraction clarity
- query match
- tables/lists
- answer completeness
- concise definitions
- question structure
- weak boilerplate

## GEO

Evaluate:

- entity clarity
- organization/publisher identity
- schema
- source coverage
- claim coverage
- methodology
- local entity relationships
- citation readiness

## Content quality

Evaluate:

- thinness
- duplication
- stale sources
- placeholder text
- generated slop
- unsupported claims
- factual freshness

Output:

```text
search_diagnosis.json
```

---

# PHASE 4 — REPAIR CANDIDATE ENGINE

Translate diagnosis into bounded actions.

Every repair candidate must identify:

```text
repair_id
query_id
target_route
diagnosis
repair_type
before_evidence
source_basis
risk_class
allowed_mutation
expected_outcome
cooldown
```

Default preference:

```text
REPAIR EXISTING PAGE
```

before:

```text
CREATE NEW PAGE
```

when an existing page already owns the intent.

---

# PHASE 5 — REAL SELF-HEALING ENGINE

The system must actually modify defective content.

It must not repeat the WPP bug where:

```text
100 repair decisions
```

meant zero repaired files.

A repair counts only when:

```text
file actually changed
+
repair requirement is present
+
page passes quality gates
+
protected agent paths unchanged
+
receipt written
```

Auto-repair classes:

- metadata
- internal links
- direct-answer structure
- structural data
- breadcrumbs
- canonical links
- sitemap consistency
- source-backed factual improvement
- formatting
- stale internal references

Blocked/review classes:

- unsupported medical claims
- unsupported legal claims
- immigration interpretation
- new statistics without sources
- volatile claims
- guarantees
- speculative factual content

---

# PHASE 6 — REGULATED CONTENT SAFETY

Replace Claude's identified regex-heavy safety weakness with a real layered model.

Each regulated claim must satisfy:

```text
classification
+
claim registry
+
accepted source
+
appropriate wording
+
required disclosure
```

Unknown claim support:

```text
BLOCK_NEEDS_REVIEW
```

not generated filler.

---

# PHASE 7 — POSTDEPLOY PUBLIC VALIDATION

Claude specifically flagged that postdeploy Playwright existed but was not scheduled.

Fix this.

Run postdeploy checks:

- after deploy
- scheduled periodically

Check representative verticals and page families.

Material hard failures only.

Cosmetic issues go to warnings.

---

# PHASE 8 — POST-PUSH CI RED ALERT LOOP

When an automation writes to `main` and exact-SHA validation subsequently fails:

```text
CI RED
↓
record failure
↓
open/update governed GitHub issue or alert receipt
↓
mark automation health RED
↓
prevent system from assuming last release was healthy
```

Once recovered:

```text
RED → RECOVERED
```

with exact SHA evidence.

---

# PHASE 9 — DELAYED RETEST LOOP

Every actual repair gets:

```text
before evidence
repair
deployment
immediate validation
retest due date
delayed external observation
```

Outcome must be:

```text
IMPROVED
UNCHANGED
REGRESSED
INCONCLUSIVE
```

No real external data:

```text
INCONCLUSIVE
```

---

# PHASE 10 — ANTI-THRASH + REGRESSION RECOVERY

Default repair cooldown:

```text
14 days
```

unless:

- broken route
- canonical failure
- regulated factual risk
- owner override

Rollback only when exact before-state provenance proves the repair can be safely reversed.

No broad resets.

---

# PHASE 11 — VERIFIED EXTERNAL CITATION LEDGER

Implement Claude's missing citation proof layer.

Add:

```text
verified_external_citations.json
```

Only verified external events count.

Do not infer citations from:

- publication
- IndexNow
- impressions
- Agent Runs
- internal links
- LLM test prompts

---

# PHASE 12 — AUTHORITY / VELOCITY FEEDBACK

Feed observed outcomes back into the existing Local Guides authority and citation-velocity systems.

Feedback may influence:

- refresh priority
- query priority
- internal-link priority
- vertical focus
- source refresh
- page repair priority

It may not override:

- canonical rules
- regulated-content gates
- Agent Run provenance
- page admission
- duplicate checks
- existing publishing governance

---

# PHASE 13 — AGENT ↔ SEARCH INTELLIGENCE BRIDGE

Agent Runs remain an independent source.

Search Intelligence may correlate:

```text
agent identified gap
+
GSC shows query demand
+
page has weak answer
```

and choose:

```text
REPAIR_EXISTING_PAGE
```

But Search Intelligence never rewrites Agent Run records.

---

# PHASE 14 — SEO / AEO / GEO OPERATOR SCORECARD

Separate performance dimensions.

Do not create one meaningless aggregate score.

Display:

```text
SEO
AEO
GEO
CONTENT QUALITY
EXTERNAL EVIDENCE
AGENT SIGNAL
RETEST STATUS
```

For each priority route/query.

---

# PHASE 15 — CLOSED-LOOP WORKFLOW

Final workflow:

```text
TARGET QUERY SET
        ↓
REAL PROVIDER SIGNALS
        ↓
OBSERVE
        ↓
SEO/AEO/GEO DIAGNOSE
        ↓
AGENT SIGNAL CORRELATION
        ↓
REPAIR EXISTING PAGE
        ↓
QUALITY + SAFETY GATES
        ↓
DEEP VALIDATION
        ↓
DEPLOY
        ↓
POSTDEPLOY
        ↓
DELAYED RETEST
        ↓
IMPROVED / UNCHANGED / REGRESSED / INCONCLUSIVE
        ↓
AUTHORITY FEEDBACK
        ↓
NEXT PRIORITY
        ↺
```

This is the satisfactory closed loop.

---

# PHASE 16 — FULL DEEP VALIDATION

Before delivery, validate the entire resulting repository.

## Repository

- ZIP integrity
- correct root
- identity
- protected path hashes
- no generated junk
- no accidental dependency/runtime directories

## Existing Agent system

- Agent Runs continue processing
- normalized artifacts unchanged in contract
- source-record accounting intact
- existing agent validators pass

## Validator governance

- inventory complete
- duplicate validators resolved
- severity model tested
- anti-petty-blocker tests pass
- warnings do not block
- material hard failures do block

## Search Intelligence

- target queries
- query ownership
- provider truth
- no fake telemetry
- diagnosis
- repair candidates
- real mutations
- protected paths untouched
- cooldown
- retest
- outcomes
- rollback eligibility
- authority feedback

## SEO

- canonical
- titles
- H1
- internal linking
- sitemap
- robots
- duplicate ownership
- local intent

## AEO

- direct answers
- extraction
- tables/lists
- answer completeness

## GEO

- entity clarity
- schema
- source/claim relationships
- publisher identity
- citation readiness

## Safety

- regulated claims
- source support
- disclaimers
- no unsupported guarantees

## Build

Run full native build.

## Browser

Run full applicable Playwright/public-route validation.

## Workflows

Validate:

- YAML
- schedules
- permissions
- emergency stop
- agent separation
- Search Intelligence boundaries
- postdeploy
- CI-red alerting

## Final artifact

Only after deep validation:

```text
local-guides-citation-velocity-main_BASELINE_MM-DD-YY_<hash>.zip
```

Then reopen the ZIP and rerun package-level sanity checks.

---

# FINAL INTENDED STATE

Local Guides will have:

### Existing system
Its current Agent Runs process, intact.

### New system
A separate query/Search Intelligence system capable of:

```text
observe
diagnose
repair
validate
deploy
retest
learn
```

### Governance
A simplified validator system that:

```text
blocks material failures
warns on nonmaterial issues
records unknowns truthfully
does not become petty
does not become brittle
```

### Performance loop
SEO, AEO, GEO, citations, Agent Run intelligence, and real search telemetry continuously inform the next bounded repair.

### Core rule

> Repair what evidence shows is weak. Preserve what works. Never invent success. Never allow validation theater to stop safe execution.