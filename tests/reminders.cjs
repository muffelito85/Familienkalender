const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict'),{stripTypeScriptTypes}=require('node:module');
const path=require('node:path');
const source=fs.readFileSync(path.resolve(__dirname,'../supabase/functions/dynamic-api/index.ts'),'utf8');
const compiled=stripTypeScriptTypes(source.replace(/^import .*;\n/gm,''));
function fixture(now='2026-11-13T10:00:00Z'){
 let handler;const pushes=[],claims=new Set(),writes=[];
 const db={events:[],tasks:[],anniversaries:[],notification_settings:[],push_subscriptions:[]};
 const NativeDate=Date;class Clock extends NativeDate{constructor(...a){super(...(a.length?a:[now]))}static now(){return new NativeDate(now).getTime()}}
 const client={from(table){let mode='read',payload,filters=[];const q={select(){return q},eq(k,v){filters.push([k,v]);return q},in(k,v){filters.push([k,v]);return q},range(){return q},update(p){mode='update';payload=p;return q},delete(){mode='delete';return q},then(resolve){if(mode!=='read')writes.push({table,mode,payload});const data=(db[table]||[]).filter(r=>filters.every(([k,v])=>Array.isArray(v)?v.includes(r[k]):r[k]===v));return Promise.resolve({data}).then(resolve)}};return q},async rpc(name,args){if(name==='verify_family_reminder_scheduler_request')return {data:['dry-run','run'].includes(args.p_mode)&&args.p_timestamp==='1794564000'&&args.p_signature==='scheduler-test-token'};if(name==='claim_notification_delivery'){if(claims.has(args.p_user_id+'|'+args.p_notification_key))return {data:false};claims.add(args.p_user_id+'|'+args.p_notification_key);return {data:true}}throw Error(name)}};
 const context=vm.createContext({Intl,Date:Clock,Set,Map,Response,console,createClient:()=>client,webpush:{setVapidDetails(){},async sendNotification(sub,payload){pushes.push({recipient:sub.endpoint,payload:JSON.parse(payload)});}},Deno:{env:{get:n=>n==='REMINDER_CRON_SECRET'?'legacy-test-token':'test-value'},serve:fn=>handler=fn}});
 vm.runInContext(compiled,context);
 const run=s=>vm.runInContext(s,context);
 const people=JSON.parse(run('JSON.stringify(PEOPLE)'));
 db.notification_settings=Object.values(people).map(id=>({user_id:id,enabled:true,quiet_enabled:true,quiet_start:'22:00',quiet_end:'07:00',timezone:'Europe/Berlin'}));
 db.push_subscriptions=Object.values(people).map(id=>({id,user_id:id,endpoint:id,p256dh:'fake',auth_key:'fake'}));
 const request=(mode,token='scheduler-test-token',legacy=false)=>handler(new Request('https://example.invalid',{method:'POST',headers:{'Content-Type':'application/json',...(legacy?{Authorization:'Bearer '+token}:{'x-reminder-timestamp':'1794564000','x-reminder-signature':token})},body:JSON.stringify({mode})}));
 return {db,pushes,claims,writes,run,people,request};
}
(async()=>{
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
})().catch(e=>{console.error(e);process.exitCode=1});
