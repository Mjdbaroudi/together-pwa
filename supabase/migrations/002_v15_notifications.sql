-- Together v1.5 - secure partner push lookup
-- Run once in Supabase SQL Editor after the original Together schema.

create or replace function public.get_partner_push_subscriptions()
returns table(endpoint text, p256dh text, auth text)
language sql
stable
security definer
set search_path=public
as $$
  with my_pair as (
    select case when c.user_a = auth.uid() then c.user_b else c.user_a end as partner_id
    from public.couples c
    where auth.uid() in (c.user_a, c.user_b)
      and c.user_b is not null
    limit 1
  )
  select ps.endpoint, ps.p256dh, ps.auth
  from public.push_subscriptions ps
  join my_pair p on p.partner_id = ps.user_id;
$$;

revoke all on function public.get_partner_push_subscriptions() from public;
grant execute on function public.get_partner_push_subscriptions() to authenticated;

select 'Together v1.5 notifications database ready' as status;
