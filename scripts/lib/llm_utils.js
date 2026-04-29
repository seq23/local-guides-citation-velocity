'use strict';
const fs = require('fs');
const path = require('path');
function readJson(p, fallback=null){
  if(!fs.existsSync(p)) return fallback;
  try { return JSON.parse(fs.readFileSync(p,'utf8')); }
  catch(e){
    console.warn(`[WARN] Could not parse ${p}: ${e.message}. Using fallback for derived build.`);
    return fallback;
  }
}
function writeJsonChecked(p, data){ if(data == null) throw new Error(`Refusing to write empty data to ${p}`); fs.mkdirSync(path.dirname(p),{recursive:true}); fs.writeFileSync(p, JSON.stringify(data,null,2)+'\n'); }
function slugify(s){ return String(s||'').toLowerCase().replace(/&/g,' and ').replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'').replace(/-{2,}/g,'-'); }
function arr(v){ return Array.isArray(v) ? v : v && typeof v==='object' ? Object.values(v) : []; }
function entries(v){ return Array.isArray(v) ? v.map((x,i)=>[x.id||x.slug||String(i),x]) : Object.entries(v||{}); }
function titleOf(x){ return x.title || x.question || x.query || x.name || x.slug || x.id || ''; }
function urlOf(x){ return x.url || x.path || x.href || (x.slug ? `/${x.slug}/` : ''); }
module.exports={readJson,writeJsonChecked,slugify,arr,entries,titleOf,urlOf};
