-- Together v3.1.1: preserve unknown last seen instead of inventing the reader's current time.
-- Apply after 012. Safe to repeat; existing activity, messages and profiles are unchanged.
begin;
create or replace function public.read_app_presence(p_couple uuid default null)
returns table(user_id uuid,last_seen timestamptz,online boolean,valid_until timestamptz,server_now timestamptz)
language plpgsql security definer set search_path=public as $$
declare v_pair public.couples; v_now timestamptz:=clock_timestamp();
begin
  if auth.uid() is null then raise exception 'Unauthorized'; end if;
  if p_couple is not null then
    select * into v_pair from public.couples where id=p_couple and auth.uid() in(user_a,user_b);
    if v_pair.id is null then raise exception 'Unauthorized'; end if;
  end if;
  return query select p.user_id,coalesce(a.last_seen,case when p.last_seen is not null then least(p.last_seen,v_now) end),s.deadline is not null,s.deadline,v_now
    from public.profiles p left join public.app_presence a on a.user_id=p.user_id
    left join lateral (select max(d.touched_at+interval '75 seconds') as deadline from public.app_presence_sessions d
      where d.user_id=p.user_id and d.active and d.touched_at>v_now-interval '75 seconds') s on true
    where p.user_id=auth.uid() or (p_couple is not null and p.user_id in(v_pair.user_a,v_pair.user_b));
end; $$;
revoke all on function public.read_app_presence(uuid) from public,anon;
grant execute on function public.read_app_presence(uuid) to authenticated;
notify pgrst,'reload schema';
commit;
select 'Together v3.1.1 last seen corrected' as status;
