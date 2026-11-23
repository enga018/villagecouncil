-- Explicit activation for a staged, village-filtered FTO import.
-- Only FTOs classified IN_SCOPE and their matched local Job Card transactions are activated.
begin;

create or replace function public.activate_council_fto_import(p_batch_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant_id uuid;
  v_fto_count integer := 0;
  v_existing_fto_count integer := 0;
  v_transaction_count integer := 0;
  v_excluded_count integer := 0;
begin
  select b.village_council_id into v_tenant_id
  from public.council_fto_import_batches b
  where b.id = p_batch_id
    and b.status in ('pending', 'completed')
    and b.village_council_id in (
      select m.village_council_id from public.council_memberships m
      where m.user_id = (select auth.uid()) and m.is_active = true
    );
  if v_tenant_id is null then
    raise exception 'Import batch is not complete, not found, or not accessible.';
  end if;

  select count(*) into v_excluded_count
  from public.council_fto_import_rows r
  where r.import_batch_id = p_batch_id
    and r.village_council_id = v_tenant_id
    and r.row_data->>'scope' = 'OUT_OF_SCOPE';

  select count(*) into v_existing_fto_count
  from public.council_ftos f
  join public.council_fto_import_rows r
    on r.row_data->>'fto_number' = f.fto_number
  where r.import_batch_id = p_batch_id
    and r.village_council_id = v_tenant_id
    and r.row_data->>'scope' = 'IN_SCOPE'
    and f.village_council_id = v_tenant_id;

  insert into public.council_ftos (
    village_council_id, fto_number, fto_date, fto_status, block, first_signatory,
    beneficiary_count, wage_amount, source_record_key, status
  )
  select v_tenant_id,
    r.row_data->>'fto_number',
    r.row_data->>'fto_date',
    r.row_data->>'fto_status',
    r.row_data->>'block',
    r.row_data->>'first_signatory',
    nullif((r.row_data->>'beneficiary_count'), '')::integer,
    nullif((r.row_data->>'wage_amount'), '')::numeric,
    r.row_data->>'source_record_key',
    'active'
  from public.council_fto_import_rows r
  where r.import_batch_id = p_batch_id
    and r.village_council_id = v_tenant_id
    and r.row_data->>'scope' = 'IN_SCOPE'
  on conflict (village_council_id, fto_number) do update set
    fto_date = excluded.fto_date,
    fto_status = excluded.fto_status,
    block = coalesce(public.council_ftos.block, excluded.block),
    first_signatory = excluded.first_signatory,
    beneficiary_count = excluded.beneficiary_count,
    wage_amount = excluded.wage_amount,
    last_seen_in_import_at = now(),
    updated_at = now();
  get diagnostics v_fto_count = row_count;

  insert into public.council_fto_transactions (
    village_council_id, fto_id, fto_number, job_card_number, reference_number,
    transaction_date, processed_date, applicant_name, primary_account_holder,
    amount_to_be_credited, credit_amount, government_status, normalized_status,
    rejection_reason, village, source_row, last_seen_in_import_at, updated_at
  )
  select
    v_tenant_id,
    f.id,
    r.row_data->>'fto_number',
    tx.value->>'jobCardNumber',
    tx.value->>'referenceNumber',
    nullif(tx.value->>'transactionDate', '')::date,
    nullif(tx.value->>'processedDate', '')::date,
    nullif(tx.value->>'personName', ''),
    nullif(tx.value->>'primaryAccountHolder', ''),
    nullif(tx.value->>'amountToBeCredited', '')::numeric,
    nullif(tx.value->>'creditAmount', '')::numeric,
    coalesce(nullif(tx.value->>'governmentStatus', ''), 'blank'),
    tx.value->>'normalizedStatus',
    nullif(tx.value->>'rejectionReason', ''),
    nullif(tx.value->>'village', ''),
    coalesce(tx.value->'sourceRow', '[]'::jsonb),
    now(),
    now()
  from public.council_fto_import_rows r
  cross join lateral jsonb_array_elements(coalesce(r.row_data->'transactions', '[]'::jsonb)) as tx(value)
  join public.council_ftos f
    on f.village_council_id = v_tenant_id
   and f.fto_number = r.row_data->>'fto_number'
  where r.import_batch_id = p_batch_id
    and r.village_council_id = v_tenant_id
    and r.row_data->>'scope' = 'IN_SCOPE'
  on conflict (village_council_id, fto_number, reference_number) do update set
    fto_id = excluded.fto_id,
    job_card_number = excluded.job_card_number,
    transaction_date = excluded.transaction_date,
    processed_date = excluded.processed_date,
    applicant_name = excluded.applicant_name,
    primary_account_holder = excluded.primary_account_holder,
    amount_to_be_credited = excluded.amount_to_be_credited,
    credit_amount = excluded.credit_amount,
    government_status = excluded.government_status,
    normalized_status = excluded.normalized_status,
    rejection_reason = excluded.rejection_reason,
    village = excluded.village,
    source_row = excluded.source_row,
    last_seen_in_import_at = now(),
    updated_at = now();
  get diagnostics v_transaction_count = row_count;

  update public.council_fto_import_batches
  set status = 'completed',
      completed_at = now(),
      inserted_ftos = greatest(v_fto_count - v_existing_fto_count, 0),
      updated_ftos = v_existing_fto_count,
      missing_records = v_excluded_count
  where id = p_batch_id and village_council_id = v_tenant_id;

  return jsonb_build_object(
    'batchId', p_batch_id,
    'villageCouncilId', v_tenant_id,
    'importedFtos', v_fto_count,
    'importedTransactions', v_transaction_count,
    'excludedOutOfVillageFtos', v_excluded_count
  );
end;
$$;

revoke execute on function public.activate_council_fto_import(uuid) from public, anon;
grant execute on function public.activate_council_fto_import(uuid) to authenticated;

commit;
