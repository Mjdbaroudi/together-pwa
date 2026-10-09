-- Together v2.8: private audio-call signaling. No audio is stored here.
begin;

create table if not exists public.voice_calls (
  id uuid primary key,
  couple_id uuid not null references public.couples(id) on delete cascade,
  caller_id uuid not null references auth.users(id) on delete cascade,
  callee_id uuid not null references auth.users(id) on delete cascade,
  caller_device uuid not null,
  callee_device uuid,
  state text not null default 'ringing' check (state in ('ringing','accepted','active','ended','declined','cancelled','missed','failed')),
  created_at timestamptz not null default now(),
  accepted_at timestamptz,
  started_at timestamptz,
  ended_at timestamptz,
  caller_ping timestamptz not null default now(),
  callee_ping timestamptz,
  notified_at timestamptz,
  check (caller_id <> callee_id)
);
create unique index if not exists voice_one_active_pair on public.voice_calls(couple_id) where state in ('ringing','accepted','active');
create index if not exists voice_history_pair on public.voice_calls(couple_id,created_at desc);

create table if not exists public.voice_call_signals (
  seq bigint generated always as identity unique,
  id uuid primary key,
  call_id uuid not null references public.voice_calls(id) on delete cascade,
  sender_id uuid not null references auth.users(id) on delete cascade,
  kind text not null check (kind in ('description','candidate')),
  payload jsonb not null,
  created_at timestamptz not null default now(),
  check (octet_length(payload::text) <= 65536)
);
create index if not exists voice_signals_call_seq on public.voice_call_signals(call_id,seq);
alter table public.voice_calls enable row level security;
alter table public.voice_call_signals enable row level security;
revoke all on public.voice_calls, public.voice_call_signals from anon, authenticated;
grant select on public.voice_calls, public.voice_call_signals to authenticated;
drop policy if exists voice_calls_pair on public.voice_calls;
create policy voice_calls_pair on public.voice_calls for select to authenticated
  using (auth.uid() in (caller_id,callee_id) and public.is_couple_member(couple_id));
drop policy if exists voice_signals_pair on public.voice_call_signals;
create policy voice_signals_pair on public.voice_call_signals for select to authenticated
  using (exists(select 1 from public.voice_calls c where c.id=call_id and auth.uid() in(c.caller_id,c.callee_id) and public.is_couple_member(c.couple_id)));

create or replace function public.expire_voice_calls(p_couple uuid)
returns void language plpgsql security definer set search_path=public as $$
begin
  update public.voice_calls set state=case when state='ringing' then 'missed' else 'failed' end,ended_at=now()
  where couple_id=p_couple and state in('ringing','accepted','active') and (
    (state='ringing' and created_at < now()-interval '45 seconds') or
    (state='accepted' and accepted_at < now()-interval '45 seconds') or
    (state='active' and (caller_ping < now()-interval '60 seconds' or callee_ping < now()-interval '60 seconds')) or
    (accepted_at is not null and accepted_at < now()-interval '2 hours')
  );
end $$;
revoke all on function public.expire_voice_calls(uuid) from public,anon,authenticated;

create or replace function public.clean_voice_signals()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  if new.state not in('ringing','accepted','active') then delete from public.voice_call_signals where call_id=new.id; end if;
  return new;
end $$;
revoke all on function public.clean_voice_signals() from public,anon,authenticated;
drop trigger if exists clean_finished_voice_signals on public.voice_calls;
create trigger clean_finished_voice_signals after update of state on public.voice_calls for each row execute function public.clean_voice_signals();

create or replace function public.start_voice_call(p_couple uuid,p_id uuid,p_device uuid)
returns public.voice_calls language plpgsql security definer set search_path=public as $$
declare pair public.couples; call public.voice_calls; partner uuid;
begin
  if auth.uid() is null or p_device is null or p_id is null then raise exception 'Unauthorized'; end if;
  select * into pair from public.couples where id=p_couple and auth.uid() in(user_a,user_b) for update;
  if pair.id is null or pair.user_b is null then raise exception 'Pair your accounts before calling'; end if;
  partner:=case when pair.user_a=auth.uid() then pair.user_b else pair.user_a end;
  perform public.expire_voice_calls(p_couple);
  select * into call from public.voice_calls where id=p_id;
  if call.id is not null then
    if call.caller_id=auth.uid() and call.caller_device=p_device and call.couple_id=p_couple then return call; end if;
    raise exception 'Unauthorized';
  end if;
  if exists(select 1 from public.voice_calls where couple_id=p_couple and state in('ringing','accepted','active')) then raise exception 'A call is already in progress'; end if;
  if (select count(*) from public.voice_calls where couple_id=p_couple and created_at>now()-interval '1 minute')>=5 then raise exception 'Please wait a minute before calling again'; end if;
  delete from public.voice_calls where couple_id=p_couple and ended_at<now()-interval '30 days';
  insert into public.voice_calls(id,couple_id,caller_id,callee_id,caller_device) values(p_id,p_couple,auth.uid(),partner,p_device) returning * into call;
  return call;
end $$;

create or replace function public.current_voice_call(p_couple uuid)
returns public.voice_calls language plpgsql security definer set search_path=public as $$
declare call public.voice_calls;
begin
  if auth.uid() is null or not public.is_couple_member(p_couple) then raise exception 'Unauthorized'; end if;
  perform public.expire_voice_calls(p_couple);
  select * into call from public.voice_calls where couple_id=p_couple and auth.uid() in(caller_id,callee_id) and state in('ringing','accepted','active') order by created_at desc limit 1;
  return call;
end $$;

