# Files and metadata

OmniMatrix already supports raw bytes. Use the optional binary envelope if you also want to store a filename and MIME type. It doesn't change how the optical symbol looks.

```ts
import { packBinaryEnvelope, unpackBinaryEnvelope, isBinaryEnvelope }
  from '@blcklab/omnimatrix/envelopes';

const bytes = packBinaryEnvelope({
  kind: 'file',
  filename: 'receipt.pdf',
  mediaType: 'application/pdf',
  data: pdfBytes
});

// Give `bytes` to the regular symbol encoder.
// After scanning, `recoveredBytes` holds the optical payload.
if (isBinaryEnvelope(recoveredBytes)) {
  const file = unpackBinaryEnvelope(recoveredBytes);
  console.log(file.filename, file.data);
}
```

`isBinaryEnvelope` only checks the prefix. `unpackBinaryEnvelope` validates the whole frame; always use it before reading metadata or saving a file.

The **OMXE v1** envelope contains a version, content type, optional filename, length and CRC-32. It rejects damaged lengths, trailing bytes and unsafe filenames. Filenames and MIME types are still user-supplied information: don't execute files or render HTML automatically.

Metadata takes space. For example, 8,192 bytes of raw data **plus** a filename won't fit into an 8,192-byte payload limit. Use a larger symbol, raw mode, or [multisymbol transfers](MULTISYMBOL-TRANSFERS.md).

**Technical details:** OMXE v1 has a 20-byte header followed by UTF-8 MIME, UTF-8 filename and file bytes. Fields use unsigned big-endian lengths and a CRC-32/ISO-HDLC over the version/length fields, metadata and data. CRC checks accidental damage, not identity or secrecy. Use signatures or encryption separately when needed.
