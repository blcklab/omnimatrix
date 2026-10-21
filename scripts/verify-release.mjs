/** Validate actual npm-package bytes in an isolated install; never publishes. */
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const packageJson = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
assert.notEqual(packageJson.private, true, 'The package must be publishable from a version tag');
assert.deepEqual(Object.keys(packageJson.dependencies ?? {}), [], 'Runtime dependencies require review');
const dir = await mkdtemp(join(tmpdir(), 'omnimatrix-release-'));
function run(bin, args, cwd) {
  // Calling npm.cmd through a shell can break paths containing spaces on Windows.
  // Run the installed JS CLIs directly for cross-platform packaged-consumer checks.
  const cli = process.platform === 'win32' && bin === 'npm' ? process.env.npm_execpath :
    process.platform === 'win32' && bin === 'tsc' ? resolve(root, 'node_modules/typescript/bin/tsc') : null;
  if (process.platform === 'win32' && (bin === 'npm' || bin === 'tsc') && !cli) throw new Error(`Unable to locate ${bin} CLI on Windows`);
  const child = spawnSync(cli ? process.execPath : bin, cli ? [cli, ...args] : args, { cwd, encoding: 'utf8', env: { ...process.env, npm_config_audit: 'false', npm_config_fund: 'false' }, timeout: 120_000 });
  if (child.error || child.status !== 0) {
    throw new Error(`${bin} ${args.join(' ')} FAILED\n${child.error?.message ?? ''}\n${child.stdout}\n${child.stderr}`);
  }
  return child.stdout;
}
try {
  const packed = JSON.parse(run('npm', ['pack', '--ignore-scripts', '--json', '--offline', '--pack-destination', dir], root));
  assert.equal(packed.length, 1);
  const entry = packed[0];
  const tgz = join(dir, entry.filename);
  const names = entry.files.map((file) => file.path);
  const allowed = new Set(['package.json', 'README.md', 'LICENSE']);
  assert.equal(packageJson.author, 'Avelurs Tinio');
  assert.equal(packageJson.license, 'MIT');
  assert.deepEqual(packageJson.files, ['dist'], 'Only the compiled library belongs in the npm files allowlist');
  assert.ok(names.includes('LICENSE'), 'MIT license missing from packed release');
  assert.ok(names.includes('README.md'), 'Package README missing');
  assert.ok(!names.some((name) => name.startsWith('docs/') || name.startsWith('.internal/') || name.startsWith('test/') || name.startsWith('research/') || name.startsWith('.workflows/')), 'Unnecessary documentation, research or development files in npm package');
  assert.ok(names.some((name) => name.startsWith('dist/')), 'Missing compiled JS/types');
  assert.ok(names.every((name) => name.startsWith('dist/') || allowed.has(name)), `Unexpected files in tarball:\n${names.filter((n) => !n.startsWith('dist/') && !allowed.has(n)).join('\n')}`);
  for (const target of Object.values(packageJson.exports)) {
    if (typeof target !== 'object') continue;
    assert.ok(names.includes(target.import.slice(2)), `Missing published JS ${target.import}`);
    assert.ok(names.includes(target.types.slice(2)), `Missing published types ${target.types}`);
  }
  const consumer = join(dir, 'consumer');
  await mkdir(consumer);
  await writeFile(join(consumer, 'package.json'), JSON.stringify({ name: 'omnimatrix-m22-consumer', private: true, type: 'module' }));
  run('npm', ['install', tgz, '--offline', '--no-audit', '--no-fund', '--ignore-scripts', '--package-lock=false'], consumer);
  await writeFile(join(consumer, 'smoke.mjs'), String.raw`
import assert from 'node:assert/strict';
import {
  encodeHybridSymbol, decodeHybridCells, renderHybridSVG, decodeHybridRasterAutomatic,
  decodeHybridRasterBurstAutomatic, assessCaptureQuality, OmniMatrixError,
} from '@blcklab/omnimatrix';
import { BitWriter } from '@blcklab/omnimatrix/core';
import { buildLayout } from '@blcklab/omnimatrix/geometry';
import { readHeader } from '@blcklab/omnimatrix/protocol';
import { decodeHybridRasterRegions } from '@blcklab/omnimatrix/optical';
import { renderSVG } from '@blcklab/omnimatrix/renderers';
import { createResearchSymbol } from '@blcklab/omnimatrix/research';
import { buildSmartPayload, parseSmartPayload } from '@blcklab/omnimatrix/payloads';
import { packBinaryEnvelope, unpackBinaryEnvelope } from '@blcklab/omnimatrix/envelopes';
import { signPayload, verifyTrustedSignedPayload } from '@blcklab/omnimatrix/signatures';
import { encryptPayload, decryptPayload } from '@blcklab/omnimatrix/encryption';
import { planSafePayloadAction } from '@blcklab/omnimatrix/actions';
import {createTransferChunks,TransferCollector} from '@blcklab/omnimatrix/transfers';
for (const value of [BitWriter, buildLayout, readHeader, decodeHybridRasterRegions, renderSVG, createResearchSymbol, decodeHybridRasterAutomatic, decodeHybridRasterBurstAutomatic, assessCaptureQuality, OmniMatrixError]) {
  assert.equal(typeof value, 'function');
}
for (const [length, S] of [[4096, 112], [8192, 160]]) {
  const input = Uint8Array.from({ length }, (_, i) => (i * 73 + (i >> 3) * 37) & 255);
  const symbol = encodeHybridSymbol(input, { S, palette: 'DENSE_8', ecc: 'MEDIUM' });
  assert.ok(renderHybridSVG(symbol, 256).startsWith('<svg'));
  const actual = decodeHybridCells({ header: symbol.header, cells: symbol.layout.cells.map(({q,r,colorIndex}) => ({q,r,colorIndex})) });
  assert.deepEqual(actual.payload, input);
}
assert.deepEqual(parseSmartPayload(buildSmartPayload({kind:'url',url:'https://example.org/m17'})),{kind:'url',url:'https://example.org/m17'});
assert.equal(planSafePayloadAction({kind:'url',url:'https://example.org'}).target,'https://example.org/');
assert.deepEqual(unpackBinaryEnvelope(packBinaryEnvelope({kind:'file',filename:'test.bin',data:Uint8Array.of(0,255)})).data,Uint8Array.of(0,255));
const kp=await crypto.subtle.generateKey({name:'ECDSA',namedCurve:'P-256'},false,['sign','verify']);
const signed=await signPayload({issuerId:'blcklab-demo',payload:Uint8Array.of(1,2,3),privateKey:kp.privateKey});
assert.equal((await verifyTrustedSignedPayload(signed,new Map([['blcklab-demo',kp.publicKey]]))).status,'trusted');
const encrypted=await encryptPayload({payload:signed,password:'a sufficiently long secret password'});
assert.deepEqual(await decryptPayload(encrypted,'a sufficiently long secret password'),signed);
const parts=await createTransferChunks(Uint8Array.of(1,2,3),{chunkBytes:128});
const transfer=new TransferCollector();
assert.deepEqual((await transfer.add(parts[0])).payload,Uint8Array.of(1,2,3));
console.log('Isolated ESM consumer: declared paths, M17 smart payloads, M18 envelopes and 4/8 KiB logical bytes PASS');
`);
  run('node', ['smoke.mjs'], consumer);
  await writeFile(join(consumer, 'smoke.ts'), String.raw`
import { encodeHybridSymbol, decodeHybridCells, type HybridEncodeOptions, type Raster, type PaletteName, OmniMatrixError } from '@blcklab/omnimatrix';
import { type EccProfile } from '@blcklab/omnimatrix/protocol';
import { packBinaryEnvelope, type BinaryEnvelope } from '@blcklab/omnimatrix/envelopes';
import { signPayload, verifySignedPayload, type ParsedSignedPayload } from '@blcklab/omnimatrix/signatures';
import { encryptPayload, decryptPayload, type EncryptedPayloadInfo } from '@blcklab/omnimatrix/encryption';
import { planSafePayloadAction, type SafePayloadAction } from '@blcklab/omnimatrix/actions';
import {createTransferChunks,TransferCollector,type TransferProgress} from '@blcklab/omnimatrix/transfers';
import { decodeHybridRasterAutomatic, type AutomaticDetectionOptions } from '@blcklab/omnimatrix/optical';
import { BitWriter } from '@blcklab/omnimatrix/core';
import { buildLayout } from '@blcklab/omnimatrix/geometry';
const palette: PaletteName = 'DENSE_8';
const ecc: EccProfile = 'MEDIUM';
const options: HybridEncodeOptions = { S: 96, palette, ecc };
const symbol = encodeHybridSymbol(new Uint8Array([1, 2, 3]), options);
const decoded: Uint8Array = decodeHybridCells({ header: symbol.header, cells: symbol.layout.cells }).payload;
const raster: Raster = { width: 1, height: 1, data: new Uint8Array([0, 0, 0]) };
const detectOptions: AutomaticDetectionOptions = { minimumDiameterPx: 160 };
const scan = () => decodeHybridRasterAutomatic(raster, detectOptions);
const bitWriter = new BitWriter();
const layout = buildLayout(96, palette);
const error: OmniMatrixError | undefined = undefined;
const packedFile: Uint8Array = packBinaryEnvelope({kind:'file',filename:'file.dat',data:new Uint8Array([0])});
const frame: BinaryEnvelope | undefined = undefined;
const useEncrypt: typeof encryptPayload = encryptPayload;
const useDecrypt: typeof decryptPayload = decryptPayload;
const encryptedInfo: EncryptedPayloadInfo | undefined = undefined;
const useSign: typeof signPayload = signPayload;
const useVerify: typeof verifySignedPayload = verifySignedPayload;
const signed: ParsedSignedPayload | undefined = undefined;
const action: SafePayloadAction | null = planSafePayloadAction({kind:'url',url:'https://example.org'});
const transferProgress: TransferProgress | undefined = undefined;
void [createTransferChunks,TransferCollector,transferProgress,decoded, scan, bitWriter, layout, error, packedFile, frame, useEncrypt, useDecrypt, encryptedInfo, useSign, useVerify, signed, action];
`);
  await writeFile(join(consumer, 'tsconfig.json'), JSON.stringify({ compilerOptions: { target: 'ES2022', module: 'NodeNext', moduleResolution: 'NodeNext', noEmit: true, strict: true, skipLibCheck: false }, include: ['smoke.ts'] }));
  run('tsc', ['-p', 'tsconfig.json'], consumer);
  console.log(`M22 packed-release gate PASS: ${entry.filename}, ${names.length} packed files, offline install, JavaScript imports, 4/8 KiB logical bytes, TypeScript declarations`);
} finally {
  await rm(dir, { recursive: true, force: true });
}
