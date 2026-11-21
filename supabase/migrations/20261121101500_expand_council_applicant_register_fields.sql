begin;

alter table public.council_applicants
  add column if not exists caste text,
  add column if not exists father_husband_name text,
  add column if not exists gender text,
  add column if not exists age text,
  add column if not exists application_received_date text,
  add column if not exists job_card_issue_date text,
  add column if not exists remarks text,
  add column if not exists is_disabled text,
  add column if not exists is_minority text,
  add column if not exists job_card_verified_date text;

alter table public.council_register_import_rows
  drop constraint if exists council_register_import_rows_row_data_check;
alter table public.council_register_import_rows
  add constraint council_register_import_rows_row_data_check
  check (jsonb_typeof(row_data) in ('array','object'));

comment on column public.council_applicants.source_record_key is
  'Stable tenant-scoped identity derived from official Job Card Number and normalized applicant name; ambiguous duplicates require review.';
comment on column public.council_register_import_rows.row_data is
  'Immutable staged source row or normalized applicant object for import preview and audit.';

commit;