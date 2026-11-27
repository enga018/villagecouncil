-- Job Card overpayment refunds.
-- Refunds are separate immutable records. Original payments are never reduced
-- or deleted; FIFO capacity is reduced by the sum of recorded refunds.

begin;

create table public.council_payment_refunds (
  id uuid primary key default gen_random_uuid(),
  village_council_id uuid not null,
  job_card_number text not null,
  payment_id uuid not null,
  amount numeric(14,2) not null check (amount > 0),
  reason text not null check (length(btrim(reason)) > 0),
  refunded_at timestamptz not null default now(),
  recorded_by uuid not null references auth.users(id) on delete restrict,
  idempotency_key uuid not null,
  created_at timestamptz not null default now(),
  constraint council_payment_refunds_payment_fk
    foreign key (payment_id, village_council_id, job_card_number)
    references public.council_payments(id, village_council_id, job_card_number) on delete restrict,
  constraint council_payment_refunds_idempotency_unique
    unique (village_council_id, idempotency_key),
  constraint council_payment_refunds_id_tenant_unique
    unique (id, village_council_id)
);

create index council_payment_refunds_job_card_idx
  on public.council_payment_refunds(village_council_id, job_card_number, refunded_at);

create or replace function public.prevent_council_payment_refund_mutation()
returns trigger
language plpgsql
set search_path = ''
as $refund_guard$
begin
  raise exception 'Refund records cannot be updated or deleted.';
end;
$refund_guard$;

create trigger council_payment_refunds_immutable
before update or delete on public.council_payment_refunds
for each row execute function public.prevent_council_payment_refund_mutation();

alter table public.council_payment_refunds enable row level security;
revoke all on table public.council_payment_refunds from anon, authenticated;
grant select on table public.council_payment_refunds to authenticated;
create policy council_payment_refunds_active_council_member_read
on public.council_payment_refunds
for select to authenticated
using (exists (
  select 1 from public.council_memberships m
  where m.village_council_id = council_payment_refunds.village_council_id
    and m.user_id = (select auth.uid()) and m.is_active = true
));

