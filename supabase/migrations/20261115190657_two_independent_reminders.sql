-- Additive migration. No rows, first reminders, delivery keys or RLS policies are removed.
alter table public.events add column if not exists reminder2_minutes integer default null;
alter table public.tasks add column if not exists reminder_minutes integer default null;
alter table public.tasks add column if not exists reminder2_minutes integer default null;

-- Mark ONLY rows present when each compatibility column is first added.
-- Re-running the migration must not reactivate a notification the user disabled.
do $compatibility$
begin
  if not exists(select 1 from pg_attribute where attrelid='public.events'::regclass
    and attname='legacy_due_notification' and not attisdropped) then
    alter table public.events add column legacy_due_notification boolean not null default false;
    update public.events set legacy_due_notification=true
      where "allDay" and reminder_minutes is null and reminder2_minutes is null;
  end if;
  if not exists(select 1 from pg_attribute where attrelid='public.tasks'::regclass
    and attname='legacy_due_notification' and not attisdropped) then
    alter table public.tasks add column legacy_due_notification boolean not null default false;
    update public.tasks set legacy_due_notification=true
      where reminder_minutes is null and reminder2_minutes is null;
  end if;
end;
$compatibility$;

-- The old events check does not allow 30 minutes; extend it without changing stored values.
alter table public.events drop constraint if exists events_reminder_minutes_check;
alter table public.events add constraint events_reminder_minutes_check
  check(reminder_minutes is null or reminder_minutes in (15,30,60,1440,10080));
alter table public.events drop constraint if exists events_reminder2_minutes_check;
alter table public.events add constraint events_reminder2_minutes_check
  check(reminder2_minutes is null or reminder2_minutes in (15,30,60,1440,10080));
alter table public.tasks drop constraint if exists tasks_reminder_minutes_check;
alter table public.tasks add constraint tasks_reminder_minutes_check
  check(reminder_minutes is null or reminder_minutes in (15,30,60,1440,10080));
alter table public.tasks drop constraint if exists tasks_reminder2_minutes_check;
alter table public.tasks add constraint tasks_reminder2_minutes_check
  check(reminder2_minutes is null or reminder2_minutes in (15,30,60,1440,10080));

comment on column public.events.reminder2_minutes is 'Optional independent second reminder; NULL means disabled.';
comment on column public.tasks.reminder_minutes is 'Optional first reminder; NULL means disabled.';
comment on column public.tasks.reminder2_minutes is 'Optional independent second reminder; NULL means disabled.';
comment on column public.events.legacy_due_notification is 'Preserves pre-migration automatic 09:00 notifications only when both reminders are NULL.';
comment on column public.tasks.legacy_due_notification is 'Preserves pre-migration due notifications only when both reminders are NULL. New rows default to false.';
