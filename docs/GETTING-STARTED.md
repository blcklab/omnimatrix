# Getting started

OmniMatrix encodes bytes as a circular, colorful optical symbol. The library is framework-independent, and it doesn't need runtime dependencies.

## Install

Once the first release is published, install the current preview from npm:

```bash
npm install @blcklab/omnimatrix@next
```

If you're working on the library itself, use:

```bash
npm ci
npm run check
```

The Vue scanner project uses its own bundled engine until its dependency is updated to the published version.

## Generate a code

```ts
import { encodeHybridSymbol, renderHybridSVG } from '@blcklab/omnimatrix';

const bytes = new TextEncoder().encode('Hello OmniMatrix');
const symbol = encodeHybridSymbol(bytes, {
  S: 96,
  palette: 'DENSE_8',
  ecc: 'MEDIUM'
});
const svg = renderHybridSVG(symbol, 1600);
```

Save `svg` as an `.svg` file or render it as an image. It's SVG markup, not a DOM element. Don't inject SVG from unknown sources directly into an HTML page.

The `S` setting determines the symbol geometry. Larger payloads need a larger size. Encoding 8 KiB is possible in our current format, but a real camera must still distinguish every small cell.

## Decode an image

The optical decoder expects **RGB pixels**, not a PNG/JPEG file or RGBA pixels. Use Canvas or an image library to obtain them:

```ts
import { decodeHybridRasterAutomatic } from '@blcklab/omnimatrix';

const rgb = new Uint8Array(width * height * 3);
for (let i = 0, j = 0; i < imageData.data.length; i += 4, j += 3) {
  rgb[j] = imageData.data[i]!;
  rgb[j + 1] = imageData.data[i + 1]!;
  rgb[j + 2] = imageData.data[i + 2]!;
}
const result = decodeHybridRasterAutomatic({ width, height, data: rgb });
console.log(result.decoded.payload);
```

In this example `width`, `height` and `imageData` come from a decoded canvas image. Check the input dimensions and pixel length before allocating buffers. The Vue scanner already handles image loading and camera capture.

## If a photo won't scan

Keep the full circular rim and white margin visible. Hold the camera roughly straight, focus sharply, and try a larger display size or a different distance to reduce screen moiré. A 4 KiB symbol is generally easier to photograph than an 8 KiB symbol.

Decode errors such as `INVALID_GEOMETRY`, `ECC_UNRECOVERABLE` and `CRC_MISMATCH` mean the scan failed; don't use partial bytes as a recovered file. CRC checks detect accidental corruption, **not authenticity**. For signed or encrypted content, use the separate security modules.

Next: [Smart payloads](SMART-PAYLOADS.md) · [API reference](PUBLIC-API.md)