-- Rebuild the payment workset using net payment capacity after refunds.
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
  v_existing_allocation boolean;
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
    'charge_reversed', 'charge_reinstated', 'co_recalculation', 'government_status',
    'permanent_exempt_mark', 'waiver', 'refund', 'historical_import', 'manual_reconciliation'
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

  perform 1 from public.council_job_cards j
  where j.village_council_id = p_village_council_id
    and j.job_card_number = p_job_card_number
  for update;
  if not found then
    raise exception 'Job Card not found in this Village Council.';
  end if;

  insert into public.council_fifo_runs (
    village_council_id, job_card_number, trigger_type, status, initiated_by
  ) values (p_village_council_id, p_job_card_number, p_trigger_type, 'running', v_actor)
  returning id into v_run_id;

  select exists (
    select 1
    from public.council_payment_allocations a
    join public.council_payments p
      on p.id = a.payment_id and p.village_council_id = a.village_council_id
    where a.village_council_id = p_village_council_id
      and a.job_card_number = p_job_card_number
      and a.allocation_type = 'historical_fifo_reviewed'
    group by p.id, p.amount
    having sum(a.allocated_amount) > p.amount - coalesce((
      select sum(r.amount) from public.council_payment_refunds r
      where r.payment_id = p.id and r.village_council_id = p_village_council_id
    ), 0)
  ) into v_fixed_payment_conflict;
  if v_fixed_payment_conflict then
    raise exception 'Fixed historical allocations exceed the remaining payment capacity after refunds.';
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

  drop table if exists pg_temp.fifo_work_charges;
  drop table if exists pg_temp.fifo_work_payments;

  create temporary table fifo_work_charges (
    charge_id uuid primary key, remaining numeric(14,2) not null,
    chronology_at timestamptz not null, tie_breaker uuid not null
  ) on commit drop;
  create temporary table fifo_work_payments (
    payment_id uuid primary key, remaining numeric(14,2) not null,
    paid_at timestamptz not null, tie_breaker uuid not null
  ) on commit drop;

  insert into pg_temp.fifo_work_charges (charge_id, remaining, chronology_at, tie_breaker)
  select ch.id,
    greatest(0,
      ch.current_amount
      - coalesce(fixed.amount, 0)
      - greatest(0, coalesce(waiver_totals.amount, 0) - coalesce(prior_charges.amount, 0))
    ),
    case when ch.charge_type = 'regular_co'
      then coalesce(tx.transaction_date::timestamp at time zone 'UTC', tx.first_imported_at)
      else ch.original_created_at end,
    case when ch.charge_type = 'regular_co' then tx.id else ch.id end
  from public.council_contribution_charges ch
  left join public.council_fto_transactions tx
    on tx.id = ch.fto_transaction_id and tx.village_council_id = ch.village_council_id
  left join lateral (
    select sum(w.amount) as amount
    from public.council_contribution_waivers w
    where w.village_council_id = ch.village_council_id
      and w.job_card_number = ch.job_card_number
  ) waiver_totals on true
  left join lateral (
    select sum(greatest(0, older.current_amount - coalesce(older_fixed.amount, 0))) as amount
    from public.council_contribution_charges older
    left join public.council_fto_transactions older_tx
      on older_tx.id = older.fto_transaction_id
     and older_tx.village_council_id = older.village_council_id
    left join lateral (
      select sum(oa.allocated_amount) as amount
      from public.council_payment_allocations oa
      where oa.village_council_id = older.village_council_id
        and oa.charge_id = older.id
        and oa.allocation_type = 'historical_fifo_reviewed'
    ) older_fixed on true
    where older.village_council_id = ch.village_council_id
      and older.job_card_number = ch.job_card_number
      and older.is_active and older.current_amount > 0
      and (
        case when older.charge_type = 'regular_co'
          then coalesce(older_tx.transaction_date::timestamp at time zone 'UTC', older_tx.first_imported_at)
          else older.original_created_at end,
        case when older.charge_type = 'regular_co' then older_tx.id else older.id end
      ) < (
        case when ch.charge_type = 'regular_co'
          then coalesce(tx.transaction_date::timestamp at time zone 'UTC', tx.first_imported_at)
          else ch.original_created_at end,
        case when ch.charge_type = 'regular_co' then tx.id else ch.id end
      )
  ) prior_charges on true
  left join lateral (
    select sum(a.allocated_amount) as amount
    from public.council_payment_allocations a
    where a.village_council_id = ch.village_council_id
      and a.charge_id = ch.id and a.allocation_type = 'historical_fifo_reviewed'
  ) fixed on true
  where ch.village_council_id = p_village_council_id
    and ch.job_card_number = p_job_card_number and ch.is_active and ch.current_amount > 0;

  insert into pg_temp.fifo_work_payments (payment_id, remaining, paid_at, tie_breaker)
  select p.id,
    greatest(0, p.amount
      - coalesce(fixed.amount, 0)
      - coalesce(refunds.amount, 0)),
    p.paid_at, p.id
  from public.council_payments p
  left join lateral (
    select sum(a.allocated_amount) as amount
    from public.council_payment_allocations a
    where a.village_council_id = p.village_council_id
      and a.payment_id = p.id and a.allocation_type = 'historical_fifo_reviewed'
  ) fixed on true
  left join lateral (
    select sum(r.amount) as amount
    from public.council_payment_refunds r
    where r.village_council_id = p.village_council_id and r.payment_id = p.id
  ) refunds on true
  where p.village_council_id = p_village_council_id
    and p.job_card_number = p_job_card_number and p.amount > 0;

  for v_charge in
    select a.id, a.payment_id, a.charge_id, a.allocated_amount
    from public.council_payment_allocations a
    where a.village_council_id = p_village_council_id
      and a.job_card_number = p_job_card_number
      and a.allocation_type = 'fifo_auto' and a.allocated_amount > 0
    for update
  loop
    update public.council_payment_allocations
    set allocated_amount = 0, updated_at = now() where id = v_charge.id;
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

  for v_charge in
    select charge_id, remaining from pg_temp.fifo_work_charges
    where remaining > 0 order by chronology_at, tie_breaker
  loop
    for v_payment in
      select payment_id, remaining from pg_temp.fifo_work_payments
      where remaining > 0 order by paid_at, tie_breaker
    loop
      exit when v_charge.remaining <= 0;
      v_amount := least(v_charge.remaining, v_payment.remaining);
      if v_amount <= 0 then continue; end if;

      select a.id, a.allocated_amount
      into v_allocation_id, v_previous_auto_amount
      from public.council_payment_allocations a
      where a.village_council_id = p_village_council_id
        and a.payment_id = v_payment.payment_id
        and a.charge_id = v_charge.charge_id
        and a.allocation_type = 'fifo_auto'
      for update;

      v_existing_allocation := found;
      if v_existing_allocation then
        update public.council_payment_allocations
        set allocated_amount = v_amount, updated_at = now()
        where id = v_allocation_id;
      else
        insert into public.council_payment_allocations (
          village_council_id, job_card_number, payment_id, charge_id,
          allocated_amount, allocation_type
        ) values (
          p_village_council_id, p_job_card_number, v_payment.payment_id,
          v_charge.charge_id, v_amount, 'fifo_auto'
        ) returning id into v_allocation_id;
      end if;

      insert into public.council_allocation_events (
        village_council_id, fifo_run_id, allocation_id, payment_id, charge_id,
        job_card_number, event_type, amount, allocation_type, reason, actor_id
      ) values (
        p_village_council_id, v_run_id, v_allocation_id, v_payment.payment_id,
        v_charge.charge_id, p_job_card_number,
        case when v_existing_allocation then 'reallocated' else 'allocated' end,
        v_amount, 'fifo_auto', coalesce(p_reason, 'Automatic FIFO allocation'), v_actor
      );

      update pg_temp.fifo_work_charges set remaining = remaining - v_amount
      where charge_id = v_charge.charge_id;
      update pg_temp.fifo_work_payments set remaining = remaining - v_amount
      where payment_id = v_payment.payment_id;
      v_charge.remaining := v_charge.remaining - v_amount;
      v_allocated_total := v_allocated_total + v_amount;
      v_allocation_count := v_allocation_count + 1;
    end loop;
  end loop;

  update public.council_fifo_runs
  set status = 'completed', completed_at = now(),
      context = jsonb_build_object(
        'released_amount', v_released_total, 'allocated_amount', v_allocated_total,
        'allocation_count', v_allocation_count, 'reason', p_reason
      )
  where id = v_run_id and village_council_id = p_village_council_id;

  return jsonb_build_object(
    'success', true, 'fifo_run_id', v_run_id, 'job_card_number', p_job_card_number,
    'released_amount', v_released_total, 'allocated_amount', v_allocated_total,
    'allocation_count', v_allocation_count
  );
