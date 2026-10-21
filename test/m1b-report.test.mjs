import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
test('field report aggregates local JSON inputs and respects --output option',()=>{
  const folder=mkdtempSync(join(tmpdir(),'omni-'));
  try {
    const input=join(folder,'input.json'),output=join(folder,'aggregate.json');
    const event={schema:'OMNIMATRIX_M1B_MEASUREMENT_V1',source:'generated_fixture',S:96,palette:'DENSE_8',media:'synthetic',expectedDataCells:100,
      sample:{total:99,errors:3,invalidSamples:1},header:{status:'OK'}};
    writeFileSync(input,JSON.stringify(event));
    const run=spawnSync(process.execPath,['scripts/capture-report.mjs',input,'--output',output],{encoding:'utf8'});
    assert.equal(run.status,0,run.stderr);
    const result=JSON.parse(readFileSync(output,'utf8'));
    assert.equal(result.totalCaptures,1);
    assert.equal(result.groups['96/DENSE_8/synthetic'].errors,3);
    assert.equal(result.groups['96/DENSE_8/synthetic'].invalid,1);
    assert.equal(result.rows[0].origin,'generated_fixture');
  }finally{rmSync(folder,{recursive:true,force:true});}
});
