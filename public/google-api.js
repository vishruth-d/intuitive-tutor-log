import { GOOGLE_CLIENT_ID } from './config.js';
import { TutorStore } from './store.js';

const FILE_SCOPE='https://www.googleapis.com/auth/drive.file';
const EMAIL_SCOPE='https://www.googleapis.com/auth/userinfo.email';
export const setupError = GOOGLE_CLIENT_ID ? '' : 'Google sign-in is awaiting the owner’s one-time setup.';
let token='',expires=0,email='',client=null,busy=false;
const pending=new Map();
// Inside HQ (the Mac app) Google sign-in can't run in the page, so HQ signs in natively and hands over short-lived
// access tokens via window.hqGoogleAuth. Anywhere else this is null and the Google token client below is used as before.
const hq=()=>typeof window!=='undefined'&&window.hqGoogleAuth&&window.hqGoogleAuth.available===true?window.hqGoogleAuth:null;
function useHQToken(r){token=r.access_token;expires=Date.now()+Number(r.expires_in)*1000-60000;}
async function hqSignIn(){
  let r;
  try{r=await hq().getToken({interactive:true});}
  catch(e){throw new Error(e&&e.code==='cancelled'?'Google sign-in was cancelled or denied.':e&&e.code==='scopes_denied'?'Allow invoice-file access and your email address to use Tutor Log.':(e&&e.message)||'Google sign-in failed. Please try again.');}
  const granted=String(r&&r.scope||'').split(' ');
  if(!granted.includes(FILE_SCOPE)||!granted.includes(EMAIL_SCOPE))throw new Error('Allow invoice-file access and your email address to use Tutor Log.');
  useHQToken(r);
  try{
    const profile=await request('GET','https://www.googleapis.com/oauth2/v2/userinfo');
    if(email && email!==profile.email){store.sheetId=null;pending.clear();}
    email=profile.email;
  }catch(e){token='';expires=0;email='';store.sheetId=null;pending.clear();throw e;}
}

export const auth={
  signIn(){
    if(setupError)return Promise.reject(new Error(setupError));
    if(hq())return hqSignIn();
    if(!window.google?.accounts?.oauth2)return Promise.reject(new Error('Google sign-in has not loaded. Check your connection and try again.'));
    return new Promise((resolve,reject)=>{
      client=google.accounts.oauth2.initTokenClient({
        client_id:GOOGLE_CLIENT_ID,scope:`${FILE_SCOPE} ${EMAIL_SCOPE}`,include_granted_scopes:false,
        callback:async response=>{
          if(response.error){reject(new Error('Google sign-in was cancelled or denied.'));return;}
          if(!google.accounts.oauth2.hasGrantedAllScopes(response,FILE_SCOPE,EMAIL_SCOPE)){
            reject(new Error('Allow invoice-file access and your email address to use Tutor Log.'));return;
          }
          token=response.access_token;expires=Date.now()+Number(response.expires_in)*1000-60000;
          try{
            const profile=await request('GET','https://www.googleapis.com/oauth2/v2/userinfo');
            if(email && email!==profile.email){store.sheetId=null;pending.clear();}
            email=profile.email;resolve();
          }catch(e){auth.signOut();reject(e);}
        },
        error_callback:()=>reject(new Error('Google sign-in closed or the popup was blocked. Please try again.'))
      });
      // Called synchronously from a click, including on Safari.
      client.requestAccessToken({prompt:'select_account'});
    });
  },
  signOut(){token='';expires=0;email='';store.sheetId=null;pending.clear();const h=hq();if(h)h.signOut().catch(()=>{});}
};

async function request(method,url,body){
  if(token&&Date.now()>=expires&&hq())await hq().getToken({interactive:false}).then(useHQToken,()=>{});
  if(!token||Date.now()>=expires)throw new Error('Your Google session expired. Sign out and sign in again, then retry.');
  const parsed=new URL(url);
  if(!['https://sheets.googleapis.com','https://www.googleapis.com'].includes(parsed.origin))throw new Error('Unexpected API destination.');
  let response;
  try{
    response=await fetch(url,{method,headers:{Authorization:`Bearer ${token}`,...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined,credentials:'omit',referrerPolicy:'no-referrer'});
  }catch{
    throw new Error(method==='GET'?'Could not reach Google. Check your connection and retry.':'Connection lost while saving. Keep this page open and retry the same entry; it will be checked before saving again.');
  }
  if(!response.ok){
    const error=new Error(response.status===401?'Your Google session expired. Sign out and sign in again.':response.status===403?'Google denied access. Check file access and that the Drive and Sheets APIs are enabled.':response.status===429?'Google is busy. Wait a minute and retry.':`Google could not complete this request (${response.status}). Retry the same entry.`);
    error.status=response.status;throw error;
  }
  return response.status===204?{}:response.json();
}
const store=new TutorStore(request);
export async function api(fn,payload){
  if(busy)throw new Error('Wait for the current save to finish.');
  if(!['getState','createTutorSheet','updateConfig','saveLog','totals'].includes(fn))throw new Error('Unknown operation.');
  busy=true;
  try{
    if(fn==='getState')return await store.getState(email);
    if(fn==='totals')return await store.currentTotals();
    if(fn==='saveLog'){
      const run=async p=>{
        const key=JSON.stringify(p);
        let id=pending.get(key);
        // Persist only a hash and random request ID. No names, tokens or logs are stored.
        const digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(email+key))),x=>x.toString(16).padStart(2,'0')).join('');
        const storageKey='tutor-request-'+digest;
        try{id=id||sessionStorage.getItem(storageKey);}catch{}
        id=id||crypto.randomUUID();pending.set(key,id);
        try{sessionStorage.setItem(storageKey,id);}catch{}
        const result=await store.saveLog(p,id);
        pending.delete(key);try{sessionStorage.removeItem(storageKey);}catch{}
        return result;
      };
      try{return await run(payload);}
      catch(e){
        if(e&&e.duplicate){
          if(typeof window!=='undefined'&&window.confirm&&window.confirm(e.dupMsg))return await run({...payload,force:true});
          throw Object.assign(new Error('Not logged.'),{cancelled:true});
        }
        throw e;
      }
    }
    return await store[fn](payload);
  }finally{busy=false;}
}
