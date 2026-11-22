begin;
create schema if not exists extensions;
create extension if not exists btree_gist with schema extensions;
set local search_path=public,extensions,pg_catalog;
create schema if not exists vacation_internal;
revoke all on schema vacation_internal from public;

create table if not exists public.vacation_accounts (
 id uuid primary key default gen_random_uuid(),
 family_id uuid not null references public.families(id),
 user_id uuid not null references auth.users(id),
 year integer not null check(year between 2025 and 2100),
 annual_entitlement numeric(5,1) not null check(annual_entitlement between 0 and 366 and mod(annual_entitlement,0.5)=0),
 carryover_days numeric(5,1) not null default 0 check(carryover_days between 0 and 366 and mod(carryover_days,0.5)=0),
 workweek smallint[] not null check(cardinality(workweek) between 1 and 7 and workweek <@ array[1,2,3,4,5,6,7]::smallint[]),
 work_location jsonb not null,
 created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
 unique(family_id,user_id,year),
 foreign key(family_id,user_id) references public.family_members(family_id,user_id)
);
create table if not exists public.vacation_entries (
 id uuid primary key default gen_random_uuid(),
 family_id uuid not null references public.families(id),user_id uuid not null references auth.users(id),
 start_date date not null,end_date date not null,
 status text not null check(status in ('planned','taken','cancelled')),
 title text not null default '' check(length(title)<=120),note text not null default '' check(length(note)<=2000),
 half_day_information jsonb not null default '{}'::jsonb,
 created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
 check(end_date>=start_date and end_date-start_date<=730),
 check(start_date>='2025-01-01' and end_date<='2100-12-31'),
 foreign key(family_id,user_id) references public.family_members(family_id,user_id),
 constraint vacation_entries_no_overlap exclude using gist
 (family_id with =,user_id with =,daterange(start_date,end_date,'[]') with &&)
 where (status<>'cancelled')
);
create index if not exists vacation_accounts_user_id_idx on public.vacation_accounts(user_id);
create index if not exists vacation_entries_family_dates_idx on public.vacation_entries(family_id,start_date,end_date);
create index if not exists vacation_entries_user_id_idx on public.vacation_entries(user_id);

create or replace function vacation_internal.validate_write() returns trigger
language plpgsql security invoker set search_path='' as $$
declare item record; d date; y integer;
begin
 if tg_op='UPDATE' and (new.family_id<>old.family_id or new.user_id<>old.user_id or new.id<>old.id or new.created_at<>old.created_at) then
  raise exception 'Urlaub kann nicht auf eine andere Person oder Familie übertragen werden.' using errcode='23514';
 end if;
 if not exists(select 1 from public.family_members m where m.family_id=new.family_id and m.user_id=new.user_id and m.role in ('admin','adult')) then
  raise exception 'Urlaubskonten sind nur für erwachsene Familienmitglieder vorgesehen.' using errcode='23514';
 end if;
 if tg_table_name='vacation_accounts' then
  if tg_op='UPDATE' and new.year<>old.year then raise exception 'Das Kontojahr kann nicht verschoben werden.' using errcode='23514';end if;
  if cardinality(new.workweek)<>(select count(distinct x) from unnest(new.workweek) x) or array_position(new.workweek,null) is not null then
   raise exception 'Arbeitstage müssen eindeutig sein.' using errcode='23514';
  end if;
  if jsonb_typeof(new.work_location)<>'object' or not coalesce(new.work_location->>'state'=any(array['BW','BY','BE','BB','HB','HH','HE','MV','NI','NW','RP','SL','SN','ST','SH','TH']),false) then
   raise exception 'Bundesland am Arbeitsort fehlt.' using errcode='23514';
  end if;
  for item in select key,value from jsonb_each(new.work_location) loop
   if item.key in ('assumption','augsburg','corpus_christi') and jsonb_typeof(item.value)<>'boolean' then raise exception 'Regionale Feiertagsauswahl ungültig.' using errcode='23514';end if;
   if item.key not in ('state','assumption','augsburg','corpus_christi','additional_holidays') then raise exception 'Unbekannte Arbeitsortangabe.' using errcode='23514';end if;
  end loop;
  if new.work_location ? 'additional_holidays' then
   if jsonb_typeof(new.work_location->'additional_holidays')<>'array' then raise exception 'Freie Tage müssen eine Liste sein.' using errcode='23514';end if;
   for item in select value #>> '{}' as value from jsonb_array_elements(new.work_location->'additional_holidays') loop
    if item.value is null or item.value !~ '^\d{4}-\d{2}-\d{2}$' then raise exception 'Ungültiges Feiertagsdatum.' using errcode='23514';end if;
    d:=item.value::date;
    if d::text<>item.value or extract(year from d)<>new.year then raise exception 'Zusätzliche freie Tage müssen im Kontojahr liegen.' using errcode='23514';end if;
   end loop;
  end if;
 else
  if new.status<>'cancelled' then
   for y in extract(year from new.start_date)::integer..extract(year from new.end_date)::integer loop
    if not exists(select 1 from public.vacation_accounts a where a.family_id=new.family_id and a.user_id=new.user_id and a.year=y) then
     raise exception 'Urlaubskonto für % fehlt.',y using errcode='23514';
    end if;
   end loop;
  end if;
  if jsonb_typeof(new.half_day_information)<>'object' then raise exception 'Halbe Tage müssen nach Datum angegeben werden.' using errcode='23514';end if;
  for item in select key,value from jsonb_each(new.half_day_information) loop
   d:=item.key::date;
   if d::text<>item.key or d<new.start_date or d>new.end_date or item.value<>'0.5'::jsonb then
    raise exception 'Halbe Tage sind nur innerhalb des Urlaubszeitraums zulässig.' using errcode='23514';
   end if;
  end loop;
 end if;
 new.updated_at:=clock_timestamp();return new;
