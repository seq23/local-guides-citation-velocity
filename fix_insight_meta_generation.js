const fs = require("fs");

const file = "scripts/lib/publish_contract.js";
let code = fs.readFileSync(file, "utf8");

if (code.includes("ensureMetaDescription")) {
  console.log("Already patched.");
  process.exit(0);
}

const injection = `
function ensureMetaDescription(desc, title) {
  if (!desc || desc.length < 60) {
    return \`Structured decision guide for \${title}. Compare options, costs, risks, and next steps before choosing a provider.\`;
  }
  return desc;
}
`;

code = injection + "\n" + code;

code = code.replace(
  /content="\$\{htmlEscape\(item\.description\)\}"/g,
  'content="${htmlEscape(ensureMetaDescription(item.description, item.title))}"'
);

fs.writeFileSync(file, code);
console.log("Patched publish_contract.js to enforce meta description quality.");
