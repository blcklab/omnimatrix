/** Local helper: writes a P-256 JWK keypair under the ignored .internal directory. Never logs private material. */
import { generateKeyPairSync } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
const issuerId=process.argv[2];
if(!issuerId||!/^[A-Za-z0-9][A-Za-z0-9._:@-]{0,63}$/.test(issuerId)) {
  console.error('Usage: npm run keys:generate -- <issuer-id>  (1–64 allowed ASCII characters)');
  process.exitCode=1;
}else{
  // Do not include the issuerId in a filesystem path on Windows (colon is invalid).
  const name=issuerId.replace(/[^A-Za-z0-9_-]/g,'_');
  const out=resolve('.internal','m19-keys');
  await mkdir(out,{recursive:true,mode:0o700});
  const {publicKey,privateKey}=generateKeyPairSync('ec',{namedCurve:'prime256v1'});
  const privatePath=join(out,`${name}.private.jwk`),publicPath=join(out,`${name}.public.jwk`);
  // Exclusive creation: never silently replace existing keys.
  await writeFile(privatePath,JSON.stringify(privateKey.export({format:'jwk'}),null,2)+'\n',{flag:'wx',mode:0o600});
  await writeFile(publicPath,JSON.stringify(publicKey.export({format:'jwk'}),null,2)+'\n',{flag:'wx',mode:0o600});
  console.log('Keypair created (do not commit or upload private key):');
  console.log(`Private: ${privatePath}`);
  console.log(`Public:  ${publicPath}`);
  console.log('Distribute the public JWK through an authenticated channel before trusting signatures.');
}
