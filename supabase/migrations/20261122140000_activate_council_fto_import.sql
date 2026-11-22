-- Explicit activation for a staged FTO register. Upserts the staged rows into
-- council_ftos and closes the batch. Idempotent (upsert by (village_council_id, fto_number)).
begin;

create or replace function public.activate_council_fto_import(p_batch_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant_id uuid;
  v_total integer := 0;
begin
  -- Batch must exist and belong to a council the caller is a member of.
  select b.village_council_id into v_tenant_id
  from public.council_fto_import_batches b
  where b.id = p_batch_id
    and b.status in ('processing', 'completed', 'pending')
    and b.village_council_id in (
      select m.village_council_id from public.council_memberships m
      where m.user_id = (select auth.uid()) and m.is_active = true
    );
  if v_tenant_id is null then
    raise exception 'Import batch not found or not accessible.';
  end if;

  select count(*) into v_total
  from public.council_fto_import_rows r
  where r.import_batch_id = p_batch_id and r.village_council_id = v_tenant_id;

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
  where r.import_batch_id = p_batch_id and r.village_council_id = v_tenant_id
  on conflict (village_council_id, fto_number) do update set
    fto_number = excluded.fto_number,
    fto_date = excluded.fto_date,
    fto_status = excluded.fto_status,
    block = coalesce(public.council_ftos.block, excluded.block),
    first_signatory = excluded.first_signatory,
    wage_amount = coalesce(public.council_ftos.wage_amount, excluded.wage_amount),
    last_seen_in_import_at = now();

  update public.council_fto_import_batches
  set status = 'completed', completed_at = now()
  where id = p_batch_id and village_council_id = v_tenant_id;

  return jsonb_build_object('totalRows', v_total, 'batchId', p_batch_id, 'villageCouncilId', v_tenant_id);
end;
$$;

revoke execute on function public.activate_council_fto_import(uuid) from public, anon;
grant execute on function public.activate_council_fto_import(uuid) to authenticated;

commit;
