-- Together v2.7: private names chosen by each member for the other member.
-- Additive and repeatable. Existing profiles, photos and messages are untouched.
begin;

create table if not exists public.partner_contact_preferences (
  couple_id uuid not null references public.couples(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete cascade,
  partner_id uuid not null references auth.users(id) on delete cascade,
  contact_name text,
  primary key (couple_id, owner_id, partner_id),
  constraint contact_different_users check (owner_id <> partner_id),
  constraint contact_name_valid check (contact_name is null or (
    char_length(contact_name) between 1 and 80
    and contact_name = btrim(contact_name)
    and contact_name !~ '[[:cntrl:]]'
  ))
);

alter table public.partner_contact_preferences enable row level security;
revoke all on public.partner_contact_preferences from anon;
grant select, insert, update, delete on public.partner_contact_preferences to authenticated;

drop policy if exists partner_contacts_self on public.partner_contact_preferences;
create policy partner_contacts_self on public.partner_contact_preferences
  for all to authenticated
  using (
    owner_id = auth.uid() and exists (
      select 1 from public.couples c where c.id = couple_id
        and ((c.user_a = owner_id and c.user_b = partner_id)
          or (c.user_b = owner_id and c.user_a = partner_id))
    )
  )
  with check (
    owner_id = auth.uid() and exists (
      select 1 from public.couples c where c.id = couple_id
        and ((c.user_a = owner_id and c.user_b = partner_id)
          or (c.user_b = owner_id and c.user_a = partner_id))
    )
  );

do $$ begin
  if not exists (select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public'
        and tablename = 'partner_contact_preferences') then
    alter publication supabase_realtime add table public.partner_contact_preferences;
  end if;
end $$;

notify pgrst, 'reload schema';
commit;
