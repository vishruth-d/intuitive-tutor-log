import { GOOGLE_CLIENT_ID } from '../public/config.js';
import { readFileSync } from 'node:fs';
if(!/^\d+-[a-z0-9]+\.apps\.googleusercontent\.com$/.test(GOOGLE_CLIENT_ID))throw new Error('Set the public Web application OAuth client ID in public/config.js before deploying.');
const files=['index.html','app.js','google-api.js','store.js','invoice.js'];
for(const file of files){if(/google\.script|script\.google\.com|ScriptApp|UrlFetchApp/.test(readFileSync(new URL('../public/'+file,import.meta.url),'utf8')))throw new Error('Legacy Apps Script reference in '+file);}
console.log('Public configuration and runtime checks passed.');
