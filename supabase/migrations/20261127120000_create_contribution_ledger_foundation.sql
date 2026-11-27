-- Contribution ledger foundation.
-- Creates Council-scoped charge, payment, allocation and audit structures.
-- This migration is committed to the feature branch only; it is not applied here.

begin;

-- Add tenant/account-aware candidate keys so ledger references cannot cross
-- Job Cards even when all referenced rows belong to the same Council.
alter table public.council_fto_transactions
  add constraint council_fto_transactions_id_tenant_job_card_unique
  unique (id, village_council_id, job_card_number);

alter table public.council_fto_co_calculation_items
  add constraint council_calculation_items_calculation_transaction_tenant_unique
  unique (calculation_id, fto_transaction_id, village_council_id);

create table public.council_contribution_charges (
  id uuid primary key default gen_random_uuid(),
  village_council_id uuid not null references public.council_tenants(id) on delete restrict,
  job_card_number text not null,
  charge_type text not null check (charge_type in ('regular_co', 'manual_extra')),
  fto_transaction_id uuid,
  source_calculation_id uuid,
  description text,
  current_amount numeric(14,2) not null check (current_amount >= 0),
  is_active boolean not null default true,
  original_created_at timestamptz not null default now(),
  created_by uuid not null references auth.users(id) on delete restrict,
  updated_at timestamptz not null default now(),
  constraint council_contribution_charges_job_card_fk
    foreign key (village_council_id, job_card_number)
    references public.council_job_cards(village_council_id, job_card_number) on delete restrict,
  constraint council_contribution_charges_transaction_fk
    foreign key (fto_transaction_id, village_council_id)
    references public.council_fto_transactions(id, village_council_id) on delete restrict,
  constraint council_contribution_charges_calculation_fk
    foreign key (source_calculation_id, village_council_id)
    references public.council_fto_co_calculations(id, village_council_id) on delete restrict,
  constraint council_contribution_charges_source_shape_check check (
    (charge_type = 'regular_co' and fto_transaction_id is not null and source_calculation_id is not null and description is null)
    or
    (charge_type = 'manual_extra' and fto_transaction_id is null and source_calculation_id is null and length(btrim(coalesce(description, ''))) > 0)
  ),
  constraint council_contribution_charges_id_tenant_unique unique (id, village_council_id),\n  constraint council_contribution_charges_id_tenant_job_card_unique unique (id, village_council_id, job_card_number)
);

create unique index council_contribution_charges_regular_transaction_unique
  on public.council_contribution_charges(village_council_id, fto_transaction_id)
  where charge_type = 'regular_co';

create index council_contribution_charges_job_card_idx
  on public.council_contribution_charges(village_council_id, job_card_number, is_active);

create table public.council_contribution_charge_revisions (
  id uuid primary key default gen_random_uuid(),
  village_council_id uuid not null,
  charge_id uuid not null,
  revision_number integer not null check (revision_number > 0),
  previous_amount numeric(14,2),
  new_amount numeric(14,2) not null check (new_amount >= 0),
  previous_is_active boolean,
  new_is_active boolean not null,
  source_calculation_id uuid,
  reason text,
  actor_id uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  constraint council_charge_revisions_charge_fk
    foreign key (charge_id, village_council_id)
    references public.council_contribution_charges(id, village_council_id) on delete restrict,
  constraint council_charge_revisions_calculation_fk
    foreign key (source_calculation_id, village_council_id)
    references public.council_fto_co_calculations(id, village_council_id) on delete restrict,
  constraint council_charge_revisions_version_unique unique (charge_id, revision_number)
);

create table public.council_manual_charge_events (
  id uuid primary key default gen_random_uuid(),
  village_council_id uuid not null,
  charge_id uuid not null,
  event_type text not null check (event_type in ('created', 'corrected', 'reversed')),
  previous_amount numeric(14,2),
  new_amount numeric(14,2),
  reason text,
  actor_id uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  constraint council_manual_charge_events_charge_fk
    foreign key (charge_id, village_council_id)
    references public.council_contribution_charges(id, village_council_id) on delete restrict
);

