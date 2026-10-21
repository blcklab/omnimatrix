/** Zero-dependency local-only HTTP server for M1b browser photo testing. */
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { resolve, sep, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.png':'image/png','.svg':'image/svg+xml','.json':'application/json'};
const server=createServer(async(req,res)=>{
  const url = new URL(req.url??'/', 'http://127.0.0.1');
  let file;
  try { file=resolve(root,'.'+decodeURIComponent(url.pathname)); } catch { res.writeHead(400).end();return; }
  if(!(file===root||file.startsWith(root+sep))) {res.writeHead(403).end();return;}
  if(file===root) file=resolve(root,'research/capture-lab.html');
  const relative=file.slice(root.length+1).replaceAll('\\','/');
  if(!(relative==='research/capture-lab.html'||relative.startsWith('research/fixtures/')||relative.endsWith('.js')&&relative.startsWith('dist/'))) {res.writeHead(403).end('Not permitted');return;}
  try {
    const s=await stat(file);
    if(!s.isFile()) {res.writeHead(404).end();return;}
    const bytes=await readFile(file);
    res.writeHead(200,{'content-type':mime[extname(file)]??'application/octet-stream','cache-control':'no-store','x-content-type-options':'nosniff'}).end(bytes);
  } catch {res.writeHead(404).end('Not found');}
});
const port = Number(process.env.OMNIMATRIX_PORT ?? 4173);
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new RangeError('OMNIMATRIX_PORT must be an integer in [1024,65535]');
server.on('error', (error) => { console.error(`Capture lab failed on port ${port}: ${error.message}`); process.exitCode = 1; });
server.listen(port, '127.0.0.1', () => console.log(`Open http://127.0.0.1:${port} (local only; photos stay in browser)`));
