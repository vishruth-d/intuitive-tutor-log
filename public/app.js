import {applyTheme,themeField,groupColourField,GROUP_COLOURS} from './appearance.js';

import { api, auth, setupError } from './google-api.js';
import { FEEDBACK_URL } from './config.js';
import { invoiceWindow, gmailAppUrl, mailtoUrl, gmailComposeUrl } from './invoice-email.js';
var PALETTE=['#c9e7ff','#ffd9d6','#c9efd4','#ffe9b0','#e6d4fb','#bdf0ea','#ffd6ec','#dcedc1','#ffcfb0','#cfe0ff'];

function chipIcon(remove){return '<span class="tick" aria-hidden="true"><svg viewBox="0 0 16 16" focusable="false"><path d="'+(remove?'M5 5L11 11M11 5L5 11':'M3.5 8L6.5 11L12.5 5')+'"/></svg></span>';}

// ---------- state / utils ----------
var STATE={config:null,email:'',sheetUrl:'',months:[]};
var app=document.getElementById('app'), barMount=document.getElementById('bar-mount');
function esc(s){return String(s==null?'':s).replace(/[&<>"]/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c];});}
function gbp(n){return '\u00a3'+(Number(n)||0).toFixed(2);}
function todayISO(){var d=new Date();return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');}
function thisMonth(){return todayISO().slice(0,7);}
function toast(m,e){var t=document.getElementById('toast');t.textContent=m;t.className='toast show'+(e?' err':'');setTimeout(function(){t.className='toast';},2600);}
function byId(gid){return STATE.config.groups.filter(function(x){return x.id===gid;})[0];}
function mountBar(inner){barMount.innerHTML=inner?'<div class="bar"><div class="inner">'+inner+'</div></div>':'';}

// ---------- Google sign-in; dashboard below is the original UI ----------
function renderSignIn(message){
  applyTheme('classic');
  mountBar('');
  app.innerHTML='<div class="card"><h2>Your tutor log</h2><p>Sign in to create or open your invoice in your own Google Drive.</p>'+
    '<p class="hint">'+esc(message||'')+'</p><button class="btn btn-primary btn-block" id="sign-in" '+(setupError?'disabled':'')+'>Continue with Google</button>'+
    '<p class="hint" style="margin-top:16px"><a href="/privacy.html">Privacy</a> · <a href="/terms.html">Terms</a></p></div>';
  document.getElementById('sign-in').onclick=function(){
    var b=this; b.disabled=true;
    auth.signIn().then(loadState).catch(function(e){renderSignIn(e.message);});
  };
}
async function loadState(){
  var st=await api('getState');
  STATE={config:st.config||null,email:st.email||'',sheetUrl:st.sheetUrl||'',months:st.months||[]};
  document.getElementById('who').innerHTML='signed in<b>'+esc(STATE.email)+'</b><button class="tiny-link" id="sign-out">Sign out</button>';
  document.getElementById('sign-out').onclick=function(){auth.signOut();STATE={config:null,email:'',sheetUrl:'',months:[]};document.getElementById('who').textContent='';renderSignIn();};
  if(st.onboarded)renderLogger();else renderOnboarding();
}
renderSignIn(setupError);

// ================= ONBOARDING =================
function renderOnboarding(){
  barMount.innerHTML='';
  app.innerHTML='<div class="fade">'+
    '<div class="card"><h2>Welcome \u2014 let\u2019s set you up</h2>'+
      '<div class="field"><label>Your name</label><input id="o-name" placeholder="e.g. Priya Shah" autocomplete="name"></div>'+
      '<div class="field"><label>Rate per hour (\u00a3)</label><input id="o-rate" type="number" inputmode="decimal" value="20" min="0" step="0.5"></div>'+
      '<div class="safe">'+lockSvg()+'<div>This runs in <b>your own Google account</b> and only creates &amp; updates <b>your invoice sheet</b>. Your data stays in your Drive.</div></div>'+
    '</div>'+
    '<div class="divider">Your students &amp; groups</div>'+
    '<div id="grp-editor"></div></div>';
  mountGroupsEditor(document.getElementById('grp-editor'), []);
  mountBar('<button class="btn btn-primary btn-block" id="o-create">Create my invoice sheet</button>');
  document.getElementById('o-create').addEventListener('click', doCreate);
}
function lockSvg(){return '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#0d5945" stroke-width="2"><rect x="4" y="10" width="16" height="10" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/></svg>';}

function doCreate(){
  var name=document.getElementById('o-name').value.trim();
  var rate=parseFloat(document.getElementById('o-rate').value)||0;
  var month=thisMonth();
  var groups=readGroups();
  if(!name){toast('Enter your name',true);return;}
  if(!groups.length){toast('Add at least one student or group',true);return;}
  var b=document.getElementById('o-create'); b.disabled=true; b.innerHTML='<span class="spin"></span>Creating your sheet\u2026';
  api('createTutorSheet',{name:name,rate:rate,startMonth:month,groups:groups}).then(function(r){
    STATE.config=r.config; STATE.sheetUrl=r.sheetUrl; STATE.months=r.months||[]; toast('Sheet created \u2713'); renderLogger();
  }).catch(function(e){b.disabled=false;b.textContent='Create my invoice sheet';toast('Failed: '+(e&&e.message||e),true);});
}

// ---------- shared groups editor (surgical, no full re-render) ----------
var EDIT=[], _uid=0;
function mountGroupsEditor(mount, groups){
  EDIT=(groups||[]).map(function(g){return {id:g.id,colour:g.colour,uid:++_uid,label:g.label||'',year:g.year||'',start:g.start||'',end:g.end||'',students:(g.students||[]).slice()};});
  mount.innerHTML='<div id="grp-list"></div><button class="btn btn-ghost btn-block" id="add-grp">+ Add a group / student</button>';
  var list=mount.querySelector('#grp-list');
  EDIT.forEach(function(g){ list.appendChild(groupCard(g)); });
  mount.querySelector('#add-grp').addEventListener('click',function(){
    var g={uid:++_uid,label:'',year:'',start:'',end:'',students:[],colour:GROUP_COLOURS[EDIT.length%GROUP_COLOURS.length]}; EDIT.push(g);
    var card=groupCard(g); card.classList.add('fade'); list.appendChild(card);
    var l=card.querySelector('[data-f="label"]'); if(l) l.focus();
  });
}
function readGroups(){return EDIT.map(function(g){return {id:g.id||(g.id='g-'+crypto.randomUUID()),colour:g.colour,label:g.label,year:g.year,start:g.start,end:g.end,students:g.students.slice()};});}
function groupCard(g){
  var card=document.createElement('div'); card.className='card group-editor-card'; card.dataset.uid=g.uid;
  card.innerHTML=
    '<div class="field"><label>Group / student label</label><input data-f="label" value="'+esc(g.label)+'" placeholder="e.g. Y10 Maths trio, or Aarav (1:1)"></div>'+
    '<div class="field"><label>Year</label><input data-f="year" value="'+esc(g.year)+'" placeholder="Y10"></div>'+
    '<div class="row times">'+
      '<div class="field"><label>Start</label><input data-f="start" type="time" value="'+esc(g.start)+'"></div>'+
      '<div class="field"><label>End</label><input data-f="end" type="time" value="'+esc(g.end)+'"></div>'+
    '</div>'+
    '<label>Students in this group</label>'+
    '<div class="chips" data-chips></div>'+
    '<div class="add-line"><input data-add placeholder="Add student name"><button class="btn btn-ghost" type="button" data-addbtn style="flex:0 0 auto;padding:11px 15px">Add</button></div>'+
    '<div class="field colour-field"><span class="fld-label">Group colour</span><div class="swatch-row" data-swatches></div></div>'+
    '<button class="btn btn-ghost remove-group" type="button">Remove group</button>';
  var endEdited=false,endInp=card.querySelector('[data-f="end"]');
  ['label','year','start','end'].forEach(function(f){
    var inp=card.querySelector('[data-f="'+f+'"]'); inp.addEventListener('input',function(){ g[f]=inp.value;
      if(f==='end')endEdited=true;
      if(f==='start'&&!endEdited&&/^\d{2}:\d{2}$/.test(inp.value)){g.end=String((+inp.value.slice(0,2)+1)%24).padStart(2,'0')+inp.value.slice(2);if(endInp)endInp.value=g.end;}
    });
  });
  if(!g.colour)g.colour=GROUP_COLOURS[0];
  var swatchWrap=card.querySelector('[data-swatches]');
  function paintSwatches(){
    card.style.setProperty('--gc',g.colour);
    swatchWrap.innerHTML=groupColourField(g.colour);
    swatchWrap.querySelectorAll('.swatch').forEach(function(b){ b.addEventListener('click',function(){ g.colour=b.dataset.colour; paintSwatches(); }); });
  }
  paintSwatches();
  var chips=card.querySelector('[data-chips]');
  function renderChips(){
    chips.innerHTML = g.students.length ? '' : '<span class="empty" style="padding:2px 0">No students yet</span>';
    g.students.forEach(function(s,i){
      var el=document.createElement('span'); el.className='chip rm'; el.style.setProperty('--gc','#eef1f7');
      el.innerHTML=esc(s)+chipIcon(true);
      el.addEventListener('click',function(){ el.classList.add('removing'); setTimeout(function(){ g.students.splice(i,1); renderChips(); },160); });
      chips.appendChild(el);
    });
  }
  renderChips();
  var addInp=card.querySelector('[data-add]');
  function add(){ var v=addInp.value.trim(); if(!v) return; g.students.push(v); addInp.value='';
    if(g.students.length===1) chips.innerHTML=''; // drop "No students yet"
    // append just the new chip without touching others
    var i=g.students.length-1;
    var el=document.createElement('span'); el.className='chip rm in'; el.style.setProperty('--gc','#eef1f7');
    el.innerHTML=esc(g.students[i])+chipIcon(true);
    el.addEventListener('click',function(){ el.classList.add('removing'); setTimeout(function(){ var idx=g.students.indexOf(v); if(idx>-1)g.students.splice(idx,1); renderChips(); },160); });
    chips.appendChild(el); addInp.focus();
  }
  addInp.addEventListener('keydown',function(e){ if(e.key==='Enter'||e.keyCode===13){e.preventDefault(); add();} });
  card.querySelector('[data-addbtn]').addEventListener('click', add);
  card.querySelector('.remove-group').addEventListener('click',function(){
    if(EDIT.length<=1){toast('Keep at least one group',true);return;}
    var idx=EDIT.map(function(x){return x.uid;}).indexOf(g.uid); if(idx>-1)EDIT.splice(idx,1);
    card.classList.add('removing'); setTimeout(function(){card.remove();},200);
  });
  return card;
}

// ================= LOGGER =================
var SEL={}, GDATE={}, ADHOC=[];
function renderLogger(){
  applyTheme(STATE.config.theme);
  SEL={}; GDATE={}; ADHOC=[];
  var cfg=STATE.config;
  app.innerHTML='<div class="fade">'+
    invoiceNudge()+
    '<div class="card" style="display:flex;align-items:center;justify-content:space-between;gap:10px">'+
      '<div><div class="grp-meta" style="font-size:13px">Logging for</div><div style="font-family:var(--disp);font-size:20px;font-weight:600;color:var(--teal)">'+esc(cfg.name)+'</div></div>'+
      '<div style="text-align:right"><div class="grp-meta" style="font-size:13px">Invoice so far</div><div id="tot-val" style="font-family:var(--disp);font-size:20px;font-weight:600;color:var(--accent-deep)">…</div></div>'+
    '</div>'+
    (STATE.sheetUrl&&STATE.sheetUrl!=='#sheet'?'<a class="btn btn-ghost btn-block" href="'+esc(STATE.sheetUrl)+'" target="_blank" rel="noopener" style="text-decoration:none;margin-top:-8px;margin-bottom:4px">Open my invoice sheet ↗</a>':'')+
    '<div class="divider">Tap who attended</div>'+
    '<div class="alldate"><label>Date for all</label><input type="date" id="all-date" value="'+todayISO()+'"></div>'+
    '<div id="groups"></div>'+
    '<div class="divider">One-off sessions</div>'+
    '<div id="adhoc"></div>'+
    '<button class="btn btn-ghost btn-block" id="add-adhoc">+ Add a one-off session</button>'+
    '<div style="text-align:center;margin-top:18px"><button class="tiny-link" id="go-settings">Groups &amp; settings</button>'+
      (FEEDBACK_URL?' &middot; <a class="tiny-link" href="'+esc(FEEDBACK_URL)+'" target="_blank" rel="noopener">Feedback</a>':'')+
    '</div></div>';
  drawGroups();
  var invBtn=document.getElementById('inv-send'); if(invBtn) invBtn.addEventListener('click', sendInvoiceEmail);
  api('totals').then(function(t){var el=document.getElementById('tot-val');if(el)el.textContent=(Number(t.totalHours)||0).toFixed(2)+' hrs · '+gbp(t.totalPayment);}).catch(function(){var el=document.getElementById('tot-val');if(el)el.textContent='—';});
  document.getElementById('all-date').addEventListener('input',function(e){
    var d=e.target.value; if(!d)return;
    document.querySelectorAll('#groups [data-gd]').forEach(function(inp){inp.value=d;});
    Object.keys(GDATE).forEach(function(gid){GDATE[gid]=d;});
    ADHOC.forEach(function(a){a.date=d;});
    document.querySelectorAll('#adhoc [data-a="date"]').forEach(function(inp){inp.value=d;});
  });
  document.getElementById('add-adhoc').addEventListener('click',function(){ ADHOC.push({date:todayISO(),student:'',year:'',start:'16:00',end:'17:00'}); addAdhocRow(ADHOC[ADHOC.length-1]); });
  document.getElementById('go-settings').addEventListener('click', renderSettings);
  mountBar('<button class="btn btn-accent btn-block" id="log-btn">Log to my sheet</button>');
  document.getElementById('log-btn').addEventListener('click', doLog);
}

// ---------- end-of-month invoice email nudge ----------
function mailSvg(){return '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 7l9 6 9-6"/></svg>';}
function isMobile(){try{return /Mobi|Android|iPhone|iPad|iPod/i.test(navigator.userAgent||'');}catch(e){return false;}}
// Stays visible and clickable for the whole window (1st -> first Friday); clicking just re-opens the draft, it never hides.
function invoiceNudge(){
  var win=invoiceWindow(new Date());
  if(!win.active)return '';
  return '<div class="invoice-nudge fade" id="inv-nudge">'+
    '<span class="inv-ic" aria-hidden="true">'+mailSvg()+'</span>'+
    '<div class="inv-body"><div class="inv-title">Send Veena the '+esc(win.monthName)+' invoice</div>'+
      '<div class="inv-sub">Opens a ready-to-send email · available until the first Friday</div></div>'+
    '<button class="btn btn-accent inv-btn" id="inv-send">Prepare email</button>'+
  '</div>';
}
function sendInvoiceEmail(){
  var now=new Date(), win=invoiceWindow(now);
  var m=(STATE.months||[]).filter(function(x){return x.title===win.monthTab;})[0];
  var opts={tutorName:STATE.config.name,monthName:win.monthName,year:win.year,sheetUrl:STATE.sheetUrl,monthGid:m?m.gid:null};
  if(isMobile()){
    // Try the Gmail app first. If it isn't installed the page stays visible, so fall back to the default mail app.
    var start=Date.now();
    window.location.href=gmailAppUrl(opts);
    setTimeout(function(){ if(!document.hidden && Date.now()-start<2500){ window.location.href=mailtoUrl(opts); } },900);
  } else {
    window.open(gmailComposeUrl(opts),'_blank','noopener');
  }
  toast('Opening your invoice email …');
}

function drawGroups(){
  var box=document.getElementById('groups'), cfg=STATE.config;
  if(!cfg.groups.length){box.innerHTML='<div class="empty">No groups yet. Add some in settings.</div>';return;}
  cfg.groups.forEach(function(g){ SEL[g.id]=new Set(); GDATE[g.id]=todayISO(); });
  box.innerHTML=cfg.groups.map(function(g){
    var meta=[esc(g.year),(g.start&&g.end?esc(g.start)+'\u2013'+esc(g.end):'')].filter(Boolean).join(' \u00b7 ');
    return '<div class="grp" style="--gc:'+esc(g.colour)+'" data-g="'+esc(g.id)+'">'+
      '<div class="grp-head">'+
        '<div style="flex:1"><div class="grp-title">'+esc(g.label)+'</div><div class="grp-meta">'+meta+'</div></div>'+
        '<span class="grp-count" data-count="'+esc(g.id)+'">0/'+g.students.length+'</span>'+
        '<button class="grp-all" data-all="'+esc(g.id)+'">All</button>'+
      '</div>'+
      '<div class="grp-daterow"><label>Date</label><input type="date" data-gd="'+esc(g.id)+'" value="'+todayISO()+'"></div>'+
      '<div class="chips">'+g.students.map(function(s){
        return '<span class="chip" data-s="'+esc(s)+'">'+esc(s)+chipIcon(false)+'</span>';
      }).join('')+'</div></div>';
  }).join('');
  box.querySelectorAll('.grp').forEach(function(card){
    var gid=card.dataset.g, set=SEL[gid], g=byId(gid);
    card.querySelectorAll('.chip').forEach(function(ch){
      ch.addEventListener('click',function(){
        var s=ch.dataset.s;
        if(set.has(s)){set.delete(s);ch.classList.remove('sel');} else {set.add(s);ch.classList.add('sel');}
        card.querySelector('[data-count="'+gid+'"]').textContent=set.size+'/'+g.students.length;
        card.classList.toggle('on', set.size>0);
      });
    });
    card.querySelector('.grp-all').addEventListener('click',function(){
      var all=set.size===g.students.length;
      card.querySelectorAll('.chip').forEach(function(ch){ var s=ch.dataset.s; if(all){set.delete(s);ch.classList.remove('sel');} else {set.add(s);ch.classList.add('sel');} });
      card.querySelector('[data-count="'+gid+'"]').textContent=set.size+'/'+g.students.length;
      card.classList.toggle('on', set.size>0);
    });
    card.querySelector('[data-gd]').addEventListener('input',function(e){ GDATE[gid]=e.target.value; });
  });
}

function addAdhocRow(a){
  var box=document.getElementById('adhoc');
  var row=document.createElement('div'); row.className='adhoc-row fade';
  row.innerHTML='<button class="del">\u00d7</button>'+
    '<div class="ah-daterow"><label>Date</label><input data-a="date" type="date" value="'+esc(a.date)+'"></div>'+
    '<div class="row" style="margin-bottom:9px"><div class="field" style="flex:2; margin-bottom:0"><label>Student</label><input data-a="student" value="'+esc(a.student)+'" placeholder="Name"></div>'+
      '<div class="field" style="flex:1; margin-bottom:0"><label>Year</label><input data-a="year" value="'+esc(a.year)+'" placeholder="Y11"></div></div>'+
    '<div class="row times"><div class="field" style="margin-bottom:0"><label>Start</label><input data-a="start" type="time" value="'+esc(a.start)+'"></div>'+
      '<div class="field" style="margin-bottom:0"><label>End</label><input data-a="end" type="time" value="'+esc(a.end)+'"></div></div>';
  var endInp=row.querySelector('input[data-a="end"]'),endEdited=false;
  row.querySelectorAll('input[data-a]').forEach(function(inp){ inp.addEventListener('input',function(){ a[inp.dataset.a]=inp.value;
    if(inp.dataset.a==='end')endEdited=true;
    if(inp.dataset.a==='start'&&!endEdited&&/^\d{2}:\d{2}$/.test(inp.value)){a.end=String((+inp.value.slice(0,2)+1)%24).padStart(2,'0')+inp.value.slice(2);if(endInp)endInp.value=a.end;}
  }); });
  row.querySelector('.del').addEventListener('click',function(){ var i=ADHOC.indexOf(a); if(i>-1)ADHOC.splice(i,1); row.classList.add('removing'); setTimeout(function(){row.remove();},200); });
  box.appendChild(row);
}

function doLog(){
  var slots=[]; Object.keys(SEL).forEach(function(gid){ var arr=Array.from(SEL[gid]); if(arr.length) slots.push({groupId:gid,students:arr,date:GDATE[gid]||todayISO()}); });
  var adhoc=ADHOC.filter(function(a){return a.student&&a.student.trim();});
  if(!slots.length&&!adhoc.length){toast('Tick who attended first',true);return;}
  var b=document.getElementById('log-btn'); b.disabled=true; b.innerHTML='<span class="spin"></span>Logging\u2026';
  api('saveLog',{date:todayISO(),slots:slots,adhoc:adhoc}).then(function(r){ STATE.config=r.config; if(r.months)STATE.months=r.months; showResult(r); })
   .catch(function(e){b.disabled=false;b.textContent='Log to my sheet';if(e&&e.cancelled)return;toast('Failed: '+(e&&e.message||e),true);});
}
function showResult(r){
  barMount.innerHTML='';
  app.innerHTML='<div class="card fade result"><div class="big">'+r.written+'</div>'+
    '<div class="sub">session'+(r.written===1?'':'s')+' logged \u2713</div>'+
    '<div style="margin-top:16px;font-size:15px">Total so far: <b>'+(Number(r.totalHours)||0).toFixed(2)+' hrs</b> \u00b7 <b>'+gbp(r.totalPayment)+'</b></div>'+
    (r.sheetUrl&&r.sheetUrl!=='#sheet'?'<a class="link-out" href="'+esc(r.sheetUrl)+'" target="_blank" rel="noopener">Open my sheet \u2197</a>':'')+'</div>';
  mountBar('<button class="btn btn-primary btn-block" id="again">Log another</button>');
  document.getElementById('again').addEventListener('click', renderLogger);
}

// ================= SETTINGS =================
function renderSettings(){
  var cfg=STATE.config;
  app.innerHTML='<div class="fade"><div class="card"><h2>Settings</h2>'+
    '<div class="field"><label>Your name</label><input id="s-name" value="'+esc(cfg.name)+'"></div>'+
    '<div class="field" style="margin-bottom:0"><label>Rate per hour (\u00a3)</label><input id="s-rate" type="number" inputmode="decimal" value="'+esc(cfg.rate)+'" min="0" step="0.5"></div></div>'+
    '<div class="divider">Appearance</div>'+
    '<div class="card">'+themeField(cfg.theme)+'</div>'+
    '<div class="divider">Students &amp; groups</div><div id="grp-editor"></div></div>';
  app.querySelectorAll('.theme-chip').forEach(function(b){ b.addEventListener('click',function(){
    app.querySelectorAll('.theme-chip').forEach(function(x){x.classList.remove('on');});
    b.classList.add('on'); applyTheme(b.dataset.themePick);
  });});
  mountGroupsEditor(document.getElementById('grp-editor'), cfg.groups);
  mountBar('<div class="row"><button class="btn btn-ghost" id="s-cancel" style="flex:0 0 40%">Cancel</button><button class="btn btn-primary" id="s-save" style="flex:1">Save changes</button></div>');
  document.getElementById('s-cancel').addEventListener('click', renderLogger);
  document.getElementById('s-save').addEventListener('click',function(){
    var picked=app.querySelector('.theme-chip.on');
    var patch={theme:picked?picked.dataset.themePick:'classic',revision:STATE.config.revision,name:document.getElementById('s-name').value.trim(), rate:parseFloat(document.getElementById('s-rate').value)||0, groups:readGroups()};
    var b=document.getElementById('s-save'); b.disabled=true; b.innerHTML='<span class="spin"></span>Saving\u2026';
    api('updateConfig',patch).then(function(r){ STATE.config=r.config; toast('Saved \u2713'); renderLogger(); })
     .catch(function(e){b.disabled=false;b.textContent='Save changes';toast('Failed: '+(e&&e.message||e),true);});
  });
}
