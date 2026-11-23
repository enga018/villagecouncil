-- Track whether a successfully inspected FTO was actually activated into this Council's ledger.
begin;

alter table public.council_fto_inspections
  add column import_activated_at timestamptz;

comment on column public.council_fto_inspections.import_activated_at is
  'Set only after the matching staged FTO transactions are activated into this Council''s permanent FTO tables. A null value keeps the FTO eligible for refetch/recovery.';

commit;
