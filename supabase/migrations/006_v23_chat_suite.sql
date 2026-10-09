-- Together v2.3 Chat Suite — per-user starred messages.
-- Safe to run more than once.

create table if not exists public.message_stars (
  message_id uuid not null references public.messages(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  starred_at timestamptz not null default now(),
  primary key(message_id,user_id)
);

alter table public.message_stars enable row level security;

drop policy if exists message_stars_select_self on public.message_stars;
create policy message_stars_select_self on public.message_stars
for select to authenticated
using (user_id=auth.uid() and public.is_message_member(message_id));

drop policy if exists message_stars_insert_self on public.message_stars;
create policy message_stars_insert_self on public.message_stars
for insert to authenticated
with check (user_id=auth.uid() and public.is_message_member(message_id));

drop policy if exists message_stars_delete_self on public.message_stars;
create policy message_stars_delete_self on public.message_stars
for delete to authenticated
using (user_id=auth.uid() and public.is_message_member(message_id));

grant select, insert, delete on public.message_stars to authenticated;

alter table public.message_stars replica identity full;
do $$ begin
  alter publication supabase_realtime add table public.message_stars;
exception when duplicate_object then null; end $$;

select 'Together v2.3 Chat Suite database ready' as status;
