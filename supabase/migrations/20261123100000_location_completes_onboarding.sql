-- Government location is the sole onboarding requirement.
-- Job Card and FTO imports are operational tasks performed after onboarding.
begin;

create or replace function public.complete_council_onboarding(p_council_id uuid)
returns timestamptz
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_state text;
  v_district text;
  v_block text;
  v_village text;
  v_completed_at timestamptz;
begin
  if not exists (
    select 1 from public.council_memberships m
    where m.village_council_id = p_council_id
      and m.user_id = (select auth.uid())
      and m.is_active = true
  ) then
    raise exception 'You are not an active member of this Village Council.';
  end if;

  select c.state, c.district, c.block, c.village
  into v_state, v_district, v_block, v_village
  from public.council_tenants c
  where c.id = p_council_id and c.is_active = true;

  if v_state is null or v_district is null or v_block is null or v_village is null then
    raise exception 'Save the complete Government location before completing onboarding.';
  end if;

  update public.council_tenants
  set onboarding_completed_at = coalesce(onboarding_completed_at, now()),
      updated_at = now()
  where id = p_council_id
  returning onboarding_completed_at into v_completed_at;

  return v_completed_at;
end;
$$;

revoke execute on function public.complete_council_onboarding(uuid) from public, anon;
grant execute on function public.complete_council_onboarding(uuid) to authenticated;

commit;
