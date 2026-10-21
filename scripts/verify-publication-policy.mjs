/** Check the release metadata for tag-based npm publication. */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
assert.notEqual(pkg.private, true, 'Tag publishing must be enabled');
assert.equal(pkg.name, '@blcklab/omnimatrix');
assert.equal(pkg.author, 'Avelurs Tinio');
assert.equal(pkg.license, 'MIT');
assert.deepEqual(pkg.files, ['dist']);
assert.equal(pkg.type, 'module');
assert.ok(!pkg.publishConfig?.access || pkg.publishConfig.access === 'public', 'Expected public package access');
assert.equal(Object.keys(pkg.dependencies ?? {}).length, 0);
assert.equal(pkg.version, '0.1.0-alpha.22');
console.log('M22 publication policy: tag publishing enabled, MIT metadata and runtime dependency budget unchanged');
