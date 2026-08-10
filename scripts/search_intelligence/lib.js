'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const ROOT = path.resolve(__dirname, '../..');
const DATA_DIR = path.join(ROOT, 'data/search_intelligence');
const PROTECTED_AGENT_ROOTS = [
  'data/report_fixes/agent_runs',
  'data/report_fixes/normalized_agent_runs',
  'data/report_fixes/source_record_ledgers',
  'data/report_fixes/agent_exact_semantic_manifests'
];
const ALLOWED_SOURCE_ROOTS = ['content/_live', 'content/_shared', 'data/page_families', 'data/content'];
function norm(p){return String(p||'').replace(/\\/g,'/').replace(/^\.\//,'');}
function abs(rel){return path.join(ROOT, norm(rel));}
function readJson(rel, fallback=null){try{return JSON.parse(fs.readFileSync(abs(rel),'utf8'));}catch(e){if(fallback!==null)return fallback;throw e;}}
function writeJson(rel, value){const p=abs(rel);fs.mkdirSync(path.dirname(p),{recursive:true});fs.writeFileSync(p,JSON.stringify(value,null,2)+'\n');}
function sha256(value){const b=Buffer.isBuffer(value)?value:Buffer.from(String(value));return crypto.createHash('sha256').update(b).digest('hex');}
function fileSha(rel){return sha256(fs.readFileSync(abs(rel)));}
function exists(rel){return fs.existsSync(abs(rel));}
function stableDate(){if(process.env.SOURCE_DATE)return process.env.SOURCE_DATE.slice(0,10);const dir=abs('data/report_fixes/normalized_agent_runs');if(fs.existsSync(dir)){const ds=fs.readdirSync(dir).map(x=>x.match(/^(\d{4}-\d{2}-\d{2})_/)).filter(Boolean).map(x=>x[1]).sort();if(ds.length)return ds.at(-1);}return '1970-01-01';}
function stableTimestamp(){return `${stableDate()}T00:00:00.000Z`;}
function normalizeQuery(q){return String(q||'').toLowerCase().replace(/[’']/g,'').replace(/[^a-z0-9]+/g,' ').trim().replace(/\s+/g,' ');}
function routeToFile(route){const r=String(route||'/').split('?')[0].split('#')[0];if(r==='/')return 'index.html';const clean=r.replace(/^\//,'');if(clean.endsWith('.html'))return clean;return `${clean.replace(/\/$/,'')}/index.html`;}
function isProtected(rel){const n=norm(rel);return PROTECTED_AGENT_ROOTS.some(root=>n===root||n.startsWith(root+'/'));}
function isAllowedSource(rel){const n=norm(rel);return ALLOWED_SOURCE_ROOTS.some(root=>n===root||n.startsWith(root+'/'));}
function walkFiles(rel){const base=abs(rel);const out=[];if(!fs.existsSync(base))return out;function walk(p){for(const ent of fs.readdirSync(p,{withFileTypes:true})){const q=path.join(p,ent.name);if(ent.isDirectory())walk(q);else out.push(norm(path.relative(ROOT,q)));}}walk(base);return out.sort();}
function protectedAgentSnapshot(){const rows=[];for(const root of PROTECTED_AGENT_ROOTS)for(const rel of walkFiles(root))rows.push({path:rel,sha256:fileSha(rel),size_bytes:fs.statSync(abs(rel)).size});return rows;}
function aggregateManifest(rows){return sha256(rows.map(r=>`${r.path}:${r.sha256}`).join('\n'));}
function assertProtectedAgentSnapshotUnchanged(before,after){const a=new Map((before||[]).map(x=>[x.path,x]));const b=new Map((after||[]).map(x=>[x.path,x]));const errors=[];for(const [p,x] of a){const y=b.get(p);if(!y)errors.push(`missing:${p}`);else if(y.sha256!==x.sha256)errors.push(`changed:${p}`);}for(const [p] of b)if(!a.has(p))errors.push(`new:${p}`);if(errors.length){const e=new Error(`SEARCH_INTELLIGENCE_PROTECTED_AGENT_MUTATION:${errors.join('|')}`);e.code='SEARCH_INTELLIGENCE_PROTECTED_AGENT_MUTATION';e.details=errors;throw e;}return true;}
function loadContract(){return readJson('data/search_intelligence/search_intelligence_contract.json');}
function candidateStatusFromDiagnosis(d){if(!d||d.material_state!=='DEFECT')return null;const allowed=new Set(loadContract().auto_repair_types);if(!allowed.has(d.repair_type))return 'BLOCK_NEEDS_REVIEW';return d.regulated_claim_risk?'BLOCK_NEEDS_REVIEW':'READY_AUTO_REPAIR';}
function verifyCitationEvent(e){const required=['provider','observed_at','query_or_prompt','surfaced_url','cited_url','evidence_ref'];return required.every(k=>typeof e?.[k]==='string'&&e[k].trim());}
function verifyExternalObservation(e){return Boolean(e&&typeof e.provider==='string'&&e.provider&&typeof e.observed_at==='string'&&e.observed_at&&typeof e.query==='string'&&e.query&&typeof e.owner_route==='string'&&e.owner_route&&typeof e.evidence_ref==='string'&&e.evidence_ref);}
function addDays(dateStr, days){const d=new Date(`${dateStr.slice(0,10)}T00:00:00.000Z`);d.setUTCDate(d.getUTCDate()+Number(days));return d.toISOString().slice(0,10);}
function textFromHtml(html){return String(html||'').replace(/<script[\s\S]*?<\/script>/gi,' ').replace(/<style[\s\S]*?<\/style>/gi,' ').replace(/<[^>]+>/g,' ').replace(/&[a-z#0-9]+;/gi,' ').replace(/\s+/g,' ').trim();}
function safeJsonPatch({source_file, route, patch}){
  if(isProtected(source_file))throw new Error(`PROTECTED_PATH:${source_file}`);
  if(!isAllowedSource(source_file))throw new Error(`SOURCE_NOT_ALLOWED:${source_file}`);
  if(!exists(source_file))throw new Error(`SOURCE_MISSING:${source_file}`);
  const source=readJson(source_file);
  let target=null;
  if(Array.isArray(source.pages))target=source.pages.find(p=>p.slug===route||p.path===route||`/${String(p.slug||'').replace(/^\//,'').replace(/\/$/,'')}/`===route);
  if(!target&&Array.isArray(source.items))target=source.items.find(p=>p.slug===route||p.path===route);
  if(!target)throw new Error(`ROUTE_NOT_FOUND_IN_SOURCE:${route}:${source_file}`);
  const permitted=new Set(['title','description','related_links','sections','content_atom']);
  for(const [k,v] of Object.entries(patch||{})){if(!permitted.has(k))throw new Error(`PATCH_FIELD_NOT_ALLOWED:${k}`);target[k]=v;}
  const before=fs.readFileSync(abs(source_file));
  fs.writeFileSync(abs(source_file),JSON.stringify(source,null,2)+'\n');
  const after=fs.readFileSync(abs(source_file));
  return {before_sha256:sha256(before),after_sha256:sha256(after),changed:!before.equals(after),before_bytes:before.length,after_bytes:after.length};
}
module.exports={ROOT,DATA_DIR,PROTECTED_AGENT_ROOTS,ALLOWED_SOURCE_ROOTS,norm,abs,readJson,writeJson,sha256,fileSha,exists,stableDate,stableTimestamp,normalizeQuery,routeToFile,isProtected,isAllowedSource,walkFiles,protectedAgentSnapshot,aggregateManifest,assertProtectedAgentSnapshotUnchanged,loadContract,candidateStatusFromDiagnosis,verifyCitationEvent,verifyExternalObservation,addDays,textFromHtml,safeJsonPatch};
