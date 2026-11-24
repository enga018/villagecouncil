-- Automatic FTO import: active register Job Cards are included without a manual click.
begin;

alter table public.council_fto_review_decisions
  add column if not exists source text not null default 'manual'
  check (source in ('manual', 'register_auto'));

create or replace function public.set_council_fto_review_decision(
  p_fto_number text,
  p_reference_number text,
  p_decision text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant_id uuid;
  v_job_card_number text;
begin
  if p_decision not in ('in_village', 'not_in_village') then
    raise exception 'Choose In village or Not in village.';
  end if;

  select m.village_council_id into v_tenant_id
  from public.council_memberships m
  where m.user_id = (select auth.uid()) and m.is_active = true
  limit 1;
  if v_tenant_id is null then
    raise exception 'An active Village Council assignment is required.';
  end if;

  select tx.value->>'jobCardNumber' into v_job_card_number
  from public.council_fto_import_rows r
  cross join lateral jsonb_array_elements(coalesce(r.row_data->'transactions', '[]'::jsonb)) as tx(value)
  where r.village_council_id = v_tenant_id
    and r.row_data->>'fto_number' = p_fto_number
    and tx.value->>'referenceNumber' = p_reference_number
    and btrim(coalesce(tx.value->>'village', '')) = ''
  limit 1;
  if v_job_card_number is null then
    raise exception 'That transaction is not waiting for review.';
  end if;

  insert into public.council_fto_review_decisions (
    village_council_id, fto_number, reference_number, job_card_number, decision, decided_by, decided_at, source
  )
  values (v_tenant_id, p_fto_number, p_reference_number, v_job_card_number, p_decision, (select auth.uid()), now(), 'manual')
  on conflict (village_council_id, fto_number, reference_number) do update set
    job_card_number = excluded.job_card_number,
    decision = excluded.decision,
    decided_by = excluded.decided_by,
    decided_at = excluded.decided_at,
    source = 'manual';

  return jsonb_build_object('ftoNumber', p_fto_number, 'referenceNumber', p_reference_number, 'decision', p_decision);
end;
$$;

revoke execute on function public.set_council_fto_review_decision(text, text, text) from public, anon;
grant execute on function public.set_council_fto_review_decision(text, text, text) to authenticated;

create or replace function public.apply_register_fto_review_suggestions(p_batch_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant_id uuid;
  v_count integer := 0;
begin
  select b.village_council_id into v_tenant_id
  from public.council_fto_import_batches b
  where b.id = p_batch_id
    and b.status in ('processing', 'pending', 'completed')
    and b.village_council_id in (
      select m.village_council_id from public.council_memberships m
      where m.user_id = (select auth.uid()) and m.is_active = true
    );
  if v_tenant_id is null then
    raise exception 'Import batch not found or not accessible.';
  end if;

  insert into public.council_fto_review_decisions (
    village_council_id, fto_number, reference_number, job_card_number, decision, decided_by, decided_at, source
  )
  select distinct on (v_tenant_id, r.row_data->>'fto_number', tx.value->>'referenceNumber')
    v_tenant_id,
    r.row_data->>'fto_number',
    tx.value->>'referenceNumber',
    tx.value->>'jobCardNumber',
    'in_village',
    (select auth.uid()),
    now(),
    'register_auto'
  from public.council_fto_import_rows r
  cross join lateral jsonb_array_elements(coalesce(r.row_data->'transactions', '[]'::jsonb)) as tx(value)
  where r.import_batch_id = p_batch_id
    and r.village_council_id = v_tenant_id
    and r.row_data->>'scope' in ('IN_SCOPE', 'NEEDS_REVIEW')
    and btrim(coalesce(tx.value->>'village', '')) = ''
    and exists (
      select 1 from public.council_job_cards jc
      where jc.village_council_id = v_tenant_id
        and jc.status = 'active'
        and upper(btrim(jc.job_card_number)) = upper(btrim(tx.value->>'jobCardNumber'))
    )
  on conflict (village_council_id, fto_number, reference_number) do nothing;
  get diagnostics v_count = row_count;

  return v_count;
end;
$$;

revoke execute on function public.apply_register_fto_review_suggestions(uuid) from public, anon;
grant execute on function public.apply_register_fto_review_suggestions(uuid) to authenticated;

commit;