end; $$;
revoke all on function vacation_internal.validate_write() from public,anon,authenticated;
-- Existing family_members RLS exposes only the caller's own row. A narrow directory
-- grants same-family display of adult identities, never auth emails or balances.
create or replace function vacation_internal.family_people(p_family_id uuid)
returns table(user_id uuid,role text,display_name text)
language sql stable security definer set search_path='' as $$
 select m.user_id,m.role,case m.role when 'admin' then 'Dani' else 'Caro' end
 from public.family_members m
 where m.family_id=p_family_id and m.role in ('admin','adult')
 and (select auth.uid()) is not null
 and exists(select 1 from public.family_members caller where caller.family_id=p_family_id and caller.user_id=(select auth.uid()));
$$;
revoke all on function vacation_internal.family_people(uuid) from public,anon;
grant usage on schema vacation_internal to authenticated;
grant execute on function vacation_internal.family_people(uuid) to authenticated;
create or replace function public.vacation_family_people(p_family_id uuid)
returns table(user_id uuid,role text,display_name text)
language sql stable security invoker set search_path='' as $$select * from vacation_internal.family_people(p_family_id);$$;
revoke all on function public.vacation_family_people(uuid) from public,anon;
grant execute on function public.vacation_family_people(uuid) to authenticated;
drop trigger if exists vacation_accounts_validate on public.vacation_accounts;
create trigger vacation_accounts_validate before insert or update on public.vacation_accounts for each row execute function vacation_internal.validate_write();
drop trigger if exists vacation_entries_validate on public.vacation_entries;
create trigger vacation_entries_validate before insert or update on public.vacation_entries for each row execute function vacation_internal.validate_write();

alter table public.vacation_accounts enable row level security;
alter table public.vacation_entries enable row level security;
revoke all on public.vacation_accounts,public.vacation_entries from anon;
grant select,insert,update,delete on public.vacation_accounts,public.vacation_entries to authenticated;

drop policy if exists vacation_accounts_read on public.vacation_accounts;
create policy vacation_accounts_read on public.vacation_accounts for select to authenticated using (
 exists(select 1 from public.family_members m where m.family_id=vacation_accounts.family_id and m.user_id=(select auth.uid()) and m.role in ('admin','adult')));
drop policy if exists vacation_accounts_insert on public.vacation_accounts;
create policy vacation_accounts_insert on public.vacation_accounts for insert to authenticated with check (
 user_id=(select auth.uid()) and exists(select 1 from public.family_members m where m.family_id=vacation_accounts.family_id and m.user_id=(select auth.uid()) and m.role in ('admin','adult')));
drop policy if exists vacation_accounts_update on public.vacation_accounts;
create policy vacation_accounts_update on public.vacation_accounts for update to authenticated using (
 user_id=(select auth.uid()) and exists(select 1 from public.family_members m where m.family_id=vacation_accounts.family_id and m.user_id=(select auth.uid()) and m.role in ('admin','adult')))
 with check(user_id=(select auth.uid()) and exists(select 1 from public.family_members m where m.family_id=vacation_accounts.family_id and m.user_id=(select auth.uid()) and m.role in ('admin','adult')));
drop policy if exists vacation_accounts_delete on public.vacation_accounts;
create policy vacation_accounts_delete on public.vacation_accounts for delete to authenticated using (
 user_id=(select auth.uid()) and exists(select 1 from public.family_members m where m.family_id=vacation_accounts.family_id and m.user_id=(select auth.uid()) and m.role in ('admin','adult'))
 and not exists(select 1 from public.vacation_entries e where e.family_id=vacation_accounts.family_id and e.user_id=vacation_accounts.user_id and e.status<>'cancelled' and e.start_date<=make_date(vacation_accounts.year,12,31) and e.end_date>=make_date(vacation_accounts.year,1,1)));
drop policy if exists vacation_entries_read on public.vacation_entries;
create policy vacation_entries_read on public.vacation_entries for select to authenticated using (
 exists(select 1 from public.family_members m where m.family_id=vacation_entries.family_id and m.user_id=(select auth.uid())));
drop policy if exists vacation_entries_insert on public.vacation_entries;
create policy vacation_entries_insert on public.vacation_entries for insert to authenticated with check (
 user_id=(select auth.uid()) and exists(select 1 from public.family_members m where m.family_id=vacation_entries.family_id and m.user_id=(select auth.uid()) and m.role in ('admin','adult')));
drop policy if exists vacation_entries_update on public.vacation_entries;
create policy vacation_entries_update on public.vacation_entries for update to authenticated using (
 user_id=(select auth.uid()) and exists(select 1 from public.family_members m where m.family_id=vacation_entries.family_id and m.user_id=(select auth.uid()) and m.role in ('admin','adult')))
 with check(user_id=(select auth.uid()) and exists(select 1 from public.family_members m where m.family_id=vacation_entries.family_id and m.user_id=(select auth.uid()) and m.role in ('admin','adult')));
drop policy if exists vacation_entries_delete on public.vacation_entries;
create policy vacation_entries_delete on public.vacation_entries for delete to authenticated using (
 user_id=(select auth.uid()) and exists(select 1 from public.family_members m where m.family_id=vacation_entries.family_id and m.user_id=(select auth.uid()) and m.role in ('admin','adult')));

-- Realtime honors SELECT policies. Accounts are never readable by children.
do $$ declare t text;begin
 if exists(select 1 from pg_publication where pubname='supabase_realtime') then
  foreach t in array array['vacation_accounts','vacation_entries'] loop
   if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename=t) then
    execute format('alter publication supabase_realtime add table public.%I',t);
   end if;
  end loop;
 end if;
end $$;
commit;
