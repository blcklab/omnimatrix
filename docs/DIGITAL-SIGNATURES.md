# Digital signatures

Use a signature when someone scanning a code needs to check who issued it and whether its contents changed. OmniMatrix uses **ES256 (ECDSA P-256 + SHA-256)**.

A signature **does not hide the data**. And a name written inside a code isn't proof of identity—you must already trust the corresponding public key.

```ts
import { signPayload, verifyTrustedSignedPayload }
  from '@blcklab/omnimatrix/signatures';

const signed = await signPayload({
  issuerId: 'example-issuer',
  payload: originalBytes,
  privateKey
});

// After scanning `signed` back into `recoveredBytes`:
const trusted = new Map([['example-issuer', trustedPublicKey]]);
const result = await verifyTrustedSignedPayload(recoveredBytes, trusted);
if (result.status === 'trusted') {
  console.log(result.signed.payload);
}
```

Possible results are `trusted`, `unknown-issuer` and `invalid-signature`. Only show an authenticated-content state after verification against a public key you obtained through a separate, trusted channel.

## Create a test key

In the engine repository, run:

```bash
npm run keys:generate -- blcklab-demo
```

This creates a private and public JWK under Git-ignored `.internal/m19-keys/`. **Never commit or share the private key.** Signing accepts a P-256 private `CryptoKey` or JWK; verification uses a public key only. Web Crypto requires a secure context such as HTTPS or localhost.

The **OMXS v1** envelope carries an issuer ID, payload and 64-byte ECDSA signature. Its overhead is 80 bytes plus the issuer ID length. A verified signature does not prove freshness or prevent replay, and it never authorizes automatic actions. Use [encryption](AUTHENTICATED-ENCRYPTION.md) for private content.
