-- VC Puitu: isolated tenant and account mapping.
-- Deliberately separate from the legacy survey tables.

create table public.puitu_village_councils (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) > 0),
  slug text not null unique check (slug = lower(slug) and length(trim(slug)) > 0),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.puitu_memberships (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references auth.users(id) on delete cascade,
  village_council_id uuid not null unique references public.puitu_village_councils(id) on delete restrict,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (user_id, village_council_id)
);

comment on table public.puitu_village_councils is
  'VC Puitu tenant registry. Separate from legacy survey village_councils.';
comment on table public.puitu_memberships is
  'Trusted account-to-tenant mapping. One active account mapping per user and one account per council. Provisioned outside the public client.';

alter table public.puitu_village_councils enable row level security;
alter table public.puitu_memberships enable row level security;

grant select on public.puitu_village_councils to authenticated;
grant select on public.puitu_memberships to authenticated;

create policy "Puitu users can read their own membership"
on public.puitu_memberships
for select
to authenticated
using (user_id = (select auth.uid()) and is_active = true);

create policy "Puitu members can read their own active council"
on public.puitu_village_councils
for select
to authenticated
using (
  is_active = true
  and exists (
    select 1
    from public.puitu_memberships m
    where m.village_council_id = puitu_village_councils.id
      and m.user_id = (select auth.uid())
      and m.is_active = true
  )
);
