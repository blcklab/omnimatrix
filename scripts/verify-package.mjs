import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
assert.equal(pkg.type, 'module');
assert.notEqual(pkg.private, true, 'The package must be publishable from a version tag');
assert.deepEqual(pkg.files, ['dist']);
assert.equal(pkg.author, 'Avelurs Tinio');
assert.equal(pkg.license, 'MIT');
assert.equal(Object.keys(pkg.dependencies ?? {}).length, 0, 'No runtime dependencies permitted');
for (const [subpath, target] of Object.entries(pkg.exports)) {
  if (subpath === './package.json') continue;
  assert.equal(typeof target.types, 'string');
  assert.equal(typeof target.import, 'string');
  await stat(new URL(`../${target.types}`, import.meta.url));
  await stat(new URL(`../${target.import}`, import.meta.url));
  const mod = await import(new URL(`../${target.import}`, import.meta.url).href);
  assert.ok(Object.keys(mod).length, `Export ${subpath} is empty`);
}
const root = await import('@blcklab/omnimatrix');
assert.equal(typeof root.createResearchSymbol, 'function');
assert.equal(typeof root.BitWriter, 'function');
console.log('Package exports and runtime dependency gate: PASS');
