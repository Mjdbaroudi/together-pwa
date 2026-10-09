-- Together v3.1: server-clock last activity and foreground leases per device.
-- Apply after 001-011. No messages, media or existing profiles are deleted.
begin;
create table if not exists public.app_presence (
  user_id uuid primary key references auth.users(id) on delete cascade,
  last_seen timestamptz not null
);
create table if not exists public.app_presence_sessions (
  session_id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  active boolean not null,
  touched_at timestamptz not null,
  sequence bigint not null check(sequence>0)
);
create index if not exists app_presence_sessions_user on public.app_presence_sessions(user_id,touched_at);
alter table public.app_presence enable row level security;
alter table public.app_presence_sessions enable row level security;
revoke all on public.app_presence,public.app_presence_sessions from anon,authenticated;
grant select on public.app_presence to authenticated;
drop policy if exists app_presence_pair on public.app_presence;
create policy app_presence_pair on public.app_presence for select to authenticated
  using(user_id=auth.uid() or public.shares_couple(user_id));
insert into public.app_presence(user_id,last_seen)
  select user_id,least(last_seen,clock_timestamp()) from public.profiles where last_seen is not null
  on conflict(user_id) do nothing;

create or replace function public.touch_app_presence(p_session uuid,p_visible boolean,p_sequence bigint)
returns timestamptz language plpgsql security definer set search_path=public as $$
declare v_old public.app_presence_sessions; v_now timestamptz:=clock_timestamp(); v_seen timestamptz;
begin
  if auth.uid() is null or p_session is null or p_visible is null or p_sequence is null or p_sequence<=0 or p_sequence>9007199254740991 then raise exception 'Unauthorized presence request'; end if;
  perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text,0));
  v_now:=clock_timestamp();
  select * into v_old from public.app_presence_sessions where session_id=p_session for update;
  if v_old.session_id is not null and v_old.user_id<>auth.uid() then raise exception 'This session belongs to another user'; end if;
  if v_old.session_id is not null and p_sequence<=v_old.sequence then
    select last_seen into v_seen from public.app_presence where user_id=auth.uid(); return v_seen;
  end if;
  delete from public.app_presence_sessions where user_id=auth.uid() and touched_at<v_now-interval '1 day';
  if v_old.session_id is null and (select count(*) from public.app_presence_sessions where user_id=auth.uid())>=100 then raise exception 'Too many presence sessions'; end if;
  insert into public.app_presence_sessions(session_id,user_id,active,touched_at,sequence)
    values(p_session,auth.uid(),p_visible,v_now,p_sequence)
    on conflict(session_id) do update set active=excluded.active,touched_at=excluded.touched_at,sequence=excluded.sequence
    where public.app_presence_sessions.user_id=auth.uid() and public.app_presence_sessions.sequence<excluded.sequence;
  if not found then select last_seen into v_seen from public.app_presence where user_id=auth.uid(); return v_seen; end if;
  if p_visible or coalesce(v_old.active,false) then
    insert into public.app_presence(user_id,last_seen) values(auth.uid(),v_now)
      on conflict(user_id) do update set last_seen=greatest(public.app_presence.last_seen,excluded.last_seen);
  end if;
  select last_seen into v_seen from public.app_presence where user_id=auth.uid(); return v_seen;
end; $$;
revoke all on function public.touch_app_presence(uuid,boolean,bigint) from public,anon;
grant execute on function public.touch_app_presence(uuid,boolean,bigint) to authenticated;

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
do $$ begin
  alter publication supabase_realtime add table public.app_presence;
exception when duplicate_object then null; end $$;
notify pgrst,'reload schema';
commit;
select 'Together v3.1 last seen ready' as status;
