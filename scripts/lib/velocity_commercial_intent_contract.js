'use strict';
const fs=require('fs'); const path=require('path');
const ROOT=path.resolve(__dirname,'../..');
const POLICY=JSON.parse(fs.readFileSync(path.join(ROOT,'data/report_fixes/velocity_commercial_intent_policy.json'),'utf8'));
function validate(record={}){ const errors=[]; const t=String(record.page_type||record.recommended_page_type||''); const mode=String(record.ranking_mode||''); const state=POLICY.page_types[t]; if(state&&state.startsWith('BLOCKED')) errors.push('blocked_page_type'); if(['evidence_ranked','ordinal_ranked','numerical_score'].includes(mode)) errors.push('blocked_ranking_mode'); if(/\b(number one|#1|universally best|guaranteed best)\b/i.test(String(record.public_title||record.title||''))) errors.push('unsupported_superiority_claim'); return {ok:!errors.length,errors}; }
module.exports={validateCommercialIntent:validate,POLICY};
