-- Tenant-scoped Job Card and Registration Application Register import storage.
begin;

create table public.council_register_import_batches (
  id uuid primary key default gen_random_uuid(),
  village_council_id uuid not null references public.council_tenants(id) on delete restrict,
  source text not null default 'official_registration_register'
    check (source = 'official_registration_register'),
  source_period text,
  source_location_key text,
  status text not null default 'pending'
    check (status in ('pending','processing','completed','failed')),
  imported_by uuid references auth.users(id) on delete set null,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  total_rows integer not null default 0 check (total_rows >= 0),
  inserted_job_cards integer not null default 0 check (inserted_job_cards >= 0),
  updated_job_cards integer not null default 0 check (updated_job_cards >= 0),
  inserted_applicants integer not null default 0 check (inserted_applicants >= 0),
  updated_applicants integer not null default 0 check (updated_applicants >= 0),
  missing_records integer not null default 0 check (missing_records >= 0),
  error_message text,
  created_at timestamptz not null default now(),
  unique (id, village_council_id),
  check (completed_at is null or status in ('completed','failed'))
);

create table public.council_job_cards (
  id uuid primary key default gen_random_uuid(),
  village_council_id uuid not null references public.council_tenants(id) on delete restrict,
  job_card_number text not null check (length(trim(job_card_number)) > 0),
  head_of_household text not null check (length(trim(head_of_household)) > 0),
  status text not null default 'active' check (status in ('active','inactive','deleted')),
  source text not null default 'official_register'
    check (source in ('official_register','manual')),
  source_record_key text,
  first_imported_at timestamptz not null default now(),
  last_seen_in_import_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (village_council_id, job_card_number),
  unique (id, village_council_id)
);

create table public.council_applicants (
  id uuid primary key default gen_random_uuid(),
  village_council_id uuid not null references public.council_tenants(id) on delete restrict,
  job_card_id uuid not null,
  applicant_number text not null check (length(trim(applicant_number)) > 0),
  applicant_name text not null check (length(trim(applicant_name)) > 0),
  official_unique_id text,
  source_record_key text not null check (length(trim(source_record_key)) > 0),
  status text not null default 'active' check (status in ('active','inactive','deleted')),
  source_sequence integer not null check (source_sequence > 0),
  first_imported_at timestamptz not null default now(),
  last_seen_in_import_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (job_card_id, village_council_id)
    references public.council_job_cards(id, village_council_id) on delete restrict,
  unique (village_council_id, source_record_key),
  unique (id, village_council_id)
);

create unique index council_applicants_official_uid_unique
  on public.council_applicants (village_council_id, official_unique_id)
  where official_unique_id is not null;
create index council_job_cards_tenant_status_idx
  on public.council_job_cards (village_council_id, status, job_card_number);
create index council_applicants_tenant_card_idx
  on public.council_applicants (village_council_id, job_card_id, status);
create index council_register_import_batches_tenant_created_idx
  on public.council_register_import_batches (village_council_id, created_at desc);

create table public.council_register_import_rows (
  village_council_id uuid not null,
  import_batch_id uuid not null,
  row_number integer not null check (row_number > 0),
  row_data jsonb not null check (jsonb_typeof(row_data) = 'array'),
  created_at timestamptz not null default now(),
  primary key (import_batch_id, row_number),
  foreign key (import_batch_id, village_council_id)
    references public.council_register_import_batches(id, village_council_id)
    on delete cascade
);
create index council_register_import_rows_tenant_batch_idx
  on public.council_register_import_rows (village_council_id, import_batch_id);

alter table public.council_register_import_batches enable row level security;
alter table public.council_job_cards enable row level security;
alter table public.council_applicants enable row level security;
alter table public.council_register_import_rows enable row level security;

revoke all on public.council_register_import_batches from anon, authenticated;
revoke all on public.council_job_cards from anon, authenticated;
revoke all on public.council_applicants from anon, authenticated;
revoke all on public.council_register_import_rows from anon, authenticated;
grant select on public.council_register_import_batches to authenticated;
grant select on public.council_job_cards to authenticated;
grant select on public.council_applicants to authenticated;
grant select on public.council_register_import_rows to authenticated;

create policy "Council members can read their import batches"
on public.council_register_import_batches for select to authenticated
using (exists (
  select 1 from public.council_memberships m
  where m.village_council_id = council_register_import_batches.village_council_id
    and m.user_id = (select auth.uid()) and m.is_active = true
));
create policy "Council members can read their job cards"
on public.council_job_cards for select to authenticated
using (exists (
  select 1 from public.council_memberships m
  where m.village_council_id = council_job_cards.village_council_id
    and m.user_id = (select auth.uid()) and m.is_active = true
));
create policy "Council members can read their applicants"
on public.council_applicants for select to authenticated
using (exists (
  select 1 from public.council_memberships m
  where m.village_council_id = council_applicants.village_council_id
    and m.user_id = (select auth.uid()) and m.is_active = true
));
create policy "Council members can read their staged import rows"
on public.council_register_import_rows for select to authenticated
using (exists (
  select 1 from public.council_memberships m
  where m.village_council_id = council_register_import_rows.village_council_id
    and m.user_id = (select auth.uid()) and m.is_active = true
));

comment on table public.council_register_import_batches is
  'Tenant-scoped audit history for official Registration Application Register imports. Stores jurisdiction keys, never encrypted session URLs.';
comment on table public.council_job_cards is
  'Tenant-scoped Job Card master records; deleted source records are soft-deleted.';
comment on table public.council_applicants is
  'Tenant-scoped applicants linked to Job Cards with stable source identity.';
comment on table public.council_register_import_rows is
  'Tenant-scoped immutable raw rows retained for import audit and reconciliation.';

commit;
