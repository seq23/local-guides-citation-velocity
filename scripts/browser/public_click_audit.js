#!/usr/bin/env node
'use strict';
const fs=require('fs'),path=require('path');
const ROOT=path.resolve(__dirname,'../..');
const base=process.env.PLAYWRIGHT_BASE_URL||process.env.POSTDEPLOY_BASE_URL||process.env.PUBLIC_BASE_URL;
if(!base){console.error('BROWSER_BASE_URL_MISSING');process.exit(2);}
let chromium;try{({chromium}=require('playwright'));}catch{console.error('BROWSER_RUNTIME_MISSING: install playwright and Chromium');process.exit(2);}
const contract=JSON.parse(fs.readFileSync(path.join(ROOT,'_browser_suite_contract.json'),'utf8'));
const IMPLEMENTED_ASSERTIONS=new Set([
 'route_loads','h1_present','required_artifact_visible_if_governed','navigation_works','disclosure_visible','no_horizontal_overflow','no_broken_images','no_console_errors','no_failed_local_assets','canonical_correct','table_responsive','cta_ad_separation'
]);
async function navigationWorks(page){
 const link=page.locator('nav a[href], header a[href]').filter({hasNot:page.locator('[aria-disabled="true"]')}).first();
 if(await link.count()===0)return false;
 const href=await link.getAttribute('href');if(!href||href==='#'||/^javascript:/i.test(href))return false;
 const target=new URL(href,base);if(target.origin!==new URL(base).origin)return true;
 const probe=await page.context().newPage();try{const response=await probe.goto(target.toString(),{waitUntil:'domcontentloaded',timeout:30000});return Boolean(response&&response.ok()&&await probe.locator('body').count());}finally{await probe.close();}
}
async function assertPage(page,check,response,consoleErrors,failedRequests){
 const failures=[];const expected=new URL(check.route,base).toString();
 if(!response||!response.ok())failures.push(`route_loads:${response&&response.status()}`);
 if(await page.locator('h1').count()!==1)failures.push('h1_present');
 const governed=await page.locator('[data-content-atom], [data-citation-artifact], [data-state-authority="true"], table, ol').count();if(check.route!=='/'&&governed<1)failures.push('required_artifact_visible_if_governed');
 if(!await navigationWorks(page))failures.push('navigation_works');
 const disclosure=await page.locator('footer, .disclaimer, [data-disclosure], a[href*="disclaimer"]').count();if(disclosure<1)failures.push('disclosure_visible');
 if(await page.evaluate(()=>document.documentElement.scrollWidth>document.documentElement.clientWidth+2))failures.push('no_horizontal_overflow');
 const brokenImages=await page.locator('img').evaluateAll(imgs=>imgs.filter(img=>!img.complete||img.naturalWidth===0).map(img=>img.src));if(brokenImages.length)failures.push(`no_broken_images:${brokenImages.length}`);
 if(consoleErrors.length)failures.push(`no_console_errors:${consoleErrors.join('|')}`);if(failedRequests.length)failures.push(`no_failed_local_assets:${failedRequests.join('|')}`);
 const canonical=await page.locator('link[rel="canonical"]').getAttribute('href').catch(()=>null);const expectedPath=new URL(expected).pathname;if(!canonical||new URL(canonical,base).pathname!==expectedPath)failures.push(`canonical_correct:${canonical||'missing'}`);
 const badTables=await page.locator('table').evaluateAll(ts=>ts.filter(t=>{const p=t.parentElement;return t.scrollWidth>document.documentElement.clientWidth+2&&(!p||getComputedStyle(p).overflowX==='visible')}).length);if(badTables)failures.push(`table_responsive:${badTables}`);
 const ctaOverlap=await page.locator('[data-provider-cta], .provider-cta, .cta').evaluateAll(nodes=>{const ads=[...document.querySelectorAll('[data-ad], .ad, .advertisement')];return nodes.some(n=>{const a=n.getBoundingClientRect();return ads.some(d=>{const b=d.getBoundingClientRect();return !(a.right<b.left||a.left>b.right||a.bottom<b.top||a.top>b.bottom)})})});if(ctaOverlap)failures.push('cta_ad_separation');
 return failures;
}
(async()=>{
 const max=Number(contract.count_policy?.maximum_test_cases||99),min=Number(contract.count_policy?.minimum_test_cases||1);
 if(contract.checks.length<min||contract.checks.length>max||contract.checks.length>=100)throw new Error(`BROWSER_SUITE_COUNT_POLICY:${contract.checks.length}`);
 const declared=new Set(contract.checks.flatMap(c=>c.assertions||[]));for(const a of declared)if(!IMPLEMENTED_ASSERTIONS.has(a))throw new Error(`UNIMPLEMENTED_BROWSER_ASSERTION:${a}`);
 const browser=await chromium.launch({headless:true});const results=[];
 for(const check of contract.checks){const viewport=check.device==='mobile'?{width:390,height:844}:{width:1440,height:1000};const page=await browser.newPage({viewportSize:viewport});const consoleErrors=[],failedRequests=[];page.on('console',m=>{if(m.type()==='error')consoleErrors.push(m.text())});page.on('requestfailed',r=>{try{const u=new URL(r.url());if(u.origin===new URL(base).origin)failedRequests.push(`${u.pathname}:${r.failure()?.errorText||'failed'}`)}catch{}});let failures=[];try{const resp=await page.goto(new URL(check.route,base).toString(),{waitUntil:'networkidle',timeout:45000});failures=await assertPage(page,check,resp,consoleErrors,failedRequests);}catch(e){failures=[e.message];}results.push({...check,status:failures.length?'FAIL':'PASS',failures});await page.close();}
 await browser.close();const failed=results.filter(r=>r.status==='FAIL');const report={status:failed.length?'FAIL':'PASS',test_cases:results.length,assertions_per_case:contract.assertions_per_case,total_assertions:results.length*contract.assertions_per_case,failed_count:failed.length,skipped_count:0,base_url:base,results};fs.mkdirSync(path.join(ROOT,'artifacts/diagnostics/click-audit'),{recursive:true});fs.writeFileSync(path.join(ROOT,'artifacts/diagnostics/click-audit/summary.json'),JSON.stringify(report,null,2)+'\n');if(failed.length){console.error(`PUBLIC CLICK AUDIT FAIL: ${failed.length}/${results.length}`);process.exit(1);}console.log(`PUBLIC CLICK AUDIT PASS: ${results.length} cases, ${results.length*contract.assertions_per_case} assertions`);
})().catch(e=>{console.error(e);process.exit(1)});
