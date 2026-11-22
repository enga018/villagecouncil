-- Enforce one active Village Council per official Panchayat and replace
-- tenant-scoped Register/FTO imports atomically when onboarding location changes.
begin;

alter table public.council_tenants
  add column if not exists location_panchayat_id uuid
  references public.location_panchayats(id) on delete restrict;

-- Backfill the currently saved location against the shared official hierarchy.
update public.council_tenants c
set location_panchayat_id = p.id
from public.location_states s
join public.location_districts d on d.state_id = s.id
join public.location_blocks b on b.district_id = d.id
join public.location_panchayats p on p.block_id = b.id
where lower(btrim(s.official_name)) = lower(btrim(c.state))
  and lower(btrim(d.official_name)) = lower(btrim(c.district))
  and lower(btrim(b.official_name)) = lower(btrim(c.block))
  and lower(btrim(p.official_name)) = lower(btrim(c.village))
  and c.location_panchayat_id is null;

create unique index if not exists council_tenants_one_active_council_per_village
  on public.council_tenants(location_panchayat_id)
  where is_active = true and location_panchayat_id is not null;

comment on column public.council_tenants.location_panchayat_id is
  'Canonical shared location identity. A partial unique index permits only one active council per Panchayat.';

-- Return only the IDs that are already assigned to another active council.
-- This deliberately reveals no council identity or operational data.
create or replace function public.get_unavailable_panchayat_ids(p_council_id uuid)
returns setof uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.council_memberships m
    where m.village_council_id = p_council_id
      and m.user_id = (select auth.uid())
      and m.is_active = true
  ) then
    raise exception 'You are not an active member of this Village Council.';
  end if;

  return query
  select c.location_panchayat_id
  from public.council_tenants c
  where c.is_active = true
    and c.location_panchayat_id is not null
    and c.id <> p_council_id;
end;
$$;

-- Save a location and, only when the Panchayat actually changes, permanently
-- replace this council's Register and FTO imports in the same transaction.
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
  v_panchayat_id uuid;
  v_previous_panchayat_id uuid;
begin
  if auth.uid() is null or not exists (
    select 1 from public.council_memberships m
    where m.village_council_id = p_council_id
      and m.user_id = (select auth.uid())
      and m.is_active = true
  ) then
    raise exception 'You are not an active member of this Village Council.';
  end if;

  if nullif(btrim(p_state), '') is null
    or nullif(btrim(p_district), '') is null
    or nullif(btrim(p_block), '') is null
    or nullif(btrim(p_village), '') is null then
    raise exception 'Select a complete official Government location.';
  end if;

  -- Lock the council row so concurrent location changes cannot interleave.
  select c.location_panchayat_id into v_previous_panchayat_id
  from public.council_tenants c
  where c.id = p_council_id and c.is_active = true
  for update;

  if not found then
    raise exception 'The assigned Village Council is unavailable.';
  end if;

  insert into public.location_states (official_name, navigation_url)
  values (p_state, p_state_url)
  on conflict (official_name) do update
    set navigation_url = coalesce(public.location_states.navigation_url, excluded.navigation_url)
  returning id into v_state_id;

  insert into public.location_districts (state_id, official_name, navigation_url)
  values (v_state_id, p_district, p_district_url)
  on conflict (state_id, official_name) do update
    set navigation_url = coalesce(public.location_districts.navigation_url, excluded.navigation_url)
  returning id into v_district_id;

  insert into public.location_blocks (district_id, official_name, navigation_url)
  values (v_district_id, p_block, p_block_url)
  on conflict (district_id, official_name) do update
    set navigation_url = coalesce(public.location_blocks.navigation_url, excluded.navigation_url)
  returning id into v_block_id;

  insert into public.location_panchayats (block_id, official_name, navigation_url)
  values (v_block_id, p_village, p_panchayat_url)
  on conflict (block_id, official_name) do update
    set navigation_url = coalesce(public.location_panchayats.navigation_url, excluded.navigation_url)
  returning id into v_panchayat_id;

  -- This UPDATE reserves the new village under the unique index. If another
  -- active council owns it, PostgreSQL aborts and rolls back the whole function.
  update public.council_tenants
  set location_panchayat_id = v_panchayat_id,
      state = p_state,
      district = p_district,
      block = p_block,
      village = p_village,
      panchayat_url = p_panchayat_url,
      onboarding_completed_at = case
        when v_previous_panchayat_id is distinct from v_panchayat_id then null
        else onboarding_completed_at
      end,
      updated_at = now()
  where id = p_council_id;

  if v_previous_panchayat_id is distinct from v_panchayat_id then
    -- Raw import rows are removed by their batch FK cascade.
    delete from public.council_register_import_batches
    where village_council_id = p_council_id;

    -- Applicants must be deleted before their Job Card parents (RESTRICT FK).
    delete from public.council_applicants
    where village_council_id = p_council_id;

    delete from public.council_job_cards
    where village_council_id = p_council_id;

    delete from public.council_fto_import_batches
    where village_council_id = p_council_id;

    delete from public.council_ftos
    where village_council_id = p_council_id;
  end if;
end;
$$;

revoke execute on function public.get_unavailable_panchayat_ids(uuid) from public, anon;
grant execute on function public.get_unavailable_panchayat_ids(uuid) to authenticated;
revoke execute on function public.save_council_location(uuid, text, text, text, text, text, text, text, text) from public, anon;
grant execute on function public.save_council_location(uuid, text, text, text, text, text, text, text, text) to authenticated;

commit;
