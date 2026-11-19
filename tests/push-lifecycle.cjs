const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const code=fs.readFileSync(__dirname+'/../push.js','utf8');
async function scenario({sub=true,preference=null,permission='granted',fail=false}={}){
 const events={},messages=[],rows=[],counts={subscribe:0,unsubscribe:0,request:0,delete:0};
 const buttons=Object.fromEntries(['pushRegister','pushUnregister','pushStatus'].map(id=>[id,{addEventListener:(name,fn)=>events[id]=fn}]));
 let uid='daniel',current=sub?subscription():null,stored=preference;
 function subscription(){return {options:{},toJSON:()=>({endpoint:'https://push.example/device',keys:{p256dh:'key',auth:'auth'}}),unsubscribe:async()=>{counts.unsubscribe++;current=null;return true;}};}
 const document={hidden:false,getElementById:id=>buttons[id],addEventListener:(name,fn)=>events[name]=fn};
 const navigator={serviceWorker:{ready:Promise.resolve({pushManager:{getSubscription:async()=>current,subscribe:async()=>{counts.subscribe++;return current=subscription();}}}),addEventListener:(name,fn)=>events['worker-'+name]=fn}};
 const sb={from:()=>({upsert:async row=>{rows.push(row);return {error:fail?{message:'offline'}:null};},delete:()=>({eq:()=>({eq:async()=>{counts.delete++;return {};}})})})};
 const window={PushManager:class{},Notification:{},sb,get sessionUser(){return uid?{id:uid}:null;},addEventListener:(name,fn)=>events[name]=fn};
 const Notification={permission,requestPermission:async()=>{counts.request++;return permission;}};
 const context={window,document,navigator,Notification,localStorage:{getItem:()=>stored,setItem:(k,v)=>stored=v},location:{pathname:'/Familienkalender/'},setInterval:fn=>events.tick=fn,setTimeout:()=>0,atob:s=>Buffer.from(s,'base64').toString('binary'),Uint8Array,Promise};
 vm.runInNewContext(code,context);const settle=async()=>{for(let i=0;i<20;i++)await Promise.resolve();};await settle();
 return {events,counts,rows,buttons,settle,get text(){return buttons.pushStatus.textContent;},get preference(){return stored;},setUser:v=>uid=v};
}
(async()=>{
 let x=await scenario();assert.match(x.text,/registriert/);assert.equal(x.rows.length,1);assert.equal(x.counts.request,0);assert.equal(x.counts.subscribe,0);assert.equal(x.counts.unsubscribe,0);
 await x.events.visibilitychange();await x.settle();assert.equal(x.rows.length,2);assert.equal(x.counts.subscribe,0);
 x=await scenario({sub:false});assert.match(x.text,/kein Push-Abo/);assert.equal(x.rows.length,0);assert.equal(x.counts.subscribe,0);
 await x.events.pushRegister();await x.settle();assert.equal(x.counts.subscribe,1);assert.equal(x.rows.length,1);
 x=await scenario({sub:false,preference:'on'});assert.equal(x.counts.subscribe,1);assert.match(x.text,/registriert/);
 x=await scenario({preference:'off'});assert.equal(x.rows.length,0);assert.equal(x.counts.subscribe,0);assert.match(x.text,/ausdrücklich/);
 x=await scenario({permission:'denied'});assert.equal(x.rows.length,0);assert.match(x.text,/blockiert/);
 x=await scenario({fail:true});assert.match(x.text,/nicht abgeglichen/);assert.equal(x.counts.unsubscribe,0);
 x=await scenario();await x.events.pushUnregister();await x.settle();assert.equal(x.counts.unsubscribe,1);assert.equal(x.preference,'off');const n=x.rows.length;await x.events.online();await x.settle();assert.equal(x.rows.length,n);
 x=await scenario();x.setUser(null);x.events.tick();await x.settle();assert.match(x.text,/Bitte anmelden/);assert.equal(x.counts.unsubscribe,0);
 x.setUser('caro');x.events.tick();await x.settle();assert.equal(x.rows.at(-1).user_id,'caro'); // server RLS still rejects a cross-account endpoint; no ownership bypass in client.
 console.log('Push lifecycle tests passed: existing/reopen/restore/new/opt-out/denied/offline/logout/account change.');
})().catch(e=>{console.error(e);process.exitCode=1;});

