# Send larger files in several symbols

Some files don't fit in one OmniMatrix. The transfer module breaks the bytes into smaller chunks, so each one becomes a normal, scannable OmniMatrix symbol. The recipient can scan them in any order.

```ts
import { createTransferChunks, TransferCollector }
  from '@blcklab/omnimatrix/transfers';

const chunks = await createTransferChunks(originalBytes, { chunkBytes: 2048 });
// Encode each `chunks[i]` into its own symbol.

const collector = new TransferCollector();
for (const bytes of scannedChunks) {
  const result = await collector.add(bytes);
  console.log(result.progress.received, '/', result.progress.total);
  if (result.status === 'complete') {
    console.log(result.payload); // full file, verified
  }
}
```

You can scan parts out of order. Identical duplicates are ignored; conflicting or mixed transfers are rejected. The file is only available when **every chunk is present and the whole-payload SHA-256 check passes**. Don't offer partial data as a recovered file.

The **OMXT v1** transfer adds 80 bytes of metadata to each chunk, including a transfer ID, chunk index/count, CRC checks and a final SHA-256 digest. Chunks default to 2,048 bytes (allowed 128–4,096). The engine has a 16 MiB input cap and at most 4,096 parts; this is **not** a promise that a phone can scan such a large transfer reliably.

Signing or encryption comes **before** splitting. Once collected, decrypt and/or verify signatures as usual. CRC and SHA-256 verify data integrity, not who created the file.
