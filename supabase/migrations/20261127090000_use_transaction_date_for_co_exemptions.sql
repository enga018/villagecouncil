begin;

alter table public.council_fto_co_calculation_items add column transaction_date date;

create or replace function public.apply_council_fto_co_calculation(
  p_actor_id uuid,
  p_fto_id uuid,
  p_tag_id uuid,
  p_divisor integer,
  p_multiplier integer,
  p_expected_transaction_count integer,
  p_expected_latest_transaction_updated_at timestamptz,
  p_expected_exemption_interval_count integer,
  p_expected_latest_exemption_updated_at timestamptz,
  p_expected_exempt_mark_count integer,
  p_expected_latest_exempt_marked_at timestamptz,
  p_idempotency_key uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant_id uuid;
  v_fto public.council_ftos%rowtype;
  v_tag public.council_co_tags%rowtype;
  v_transaction_count integer;
  v_latest_transaction_updated_at timestamptz;
  v_exemption_interval_count integer;
  v_latest_exemption_updated_at timestamptz;
  v_exempt_mark_count integer;
  v_latest_exempt_marked_at timestamptz;
  v_version integer;
  v_calculation_id uuid;
  v_total_credit numeric(16,2);
  v_total_co numeric(16,2);
  v_exempt_count integer;
  v_actor uuid := p_actor_id;
begin
  if v_actor is null then raise exception 'An authenticated actor is required.'; end if;
  select m.village_council_id into v_tenant_id from public.council_memberships m
  where m.user_id = v_actor and m.is_active = true limit 1;
  if v_tenant_id is null then raise exception 'No active Village Council membership was found.'; end if;

  select * into v_fto from public.council_ftos f
  where f.id = p_fto_id and f.village_council_id = v_tenant_id and f.status = 'active'
  for update;
  if not found then raise exception 'FTO not found or not available to this Village Council.'; end if;

  select c.id into v_calculation_id from public.council_fto_co_calculations c
  where c.village_council_id = v_tenant_id and c.idempotency_key = p_idempotency_key;
  if v_calculation_id is not null then
    return jsonb_build_object('success', true, 'idempotent_replay', true, 'calculation_id', v_calculation_id);
  end if;

  if p_divisor is null or p_divisor <= 0 or p_multiplier is null or p_multiplier <= 0 then
    raise exception 'Divisor and multiplier must be positive whole numbers.';
  end if;

  select count(*)::integer, max(t.updated_at) into v_transaction_count, v_latest_transaction_updated_at
  from public.council_fto_transactions t
  where t.village_council_id = v_tenant_id and t.fto_id = p_fto_id;
  if v_transaction_count <> p_expected_transaction_count
     or v_latest_transaction_updated_at is distinct from p_expected_latest_transaction_updated_at then
    raise exception 'FTO transaction data changed after preview. Generate a new preview.';
  end if;
  if v_transaction_count = 0 then raise exception 'This FTO has no imported transactions to calculate.'; end if;
  if exists (
    select 1 from public.council_fto_transactions t
    where t.village_council_id = v_tenant_id and t.fto_id = p_fto_id and t.transaction_date is null
  ) then raise exception 'One or more transactions have no Transaction Date. Review them manually before calculating CO.'; end if;

  select count(*)::integer, max(e.updated_at)
  into v_exemption_interval_count, v_latest_exemption_updated_at
  from public.council_co_exemption_intervals e
  where e.village_council_id = v_tenant_id
    and e.job_card_number in (
      select distinct t.job_card_number from public.council_fto_transactions t
      where t.village_council_id = v_tenant_id and t.fto_id = p_fto_id
    );

  select count(*)::integer, max(x.marked_at)
  into v_exempt_mark_count, v_latest_exempt_marked_at
  from public.council_co_exempt_transactions x
  join public.council_fto_transactions t
    on t.id = x.fto_transaction_id and t.village_council_id = x.village_council_id
  where x.village_council_id = v_tenant_id and t.fto_id = p_fto_id;

  if v_exemption_interval_count <> p_expected_exemption_interval_count
     or v_latest_exemption_updated_at is distinct from p_expected_latest_exemption_updated_at
     or v_exempt_mark_count <> p_expected_exempt_mark_count
     or v_latest_exempt_marked_at is distinct from p_expected_latest_exempt_marked_at then
    raise exception 'Job Card exemption data changed after preview. Generate a new preview.';
  end if;

  if exists (
    select 1 from public.council_fto_transactions t
    where t.village_council_id = v_tenant_id and t.fto_id = p_fto_id
      and (t.credit_amount is null or t.credit_amount < 0)
  ) then raise exception 'One or more transactions have an invalid Credit Amount. Calculation cannot continue.'; end if;

  select * into v_tag from public.council_co_tags t
  where t.id = p_tag_id and t.village_council_id = v_tenant_id and t.is_archived = false;
  if not found then raise exception 'Select an active FTO tag before applying CO calculation.'; end if;

  insert into public.council_co_exempt_transactions (
    village_council_id, fto_transaction_id, exemption_interval_id, first_imported_at, marked_by
  )
  select t.village_council_id, t.id, e.id, t.first_imported_at, v_actor
  from public.council_fto_transactions t
  join lateral (
    select x.id from public.council_co_exemption_intervals x
    where x.village_council_id = t.village_council_id and x.job_card_number = t.job_card_number
      and t.transaction_date >= x.started_at::date and (x.ended_at is null or t.transaction_date < x.ended_at::date)
    order by x.started_at desc limit 1
  ) e on true
  where t.village_council_id = v_tenant_id and t.fto_id = p_fto_id
  on conflict (fto_transaction_id) do nothing;

  v_version := v_fto.co_calculation_version + 1;
  select
    coalesce(sum(t.credit_amount), 0)::numeric(16,2),
    coalesce(sum(round((t.credit_amount / p_divisor::numeric) * p_multiplier, 2)), 0)::numeric(16,2),
    count(*) filter (where x.fto_transaction_id is not null)::integer
  into v_total_credit, v_total_co, v_exempt_count
  from public.council_fto_transactions t
  left join public.council_co_exempt_transactions x
    on x.village_council_id = t.village_council_id and x.fto_transaction_id = t.id
  where t.village_council_id = v_tenant_id and t.fto_id = p_fto_id;

  insert into public.council_fto_co_calculations (
    village_council_id, fto_id, version, tag_id, tag_name_snapshot, divisor, multiplier,
    transaction_count, total_credit_amount, total_co_amount, exempt_count, chargeable_count, idempotency_key, created_by
  ) values (
    v_tenant_id, p_fto_id, v_version, v_tag.id, v_tag.name, p_divisor, p_multiplier,
    v_transaction_count, v_total_credit, v_total_co, v_exempt_count, v_transaction_count - v_exempt_count, p_idempotency_key, v_actor
  ) returning id into v_calculation_id;

  insert into public.council_fto_co_calculation_items (
    village_council_id, calculation_id, fto_transaction_id, job_card_number, applicant_name,
    credit_amount, co_amount, is_exempt, exemption_interval_id, first_imported_at, transaction_date
  )
  select t.village_council_id, v_calculation_id, t.id, t.job_card_number,
    coalesce(nullif(btrim(t.applicant_name), ''), nullif(btrim(t.primary_account_holder), '')),
    t.credit_amount, round((t.credit_amount / p_divisor::numeric) * p_multiplier, 2),
    (x.fto_transaction_id is not null), x.exemption_interval_id, t.first_imported_at, t.transaction_date
  from public.council_fto_transactions t
  left join public.council_co_exempt_transactions x
    on x.village_council_id = t.village_council_id and x.fto_transaction_id = t.id
  where t.village_council_id = v_tenant_id and t.fto_id = p_fto_id;

  if v_fto.current_co_tag_id is distinct from v_tag.id then
    insert into public.council_co_tag_events (village_council_id, fto_id, tag_id, previous_tag_id, action, actor_id)
    values (v_tenant_id, p_fto_id, v_tag.id, v_fto.current_co_tag_id,
      case when v_fto.current_co_tag_id is null then 'assigned' else 'reassigned' end, v_actor);
  end if;

  update public.council_ftos set current_co_tag_id = v_tag.id, latest_co_calculation_id = v_calculation_id,
    co_calculation_version = v_version, updated_at = now()
  where id = p_fto_id and village_council_id = v_tenant_id;

  return jsonb_build_object('success', true, 'idempotent_replay', false, 'calculation_id', v_calculation_id,
    'version', v_version, 'transaction_count', v_transaction_count, 'total_credit_amount', v_total_credit,
    'total_co_amount', v_total_co, 'exempt_count', v_exempt_count, 'chargeable_count', v_transaction_count - v_exempt_count,
    'divisor', p_divisor, 'multiplier', p_multiplier, 'tag_id', v_tag.id, 'tag_name', v_tag.name);
end;
$$;


revoke execute on function public.apply_council_fto_co_calculation(uuid,uuid,uuid,integer,integer,integer,timestamptz,integer,timestamptz,integer,timestamptz,uuid) from public, anon, authenticated;
grant execute on function public.apply_council_fto_co_calculation(uuid,uuid,uuid,integer,integer,integer,timestamptz,integer,timestamptz,integer,timestamptz,uuid) to service_role;

commit;
