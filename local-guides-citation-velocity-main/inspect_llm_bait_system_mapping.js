const fs = require("fs");

function exists(p){ return fs.existsSync(p); }
function j(p){ return exists(p) ? JSON.parse(fs.readFileSync(p,"utf8")) : null; }

const pkg = j("package.json") || { scripts:{} };

const map = [
  ["Machine readability / LLM entry", ["llms.txt", "content/_shared/query_cluster_registry.json", "content/_shared/atlas_registry.json"]],
  ["Query coverage", ["content/_shared/query_to_cluster_map.json"]],
  ["Cluster registry", ["content/_shared/query_cluster_registry.json"]],
  ["Atlas / authority graph", ["content/_shared/atlas_registry.json", "atlas"]],
  ["Rendered insight pages", ["insights"]],
  ["Rendered cluster pages", ["dentistry", "personal-injury", "trt", "neuro", "uscis-medical"]],
  ["Publish inventory", ["content/_live/pages.json", "content/_staged/pages.json", "content/_live/insights.json"]],
  ["Sitemaps", ["sitemap.xml", "sitemaps"]],
  ["LLMS file", ["llms.txt"]],
  ["Validators", ["scripts/validate_atlas_coverage.js", "scripts/validate_cluster_membership.js", "scripts/validate_page_cluster_contract.js", "scripts/validate_atlas_cluster_links.js", "scripts/validate_sitemap_parity.js"]],
  ["Preflight", ["scripts/preflight_velocity_integrity.js"]],
  ["Page quality", ["scripts/validate_page_generation_quality.js"]],
  ["AI agent SOP", ["docs/AI_AGENT_DAILY_CITATION_WORKFLOW_SOP.md"]]
];

console.log("\\n=== LLM BAIT FUNCTION → CURRENT REPO FILES ===\\n");

for (const [fn, files] of map) {
  console.log(`\\n${fn}`);
  for (const f of files) console.log(`  ${exists(f) ? "OK  " : "MISS"} ${f}`);
}

console.log("\\n=== PACKAGE SCRIPTS ===\\n");
for (const k of Object.keys(pkg.scripts || {}).sort()) {
  if (/validate|preflight|build|release|audit|ingest|social|reddit/i.test(k)) {
    console.log(`${k}: ${pkg.scripts[k]}`);
  }
}

console.log("\\n=== DATA SHAPES ===\\n");

for (const f of [
  "content/_shared/query_cluster_registry.json",
  "content/_shared/query_to_cluster_map.json",
  "content/_shared/atlas_registry.json",
  "content/_live/pages.json",
  "content/_staged/pages.json",
  "content/_live/insights.json"
]) {
  if (!exists(f)) continue;
  const data = j(f);
  console.log(`\\n${f}`);
  console.log(Array.isArray(data) ? `array length=${data.length}` : `object keys=${Object.keys(data).join(", ")}`);
}

console.log("\\n=== VALIDATE ALL ===\\n");
console.log(pkg.scripts?.["validate:all"] || "missing validate:all");
