-- Job Card FIFO engine.
-- A single chronological queue is shared by Regular CO and Manual/Extra Charges.
-- Existing historical_fifo_reviewed allocations are immutable and consume both
-- payment capacity and charge capacity before automatic allocation is rebuilt.

begin;

create or replace function public.run_council_job_card_fifo(
  p_village_council_id uuid,
  p_job_card_number text,
  p_trigger_type text,
  p_actor_id uuid,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fifo$
declare
  v_run_id uuid;
  v_charge record;
  v_payment record;
  v_allocation_id uuid;
  v_previous_auto_amount numeric(14,2);
  v_amount numeric(14,2);
  v_allocated_total numeric(14,2) := 0;
  v_released_total numeric(14,2) := 0;
  v_allocation_count integer := 0;
  v_actor uuid := p_actor_id;
  v_fixed_payment_conflict boolean;
  v_fixed_charge_conflict boolean;
begin
  if v_actor is null then
    raise exception 'An authenticated administrator is required.';
  end if;

  if p_trigger_type not in (
    'payment_created', 'payment_corrected', 'charge_created', 'charge_corrected',
    'charge_reversed', 'charge_reinstated', 'co_recalculation', 'waiver', 'refund',
    'historical_import', 'manual_reconciliation'
  ) then
    raise exception 'Unsupported FIFO trigger type.';
  end if;

  if not exists (
    select 1 from public.council_memberships m
    where m.village_council_id = p_village_council_id
      and m.user_id = v_actor and m.is_active = true
  ) then
    raise exception 'The administrator has no active membership in this Village Council.';
  end if;

  -- Serialize all financial operations for this Job Card.
  perform 1
  from public.council_job_cards j
  where j.village_council_id = p_village_council_id
    and j.job_card_number = p_job_card_number
  for update;

  if not found then
    raise exception 'Job Card not found in this Village Council.';
  end if;

  insert into public.council_fifo_runs (
    village_council_id, job_card_number, trigger_type, status, initiated_by
  ) values (
    p_village_council_id, p_job_card_number, p_trigger_type, 'running', v_actor
  ) returning id into v_run_id;

  -- Fixed historical allocations must fit within both their original payment
  -- and the current charge value. Never release or rewrite these allocations.
  select exists (
    select 1
    from public.council_payment_allocations a
    join public.council_payments p
      on p.id = a.payment_id and p.village_council_id = a.village_council_id
    where a.village_council_id = p_village_council_id
      and a.job_card_number = p_job_card_number
      and a.allocation_type = 'historical_fifo_reviewed'
    group by p.id, p.amount
    having sum(a.allocated_amount) > p.amount
  ) into v_fixed_payment_conflict;

  if v_fixed_payment_conflict then
    raise exception 'Fixed historical allocations exceed a payment amount. The financial change cannot be applied.';
  end if;

  select exists (
    select 1
    from public.council_payment_allocations a
    join public.council_contribution_charges ch
      on ch.id = a.charge_id and ch.village_council_id = a.village_council_id
    where a.village_council_id = p_village_council_id
      and a.job_card_number = p_job_card_number
      and a.allocation_type = 'historical_fifo_reviewed'
    group by ch.id, ch.current_amount
    having sum(a.allocated_amount) > ch.current_amount
  ) into v_fixed_charge_conflict;

  if v_fixed_charge_conflict then
    raise exception 'Fixed historical allocations exceed a charge amount. The financial change cannot be applied.';
  end if;

  create temporary table fifo_work_charges (
    charge_id uuid primary key,
    remaining numeric(14,2) not null,
    chronology_at timestamptz not null,
    tie_breaker uuid not null
  ) on commit drop;

  create temporary table fifo_work_payments (
    payment_id uuid primary key,
    remaining numeric(14,2) not null,
    paid_at timestamptz not null,
    tie_breaker uuid not null
  ) on commit drop;

  insert into pg_temp.fifo_work_charges (charge_id, remaining, chronology_at, tie_breaker)
  select
    ch.id,
    greatest(0, ch.current_amount - coalesce(fixed.amount, 0)),
    case
      when ch.charge_type = 'regular_co' then
        coalesce(tx.transaction_date::timestamp at time zone 'UTC', tx.first_imported_at)
      else ch.original_created_at
    end,
    case when ch.charge_type = 'regular_co' then tx.id else ch.id end
  from public.council_contribution_charges ch
  left join public.council_fto_transactions tx
    on tx.id = ch.fto_transaction_id and tx.village_council_id = ch.village_council_id
  left join lateral (
    select sum(a.allocated_amount) as amount
    from public.council_payment_allocations a
    where a.village_council_id = ch.village_council_id
      and a.charge_id = ch.id
      and a.allocation_type = 'historical_fifo_reviewed'
  ) fixed on true
  where ch.village_council_id = p_village_council_id
    and ch.job_card_number = p_job_card_number
    and ch.is_active = true
    and ch.current_amount > 0;

  insert into pg_temp.fifo_work_payments (payment_id, remaining, paid_at, tie_breaker)
  select
    p.id,
    greatest(0, p.amount - coalesce(fixed.amount, 0)),
    p.paid_at,
    p.id
  from public.council_payments p
  left join lateral (
    select sum(a.allocated_amount) as amount
    from public.council_payment_allocations a
    where a.village_council_id = p.village_council_id
      and a.payment_id = p.id
      and a.allocation_type = 'historical_fifo_reviewed'
  ) fixed on true
  where p.village_council_id = p_village_council_id
    and p.job_card_number = p_job_card_number
    and p.amount > 0;

  -- Release the previous automatic state, retaining its rows for stable identity
  -- and retaining every release in the append-only event stream.
  for v_charge in
    select a.id, a.payment_id, a.charge_id, a.allocated_amount
    from public.council_payment_allocations a
    where a.village_council_id = p_village_council_id
      and a.job_card_number = p_job_card_number
      and a.allocation_type = 'fifo_auto'
      and a.allocated_amount > 0
    for update
  loop
    update public.council_payment_allocations
    set allocated_amount = 0, updated_at = now()
    where id = v_charge.id;

    insert into public.council_allocation_events (
      village_council_id, fifo_run_id, allocation_id, payment_id, charge_id,
      job_card_number, event_type, amount, allocation_type, reason, actor_id
    ) values (
      p_village_council_id, v_run_id, v_charge.id, v_charge.payment_id, v_charge.charge_id,
      p_job_card_number, 'released', v_charge.allocated_amount, 'fifo_auto',
      coalesce(p_reason, 'Automatic FIFO allocation rebuilt'), v_actor
    );

    v_released_total := v_released_total + v_charge.allocated_amount;
  end loop;

  -- Unified FIFO: oldest charge first; for each charge, consume oldest available
  -- payment first. Charge type is not a priority.
  for v_charge in
    select charge_id, remaining
    from pg_temp.fifo_work_charges
    where remaining > 0
    order by chronology_at asc, tie_breaker asc
  loop
    for v_payment in
      select payment_id, remaining
      from pg_temp.fifo_work_payments
      where remaining > 0
      order by paid_at asc, tie_breaker asc
    loop
      exit when v_charge.remaining <= 0;

      v_amount := least(v_charge.remaining, v_payment.remaining);
      if v_amount <= 0 then
        continue;
      end if;

      select a.id, a.allocated_amount
      into v_allocation_id, v_previous_auto_amount
      from public.council_payment_allocations a
      where a.village_council_id = p_village_council_id
        and a.payment_id = v_payment.payment_id
        and a.charge_id = v_charge.charge_id
        and a.allocation_type = 'fifo_auto'
      for update;

      if found then
        update public.council_payment_allocations
        set allocated_amount = v_amount, updated_at = now()
        where id = v_allocation_id;
      else
        insert into public.council_payment_allocations (
          village_council_id, job_card_number, payment_id, charge_id,
          allocated_amount, allocation_type
        ) values (
          p_village_council_id, p_job_card_number, v_payment.payment_id, v_charge.charge_id,
          v_amount, 'fifo_auto'
        ) returning id into v_allocation_id;
        v_previous_auto_amount := 0;
      end if;

      insert into public.council_allocation_events (
        village_council_id, fifo_run_id, allocation_id, payment_id, charge_id,
        job_card_number, event_type, amount, allocation_type, reason, actor_id
      ) values (
        p_village_council_id, v_run_id, v_allocation_id, v_payment.payment_id, v_charge.charge_id,
        p_job_card_number,
        case when v_previous_auto_amount > 0 then 'reallocated' else 'allocated' end,
        v_amount, 'fifo_auto',
        coalesce(p_reason, 'Automatic FIFO allocation'), v_actor
      );

      update pg_temp.fifo_work_charges
      set remaining = remaining - v_amount
      where charge_id = v_charge.charge_id;

      update pg_temp.fifo_work_payments
      set remaining = remaining - v_amount
      where payment_id = v_payment.payment_id;

      v_charge.remaining := v_charge.remaining - v_amount;
      v_allocated_total := v_allocated_total + v_amount;
      v_allocation_count := v_allocation_count + 1;
    end loop;
  end loop;

  update public.council_fifo_runs
  set status = 'completed',
      completed_at = now(),
      context = jsonb_build_object(
        'released_amount', v_released_total,
        'allocated_amount', v_allocated_total,
        'allocation_count', v_allocation_count,
        'reason', p_reason
      )
  where id = v_run_id and village_council_id = p_village_council_id;

  return jsonb_build_object(
    'success', true,
    'fifo_run_id', v_run_id,
    'job_card_number', p_job_card_number,
    'released_amount', v_released_total,
    'allocated_amount', v_allocated_total,
    'allocation_count', v_allocation_count
  );
end;
$fifo$;

revoke all on function public.run_council_job_card_fifo(uuid, text, text, uuid, text) from public, anon, authenticated;
grant execute on function public.run_council_job_card_fifo(uuid, text, text, uuid, text) to service_role;

commit;
