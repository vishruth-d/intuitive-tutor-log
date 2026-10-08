import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import * as I from '../public/invoice.js';
import { validateConfig } from '../public/store.js';
const old=vm.createContext({});
vm.runInContext(readFileSync(new URL('../../multitutor/Code.gs',import.meta.url),'utf8'),old);
const clean=x=>JSON.parse(JSON.stringify(x));
const cfg={name:'Priya',rate:20,startMonth:'2026-09',groups:[{id:'g0',label:'Saturday',year:'11+',start:'09:00',end:'10:30',students:['Sam','Samuel','A "quote"'],colour:'#c9e7ff'}]};
test('invoice styles, dimensions, totals and template requests match legacy exactly',()=>{
  for(const date of [null,new Date(2026,8,1)])assert.deepEqual(clean(I._monthContent(4,cfg.name,cfg.rate,date)),clean(old._monthContent(4,cfg.name,cfg.rate,date)));
  assert.deepEqual(clean(I._summaryContent(2)),clean(old._summaryContent(2)));
});
test('group formulae, partial attendance, dropdowns and cumulative hours match legacy',()=>{
  const ifs=I._buildIfs(cfg);assert.deepEqual(clean(ifs),clean(old._buildIfs(cfg)));
  const row={date:new Date(2026,8,19),students:'Sam',colour:'#c9e7ff',options:['Sam','Samuel','Sam, Samuel']};
  for(const n of [6,7,1001])assert.deepEqual(clean(I._rowReqs(3,n,row,ifs,null)),clean(old._rowReqs(3,n,row,ifs,null)));
  assert.match(ifs.start,/\\bSam\\b/);
});
test('one-off literal year and times match legacy',()=>{
 const row={date:new Date(2027,0,1),students:'Guest',colour:'#ececec',options:['Guest']},a={year:'11+',start:'10:00',end:'11:30'};
 assert.deepEqual(clean(I._rowReqs(4,7,row,I._buildIfs(cfg),a)),clean(old._rowReqs(4,7,row,I._buildIfs(cfg),a)));
});
test('hours, GBP formats and English month names retained',()=>{
 assert.equal(I.HRS,'0.##');assert.equal(I.GBP,'[$£-809]#,##0');
 assert.equal(I._monthTabName(new Date(2026,8,1)),'Sep26');assert.equal(I._monthTabName(new Date(2027,0,1)),'Jan27');
});
test('reject invalid rates, dates, empty rosters, colours and negative durations',()=>{
 for(const patch of [{rate:-1},{rate:Infinity},{startMonth:'2026-13'},{groups:[]},{groups:[{...cfg.groups[0],end:'08:00'}]},{groups:[{...cfg.groups[0],colour:'red;position:absolute'}]}])assert.throws(()=>validateConfig({...cfg,...patch}));
 assert.equal(validateConfig(cfg).name,'Priya');
});
// NOTE: the app.js/CSS ↔ Apps Script mirror (multitutor/Index.html) byte-parity guard was retired here.
// The standalone dashboard has permanently diverged (themes, per-group colours, redesigned typography)
// and those features never ship to the retired Apps Script app, so the comparison no longer adds value.
// Sheet-output parity (invoice.js ↔ Code.gs) is still enforced by the tests above; behaviour is covered by store.test.js.
