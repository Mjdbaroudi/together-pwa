-- Together PWA — two-person private schema
create extension if not exists pgcrypto;

create table if not exists public.profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null default 'User',
  nickname text,
  avatar_url text,
  last_seen timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.couples (
  id uuid primary key default gen_random_uuid(),
  user_a uuid not null references auth.users(id) on delete cascade,
  user_b uuid references auth.users(id) on delete cascade,
  invite_code text not null unique,
  anniversary_date date,
  theme text not null default 'rose',
  created_at timestamptz not null default now(),
  constraint only_two_different_users check (user_b is null or user_b <> user_a)
);

create unique index if not exists couples_user_a_unique on public.couples(user_a);
create unique index if not exists couples_user_b_unique on public.couples(user_b) where user_b is not null;


-- Automatically create a profile from Auth metadata.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  insert into public.profiles(user_id, display_name, nickname)
  values(new.id, coalesce(new.raw_user_meta_data->>'display_name', split_part(coalesce(new.email,'you'),'@',1)), coalesce(new.raw_user_meta_data->>'display_name', split_part(coalesce(new.email,'user'),'@',1)))
  on conflict(user_id) do nothing;
  return new;
end;
$$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users for each row execute procedure public.handle_new_user();

-- Enforce one and only one pair membership per account, even across user_a/user_b columns.
create or replace function public.enforce_single_pair()
returns trigger language plpgsql as $$
begin
  if exists(select 1 from public.couples c where c.id<>new.id and new.user_a in(c.user_a,c.user_b)) then
    raise exception 'First user is already paired';
  end if;
  if new.user_b is not null and exists(select 1 from public.couples c where c.id<>new.id and new.user_b in(c.user_a,c.user_b)) then
    raise exception 'Second user is already paired';
  end if;
  return new;
end;
$$;
drop trigger if exists enforce_single_pair_trigger on public.couples;
create trigger enforce_single_pair_trigger before insert or update of user_a,user_b on public.couples for each row execute procedure public.enforce_single_pair();

create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  couple_id uuid not null references public.couples(id) on delete cascade,
  sender_id uuid not null references auth.users(id) on delete cascade,
  type text not null check (type in ('text','image','voice','system')),
  body text,
  media_path text,
  media_url text,
  duration_seconds integer,
  reply_to uuid references public.messages(id) on delete set null,
  reply_snapshot jsonb,
  pinned boolean not null default false,
  edited_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists messages_couple_created_idx on public.messages(couple_id, created_at desc);

