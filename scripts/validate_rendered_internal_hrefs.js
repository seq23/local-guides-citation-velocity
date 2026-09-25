const fs = require('fs');
const path = require('path');
const ROOT = process.cwd();
const SITE_HOST = 'theindustryguides.com';
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
// An absolute link to this site is an internal link. Until 2026-09-25 every
// http(s) href was skipped, so "Originally published at
// https://theindustryguides.com/medium-articles/trt/dht-hair-loss-treatments-plateau/"
// - a 404 - passed here while Bing and a crawl both reported it.
const SELF_ORIGIN = new RegExp(`^https?://(?:www\\.)?${SITE_HOST.replace(/\./g, '\\.')}(?=/|$)`, 'i');
function toSitePath(href) { return SELF_ORIGIN.test(href) ? (href.replace(SELF_ORIGIN, '') || '/') : href; }
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
      out.push({ attr: attr.slice(0, -1), value: html.slice(start, end) });
      i = end + 1;
    }
  }
  return out;
}

// ----------------------------------------------------------- served-page links
// A link that answers 301/308 is not missing, so the existence check above passes
// it - and that is how 79 retired community-question slugs stayed linked from 164
// live pages (Bing Webmaster and a site crawl, 2026-09-25): the retired pages are
// still on disk, because retirement is not deletion, while _redirects sends every
// request for them to the vertical hub. Cloudflare Pages also 308s any `foo.html`
// to `/foo`, so an href spelled `/about.html` is a redirect too.
//
// These two checks apply to the pages a crawler is actually served - the routes in
// the sitemap - because a retired page linking another retired page reaches nobody.
const slashless = (p) => (p.length > 1 ? p.replace(/\/+$/, '') : p);
const redirectSources = new Set();
const redirectsPath = path.join(ROOT, '_redirects');
if (fs.existsSync(redirectsPath)) {
  for (const line of fs.readFileSync(redirectsPath, 'utf8').split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const from = t.split(/\s+/)[0];
    if (from && from.startsWith('/')) redirectSources.add(slashless(from));
  }
}
function sitemapRoutes() {
  const files = ['sitemap.xml'];
  const dir = path.join(ROOT, 'sitemaps');
  if (fs.existsSync(dir)) for (const name of fs.readdirSync(dir)) if (name.endsWith('.xml')) files.push(`sitemaps/${name}`);
  const out = new Set();
  for (const rel of files) {
    const abs = path.join(ROOT, rel);
    if (!fs.existsSync(abs)) continue;
    for (const m of fs.readFileSync(abs, 'utf8').matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/g)) {
      const loc = toSitePath(m[1]).split('?')[0].split('#')[0];
      if (loc.startsWith('/') && !loc.endsWith('.xml')) out.add(slashless(loc));
    }
  }
  return out;
}
const servedRoutes = sitemapRoutes();
function routeOfFile(rel) {
  if (rel === 'index.html') return '/';
  if (rel.endsWith('/index.html')) return slashless('/' + rel.slice(0, -'index.html'.length));
  return '/' + rel.replace(/\.html$/, '');
}

const errors = [];
let checked = 0;
let servedPagesChecked = 0;
let servedLinksChecked = 0;
for (const file of htmlFiles) {
  const relFile = path.relative(ROOT,file).replace(/\\/g,'/');
  const html = fs.readFileSync(file,'utf8');
  const served = servedRoutes.has(routeOfFile(relFile));
  if (served) servedPagesChecked += 1;
  if (html.includes('{{')) errors.push({ file: relFile, href: 'UNRESOLVED_TEMPLATE_TOKEN', issue: 'possible unresolved template token' });
  for (const { attr, value } of extractAttrs(html)) {
    const raw = value.trim();
    if (!raw) continue;
    // Absolute self-links are graded on served pages only: raw agent reports under
    // data/ quote the site's URLs as evidence and are never served to anyone.
    const selfAbsolute = SELF_ORIGIN.test(raw);
    if (selfAbsolute && !served) continue;
    const href = toSitePath(raw);
    if (shouldSkip(href)) continue;
    checked += 1;
    if (/\s/.test(href)) { errors.push({ file: relFile, href: raw, issue: 'href contains whitespace' }); continue; }
    if ((href.startsWith('/') || (!href.startsWith('../') && !href.startsWith('./'))) && !internalExists(href)) { errors.push({ file: relFile, href: raw, issue: 'internal target missing' }); continue; }
    if (!served || attr !== 'href' || !href.startsWith('/')) continue;
    // A canonical tag is not a link a reader follows, and <link rel="canonical"> on a
    // served page already points at itself; only anchors and link hrefs are graded.
    servedLinksChecked += 1;
    const target = href.split('#')[0].split('?')[0];
    if (!target) continue;
    if (redirectSources.has(slashless(target))) errors.push({ file: relFile, href: raw, issue: 'internal target is a _redirects source (answers 301)' });
    else if (/\.html$/i.test(target) && !/\/index\.html$/i.test(target) && target !== '/404.html') errors.push({ file: relFile, href: raw, issue: `internal target is the .html form (Pages answers 308 to ${target.replace(/\.html$/i, '')})` });
    else if (/\/index\.html$/i.test(target)) errors.push({ file: relFile, href: raw, issue: `internal target is the /index.html form (Pages answers 308 to ${target.replace(/index\.html$/i, '')})` });
  }
}
// Rule 0: a check that examined nothing has not passed.
const stops = [];
if (!checked) stops.push('0 href/src values were examined: the tree is unbuilt or the walk found no HTML.');
if (!servedRoutes.size) stops.push('no sitemap route could be read (sitemap.xml and sitemaps/*.xml), so no served page was graded for redirecting links.');
if (!servedPagesChecked || !servedLinksChecked) stops.push(`served-page link check examined ${servedPagesChecked} page(s) and ${servedLinksChecked} link(s); a sitemap whose routes resolve to no rendered file graded nothing.`);
if (!redirectSources.size) stops.push('_redirects is missing or empty, so no link could be tested against a redirect source.');
fs.mkdirSync(path.join(ROOT,'artifacts','validation'), { recursive:true });
fs.writeFileSync(path.join(ROOT,'artifacts','validation','hrefs.json'), JSON.stringify({ validator:'rendered-internal-hrefs', ok:errors.length===0 && !stops.length, checked, served_pages_checked: servedPagesChecked, served_links_checked: servedLinksChecked, redirect_sources: redirectSources.size, error_count:errors.length, stops, errors }, null, 2)+'\n');
if (stops.length) { console.error('[validate_rendered_internal_hrefs] STOP - nothing was graded:'); for (const s of stops) console.error(`- ${s}`); process.exit(1); }
if (errors.length) { console.error(`[validate_rendered_internal_hrefs] ${errors.length} rendered href issues found.`); console.error(errors.slice(0,50).map(e=>`${e.file} -> ${e.href} (${e.issue})`).join('\n')); process.exit(1); }
console.log(`[validate_rendered_internal_hrefs] OK. Checked ${checked} rendered href/src values; ${servedLinksChecked} links on ${servedPagesChecked} served pages point at no redirect (${redirectSources.size} redirect sources).`);
