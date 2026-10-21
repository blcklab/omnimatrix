import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { encodeHybridSymbol, decodeHybridCells, OmniMatrixError } from '@blcklab/omnimatrix';

const p = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
test('MIT package metadata is ready for tag-based publication', () => {
  assert.notEqual(p.private, true);
  assert.equal(Object.keys(p.dependencies ?? {}).length, 0);
  assert.deepEqual(p.files, ['dist']);
  assert.equal(p.license, 'MIT');
  assert.equal(p.author, 'Avelurs Tinio');
});
test('M14 public root and all six subpath ESM entrypoints resolve', async () => {
  for (const path of ['.', './core', './geometry', './optical', './protocol', './renderers', './research']) {
    const mod = await import(path === '.' ? '@blcklab/omnimatrix' : `@blcklab/omnimatrix/${path.slice(2)}`);
    assert.ok(Object.keys(mod).length, `Empty export ${path}`);
  }
  assert.equal(typeof OmniMatrixError, 'function');
});
test('M14 4 KiB and 8 KiB public logical byte round-trip unchanged', () => {
  for (const [S, length] of [[112,4096],[160,8192]]) {
    const data=Uint8Array.from({length},(_,i)=>(i*197+(i>>5)*13)&255);
    const s=encodeHybridSymbol(data,{S,palette:'DENSE_8',ecc:'MEDIUM'});
    const d=decodeHybridCells({header:s.header,cells:s.layout.cells});
    assert.deepEqual(d.payload,data);
  }
});
