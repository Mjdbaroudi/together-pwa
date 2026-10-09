-- Together v2.0 Chat Pro — real delivered receipts
-- Safe to run more than once.

create table if not exists public.message_deliveries (
  message_id uuid not null references public.messages(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  delivered_at timestamptz not null default now(),
  primary key(message_id,user_id)
);

alter table public.message_deliveries enable row level security;

drop policy if exists deliveries_select_pair on public.message_deliveries;
create policy deliveries_select_pair on public.message_deliveries
for select to authenticated
using (public.is_message_member(message_id));

drop policy if exists deliveries_insert_self on public.message_deliveries;
create policy deliveries_insert_self on public.message_deliveries
for insert to authenticated
with check (user_id=auth.uid() and public.is_message_member(message_id));

drop policy if exists deliveries_update_self on public.message_deliveries;
create policy deliveries_update_self on public.message_deliveries
for update to authenticated
using (user_id=auth.uid() and public.is_message_member(message_id))
with check (user_id=auth.uid() and public.is_message_member(message_id));

grant select, insert, update on public.message_deliveries to authenticated;

alter table public.message_deliveries replica identity full;

do $$ begin
  alter publication supabase_realtime add table public.message_deliveries;
exception when duplicate_object then null; end $$;

select 'Together v2.0 Chat Pro database ready' as status;
