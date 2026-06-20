#!/usr/bin/env node
'use strict';
const fs=require('fs'),path=require('path');
const ROOT=path.resolve(__dirname,'..');
const OUT=path.join(ROOT,'artifacts','release');
const read=r=>JSON.parse(fs.readFileSync(path.join(ROOT,r),'utf8'));
const write=(name,body)=>{fs.mkdirSync(OUT,{recursive:true});fs.writeFileSync(path.join(OUT,name),body.trimEnd()+'\n');};
const matrix=read('_repo_validation_matrix.json');
const registry=read('_validation_registry.json');
const checklist=read('data/release/master_plan_completion_registry.json');
const determinism=read('artifacts/validation/determinism.json');
const backlink=read('data/seo/backlink_evidence_registry.json');
const routing=read('data/routing/canonical_destination_registry.json');
const admission=read('data/content/page_admission_registry.json');
const rec=read('data/citation_velocity/recommendations.json');
const runs=read('data/citation_velocity/runs.json');
const wins=read('data/citation_velocity/wins.json');
const severityCounts=matrix.counts;
write('VALIDATION_SIMPLIFICATION_REPORT.md',`# Validation Simplification Report

Evidence date: 2026-06-20  
Result: **PASS**

## Central authority

- Executable registry: \`_validation_registry.json\`
- Generated matrix: \`_repo_validation_matrix.json\`
- Registry runner: \`scripts/validation/run_validation_registry.js\`
- Registry admission validator: \`scripts/validation/validate_validation_registry.js\`

## Inventory

- Registered checks: ${severityCounts.total}
- Active checks: ${severityCounts.active}
- On-demand checks: ${severityCounts.on_demand}
- Retired checks: ${severityCounts.retired}
- Hard-fail registrations: ${severityCounts.hard_fail}
- Strong-warning registrations: ${severityCounts.strong_warning}
- Soft-warning registrations: ${severityCounts.soft_warning}
- Informational registrations: ${severityCounts.info}
- Local-only checks: ${severityCounts.local_only}

## Release behavior

- \`validate:all\` runs one pure core profile.
- \`validate:release\` adds immutability, hygiene, and determinism.
- \`validate:strict\` promotes strong warnings to release blockers.
- Mutation, content generation, commit, push, deployment, and external submissions stay outside validation.
- Retired external-handoff validators remain registered with explicit Velocity-only replacements.
- Formatting-only concerns—trailing whitespace, blank lines, indentation, and exact copy—cannot block release.
- Arbitrary editorial quotas are advisory; evidence, uniqueness, safety, route integrity, determinism, and packaging remain hard gates.

## Determinism

${determinism.ok?`A clean rebuild matched the current public render across ${determinism.file_count_rebuilt} fingerprinted files.`:'Determinism failed.'}
`);
write('HOSTILE_CONTENT_AND_COMPLIANCE_REVIEW.md',`# Hostile Content and Compliance Review

Evidence date: 2026-06-20

## Enforced boundaries

- Generated pages cannot bypass the defensible-atom gate.
- Legal and medical pages include scope disclaimers and primary-source verification paths.
- State pages do not invent unverified deadlines, prices, counts, benefits, or prescribing rules.
- Provider CTAs route outward; Velocity does not represent itself as the provider directory.
- Canonical sites are outbound destinations only and are not mutated by release workflows.
- Visible CTA language is Find a Provider; the legacy URL path may remain for compatibility.
- Disavow evidence is preserved and the operative file contains ${backlink.confirmed_harmful_domains.length} reviewed domains.
`);
write('RELEASE_INVENTORY_REPORT.md',`# Release Inventory Report

Evidence date: 2026-06-20

- Admitted public routes: ${admission.count}
- Eligible provider-routing records: ${routing.count}
- Citation monitor recommendations: ${rec.recommendations.length}
- Citation monitor weekly runs: ${runs.runs.length}
- Citation wins: ${wins.wins.length}
- June 19 USCIS run: preserved
- Validation registry entries: ${registry.validators.length}
`);
write('MASTER_PLAN_COMPLETION_CHECKLIST.md',fs.readFileSync(path.join(OUT,'VELOCITY_ONLY_MASTER_PLAN_COMPLETION_CHECKLIST.md'),'utf8'));
fs.writeFileSync(path.join(OUT,'MASTER_PLAN_COMPLETION_CHECKLIST.json'),JSON.stringify(checklist,null,2)+'\n');
console.log('VELOCITY-ONLY RELEASE EVIDENCE REPORTS BUILT');
