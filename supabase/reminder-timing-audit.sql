-- Read-only. sent_at means accepted by at least one push provider, not displayed on Android.
select notification_type,notification_key,status,attempts,
  scheduled_for at time zone 'Europe/Berlin' as planned_berlin,
  sent_at at time zone 'Europe/Berlin' as provider_accepted_berlin,
  round(extract(epoch from(sent_at-scheduled_for)),3) as delay_seconds,last_error
from public.notification_deliveries
order by scheduled_for desc;

-- A succeeded cron row only confirms the SQL invocation, not the HTTP response.
with runs as (
  select jobid,start_time,status,
    lag(start_time) over(partition by jobid order by start_time) as previous
  from cron.job_run_details
  where jobid in(select jobid from cron.job where jobname='family-calendar-reminders')
)
select start_time at time zone 'Europe/Berlin' as started_berlin,status,
  extract(epoch from(start_time-previous)) as gap_seconds
from runs where start_time-previous>interval '90 seconds' or status<>'succeeded'
order by start_time desc;

-- Recent HTTP outcomes only. Do not print request headers or Vault material.
select id,created,status_code,timed_out,error_msg,content
from net._http_response order by id desc limit 20;
