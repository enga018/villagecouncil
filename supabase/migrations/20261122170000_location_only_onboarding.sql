-- Onboarding is complete once the Government location is saved.
-- Job Card and FTO imports are operational workflows inside the workspace.
begin;

create or replace function public.complete_council_onboarding(p_council_id uuid)
returns timestamptz
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_completed_at timestamptz;
begin
  if not exists (
    select 1
    from public.council_memberships m
    where m.village_council_id = p_council_id
      and m.user_id = (select auth.uid())
      and m.is_active = true
  ) then
    raise exception 'You are not an active member of this Village Council.';
  end if;

  if not exists (
    select 1
    from public.council_tenants c
    where c.id = p_council_id
      and c.is_active = true
      and nullif(trim(c.state), '') is not null
      and nullif(trim(c.district), '') is not null
      and nullif(trim(c.block), '') is not null
      and nullif(trim(c.village), '') is not null
  ) then
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
