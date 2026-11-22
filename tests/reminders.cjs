const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict'),{stripTypeScriptTypes}=require('node:module');
const path=require('node:path');
const source=fs.readFileSync(path.resolve(__dirname,'../supabase/functions/dynamic-api/index.ts'),'utf8');
const compiled=stripTypeScriptTypes(source.replace(/^import .*;\n/gm,''));
function fixture(now='2026-11-13T10:00:00Z'){
 let handler;const pushes=[],claims=new Set(),writes=[];
 const db={events:[],tasks:[],anniversaries:[],notification_settings:[],push_subscriptions:[]};
 const NativeDate=Date;class Clock extends NativeDate{constructor(...a){super(...(a.length?a:[now]))}static now(){return new NativeDate(now).getTime()}}
 const client={from(table){let mode='read',payload,filters=[];const q={select(){return q},eq(k,v){filters.push([k,v]);return q},in(k,v){filters.push([k,v]);return q},range(){return q},update(p){mode='update';payload=p;return q},delete(){mode='delete';return q},then(resolve){if(mode!=='read')writes.push({table,mode,payload});const data=(db[table]||[]).filter(r=>filters.every(([k,v])=>Array.isArray(v)?v.includes(r[k]):r[k]===v));return Promise.resolve({data}).then(resolve)}};return q},async rpc(name,args){if(name==='verify_family_reminder_scheduler_request')return {data:['dry-run','run'].includes(args.p_mode)&&args.p_timestamp==='1794564000'&&args.p_signature==='scheduler-test-token'};if(name==='claim_notification_delivery'){if(claims.has(args.p_user_id+'|'+args.p_notification_key))return {data:false};claims.add(args.p_user_id+'|'+args.p_notification_key);return {data:true}}throw Error(name)}};
 const traces=[];const testConsole={info:m=>traces.push(JSON.parse(m)),error:console.error};
 const context=vm.createContext({Intl,Date:Clock,Set,Map,Response,console:testConsole,createClient:()=>client,webpush:{setVapidDetails(){},async sendNotification(sub,payload){pushes.push({recipient:sub.endpoint,payload:JSON.parse(payload)});}},Deno:{env:{get:n=>n==='REMINDER_CRON_SECRET'?'legacy-test-token':'test-value'},serve:fn=>handler=fn}});
 vm.runInContext(compiled,context);
 const run=s=>vm.runInContext(s,context);
 const people=JSON.parse(run('JSON.stringify(PEOPLE)'));
 db.notification_settings=Object.values(people).map(id=>({user_id:id,enabled:true,quiet_enabled:true,quiet_start:'22:00',quiet_end:'07:00',timezone:'Europe/Berlin'}));
 db.push_subscriptions=Object.values(people).map(id=>({id,user_id:id,endpoint:id,p256dh:'fake',auth_key:'fake'}));
 const request=(mode,token='scheduler-test-token',legacy=false)=>handler(new Request('https://example.invalid',{method:'POST',headers:{'Content-Type':'application/json',...(legacy?{Authorization:'Bearer '+token}:{'x-reminder-timestamp':'1794564000','x-reminder-signature':token})},body:JSON.stringify({mode})}));
 return {db,pushes,claims,writes,run,people,request,traces,setNow:v=>{now=v}};
}
async function regressionSuite(){
 const f=fixture();const p=f.people;
 assert.deepEqual(Array.from(f.run("recipients('private',['daniel','caro','lara'],PEOPLE.daniel)")),[p.daniel]);
 assert.equal(f.run("recipients('private',['caro'],null).length"),0);
 assert.deepEqual(Array.from(f.run("recipients('family',['lara'],PEOPLE.daniel)")),[p.lara]);
 assert.equal(f.run("localDateTime('2026-11-13','09:00').toISOString()"),'2026-11-13T08:00:00.000Z');
 assert.equal(f.run("localDateTime('2026-07-13','09:00').toISOString()"),'2026-07-13T07:00:00.000Z');
 f.db.events.push({id:'private-event',family_id:'11111111-1111-4111-8111-111111111111',title:'PRIVATE EVENT',start:'2026-11-13',end:'2026-11-13',allDay:true,ms:['daniel','caro','lara'],visibility:'private',created_by:p.daniel});
 f.db.tasks.push({id:'private-task',family_id:'11111111-1111-4111-8111-111111111111',title:'PRIVATE TASK',assigned_to:'caro',due_date:'2026-11-13',due_time:'10:00:00',visibility:'private',created_by:p.daniel,completed:false});
 let r=await f.request('run','wrong');assert.equal(r.status,401);assert.equal(f.pushes.length,0);
 r=await f.request('test');assert.equal(r.status,401);
 r=await f.request('dry-run');const dry=await r.json();assert.equal(dry.no_push_sent,true);assert.equal(dry.due,2);assert.equal(f.claims.size,0);assert.equal(f.pushes.length,0);
 r=await f.request('run');assert.equal((await r.json()).sent,2);assert(f.pushes.every(x=>x.recipient===p.daniel));
 r=await f.request('run');assert.equal((await r.json()).sent,0);assert.equal(f.pushes.length,2);
 r=await f.request('dry-run','legacy-test-token',true);assert.equal(r.status,200);
 const q=fixture('2026-11-13T22:00:00Z');q.db.tasks.push({id:'late',family_id:'11111111-1111-4111-8111-111111111111',title:'LATE',assigned_to:'daniel',due_date:'2026-11-13',due_time:'21:00',visibility:'family',created_by:q.people.daniel,completed:false});
 r=await q.request('run');assert.equal((await r.json()).due,0);assert.equal(q.pushes.length,0);
 const next=fixture('2026-11-14T06:00:00Z');next.db.tasks.push({...q.db.tasks[0]});r=await next.request('run');assert.equal((await r.json()).sent,1);
 const disabled=fixture();disabled.db.tasks.push({...q.db.tasks[0],due_time:'09:00'});disabled.db.notification_settings.forEach(s=>s.enabled=false);r=await disabled.request('run');assert.equal((await r.json()).sent,0);
 console.log('PASS: private event/task titles only reach creator; family assignment retained; invalid scheduler signatures rejected; dry run has no writes/push; legacy auth retained; duplicate claim skipped; delayed reminders suppressed during current quiet hours and sent after quiet hours; disabled notifications respected; CET/CEST conversions correct.');
}


