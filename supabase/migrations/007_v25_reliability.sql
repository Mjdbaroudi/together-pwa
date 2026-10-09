-- Together v2.5. Repeatable, additive update. Run AFTER 001 through 006.
begin;
drop policy if exists push_insert_self on public.push_subscriptions;
create policy push_insert_self on public.push_subscriptions for insert to authenticated with check (user_id=auth.uid());
drop policy if exists push_update_self on public.push_subscriptions;
create policy push_update_self on public.push_subscriptions for update to authenticated using (user_id=auth.uid()) with check (user_id=auth.uid());
grant select,insert,update,delete on public.push_subscriptions to authenticated;

alter table public.messages drop constraint if exists messages_type_check;
alter table public.messages add constraint messages_type_check check (type in ('text','image','voice','video','system'));
update storage.buckets set allowed_mime_types=array['image/jpeg','image/png','image/webp','image/heic','image/heif','audio/webm','audio/mp4','audio/mpeg','audio/ogg','video/mp4','video/webm','video/quicktime'] where id='couple-media';

create or replace function public.count_unread_messages(p_couple uuid)
returns bigint language sql stable security invoker set search_path=public as $$
  select count(*) from public.messages m where m.couple_id=p_couple and public.is_couple_member(p_couple)
  and m.sender_id<>auth.uid() and m.deleted_at is null
  and not exists(select 1 from public.message_reads r where r.message_id=m.id and r.user_id=auth.uid())
  and not exists(select 1 from public.message_hides h where h.message_id=m.id and h.user_id=auth.uid());
$$;
revoke all on function public.count_unread_messages(uuid) from public;
grant execute on function public.count_unread_messages(uuid) to authenticated;

create or replace function public.validate_message_reply()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  if new.reply_to=new.id then raise exception 'A message cannot reply to itself'; end if;
  if new.reply_to is not null and not exists(select 1 from public.messages m where m.id=new.reply_to and m.couple_id=new.couple_id and m.deleted_at is null) then
    raise exception 'Reply target is unavailable in this conversation';
  end if;
  return new;
end; $$;
drop trigger if exists validate_message_reply on public.messages;
create trigger validate_message_reply before insert or update of reply_to,couple_id on public.messages for each row execute function public.validate_message_reply();

create or replace function public.redact_deleted_reply_snapshots()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  update public.messages set reply_snapshot=jsonb_build_object('id',old.id,'body','Deleted message','kind','system')
  where couple_id=old.couple_id and (reply_to=old.id or reply_snapshot->>'id'=old.id::text);
  return old;
end; $$;
drop trigger if exists redact_deleted_reply_snapshots on public.messages;
create trigger redact_deleted_reply_snapshots before delete on public.messages for each row execute function public.redact_deleted_reply_snapshots();

create or replace function public.redact_soft_deleted_reply_snapshots()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  if old.deleted_at is null and new.deleted_at is not null then
    update public.messages set reply_snapshot=jsonb_build_object('id',new.id,'body','Deleted message','kind','system')
    where couple_id=new.couple_id and (reply_to=new.id or reply_snapshot->>'id'=new.id::text);
  end if;
  return new;
end; $$;
drop trigger if exists redact_soft_deleted_reply_snapshots on public.messages;
create trigger redact_soft_deleted_reply_snapshots after update of deleted_at on public.messages for each row execute function public.redact_soft_deleted_reply_snapshots();

drop policy if exists reads_update_self on public.message_reads;
create policy reads_update_self on public.message_reads for update to authenticated using (user_id=auth.uid() and public.is_message_member(message_id)) with check (user_id=auth.uid() and public.is_message_member(message_id));
drop policy if exists reactions_update_self on public.reactions;
create policy reactions_update_self on public.reactions for update to authenticated using (user_id=auth.uid() and public.is_message_member(message_id)) with check (user_id=auth.uid() and public.is_message_member(message_id));

update public.messages reply set reply_snapshot=jsonb_build_object('id',original.id,'body','Deleted message','kind','system')
from public.messages original where original.deleted_at is not null and reply.couple_id=original.couple_id
and (reply.reply_to=original.id or reply.reply_snapshot->>'id'=original.id::text);

create index if not exists messages_pair_cursor_idx on public.messages(couple_id,created_at desc,id desc);
create index if not exists memories_pair_cursor_idx on public.memories(couple_id,created_at desc,id desc);
notify pgrst,'reload schema';
commit;