create table if not exists public.message_reads (
  message_id uuid not null references public.messages(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  seen_at timestamptz not null default now(),
  primary key(message_id,user_id)
);

create table if not exists public.reactions (
  message_id uuid not null references public.messages(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  emoji text not null,
  created_at timestamptz not null default now(),
  primary key(message_id,user_id)
);

create table if not exists public.memories (
  id uuid primary key default gen_random_uuid(),
  couple_id uuid not null references public.couples(id) on delete cascade,
  media_path text not null,
  caption text,
  taken_at timestamptz,
  favorite boolean not null default false,
  kind text not null default 'image' check (kind in ('image','video')),
  created_by uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

create table if not exists public.important_dates (
  id uuid primary key default gen_random_uuid(),
  couple_id uuid not null references public.couples(id) on delete cascade,
  title text not null,
  date timestamptz not null,
  kind text not null default 'date' check (kind in ('milestone','date','trip','anniversary')),
  notes text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.push_subscriptions (
  endpoint text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  p256dh text not null,
  auth text not null,
  user_agent text,
  created_at timestamptz not null default now()
);

create or replace function public.is_couple_member(cid uuid)
returns boolean language sql stable security definer set search_path=public as $$
  select exists(select 1 from public.couples c where c.id=cid and auth.uid() in (c.user_a,c.user_b));
$$;

create or replace function public.is_message_member(mid uuid)
returns boolean language sql stable security definer set search_path=public as $$
  select exists(select 1 from public.messages m where m.id=mid and public.is_couple_member(m.couple_id));
$$;

create or replace function public.shares_couple(other_user uuid)
returns boolean language sql stable security definer set search_path=public as $$
  select exists(select 1 from public.couples c where auth.uid() in(c.user_a,c.user_b) and other_user in(c.user_a,c.user_b));
$$;

create or replace function public.join_couple(p_code text)
returns uuid language plpgsql security definer set search_path=public as $$
declare cid uuid;
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  if exists(select 1 from public.couples where auth.uid() in(user_a,user_b)) then raise exception 'This account is already paired'; end if;
  update public.couples
     set user_b=auth.uid()
   where invite_code=upper(trim(p_code)) and user_b is null and user_a<>auth.uid()
   returning id into cid;
  if cid is null then raise exception 'Invalid or already used pair code'; end if;
  return cid;
end;
$$;
revoke all on function public.join_couple(text) from public;
grant execute on function public.join_couple(text) to authenticated;


-- Allow either member to pin/unpin a shared message without granting permission to edit its content.
create or replace function public.set_message_pin(p_message uuid, p_pinned boolean)
returns void language plpgsql security definer set search_path=public as $$
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  update public.messages m
     set pinned=p_pinned
   where m.id=p_message and public.is_couple_member(m.couple_id);
  if not found then raise exception 'Message not found or access denied'; end if;
end;
$$;
revoke all on function public.set_message_pin(uuid,boolean) from public;
grant execute on function public.set_message_pin(uuid,boolean) to authenticated;

alter table public.profiles enable row level security;
alter table public.couples enable row level security;
alter table public.messages enable row level security;
alter table public.message_reads enable row level security;
alter table public.reactions enable row level security;
alter table public.memories enable row level security;
alter table public.important_dates enable row level security;
alter table public.push_subscriptions enable row level security;

drop policy if exists profiles_select_pair on public.profiles;
create policy profiles_select_pair on public.profiles for select to authenticated using (user_id=auth.uid() or public.shares_couple(user_id));
drop policy if exists profiles_insert_self on public.profiles;
create policy profiles_insert_self on public.profiles for insert to authenticated with check (user_id=auth.uid());
drop policy if exists profiles_update_self on public.profiles;
create policy profiles_update_self on public.profiles for update to authenticated using (user_id=auth.uid()) with check (user_id=auth.uid());

drop policy if exists couples_select_member on public.couples;
create policy couples_select_member on public.couples for select to authenticated using (auth.uid() in(user_a,user_b));
drop policy if exists couples_insert_creator on public.couples;
create policy couples_insert_creator on public.couples for insert to authenticated with check (user_a=auth.uid() and user_b is null);
drop policy if exists couples_update_member on public.couples;
create policy couples_update_member on public.couples for update to authenticated using (auth.uid() in(user_a,user_b)) with check (auth.uid() in(user_a,user_b));
revoke update on public.couples from authenticated;
grant update(theme, anniversary_date) on public.couples to authenticated;

drop policy if exists messages_select_pair on public.messages;
create policy messages_select_pair on public.messages for select to authenticated using (public.is_couple_member(couple_id));
drop policy if exists messages_insert_sender on public.messages;
create policy messages_insert_sender on public.messages for insert to authenticated with check (sender_id=auth.uid() and public.is_couple_member(couple_id));
drop policy if exists messages_update_sender on public.messages;
create policy messages_update_sender on public.messages for update to authenticated using (sender_id=auth.uid() and public.is_couple_member(couple_id)) with check (sender_id=auth.uid() and public.is_couple_member(couple_id));
drop policy if exists messages_delete_sender on public.messages;
create policy messages_delete_sender on public.messages for delete to authenticated using (sender_id=auth.uid() and public.is_couple_member(couple_id));

drop policy if exists reads_select_pair on public.message_reads;
create policy reads_select_pair on public.message_reads for select to authenticated using (public.is_message_member(message_id));
drop policy if exists reads_insert_self on public.message_reads;
create policy reads_insert_self on public.message_reads for insert to authenticated with check (user_id=auth.uid() and public.is_message_member(message_id));
drop policy if exists reads_update_self on public.message_reads;
create policy reads_update_self on public.message_reads for update to authenticated using (user_id=auth.uid() and public.is_message_member(message_id)) with check (user_id=auth.uid());

drop policy if exists reactions_select_pair on public.reactions;
create policy reactions_select_pair on public.reactions for select to authenticated using (public.is_message_member(message_id));
drop policy if exists reactions_insert_self on public.reactions;
create policy reactions_insert_self on public.reactions for insert to authenticated with check (user_id=auth.uid() and public.is_message_member(message_id));
drop policy if exists reactions_update_self on public.reactions;
create policy reactions_update_self on public.reactions for update to authenticated using (user_id=auth.uid() and public.is_message_member(message_id)) with check (user_id=auth.uid());
drop policy if exists reactions_delete_self on public.reactions;
create policy reactions_delete_self on public.reactions for delete to authenticated using (user_id=auth.uid() and public.is_message_member(message_id));

drop policy if exists memories_select_pair on public.memories;
create policy memories_select_pair on public.memories for select to authenticated using (public.is_couple_member(couple_id));
drop policy if exists memories_insert_pair on public.memories;
create policy memories_insert_pair on public.memories for insert to authenticated with check (created_by=auth.uid() and public.is_couple_member(couple_id));
drop policy if exists memories_update_pair on public.memories;
create policy memories_update_pair on public.memories for update to authenticated using (public.is_couple_member(couple_id)) with check (public.is_couple_member(couple_id));
drop policy if exists memories_delete_pair on public.memories;
create policy memories_delete_pair on public.memories for delete to authenticated using (public.is_couple_member(couple_id));

drop policy if exists dates_select_pair on public.important_dates;
create policy dates_select_pair on public.important_dates for select to authenticated using (public.is_couple_member(couple_id));
drop policy if exists dates_insert_pair on public.important_dates;
create policy dates_insert_pair on public.important_dates for insert to authenticated with check (created_by=auth.uid() and public.is_couple_member(couple_id));
drop policy if exists dates_update_pair on public.important_dates;
create policy dates_update_pair on public.important_dates for update to authenticated using (public.is_couple_member(couple_id)) with check (public.is_couple_member(couple_id));
drop policy if exists dates_delete_pair on public.important_dates;
create policy dates_delete_pair on public.important_dates for delete to authenticated using (public.is_couple_member(couple_id));

drop policy if exists push_select_self on public.push_subscriptions;
create policy push_select_self on public.push_subscriptions for select to authenticated using (user_id=auth.uid());
drop policy if exists push_delete_self on public.push_subscriptions;
create policy push_delete_self on public.push_subscriptions for delete to authenticated using (user_id=auth.uid());

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('couple-media','couple-media',false,15728640,array['image/jpeg','image/png','image/webp','image/heic','audio/webm','audio/mp4','audio/mpeg','video/mp4','video/webm'])
on conflict(id) do update set public=false,file_size_limit=15728640;

drop policy if exists couple_media_select on storage.objects;
create policy couple_media_select on storage.objects for select to authenticated using (
  bucket_id='couple-media' and public.is_couple_member(((storage.foldername(name))[1])::uuid)
);
drop policy if exists couple_media_insert on storage.objects;
create policy couple_media_insert on storage.objects for insert to authenticated with check (
  bucket_id='couple-media' and public.is_couple_member(((storage.foldername(name))[1])::uuid) and (storage.foldername(name))[2]=auth.uid()::text
);
drop policy if exists couple_media_delete on storage.objects;
create policy couple_media_delete on storage.objects for delete to authenticated using (
  bucket_id='couple-media' and public.is_couple_member(((storage.foldername(name))[1])::uuid)
);

-- Include old row values so filtered realtime DELETE events work reliably.
alter table public.messages replica identity full;
alter table public.memories replica identity full;
alter table public.important_dates replica identity full;

-- Realtime publication. Ignore duplicate-object errors if your project already manages this publication.
do $$ begin
  alter publication supabase_realtime add table public.messages;
exception when duplicate_object then null; end $$;
do $$ begin
  alter publication supabase_realtime add table public.reactions;
exception when duplicate_object then null; end $$;
do $$ begin
  alter publication supabase_realtime add table public.message_reads;
exception when duplicate_object then null; end $$;

do $$ begin
  alter publication supabase_realtime add table public.memories;
exception when duplicate_object then null; end $$;
do $$ begin
  alter publication supabase_realtime add table public.important_dates;
exception when duplicate_object then null; end $$;
do $$ begin
  alter publication supabase_realtime add table public.couples;
exception when duplicate_object then null; end $$;
do $$ begin
  alter publication supabase_realtime add table public.profiles;
exception when duplicate_object then null; end $$;
