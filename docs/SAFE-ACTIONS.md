# Safe actions after scanning

Scanning a code should never trigger an action on its own. First show the person what was found, and ask them to confirm.

Use `planSafePayloadAction` to describe a possible action. The library **does not execute it**:

```ts
import { parseSmartPayload } from '@blcklab/omnimatrix/payloads';
import { planSafePayloadAction } from '@blcklab/omnimatrix/actions';

const parsed = parseSmartPayload(recoveredBytes);
const plan = planSafePayloadAction(parsed);
// Show the description and destination; ask before using the action.
```

Depending on the content, a plan can offer an HTTPS link, email, call, SMS, map location, contact/card download, calendar download or copying a **Wi-Fi network name**. It won't join a Wi-Fi network or copy its password.

If the content is encrypted, decrypt it first. If it is signed, verify the signature against a trusted public key first. A valid signature doesn't make an unfamiliar URL harmless—always show the destination before opening it. File metadata is untrusted too.

When a new scan arrives or the selected key changes, discard any old pending confirmation.
