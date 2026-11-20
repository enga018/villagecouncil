-- Shared official VBGRAMG location hierarchy.
-- Preserve official_name exactly as published by the source website.

create or replace function public.is_platform_superadmin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.platform_superadmins ps
    where ps.user_id = (select auth.uid())
  );
$$;

revoke all on function public.is_platform_superadmin() from public;
grant execute on function public.is_platform_superadmin() to authenticated;

create table public.location_states (
  id uuid primary key default gen_random_uuid(),
  official_name text not null,
  source_key text,
  is_active boolean not null default true,
  source_updated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint location_states_official_name_not_blank check (length(btrim(official_name)) > 0),
  constraint location_states_name_unique unique (official_name)
);

create table public.location_districts (
  id uuid primary key default gen_random_uuid(),
  state_id uuid not null references public.location_states(id) on delete restrict,
  official_name text not null,
  source_key text,
  is_active boolean not null default true,
  source_updated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint location_districts_official_name_not_blank check (length(btrim(official_name)) > 0),
  constraint location_districts_name_unique unique (state_id, official_name)
);

create table public.location_blocks (
  id uuid primary key default gen_random_uuid(),
  district_id uuid not null references public.location_districts(id) on delete restrict,
  official_name text not null,
  source_key text,
  is_active boolean not null default true,
  source_updated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint location_blocks_official_name_not_blank check (length(btrim(official_name)) > 0),
  constraint location_blocks_name_unique unique (district_id, official_name)
);

create table public.location_panchayats (
  id uuid primary key default gen_random_uuid(),
  block_id uuid not null references public.location_blocks(id) on delete restrict,
  official_name text not null,
  source_key text,
  source_position integer,
  is_active boolean not null default true,
  source_updated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint location_panchayats_official_name_not_blank check (length(btrim(official_name)) > 0),
  constraint location_panchayats_name_unique unique (block_id, official_name)
);

create index location_districts_state_id_idx on public.location_districts(state_id);
create index location_blocks_district_id_idx on public.location_blocks(district_id);
create index location_panchayats_block_id_idx on public.location_panchayats(block_id);

alter table public.location_states enable row level security;
alter table public.location_districts enable row level security;
alter table public.location_blocks enable row level security;
alter table public.location_panchayats enable row level security;

create policy "Authenticated users can read active states"
on public.location_states for select to authenticated using (is_active or (select public.is_platform_superadmin()));
create policy "Superadmins manage states"
on public.location_states for all to authenticated
using ((select public.is_platform_superadmin()))
with check ((select public.is_platform_superadmin()));

create policy "Authenticated users can read active districts"
on public.location_districts for select to authenticated using (
  (is_active and exists (select 1 from public.location_states s where s.id = state_id and s.is_active))
  or (select public.is_platform_superadmin())
);
create policy "Superadmins manage districts"
on public.location_districts for all to authenticated
using ((select public.is_platform_superadmin()))
with check ((select public.is_platform_superadmin()));

create policy "Authenticated users can read active blocks"
on public.location_blocks for select to authenticated using (
  (is_active and exists (
    select 1 from public.location_districts d
    join public.location_states s on s.id = d.state_id
    where d.id = district_id and d.is_active and s.is_active
  ))
  or (select public.is_platform_superadmin())
);
create policy "Superadmins manage blocks"
on public.location_blocks for all to authenticated
using ((select public.is_platform_superadmin()))
with check ((select public.is_platform_superadmin()));

create policy "Authenticated users can read active panchayats"
on public.location_panchayats for select to authenticated using (
  (is_active and exists (
    select 1 from public.location_blocks b
    join public.location_districts d on d.id = b.district_id
    join public.location_states s on s.id = d.state_id
    where b.id = block_id and b.is_active and d.is_active and s.is_active
  ))
  or (select public.is_platform_superadmin())
);
create policy "Superadmins manage panchayats"
on public.location_panchayats for all to authenticated
using ((select public.is_platform_superadmin()))
with check ((select public.is_platform_superadmin()));

grant select on public.location_states, public.location_districts, public.location_blocks, public.location_panchayats to authenticated;
grant insert, update on public.location_states, public.location_districts, public.location_blocks, public.location_panchayats to authenticated;
revoke delete on public.location_states, public.location_districts, public.location_blocks, public.location_panchayats from authenticated;
