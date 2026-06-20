#!/usr/bin/env node
'use strict';
const fs=require('fs');
const html=fs.readFileSync('index.html','utf8');
const errors=[];
const structural=[
  ['hero',/<section[^>]+class=["'][^"']*editorial-hero/],
  ['vertical selector',/<section[^>]+id=["']vertical-routes["']/],
  ['coverage',/<section[^>]+class=["'][^"']*coverage-panel/],
  ['operations',/<section[^>]+class=["'][^"']*operations/],
  ['methodology link',/href=["']\/methodology\.html["']/],
  ['provider action',/<a[^>]+class=["'][^"']*primary[^"']*["'][^>]+href=["']https:\/\//]
];
for(const [name,re] of structural) if(!re.test(html)) errors.push(`missing homepage structure: ${name}`);
for(const url of ['https://theaccidentguides.com/request-assistance/','https://dentistryguides.com/request-assistance/','https://hormonesivhair.com/request-assistance/','https://neuroevalguides.com/request-assistance/','https://uscisexam.com/request-assistance/']) if(!html.includes(url)) errors.push(`missing provider destination: ${url}`);
const visible=html.replace(/href=["'][^"']*request-assistance[^"']*["']/gi,'');
if(/request assistance/i.test(visible)) errors.push('visible legacy assistance label remains');
if(!/The Industry Guides Editorial Team|independent editorial publisher/i.test(html)) errors.push('homepage lacks truthful publisher identity');
if(errors.length){console.error(errors.join('\n'));process.exit(1);} console.log('Homepage provider-routing and editorial-architecture contract PASS');
