# Password encryption

Want a code that people can't read without a password? Use OmniMatrix's optional **AES-256-GCM** encryption layer. The optical encoder still works with ordinary bytes; encryption wraps those bytes first.

```ts
import { encryptPayload, decryptPayload, isEncryptedPayload }
  from '@blcklab/omnimatrix/encryption';

const locked = await encryptPayload({
  payload: new TextEncoder().encode('Private message'),
  password: 'use-a-long-random-secret-here'
});

// Encode `locked` like any other payload.
// After scanning it into `recoveredBytes`:
if (isEncryptedPayload(recoveredBytes)) {
  const original = await decryptPayload(recoveredBytes, passwordFromUser);
  console.log(new TextDecoder().decode(original));
}
```

An incorrect password or changed ciphertext fails authentication; the decoder does not return partial plaintext. The envelope uses a fresh 128-bit salt and 96-bit nonce, PBKDF2-HMAC-SHA-256 (310,000 iterations by default), and an authenticated AES-GCM header and tag.

**Use a strong, unique password.** Weak passwords can be guessed offline by anyone who has the symbol. Don't put the password in the symbol or send it alongside the symbol. The container adds about **60 bytes** to the payload.

You can sign data first, then encrypt it. On scanning, **decrypt first, then verify the signature** against a separately trusted public key. Encryption alone doesn't tell you who created the code, and decrypted files are not automatically safe to open.

The encrypted format (OMXC v1) is experimental and has not received an independent security audit. Password-input clearing in an app does not guarantee that every memory copy disappears.
