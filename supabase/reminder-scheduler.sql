-- Infrastructure only: family records, existing RLS and delivery claims stay intact.
create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;

-- Generate/rotate in Postgres. The random key is never returned or sent over HTTP.
do $setup$
declare secret_id uuid;
begin
  select id into secret_id from vault.secrets where name='family_reminder_scheduler_token';
  if secret_id is null then
    perform vault.create_secret(encode(extensions.gen_random_bytes(32),'hex'),
      'family_reminder_scheduler_token','Internal HMAC key for Familienkalender reminders');
  else
    perform vault.update_secret(secret_id,encode(extensions.gen_random_bytes(32),'hex'),
      'family_reminder_scheduler_token','Internal HMAC key for Familienkalender reminders');
  end if;
end;
$setup$;

-- Only the trusted Edge Function service client may verify a request.
-- The signature binds mode and timestamp; max clock skew/request lifetime is 90 seconds.
create or replace function public.verify_family_reminder_scheduler_request(
  p_mode text,p_timestamp text,p_signature text
)
returns boolean language sql stable security definer set search_path=''
as $function$
  select case
    when p_mode in ('dry-run','run') and p_timestamp ~ '^[0-9]{10,11}$'
      and p_signature ~ '^[0-9a-f]{64}$'
    then abs(extract(epoch from now())::bigint-p_timestamp::bigint)<=90
      and exists (
        select 1 from vault.decrypted_secrets
        where name='family_reminder_scheduler_token'
          and encode(extensions.hmac(p_timestamp||':'||p_mode,decrypted_secret,'sha256'),'hex')=p_signature
      )
    else false
  end;
$function$;
revoke all on function public.verify_family_reminder_scheduler_request(text,text,text) from public,anon,authenticated;
grant execute on function public.verify_family_reminder_scheduler_request(text,text,text) to service_role;

create schema if not exists family_reminder_internal;
revoke all on schema family_reminder_internal from public,anon,authenticated;
grant usage on schema family_reminder_internal to service_role;
create or replace function family_reminder_internal.invoke(p_mode text default 'run')
returns bigint language plpgsql security invoker set search_path=''
as $function$
declare
  key_value text;
  timestamp_value text;
  signature_value text;
  request_id bigint;
begin
  if p_mode not in ('dry-run','run') or p_mode is null then
    raise exception 'Unsupported scheduler mode';
  end if;
  select decrypted_secret into strict key_value
    from vault.decrypted_secrets where name='family_reminder_scheduler_token';
  timestamp_value := extract(epoch from now())::bigint::text;
  signature_value := encode(extensions.hmac(timestamp_value||':'||p_mode,key_value,'sha256'),'hex');
  select net.http_post(
    url := 'https://hhkbjccwwawulngnwmae.supabase.co/functions/v1/dynamic-api',
    headers := jsonb_build_object('Content-Type','application/json',
      'x-reminder-timestamp',timestamp_value,'x-reminder-signature',signature_value),
    body := jsonb_build_object('mode',p_mode),timeout_milliseconds := 20000
  ) into request_id;
  return request_id;
end;
$function$;
revoke all on function family_reminder_internal.invoke(text) from public,anon,authenticated;
grant execute on function family_reminder_internal.invoke(text) to service_role;

drop function if exists public.verify_family_reminder_scheduler_token(text);
-- Enable the recurring job only after deploying and checking a successful dry run.
