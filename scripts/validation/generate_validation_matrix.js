#!/usr/bin/env node
'use strict';
const fs=require('fs');
const path=require('path');
const {ROOT,readRegistry,buildMatrix}=require('./registry_lib');
const matrix=buildMatrix(readRegistry());
fs.writeFileSync(path.join(ROOT,'_repo_validation_matrix.json'),JSON.stringify(matrix,null,2)+'\n');
console.log(`VALIDATION MATRIX GENERATED (${matrix.counts.total} registered validators)`);
