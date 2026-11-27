-- Atomic Job Card payment operations.
-- Payment creation/correction and FIFO allocation commit or roll back together.
-- The idempotency key prevents a retried create request from recording money twice.

begin;

alter table public.council_payments
  add column idempotency_key uuid;

create unique index council_payments_idempotency_unique
  on public.council_payments(village_council_id, idempotency_key)
  where idempotency_key is not null;

create or replace function public.record_council_job_card_payment(
  p_village_council_id uuid,
  p_job_card_number text,
  p_amount numeric,
  p_idempotency_key uuid,
  p_receipt_reference text default null,
  p_remarks text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $record_payment$
declare
  v_actor uuid := auth.uid();
  v_payment_id uuid;
  v_existing public.council_payments%rowtype;
  v_fifo_result jsonb;
begin
  if v_actor is null then
    raise exception 'Authentication is required.';
  end if;
  if p_amount is null or p_amount <= 0 or p_amount <> round(p_amount, 2) then
    raise exception 'Payment amount must be greater than zero and have at most two decimal places.';
  end if;
  if p_idempotency_key is null then
    raise exception 'An idempotency key is required.';
  end if;
  if not exists (
    select 1 from public.council_memberships m
    where m.village_council_id = p_village_council_id
      and m.user_id = v_actor and m.is_active = true
  ) then
    raise exception 'You are not an active member of this Village Council.';
  end if;

  -- Serialize retries using a transaction-scoped advisory lock derived from
  -- the tenant and request key. A duplicate request returns the original row.
  perform pg_advisory_xact_lock(hashtextextended(
    p_village_council_id::text || ':' || p_idempotency_key::text, 0
  ));

  select * into v_existing
  from public.council_payments p
  where p.village_council_id = p_village_council_id
    and p.idempotency_key = p_idempotency_key;

  if found then
    if v_existing.job_card_number <> p_job_card_number
       or v_existing.amount <> p_amount
       or v_existing.payment_method <> 'cash'
       or v_existing.receipt_reference is distinct from nullif(btrim(p_receipt_reference), '')
       or v_existing.remarks is distinct from nullif(btrim(p_remarks), '') then
      raise exception 'This idempotency key was already used for a different payment request.';
    end if;
    return jsonb_build_object('success', true, 'duplicate_request', true, 'payment_id', v_existing.id);
  end if;

  insert into public.council_payments (
    village_council_id, job_card_number, payment_method, amount,
    receipt_reference, remarks, recorded_by, idempotency_key
  ) values (
    p_village_council_id, p_job_card_number, 'cash', p_amount,
    nullif(btrim(p_receipt_reference), ''), nullif(btrim(p_remarks), ''), v_actor,
    p_idempotency_key
  ) returning id into v_payment_id;

  insert into public.council_payment_events (
    village_council_id, payment_id, event_type, new_amount, new_method,
    new_receipt_reference, new_remarks, actor_id
  ) values (
    p_village_council_id, v_payment_id, 'created', p_amount, 'cash',
    nullif(btrim(p_receipt_reference), ''), nullif(btrim(p_remarks), ''), v_actor
  );

  v_fifo_result := public.run_council_job_card_fifo(
    p_village_council_id, p_job_card_number, 'payment_created', v_actor,
    'Cash payment recorded'
  );

  return jsonb_build_object(
    'success', true, 'duplicate_request', false, 'payment_id', v_payment_id,
    'fifo', v_fifo_result
  );
end;
$record_payment$;

create or replace function public.record_council_job_card_paid_in_full(
  p_village_council_id uuid,
  p_job_card_number text,
  p_idempotency_key uuid,
  p_receipt_reference text default null,
  p_remarks text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $paid_in_full$
declare
  v_actor uuid := auth.uid();
  v_outstanding numeric(14,2);
  v_existing public.council_payments%rowtype;
  v_payment_result jsonb;
begin
  if v_actor is null then
    raise exception 'Authentication is required.';
  end if;
  if p_idempotency_key is null then
    raise exception 'An idempotency key is required.';
  end if;
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
  from public.council_payments p
  where p.village_council_id = p_village_council_id
    and p.idempotency_key = p_idempotency_key;

  if found then
    if v_existing.job_card_number <> p_job_card_number
       or v_existing.payment_method <> 'cash'
       or v_existing.receipt_reference is distinct from nullif(btrim(p_receipt_reference), '')
       or v_existing.remarks is distinct from nullif(btrim(p_remarks), '') then
      raise exception 'This idempotency key was already used for a different payment request.';
    end if;
    return jsonb_build_object('success', true, 'duplicate_request', true, 'payment_id', v_existing.id);
  end if;

  perform 1
  from public.council_job_cards j
  where j.village_council_id = p_village_council_id
    and j.job_card_number = p_job_card_number
  for update;

  if not found then
    raise exception 'Job Card not found in this Village Council.';
  end if;

  select coalesce(sum(ch.current_amount), 0)
    - coalesce((
      select sum(a.allocated_amount)
      from public.council_payment_allocations a
      where a.village_council_id = p_village_council_id
        and a.job_card_number = p_job_card_number
    ), 0)
    - coalesce((
      select sum(w.amount)
      from public.council_contribution_waivers w
      where w.village_council_id = p_village_council_id
        and w.job_card_number = p_job_card_number
    ), 0)
  into v_outstanding
  from public.council_contribution_charges ch
  where ch.village_council_id = p_village_council_id
    and ch.job_card_number = p_job_card_number
    and ch.is_active = true;

  if v_outstanding <= 0 then
    raise exception 'There is no positive outstanding balance to settle.';
  end if;

  v_payment_result := public.record_council_job_card_payment(
    p_village_council_id, p_job_card_number, v_outstanding,
    p_idempotency_key, p_receipt_reference, p_remarks
  );

  return v_payment_result || jsonb_build_object('paid_in_full_amount', v_outstanding);
end;
$paid_in_full$;

create or replace function public.correct_council_job_card_payment(
  p_village_council_id uuid,
  p_payment_id uuid,
  p_new_amount numeric,
  p_new_method text,
  p_new_receipt_reference text,
  p_new_remarks text,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $correct_payment$
declare
  v_actor uuid := auth.uid();
  v_payment public.council_payments%rowtype;
  v_fifo_result jsonb;
begin
  if v_actor is null then
    raise exception 'Authentication is required.';
  end if;
  if p_new_amount is null or p_new_amount <= 0 or p_new_amount <> round(p_new_amount, 2) then
    raise exception 'Corrected payment amount must be greater than zero and have at most two decimal places.';
  end if;
  if p_new_method not in ('cash', 'bank') then
    raise exception 'Payment method must be CASH or BANK.';
  end if;
  if length(btrim(coalesce(p_reason, ''))) = 0 then
    raise exception 'A correction reason is required.';
  end if;
  if not exists (
    select 1 from public.council_memberships m
    where m.village_council_id = p_village_council_id
      and m.user_id = v_actor and m.is_active = true
  ) then
    raise exception 'You are not an active member of this Village Council.';
  end if;

  select * into v_payment
  from public.council_payments p
  where p.id = p_payment_id and p.village_council_id = p_village_council_id
  for update;

  if not found then
    raise exception 'Payment not found in this Village Council.';
  end if;

  if p_new_amount < (
    coalesce((select sum(r.amount) from public.council_payment_refunds r
      where r.village_council_id = p_village_council_id
        and r.payment_id = p_payment_id), 0)
    + coalesce((select sum(a.allocated_amount) from public.council_payment_allocations a
      where a.village_council_id = p_village_council_id
        and a.payment_id = p_payment_id
        and a.allocation_type = 'historical_fifo_reviewed'), 0)
  ) then
    raise exception 'Corrected payment amount cannot be lower than amounts already refunded or fixed by historical allocations.';
  end if;

  if v_payment.amount = p_new_amount
     and v_payment.payment_method = p_new_method
     and v_payment.receipt_reference is not distinct from nullif(btrim(p_new_receipt_reference), '')
     and v_payment.remarks is not distinct from nullif(btrim(p_new_remarks), '') then
    raise exception 'No payment changes were supplied.';
  end if;

  update public.council_payments
  set amount = p_new_amount,
      payment_method = p_new_method,
      receipt_reference = nullif(btrim(p_new_receipt_reference), ''),
      remarks = nullif(btrim(p_new_remarks), ''),
      updated_at = now()
  where id = p_payment_id and village_council_id = p_village_council_id;

  insert into public.council_payment_events (
    village_council_id, payment_id, event_type,
    previous_amount, new_amount, previous_method, new_method,
    previous_receipt_reference, new_receipt_reference,
    previous_remarks, new_remarks, reason, actor_id
  ) values (
    p_village_council_id, p_payment_id, 'corrected',
    v_payment.amount, p_new_amount, v_payment.payment_method, p_new_method,
    v_payment.receipt_reference, nullif(btrim(p_new_receipt_reference), ''),
    v_payment.remarks, nullif(btrim(p_new_remarks), ''), btrim(p_reason), v_actor
  );

  v_fifo_result := public.run_council_job_card_fifo(
    p_village_council_id, v_payment.job_card_number, 'payment_corrected', v_actor,
    btrim(p_reason)
  );

  return jsonb_build_object(
    'success', true, 'payment_id', p_payment_id,
    'fifo', v_fifo_result
  );
end;
$correct_payment$;

revoke all on function public.record_council_job_card_payment(uuid, text, numeric, uuid, text, text) from public, anon, authenticated;
revoke all on function public.record_council_job_card_paid_in_full(uuid, text, uuid, text, text) from public, anon, authenticated;
revoke all on function public.correct_council_job_card_payment(uuid, uuid, numeric, text, text, text, text) from public, anon, authenticated;

grant execute on function public.record_council_job_card_payment(uuid, text, numeric, uuid, text, text) to authenticated;
grant execute on function public.record_council_job_card_paid_in_full(uuid, text, uuid, text, text) to authenticated;
grant execute on function public.correct_council_job_card_payment(uuid, uuid, numeric, text, text, text, text) to authenticated;

commit;
