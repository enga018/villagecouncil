-- Contribution ledger schema and privilege regression tests.
-- Run only against a disposable local Supabase database after all migrations:
--   supabase test db
-- These assertions do not write to the linked/production project.

begin;

create extension if not exists pgtap with schema extensions;
select plan(31);

-- Core financial ledger tables.
select ok(to_regclass('public.council_contribution_charges') is not null, 'charge ledger table exists');
select ok(to_regclass('public.council_contribution_charge_revisions') is not null, 'immutable charge revisions table exists');
select ok(to_regclass('public.council_manual_charge_events') is not null, 'manual charge event history exists');
select ok(to_regclass('public.council_payment_batches') is not null, 'bulk payment batch table exists');
select ok(to_regclass('public.council_payments') is not null, 'payments table exists');
select ok(to_regclass('public.council_payment_events') is not null, 'payment event history exists');
select ok(to_regclass('public.council_payment_allocations') is not null, 'current allocation state table exists');
select ok(to_regclass('public.council_allocation_events') is not null, 'append-only allocation event history exists');
select ok(to_regclass('public.council_fifo_runs') is not null, 'FIFO run audit table exists');
select ok(to_regclass('public.council_payment_refunds') is not null, 'refund ledger table exists');
select ok(to_regclass('public.council_contribution_waivers') is not null, 'waiver ledger table exists');

-- Critical RPC entry points must exist with the intended signatures.
select ok(to_regprocedure('public.run_council_job_card_fifo(uuid,text,text,uuid,text)') is not null, 'Job Card FIFO function exists');
select ok(to_regprocedure('public.record_council_job_card_payment(uuid,text,numeric,uuid,text,text)') is not null, 'individual payment RPC exists');
select ok(to_regprocedure('public.record_council_job_card_paid_in_full(uuid,text,uuid,text,text)') is not null, 'Paid in Full RPC exists');
select ok(to_regprocedure('public.create_council_manual_charge(uuid,text,text,numeric,uuid)') is not null, 'manual charge creation RPC exists');
select ok(to_regprocedure('public.correct_council_manual_charge(uuid,uuid,numeric,text,uuid)') is not null, 'manual charge correction RPC exists');
select ok(to_regprocedure('public.reverse_council_manual_charge(uuid,uuid,text,boolean,uuid)') is not null, 'manual charge reversal RPC exists');
select ok(to_regprocedure('public.correct_council_job_card_payment(uuid,uuid,numeric,text,text,text,text)') is not null, 'payment correction RPC exists');
select ok(to_regprocedure('public.refund_council_job_card_payment(uuid,uuid,numeric,text,uuid)') is not null, 'refund RPC exists');
select ok(to_regprocedure('public.record_council_job_card_waiver(uuid,text,numeric,text,uuid)') is not null, 'waiver RPC exists');

-- Tenant boundaries and immutable history are enforced in the database.
select ok((select relrowsecurity from pg_class where oid = 'public.council_contribution_charges'::regclass), 'charge ledger has RLS enabled');
select ok((select relrowsecurity from pg_class where oid = 'public.council_payments'::regclass), 'payments have RLS enabled');
select ok((select relrowsecurity from pg_class where oid = 'public.council_payment_refunds'::regclass), 'refunds have RLS enabled');
select ok((select relrowsecurity from pg_class where oid = 'public.council_contribution_waivers'::regclass), 'waivers have RLS enabled');
select ok(exists (
  select 1 from pg_trigger
  where tgrelid = 'public.council_contribution_charge_revisions'::regclass
    and tgname = 'council_charge_revisions_immutable' and not tgisinternal
), 'charge revisions have an immutability trigger');
select ok(exists (
  select 1 from pg_trigger
  where tgrelid = 'public.council_payment_events'::regclass
    and tgname = 'council_payment_events_immutable' and not tgisinternal
), 'payment events have an immutability trigger');
select ok(exists (
  select 1 from pg_trigger
  where tgrelid = 'public.council_payment_refunds'::regclass
    and tgname = 'council_payment_refunds_immutable' and not tgisinternal
), 'refunds have an immutability trigger');
select ok(exists (
  select 1 from pg_trigger
  where tgrelid = 'public.council_contribution_waivers'::regclass
    and tgname = 'council_contribution_waivers_immutable' and not tgisinternal
), 'waivers have an immutability trigger');

-- Client roles must not write ledger tables directly or invoke internal sync helpers.
select ok(not has_table_privilege('authenticated', 'public.council_payments', 'INSERT'), 'authenticated role cannot insert payments directly');
select ok(not has_table_privilege('authenticated', 'public.council_payment_allocations', 'UPDATE'), 'authenticated role cannot edit allocations directly');
select ok(not has_function_privilege('authenticated', 'public.sync_council_regular_co_charge(uuid,uuid,text,uuid)', 'EXECUTE'), 'authenticated role cannot call internal CO sync helper');

select * from finish();
rollback;
