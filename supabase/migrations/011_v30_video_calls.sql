-- Together v3.0 video calls. Apply after 001-010, with no live call running.
-- Media is never stored: only the call kind and existing event snapshots.
begin;
alter table public.voice_calls add column if not exists media_kind text not null default 'audio';
alter table public.voice_calls drop constraint if exists voice_calls_media_kind_check;
alter table public.voice_calls add constraint voice_calls_media_kind_check check(media_kind in('audio','video'));
create or replace function public.start_media_call(p_couple uuid,p_id uuid,p_device uuid,p_kind text)
returns public.voice_calls language plpgsql security definer set search_path=public as $$
declare pair public.couples; call public.voice_calls; partner uuid;
begin
  if p_kind is null or p_kind not in('audio','video') then raise exception 'Invalid call media kind'; end if;
  if auth.uid() is null or p_device is null or p_id is null then raise exception 'Unauthorized'; end if;
  select * into pair from public.couples where id=p_couple and auth.uid() in(user_a,user_b) for update;
  if pair.id is null or pair.user_b is null then raise exception 'Pair your accounts before calling'; end if;
  partner:=case when pair.user_a=auth.uid() then pair.user_b else pair.user_a end;
  perform public.expire_voice_calls(p_couple);
  select * into call from public.voice_calls where id=p_id;
  if call.id is not null then
    if call.caller_id=auth.uid() and call.caller_device=p_device and call.couple_id=p_couple and call.media_kind=p_kind then return call; end if;
    raise exception 'Unauthorized';
  end if;
  if exists(select 1 from public.voice_calls where couple_id=p_couple and state in('ringing','accepted','active')) then raise exception 'A call is already in progress'; end if;
  if (select count(*) from public.voice_calls where couple_id=p_couple and created_at>now()-interval '1 minute')>=5 then raise exception 'Please wait a minute before calling again'; end if;
  delete from public.voice_calls where couple_id=p_couple and ended_at<now()-interval '30 days';
  insert into public.voice_calls(id,couple_id,caller_id,callee_id,caller_device,media_kind) values(p_id,p_couple,auth.uid(),partner,p_device,p_kind) returning * into call;
  return call;
end $$;


revoke all on function public.start_media_call(uuid,uuid,uuid,text) from public,anon,authenticated;
create or replace function public.start_voice_call(p_couple uuid,p_id uuid,p_device uuid)
returns public.voice_calls language sql security definer set search_path=public as $$
  select public.start_media_call(p_couple,p_id,p_device,'audio');
$$;
create or replace function public.start_video_call(p_couple uuid,p_id uuid,p_device uuid)
returns public.voice_calls language sql security definer set search_path=public as $$
  select public.start_media_call(p_couple,p_id,p_device,'video');
$$;
revoke all on function public.start_voice_call(uuid,uuid,uuid),public.start_video_call(uuid,uuid,uuid) from public,anon;
grant execute on function public.start_voice_call(uuid,uuid,uuid),public.start_video_call(uuid,uuid,uuid) to authenticated;
create or replace function public.write_voice_call_message(p_call public.voice_calls)
returns uuid language plpgsql security definer set search_path=public as $$
declare v_message uuid; v_kind text:=case when p_call.media_kind='video' then 'Video' else 'Voice' end;
begin
  insert into public.messages(couple_id,sender_id,type,body,created_at,call_id,call_summary)
  values(p_call.couple_id,p_call.caller_id,'call',
    case p_call.state when 'ringing' then v_kind||' call' when 'active' then v_kind||' call in progress'
    when 'missed' then 'Missed '||lower(v_kind)||' call' when 'declined' then 'Declined '||lower(v_kind)||' call'
    when 'cancelled' then 'Cancelled '||lower(v_kind)||' call' when 'failed' then 'Disconnected '||lower(v_kind)||' call'
    when 'accepted' then 'Connecting '||lower(v_kind)||' call' else v_kind||' call ended' end,
    p_call.created_at,p_call.id,jsonb_build_object(
      'id',p_call.id,'couple_id',p_call.couple_id,'caller_id',p_call.caller_id,'callee_id',p_call.callee_id,
      'media_kind',p_call.media_kind,'state',p_call.state,'created_at',p_call.created_at,'accepted_at',p_call.accepted_at,
      'started_at',p_call.started_at,'ended_at',p_call.ended_at,'updated_at',clock_timestamp()))
  on conflict(call_id) do update set body=excluded.body,call_summary=excluded.call_summary
  returning id into v_message;
  return v_message;
end; $$;
revoke all on function public.write_voice_call_message(public.voice_calls) from public,authenticated,anon;

-- Retain original event dates and outcome while adding the explicit kind.
update public.messages m set call_summary=m.call_summary||jsonb_build_object('media_kind',coalesce(c.media_kind,'audio'))
from public.voice_calls c where m.type='call' and m.call_summary->>'id'=c.id::text
  and (m.call_summary->>'media_kind') is distinct from c.media_kind;
update public.messages set call_summary=call_summary||'{"media_kind":"audio"}'::jsonb
where type='call' and not(call_summary ? 'media_kind');
notify pgrst, 'reload schema';
commit;
select 'Together v3.0 video calls ready' as status;
