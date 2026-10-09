-- Together v1.6 - shared story photo for the real Home screen

alter table public.couples
  add column if not exists cover_media_path text;

-- Existing RLS policy still restricts updates to members of the pair.
-- The original setup revoked broad UPDATE and granted selected columns, so add only this field.
grant update(cover_media_path) on public.couples to authenticated;

select 'Together v1.6 Home story database ready' as status;
