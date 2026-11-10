-- Phase 1 additive migration. Existing tables and events remain unchanged.
begin;
create table if not exists public.tasks (
 id uuid primary key default gen_random_uuid(), family_id uuid not null references public.families(id) on delete cascade,
 title text not null check (length(btrim(title)) between 1 and 160), details text not null default '',
 assigned_to text check (assigned_to in ('daniel','caro','lara','mila')), due_date date,
 completed boolean not null default false, created_at timestamptz not null default now()
);
create table if not exists public.shopping_items (
 id uuid primary key default gen_random_uuid(), family_id uuid not null references public.families(id) on delete cascade,
 title text not null check (length(btrim(title)) between 1 and 160), quantity text not null default '',
 completed boolean not null default false, created_at timestamptz not null default now()
);
create table if not exists public.anniversaries (
 id uuid primary key default gen_random_uuid(), family_id uuid not null references public.families(id) on delete cascade,
 title text not null check (length(btrim(title)) between 1 and 160), kind text not null check (kind in ('birthday','anniversary')),
 event_date date not null, note text not null default '', created_at timestamptz not null default now()
);
create table if not exists public.user_preferences (
 family_id uuid not null references public.families(id) on delete cascade,
 user_id uuid not null references auth.users(id) on delete cascade,
 theme text not null default 'system' check (theme in ('system','light','dark')),
 accent_color text not null default '#d9622b' check (accent_color ~ '^#[0-9a-fA-F]{6}$'),
 member_colors jsonb not null default '{}'::jsonb check (jsonb_typeof(member_colors)='object'),
 primary key (family_id,user_id)
);
create index if not exists tasks_family_idx on public.tasks(family_id);
create index if not exists shopping_family_idx on public.shopping_items(family_id);
create index if not exists anniversaries_family_idx on public.anniversaries(family_id);
alter table public.tasks enable row level security;
alter table public.shopping_items enable row level security;
alter table public.anniversaries enable row level security;
alter table public.user_preferences enable row level security;
-- Run only once: policy names intentionally fixed.
do $$
declare t text;
begin
 foreach t in array array['tasks','shopping_items','anniversaries'] loop
  execute format('create policy %I on public.%I for select to authenticated using (exists (select 1 from public.family_members m where m.family_id = %3$I.family_id and m.user_id = (select auth.uid())))',t||'_read',t,t);
  execute format('create policy %I on public.%I for insert to authenticated with check (exists (select 1 from public.family_members m where m.family_id = %3$I.family_id and m.user_id = (select auth.uid())))',t||'_add',t,t);
  execute format('create policy %I on public.%I for update to authenticated using (exists (select 1 from public.family_members m where m.family_id = %3$I.family_id and m.user_id = (select auth.uid()))) with check (exists (select 1 from public.family_members m where m.family_id = %3$I.family_id and m.user_id = (select auth.uid())))',t||'_edit',t,t);
  execute format('create policy %I on public.%I for delete to authenticated using (exists (select 1 from public.family_members m where m.family_id = %3$I.family_id and m.user_id = (select auth.uid())))',t||'_remove',t,t);
 end loop;
end $$;
create policy preferences_read on public.user_preferences for select to authenticated using (user_id=(select auth.uid()) and exists(select 1 from public.family_members m where m.family_id=user_preferences.family_id and m.user_id=(select auth.uid())));
create policy preferences_add on public.user_preferences for insert to authenticated with check (user_id=(select auth.uid()) and exists(select 1 from public.family_members m where m.family_id=user_preferences.family_id and m.user_id=(select auth.uid())));
create policy preferences_edit on public.user_preferences for update to authenticated using (user_id=(select auth.uid()) and exists(select 1 from public.family_members m where m.family_id=user_preferences.family_id and m.user_id=(select auth.uid()))) with check (user_id=(select auth.uid()) and exists(select 1 from public.family_members m where m.family_id=user_preferences.family_id and m.user_id=(select auth.uid())));
commit;
