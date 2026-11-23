-- Shared, jurisdiction-scoped navigation cache for the official VBGRAMG FTO workflow.
-- Only reusable navigation URLs and rediscovery metadata are stored; cookies and ASP.NET
-- session state (__VIEWSTATE, __EVENTVALIDATION, etc.) are never persisted.
begin;

create table public.shared_fto_navigation (
  id uuid primary key default gen_random_uuid(),
  district_id uuid not null references public.location_districts(id) on delete cascade,
  block_id uuid references public.location_blocks(id) on delete cascade,
  navigation_type text not null
    check (navigation_type in ('fto_status', 'first_signatory_list')),
  navigation_url text not null
    check (navigation_url ~ '^https://vbgramg[.]dord[.]gov[.]in/'),
  control_target text,
  control_argument text,
  navigation_data jsonb not null default '{}'::jsonb
    check (jsonb_typeof(navigation_data) = 'object'),
  verified_at timestamptz,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint shared_fto_navigation_scope_check check (
    (navigation_type = 'fto_status' and block_id is null)
    or
    (navigation_type = 'first_signatory_list' and block_id is not null)
  )
);

create unique index shared_fto_navigation_district_fto_status_uidx
  on public.shared_fto_navigation (district_id)
  where navigation_type = 'fto_status' and block_id is null;

create unique index shared_fto_navigation_block_first_signatory_uidx
  on public.shared_fto_navigation (district_id, block_id)
  where navigation_type = 'first_signatory_list' and block_id is not null;

create index shared_fto_navigation_active_lookup_idx
  on public.shared_fto_navigation (district_id, block_id, navigation_type)
  where is_active = true;

alter table public.shared_fto_navigation enable row level security;
revoke all on public.shared_fto_navigation from anon, authenticated;

comment on table public.shared_fto_navigation is
  'Shared official VBGRAMG FTO navigation cache keyed by District and, where applicable, Block. Stores reusable URLs and rediscovery metadata, never cookies or session state.';
comment on column public.shared_fto_navigation.navigation_data is
  'Non-session discovery metadata such as visible link label, source page path, or stable control description.';
comment on column public.shared_fto_navigation.control_target is
  'Optional ASP.NET postback target used to rediscover a navigation URL when the cached URL expires.';
comment on column public.shared_fto_navigation.control_argument is
  'Optional ASP.NET postback argument used with control_target during rediscovery.';

commit;
