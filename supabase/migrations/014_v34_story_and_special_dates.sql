-- Together 3.4: shared daily covers and date-only milestones. Existing data stays intact.
begin;
alter table public.couples add column if not exists story_cover_mode text;
alter table public.couples add column if not exists story_cover_memory_ids uuid[] not null default '{}';
alter table public.couples add column if not exists story_cover_paths text[] not null default '{}';
-- Preserve an explicitly uploaded legacy cover on first installation only.
update public.couples set story_cover_mode=case when cover_media_path is null then 'memories' else 'fixed' end where story_cover_mode is null;
alter table public.couples alter column story_cover_mode set default 'memories';
alter table public.couples alter column story_cover_mode set not null;
alter table public.couples drop constraint if exists story_cover_options_check;
alter table public.couples add constraint story_cover_options_check check(story_cover_mode in ('fixed','memories','selected') and cardinality(story_cover_memory_ids)<=60 and cardinality(story_cover_paths)<=20);
grant update(story_cover_mode,story_cover_memory_ids,story_cover_paths) on public.couples to authenticated;

create or replace function public.validate_story_cover_settings() returns trigger language plpgsql security invoker set search_path=public as $$
declare p text;
begin
  if exists(select 1 from unnest(new.story_cover_memory_ids) x(id) where not exists(select 1 from public.memories m where m.id=x.id and m.couple_id=new.id and m.kind='image')) then
    raise exception 'Choose photos from your own shared album';
  end if;
  if new.story_cover_paths is distinct from old.story_cover_paths then
  foreach p in array new.story_cover_paths loop
    if split_part(p,'/',1)<>new.id::text or split_part(p,'/',3)<>'story' or p like '%..%' or not exists(select 1 from storage.objects o where o.bucket_id='couple-media' and o.name=p) then
      raise exception 'Invalid shared cover photo';
    end if;
  end loop;
  end if;
  return new;
end $$;
drop trigger if exists validate_story_cover_settings on public.couples;
create trigger validate_story_cover_settings before update of story_cover_memory_ids,story_cover_paths on public.couples for each row execute function public.validate_story_cover_settings();
create or replace function public.prune_deleted_story_memory() returns trigger language plpgsql security invoker set search_path=public as $$
begin
  update public.couples c set story_cover_memory_ids=array(select x.id from unnest(c.story_cover_memory_ids) with ordinality x(id,ord) join public.memories m on m.id=x.id and m.couple_id=c.id order by x.ord) where c.id=old.couple_id and old.id=any(c.story_cover_memory_ids);
  return old;
end $$;
drop trigger if exists prune_deleted_story_memory on public.memories;
create trigger prune_deleted_story_memory after delete on public.memories for each row execute function public.prune_deleted_story_memory();

-- Select one path server-side: all album photos, not merely the loaded page.
create or replace function public.story_cover_for_day(p_couple_id uuid,p_day date default ((now() at time zone 'UTC')::date))
returns table(media_path text) language sql stable security invoker set search_path=public as $$
  with pair as (select * from public.couples where id=p_couple_id and public.is_couple_member(id)),
  candidates as (
    select m.media_path, row_number() over(order by m.created_at,m.id)::bigint rank from public.memories m join pair c on m.couple_id=c.id where c.story_cover_mode='memories' and m.kind='image'
    union all
    select m.media_path, x.ordinality::bigint from pair c cross join lateral unnest(c.story_cover_memory_ids) with ordinality x(id,ordinality) join public.memories m on m.id=x.id and m.couple_id=c.id and m.kind='image' where c.story_cover_mode='selected'
    union all
    select x.path, (60+x.ordinality)::bigint from pair c cross join lateral unnest(c.story_cover_paths) with ordinality x(path,ordinality) where c.story_cover_mode='selected'
    union all
    select c.cover_media_path,0::bigint from pair c where c.story_cover_mode='fixed' and c.cover_media_path is not null
  ), ordered as (select candidates.media_path,row_number() over(order by rank,candidates.media_path)-1 idx,count(*) over() total from candidates)
  select ordered.media_path from ordered where idx=(((p_day-date '2024-01-01')::bigint % total)+total)%total
  union all
  select c.cover_media_path from pair c where not exists(select 1 from candidates) and c.cover_media_path is not null
  limit 1;
$$;
revoke all on function public.story_cover_for_day(uuid,date) from public,anon;
grant execute on function public.story_cover_for_day(uuid,date) to authenticated;

alter table public.important_dates add column if not exists local_date date;
alter table public.important_dates add column if not exists repeats_yearly boolean not null default false;
alter table public.important_dates add column if not exists special_type text;
alter table public.important_dates drop constraint if exists special_date_options_check;
alter table public.important_dates add constraint special_date_options_check check(special_type is null or (special_type in ('engagement','wedding','first_meeting','birthday','other') and local_date is not null and kind in ('milestone','anniversary')));
create index if not exists special_dates_pair_day_idx on public.important_dates(couple_id,local_date) where special_type is not null;
notify pgrst,'reload schema';
commit;
