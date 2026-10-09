-- Together v2.2 Chat Experience — soft delete, per-user hide, message info support.
-- Safe to run more than once.

alter table public.messages
  add column if not exists deleted_at timestamptz,
  add column if not exists deleted_by uuid references auth.users(id) on delete set null;

create table if not exists public.message_hides (
  message_id uuid not null references public.messages(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  hidden_at timestamptz not null default now(),
  primary key(message_id,user_id)
);

alter table public.message_hides enable row level security;

drop policy if exists message_hides_select_self on public.message_hides;
create policy message_hides_select_self on public.message_hides
for select to authenticated using (user_id=auth.uid());

drop policy if exists message_hides_insert_self on public.message_hides;
create policy message_hides_insert_self on public.message_hides
for insert to authenticated
with check (user_id=auth.uid() and public.is_message_member(message_id));

drop policy if exists message_hides_delete_self on public.message_hides;
create policy message_hides_delete_self on public.message_hides
for delete to authenticated using (user_id=auth.uid());

grant select, insert, delete on public.message_hides to authenticated;

create or replace function public.hide_message_for_me(p_message uuid)
returns void language plpgsql security definer set search_path=public as $$
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  if not public.is_message_member(p_message) then raise exception 'Message not found or access denied'; end if;
  insert into public.message_hides(message_id,user_id)
  values(p_message,auth.uid())
  on conflict(message_id,user_id) do nothing;
end;
$$;
revoke all on function public.hide_message_for_me(uuid) from public;
grant execute on function public.hide_message_for_me(uuid) to authenticated;

create or replace function public.delete_message_for_everyone(p_message uuid)
returns void language plpgsql security definer set search_path=public as $$
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  update public.messages m
     set body=null,
         media_path=null,
         duration_seconds=null,
         edited_at=null,
         deleted_at=now(),
         deleted_by=auth.uid()
   where m.id=p_message
     and m.sender_id=auth.uid()
     and public.is_couple_member(m.couple_id)
     and m.deleted_at is null;
  if not found then raise exception 'Only the sender can delete this message for everyone'; end if;
end;
$$;
revoke all on function public.delete_message_for_everyone(uuid) from public;
grant execute on function public.delete_message_for_everyone(uuid) to authenticated;

alter table public.message_hides replica identity full;
do $$ begin
  alter publication supabase_realtime add table public.message_hides;
exception when duplicate_object then null; end $$;

select 'Together v2.2 Chat Experience database ready' as status;
