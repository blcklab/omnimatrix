import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
const root = fileURLToPath(new URL('..', import.meta.url));

test('MIT ownership and distribution allowlist are explicit', () => {
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  assert.equal(pkg.author, 'Avelurs Tinio');
  assert.equal(pkg.license, 'MIT');
  assert.notEqual(pkg.private, true, 'Tag-based npm publishing must be enabled');
  assert.deepEqual(pkg.files, ['dist']);
  const license = readFileSync(join(root, 'LICENSE'), 'utf8');
  assert.match(license, /^MIT License/);
  assert.match(license, /Copyright \(c\) 2026 Avelurs Tinio/);
  assert.ok(existsSync(join(root, 'docs', 'README.md')), 'Repository documentation remains present');
});
