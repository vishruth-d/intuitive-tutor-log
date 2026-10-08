// Local-only UI preview. --demo uses synthetic data and never calls Google.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import { TutorStore } from '../public/store.js';
import { FakeGoogle } from '../tests/fake-google.js';
const demo=process.argv.includes('--demo'),port=demo?8788:8787;
const root=resolve('public'),fake=new FakeGoogle(),store=new TutorStore(fake.request);
const types={'.html':'text/html','.js':'text/javascript','.css':'text/css'};
const server=createServer(async(req,res)=>{
 try{
  const url=new URL(req.url,'http://localhost');
  if(demo&&url.pathname==='/google-api.js'){
   res.setHeader('Content-Type','text/javascript');res.end(`export const setupError='Local preview: synthetic data only. No Google writes.';export const auth={signIn:async()=>{},signOut:()=>{}};export async function api(fn,payload){const r=await fetch('/demo-api',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({fn,payload})});const out=await r.json();if(!r.ok)throw new Error(out.message);return out;}`.replace("export const setupError='Local preview: synthetic data only. No Google writes.';","export const setupError='';"));return;
  }
  if(demo&&url.pathname==='/demo-api'&&req.method==='POST'){
   let data='';for await(const c of req){data+=c;if(data.length>100000)throw new Error('Too large');}
   const {fn,payload}=JSON.parse(data);let out;
   if(fn==='getState')out=await store.getState('local-test@example.com');
   else if(['createTutorSheet','updateConfig'].includes(fn))out=await store[fn](payload);
   else if(fn==='saveLog')out=await store.saveLog(payload,crypto.randomUUID());
   else if(fn==='totals')out=await store.currentTotals();
   else throw new Error('Unknown preview action');
   res.setHeader('Content-Type','application/json');res.end(JSON.stringify(out));return;
  }
  const path=resolve(root,'.'+(url.pathname==='/'?'/index.html':url.pathname));
  if(!path.startsWith(root+'/')){res.writeHead(403);res.end();return;}
  let content=await readFile(path);
  if(demo&&extname(path)==='.html')content=content.toString().replace('<body>','<body><p style="text-align:center">Local test preview · synthetic data · no Google writes</p>');
  res.setHeader('Content-Type',types[extname(path)]||'application/octet-stream');res.setHeader('Cache-Control','no-store');res.end(content);
 }catch(e){res.writeHead(400,{'Content-Type':'application/json'});res.end(JSON.stringify({message:e.message}));}
});
server.listen(port,'127.0.0.1',()=>console.log(`Local ${demo?'synthetic demo':'app'}: http://localhost:${port}`));
