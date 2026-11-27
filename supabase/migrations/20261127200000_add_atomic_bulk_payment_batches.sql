-- Confirm all-or-nothing bulk payment batches.
-- Every submitted line must validate before any financial row is written.

begin;

alter table public.council_payment_batches
  add column idempotency_key uuid,
  add column payload_hash text;

create unique index council_payment_batches_idempotency_unique
  on public.council_payment_batches(village_council_id, idempotency_key)
  where idempotency_key is not null;

create or replace function public.record_council_bulk_payment_batch(
  p_village_council_id uuid,
  p_payment_method text,
  p_lines jsonb,
  p_idempotency_key uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $record_bulk_batch$
declare
  v_actor uuid := auth.uid();
  v_existing public.council_payment_batches%rowtype;
  v_batch_id uuid;
  v_batch_reference text;
  v_line_count integer;
  v_total numeric(14,2);
  v_invalid jsonb;
  v_fifo_results jsonb;
  v_payload_hash text := md5(p_lines::text);
begin
  if v_actor is null then raise exception 'Authentication is required.'; end if;
  if p_payment_method not in ('cash', 'bank') then
    raise exception 'Payment method must be CASH or BANK.';
  end if;
  if p_idempotency_key is null then raise exception 'An idempotency key is required.'; end if;
  if jsonb_typeof(p_lines) is distinct from 'array' or jsonb_array_length(p_lines) = 0 then
    raise exception 'Provide at least one validated payment line.';
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
  from public.council_payment_batches b
  where b.village_council_id = p_village_council_id
    and b.idempotency_key = p_idempotency_key;
  if found then
    if v_existing.payment_method <> p_payment_method
       or v_existing.line_count <> jsonb_array_length(p_lines)
       or v_existing.payload_hash is distinct from v_payload_hash then
      raise exception 'This idempotency key was already used for a different bulk payment batch.';
    end if;
    return jsonb_build_object(
      'success', true, 'duplicate_request', true,
      'batch_id', v_existing.id, 'batch_reference', v_existing.batch_reference,
      'line_count', v_existing.line_count, 'total_amount', v_existing.total_amount
    );
  end if;

  -- Revalidate the complete submitted payload in the database. No writes occur
  -- unless every line is valid and every Job Card belongs to this Council.
  with submitted as (
    select
      ordinality::integer as line_number,
      nullif(btrim(value->>'job_card_number'), '') as job_card_number,
      case
        when coalesce(value->>'amount', '') ~ '^[0-9]+([.][0-9]{1,2})?$'
        then (value->>'amount')::numeric(14,2)
        else null
      end as amount
    from jsonb_array_elements(p_lines) with ordinality
  ),
  checked as (
    select s.*,
      count(*) over (partition by s.job_card_number) as duplicate_count,
      exists (
        select 1 from public.council_job_cards j
        where j.village_council_id = p_village_council_id
          and j.job_card_number = s.job_card_number
      ) as job_card_exists
    from submitted s
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'line_number', line_number,
    'job_card_number', job_card_number,
    'amount', amount,
    'issue', case
      when job_card_number is null then 'Missing Job Card Number.'
      when duplicate_count > 1 then 'Duplicate Job Card Number.'
      when not job_card_exists then 'Job Card not found in this Village Council.'
      when amount is null or amount <= 0 then 'Amount must be positive with at most two decimal places.'
      else null
    end
  ) order by line_number) filter (
    where job_card_number is null
       or duplicate_count > 1
       or not job_card_exists
       or amount is null
       or amount <= 0
  ), '[]'::jsonb)
  into v_invalid
  from checked;

  if jsonb_array_length(v_invalid) > 0 then
    raise exception 'Bulk payment rejected: every line must be valid. Issues: %', v_invalid;
  end if;

  select count(*), sum((value->>'amount')::numeric(14,2))
  into v_line_count, v_total
  from jsonb_array_elements(p_lines);

  -- Lock all target Job Cards in deterministic order before inserting payments.
  perform j.job_card_number
  from public.council_job_cards j
  join (
    select distinct value->>'job_card_number' as job_card_number
    from jsonb_array_elements(p_lines)
  ) s on s.job_card_number = j.job_card_number
  where j.village_council_id = p_village_council_id
  order by j.job_card_number
  for update of j;

  v_batch_id := gen_random_uuid();
  v_batch_reference := 'BULK-' || to_char(clock_timestamp(), 'YYYYMMDDHH24MISSMS')
    || '-' || upper(substr(replace(v_batch_id::text, '-', ''), 1, 8));

  insert into public.council_payment_batches (
    id, village_council_id, batch_reference, payment_method,
    recorded_by, line_count, total_amount, idempotency_key, payload_hash
  ) values (
    v_batch_id, p_village_council_id, v_batch_reference, p_payment_method,
    v_actor, v_line_count, v_total, p_idempotency_key, v_payload_hash
  );

  insert into public.council_payments (
    village_council_id, job_card_number, batch_id, payment_method,
    amount, recorded_by, idempotency_key
  )
  select
    p_village_council_id,
    value->>'job_card_number',
    v_batch_id,
    p_payment_method,
    (value->>'amount')::numeric(14,2),
    v_actor,
    gen_random_uuid()
  from jsonb_array_elements(p_lines);

  insert into public.council_payment_events (
    village_council_id, payment_id, event_type, new_amount,
    new_method, actor_id
  )
  select
    p.village_council_id, p.id, 'created', p.amount,
    p.payment_method, v_actor
  from public.council_payments p
  where p.village_council_id = p_village_council_id
    and p.batch_id = v_batch_id;

  select coalesce(jsonb_agg(result order by job_card_number), '[]'::jsonb)
  into v_fifo_results
  from (
    select
      x.job_card_number,
      public.run_council_job_card_fifo(
        p_village_council_id, x.job_card_number, 'payment_created',
        v_actor, 'Bulk payment batch ' || v_batch_reference
      ) as result
    from (
      select distinct value->>'job_card_number' as job_card_number
      from jsonb_array_elements(p_lines)
    ) x
  ) fifo;

  return jsonb_build_object(
    'success', true, 'duplicate_request', false,
    'batch_id', v_batch_id, 'batch_reference', v_batch_reference,
    'line_count', v_line_count, 'total_amount', v_total,
    'payment_method', p_payment_method, 'fifo', v_fifo_results
  );
end;
$record_bulk_batch$;

revoke all on function public.record_council_bulk_payment_batch(uuid, text, jsonb, uuid) from public, anon, authenticated;
grant execute on function public.record_council_bulk_payment_batch(uuid, text, jsonb, uuid) to authenticated;

commit;
