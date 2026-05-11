const fs = require('fs');
const path = require('path');

const BAD_DOMAINS = [
  ['hormoesivhair', 'com'].join('.'),
  ['hormoesivehair', 'com'].join('.')
];

const SKIP_DIRS = new Set(['.git', 'node_modules']);

function scan(dir) {
  let violations = [];
  for (const file of fs.readdirSync(dir)) {
    const full = path.join(dir, file);
    const rel = path.relative(process.cwd(), full);
    const stat = fs.statSync(full);
    if (stat.isDirectory()) {
      if (SKIP_DIRS.has(file)) continue;
      violations = violations.concat(scan(full));
    } else {
      if (rel === 'scripts/validate_canonical_domains.js') continue;
      let content;
      try { content = fs.readFileSync(full, 'utf8'); } catch { continue; }
      BAD_DOMAINS.forEach((domain) => {
        if (content.includes(domain)) violations.push({ file: rel, domain });
      });
    }
  }
  return violations;
}

const results = scan(process.cwd());
if (results.length > 0) {
  console.error('❌ BAD CANONICAL DOMAIN FOUND');
  results.forEach((r) => console.error(`${r.domain} in ${r.file}`));
  process.exit(1);
}
console.log('✅ Canonical domains clean');
