const fs = require("fs");
const path = require("path");

const checks = [];
function exists(p){ return fs.existsSync(p); }
function add(section, item, ok, detail=""){
  checks.push({ section, item, ok, detail });
}

const requiredRoot = [
  "README.md","package.json","package-lock.json","robots.txt","sitemap.xml","llms.txt"
];

for (const f of requiredRoot) add("Root Files", f, exists(f));

[
  "answers.json","coverage.json","query_coverage_map.json","query_metadata.json","internal_authority_graph.json"
].forEach(f => add("Machine Readability Layer", f, exists(f)));

[
  "content/_shared/query_cluster_registry.json",
  "content/_shared/query_to_cluster_map.json",
  "content/_shared/atlas_registry.json",
  "content/_live/pages.json",
  "content/_staged/pages.json"
].forEach(f => add("Velocity Data Layer", f, exists(f)));

[
  "scripts/preflight_velocity_integrity.js",
  "scripts/validate_page_generation_quality.js",
  "scripts/validate_canonical_domains.js",
  "scripts/validate_sitemap_parity.js",
  "scripts/validate_publish_inventory.js",
  "scripts/validate_atlas_coverage.js",
  "scripts/validate_cluster_membership.js",
  "scripts/validate_page_cluster_contract.js",
  "scripts/validate_release_batch_surface.js",
  "scripts/validate_atlas_cluster_links.js",
  "scripts/validate_render_integrity.js",
  "scripts/validate_rendered_internal_hrefs.js",
  "scripts/validate_ingestion_health.js",
  "scripts/validate_vertical_keys.js"
].forEach(f => add("Validator Layer", f, exists(f)));

[
  ".github/workflows/validate.yml",
  ".github/workflows/daily_release.yml",
  ".github/workflows/release_batch.yml"
].forEach(f => add("GitHub Workflows", f, exists(f)));

[
  "docs/AI_AGENT_DAILY_CITATION_WORKFLOW_SOP.md"
].forEach(f => add("Operator Docs", f, exists(f)));

const pkg = exists("package.json") ? JSON.parse(fs.readFileSync("package.json","utf8")) : {scripts:{}};
[
  "validate:all",
  "preflight:integrity",
  "validate:page-generation"
].forEach(s => add("Package Scripts", `npm run ${s}`, !!pkg.scripts?.[s], pkg.scripts?.[s] || ""));

const pass = checks.filter(x=>x.ok);
const fail = checks.filter(x=>!x.ok);

fs.mkdirSync("reports", {recursive:true});
fs.writeFileSync("reports/llm_bait_checklist_audit.json", JSON.stringify({
  generated_at: new Date().toISOString(),
  total: checks.length,
  pass: pass.length,
  fail: fail.length,
  checks
}, null, 2) + "\n");

let md = `# LLM Bait Checklist Audit\n\nGenerated: ${new Date().toISOString()}\n\n`;
md += `## Summary\n\n- Passed: ${pass.length}\n- Missing / needs review: ${fail.length}\n\n`;
md += `## Missing / Needs Review\n\n`;
if (!fail.length) md += `None.\n`;
for (const x of fail) md += `- **${x.section}** — ${x.item}${x.detail ? `: ${x.detail}` : ""}\n`;
md += `\n## Passed\n\n`;
for (const x of pass) md += `- **${x.section}** — ${x.item}\n`;

fs.writeFileSync("reports/llm_bait_checklist_audit.md", md);

console.log(`LLM BAIT AUDIT COMPLETE: pass=${pass.length} missing=${fail.length}`);
console.log("Wrote:");
console.log("- reports/llm_bait_checklist_audit.json");
console.log("- reports/llm_bait_checklist_audit.md");

if (fail.length) process.exitCode = 1;
