-- Normalize official navigation URLs into the shared location master tables so
-- State / District / Block URLs are stored once and reused across councils,
-- while each council keeps only its own village Panchayat URL.
begin;

alter table public.location_states add column if not exists navigation_url text;
alter table public.location_districts add column if not exists navigation_url text;
alter table public.location_blocks add column if not exists navigation_url text;
alter table public.location_panchayats add column if not exists navigation_url text;

comment on column public.location_states.navigation_url is
  'Official VBGRAMG State navigation URL; shared across every council in this State.';
comment on column public.location_districts.navigation_url is
  'Official VBGRAMG District navigation URL; shared across every council in this District.';
comment on column public.location_blocks.navigation_url is
  'Official VBGRAMG Block navigation URL; shared across every council in this Block.';
comment on column public.location_panchayats.navigation_url is
  'Official VBGRAMG Panchayat navigation URL for this village.';

-- Atomically upsert the shared location hierarchy (reusing an existing row's URL
-- instead of duplicating it) and update the council's own location + panchayat URL.
create or replace function public.save_council_location(
  p_council_id uuid,
  p_state text,
  p_district text,
  p_block text,
  p_village text,
  p_state_url text,
  p_district_url text,
  p_block_url text,
  p_panchayat_url text
) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_state_id uuid;
  v_district_id uuid;
  v_block_id uuid;
begin
  if not exists (
    select 1 from public.council_memberships m
    where m.village_council_id = p_council_id
      and m.user_id = (select auth.uid())
      and m.is_active = true
  ) then
    raise exception 'You are not an active member of this Village Council.';
  end if;

  insert into public.location_states (official_name, navigation_url)
  values (p_state, p_state_url)
  on conflict (official_name) do update set navigation_url = excluded.navigation_url
  returning id into v_state_id;

  insert into public.location_districts (state_id, official_name, navigation_url)
  values (v_state_id, p_district, p_district_url)
  on conflict (state_id, official_name) do update set navigation_url = excluded.navigation_url
  returning id into v_district_id;

  insert into public.location_blocks (district_id, official_name, navigation_url)
  values (v_district_id, p_block, p_block_url)
  on conflict (district_id, official_name) do update set navigation_url = excluded.navigation_url
  returning id into v_block_id;

  insert into public.location_panchayats (block_id, official_name, navigation_url)
  values (v_block_id, p_village, p_panchayat_url)
  on conflict (block_id, official_name) do update set navigation_url = excluded.navigation_url;

  update public.council_tenants
  set state = p_state,
      district = p_district,
      block = p_block,
      village = p_village,
      panchayat_url = p_panchayat_url,
      updated_at = now()
  where id = p_council_id;
end;
$$;

create or replace function public.get_block_navigation_url(
  p_state text,
  p_district text,
  p_block text
) returns text
language sql
security definer
set search_path = ''
as $$
  select b.navigation_url
  from public.location_blocks b
  join public.location_districts d on d.id = b.district_id
  join public.location_states s on s.id = d.state_id
  where s.official_name = p_state
    and d.official_name = p_district
    and b.official_name = p_block
  limit 1;
$$;

revoke execute on function public.save_council_location(uuid, text, text, text, text, text, text, text, text) from public, anon;
revoke execute on function public.get_block_navigation_url(text, text, text) from public, anon;
grant execute on function public.save_council_location(uuid, text, text, text, text, text, text, text, text) to authenticated;
grant execute on function public.get_block_navigation_url(text, text, text) to authenticated;

-- Shared State / District / Block URLs now live in the location master tables.
alter table public.council_tenants drop column if exists state_url;
alter table public.council_tenants drop column if exists district_url;
alter table public.council_tenants drop column if exists block_url;

commit;
