#!/usr/bin/env node
const fs = require("fs");

const checks = [
  ["dentistry/pediatric-family/index.html", "First-visit checklist", "age one"],
  ["dentistry/anxiety-trust/index.html", "Anxiety-specific dentist vetting checklist"],
  ["dentistry/best-top-near-me/index.html", "Ranked dentist evaluation checklist"],
  ["dentistry/second-opinion/index.html", "Second-opinion script"],
  ["dentistry/cost-insurance/index.html", "Dental cost breakdown table"],
  ["dentistry/sedation-fear/index.html", "Sedation safety checklist"],
  ["dentistry/emergency-open-now/index.html", "ER vs emergency dentist decision tree"],
  ["dentistry/cosmetic-restorative/index.html", "Cosmetic vs restorative comparison table"],
  ["dentistry/dental-red-flags/index.html", "Unnecessary procedure warning signs"]
];

for (const [file, ...markers] of checks) {
  if (!fs.existsSync(file)) throw new Error(`missing dentistry report fix page: ${file}`);
  const text = fs.readFileSync(file, "utf8");
  for (const marker of markers) {
    if (!text.includes(marker)) throw new Error(`missing marker "${marker}" in ${file}`);
  }
}

if (!fs.existsSync("data/report_fixes/velocity_dentistry_2026_04_28.json")) {
  throw new Error("missing report fix ledger");
}

console.log(`DENTISTRY REPORT FIXES PASS: ${checks.length} pages checked`);