create or replace function public.control_voice_call(p_call uuid,p_device uuid,p_action text)
returns public.voice_calls language plpgsql security definer set search_path=public as $$
declare call public.voice_calls; own_device uuid;
begin
  select * into call from public.voice_calls where id=p_call and auth.uid() in(caller_id,callee_id) and public.is_couple_member(couple_id) for update;
  if call.id is null or p_device is null then raise exception 'Unauthorized'; end if;
  perform public.expire_voice_calls(call.couple_id);
  select * into call from public.voice_calls where id=p_call;
  if call.state not in('ringing','accepted','active') then return call; end if;
  own_device:=case when auth.uid()=call.caller_id then call.caller_device else call.callee_device end;
  if p_action='accept' then
    if auth.uid()<>call.callee_id then raise exception 'Only the recipient can answer'; end if;
    if call.state<>'ringing' then
      if call.callee_device=p_device then return call; end if;
      raise exception 'This call was answered on another device';
    end if;
    update public.voice_calls set state='accepted',callee_device=p_device,accepted_at=now(),callee_ping=now() where id=p_call;
  elsif p_action='decline' then
    if auth.uid()<>call.callee_id or call.state<>'ringing' then raise exception 'Cannot decline this call'; end if;
    update public.voice_calls set state='declined',ended_at=now() where id=p_call;
  elsif p_action in('ping','connected','end','fail') then
    if p_action='end' and auth.uid()=call.callee_id and call.state='ringing' then
      update public.voice_calls set state='declined',ended_at=now() where id=p_call returning * into call;
      return call;
    end if;
    if own_device is distinct from p_device then raise exception 'This call belongs to another device'; end if;
    if p_action='ping' then
      if auth.uid()=call.caller_id then update public.voice_calls set caller_ping=now() where id=p_call;
      else update public.voice_calls set callee_ping=now() where id=p_call; end if;
    elsif p_action='connected' then
      if call.state not in('accepted','active') then raise exception 'Answer the call first'; end if;
      update public.voice_calls set state='active',started_at=coalesce(started_at,now()) where id=p_call;
    else
      update public.voice_calls set state=case when p_action='fail' then 'failed' when state='ringing' then 'cancelled' else 'ended' end,ended_at=now() where id=p_call;
    end if;
  else raise exception 'Invalid call action'; end if;
  select * into call from public.voice_calls where id=p_call;
  return call;
end $$;

create or replace function public.send_voice_signal(p_call uuid,p_device uuid,p_id uuid,p_kind text,p_payload jsonb)
returns bigint language plpgsql security definer set search_path=public as $$
declare call public.voice_calls; n bigint; own_device uuid;
begin
  select * into call from public.voice_calls where id=p_call and auth.uid() in(caller_id,callee_id) and public.is_couple_member(couple_id) for update;
  if call.id is null then raise exception 'Unauthorized'; end if;
  own_device:=case when auth.uid()=call.caller_id then call.caller_device else call.callee_device end;
  if own_device is distinct from p_device or call.state not in('accepted','active') then raise exception 'Call is not available on this device'; end if;
  if p_id is null or p_payload is null or jsonb_typeof(p_payload)<>'object' or octet_length(p_payload::text)>65536 then raise exception 'Invalid signal'; end if;
  if p_kind='description' then
    if coalesce(p_payload->>'type','') not in('offer','answer') or coalesce(length(p_payload->>'sdp'),0)=0 then raise exception 'Invalid description'; end if;
  elsif p_kind='candidate' then
    if coalesce(length(p_payload->>'candidate'),0)=0 or length(p_payload->>'candidate')>4096 then raise exception 'Invalid candidate'; end if;
  else raise exception 'Invalid signal kind'; end if;
  select seq into n from public.voice_call_signals where id=p_id and call_id=p_call and sender_id=auth.uid();
  if n is not null then return n; end if;
  if (select count(*) from public.voice_call_signals where call_id=p_call)>=600 then raise exception 'Too many signals'; end if;
  insert into public.voice_call_signals(id,call_id,sender_id,kind,payload) values(p_id,p_call,auth.uid(),p_kind,p_payload) returning seq into n;
  return n;
end $$;

create or replace function public.claim_voice_call_push(p_call uuid,p_device uuid)
returns table(endpoint text,p256dh text,auth text) language plpgsql security definer set search_path=public as $$
declare call public.voice_calls;
begin
  select * into call from public.voice_calls where id=p_call and caller_id=auth.uid() and caller_device=p_device and public.is_couple_member(couple_id) for update;
  if call.id is null then raise exception 'Unauthorized'; end if;
  if call.state<>'ringing' or call.created_at<now()-interval '45 seconds' or call.notified_at is not null then return; end if;
  update public.voice_calls set notified_at=now() where id=p_call;
  return query select ps.endpoint,ps.p256dh,ps.auth from public.push_subscriptions ps where ps.user_id=call.callee_id;
end $$;

revoke all on function public.start_voice_call(uuid,uuid,uuid),public.current_voice_call(uuid),public.control_voice_call(uuid,uuid,text),public.send_voice_signal(uuid,uuid,uuid,text,jsonb),public.claim_voice_call_push(uuid,uuid) from public,anon;
grant execute on function public.start_voice_call(uuid,uuid,uuid),public.current_voice_call(uuid),public.control_voice_call(uuid,uuid,text),public.send_voice_signal(uuid,uuid,uuid,text,jsonb),public.claim_voice_call_push(uuid,uuid) to authenticated;

do $$ begin
  if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='voice_calls') then alter publication supabase_realtime add table public.voice_calls; end if;
  if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='voice_call_signals') then alter publication supabase_realtime add table public.voice_call_signals; end if;
end $$;
notify pgrst,'reload schema';
commit;
