-- Together v2.9: one server-owned chat event per voice call.
-- Apply after 009. Historical snapshots survive signaling-session cleanup.
begin;
alter table public.messages add column if not exists call_id uuid references public.voice_calls(id) on delete set null;
alter table public.messages add column if not exists call_summary jsonb;
alter table public.messages drop constraint if exists messages_type_check;
alter table public.messages add constraint messages_type_check check(type in('text','image','voice','video','system','call'));
create unique index if not exists messages_call_id_unique on public.messages(call_id);
create unique index if not exists messages_call_snapshot_unique on public.messages((call_summary->>'id')) where type='call';
create index if not exists messages_call_history on public.messages(couple_id,created_at desc,id desc) where type='call';
alter table public.messages drop constraint if exists messages_call_shape;
alter table public.messages add constraint messages_call_shape check (
  (type<>'call' and call_id is null and call_summary is null) or
  (type='call' and call_summary is not null and jsonb_typeof(call_summary)='object'
   and call_summary ?& array['id','caller_id','callee_id','state','created_at','updated_at']
   and call_summary->>'caller_id'=sender_id::text
   and call_summary->>'state' in('ringing','accepted','active','ended','declined','cancelled','missed','failed')
   and octet_length(call_summary::text)<4096)
);

-- Clients can send ordinary messages; call snapshots are written only by the trigger.
drop policy if exists messages_insert_sender on public.messages;
create policy messages_insert_sender on public.messages for insert to authenticated
with check(sender_id=auth.uid() and public.is_couple_member(couple_id) and type<>'call' and call_id is null and call_summary is null);
drop policy if exists messages_update_sender on public.messages;
create policy messages_update_sender on public.messages for update to authenticated
using(sender_id=auth.uid() and public.is_couple_member(couple_id) and type<>'call')
with check(sender_id=auth.uid() and public.is_couple_member(couple_id) and type<>'call' and call_id is null and call_summary is null);
drop policy if exists messages_delete_sender on public.messages;
create policy messages_delete_sender on public.messages for delete to authenticated
using(sender_id=auth.uid() and public.is_couple_member(couple_id) and type<>'call');

create or replace function public.write_voice_call_message(p_call public.voice_calls)
returns uuid language plpgsql security definer set search_path=public as $$
declare v_message uuid;
begin
  insert into public.messages(couple_id,sender_id,type,body,created_at,call_id,call_summary)
  values(p_call.couple_id,p_call.caller_id,'call',
    case p_call.state when 'ringing' then 'Voice call' when 'active' then 'Voice call in progress'
    when 'missed' then 'Missed voice call' when 'declined' then 'Declined voice call'
    when 'cancelled' then 'Cancelled voice call' when 'failed' then 'Disconnected voice call'
    when 'accepted' then 'Connecting voice call' else 'Voice call ended' end,
    p_call.created_at,p_call.id,jsonb_build_object(
      'id',p_call.id,'couple_id',p_call.couple_id,'caller_id',p_call.caller_id,'callee_id',p_call.callee_id,
      'state',p_call.state,'created_at',p_call.created_at,'accepted_at',p_call.accepted_at,
      'started_at',p_call.started_at,'ended_at',p_call.ended_at,'updated_at',clock_timestamp()))
  on conflict(call_id) do update set body=excluded.body,call_summary=excluded.call_summary
  returning id into v_message;
  return v_message;
end; $$;
revoke all on function public.write_voice_call_message(public.voice_calls) from public,authenticated,anon;
create or replace function public.sync_voice_call_message()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  if TG_OP='UPDATE' then
    if row(NEW.state,NEW.accepted_at,NEW.started_at,NEW.ended_at)
      is not distinct from row(OLD.state,OLD.accepted_at,OLD.started_at,OLD.ended_at) then return NEW; end if;
  end if;
  perform public.write_voice_call_message(NEW);
  return NEW;
end; $$;
revoke all on function public.sync_voice_call_message() from public,authenticated,anon;
drop trigger if exists voice_call_message_sync on public.voice_calls;
create trigger voice_call_message_sync after insert or update of state,accepted_at,started_at,ended_at
on public.voice_calls for each row execute function public.sync_voice_call_message();

-- Restore retained v2.8 calls without flooding either member's unread counter.
do $$ declare c public.voice_calls; m uuid; begin
  for c in select * from public.voice_calls order by created_at,id loop
    if not exists(select 1 from public.messages where call_summary->>'id'=c.id::text and type='call') then
      m:=public.write_voice_call_message(c);
      if c.state not in('ringing','accepted','active') then
        insert into public.message_reads(message_id,user_id) values(m,c.caller_id),(m,c.callee_id)
        on conflict(message_id,user_id) do nothing;
      end if;
    end if;
  end loop;
end $$;

-- Existing privileged editing RPCs must also respect server-owned call events.
create or replace function public.delete_message_for_everyone(p_message uuid)
returns void language plpgsql security definer set search_path=public as $$
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  update public.messages m set body=null,media_path=null,duration_seconds=null,edited_at=null,deleted_at=now(),deleted_by=auth.uid()
  where m.id=p_message and m.sender_id=auth.uid() and public.is_couple_member(m.couple_id)
    and m.deleted_at is null and m.type<>'call';
  if not found then raise exception 'Only the sender can delete an ordinary message for everyone'; end if;
end; $$;
revoke all on function public.delete_message_for_everyone(uuid) from public;
grant execute on function public.delete_message_for_everyone(uuid) to authenticated;
create or replace function public.set_message_pin(p_message uuid,p_pinned boolean)
returns void language plpgsql security definer set search_path=public as $$
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  update public.messages m set pinned=p_pinned where m.id=p_message and public.is_couple_member(m.couple_id) and m.type<>'call';
  if not found then raise exception 'Message not found or access denied'; end if;
end; $$;
revoke all on function public.set_message_pin(uuid,boolean) from public;
grant execute on function public.set_message_pin(uuid,boolean) to authenticated;

create or replace function public.voice_call_history(p_couple uuid,p_filter text default 'all',p_before timestamptz default null,p_before_id uuid default null,p_limit integer default 31)
returns table(message_id uuid,call_summary jsonb,created_at timestamptz)
language sql stable security invoker set search_path=public as $$
  select m.id,m.call_summary,m.created_at from public.messages m
  where auth.uid() is not null and public.is_couple_member(p_couple) and m.couple_id=p_couple and m.type='call' and m.deleted_at is null
    and not exists(select 1 from public.message_hides h where h.message_id=m.id and h.user_id=auth.uid())
    and (p_before is null or (m.created_at,m.id)<(p_before,p_before_id))
    and (p_filter='all' or (p_filter='missed' and m.call_summary->>'callee_id'=auth.uid()::text and m.call_summary->>'state'='missed')
      or (p_filter='incoming' and m.call_summary->>'callee_id'=auth.uid()::text)
      or (p_filter='outgoing' and m.call_summary->>'caller_id'=auth.uid()::text))
  order by m.created_at desc,m.id desc limit greatest(1,least(coalesce(p_limit,31),101));
$$;
revoke all on function public.voice_call_history(uuid,text,timestamptz,uuid,integer) from public;
grant execute on function public.voice_call_history(uuid,text,timestamptz,uuid,integer) to authenticated;
commit;
select 'Together v2.9 call journal ready' as status;
