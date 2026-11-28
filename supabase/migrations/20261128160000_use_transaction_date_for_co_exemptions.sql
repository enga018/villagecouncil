begin;

-- Use Government transaction_date for exemption eligibility in CO calculations.
-- This supersedes permanent first-import exemption marks as an eligibility rule.
-- The legacy transaction-mark trigger is no longer part of eligibility.
-- Keep historical mark rows intact, but do not let new mark inserts affect charges.
drop trigger if exists council_fto_transaction_sync_regular_charge_after_exempt_mark
  on public.council_co_exempt_transactions;
drop function if exists public.sync_council_regular_co_charge_after_exempt_mark();

-- Existing calculation snapshots were produced under the previous first-import rule.
-- New Apply operations explicitly identify snapshots using Transaction Date rules.
alter table public.council_fto_co_calculations
  add column exemption_rule_version smallint not null default 1
  check (exemption_rule_version in (1, 2));

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

  v_version := v_fto.co_calculation_version + 1;
  select
    coalesce(sum(t.credit_amount), 0)::numeric(16,2),
    coalesce(sum(round((t.credit_amount / p_divisor::numeric) * p_multiplier, 2)), 0)::numeric(16,2),
    count(*) filter (where e.id is not null)::integer
  into v_total_credit, v_total_co, v_exempt_count
  from public.council_fto_transactions t
  left join lateral (
    select x.id
    from public.council_co_exemption_intervals x
    where x.village_council_id = t.village_council_id
      and x.job_card_number = t.job_card_number
      and t.transaction_date is not null
      and t.transaction_date >= x.started_at::date
      and (x.ended_at is null or t.transaction_date < x.ended_at::date)
    order by x.started_at desc
    limit 1
  ) e on true
  where t.village_council_id = v_tenant_id and t.fto_id = p_fto_id;

  insert into public.council_fto_co_calculations (
    village_council_id, fto_id, version, tag_id, tag_name_snapshot, divisor, multiplier,
    transaction_count, total_credit_amount, total_co_amount, exempt_count, chargeable_count, idempotency_key, created_by,
    exemption_rule_version
  ) values (
    v_tenant_id, p_fto_id, v_version, v_tag.id, v_tag.name, p_divisor, p_multiplier,
    v_transaction_count, v_total_credit, v_total_co, v_exempt_count, v_transaction_count - v_exempt_count, p_idempotency_key, v_actor,
    2
  ) returning id into v_calculation_id;

  insert into public.council_fto_co_calculation_items (
    village_council_id, calculation_id, fto_transaction_id, job_card_number, applicant_name,
    credit_amount, co_amount, is_exempt, exemption_interval_id, first_imported_at, transaction_date
  )
  select t.village_council_id, v_calculation_id, t.id, t.job_card_number,
    coalesce(nullif(btrim(t.applicant_name), ''), nullif(btrim(t.primary_account_holder), '')),
    t.credit_amount, round((t.credit_amount / p_divisor::numeric) * p_multiplier, 2),
    (e.id is not null), e.id, t.first_imported_at, t.transaction_date
  from public.council_fto_transactions t
  left join lateral (
    select x.id
    from public.council_co_exemption_intervals x
    where x.village_council_id = t.village_council_id
      and x.job_card_number = t.job_card_number
      and t.transaction_date is not null
      and t.transaction_date >= x.started_at::date
      and (x.ended_at is null or t.transaction_date < x.ended_at::date)
    order by x.started_at desc
    limit 1
  ) e on true
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


