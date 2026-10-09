-- Together 3.6: private date photos. No existing dates are rewritten.
begin;
alter table public.important_dates add column if not exists photo_path text;
create or replace function public.validate_date_photo() returns trigger
language plpgsql security invoker set search_path=public as $$
begin
  if new.photo_path is not null and (tg_op='INSERT' or new.photo_path is distinct from old.photo_path or new.couple_id is distinct from old.couple_id) then
    if split_part(new.photo_path,'/',1)<>new.couple_id::text
      or new.photo_path like '%..%' or length(new.photo_path)>1024
      or not exists(select 1 from storage.objects o where o.bucket_id='couple-media' and o.name=new.photo_path)
      or not (split_part(new.photo_path,'/',3)='dates' or exists(select 1 from public.memories m where m.couple_id=new.couple_id and m.kind='image' and m.media_path=new.photo_path)) then
      raise exception 'Choose a photo from your shared album or upload a date photo';
    end if;
  end if;
  return new;
end $$;
drop trigger if exists validate_date_photo on public.important_dates;
create trigger validate_date_photo before insert or update of photo_path,couple_id on public.important_dates for each row execute function public.validate_date_photo();
create index if not exists important_dates_photo_idx on public.important_dates(photo_path) where photo_path is not null;
-- Removing an album entry clears its date-photo references, not the dates themselves.
create or replace function public.prune_date_album_photos() returns trigger
language plpgsql security invoker set search_path=public as $$
begin
  update public.important_dates d set photo_path=null
  where exists(select 1 from removed_date_memories m where m.couple_id=d.couple_id and m.media_path=d.photo_path);
  return null;
end $$;
drop trigger if exists prune_date_album_photos on public.memories;
create trigger prune_date_album_photos after delete on public.memories referencing old table as removed_date_memories for each statement execute function public.prune_date_album_photos();
notify pgrst,'reload schema';
commit;
