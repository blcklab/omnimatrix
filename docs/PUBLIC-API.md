# API reference

OmniMatrix is an ESM TypeScript package. It supports Node.js 20+ and modern browsers; cryptographic features require Web Crypto. The package has **no runtime dependencies**.

## Imports

| Import path | Use it for |
| --- | --- |
| `@blcklab/omnimatrix` | Generating, rendering and decoding symbols |
| `/core`, `/protocol`, `/geometry` | Lower-level bytes, framing, error correction and geometry |
| `/optical` | Camera-image detection, burst decoding and capture diagnostics |
| `/renderers` | Rendering helpers |
| `/payloads` | Links, contacts, Wi-Fi, email, SMS, location and calendar |
| `/envelopes` | Filename and MIME metadata for files |
| `/signatures` | Signing data and checking a trusted issuer |
| `/encryption` | Password encryption and decryption |
| `/actions` | Planning actions that require user confirmation |
| `/transfers` | Sending a file across several symbols |
| `/research` | Experimental tools; not a stable public interface |

Use the full package prefix, for example `@blcklab/omnimatrix/encryption`.

## Common functions

| Function | What it does |
| --- | --- |
| `encodeHybridSymbol(bytes, options)` | Encodes a `Uint8Array` into a symbol |
| `renderHybridSVG(symbol, pixelSize)` | Produces an SVG string |
| `decodeHybridRasterAutomatic(rgbRaster)` | Decodes a detected symbol from RGB pixels |
| `decodeHybridRasterRegions(rgbRaster)` | Retries detection in bounded image regions |
| `decodeHybridRasterBurstAutomatic(frames)` | Experimental multi-frame recovery |
| `decodeHybridSymbol(symbol)` | Checks a generated symbol directly—not a camera test |
| `assessCaptureQuality(image)` | Reports advisory image-quality measurements |
| `buildSmartPayload(input)` / `parseSmartPayload(bytes)` | Makes or recognizes common text payloads |
| `packBinaryEnvelope(input)` / `unpackBinaryEnvelope(bytes)` | Preserves file metadata |
| `signPayload(input)` / `verifyTrustedSignedPayload(bytes, keys)` | Signs content and checks it against trusted keys |
| `encryptPayload(input)` / `decryptPayload(bytes, password)` | Protects and unlocks bytes |
| `planSafePayloadAction(parsed)` | Describes a possible action without performing it |
| `createTransferChunks(bytes)` / `TransferCollector` | Splits and reassembles larger data |

For encoding, `S` must be a multiple of 16 from 32 to 512. Supported palettes are `DENSE_8` and `RELIABLE_4`; error-correction levels are `LIGHT`, `MEDIUM`, and `STRONG`.

## Errors and compatibility

An `OmniMatrixError` has a `.code`, such as `INVALID_INPUT`, `CAPACITY_EXCEEDED`, `INVALID_GEOMETRY`, `ECC_UNRECOVERABLE`, or `CRC_MISMATCH`. A failed scan must not be treated as recovered data. CRC isn't a signature.

The package is still an **alpha**, so a future release may change its APIs. The release tests check compatibility with the earlier exports and packed-package installation, but there is no 1.0 stability promise yet.

**License:** MIT. The package publishes from matching Git tags using GitHub Actions. Repository guides in `docs/` aren't included in the npm tarball.
