import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSmartPayload, parseSmartPayload, smartPayloadSummary, encodeHybridSymbol, decodeHybridCells } from '../dist/index.js';
import * as module from '../dist/payloads/index.js';
const examples = [
  {kind:'url', url:'https://blcklab.org/omnimatrix?tag=hello'},
  {kind:'email', address:'hello@example.org', subject:'Hey there', body:'Test payload'},
  {kind:'phone', number:'+639171234567'},
  {kind:'sms', number:'+639171234567', body:'Hello: % & 🚀'},
  {kind:'wifi', ssid:'BLCK;LAB: "A"', security:'WPA', password:'pass;:\\word', hidden:true},
  {kind:'wifi', ssid:'Open Network', security:'nopass'},
  {kind:'contact', name:'Mina, Sun; XR', email:'mina@example.org', phone:'+63212345678', organization:'BLCKLAB'},
  {kind:'geo',latitude:14.676,longitude:120.538},
  {kind:'calendar', summary:'OmniMatrix Demo',start:'20261019T093000Z',end:'20261019T103000Z', location:'BLCKLAB, Virtual',description:'Review new payloads'},
];
test('M17 payloads public path',()=>assert.equal(typeof module.buildSmartPayload,'function'));
for(const sample of examples)test(`standards-based smart payload roundtrip: ${sample.kind} (${sample.ssid??sample.name??sample.summary??sample.url??''})`,()=>{
  const bytes=buildSmartPayload(sample);
  const parsed=parseSmartPayload(bytes);
  assert.deepEqual(parsed,sample);
  assert.ok(smartPayloadSummary(parsed).length>5);
  const symbol=encodeHybridSymbol(bytes,{S:96,palette:'DENSE_8',ecc:'MEDIUM'});
  const restored=decodeHybridCells({header:symbol.header,cells:symbol.layout.cells});
  assert.deepEqual(restored.payload,bytes);
  assert.deepEqual(parseSmartPayload(restored.payload),sample);
});
test('legacy text and binary are not broken',()=>{
  assert.deepEqual(parseSmartPayload(new TextEncoder().encode('ordinary text')),{kind:'text',text:'ordinary text'});
  assert.deepEqual(parseSmartPayload(new TextEncoder().encode('javascript:alert(1)')),{kind:'text',text:'javascript:alert(1)'});
  assert.deepEqual(parseSmartPayload(new TextEncoder().encode('http://not-secure.test')),{kind:'text',text:'http://not-secure.test'});
  assert.deepEqual(parseSmartPayload(Uint8Array.of(0xff,0x00,0x80)),{kind:'binary',bytes:Uint8Array.of(0xff,0x00,0x80)});
});
test('untrusted links, injection, impossible calendar and malformed network rejected',()=>{
  for(const url of ['javascript:alert(1)','data:text/html,hi','http://foo.test','https://user:pass@example.org','file:///x'])assert.throws(()=>buildSmartPayload({kind:'url',url}));
  for(const sample of [
    {kind:'wifi',ssid:'\nBAD',security:'WPA',password:'test'},
    {kind:'wifi',ssid:'BAD',security:'nopass',password:'not-allowed'},
    {kind:'calendar',summary:'bad',start:'20260230T123000Z',end:'20260301T123000Z'},
    {kind:'calendar',summary:'bad',start:'20261019T103000Z',end:'20261019T093000Z'},
    {kind:'contact',name:'Injected\r\nEND:VCARD'},
    {kind:'geo',latitude:100,longitude:121},
  ])assert.throws(()=>buildSmartPayload(sample));
  assert.equal(parseSmartPayload(new TextEncoder().encode('WIFI:T:WPA;S:AB;P:foo\\q;;')).kind,'text');
  assert.equal(parseSmartPayload(new TextEncoder().encode('mailto:bad-address')).kind,'text');
});
test('Wi-Fi password remains redacted in summarized UI',()=>{
  const data=parseSmartPayload(buildSmartPayload({kind:'wifi',ssid:'Office',security:'WPA',password:'Top Secret'}));
  assert.doesNotMatch(smartPayloadSummary(data),/Top Secret/);
});