function event(f,changes={}){return {id:'event',family_id:'11111111-1111-4111-8111-111111111111',title:'TEST',start:'2026-11-13',end:'2026-11-13',allDay:false,st:'11:45',ms:['daniel'],rep:'none',visibility:'private',created_by:f.people.daniel,reminder_minutes:null,reminder2_minutes:null,legacy_due_notification:false,...changes}}
function task(f,changes={}){return {id:'task',family_id:'11111111-1111-4111-8111-111111111111',title:'TEST',assigned_to:'daniel',due_date:'2026-11-13',due_time:'11:45',completed:false,visibility:'private',created_by:f.people.daniel,reminder_minutes:null,reminder2_minutes:null,legacy_due_notification:false,...changes}}
async function dualReminderSuite(){
 let cases=0;const check=()=>cases++;
 for(const table of ['events','tasks']){
  for(const [a,b,count] of [[null,null,0],[15,null,1],[null,15,1],[60,15,2],[15,15,1],[30,null,1]]){
   const f=fixture('2026-11-13T10:30:00Z');f.db[table].push((table==='events'?event:task)(f,{reminder_minutes:a,reminder2_minutes:b}));
   const r=await(await f.request('run')).json();assert.equal(r.sent,count,table+' '+a+'/'+b);assert.equal(f.pushes.length,count);check();
  }
 }
 const staged=fixture('2026-11-13T09:45:00Z');staged.db.events.push(event(staged,{reminder_minutes:60,reminder2_minutes:15}));
 assert.equal((await(await staged.request('run')).json()).sent,1);staged.setNow('2026-11-13T10:30:00Z');
 assert.equal((await(await staged.request('run')).json()).sent,1);assert.equal(staged.pushes.length,2);
 [staged.db.events[0].reminder_minutes,staged.db.events[0].reminder2_minutes]=[15,60];
 assert.equal((await(await staged.request('run')).json()).sent,0);assert.equal(staged.claims.size,2);check();
 const old=fixture('2026-11-13T10:30:00Z');old.db.events.push(event(old,{reminder_minutes:15,reminder2_minutes:undefined,legacy_due_notification:undefined}));
 old.claims.add(old.people.daniel+'|event:event:2026-11-13:15');assert.equal((await(await old.request('run')).json()).sent,0);check();
 const noTime=fixture();noTime.db.tasks.push(task(noTime,{due_time:null,reminder_minutes:15}));
 // Exercise the real builder in its existing context; no DB or push is involved.
 const candidates=await noTime.run('buildCandidates')( {from:table=>{const q={select(){return q},eq(){return q},range(){return Promise.resolve({data:noTime.db[table]})}};return q}},new Date('2026-11-13T10:00:00Z'));
 assert.equal(candidates.find(c=>c.type==='task').scheduled.toISOString(),'2026-11-13T07:45:00.000Z');check();
 for(const [lead,iso] of [[60,'2026-11-13T07:00:00.000Z'],[1440,'2026-11-12T08:00:00.000Z'],[10080,'2026-11-06T08:00:00.000Z']]){
  assert.equal(noTime.run(`reminderDate('2026-11-13','09:00',${lead}).toISOString()`),iso);check();
 }
 const legacy=fixture();legacy.db.tasks.push(task(legacy,{due_time:null,legacy_due_notification:true}));
 assert.equal((await(await legacy.request('run')).json()).sent,1);assert(legacy.claims.has(legacy.people.daniel+'|task:task:2026-11-13:09:00'));check();
 const done=fixture();done.db.tasks.push(task(done,{completed:true,reminder_minutes:60}));assert.equal((await(await done.request('run')).json()).sent,0);check();
 const collision=fixture('2026-11-13T10:45:00Z');collision.db.tasks.push(task(collision,{due_time:'11:45:15',legacy_due_notification:true}));
 assert.equal((await(await collision.request('run')).json()).sent,1);collision.db.tasks[0].legacy_due_notification=false;collision.db.tasks[0].reminder_minutes=15;
 assert.equal((await(await collision.request('run')).json()).sent,1);assert.equal(collision.claims.size,2);check();
 const weekly=fixture('2026-11-13T10:30:00Z');weekly.db.events.push(event(weekly,{start:'2026-11-06',end:'2026-11-06',rep:'weekly',reminder_minutes:15}));assert.equal((await(await weekly.request('run')).json()).sent,1);check();
 for(const [rep,start] of [['daily','2026-11-12'],['monthly','2026-10-13'],['yearly','2025-11-13']]){
  const f=fixture('2026-11-13T10:30:00Z');f.db.events.push(event(f,{start,end:start,rep,reminder_minutes:15}));assert.equal((await(await f.request('run')).json()).sent,rep==='daily'?2:1);check();
 }
 const allDay=fixture();allDay.db.events.push(event(allDay,{allDay:true,st:'',reminder_minutes:null}));assert.equal((await(await allDay.request('run')).json()).sent,0);
 allDay.db.events[0].legacy_due_notification=true;assert.equal((await(await allDay.request('run')).json()).sent,1);check();
 const late=fixture('2026-11-13T12:47:00Z');late.db.events.push(event(late,{reminder_minutes:15}));const delayed=await(await late.request('run')).json();
 assert.equal(delayed.sent,1);assert.equal(delayed.late_sent,1);assert.equal(delayed.max_delay_seconds,137*60);
 assert.equal(late.traces[0].scheduled_for,'2026-11-13T10:30:00.000Z');assert.equal(late.traces[0].provider_accepted_at,'2026-11-13T12:47:00.000Z');check();
 const quiet=fixture('2026-11-13T22:00:00Z');quiet.db.events.push(event(quiet,{st:'21:15',reminder_minutes:15}));assert.equal((await(await quiet.request('run')).json()).sent,0);
 quiet.setNow('2026-11-14T06:00:00Z');assert.equal((await(await quiet.request('run')).json()).sent,1);check();
 const dst=fixture();for(const [expression,expected] of [
  ["localDateTime('2027-03-28','02:30')",'2027-03-28T01:30:00.000Z'],
  ["localDateTime('2027-10-31','02:30')",'2027-10-31T00:30:00.000Z'],
  ["reminderDate('2027-03-28','09:00',1440)",'2027-03-27T08:00:00.000Z'],
  ["reminderDate('2027-10-31','09:00',1440)",'2027-10-30T07:00:00.000Z'],
  ["reminderDate('2027-03-28','09:00',10080)",'2027-03-21T08:00:00.000Z']
 ]){assert.equal(dst.run(expression+'.toISOString()'),expected);check();}

 // A time edit after catch-up must produce a new reminder, without resetting history.
 const moved=fixture('2026-11-22T19:52:00Z');
 moved.db.events.push({id:'moved',family_id:'11111111-1111-4111-8111-111111111111',title:'Time edit',
   start:'2026-11-22',end:'2026-11-22',allDay:false,st:'20:10',ms:['daniel'],visibility:'family',
   created_by:moved.people.daniel,reminder_minutes:15,reminder2_minutes:null,legacy_due_notification:false});
 assert.equal((await(await moved.request('run')).json()).sent,1);
 const original=moved.traces[0];
 moved.db.notification_deliveries=[{user_id:moved.people.daniel,notification_key:original.notification_key,scheduled_for:original.scheduled_for,status:'sent'}];
 moved.db.events[0].st='21:10';moved.setNow('2026-11-22T19:54:00Z');
 assert.equal((await(await moved.request('run')).json()).sent,0);
 moved.setNow('2026-11-22T19:55:00Z');
 assert.equal((await(await moved.request('run')).json()).sent,1);
 assert(moved.pushes.at(-1).payload.tag.endsWith(':at:2026-11-22T19:55:00.000Z'));
 assert.equal((await(await moved.request('run')).json()).sent,0);
 moved.db.events[0].reminder_minutes=null;moved.db.events[0].reminder2_minutes=15;
 assert.equal((await(await moved.request('run')).json()).sent,0);
 moved.db.events[0].st='21:15';moved.setNow('2026-11-22T20:00:00Z');
 assert.equal((await(await moved.request('run')).json()).sent,1);
 assert(moved.pushes.at(-1).payload.tag.endsWith(':at:2026-11-22T20:00:00.000Z'));
 assert.equal(moved.db.notification_deliveries[0].notification_key,original.notification_key);
 assert.equal(moved.pushes.length,3);
 check();
 console.log('PASS: '+cases+' two-reminder scenarios, stable keys/slot swaps, legacy compatibility, no-time 09:00, repeats, private recipients, 137-minute catch-up retained and logged, quiet hours and DST transitions.');
}
(async()=>{await regressionSuite();await dualReminderSuite()})().catch(e=>{console.error(e);process.exitCode=1});
