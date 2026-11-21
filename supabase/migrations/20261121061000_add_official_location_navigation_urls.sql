-- Persist the official VBGRAMG navigation URLs selected during onboarding.
begin;

alter table public.council_tenants
  add column if not exists block_url text,
  add column if not exists panchayat_url text;

comment on column public.council_tenants.block_url is
  'Official VBGRAMG Block navigation URL selected during onboarding; used as the saved jurisdiction entry point.';
comment on column public.council_tenants.panchayat_url is
  'Official VBGRAMG Panchayat navigation URL selected during onboarding; used as the saved register navigation entry point.';

commit;
