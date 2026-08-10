#!/usr/bin/env node
'use strict';
const cp=require('child_process');const fs=require('fs');const path=require('path');const ROOT=path.resolve(__dirname,'../..');
const r=cp.spawnSync('node',['scripts/tests/test_validator_materiality.js'],{cwd:ROOT,encoding:'utf8'});if(r.stdout)process.stdout.write(r.stdout);if(r.stderr)process.stderr.write(r.stderr);if(r.status!==0)process.exit(r.status||1);const report=JSON.parse(fs.readFileSync(path.join(ROOT,'artifacts/validation/validator-materiality-hostile.json'),'utf8'));if(report.status!=='PASS'||report.total!==15)process.exit(1);console.log(`VALIDATOR MATERIALITY PASS: ${report.passed}/${report.total}`);
