-- Public Village Council onboarding requests.
-- Public submissions are accepted only through the validated Edge Function;
-- authenticated access is restricted to platform superadmins.

begin;

create table public.council_onboarding_requests (
  id uuid primary key default gen_random_uuid(),
  council_name text not null check (length(btrim(council_name)) between 3 and 120),
  state_id uuid not null references public.location_states(id) on delete restrict,
  district_id uuid not null references public.location_districts(id) on delete restrict,
  block_id uuid not null references public.location_blocks(id) on delete restrict,
  location_panchayat_id uuid not null references public.location_panchayats(id) on delete restrict,
  state text not null,
  district text not null,
  block text not null,
  village text not null,
  administrator_email text not null check (
    length(administrator_email) <= 254
    and administrator_email = lower(btrim(administrator_email))
  ),
  requester_name text not null check (length(btrim(requester_name)) between 2 and 120),
  requester_designation text not null check (length(btrim(requester_designation)) between 2 and 80),
  requester_phone text not null check (length(btrim(requester_phone)) between 6 and 30),
  reason text check (reason is null or length(reason) <= 1000),
  status text not null default 'pending'
    check (status in ('pending', 'under_review', 'approved', 'rejected', 'more_information_required')),
  reviewed_by uuid references auth.users(id) on delete set null,
  reviewed_at timestamptz,
  review_notes text,
  created_council_id uuid references public.council_tenants(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint council_onboarding_requests_location_names_not_blank check (
    length(btrim(state)) > 0
    and length(btrim(district)) > 0
    and length(btrim(block)) > 0
    and length(btrim(village)) > 0
  ),
  constraint council_onboarding_requests_approval_link check (
    (status = 'approved' and created_council_id is not null)
    or (status <> 'approved')
  )
);

comment on table public.council_onboarding_requests is
  'Public applications from Village Councils requesting platform onboarding.';

create unique index council_onboarding_requests_one_open_per_panchayat
  on public.council_onboarding_requests(location_panchayat_id)
  where status in ('pending', 'under_review', 'more_information_required');

create index council_onboarding_requests_status_created_at_idx
  on public.council_onboarding_requests(status, created_at desc);

create index council_onboarding_requests_email_idx
  on public.council_onboarding_requests(administrator_email);

alter table public.council_onboarding_requests enable row level security;

grant select, update on public.council_onboarding_requests to authenticated;

create policy "Platform superadmins can view onboarding requests"
  on public.council_onboarding_requests
  for select
  to authenticated
  using ((select public.is_platform_superadmin()));

create policy "Platform superadmins can update onboarding requests"
  on public.council_onboarding_requests
  for update
  to authenticated
  using ((select public.is_platform_superadmin()))
  with check ((select public.is_platform_superadmin()));

revoke all on public.council_onboarding_requests from anon;
revoke insert, delete on public.council_onboarding_requests from authenticated;

commit;