create table public.council_payment_batches (
  id uuid primary key default gen_random_uuid(),
  village_council_id uuid not null references public.council_tenants(id) on delete restrict,
  batch_reference text not null,
  payment_method text not null check (payment_method in ('cash', 'bank')),
  recorded_by uuid not null references auth.users(id) on delete restrict,
  recorded_at timestamptz not null default now(),
  line_count integer not null default 0 check (line_count >= 0),
  total_amount numeric(14,2) not null default 0 check (total_amount >= 0),
  constraint council_payment_batches_reference_unique unique (village_council_id, batch_reference),
  constraint council_payment_batches_id_tenant_unique unique (id, village_council_id)
);

create table public.council_payments (
  id uuid primary key default gen_random_uuid(),
  village_council_id uuid not null,
  job_card_number text not null,
  batch_id uuid,
  payment_method text not null check (payment_method in ('cash', 'bank')),
  amount numeric(14,2) not null check (amount > 0),
  receipt_reference text,
  remarks text,
  paid_at timestamptz not null default now(),
  recorded_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint council_payments_job_card_fk
    foreign key (village_council_id, job_card_number)
    references public.council_job_cards(village_council_id, job_card_number) on delete restrict,
  constraint council_payments_batch_fk
    foreign key (batch_id, village_council_id)
    references public.council_payment_batches(id, village_council_id) on delete restrict,
  constraint council_payments_id_tenant_unique unique (id, village_council_id),\n  constraint council_payments_id_tenant_job_card_unique unique (id, village_council_id, job_card_number)
);

create index council_payments_job_card_date_idx
  on public.council_payments(village_council_id, job_card_number, paid_at, id);

create table public.council_payment_events (
  id uuid primary key default gen_random_uuid(),
  village_council_id uuid not null,
  payment_id uuid not null,
  event_type text not null check (event_type in ('created', 'corrected')),
  previous_amount numeric(14,2),
  new_amount numeric(14,2) not null check (new_amount > 0),
  previous_method text,
  new_method text not null check (new_method in ('cash', 'bank')),
  previous_receipt_reference text,
  new_receipt_reference text,
  previous_remarks text,
  new_remarks text,
  reason text,
  actor_id uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  constraint council_payment_events_payment_fk
    foreign key (payment_id, village_council_id)
    references public.council_payments(id, village_council_id) on delete restrict
);

