/** M14 -> later alpha: runtime exports are additive-only unless explicitly versioned. */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const baseline = JSON.parse(await readFile(resolve(root, 'contracts/m14-public-exports.json'), 'utf8'));
const pkg = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'));
assert.equal(baseline.baseline, '0.1.0-alpha.14');
for (const [subpath, required] of Object.entries(baseline.entrypoints)) {
  const target = pkg.exports?.[subpath];
  assert.ok(target, `Removed M14 public entrypoint ${subpath}`);
  assert.ok(target.types?.startsWith('./dist/') && target.import?.startsWith('./dist/'), `Missing JS or TypeScript entry ${subpath}`);
  const entry = await import(pathToFileURL(resolve(root, target.import)).href);
  const missing = required.filter((name) => !Object.hasOwn(entry, name));
  assert.deepEqual(missing, [], `M14 API regression at ${subpath}`);
}
console.log(`M15 compatibility: all ${Object.values(baseline.entrypoints).reduce((n, entries) => n + entries.length, 0)} M14 entrypoint bindings remain available`);
