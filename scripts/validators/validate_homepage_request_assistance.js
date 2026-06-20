#!/usr/bin/env node
'use strict';
const fs=require('fs');
const html=fs.readFileSync('index.html','utf8');
const errors=[];
for(const marker of ['Find a Provider','Canonical verticals','What we cover','Platform operations','Source first. Decision second. Provider third.']) if(!html.includes(marker)) errors.push(`missing homepage marker: ${marker}`);
for(const url of ['https://theaccidentguides.com/request-assistance/','https://dentistryguides.com/request-assistance/','https://hormonesivhair.com/request-assistance/','https://neuroevalguides.com/request-assistance/','https://uscisexam.com/request-assistance/']) if(!html.includes(url)) errors.push(`missing provider destination: ${url}`);
const visible=html.replace(/href=["'][^"']*request-assistance[^"']*["']/gi,'');
if(/request assistance/i.test(visible)) errors.push('visible Request assistance copy remains');
if(errors.length){console.error(errors.join('\n'));process.exit(1);} console.log('Homepage Find a Provider contract PASS');