create table public.council_payment_allocations (
  id uuid primary key default gen_random_uuid(),
  village_council_id uuid not null,
  job_card_number text not null,
  payment_id uuid not null,
  charge_id uuid not null,
  allocated_amount numeric(14,2) not null check (allocated_amount > 0),
  allocation_type text not null check (allocation_type in ('fifo_auto', 'historical_fifo_reviewed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint council_allocations_payment_fk
    foreign key (payment_id, village_council_id)
    references public.council_payments(id, village_council_id) on delete restrict,
  constraint council_allocations_charge_fk
    foreign key (charge_id, village_council_id)
    references public.council_contribution_charges(id, village_council_id) on delete restrict,
  constraint council_allocations_job_card_fk
    foreign key (village_council_id, job_card_number)
    references public.council_job_cards(village_council_id, job_card_number) on delete restrict,
  constraint council_allocations_id_tenant_unique unique (id, village_council_id)
);

create index council_payment_allocations_payment_idx
  on public.council_payment_allocations(village_council_id, payment_id);
create index council_payment_allocations_charge_idx
  on public.council_payment_allocations(village_council_id, charge_id);

create table public.council_fifo_runs (
  id uuid primary key default gen_random_uuid(),
  village_council_id uuid not null references public.council_tenants(id) on delete restrict,
  job_card_number text not null,
  trigger_type text not null check (trigger_type in (
    'payment_created', 'payment_corrected', 'charge_created', 'charge_corrected',
    'charge_reversed', 'charge_reinstated', 'co_recalculation', 'waiver', 'refund',
    'historical_import', 'manual_reconciliation'
  )),
  status text not null check (status in ('running', 'completed', 'failed')),
  initiated_by uuid references auth.users(id) on delete restrict,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  failure_code text,
  failure_detail text,
  context jsonb not null default '{}'::jsonb,
  constraint council_fifo_runs_job_card_fk
    foreign key (village_council_id, job_card_number)
    references public.council_job_cards(village_council_id, job_card_number) on delete restrict,
  constraint council_fifo_runs_id_tenant_unique unique (id, village_council_id)
);

create table public.council_allocation_events (
  id uuid primary key default gen_random_uuid(),
  village_council_id uuid not null,
  fifo_run_id uuid,
  allocation_id uuid,
  payment_id uuid not null,
  charge_id uuid not null,
  job_card_number text not null,
  event_type text not null check (event_type in ('allocated', 'released', 'reallocated')),
  amount numeric(14,2) not null check (amount > 0),
  allocation_type text not null check (allocation_type in ('fifo_auto', 'historical_fifo_reviewed')),
  reason text,
  actor_id uuid references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  constraint council_allocation_events_run_fk
    foreign key (fifo_run_id, village_council_id)
    references public.council_fifo_runs(id, village_council_id) on delete restrict,
  constraint council_allocation_events_allocation_fk
    foreign key (allocation_id, village_council_id)
    references public.council_payment_allocations(id, village_council_id) on delete restrict,
  constraint council_allocation_events_payment_fk
    foreign key (payment_id, village_council_id)
    references public.council_payments(id, village_council_id) on delete restrict,
  constraint council_allocation_events_charge_fk
    foreign key (charge_id, village_council_id)
    references public.council_contribution_charges(id, village_council_id) on delete restrict,
  constraint council_allocation_events_job_card_fk
    foreign key (village_council_id, job_card_number)
    references public.council_job_cards(village_council_id, job_card_number) on delete restrict
);

create index council_allocation_events_job_card_idx
  on public.council_allocation_events(village_council_id, job_card_number, created_at);

-- Protect terminal Government transaction statuses even when refreshed imports upsert rows.
create or replace function public.preserve_final_council_fto_transaction_status()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.normalized_status in ('processed', 'rejected') then
    if new.normalized_status is distinct from old.normalized_status then
      new.normalized_status := old.normalized_status;
      new.government_status := old.government_status;
      new.rejection_reason := old.rejection_reason;
    elsif new.government_status is distinct from old.government_status
       or new.rejection_reason is distinct from old.rejection_reason then
      new.government_status := old.government_status;
      new.rejection_reason := old.rejection_reason;
    end if;
  end if;
  return new;
end;
$$;

create trigger council_fto_transactions_preserve_final_status
before update of normalized_status, government_status, rejection_reason
on public.council_fto_transactions
for each row execute function public.preserve_final_council_fto_transaction_status();

-- Financial history is append-only. Current-state tables remain separately mutable
-- through the authorized ledger functions added in subsequent migrations.
create or replace function public.prevent_financial_history_mutation()
returns trigger
language plpgsql
set search_path = ''
as $history_guard$
begin
  raise exception 'Financial history records cannot be updated or deleted.';
end;
$history_guard$;

create trigger council_charge_revisions_immutable
before update or delete on public.council_contribution_charge_revisions
for each row execute function public.prevent_financial_history_mutation();

create trigger council_manual_charge_events_immutable
before update or delete on public.council_manual_charge_events
for each row execute function public.prevent_financial_history_mutation();

create trigger council_payment_events_immutable
before update or delete on public.council_payment_events
for each row execute function public.prevent_financial_history_mutation();

create trigger council_allocation_events_immutable
before update or delete on public.council_allocation_events
for each row execute function public.prevent_financial_history_mutation();

-- All ledger tables are readable only by active members of the owning Council.
-- Writes will be exposed through authenticated, tenant-checking database functions.
do $$
declare
  t text;
begin
  foreach t in array array[
    'council_contribution_charges',
    'council_contribution_charge_revisions',
    'council_manual_charge_events',
    'council_payment_batches',
    'council_payments',
    'council_payment_events',
    'council_payment_allocations',
    'council_fifo_runs',
    'council_allocation_events'
  ]
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on table public.%I from anon, authenticated', t);
    execute format('grant select on table public.%I to authenticated', t);
    execute format(
      'create policy %I on public.%I for select to authenticated using (exists (select 1 from public.council_memberships m where m.village_council_id = %I.village_council_id and m.user_id = (select auth.uid()) and m.is_active = true))',
      t || '_active_council_member_read', t, t
    );
  end loop;
end;
$$;

revoke all on function public.preserve_final_council_fto_transaction_status() from public, anon, authenticated;
revoke all on function public.prevent_financial_history_mutation() from public, anon, authenticated;

commit;
