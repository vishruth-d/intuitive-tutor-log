import * as I from './invoice.js';

const SHEETS = 'https://sheets.googleapis.com/v4/spreadsheets';
const DRIVE = 'https://www.googleapis.com/drive/v3/files';
const KEY = 'intuitiveTutorConfigV1';
const TAG = 'intuitive-tutor-log-v1';
const CONFIG_ID = 1;
const GUARD_BASE = 1000000;
const urlFor = id => `https://docs.google.com/spreadsheets/d/${encodeURIComponent(id)}/edit`;
// Month tabs (title + gid) so the client can deep-link an invoice email to J6 of a given month.
const monthsOf = sheets => (sheets||[]).filter(s=>I._isMonthTab(s.properties.title)).map(s=>({title:s.properties.title,gid:s.properties.sheetId}));
const textCell = (value, fmt) => ({userEnteredValue:{stringValue:String(value)},userEnteredFormat:fmt});

export function validateConfig(payload) {
  const name = String(payload.name || '').trim();
  const rate = Number(payload.rate);
  if (!name || name.length > 200) throw new Error('Enter your name (up to 200 characters).');
  if (!Number.isFinite(rate) || rate < 0 || rate > 10000) throw new Error('Enter a valid hourly rate.');
  if (!/^20\d{2}-(0[1-9]|1[0-2])$/.test(payload.startMonth)) throw new Error('Enter a valid start month.');
  const groups = I._mkGroups(payload.groups);
  if (!groups.length || groups.length > 50) throw new Error('Add between 1 and 50 groups.');
  const ids = new Set();
  for (const g of groups) {
    if (ids.has(g.id)) throw new Error('Each group needs its own ID.');
    ids.add(g.id);
    if (!g.students.length || g.students.length > 50) throw new Error('Add 1–50 students to “'+(g.label||'your group')+'”.');
    if (g.students.some(s => s.length > 200)) throw new Error('Student names must be under 200 characters.');
    if (!/^#[0-9a-f]{6}$/i.test(g.colour)) throw new Error('Invalid group colour.');
    validateTimes(g.start, g.end);
  }
  const theme=payload.theme||'classic';
  if(!['classic','sage','ocean','blush','plum'].includes(theme))throw new Error('Choose an available theme.');
  const cfg = {name, rate, startMonth:payload.startMonth, groups, theme};
  if (JSON.stringify(cfg).length > 14000) throw new Error('This roster is too large. Shorten group or student names.');
  return cfg;
}
function validateTimes(start, end) {
  const valid = t => /^([01]\d|2[0-3]):[0-5]\d$/.test(t);
  if (!valid(start) || !valid(end) || end <= start) throw new Error('Each session needs an end time after its start time.');
}
function dateFrom(value) {
  if (!/^20\d{2}-\d{2}-\d{2}$/.test(String(value))) throw new Error('Choose a valid session date.');
  const d = I._toDate(value);
  const check = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  if (check !== value) throw new Error('Choose a valid session date.');
  return d;
}
function summaryRequests(sheets) {
  const summary = sheets.find(s => s.properties.title === I.SUMMARY);
  if (!summary) throw new Error('Summary Statement is missing. Restore it in Google Sheets first.');
  const years = new Map();
  for (const s of sheets) {
    const t = s.properties.title;
    if (!I._isMonthTab(t) || !I._MONTHS.includes(t.slice(0,3))) continue;
    const year = 2000 + Number(t.slice(3));
    years.set(year, [...(years.get(year) || []), t]);
  }
  const req = [I._setCells(summary.properties.sheetId,6,1,Array.from({length:100},()=>[{}, {}, {}]))];
  [...years.keys()].sort().forEach((year, i) => {
    const r = 7+i;
    req.push(I._setCells(summary.properties.sheetId,r-1,1,[[
      I._cell(year,I._fmt({align:'CENTER',bold:false})),
      I._cell('='+years.get(year).sort((a,b)=>I._MONTHS.indexOf(a.slice(0,3))-I._MONTHS.indexOf(b.slice(0,3))).map(t=>`'${t}'!J6`).join('+'),I._fmt({align:'CENTER',bold:false,numFmt:I.GBP})),
      I._cell(i ? `=D${r-1}+C${r}` : `=C${r}`,I._fmt({align:'CENTER',bold:false,numFmt:I.GBP}))
    ]]));
  });
  return req;
}
// Removes the legacy "Blank Template" tab from sheets created by earlier versions.
function legacyPurge(meta) {
  const t = meta.sheets.find(s => s.properties.title === 'Blank Template');
  return t ? [{deleteSheet:{sheetId:t.properties.sheetId}}] : [];
}
// Background-only cell update (used to re-colour existing logged rows without touching their values).
function bgOnly(sid,row0,col0,hex) {
  return {updateCells:{start:{sheetId:sid,rowIndex:row0,columnIndex:col0},rows:[{values:[{userEnteredFormat:I._fmt({bg:hex})}]}],fields:'userEnteredFormat.backgroundColor'}};
}
// Rebuild a month tab's totals block at its fixed rows (Total hours row 5, Total payment row 6) and clear any
// drifted copies that past row-inserts pushed down into columns I:J of the data. J5 uses =MAX(G5:G) (drift-proof).
function totalsBlock(sid, rate) {
  return [
    I._setCells(sid,4,8,[[I._cell('Total hours',I._fmt({bg:I.TEAL,fg:I.MINT,align:'LEFT'})),I._cell('=MAX(G5:G)',I._fmt({bg:I.TEAL,fg:I.MINT,align:'CENTER'}))]]),
    I._setCells(sid,5,8,[[I._cell('Total payment',I._fmt({fg:I.TEAL,align:'LEFT'})),I._cell(`=${rate}*J5`,I._fmt({fg:I.TEAL,align:'CENTER',numFmt:I.GBP}))]]),
    {repeatCell:{range:{sheetId:sid,startRowIndex:6,startColumnIndex:8,endColumnIndex:10},cell:{},fields:'userEnteredValue,userEnteredFormat'}}
  ];
}

// All transport is injected; production transport talks only to Google.
export class TutorStore {
  constructor(request) { this.request=request; this.sheetId=null; }
  async findSheet() {
    const q = `trashed = false and 'me' in owners and mimeType = 'application/vnd.google-apps.spreadsheet' and appProperties has { key='tutorLog' and value='${TAG}' }`;
    const out = await this.request('GET',`${DRIVE}?q=${encodeURIComponent(q)}&fields=files(id,name),nextPageToken&pageSize=100`);
    if (out.nextPageToken || out.files.length>1) throw new Error('More than one Tutor Log invoice was found. Move the unwanted duplicate to the Drive bin, then sign in again.');
    return out.files[0]?.id || null;
  }
  async meta(id=this.sheetId) {
    return this.request('GET',`${SHEETS}/${id}?fields=spreadsheetId,sheets.properties,developerMetadata`);
  }
  config(meta) {
    const entry=(meta.developerMetadata||[]).find(m=>m.metadataKey===KEY);
    if (!entry) return null;
    const cfg=JSON.parse(entry.metadataValue);
    if (cfg.schema!==1) throw new Error('Unsupported invoice configuration version.');
    return {...cfg,sheetId:meta.spreadsheetId};
  }
  batch(id,requests) { return this.request('POST',`${SHEETS}/${id}:batchUpdate`,{requests}); }
  async getState(email) {
    this.sheetId=await this.findSheet();
    if (!this.sheetId) return {onboarded:false,email};
    const meta=await this.meta();
    const cfg=this.config(meta);
    if (!cfg) return {onboarded:false,email};
    return {onboarded:true,email,config:cfg,sheetUrl:urlFor(this.sheetId),months:monthsOf(meta.sheets)};
  }
  // Keep tiny, permanent revision guards. An identical revision ID cannot be created
  // twice, so competing writes fail atomically instead of overwriting session rows.
  revisionRequests(cfg, initial=false) {
    if (cfg.revision>10000) throw new Error('This invoice has reached its 10,000-edit limit. Contact the app owner before continuing.');
    const metadata={metadataId:CONFIG_ID,metadataKey:KEY,metadataValue:JSON.stringify(cfg),visibility:'PROJECT',location:{spreadsheet:true}};
    return [
      {createDeveloperMetadata:{developerMetadata:{metadataId:GUARD_BASE+cfg.revision,metadataKey:'v',visibility:'PROJECT',location:{spreadsheet:true}}}},
      initial ? {createDeveloperMetadata:{developerMetadata:metadata}} : {updateDeveloperMetadata:{dataFilters:[{developerMetadataLookup:{metadataId:CONFIG_ID}}],developerMetadata:{metadataValue:metadata.metadataValue},fields:'metadataValue'}}
    ];
  }
  async commit(cfg,requests,initial=false) {
    try { await this.batch(cfg.sheetId,[...this.revisionRequests(cfg,initial),...requests]); }
    catch (e) {
      if (e.status===400) throw new Error('Google rejected this update. Another device may have saved first. Reload your invoice and try again. No part of this batch was applied.');
      throw e;
    }
  }
  async createTutorSheet(payload) {
    const base=validateConfig(payload);
    this.sheetId=await this.findSheet();
    if (!this.sheetId) {
      // Tag at creation, so an interrupted setup can rediscover the same empty file.
      const f=await this.request('POST',`${DRIVE}?fields=id`,{name:`Intuitive Academy - ${base.name} - Invoice`,mimeType:'application/vnd.google-apps.spreadsheet',appProperties:{tutorLog:TAG}});
      this.sheetId=f.id;
    }
    const meta=await this.meta();
    const existing=this.config(meta);
    if (existing) return {config:existing,sheetUrl:urlFor(this.sheetId),months:monthsOf(meta.sheets)};
    if (meta.sheets.some(s=>s.properties.title!== 'Sheet1')) throw new Error('This invoice is missing its saved configuration. Restore an earlier spreadsheet version before continuing; existing tabs have been left intact.');
    const original=await this.request('GET',`${SHEETS}/${this.sheetId}/values/${encodeURIComponent("'Sheet1'")}`);
    if(original.values?.length)throw new Error('This incomplete invoice contains data. Move it to the Drive bin or restore its configuration before creating another invoice.');
    const start=I._firstOfMonth(base.startMonth);
    const titles=[I.SUMMARY,I._monthTabName(start)];
    const used=new Set(meta.sheets.map(s=>s.properties.sheetId));
    let sid=100;
    const sheets=titles.map((t,i)=>{while(used.has(sid))sid++;const p=I._sheetSpec(t,[I.TEAL,I._tabColour(start)][i],i?I.HEADER_ROW:6);p.properties.sheetId=sid++;return p;});
    const cfg={...base,sheetId:this.sheetId,schema:1,revision:0,receipts:[]};
    const req=[{updateSpreadsheetProperties:{properties:{timeZone:'Europe/London',locale:'en_GB'},fields:'timeZone,locale'}},...sheets.map(s=>({addSheet:s})),...meta.sheets.map(s=>({deleteSheet:{sheetId:s.properties.sheetId}})),
      ...I._summaryContent(sheets[0].properties.sheetId),...I._monthContent(sheets[1].properties.sheetId,cfg.name,cfg.rate,start),...summaryRequests(sheets)];
    // Names are text, even if they start with '='.
    for (const s of sheets.slice(1)) req.push(I._setCells(s.properties.sheetId,1,6,[[textCell(cfg.name,I._fmt({bg:I.TEAL,fg:I.MINT,align:'CENTER'}))]]));
    await this.commit(cfg,req,true);
    return {config:cfg,sheetUrl:urlFor(this.sheetId),months:monthsOf(sheets)};
  }
  async current() {
    if (!this.sheetId) this.sheetId=await this.findSheet();
    if (!this.sheetId) throw new Error('Create your invoice first.');
    const meta=await this.meta(); const cfg=this.config(meta);
    if (!cfg) throw new Error('Complete invoice setup first.');
    return {meta,cfg};
  }
  async updateConfig(patch) {
    const {meta,cfg}=await this.current();
    if (patch.revision!==cfg.revision) throw new Error('Your invoice changed on another device. Reload before saving settings.');
    const next={...cfg,...validateConfig({...cfg,...patch}),revision:cfg.revision+1};
    const req=[...legacyPurge(meta)];
    for (const s of meta.sheets) if (I._isMonthTab(s.properties.title)) {
      // Rebuild name + the whole totals block, healing drifted formulas/labels on every tab on any settings save.
      req.push(I._setCells(s.properties.sheetId,1,6,[[textCell(next.name,I._fmt({bg:I.TEAL,fg:I.MINT,align:'CENTER'}))]]),...totalsBlock(s.properties.sheetId,next.rate));
    }
    // On every save: drop exact-duplicate rows (same date + students + start + end, keeping the first), then rebuild the
    // cumulative-hours column (deleting rows breaks its chain) and re-colour the kept rows to their group's current colour.
    for (const s of meta.sheets) {
      if (!I._isMonthTab(s.properties.title)) continue;
      const sid=s.properties.sheetId;
      const out=await this.request('GET',`${SHEETS}/${cfg.sheetId}/values/${encodeURIComponent(`'${s.properties.title}'!B6:F`)}?valueRenderOption=FORMATTED_VALUE`);
      const seen=new Set(),kept=[],del=[];
      (out.values||[]).forEach((v,i)=>{
        const date=String(v&&v[0]||'').trim(),stu=String(v&&v[1]||'').trim();
        if(!date&&!stu)return;                                   // trailing blank
        const sig=date+'|'+stu+'|'+String(v&&v[3]||'').trim()+'|'+String(v&&v[4]||'').trim();
        if(seen.has(sig))del.push(i); else {seen.add(sig);kept.push(v);}
      });
      // Delete duplicates bottom-up so the remaining indices stay valid within this batch.
      for(const i of del.slice().sort((a,b)=>b-a))req.push({deleteDimension:{range:{sheetId:sid,dimension:'ROWS',startIndex:5+i,endIndex:6+i}}});
      // Rebuild G cumulative + re-colour, addressing the kept rows at their compacted positions.
      const grid=[];
      kept.forEach((v,j)=>{
        const R=6+j;
        grid.push([I._cell(j===0?`=ROUND((TIMEVALUE(F${R})-TIMEVALUE(E${R}))*24,2)`:`=ROUND(G${R-1}+(TIMEVALUE(F${R})-TIMEVALUE(E${R}))*24,2)`,I._fmt({align:'CENTER'}))]);
        const students=String(v&&v[1]||'').split(',').map(x=>x.trim()).filter(Boolean);
        const g=students.length?next.groups.find(gr=>students.length<=gr.students.length&&students.every(st=>gr.students.includes(st))):null;
        if(g)req.push(bgOnly(sid,5+j,2,g.colour));
      });
      if(grid.length)req.push(I._setCells(sid,5,6,grid));
    }
    req.push(...summaryRequests(meta.sheets));
    await this.commit(next,req);
    return {config:next};
  }
  async totals(cfg) {
    const meta=await this.meta();
    const tabs=meta.sheets.filter(s=>I._isMonthTab(s.properties.title));
    const q=tabs.map(s=>'ranges='+encodeURIComponent(`'${s.properties.title}'!J5:J6`)).join('&');
    const out=await this.request('GET',`${SHEETS}/${cfg.sheetId}/values:batchGet?${q}&valueRenderOption=UNFORMATTED_VALUE`);
    let hours=0,payment=0;
    for(const r of out.valueRanges||[]) {hours+=Number(r.values?.[0]?.[0])||0;payment+=Number(r.values?.[1]?.[0])||0;}
    return {totalHours:hours,totalPayment:payment};
  }
  async currentTotals() {
    const {cfg}=await this.current();
    return {...await this.totals(cfg),sheetUrl:urlFor(cfg.sheetId)};
  }
  async saveLog(payload,operationId) {
    const {meta,cfg}=await this.current();
    const receipt=cfg.receipts.find(r=>r.id===operationId);
    if (receipt) return {written:receipt.written,sheetUrl:urlFor(cfg.sheetId),...await this.totals(cfg),config:cfg,months:monthsOf(meta.sheets)};
    const rows=[];
    for(const slot of payload.slots||[]) {
      if (!slot.students?.length) continue;
      const g=cfg.groups.find(g=>g.id===slot.groupId);
      if (!g || slot.students.some(s=>!g.students.includes(s))) throw new Error('Your groups changed. Reload before logging.');
      rows.push({date:dateFrom(slot.date||payload.date),students:slot.students.join(', '),colour:g.colour,options:[slot.students.join(', '),...g.students,g.students.join(', ')]});
    }
    for(const a of payload.adhoc||[]) {
      const student=String(a.student||'').trim(); if(!student)continue;
      if(student.length>200)throw new Error('Student names must be under 200 characters.');
      validateTimes(a.start,a.end);
      rows.push({date:dateFrom(a.date||payload.date),students:student,colour:'#ececec',options:[student],adhoc:{year:String(a.year||''),start:a.start,end:a.end}});
    }
    if(!rows.length)throw new Error('Select at least one student.');
    if(rows.length>100)throw new Error('Log up to 100 sessions at once.');
    const req=[...legacyPurge(meta)],sheets=meta.sheets.slice();
    const dups=[],tabState=new Map();
    const fmtDate=d=>String(d.getDate()).padStart(2,'0')+'/'+String(d.getMonth()+1).padStart(2,'0')+'/'+d.getFullYear();
    const sigOf=(day,students)=>day+'|'+String(students).split(',').map(x=>x.trim()).filter(Boolean).sort().join(', ');
    const keyOf=d=>d.getFullYear()*10000+(d.getMonth()+1)*100+d.getDate();
    const keyStr=s=>{const p=String(s).split('/').map(Number);return (p[2]||0)*10000+(p[1]||0)*100+(p[0]||0);};
    const ifs=I._buildIfs(cfg);
    let nextId=Math.max(...sheets.map(s=>s.properties.sheetId))+1;
    // Per-tab state: existing row date-keys (sheet order) + logged signatures. Reads the tab once.
    const ensureTab=async(row)=>{
      const tab=I._monthTabName(row.date);
      if(tabState.has(tab))return tabState.get(tab);
      let sheet=sheets.find(s=>s.properties.title===tab),st;
      if(!sheet){
        sheet=I._sheetSpec(tab,I._tabColour(row.date),I.HEADER_ROW);sheet.properties.sheetId=nextId++;sheet.properties.gridProperties.rowCount=1000;
        sheets.push(sheet);req.push({addSheet:sheet},...I._monthContent(sheet.properties.sheetId,cfg.name,cfg.rate,row.date));
        req.push(I._setCells(sheet.properties.sheetId,1,6,[[textCell(cfg.name,I._fmt({bg:I.TEAL,fg:I.MINT,align:'CENTER'}))]]));
        st={sheet,keys:[],sigs:new Set()};
      } else {
        const out=await this.request('GET',`${SHEETS}/${cfg.sheetId}/values/${encodeURIComponent(`'${tab}'!B6:C`)}?valueRenderOption=FORMATTED_VALUE`);
        const vals=out.values||[],keys=[],sigs=new Set();
        for(const v of vals){keys.push(v&&v[0]?keyStr(v[0]):0);if(v&&v[0]&&v[1]!=null)sigs.add(sigOf(v[0],v[1]));}
        st={sheet,keys,sigs};
      }
      tabState.set(tab,st);return st;
    };
    // Insert each row at its date-sorted position (oldest first) so the sheet stays chronological even when backfilling.
    for(const row of rows.slice().sort((a,b)=>keyOf(a.date)-keyOf(b.date))) {
      const st=await ensureTab(row);
      const sig=sigOf(fmtDate(row.date),row.students);
      if(st.sigs.has(sig)&&!payload.force)dups.push(row.students+' on '+fmtDate(row.date));
      st.sigs.add(sig);
      const k=keyOf(row.date); let pos=st.keys.findIndex(x=>x>k); if(pos<0)pos=st.keys.length;
      const rowNum=6+pos;
      req.push({insertDimension:{range:{sheetId:st.sheet.properties.sheetId,dimension:'ROWS',startIndex:rowNum-1,endIndex:rowNum},inheritFromBefore:pos>0}});
      const rowReq=I._rowReqs(st.sheet.properties.sheetId,rowNum,row,ifs,row.adhoc||null);
      const cells=rowReq[0].updateCells.rows[0].values;
      cells[1].userEnteredValue={stringValue:row.students};
      if(row.adhoc)cells[2].userEnteredValue={stringValue:row.adhoc.year};
      req.push(...rowReq);
      st.keys.splice(pos,0,k);
    }
    if(dups.length&&!payload.force){
      const err=new Error('Already logged '+dups.join('; ')+'.');
      err.duplicate=true;
      err.dupMsg='Already logged:\n\n'+dups.join('\n')+'\n\nLog it again anyway?';
      throw err;
    }
    // Rebuild the cumulative-hours column (G) top-to-bottom in each touched tab so totals stay correct after inserts.
    for(const [,st] of tabState) {
      const n=st.keys.length; if(!n)continue;
      const grid=[];
      for(let i=0;i<n;i++){const R=6+i;grid.push([I._cell(i===0?`=ROUND((TIMEVALUE(F${R})-TIMEVALUE(E${R}))*24,2)`:`=ROUND(G${R-1}+(TIMEVALUE(F${R})-TIMEVALUE(E${R}))*24,2)`,I._fmt({align:'CENTER'}))]);}
      req.push(I._setCells(st.sheet.properties.sheetId,5,6,grid));
      // Rebuild the totals block each save (drift-proof J5, restore the Total-payment label, clear drifted ghosts).
      req.push(...totalsBlock(st.sheet.properties.sheetId,cfg.rate));
    }
    const next={...cfg,revision:cfg.revision+1,receipts:[...cfg.receipts,{id:operationId,written:rows.length}].slice(-20)};
    req.push(...summaryRequests(sheets));
    await this.commit(next,req);
    return {written:rows.length,sheetUrl:urlFor(cfg.sheetId),...await this.totals(next),config:next,months:monthsOf(sheets)};
  }
}
