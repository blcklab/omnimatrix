/** M21 safe action descriptors. Pure planning: no I/O, network, clipboard or navigation. */
import { buildSmartPayload, type ParsedSmartPayload } from '../payloads/index.js';

export type SafePayloadAction =
  | { readonly kind:'external'; readonly label:string; readonly description:string; readonly target:string }
  | { readonly kind:'download'; readonly label:string; readonly description:string; readonly filename:string; readonly mediaType:string; readonly data:Uint8Array }
  | { readonly kind:'copy'; readonly label:string; readonly description:string; readonly text:string };

/** Return a non-executing action description for recognized, validated content only.
 * The caller MUST display the destination/details and obtain fresh user confirmation.
 * Signature and decryption trust gates belong to the caller, before calling this API.
 */
export function planSafePayloadAction(input:ParsedSmartPayload):SafePayloadAction|null {
  if(!input || typeof input !== 'object' || !('kind' in input)) return null;
  if(input.kind==='text' || input.kind==='binary') return null;
  // Serialize using the exact M17 public validation rules; malformed fields never become actions.
  const canonical=new TextDecoder('utf-8',{fatal:true}).decode(buildSmartPayload(input));
  switch(input.kind){
    case 'url':return {kind:'external',label:'Open HTTPS link',description:`Open this address in a new browser tab: ${canonical}`,target:canonical};
    case 'email':return {kind:'external',label:'Compose email',description:`Ask your mail application to compose a message to ${input.address}. Confirm the recipient before sending.`,target:canonical};
    case 'phone':return {kind:'external',label:'Call number',description:`Ask your device to call ${input.number}. Your phone may dial immediately.`,target:canonical};
    case 'sms':return {kind:'external',label:'Compose SMS',description:`Ask your messages application to compose an SMS for ${input.number}. Review before sending.`,target:canonical};
    case 'geo':{
      const lat=String(input.latitude),lon=String(input.longitude);
      return {kind:'external',label:'View location on map',description:`Open a map of ${lat}, ${lon}. No location is sent until you confirm.`,target:`https://www.openstreetmap.org/?mlat=${encodeURIComponent(lat)}&mlon=${encodeURIComponent(lon)}#map=14/${encodeURIComponent(lat)}/${encodeURIComponent(lon)}`};
    }
    case 'wifi':return {kind:'copy',label:'Copy network name',description:`Copy the Wi-Fi network name (${input.ssid}) to your clipboard. This will NOT join the network or copy a password.`,text:input.ssid};
    case 'contact':return {kind:'download',label:'Download contact (.vcf)',description:`Download a contact card for ${input.name}. Review it in your contacts application before importing.`,filename:'omnimatrix-contact.vcf',mediaType:'text/vcard;charset=utf-8',data:new TextEncoder().encode(canonical)};
    case 'calendar':return {kind:'download',label:'Download event (.ics)',description:`Download the event ${input.summary}. Review the details before importing.`,filename:'omnimatrix-event.ics',mediaType:'text/calendar;charset=utf-8',data:new TextEncoder().encode(canonical)};
  }
}
