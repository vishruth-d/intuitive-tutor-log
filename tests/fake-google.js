// In-memory contract double, not a Google Sheets calculation engine.
export class FakeGoogle {
  constructor(){this.files=[];this.books=new Map();this.writes=[];this.failAfterCommit=false;}
  request=async(method,url,body)=>{
    const u=new URL(url),p=u.pathname;
    if(u.hostname==='www.googleapis.com'){
      if(method==='GET')return {files:structuredClone(this.files.filter(f=>!f.trashed))};
      const id='sheet-'+(this.files.length+1);this.files.push({id,name:body.name});
      this.books.set(id,{spreadsheetId:id,sheets:[{properties:{sheetId:0,title:'Sheet1',gridProperties:{rowCount:1000}}}],developerMetadata:[],cells:{}});return {id};
    }
    const id=p.split('/')[3].split(':')[0],book=this.books.get(id);
    if(!book)throw Object.assign(new Error('Not found'),{status:404});
    if(method==='GET'&&!p.includes('/values'))return structuredClone(book);
    if(p.includes('/values:batchGet'))return {valueRanges:u.searchParams.getAll('ranges').map(()=>({values:[[3],[60]]}))};
    if(p.includes('/values/')){
      const range=decodeURIComponent(p.split('/values/')[1]),title=range.split("'")[1];
      const sheet=book.sheets.find(s=>s.properties.title===title);
      const rows=book.cells[sheet.properties.sheetId]||{};
      const render=cell=>{const f=cell?.userEnteredValue?.formulaValue,m=f&&f.match(/^=DATE\((\d+),(\d+),(\d+)\)$/);return m?String(m[3]).padStart(2,'0')+'/'+String(m[2]).padStart(2,'0')+'/'+m[1]:(cell?.userEnteredValue?.stringValue??'');};
      const last=Math.max(4,...Object.keys(rows).map(Number).filter(r=>r>=5 && rows[r]?.[1]?.userEnteredValue));
      if(range.includes('!C6:'))return {values:Array.from({length:last-4},(_,i)=>{const row=rows[i+5];return row?.[2]?.userEnteredValue?[render(row[2])]:[];})};
      if(range.includes('!B6:'))return {values:Array.from({length:last-4},(_,i)=>{const row=rows[i+5];return row?.[1]?.userEnteredValue?[render(row[1]),render(row[2]),render(row[3]),render(row[4]),render(row[5])]:[];})};
      return {values:[]};
    }
    const next=structuredClone(book);
    // Google batchUpdate validates requests and applies the entire batch atomically.
    for(const r of body.requests){
      if(r.createDeveloperMetadata){const m=r.createDeveloperMetadata.developerMetadata;if(next.developerMetadata.some(x=>x.metadataId===m.metadataId))throw Object.assign(new Error('Duplicate metadata ID'),{status:400});next.developerMetadata.push(structuredClone(m));}
      if(r.updateDeveloperMetadata){const v=r.updateDeveloperMetadata;const m=next.developerMetadata.find(x=>x.metadataId===v.dataFilters[0].developerMetadataLookup.metadataId);if(!m)throw new Error('Missing metadata');m.metadataValue=v.developerMetadata.metadataValue;}
      if(r.addSheet){if(next.sheets.some(s=>s.properties.title===r.addSheet.properties.title))throw Object.assign(new Error('Duplicate tab'),{status:400});next.sheets.push(structuredClone(r.addSheet));}
      if(r.deleteSheet)next.sheets=next.sheets.filter(s=>s.properties.sheetId!==r.deleteSheet.sheetId);
      if(r.appendDimension){const s=next.sheets.find(s=>s.properties.sheetId===r.appendDimension.sheetId);s.properties.gridProperties.rowCount+=r.appendDimension.length;}
      if(r.insertDimension&&r.insertDimension.range.dimension==='ROWS'){const rg=r.insertDimension.range,S=rg.startIndex,L=rg.endIndex-rg.startIndex,grid=next.cells[rg.sheetId]||{},ng={};for(const key of Object.keys(grid).map(Number))ng[key>=S?key+L:key]=grid[key];next.cells[rg.sheetId]=ng;const sh=next.sheets.find(x=>x.properties.sheetId===rg.sheetId);if(sh)sh.properties.gridProperties.rowCount=(sh.properties.gridProperties.rowCount||1000)+L;}
      if(r.deleteDimension&&r.deleteDimension.range.dimension==='ROWS'){const rg=r.deleteDimension.range,S=rg.startIndex,E=rg.endIndex,L=E-S,grid=next.cells[rg.sheetId]||{},ng={};for(const key of Object.keys(grid).map(Number)){if(key>=S&&key<E)continue;ng[key>=E?key-L:key]=grid[key];}next.cells[rg.sheetId]=ng;const sh=next.sheets.find(x=>x.properties.sheetId===rg.sheetId);if(sh)sh.properties.gridProperties.rowCount=(sh.properties.gridProperties.rowCount||1000)-L;}
      if(r.updateCells){const {start,rows}=r.updateCells;const grid=next.cells[start.sheetId]||={};rows.forEach((row,i)=>{const target=grid[start.rowIndex+i]||={};row.values.forEach((cell,j)=>{const c=start.columnIndex+j; if(cell.userEnteredValue===undefined&&target[c])target[c]={...target[c],...structuredClone(cell)}; else target[c]=structuredClone(cell);});});}
      if(r.repeatCell){const rg=r.repeatCell.range,grid=next.cells[rg.sheetId]||{},r0=rg.startRowIndex||0,r1=rg.endRowIndex??1000,c0=rg.startColumnIndex||0,c1=rg.endColumnIndex??26;for(const k of Object.keys(grid).map(Number))if(k>=r0&&k<r1)for(let c=c0;c<c1;c++)delete grid[k][c];next.cells[rg.sheetId]=grid;}
    }
    this.books.set(id,next);this.writes.push(structuredClone(body.requests));
    if(this.failAfterCommit){this.failAfterCommit=false;throw new Error('Connection lost');}
    return {};
  }
}