end;
$fifo$;

create or replace function public.refund_council_job_card_payment(
  p_village_council_id uuid,
  p_payment_id uuid,
  p_amount numeric,
  p_reason text,
  p_idempotency_key uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $refund_payment$
declare
  v_actor uuid := auth.uid();
  v_payment public.council_payments%rowtype;
  v_refunded numeric(14,2);
  v_allocated numeric(14,2);
  v_fixed_allocated numeric(14,2);
  v_job_card_credit numeric(14,2);
  v_payment_refundable numeric(14,2);
  v_refund_id uuid;
  v_fifo_result jsonb;
  v_existing public.council_payment_refunds%rowtype;
begin
  if v_actor is null then raise exception 'Authentication is required.'; end if;
  if p_amount is null or p_amount <= 0 or p_amount <> round(p_amount, 2) then
    raise exception 'Refund amount must be greater than zero and have at most two decimal places.';
  end if;
  if length(btrim(coalesce(p_reason, ''))) = 0 then
    raise exception 'A refund reason is required.';
  end if;
  if p_idempotency_key is null then raise exception 'An idempotency key is required.'; end if;
  if not exists (
    select 1 from public.council_memberships m
    where m.village_council_id = p_village_council_id
      and m.user_id = v_actor and m.is_active = true
  ) then
    raise exception 'You are not an active member of this Village Council.';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(
    p_village_council_id::text || ':' || p_idempotency_key::text, 0
  ));

  select * into v_existing
  from public.council_payment_refunds r
  where r.village_council_id = p_village_council_id
    and r.idempotency_key = p_idempotency_key;
  if found then
    if v_existing.payment_id <> p_payment_id
       or v_existing.amount <> p_amount
       or v_existing.reason <> btrim(p_reason) then
      raise exception 'This idempotency key was already used for a different refund.';
    end if;
    return jsonb_build_object('success', true, 'duplicate_request', true, 'refund_id', v_existing.id);
  end if;

  select * into v_payment
  from public.council_payments p
  where p.id = p_payment_id and p.village_council_id = p_village_council_id
  for update;
  if not found then raise exception 'Payment not found in this Village Council.'; end if;

  perform 1 from public.council_job_cards j
  where j.village_council_id = p_village_council_id
    and j.job_card_number = v_payment.job_card_number
  for update;

  select coalesce(sum(r.amount), 0) into v_refunded
  from public.council_payment_refunds r where r.payment_id = p_payment_id;

  select coalesce(sum(a.allocated_amount), 0) into v_allocated
  from public.council_payment_allocations a
  where a.village_council_id = p_village_council_id
    and a.job_card_number = v_payment.job_card_number;

  select coalesce(sum(a.allocated_amount), 0) into v_fixed_allocated
  from public.council_payment_allocations a
  where a.payment_id = p_payment_id
    and a.allocation_type = 'historical_fifo_reviewed';

  select coalesce(sum(p.amount), 0)
    - coalesce((select sum(r.amount) from public.council_payment_refunds r
      where r.village_council_id = p_village_council_id
        and r.job_card_number = v_payment.job_card_number), 0)
    - v_allocated
  into v_job_card_credit
  from public.council_payments p
  where p.village_council_id = p_village_council_id
    and p.job_card_number = v_payment.job_card_number;

  -- Refunds are limited by the Job Card's actual overpaid credit and by the
  -- selected payment's capacity after refunds and fixed historical allocations.
  -- Automatic allocations may be released/rebuilt by the FIFO run below.
  v_payment_refundable := v_payment.amount - v_refunded - v_fixed_allocated;
  if v_job_card_credit <= 0 or p_amount > v_job_card_credit
     or p_amount > v_payment_refundable then
    raise exception 'Refund exceeds available Job Card overpaid credit or the selected payment capacity. Job Card credit: %, payment capacity: %',
      greatest(v_job_card_credit, 0), greatest(v_payment_refundable, 0);
  end if;

  insert into public.council_payment_refunds (
    village_council_id, job_card_number, payment_id, amount, reason,
    recorded_by, idempotency_key
  ) values (
    p_village_council_id, v_payment.job_card_number, p_payment_id,
    p_amount, btrim(p_reason), v_actor, p_idempotency_key
  ) returning id into v_refund_id;

  v_fifo_result := public.run_council_job_card_fifo(
    p_village_council_id, v_payment.job_card_number, 'refund', v_actor,
    btrim(p_reason)
  );

  return jsonb_build_object(
    'success', true, 'duplicate_request', false, 'refund_id', v_refund_id,
    'payment_id', p_payment_id, 'amount', p_amount, 'fifo', v_fifo_result
  );
end;
$refund_payment$;

revoke all on function public.prevent_council_payment_refund_mutation() from public, anon, authenticated;
revoke all on function public.refund_council_job_card_payment(uuid, uuid, numeric, text, uuid) from public, anon, authenticated;
grant execute on function public.refund_council_job_card_payment(uuid, uuid, numeric, text, uuid) to authenticated;

commit;
