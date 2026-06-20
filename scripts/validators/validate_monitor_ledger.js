#!/usr/bin/env node
'use strict';
const fs=require('fs'),path=require('path'),crypto=require('crypto');
const ROOT=path.resolve(__dirname,'../..');const CV=path.join(ROOT,'data/citation_velocity');const errors=[];const warnings=[];
const read=f=>JSON.parse(fs.readFileSync(path.join(CV,f),'utf8'));
const stableHash=o=>crypto.createHash('sha256').update(JSON.stringify(sort(o))).digest('hex');
function sort(v){if(Array.isArray(v))return v.map(sort);if(v&&typeof v==='object')return Object.fromEntries(Object.keys(v).sort().map(k=>[k,sort(v[k])]));return v;}
const dateOk=v=>/^\d{4}-\d{2}-\d{2}$/.test(String(v||''));
const maxDate=(rows,key)=>rows.map(r=>String(r[key]||'')).filter(dateOk).sort().at(-1)||null;
const unique=(rows,label)=>{const ids=rows.map(r=>r.id);if(ids.some(x=>!x))errors.push(`${label}:missing-id`);if(new Set(ids).size!==ids.length)errors.push(`${label}:duplicate-id`);};
const rec=read('recommendations.json'),runs=read('runs.json'),wins=read('wins.json'),baseline=read('historical_baseline_2026-06-19.json');
const own=read('source_ownership_registry.json');const recs=rec.recommendations||[],runRows=runs.runs||[],winRows=wins.wins||[];
unique(recs,'recommendations');unique(runRows,'runs');unique(winRows,'wins');
if(rec.current_count!==recs.length)errors.push('recommendations:metadata-count');
if(runs.count!==runRows.length||runs.current_count!==runRows.length)errors.push('runs:metadata-count');
if(wins.count!==winRows.length||wins.current_count!==winRows.length)errors.push('wins:metadata-count');
if(rec.current_through!==maxDate(recs,'run_date'))errors.push('recommendations:current-through');
if(runs.current_through!==maxDate(runRows,'date'))errors.push('runs:current-through');
if(wins.current_through!==maxDate(winRows,'date'))errors.push('wins:current-through');
for(const [label,d,rows] of [['recommendations',rec,recs],['runs',runs,runRows],['wins',wins,winRows]])if(rows.length<Number(d.historical_cutoff_count||0))errors.push(`${label}:history-regressed`);
for(const r of runRows){if(!dateOk(r.date))errors.push(`${r.id}:invalid-date`);if(!Number.isInteger(r.queries)||r.queries<0)errors.push(`${r.id}:invalid-query-count`);if(!(Number(r.winnable_pct)>=0&&Number(r.winnable_pct)<=100))errors.push(`${r.id}:invalid-winnable-pct`);const levels=r.levels||{};const vals=['L1','L2','L3','L4'].map(k=>levels[k]);const complete=vals.every(Number.isInteger);if(complete&&vals.reduce((a,b)=>a+b,0)!==r.queries&&!r.data_quality)errors.push(`${r.id}:level-arithmetic`);if(!complete&&!r.data_quality)errors.push(`${r.id}:missing-level-breakdown-without-data-quality`);if(r.data_quality&&!['PARTIAL_LEVEL_BREAKDOWN','LEVEL_BREAKDOWN_UNAVAILABLE'].includes(r.data_quality.status))errors.push(`${r.id}:unknown-data-quality-status`);}
const grouped=new Map();for(const r of runRows){const a=grouped.get(r.vertical)||[];a.push(r.date);grouped.set(r.vertical,a);}for(const [v,dates] of grouped){for(let i=1;i<dates.length;i++)if(dates[i]<dates[i-1])errors.push(`runs:${v}:not-append-chronological`);}
for(const r of recs){if(!dateOk(r.run_date))errors.push(`${r.id}:invalid-date`);if(r.source_owner!=='VELOCITY_CONTENT')errors.push(`${r.id}:owner`);if(!['IMPLEMENTED','PRESERVED'].includes(r.implementation_status))errors.push(`${r.id}:implementation-status`);if(!Array.isArray(r.source_paths)||!r.source_paths.length)errors.push(`${r.id}:source-paths`);}
for(const w of winRows){if(!dateOk(w.date))errors.push(`${w.id}:invalid-date`);if(!Array.isArray(w.pages)||!w.pages.length)errors.push(`${w.id}:pages`);}
const byType={recommendations:new Map(recs.map(x=>[x.id,x])),runs:new Map(runRows.map(x=>[x.id,x])),wins:new Map(winRows.map(x=>[x.id,x]))};
for(const [type,entries] of Object.entries(baseline.records||{})){for(const e of entries){const row=byType[type]?.get(e.id);if(!row)errors.push(`historical-baseline:${type}:missing:${e.id}`);else if(stableHash(row)!==e.sha256)errors.push(`historical-baseline:${type}:mutated:${e.id}`);}}
if((own.records||[]).length!==recs.length||own.count!==(own.records||[]).length)errors.push('ownership:recommendation-parity');const ownIds=new Set((own.records||[]).map(x=>x.recommendation_id));for(const r of recs)if(!ownIds.has(r.id))errors.push(`ownership:missing:${r.id}`);
const june=runRows.find(r=>r.id==='CV-RUN-USCIS-MEDICAL-2026-06-19');if(!june||june.queries!==30||june.levels?.L1!==30||june.levels?.L2!==0||june.levels?.L3!==0||june.levels?.L4!==0)errors.push('historical-fixture:june19-uscis-run');for(const id of ['CV-USCIS-018','CV-USCIS-019','CV-USCIS-020'])if(!recs.some(r=>r.id===id&&r.run_date==='2026-06-19'))errors.push(`historical-fixture:${id}`);
const report={validator:'monitor-ledger',status:errors.length?'FAIL':'PASS',counts:{recommendations:recs.length,runs:runRows.length,wins:winRows.length},current_through:{recommendations:rec.current_through,runs:runs.current_through,wins:wins.current_through},historical_baseline:{cutoff:baseline.cutoff_date,recommendations:baseline.records.recommendations.length,runs:baseline.records.runs.length,wins:baseline.records.wins.length},errors,warnings,checked_at:runs.current_through};fs.mkdirSync(path.join(ROOT,'artifacts/validation'),{recursive:true});fs.writeFileSync(path.join(ROOT,'artifacts/validation/monitor-ledger.json'),JSON.stringify(report,null,2)+'\n');if(errors.length){console.error(errors.join('\n'));process.exit(1);}console.log(`MONITOR LEDGER PASS: ${recs.length} recommendations, ${runRows.length} runs, ${winRows.length} wins; append-only baseline preserved.`);
