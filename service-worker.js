const CACHE='famcal-shell-v17';
const ASSETS=['./','./index.html','./config.js','./manifest.webmanifest','./icon.svg'];
self.addEventListener('install',e=>{self.skipWaiting();e.waitUntil(caches.open(CACHE).then(c=>c.addAll(ASSETS)))});
self.addEventListener('activate',e=>e.waitUntil(Promise.all([self.clients.claim(),caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k))))])));
self.addEventListener('fetch',e=>{if(e.request.method!=='GET'||new URL(e.request.url).origin!==self.location.origin)return;e.respondWith(fetch(e.request).then(r=>{if(r.ok){const copy=r.clone();caches.open(CACHE).then(c=>c.put(e.request,copy))}return r}).catch(()=>caches.match(e.request)))});
self.addEventListener('push',e=>{
 let data={};try{data=e.data?e.data.json():{}}catch(_){data={body:e.data?.text()||''}}
 const title=String(data.title||'Familienkalender').slice(0,120);
 const options={body:String(data.body||'Neue Erinnerung').slice(0,240),icon:'./icon.svg',badge:'./icon.svg',tag:String(data.tag||'family-reminder'),data:{url:'./'}};
 e.waitUntil(self.registration.showNotification(title,options));
});
self.addEventListener('notificationclick',e=>{e.notification.close();e.waitUntil(clients.matchAll({type:'window',includeUncontrolled:true}).then(w=>{const existing=w.find(c=>c.url.startsWith(self.registration.scope));if(existing)return existing.focus();return clients.openWindow('./')}))});
