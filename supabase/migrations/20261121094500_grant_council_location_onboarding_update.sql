-- Allow authenticated council members to update only onboarding location fields.
begin;

grant update (
  state,
  district,
  block,
  village,
  block_url,
  panchayat_url,
  updated_at
) on table public.council_tenants to authenticated;

commit;
