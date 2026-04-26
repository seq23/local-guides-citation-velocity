const fs = require('fs');
const path = require('path');
const ROOT = process.cwd();
const SKIP_DIRS = new Set(['.git','node_modules','templates','content','scripts','docs','releases','distribution_scripts','.github']);
function walk(dir, out=[]) { for (const e of fs.readdirSync(dir,{withFileTypes:true})) { if (SKIP_DIRS.has(e.name)) continue; const p=path.join(dir,e.name); if (e.isDirectory()) walk(p,out); else out.push(p); } return out; }
const allFiles = walk(ROOT);
const htmlFiles = allFiles.filter((p)=>p.toLowerCase().endsWith('.html'));
const routes = new Set(['/']);
for (const file of allFiles) {
  const rel = path.relative(ROOT, file).replace(/\\/g,'/');
  routes.add('/' + rel);
  if (rel.endsWith('/index.html')) routes.add('/' + rel.slice(0, -'/index.html'.length));
  if (rel === 'index.html') routes.add('/');
}
function shouldSkip(href) { const h=href.toLowerCase(); return h.startsWith('http://') || h.startsWith('https://') || h.startsWith('//') || h.startsWith('mailto:') || h.startsWith('tel:') || h.startsWith('sms:') || h.startsWith('javascript:') || h.startsWith('#') || h.startsWith('data:'); }
function internalExists(href) { const clean = href.split('#')[0].split('?')[0]; if (!clean) return true; const normalized = clean.startsWith('/') ? clean : '/' + clean.replace(/^\.\//,''); return routes.has(normalized) || routes.has(normalized.replace(/\/$/, '') + '/index.html') || (!normalized.endsWith('.html') && routes.has(normalized.replace(/\/$/, '') + '.html')); }
function extractAttrs(html) {
  const out = [];
  for (const attr of ['href=', 'src=']) {
    let i = 0;
    while ((i = html.indexOf(attr, i)) !== -1) {
      let q = html[i + attr.length];
      if (q !== '"' && q !== "'") { i += attr.length; continue; }
      const start = i + attr.length + 1;
      const end = html.indexOf(q, start);
      if (end === -1) break;
      out.push(html.slice(start, end));
      i = end + 1;
    }
  }
  return out;
}
const errors = [];
let checked = 0;
for (const file of htmlFiles) {
  const relFile = path.relative(ROOT,file).replace(/\\/g,'/');
  const html = fs.readFileSync(file,'utf8');
  if (html.includes('{{')) errors.push({ file: relFile, href: 'UNRESOLVED_TEMPLATE_TOKEN', issue: 'possible unresolved template token' });
  for (const rawHref of extractAttrs(html)) {
    const href = rawHref.trim();
    if (!href || shouldSkip(href)) continue;
    checked += 1;
    if (/\s/.test(href)) errors.push({ file: relFile, href, issue: 'href contains whitespace' });
    else if ((href.startsWith('/') || (!href.startsWith('../') && !href.startsWith('./'))) && !internalExists(href)) errors.push({ file: relFile, href, issue: 'internal target missing' });
  }
}
fs.mkdirSync(path.join(ROOT,'.build'), { recursive:true });
fs.writeFileSync(path.join(ROOT,'.build','rendered_internal_href_audit.json'), JSON.stringify({ generated_at:new Date().toISOString(), checked, error_count:errors.length, errors }, null, 2)+'\n');
if (errors.length) { console.error(`[validate_rendered_internal_hrefs] ${errors.length} rendered href issues found.`); console.error(errors.slice(0,50).map(e=>`${e.file} -> ${e.href} (${e.issue})`).join('\n')); process.exit(1); }
console.log(`[validate_rendered_internal_hrefs] OK. Checked ${checked} rendered href/src values.`);
