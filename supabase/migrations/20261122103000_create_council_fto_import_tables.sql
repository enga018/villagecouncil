-- Tenant-scoped FTO (Fund Transfer Order) import storage for the onboarding FTO discovery step.
begin;

create table public.council_fto_import_batches (
  id uuid primary key default gen_random_uuid(),
  village_council_id uuid not null references public.council_tenants(id) on delete restrict,
  source text not null default 'official_fto_register'
    check (source = 'official_fto_register'),
  source_period text,
  source_location_key text,
  status text not null default 'pending'
    check (status in ('pending','processing','completed','failed')),
  imported_by uuid references auth.users(id) on delete set null,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  total_rows integer not null default 0 check (total_rows >= 0),
  inserted_ftos integer not null default 0 check (inserted_ftos >= 0),
  updated_ftos integer not null default 0 check (updated_ftos >= 0),
  missing_records integer not null default 0 check (missing_records >= 0),
  error_message text,
  created_at timestamptz not null default now(),
  unique (id, village_council_id),
  check (completed_at is null or status in ('completed','failed'))
);

create table public.council_ftos (
  id uuid primary key default gen_random_uuid(),
  village_council_id uuid not null references public.council_tenants(id) on delete restrict,
  fto_number text not null check (length(trim(fto_number)) > 0),
  fto_date text,
  fto_status text,
  block text,
  first_signatory text,
  second_signatory text,
  beneficiary_count integer check (beneficiary_count is null or beneficiary_count >= 0),
  wage_amount numeric(14, 2) check (wage_amount is null or wage_amount >= 0),
  source_record_key text not null check (length(trim(source_record_key)) > 0),
  status text not null default 'active' check (status in ('active','inactive','deleted')),
  first_imported_at timestamptz not null default now(),
  last_seen_in_import_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (village_council_id, fto_number),
  unique (village_council_id, source_record_key),
  unique (id, village_council_id)
);

create table public.council_fto_import_rows (
  village_council_id uuid not null,
  import_batch_id uuid not null,
  row_number integer not null check (row_number > 0),
  row_data jsonb not null check (jsonb_typeof(row_data) in ('array','object')),
  created_at timestamptz not null default now(),
  primary key (import_batch_id, row_number),
  foreign key (import_batch_id, village_council_id)
    references public.council_fto_import_batches(id, village_council_id)
    on delete cascade
);

create index council_ftos_tenant_status_idx
  on public.council_ftos (village_council_id, status, fto_number);
create index council_fto_import_batches_tenant_created_idx
  on public.council_fto_import_batches (village_council_id, created_at desc);
create index council_fto_import_rows_tenant_batch_idx
  on public.council_fto_import_rows (village_council_id, import_batch_id);

alter table public.council_fto_import_batches enable row level security;
alter table public.council_ftos enable row level security;
alter table public.council_fto_import_rows enable row level security;

revoke all on public.council_fto_import_batches from anon, authenticated;
revoke all on public.council_ftos from anon, authenticated;
revoke all on public.council_fto_import_rows from anon, authenticated;
grant select on public.council_fto_import_batches to authenticated;
grant select on public.council_ftos to authenticated;
grant select on public.council_fto_import_rows to authenticated;

create policy "Council members can read their FTO import batches"
on public.council_fto_import_batches for select to authenticated
using (exists (
  select 1 from public.council_memberships m
  where m.village_council_id = council_fto_import_batches.village_council_id
    and m.user_id = (select auth.uid()) and m.is_active = true
));
create policy "Council members can read their FTOs"
on public.council_ftos for select to authenticated
using (exists (
  select 1 from public.council_memberships m
  where m.village_council_id = council_ftos.village_council_id
    and m.user_id = (select auth.uid()) and m.is_active = true
));
create policy "Council members can read their staged FTO import rows"
on public.council_fto_import_rows for select to authenticated
using (exists (
  select 1 from public.council_memberships m
  where m.village_council_id = council_fto_import_rows.village_council_id
    and m.user_id = (select auth.uid()) and m.is_active = true
));

comment on table public.council_fto_import_batches is
  'Tenant-scoped audit history for official FTO register imports. Stores jurisdiction keys, never encrypted session URLs.';
comment on table public.council_ftos is
  'Tenant-scoped FTO master records discovered from the official VBGRAMG FTO tracking report.';
comment on table public.council_fto_import_rows is
  'Tenant-scoped immutable raw FTO rows retained for import audit and reconciliation.';

commit;
