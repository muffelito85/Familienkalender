-- Run in Supabase SQL Editor. Do not put service_role credentials in the app.
create extension if not exists pgcrypto;
create table if not exists public.families (
 id uuid primary key default gen_random_uuid(), name text not null
);
create table if not exists public.family_members (
 family_id uuid not null references public.families(id) on delete cascade,
 user_id uuid not null references auth.users(id) on delete cascade,
 primary key(family_id,user_id)
);
create table if not exists public.events (
 id uuid primary key default gen_random_uuid(),
 family_id uuid not null references public.families(id) on delete cascade,
 title text not null check(length(title) between 1 and 80),
 start date not null, "end" date not null,
 "allDay" boolean not null default false,
 st text not null default '', et text not null default '',
 ms text[] not null default '{}', rep text not null default 'none' check(rep in ('none','daily','weekly','monthly','yearly')),
 note text not null default '' check(length(note)<=200),
 created_at timestamptz not null default now(),
 check("end">=start)
);
create index if not exists events_family_start_idx on public.events(family_id,start);
create index if not exists family_members_user_idx on public.family_members(user_id);
alter table public.families enable row level security;
alter table public.family_members enable row level security;
alter table public.events enable row level security;
-- Membership lookup does not recurse through its own RLS policy.
create policy "members read own membership" on public.family_members for select to authenticated using (user_id=(select auth.uid()));
create policy "members read family" on public.families for select to authenticated using (
 exists(select 1 from public.family_members m where m.family_id=id and m.user_id=(select auth.uid()))
);
create policy "members read events" on public.events for select to authenticated using (
 exists(select 1 from public.family_members m where m.family_id=events.family_id and m.user_id=(select auth.uid()))
);
create policy "members insert events" on public.events for insert to authenticated with check (
 exists(select 1 from public.family_members m where m.family_id=events.family_id and m.user_id=(select auth.uid()))
);
create policy "members update events" on public.events for update to authenticated using (
 exists(select 1 from public.family_members m where m.family_id=events.family_id and m.user_id=(select auth.uid()))
) with check (
 exists(select 1 from public.family_members m where m.family_id=events.family_id and m.user_id=(select auth.uid()))
);
create policy "members delete events" on public.events for delete to authenticated using (
 exists(select 1 from public.family_members m where m.family_id=events.family_id and m.user_id=(select auth.uid()))
);
-- Initial family. Run once; use this UUID in config.js.
insert into public.families(id,name) values ('11111111-1111-4111-8111-111111111111','Familie') on conflict (id) do nothing;
-- Enable Realtime events via Supabase dashboard > Database > Publications > supabase_realtime.
-- Add users AFTER registration from SQL editor, one at a time:
-- insert into public.family_members(family_id,user_id) values ('11111111-1111-4111-8111-111111111111','USER_UUID_FROM_AUTH_USERS');
