const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {PGlite}=require('@electric-sql/pglite'),{btree_gist}=require('@electric-sql/pglite/contrib/btree_gist');
const {randomUUID}=require('node:crypto');
(async()=>{
 const db=new PGlite({extensions:{btree_gist}}),a=randomUUID(),b=randomUUID(),child=randomUUID(),stranger=randomUUID(),family=randomUUID(),other=randomUUID();
 await db.exec(`create role anon;create role authenticated;create schema auth;create table auth.users(id uuid primary key);
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 grant usage on schema auth to authenticated;grant execute on function auth.uid() to authenticated;
 create table public.families(id uuid primary key);create table public.family_members(family_id uuid references families(id),user_id uuid references auth.users(id),role text,primary key(family_id,user_id));
 alter table public.family_members enable row level security;grant select on family_members to authenticated;
 create policy own_membership on family_members for select to authenticated using(user_id=auth.uid());
 create publication supabase_realtime;
 insert into auth.users values('${a}'),('${b}'),('${child}'),('${stranger}');insert into families values('${family}'),('${other}');
 insert into family_members values('${family}','${a}','admin'),('${family}','${b}','adult'),('${family}','${child}','child'),('${other}','${stranger}','admin');`);
 const sql=fs.readFileSync(path.join(__dirname,'../supabase/migrations/20261122183913_vacation_planner.sql'),'utf8');await db.exec(sql);await db.exec(sql);
 assert.equal((await db.query('select count(*)::int n from vacation_accounts')).rows[0].n,0); // no seeded entitlement
 assert.equal((await db.query("select count(*)::int n from pg_publication_tables where pubname='supabase_realtime'")).rows[0].n,2);
 async function as(id,query){await db.exec(`set role authenticated;set request.jwt.claim.sub='${id}';`);try{return await db.query(query);}finally{await db.exec('reset role');}}
 async function fails(id,query,code){await assert.rejects(as(id,query),e=>!code||e.code===code);}
 const acc=(u,y=2026)=>`insert into vacation_accounts(family_id,user_id,year,annual_entitlement,carryover_days,workweek,work_location) values('${family}','${u}',${y},30,0,array[1,2,3,4,5]::smallint[],'{"state":"BY"}') returning id`;
 const ins=(u,start,end,status='planned',halves='{}')=>`insert into vacation_entries(family_id,user_id,start_date,end_date,status,half_day_information) values('${family}','${u}','${start}','${end}','${status}','${halves}') returning id,updated_at`;
 await as(a,acc(a));await as(b,acc(b));await fails(child,acc(child));await fails(a,acc(b,2027));
 assert.equal((await as(a,'select * from vacation_accounts')).rows.length,2);
 assert.equal((await as(child,'select * from vacation_accounts')).rows.length,0);
 assert.equal((await as(stranger,'select * from vacation_accounts')).rows.length,0);
 assert.equal((await as(child,`select * from vacation_family_people('${family}')`)).rows.length,2);
 assert.equal((await as(stranger,`select * from vacation_family_people('${family}')`)).rows.length,0);
 assert.equal((await as(b,`update vacation_accounts set annual_entitlement=99 where user_id='${a}' returning id`)).rows.length,0);
 assert.equal((await as(a,`update vacation_accounts set carryover_days=4 where user_id='${a}' returning id`)).rows.length,1);
 await fails(a,`update vacation_accounts set user_id='${b}' where user_id='${a}'`,'23514');
 await fails(a,`update vacation_accounts set workweek=array[1,1]::smallint[] where user_id='${a}'`,'23514');
 await fails(a,`update vacation_accounts set work_location='{"state":"XX"}' where user_id='${a}'`,'23514');
 await fails(a,`update vacation_accounts set annual_entitlement=30.2 where user_id='${a}'`,'23514');
 const saved=(await as(a,ins(a,'2026-06-08','2026-06-12'))).rows[0];
 await fails(a,ins(a,'2026-06-12','2026-06-15'),'23P01'); // shared endpoint rejected
 await fails(a,ins(a,'2026-06-08','2026-06-08','planned','{"2026-06-08":0.5}'),'23P01');
 await as(b,ins(b,'2026-06-08','2026-06-12')); // separate account
 await as(a,ins(a,'2026-06-13','2026-06-14')); // adjacent, no overlap
 await fails(child,ins(child,'2026-06-01','2026-06-01'));await fails(b,ins(a,'2026-07-01','2026-07-01'));
 assert.equal((await as(child,'select * from vacation_entries')).rows.length,3);
 assert.equal((await as(stranger,'select * from vacation_entries')).rows.length,0);
 assert.equal((await as(b,`update vacation_entries set status='cancelled' where id='${saved.id}' returning id`)).rows.length,0);
 await as(a,`update vacation_entries set title='Auf Gerät A bearbeitet' where id='${saved.id}'`);
 assert.equal((await as(b,`select title from vacation_entries where id='${saved.id}'`)).rows[0].title,'Auf Gerät A bearbeitet');
 await as(a,`update vacation_entries set status='cancelled' where id='${saved.id}'`);await as(a,ins(a,'2026-06-08','2026-06-12'));
 await fails(a,`update vacation_entries set status='planned' where id='${saved.id}'`,'23P01');
 assert.equal((await as(a,`update vacation_entries set title='stale' where id='${saved.id}' and updated_at='${saved.updated_at.toISOString()}' returning id`)).rows.length,0);
 await fails(a,ins(a,'2026-08-01','2026-08-02','planned','{"2026-08-03":0.5}'),'23514');
 await fails(a,ins(a,'2026-08-01','2026-08-02','planned','{"2026-08-01":1}'),'23514');
 await fails(a,ins(a,'2026-12-30','2027-01-05'),'23514');await as(a,acc(a,2027));
 await as(a,ins(a,'2026-12-30','2027-01-05','planned','{"2026-12-31":0.5}'));
 await fails(a,ins(a,'2026-10-03','2026-10-01'),'23514');
 await fails(a,`insert into vacation_entries(family_id,user_id,start_date,end_date,status) values('${other}','${a}','2026-09-01','2026-09-01','planned')`);
 await db.exec(sql);assert.equal((await as(a,'select annual_entitlement from vacation_accounts')).rows.length,3);
 await db.close();console.log('PASS: real PostgreSQL migration x3, no seeds, RLS adults/child/outsider, own-only writes, scoped directory, validation, atomic exclusion overlap, cancellation/re-activation, year crossing, stale writes.');
})().catch(e=>{console.error(e);process.exitCode=1;});
