'use strict';
function classifyResult({severity, nonzero=false, warningFound=false, timedOut=false, strictWarnings=false}){
  if(severity==='HARD_FAIL'&&nonzero) return {status:timedOut?'TIMEOUT':'FAIL',blocks:true};
  if(severity==='STRONG_WARNING'&&(nonzero||warningFound)) return {status:'STRONG_WARNING',blocks:Boolean(strictWarnings)};
  if(severity==='SOFT_WARNING'&&(nonzero||warningFound)) return {status:'SOFT_WARNING',blocks:false};
  if(severity==='INFO'&&nonzero) return {status:'INFO_FINDING',blocks:false};
  if(warningFound) return {status:'PASS_WITH_WARNINGS',blocks:false};
  return {status:'PASS',blocks:false};
}
module.exports={classifyResult};
