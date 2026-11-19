/* Keep browser subscriptions and the signed-in user's server record in sync. */
(function(){
 'use strict';
 const PUBLIC_KEY='BDT8qUCyoPWo3TJ-J60q0gOM0LzsoTqkLr4AnICAaeu9EZgpvuFLCOxZhKsia0gRJsct4No1YVWn5-AXl7L-bXA';
 const enable=document.getElementById('pushRegister'),disable=document.getElementById('pushUnregister');
 let busy=false,lastUser;
 const user=()=>window.sessionUser?.id||null;
 const say=text=>{document.getElementById('pushStatus').textContent=text;};
 const preference=id=>'famcal_push:'+location.pathname+':'+id;
 function read(id){try{return localStorage.getItem(preference(id));}catch(_){return null;}}
 function remember(id,value){try{localStorage.setItem(preference(id),value);}catch(_){}}
 function keyBytes(base64){const raw=atob(base64.replace(/-/g,'+').replace(/_/g,'/'));return Uint8Array.from(raw,c=>c.charCodeAt(0));}
 function matching(sub){const key=sub.options?.applicationServerKey;if(!key)return true;const old=new Uint8Array(key),now=keyBytes(PUBLIC_KEY);return old.length===now.length&&old.every((v,i)=>v===now[i]);}
 async function registration(){
  if(!('serviceWorker' in navigator)||!('PushManager' in window)||!('Notification' in window))throw Error('Web Push wird auf diesem Gerät nicht unterstützt.');
  // A broken worker must not leave the controls waiting forever.
  return await Promise.race([navigator.serviceWorker.ready,new Promise((_,reject)=>setTimeout(()=>reject(Error('App ist noch nicht bereit. Bitte neu öffnen.')),10000))]);
 }
 async function save(sub,id){
  if(user()!==id)throw Error('Anmeldung hat sich geändert. Bitte erneut prüfen.');
  const obj=sub.toJSON();
  if(!obj.keys?.p256dh||!obj.keys?.auth)throw Error('Push-Abonnement enthält keine Schlüssel.');
  const result=await window.sb.from('push_subscriptions').upsert({user_id:id,endpoint:obj.endpoint,p256dh:obj.keys.p256dh,auth_key:obj.keys.auth},{onConflict:'endpoint'});
  if(result.error)throw result.error;
 }
 async function sync(manual=false){
  if(busy)return;
  const id=user();
  if(!id||!window.sb){say('Bitte anmelden, um den Push-Status dieses Geräts zu prüfen.');return;}
  busy=true;enable.disabled=disable.disabled=true;
  try{
   const reg=await registration();
   let permission=Notification.permission;
   if(manual&&permission!=='granted')permission=await Notification.requestPermission();
   if(permission!=='granted'){say(permission==='denied'?'Benachrichtigungen sind in den Geräteeinstellungen blockiert.':'Benachrichtigungen sind auf diesem Gerät noch nicht erlaubt.');return;}
   if(!manual&&read(id)==='off'){say('Push ist auf diesem Gerät ausdrücklich abgemeldet.');return;}
   let sub=await reg.pushManager.getSubscription();
   if(sub&&!matching(sub)){say('Das Geräte-Abo verwendet einen anderen Schlüssel. Bitte den Support kontaktieren.');return;}
   if(!sub&&(manual||read(id)==='on'))sub=await reg.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:keyBytes(PUBLIC_KEY)});
   if(!sub){say('Auf diesem Gerät ist kein Push-Abo vorhanden. Bitte einmal aktivieren.');return;}
   await save(sub,id);
   if(user()!==id)return;
   remember(id,'on');
   say('Dieses Gerät ist für Push-Erinnerungen registriert.');
  }catch(e){if(user()===id)say('Push konnte nicht abgeglichen werden: '+e.message+' Bitte bei bestehender Internetverbindung erneut prüfen.');}
  finally{busy=false;enable.disabled=disable.disabled=false;}
 }
 enable.addEventListener('click',()=>sync(true));
 disable.addEventListener('click',async()=>{
  if(busy)return;
  const id=user();if(!id){say('Bitte zuerst anmelden.');return;}
  busy=true;enable.disabled=disable.disabled=true;
  try{
   const reg=await registration(),sub=await reg.pushManager.getSubscription();
   if(user()!==id)throw Error('Anmeldung hat sich geändert.');
   // Persist intent before awaiting network so automatic repair never overrides an explicit opt-out.
   remember(id,'off');
   if(sub){
    const r=await window.sb.from('push_subscriptions').delete().eq('endpoint',sub.endpoint).eq('user_id',id);
    if(r.error)throw r.error;
    await sub.unsubscribe();
   }
   say('Dieses Gerät ist abgemeldet.');
  }catch(e){say('Abmeldung konnte nicht abgeschlossen werden: '+e.message);}
  finally{busy=false;enable.disabled=disable.disabled=false;}
 });
 // enter() finishes asynchronously; do not await Supabase calls inside its auth callback.
 function checkUser(){const id=user();if(id!==lastUser&&!busy){lastUser=id;sync();}}
 setInterval(checkUser,2000);checkUser();
 document.addEventListener('visibilitychange',()=>{if(!document.hidden)sync();});
 window.addEventListener('online',()=>sync());
 navigator.serviceWorker?.addEventListener('message',event=>{if(event.data?.type==='push-subscription-changed')sync();});
})();
