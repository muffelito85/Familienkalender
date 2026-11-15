const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {PGlite}=require('@electric-sql/pglite');
(async()=>{
 const dir=path.resolve(__dirname,'../supabase/migrations');
 const filename=fs.readdirSync(dir).find(n=>n.endsWith('_two_independent_reminders.sql'));
 assert(filename,'Generated migration missing');const sql=fs.readFileSync(path.join(dir,filename),'utf8');
 const db=await PGlite.create();
 try{
  await db.exec(`create table public.events(id text primary key,title text,"allDay" boolean default false,reminder_minutes integer,
   constraint events_reminder_minutes_check check(reminder_minutes is null or reminder_minutes in(15,60,1440,10080)));
   create table public.tasks(id text primary key,title text,due_date date,due_time time,completed boolean default false);
   create table public.notification_deliveries(id text,notification_key text,status text);
   insert into events values('old-first','A',false,60),('old-none','B',false,null),('old-all-day','C',true,null);
   insert into tasks(id,title,due_date,due_time) values('with-time','D','2026-11-15','11:45'),('without-time','E','2026-11-15',null);
   insert into notification_deliveries values('delivery','event:old-first:2026-11-15:60','sent');`);
  const before=(await db.query('select id,title,"allDay",reminder_minutes from events order by id')).rows;
  await db.exec(sql);
  assert.deepEqual((await db.query('select id,title,"allDay",reminder_minutes from events order by id')).rows,before);
  assert.equal((await db.query('select count(*)::int as n from tasks where legacy_due_notification and reminder_minutes is null and reminder2_minutes is null')).rows[0].n,2);
  assert.equal((await db.query("select legacy_due_notification from events where id='old-all-day'")).rows[0].legacy_due_notification,true);
  assert.equal((await db.query("select legacy_due_notification from events where id='old-none'")).rows[0].legacy_due_notification,false);
  await db.exec("update tasks set legacy_due_notification=false,reminder_minutes=30,reminder2_minutes=15 where id='with-time';update tasks set legacy_due_notification=false where id='without-time';");
  const snapshot=(await db.query('select * from tasks order by id')).rows;await db.exec(sql);await db.exec(sql);
  assert.deepEqual((await db.query('select * from tasks order by id')).rows,snapshot,'Rerun overwrites user selections/disabled legacy notification');
  await db.exec("insert into tasks(id,title) values('new','F');insert into events(id,title) values('new','G');");
  for(const table of ['events','tasks']){
   const row=(await db.query(`select reminder_minutes,reminder2_minutes,legacy_due_notification from ${table} where id='new'`)).rows[0];
   assert.deepEqual(row,{reminder_minutes:null,reminder2_minutes:null,legacy_due_notification:false});
   await db.exec(`update ${table} set reminder_minutes=30,reminder2_minutes=30 where id='new'`);
   await assert.rejects(()=>db.exec(`update ${table} set reminder2_minutes=7 where id='new'`));
  }
  const columns=(await db.query("select data_type,is_nullable from information_schema.columns where table_schema='public' and table_name in('events','tasks') and column_name in('reminder_minutes','reminder2_minutes')")).rows;
  assert.equal(columns.length,4);assert(columns.every(c=>c.data_type==='integer'&&c.is_nullable==='YES'));
  assert.deepEqual((await db.query('select * from notification_deliveries')).rows,[{id:'delivery',notification_key:'event:old-first:2026-11-15:60',status:'sent'}]);
  console.log('PASS: real local PostgreSQL migration applied three times; first reminders and delivery history preserved; legacy markers preserved/disableable; nullable integer defaults; 30-minute constraint; invalid values rejected; no production DB touched.');
 }finally{await db.close()}
})().catch(e=>{console.error(e);process.exitCode=1});
