-- Permit repeat registration/refresh without allowing ownership transfers.
-- Existing SELECT/INSERT/DELETE policies and device rows are preserved.
drop policy if exists "Users update own push subscriptions" on public.push_subscriptions;
create policy "Users update own push subscriptions" on public.push_subscriptions
for update to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);
