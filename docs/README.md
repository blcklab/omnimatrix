# OmniMatrix guides

New to OmniMatrix? Start with [Getting started](GETTING-STARTED.md). You can generate a code in a few lines of TypeScript, then use the Vue scanner to try reading it.

| I want to… | Read |
| --- | --- |
| Generate a symbol or decode an image | [Getting started](GETTING-STARTED.md) |
| Find a function or import path | [API reference](PUBLIC-API.md) |
| Store a link, contact or Wi-Fi network | [Smart payloads](SMART-PAYLOADS.md) |
| Keep a filename with a file | [Files and metadata](BINARY-ENVELOPES.md) |
| Check who signed a code | [Digital signatures](DIGITAL-SIGNATURES.md) |
| Protect content with a password | [Encryption](AUTHENTICATED-ENCRYPTION.md) |
| Safely open links or download files | [Safe actions](SAFE-ACTIONS.md) |
| Send a file across several symbols | [Multisymbol transfers](MULTISYMBOL-TRANSFERS.md) |

All of these features are optional. Ordinary text and binary symbols still work without them.

These guides live in the GitHub source repository. The npm tarball deliberately contains **only the compiled library, package metadata, README and LICENSE**—not the `docs/` folder. OmniMatrix is experimental and requires a compatible scanner; ordinary QR apps won't recognize it.
