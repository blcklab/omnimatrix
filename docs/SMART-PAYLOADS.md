# Smart payloads

A code doesn't have to contain raw text. OmniMatrix can format common things—like a web link, phone number or contact card—then recognize them again after scanning. These are **ordinary readable bytes**, not encrypted content.

```ts
import { buildSmartPayload, parseSmartPayload, smartPayloadSummary }
  from '@blcklab/omnimatrix/payloads';

const bytes = buildSmartPayload({ kind: 'url', url: 'https://example.org' });
const parsed = parseSmartPayload(bytes);
console.log(smartPayloadSummary(parsed));
```

## Supported types

| `kind` | Fields |
| --- | --- |
| `url` | `url` (HTTPS only) |
| `email` | `address`, optional `subject` and `body` |
| `phone` | `number` |
| `sms` | `number`, optional `body` |
| `wifi` | `ssid`, `security` (`WPA`, `WEP` or `nopass`), optional `password` and `hidden` |
| `contact` | `name`, optional `email`, `phone`, `organization` |
| `geo` | `latitude`, `longitude` |
| `calendar` | `summary`, `start`, `end`, optional `location`, `description` |

Calendar times use UTC `YYYYMMDDTHHMMSSZ`, for example `20261019T093000Z`. Contact and calendar parsers handle the formats these builders produce; they are not general-purpose vCard or iCalendar parsers.

Unknown or unsafe text stays plain text; unreadable binary remains binary. Parsing **does not open a link, send a message, join Wi-Fi or import anything**. Wi-Fi passwords are still present in the bytes, so share those symbols carefully; previews hide the password.

Need a filename? See [Files and metadata](BINARY-ENVELOPES.md). For authenticity or privacy, see [Signatures](DIGITAL-SIGNATURES.md) and [Encryption](AUTHENTICATED-ENCRYPTION.md).
