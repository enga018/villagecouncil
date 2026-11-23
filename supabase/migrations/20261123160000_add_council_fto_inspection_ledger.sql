-- Durable Council-scoped FTO inspection state for safe incremental refetching.
begin;

create table public.council_fto_inspections (
  village_council_id uuid not null references public.council_tenants(id) on delete restrict,
  fto_number text not null check (length(btrim(fto_number)) > 0),
  listing_fingerprint text not null check (length(btrim(listing_fingerprint)) > 0),
  inspection_result text not null check (inspection_result in ('matched', 'no_match')),
  matching_transaction_count integer not null default 0 check (matching_transaction_count >= 0),
  unresolved_transaction_count integer not null default 0 check (unresolved_transaction_count >= 0),
  last_inspected_at timestamptz not null default now(),
  last_error text,
  updated_at timestamptz not null default now(),
  primary key (village_council_id, fto_number),
  check (
    (inspection_result = 'no_match' and matching_transaction_count = 0 and unresolved_transaction_count = 0)
    or
    (inspection_result = 'matched' and matching_transaction_count > 0
      and unresolved_transaction_count <= matching_transaction_count)
  )
);

create index council_fto_inspections_refetch_idx
  on public.council_fto_inspections
    (village_council_id, inspection_result, unresolved_transaction_count, last_inspected_at);

alter table public.council_fto_inspections enable row level security;
revoke all on public.council_fto_inspections from anon, authenticated;

comment on table public.council_fto_inspections is
  'Council-scoped FTO detail inspection ledger. Stores only inspection metadata and refetch eligibility; transaction ownership remains based on the Panchayat embedded in each Government FTO detail row.';

commit;
