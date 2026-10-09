-- Apply after 015. Foreground message suppression happens before Web Push delivery.
begin;
create table if not exists public.push_chat_sessions (
  endpoint text not null references public.push_subscriptions(endpoint) on delete cascade,
  client_id uuid not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  reading boolean not null default false,
  sequence bigint not null,
  updated_at timestamptz not null default clock_timestamp(),
  primary key(endpoint,client_id)
);
create index if not exists push_chat_sessions_user on public.push_chat_sessions(user_id,updated_at);
alter table public.push_chat_sessions enable row level security;
revoke all on public.push_chat_sessions from public,anon,authenticated;

create or replace function public.touch_push_chat(p_endpoint text,p_client uuid,p_reading boolean,p_sequence bigint)
returns void language plpgsql security definer set search_path=public as $$
declare v_now timestamptz:=clock_timestamp(); v_old public.push_chat_sessions;
begin
  if auth.uid() is null or p_client is null or p_reading is null or p_sequence is null or p_sequence<1 or p_sequence>9007199254740991
    or not exists(select 1 from public.push_subscriptions s where s.endpoint=p_endpoint and s.user_id=auth.uid()) then raise exception 'Unauthorized'; end if;
  select * into v_old from public.push_chat_sessions where endpoint=p_endpoint and client_id=p_client;
  if v_old.client_id is not null and v_old.user_id<>auth.uid() then raise exception 'Unauthorized'; end if;
  delete from public.push_chat_sessions where user_id=auth.uid() and updated_at<v_now-interval '2 minutes';
  if v_old.client_id is null and (select count(*) from public.push_chat_sessions where user_id=auth.uid())>=100 then raise exception 'Too many chat sessions'; end if;
  insert into public.push_chat_sessions(endpoint,client_id,user_id,reading,sequence,updated_at)
    values(p_endpoint,p_client,auth.uid(),p_reading,p_sequence,v_now)
    on conflict(endpoint,client_id) do update set reading=excluded.reading,sequence=excluded.sequence,updated_at=excluded.updated_at
    where public.push_chat_sessions.user_id=auth.uid() and public.push_chat_sessions.sequence<excluded.sequence;
end; $$;
revoke all on function public.touch_push_chat(text,uuid,boolean,bigint) from public,anon;
grant execute on function public.touch_push_chat(text,uuid,boolean,bigint) to authenticated;

-- Keep old sender clients compatible while filtering only the reading device.
create or replace function public.get_partner_push_subscriptions()
returns table(endpoint text,p256dh text,auth text)
language sql stable security definer set search_path=public as $$
  with my_pair as (
    select case when c.user_a=auth.uid() then c.user_b else c.user_a end partner_id
    from public.couples c where auth.uid() in(c.user_a,c.user_b) and c.user_b is not null limit 1
  )
  select ps.endpoint,ps.p256dh,ps.auth from public.push_subscriptions ps join my_pair p on p.partner_id=ps.user_id
  where not exists(select 1 from public.push_chat_sessions s where s.endpoint=ps.endpoint and s.user_id=ps.user_id
    and s.reading and s.updated_at>statement_timestamp()-interval '20 seconds');
$$;
revoke all on function public.get_partner_push_subscriptions() from public,anon;
grant execute on function public.get_partner_push_subscriptions() to authenticated;

-- New clients also bind the push to a real, still-unread message from this sender.
create or replace function public.get_message_push_subscriptions(p_message uuid)
returns table(endpoint text,p256dh text,auth text)
language plpgsql stable security definer set search_path=public as $$
declare v_message public.messages; v_partner uuid;
begin
  if auth.uid() is null then raise exception 'Unauthorized'; end if;
  select m.* into v_message from public.messages m join public.couples c on c.id=m.couple_id
    where m.id=p_message and m.sender_id=auth.uid() and auth.uid() in(c.user_a,c.user_b);
  if v_message.id is null then raise exception 'Unauthorized'; end if;
  select case when c.user_a=auth.uid() then c.user_b else c.user_a end into v_partner from public.couples c where c.id=v_message.couple_id;
  if v_partner is null or v_message.deleted_at is not null or v_message.type='call'
    or exists(select 1 from public.message_reads r where r.message_id=p_message and r.user_id=v_partner) then return; end if;
  return query select ps.endpoint,ps.p256dh,ps.auth from public.push_subscriptions ps where ps.user_id=v_partner
    and not exists(select 1 from public.push_chat_sessions s where s.endpoint=ps.endpoint and s.user_id=ps.user_id
      and s.reading and s.updated_at>statement_timestamp()-interval '20 seconds');
end; $$;
revoke all on function public.get_message_push_subscriptions(uuid) from public,anon;
grant execute on function public.get_message_push_subscriptions(uuid) to authenticated;
notify pgrst,'reload schema';
commit;
select 'Together 3.6.4 foreground message notifications ready' as status;
