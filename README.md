# OmniMatrix

OmniMatrix turns data into circular, multicolor optical codes. Use it for a short link, a file, or a larger transfer made of several symbols.

It's a TypeScript library with no runtime dependencies. The format is still experimental: **regular QR scanners can't read OmniMatrix**. Use the companion OmniMatrix scanner or build your own reader with this library.

## Try it

Install the package from npm after the first tagged release:

```bash
npm install @blcklab/omnimatrix@next
```

To develop from this repository instead, use `npm ci && npm run check`. Then:

```ts
import { encodeHybridSymbol, renderHybridSVG } from '@blcklab/omnimatrix';

const data = new TextEncoder().encode('Hello OmniMatrix!');
const symbol = encodeHybridSymbol(data, {
  S: 96,
  palette: 'DENSE_8',
  ecc: 'MEDIUM'
});
const svg = renderHybridSVG(symbol, 1600);
```

`svg` is a string you can save or display as an SVG image. To read a code from a photo, convert the image to RGB pixels and use the optical decoder. [Getting started](docs/GETTING-STARTED.md) shows how.

## What can it carry?

- Text, HTTPS links, contacts, Wi-Fi details and other [smart payloads](docs/SMART-PAYLOADS.md).
- Files with optional filenames and MIME types.
- Optionally signed or password-encrypted content.
- Larger files split into multiple symbols and reassembled after scanning.

The **Core, Orbit, Prism and Pearl** looks are available in the Vue scanner. They keep the same optical symbol underneath.

## Know the limits

OmniMatrix isn't QR-compatible, and camera scanning is sensitive to focus, image size and screen moiré. A 4 KiB phone-camera scan has been demonstrated; reliable 8 KiB camera scanning across devices has **not** been established. A successfully generated code isn't a guarantee that every phone can read it.

For a walkthrough, start at [Documentation](docs/README.md). For the UI, use the separate Vue scanner project.

## Contributing

Run `npm ci` and `npm run check` before opening a pull request. GitHub Actions runs CI on pushes and pull requests. To publish, update the package version, commit, then push a matching `v*` tag. The CI workflow checks code, and the publish workflow sends the tagged release to npm. Historical notes stay in Git-ignored `.internal/`.

MIT License · Copyright © 2026 Avelurs Tinio. See [LICENSE](LICENSE).
