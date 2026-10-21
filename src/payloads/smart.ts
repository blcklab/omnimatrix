/** M17 standard text payloads. Pure formatting; never launches actions or performs networking. */
export type SmartPayload =
  | { readonly kind: 'url'; readonly url: string }
  | { readonly kind: 'email'; readonly address: string; readonly subject?: string; readonly body?: string }
  | { readonly kind: 'phone'; readonly number: string }
  | { readonly kind: 'sms'; readonly number: string; readonly body?: string }
  | { readonly kind: 'wifi'; readonly ssid: string; readonly security: 'WPA' | 'WEP' | 'nopass'; readonly password?: string; readonly hidden?: boolean }
  | { readonly kind: 'contact'; readonly name: string; readonly email?: string; readonly phone?: string; readonly organization?: string }
  | { readonly kind: 'geo'; readonly latitude: number; readonly longitude: number }
  | { readonly kind: 'calendar'; readonly summary: string; readonly start: string; readonly end: string; readonly location?: string; readonly description?: string };
export type ParsedSmartPayload = SmartPayload | { readonly kind: 'text'; readonly text: string } | { readonly kind: 'binary'; readonly bytes: Uint8Array };
const LIMIT=65536;
const enc=new TextEncoder();
const dec=new TextDecoder('utf-8', {fatal:true});
function bounded(name:string,value:string,max=4096):string {
  if(typeof value!=='string'||!value.trim()||value.length>max||/[\u0000-\u001f\u007f]/u.test(value)) throw new TypeError(`${name} must be non-empty, bounded, and free of control characters`);
  return value;
}
function emailAddress(value:string):string {
  bounded('email address',value,254);
  if(!/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/u.test(value))throw new TypeError('Invalid email address');
  return value;
}
function phoneNumber(value:string):string {
  bounded('phone number',value,32);
  if(!/^\+?[0-9][0-9() .-]{2,30}$/u.test(value)) throw new TypeError('Invalid telephone number');
  return value;
}
function safeUrl(input:string):string {
  bounded('URL',input,4096);
  let parsed:URL;
  try {parsed=new URL(input);} catch {throw new TypeError('Invalid absolute URL');}
  if(parsed.protocol!=='https:' || !parsed.hostname || parsed.username || parsed.password)throw new TypeError('Only HTTPS links without embedded credentials are supported');
  return parsed.href;
}
function textEscape(value:string):string {return value.replace(/\\/g,'\\\\').replace(/\n/g,'\\n').replace(/,/g,'\\,').replace(/;/g,'\\;');}
function textUnescape(value:string):string {
  let result=''; for(let i=0;i<value.length;i++) { const c=value[i]!; if(c!=='\\'){result+=c;continue;} const next=value[++i]; if(next===undefined||!['\\','n','N',',',';'].includes(next))throw new TypeError('Invalid text escaping'); result+=next==='n'||next==='N'?'\n':next; }return result;
}
function wifiEscape(value:string):string {return value.replace(/([\\;,:"'])/g,'\\$1');}
function wifiUnescape(value:string):string {
  let result=''; for(let i=0;i<value.length;i++) {const c=value[i]!; if(c!=='\\'){result+=c;continue;} const next=value[++i]; if(next===undefined||!['\\',';',',',':','"',"'"].includes(next))throw new TypeError('Invalid Wi-Fi escaping'); result+=next;}return result;
}
function wifiParts(text:string):Record<string,string>|null {
  if(!text.startsWith('WIFI:')||!text.endsWith(';;'))return null;
  const fields:Record<string,string>={};let start=5;let piece='';let escaped=false;
  for(let i=start;i<text.length;i++){
    const c=text[i]!;
    if(escaped){piece+='\\'+c;escaped=false;continue;}
    if(c==='\\'){escaped=true;continue;}
    if(c===';'){
      if(piece){const separator=piece.indexOf(':');if(separator<=0)return null;const key=piece.slice(0,separator), value=piece.slice(separator+1);if(!['T','S','P','H'].includes(key)||Object.hasOwn(fields,key))return null;fields[key]=wifiUnescape(value);}
      piece='';continue;
    }
    piece+=c;
  }
  return escaped||piece?null:fields;
}
function timeString(value:string):string {
  if(!/^\d{8}T\d{6}Z$/.test(value))throw new TypeError('Calendar time must be UTC YYYYMMDDTHHMMSSZ');
  const year=Number(value.slice(0,4)),month=Number(value.slice(4,6))-1,day=Number(value.slice(6,8)),hour=Number(value.slice(9,11)),minute=Number(value.slice(11,13)),second=Number(value.slice(13,15));
  const date=new Date(Date.UTC(year,month,day,hour,minute,second));
  if(year<100||date.getUTCFullYear()!==year||date.getUTCMonth()!==month||date.getUTCDate()!==day||date.getUTCHours()!==hour||date.getUTCMinutes()!==minute||date.getUTCSeconds()!==second)throw new TypeError('Invalid UTC calendar time');
  return value;
}
function serialize(payload:SmartPayload):string {
  switch(payload.kind){
    case 'url':return safeUrl(payload.url);
    case 'email':{
      const address=emailAddress(payload.address);const params=new URLSearchParams();
      if(payload.subject!==undefined)params.set('subject',bounded('subject',payload.subject));
      if(payload.body!==undefined)params.set('body',bounded('body',payload.body));
      return 'mailto:'+address+(params.size?'?'+params.toString():'');
    }
    case 'phone':return 'tel:'+phoneNumber(payload.number);
    case 'sms':return 'sms:'+phoneNumber(payload.number)+(payload.body===undefined?'':'?body='+encodeURIComponent(bounded('SMS body',payload.body)));
    case 'wifi':{
      const ssid=bounded('SSID',payload.ssid,128), security=payload.security;
      if(!['WPA','WEP','nopass'].includes(security))throw new TypeError('Unsupported Wi-Fi security');
      if(security!=='nopass')bounded('Wi-Fi password',payload.password??'',256);
      else if(payload.password)throw new TypeError('Open Wi-Fi must not include a password');
      return `WIFI:T:${security};S:${wifiEscape(ssid)};`+(security==='nopass'?'':`P:${wifiEscape(payload.password!)};`)+(payload.hidden?'H:true;':'')+';';
    }
    case 'contact':{
      const name=bounded('contact name',payload.name,512);
      const lines=['BEGIN:VCARD','VERSION:4.0','FN:'+textEscape(name)];
      if(payload.email!==undefined)lines.push('EMAIL:'+emailAddress(payload.email));
      if(payload.phone!==undefined)lines.push('TEL:'+phoneNumber(payload.phone));
      if(payload.organization!==undefined)lines.push('ORG:'+textEscape(bounded('organization',payload.organization,512)));
      return [...lines,'END:VCARD'].join('\r\n');
    }
    case 'geo':{
      const {latitude,longitude}=payload;
      if(!Number.isFinite(latitude)||!Number.isFinite(longitude)||Math.abs(latitude)>90||Math.abs(longitude)>180)throw new TypeError('Invalid coordinates');
      return `geo:${latitude},${longitude}`;
    }
    case 'calendar':{
      const start=timeString(payload.start),end=timeString(payload.end);
      if(end<=start)throw new TypeError('Calendar end must follow start');
      const lines=['BEGIN:VCALENDAR','VERSION:2.0','BEGIN:VEVENT','DTSTART:'+start,'DTEND:'+end,'SUMMARY:'+textEscape(bounded('summary',payload.summary,512))];
      if(payload.location!==undefined)lines.push('LOCATION:'+textEscape(bounded('location',payload.location,1024)));
      if(payload.description!==undefined)lines.push('DESCRIPTION:'+textEscape(bounded('description',payload.description,4096)));
      return [...lines,'END:VEVENT','END:VCALENDAR'].join('\r\n');
    }
    default:{const never:never=payload;throw new TypeError('Unsupported payload kind: '+String(never));}
  }
}
/** Encode a recognized standard text payload as UTF-8; never changes the optical format. */
export function buildSmartPayload(payload:SmartPayload):Uint8Array {
  const bytes=enc.encode(serialize(payload));
  if(bytes.length>LIMIT)throw new RangeError('Smart payload exceeds 64 KiB safety limit');
  return bytes;
}
function properties(text:string,marker:string):Map<string,string>|null {
  const lines=text.replace(/\r\n/g,'\n').split('\n');
  if(lines.length<4||lines[0]!==`BEGIN:${marker}`||lines.at(-1)!==`END:${marker}`)return null;
  const fields=new Map<string,string>();
  for(const line of lines.slice(1,-1)){
    const index=line.indexOf(':');if(index<=0)return null;
    const key=line.slice(0,index),value=line.slice(index+1);
    if(!/^[A-Z]+$/.test(key)||fields.has(key))return null;
    fields.set(key,value);
  }
  return fields;
}
function parseKnown(text:string):SmartPayload|null {
  if(/^https?:/i.test(text))return {kind:'url',url:safeUrl(text)};
  if(text.startsWith('mailto:')){
    const raw=text.slice(7);const split=raw.indexOf('?');const address=emailAddress(split<0?raw:raw.slice(0,split));
    if(split<0)return {kind:'email',address};
    const query=new URLSearchParams(raw.slice(split+1));
    if([...query.toString().split('&')].some(k=>k && !['subject','body'].includes(decodeURIComponent(k.split('=')[0]!.replace(/\+/g,' ')))))throw new TypeError('Unsupported mailto parameter');
    const subject=query.get('subject')??undefined,body=query.get('body')??undefined;
    return {kind:'email',address,...(subject===undefined?{}:{subject:bounded('subject',subject)}),...(body===undefined?{}:{body:bounded('body',body)})};
  }
  if(text.startsWith('tel:'))return {kind:'phone',number:phoneNumber(text.slice(4))};
  if(text.startsWith('sms:')){
    const value=text.slice(4);const split=value.indexOf('?');const number=phoneNumber(split<0?value:value.slice(0,split));
    if(split<0)return {kind:'sms',number};
    const query=new URLSearchParams(value.slice(split+1));if(query.toString().split('&').some(k=>k && decodeURIComponent(k.split('=')[0]!.replace(/\+/g,' '))!=='body'))throw new TypeError('Unsupported SMS parameter');
    const body=query.get('body');return body===null?{kind:'sms',number}:{kind:'sms',number,body:bounded('SMS body',body)};
  }
  if(text.startsWith('WIFI:')){
    const fields=wifiParts(text);if(!fields||!fields.S||!fields.T)throw new TypeError('Invalid Wi-Fi payload');
    const security=fields.T;if(!['WPA','WEP','nopass'].includes(security))throw new TypeError('Unsupported Wi-Fi security');
    if(fields.H!==undefined&&!['true','false'].includes(fields.H))throw new TypeError('Invalid Wi-Fi hidden flag');
    const payload:SmartPayload={kind:'wifi',ssid:bounded('SSID',fields.S,128),security:security as 'WPA'|'WEP'|'nopass',...(security==='nopass'?{}:{password:bounded('Wi-Fi password',fields.P??'',256)}),...(fields.H==='true'?{hidden:true}:{})};
    if(security==='nopass'&&fields.P)throw new TypeError('Open Wi-Fi must not include a password');
    return payload;
  }
  if(text.startsWith('geo:')){
    const match=/^geo:([+-]?\d+(?:\.\d+)?),([+-]?\d+(?:\.\d+)?)$/.exec(text);
    if(!match)throw new TypeError('Invalid geo URI');
    const payload:SmartPayload={kind:'geo',latitude:Number(match[1]),longitude:Number(match[2])};serialize(payload);return payload;
  }
  if(text.startsWith('BEGIN:VCARD')){
    const fields=properties(text,'VCARD');
    if(!fields||fields.get('VERSION')!=='4.0'||!fields.get('FN')||[...fields.keys()].some(k=>!['VERSION','FN','EMAIL','TEL','ORG'].includes(k)))throw new TypeError('Unsupported vCard format');
    return {kind:'contact',name:bounded('name',textUnescape(fields.get('FN')!),512),...(fields.has('EMAIL')?{email:emailAddress(fields.get('EMAIL')!)}:{}),...(fields.has('TEL')?{phone:phoneNumber(fields.get('TEL')!)}:{}),...(fields.has('ORG')?{organization:bounded('organization',textUnescape(fields.get('ORG')!),512)}:{})};
  }
  if(text.startsWith('BEGIN:VCALENDAR')){
    const lines=text.replace(/\r\n/g,'\n').split('\n');
    if(lines[0]!=='BEGIN:VCALENDAR'||lines[1]!=='VERSION:2.0'||lines[2]!=='BEGIN:VEVENT'||lines.at(-2)!=='END:VEVENT'||lines.at(-1)!=='END:VCALENDAR')throw new TypeError('Unsupported calendar format');
    const fields=new Map<string,string>();for(const line of lines.slice(3,-2)){const idx=line.indexOf(':');if(idx<=0)throw new TypeError('Invalid calendar field');const key=line.slice(0,idx);if(fields.has(key)||!['DTSTART','DTEND','SUMMARY','LOCATION','DESCRIPTION'].includes(key))throw new TypeError('Unsupported calendar field');fields.set(key,line.slice(idx+1));}
    const start=timeString(fields.get('DTSTART')??''),end=timeString(fields.get('DTEND')??'');if(end<=start)throw new TypeError('Invalid event times');
    return {kind:'calendar',start,end,summary:bounded('summary',textUnescape(fields.get('SUMMARY')??''),512),...(fields.has('LOCATION')?{location:bounded('location',textUnescape(fields.get('LOCATION')!),1024)}:{}),...(fields.has('DESCRIPTION')?{description:bounded('description',textUnescape(fields.get('DESCRIPTION')!),4096)}:{})};
  }
  return null;
}
/** Decode bytes into a safe typed preview. Unrecognized strings stay plain text; binary stays binary. */
export function parseSmartPayload(bytes:Uint8Array):ParsedSmartPayload {
  if(!(bytes instanceof Uint8Array)||bytes.length>LIMIT)throw new TypeError('Expected at most 64 KiB of bytes');
  let text:string;try{text=dec.decode(bytes);}catch{return {kind:'binary',bytes:bytes.slice()};}
  if(text.includes('\u0000'))return {kind:'binary',bytes:bytes.slice()};
  try{return parseKnown(text)??{kind:'text',text};}catch{return {kind:'text',text};}
}
/** A scanner UI must never automatically perform an action based on a decoded payload. */
export function smartPayloadSummary(parsed:ParsedSmartPayload):string {
  switch(parsed.kind){
    case 'url':return `HTTPS link: ${parsed.url}`;
    case 'email':return `Email address: ${parsed.address}`;
    case 'phone':return `Telephone: ${parsed.number}`;
    case 'sms':return `SMS recipient: ${parsed.number}`;
    case 'wifi':return `Wi-Fi network: ${parsed.ssid} (${parsed.security}; password hidden)`;
    case 'contact':return `Contact: ${parsed.name}`;
    case 'geo':return `Location: ${parsed.latitude}, ${parsed.longitude}`;
    case 'calendar':return `Event: ${parsed.summary} (${parsed.start})`;
    case 'text':return 'Plain UTF-8 text';
    case 'binary':return 'Binary data';
  }
}
