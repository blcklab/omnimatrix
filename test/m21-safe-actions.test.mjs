import test from 'node:test';
import assert from 'node:assert/strict';
import {planSafePayloadAction} from '../dist/actions/index.js';
import {buildSmartPayload,parseSmartPayload} from '../dist/payloads/index.js';
function plan(p){return planSafePayloadAction(parseSmartPayload(buildSmartPayload(p)));}
test('M21: HTTPS, mail, phone and SMS produce inert external plans',()=>{
  const url=plan({kind:'url',url:'https://example.org/a?x=1'});
  assert.equal(url.kind,'external');assert.equal(url.target,'https://example.org/a?x=1');
  const email=plan({kind:'email',address:'team@example.org',subject:'Check',body:'Hi'});
  assert.ok(email.target.startsWith('mailto:team@example.org?'));
  assert.equal(plan({kind:'phone',number:'+639171234567'}).target,'tel:+639171234567');
  assert.match(plan({kind:'sms',number:'+639171234567',body:'Check in'}).target,/^sms:/);
});
test('M21: rejects unsafe, malformed or raw actions',()=>{
  assert.equal(planSafePayloadAction(parseSmartPayload(new TextEncoder().encode('javascript:alert(1)'))),null);
  assert.equal(planSafePayloadAction(parseSmartPayload(new TextEncoder().encode('http://example.org'))),null);
  assert.equal(planSafePayloadAction({kind:'text',text:'hi'}),null);
  assert.equal(planSafePayloadAction({kind:'binary',bytes:Uint8Array.of(255)}),null);
  assert.throws(()=>planSafePayloadAction({kind:'url',url:'https://alice:secret@example.org'}));
  assert.throws(()=>planSafePayloadAction({kind:'geo',latitude:100,longitude:2}));
});
test('M21: contact/calendar produce canonical inert downloads, not executable HTML',()=>{
  const contact=plan({kind:'contact',name:'Jane Doe',email:'jane@example.org'});
  assert.equal(contact.kind,'download');assert.equal(contact.filename,'omnimatrix-contact.vcf');
  assert.match(new TextDecoder().decode(contact.data),/^BEGIN:VCARD/);
  const event=plan({kind:'calendar',summary:'Meeting',start:'20261019T090000Z',end:'20261019T100000Z'});
  assert.equal(event.kind,'download');assert.equal(event.filename,'omnimatrix-event.ics');
  assert.match(new TextDecoder().decode(event.data),/^BEGIN:VCALENDAR/);
});
test('M21: location is HTTPS only, Wi-Fi copies SSID not secret',()=>{
  const location=plan({kind:'geo',latitude:14.67,longitude:120.5});
  assert.ok(location.target.startsWith('https://www.openstreetmap.org/'));
  const wifi=plan({kind:'wifi',ssid:'My private Wi-Fi',security:'WPA',password:'TOP_SECRET_PASSWORD'});
  assert.equal(wifi.kind,'copy');assert.equal(wifi.text,'My private Wi-Fi');
  assert.ok(!JSON.stringify(wifi).includes('TOP_SECRET_PASSWORD'));
});
