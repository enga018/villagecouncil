-- Persist the official VBGRAMG State and District navigation URLs selected during onboarding.
begin;

alter table public.council_tenants
  add column if not exists state_url text,
  add column if not exists district_url text;

grant update (state_url, district_url) on table public.council_tenants to authenticated;

comment on column public.council_tenants.state_url is
  'Official VBGRAMG State navigation URL selected during onboarding; retained for jurisdiction audit.';
comment on column public.council_tenants.district_url is
  'Official VBGRAMG District navigation URL selected during onboarding; retained for jurisdiction audit.';

commit;
