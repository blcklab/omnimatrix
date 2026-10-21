import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync,existsSync} from 'node:fs';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('..',import.meta.url));
test('public docs exclude development milestone reports',()=>{
  const docs=readdirSync(join(root,'docs'));
  assert.deepEqual(docs.sort(),[
    'AUTHENTICATED-ENCRYPTION.md','BINARY-ENVELOPES.md','DIGITAL-SIGNATURES.md',
    'GETTING-STARTED.md','MULTISYMBOL-TRANSFERS.md','PUBLIC-API.md','README.md',
    'SAFE-ACTIONS.md','SMART-PAYLOADS.md'
  ].sort());
  const ignore=readFileSync(join(root,'.gitignore'),'utf8');
  assert.match(ignore,/^\.internal\/$/m);
});
test('CI and tag-based npm publish use only standard npm commands',()=>{
  const testYaml=readFileSync(join(root,'.github/workflows/test.yml'),'utf8');
  const publishYaml=readFileSync(join(root,'.github/workflows/publish.yml'),'utf8');
  assert.match(testYaml,/name: CI/);
  assert.match(testYaml,/node: \[20, 22, 24\]/);
  assert.match(testYaml,/npm ci/);
  assert.match(testYaml,/npm run check/);
  assert.match(publishYaml,/tags:/);
  assert.match(publishYaml,/v\*/);
  assert.match(publishYaml,/npm publish --access public --provenance --tag/);
  assert.match(publishYaml,/GITHUB_REF_NAME/);
  assert.ok(existsSync(join(root,'package-lock.json')));
  assert.ok(!existsSync(join(root,'.workflows')));
});
