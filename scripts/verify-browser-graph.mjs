/** Ensure bundled public ESM runtime remains browser-oriented, without builtins or external imports. */
import assert from 'node:assert/strict';
import { readFile, readdir, stat } from 'node:fs/promises';
import { dirname, extname, isAbsolute, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dist = resolve(root, 'dist');
const pkg = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'));
assert.deepEqual(Object.keys(pkg.dependencies ?? {}), [], 'Runtime dependency added');
const queue = Object.entries(pkg.exports).filter(([, v]) => typeof v === 'object').map(([,v]) => resolve(root, v.import));
const visited = new Set();
while (queue.length) {
  const path = queue.pop();
  if (visited.has(path)) continue;
  assert.ok(path.startsWith(dist + sep), `Import escaped compiled distribution: ${path}`);
  assert.equal(extname(path), '.js', `Unexpected compiled extension ${path}`);
  const source = await readFile(path, 'utf8');
  visited.add(path);
  const imports = [...source.matchAll(/\b(?:import|export)\s*(?:(?:[\s\S]*?\bfrom\s*)|\(\s*)?['"]([^'"]+)['"]/g)];
  for (const [, specifier] of imports) {
    assert.ok(specifier.startsWith('./') || specifier.startsWith('../'), `Non-browser/external import in ${path}: ${specifier}`);
    const next = resolve(dirname(path), specifier);
    assert.ok(next.startsWith(dist + sep), `Import escapes dist from ${path}: ${specifier}`);
    queue.push(next);
  }
  assert.ok(!/\b(?:require\s*\(|process\.env|global\.Buffer)\b/.test(source), `Node-only construct found in ${path}`);
}
assert.ok(visited.size >= 20, 'Compiled module reachability unexpectedly small');
console.log(`M15 browser-graph audit: ${visited.size} public reachable ESM modules, no Node builtins or external runtime imports`);