create or replace function public.sync_council_regular_co_charge(
  p_village_council_id uuid,
  p_fto_transaction_id uuid,
  p_change_source text,
  p_actor_id uuid default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_tx record;
  v_item record;
  v_charge public.council_contribution_charges%rowtype;
  v_eligible boolean;
  v_new_amount numeric(14,2);
  v_new_active boolean;
  v_revision integer;
  v_actor uuid;
  v_exemption_started_at timestamptz;
  v_charge_found boolean;
  v_stale_exemption boolean := false;
begin
  if p_change_source not in ('co_recalculation', 'government_status') then
    raise exception 'Unsupported Regular CO charge synchronization source.';
  end if;

  select
    t.id,
    t.village_council_id,
    t.job_card_number,
    t.normalized_status,
    t.transaction_date,
    f.latest_co_calculation_id,
    f.current_co_tag_id
  into v_tx
  from public.council_fto_transactions t
  join public.council_ftos f
    on f.id = t.fto_id and f.village_council_id = t.village_council_id
  join public.council_job_cards j
    on j.village_council_id = t.village_council_id
   and j.job_card_number = t.job_card_number
  where t.id = p_fto_transaction_id
    and t.village_council_id = p_village_council_id
  for update of t;

  if not found or v_tx.latest_co_calculation_id is null then
    return;
  end if;

  select i.calculation_id, i.co_amount, i.is_exempt, i.exemption_interval_id, c.created_by, c.created_at
  into v_item
  from public.council_fto_co_calculation_items i
  join public.council_fto_co_calculations c
    on c.id = i.calculation_id and c.village_council_id = i.village_council_id
  where i.village_council_id = p_village_council_id
    and i.calculation_id = v_tx.latest_co_calculation_id
    and i.fto_transaction_id = p_fto_transaction_id;

  if not found then
    return;
  end if;

  -- If an exemption interval changed after this calculation, keep the saved
  -- calculation stale for transactions whose Government transaction_date falls
  -- within that interval. This blocks new charges until a fresh Preview → Apply.
  select exists (
    select 1
    from public.council_co_exemption_intervals e
    where e.village_council_id = p_village_council_id
      and e.job_card_number = v_tx.job_card_number
      and v_tx.transaction_date is not null
      and v_tx.transaction_date >= e.started_at::date
      and (e.ended_at is null or v_tx.transaction_date < e.ended_at::date)
      and e.updated_at > v_item.created_at
  ) into v_stale_exemption;

  v_eligible := v_tx.normalized_status = 'processed'
    and not v_item.is_exempt
    and not v_stale_exemption;
  v_actor := coalesce(p_actor_id, v_item.created_by);

  select * into v_charge
  from public.council_contribution_charges ch
  where ch.village_council_id = p_village_council_id
    and ch.fto_transaction_id = p_fto_transaction_id
    and ch.charge_type = 'regular_co'
  for update;
  v_charge_found := found;

  if v_charge_found and (v_item.is_exempt or v_stale_exemption) then
    select e.started_at into v_exemption_started_at
    from public.council_co_exemption_intervals e
    where e.village_council_id = p_village_council_id
      and (
        e.id = v_item.exemption_interval_id
        or (
          v_stale_exemption
          and e.job_card_number = v_tx.job_card_number
          and v_tx.transaction_date is not null
          and v_tx.transaction_date >= e.started_at::date
          and (e.ended_at is null or v_tx.transaction_date < e.ended_at::date)
          and e.updated_at > v_item.created_at
        )
      )
    order by e.started_at desc
    limit 1;

    -- A charge created before the effective interval remains payable.
    if v_exemption_started_at is not null
       and v_charge.original_created_at < v_exemption_started_at then
      v_eligible := v_tx.normalized_status = 'processed';
    end if;
  end if;

  v_new_amount := case when v_eligible then v_item.co_amount else 0 end;
  v_new_active := v_eligible;

  if not v_charge_found then
    if not v_eligible then
      return;
    end if;

    insert into public.council_contribution_charges (
      village_council_id, job_card_number, charge_type, fto_transaction_id,
      source_calculation_id, current_amount, is_active, created_by, tag_id
    ) values (
      p_village_council_id, v_tx.job_card_number, 'regular_co', p_fto_transaction_id,
      v_item.calculation_id, v_new_amount, true, v_actor, v_tx.current_co_tag_id
    ) returning * into v_charge;

    insert into public.council_contribution_charge_revisions (
      village_council_id, charge_id, revision_number, previous_amount, new_amount,
      previous_is_active, new_is_active, source_calculation_id, actor_id, change_source
    ) values (
      p_village_council_id, v_charge.id, 1, null, v_new_amount,
      null, true, v_item.calculation_id, v_actor, p_change_source
    );
    return;
  end if;

  -- Tag changes are grouping metadata, not financial charge revisions.
  if v_charge.tag_id is distinct from v_tx.current_co_tag_id then
    update public.council_contribution_charges
    set tag_id = v_tx.current_co_tag_id, updated_at = now()
    where id = v_charge.id and village_council_id = p_village_council_id;
  end if;

  if v_charge.current_amount is distinct from v_new_amount
     or v_charge.is_active is distinct from v_new_active
     or v_charge.source_calculation_id is distinct from v_item.calculation_id then
    update public.council_contribution_charges
    set current_amount = v_new_amount,
        is_active = v_new_active,
        source_calculation_id = v_item.calculation_id,
        updated_at = now()
    where id = v_charge.id and village_council_id = p_village_council_id;

    select coalesce(max(r.revision_number), 0) + 1 into v_revision
    from public.council_contribution_charge_revisions r
    where r.charge_id = v_charge.id;

    insert into public.council_contribution_charge_revisions (
      village_council_id, charge_id, revision_number, previous_amount, new_amount,
      previous_is_active, new_is_active, source_calculation_id, actor_id, change_source
    ) values (
      p_village_council_id, v_charge.id, v_revision, v_charge.current_amount, v_new_amount,
      v_charge.is_active, v_new_active, v_item.calculation_id, v_actor, p_change_source
    );
  end if;
end;
$function$;


commit;
