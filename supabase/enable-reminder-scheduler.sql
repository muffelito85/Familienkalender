-- Run after deploying the function and verifying an HTTP 200 dry-run response.
select cron.schedule(
  'family-calendar-reminders',
  '* * * * *',
  $job$select family_reminder_internal.invoke('run');$job$
);
