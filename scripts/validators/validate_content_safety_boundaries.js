#!/usr/bin/env node
'use strict';
const fs=require('fs'),path=require('path'); const ROOT=path.resolve(__dirname,'../..');
const pages=JSON.parse(fs.readFileSync(path.join(ROOT,'content/_staged/pages.json'),'utf8')).pages;
const governed=pages.filter(p=>p.monitor_governed);
const errors=[];
for(const p of governed){
 if(!p.disclaimer)errors.push(`missing-disclaimer:${p.slug}`);
 const text=JSON.stringify(p);
 if(p.sensitivity_profile==='legal'&&!/not legal advice/i.test(p.disclaimer))errors.push(`legal-boundary:${p.slug}`);
 if(p.sensitivity_profile==='medical'&&!/not medical advice/i.test(p.disclaimer))errors.push(`medical-boundary:${p.slug}`);
 if(p.sensitivity_profile==='legal-medical'&&(!/not legal/i.test(p.disclaimer)||!/medical advice/i.test(p.disclaimer)))errors.push(`legal-medical-boundary:${p.slug}`);
 if(/(?:we|this guide|the industry guides)\s+guarantee(?:s|d)?\s+(?:a\s+)?(?:cure|settlement|result|outcome)|(?:the|our)\s+best\s+dentist\s+is|top-rated\s+provider\s+is|we\s+(?:rank|recommend|endorse)\s+(?:the\s+)?(?:best|top)/i.test(text))errors.push(`unsupported-ranking-or-guarantee:${p.slug}`);
}
const report={validator:'content-safety-boundaries',ok:!errors.length,governed_pages:governed.length,errors};
fs.mkdirSync(path.join(ROOT,'artifacts/validation'),{recursive:true});fs.writeFileSync(path.join(ROOT,'artifacts/validation/safety.json'),JSON.stringify(report,null,2)+'\n');
if(errors.length){console.error(errors.join('\n'));process.exit(1);}console.log('CONTENT SAFETY BOUNDARIES PASS');
