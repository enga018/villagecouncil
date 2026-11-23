-- Persist parsed First Signatory FTO transactions for the owning Village Council only.
begin;

create table public.council_fto_transactions (
  id uuid primary key default gen_random_uuid(),
  village_council_id uuid not null references public.council_tenants(id) on delete restrict,
  fto_id uuid not null,
  fto_number text not null check (length(btrim(fto_number)) > 0),
  job_card_number text not null check (length(btrim(job_card_number)) > 0),
  reference_number text not null check (length(btrim(reference_number)) > 0),
  transaction_date date,
  processed_date date,
  applicant_name text,
  primary_account_holder text,
  amount_to_be_credited numeric(14,2) check (amount_to_be_credited is null or amount_to_be_credited >= 0),
  credit_amount numeric(14,2) check (credit_amount is null or credit_amount >= 0),
  government_status text not null default 'blank',
  normalized_status text not null
    check (normalized_status in ('processed','rejected','deferred')),
  rejection_reason text,
  village text,
  source_row jsonb not null default '{}'::jsonb
    check (jsonb_typeof(source_row) = 'array'),
  first_imported_at timestamptz not null default now(),
  last_seen_in_import_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (fto_id, village_council_id)
    references public.council_ftos(id, village_council_id) on delete cascade,
  unique (village_council_id, fto_number, reference_number)
);

create index council_fto_transactions_tenant_job_card_idx
  on public.council_fto_transactions (village_council_id, job_card_number, transaction_date);
create index council_fto_transactions_fto_idx
  on public.council_fto_transactions (fto_id, reference_number);

alter table public.council_fto_transactions enable row level security;
revoke all on public.council_fto_transactions from anon, authenticated;
grant select on public.council_fto_transactions to authenticated;

create policy "Council members can read their FTO transactions"
on public.council_fto_transactions for select to authenticated
using (exists (
  select 1 from public.council_memberships m
  where m.village_council_id = council_fto_transactions.village_council_id
    and m.user_id = (select auth.uid()) and m.is_active = true
));

comment on table public.council_fto_transactions is
  'Normalized FTO transaction details imported only when the complete Job Card Number belongs to the owning Village Council.';
comment on column public.council_fto_transactions.source_row is
  'Original parsed Government transaction cells retained for audit. Only in-scope Village Council transactions are stored.';

commit;
