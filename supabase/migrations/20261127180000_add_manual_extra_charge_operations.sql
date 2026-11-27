-- Manual/Extra Charge lifecycle: create, correct and reverse.
-- All writes are tenant-scoped, idempotent and atomic with FIFO.

begin;

alter table public.council_manual_charge_events
  add column idempotency_key uuid;

create unique index council_manual_charge_events_idempotency_unique
  on public.council_manual_charge_events(village_council_id, idempotency_key)
  where idempotency_key is not null;

create or replace function public.create_council_manual_charge(
  p_village_council_id uuid,
  p_job_card_number text,
  p_description text,
  p_amount numeric,
  p_idempotency_key uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $create_manual_charge$
declare
  v_actor uuid := auth.uid();
  v_charge_id uuid;
  v_existing public.council_manual_charge_events%rowtype;
  v_fifo_result jsonb;
begin
  if v_actor is null then raise exception 'Authentication is required.'; end if;
  if p_amount is null or p_amount <= 0 or p_amount <> round(p_amount, 2) then
    raise exception 'Charge amount must be greater than zero and have at most two decimal places.';
  end if;
  if length(btrim(coalesce(p_description, ''))) = 0 then
    raise exception 'A charge description is required.';
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
  from public.council_manual_charge_events e
  where e.village_council_id = p_village_council_id
    and e.idempotency_key = p_idempotency_key;
  if found then
    select e.charge_id into v_charge_id
    from public.council_manual_charge_events e
    where e.id = v_existing.id;
    if v_existing.event_type <> 'created'
       or v_existing.new_amount <> p_amount then
      raise exception 'This idempotency key was already used for a different manual charge request.';
    end if;
    if not exists (
      select 1 from public.council_contribution_charges ch
      where ch.id = v_charge_id
        and ch.village_council_id = p_village_council_id
        and ch.job_card_number = p_job_card_number
        and ch.description = btrim(p_description)
    ) then
      raise exception 'This idempotency key was already used for a different manual charge request.';
    end if;
    return jsonb_build_object('success', true, 'duplicate_request', true, 'charge_id', v_charge_id);
  end if;

  perform 1 from public.council_job_cards j
  where j.village_council_id = p_village_council_id
    and j.job_card_number = p_job_card_number
  for update;
  if not found then raise exception 'Job Card not found in this Village Council.'; end if;

  insert into public.council_contribution_charges (
    village_council_id, job_card_number, charge_type, description,
    current_amount, is_active, created_by
  ) values (
    p_village_council_id, p_job_card_number, 'manual_extra', btrim(p_description),
    p_amount, true, v_actor
  ) returning id into v_charge_id;

  insert into public.council_manual_charge_events (
    village_council_id, charge_id, event_type, previous_amount,
    new_amount, actor_id, idempotency_key
  ) values (
    p_village_council_id, v_charge_id, 'created', null,
    p_amount, v_actor, p_idempotency_key
  );

  v_fifo_result := public.run_council_job_card_fifo(
    p_village_council_id, p_job_card_number, 'charge_created', v_actor,
    'Manual/Extra Charge created'
  );

  return jsonb_build_object(
    'success', true, 'duplicate_request', false, 'charge_id', v_charge_id,
    'fifo', v_fifo_result
  );
end;
$create_manual_charge$;

create or replace function public.correct_council_manual_charge(
  p_village_council_id uuid,
  p_charge_id uuid,
  p_new_amount numeric,
  p_reason text,
  p_idempotency_key uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $correct_manual_charge$
declare
  v_actor uuid := auth.uid();
  v_charge public.council_contribution_charges%rowtype;
  v_existing public.council_manual_charge_events%rowtype;
  v_revision integer;
  v_fifo_result jsonb;
begin
  if v_actor is null then raise exception 'Authentication is required.'; end if;
  if p_new_amount is null or p_new_amount <= 0 or p_new_amount <> round(p_new_amount, 2) then
    raise exception 'Corrected charge amount must be greater than zero and have at most two decimal places.';
  end if;
  if length(btrim(coalesce(p_reason, ''))) = 0 then raise exception 'A correction reason is required.'; end if;
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
  from public.council_manual_charge_events e
  where e.village_council_id = p_village_council_id
    and e.idempotency_key = p_idempotency_key;
  if found then
    if v_existing.event_type <> 'corrected'
       or v_existing.charge_id <> p_charge_id
       or v_existing.new_amount <> p_new_amount
       or v_existing.reason <> btrim(p_reason) then
      raise exception 'This idempotency key was already used for a different correction.';
    end if;
    return jsonb_build_object('success', true, 'duplicate_request', true, 'charge_id', p_charge_id);
  end if;

  select * into v_charge
  from public.council_contribution_charges ch
  where ch.id = p_charge_id
    and ch.village_council_id = p_village_council_id
    and ch.charge_type = 'manual_extra'
  for update;
  if not found then raise exception 'Manual/Extra Charge not found in this Village Council.'; end if;
  if not v_charge.is_active then raise exception 'A reversed Manual/Extra Charge cannot be corrected.'; end if;
  if v_charge.current_amount = p_new_amount then raise exception 'The corrected amount is unchanged.'; end if;

  perform 1 from public.council_job_cards j
  where j.village_council_id = p_village_council_id
    and j.job_card_number = v_charge.job_card_number
  for update;

  update public.council_contribution_charges
  set current_amount = p_new_amount, updated_at = now()
  where id = p_charge_id and village_council_id = p_village_council_id;

  select coalesce(max(r.revision_number), 0) + 1 into v_revision
  from public.council_contribution_charge_revisions r
  where r.charge_id = p_charge_id;

  insert into public.council_contribution_charge_revisions (
    village_council_id, charge_id, revision_number, previous_amount, new_amount,
    previous_is_active, new_is_active, reason, actor_id, change_source
  ) values (
    p_village_council_id, p_charge_id, v_revision, v_charge.current_amount,
    p_new_amount, true, true, btrim(p_reason), v_actor, 'manual_correction'
  );

  insert into public.council_manual_charge_events (
    village_council_id, charge_id, event_type, previous_amount,
    new_amount, reason, actor_id, idempotency_key
  ) values (
    p_village_council_id, p_charge_id, 'corrected', v_charge.current_amount,
    p_new_amount, btrim(p_reason), v_actor, p_idempotency_key
  );

  v_fifo_result := public.run_council_job_card_fifo(
    p_village_council_id, v_charge.job_card_number, 'charge_corrected', v_actor,
    btrim(p_reason)
  );

  return jsonb_build_object('success', true, 'duplicate_request', false, 'charge_id', p_charge_id, 'fifo', v_fifo_result);
end;
$correct_manual_charge$;

create or replace function public.reverse_council_manual_charge(
  p_village_council_id uuid,
  p_charge_id uuid,
  p_reason text,
  p_confirm boolean,
  p_idempotency_key uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $reverse_manual_charge$
declare
  v_actor uuid := auth.uid();
  v_charge public.council_contribution_charges%rowtype;
  v_existing public.council_manual_charge_events%rowtype;
  v_revision integer;
  v_fifo_result jsonb;
begin
  if v_actor is null then raise exception 'Authentication is required.'; end if;
  if p_confirm is distinct from true then raise exception 'Explicit reversal confirmation is required.'; end if;
  if length(btrim(coalesce(p_reason, ''))) = 0 then raise exception 'A reversal reason is required.'; end if;
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
  from public.council_manual_charge_events e
  where e.village_council_id = p_village_council_id
    and e.idempotency_key = p_idempotency_key;
  if found then
    if v_existing.event_type <> 'reversed'
       or v_existing.charge_id <> p_charge_id
       or v_existing.reason <> btrim(p_reason) then
      raise exception 'This idempotency key was already used for a different reversal.';
    end if;
    return jsonb_build_object('success', true, 'duplicate_request', true, 'charge_id', p_charge_id);
  end if;

  select * into v_charge
  from public.council_contribution_charges ch
  where ch.id = p_charge_id
    and ch.village_council_id = p_village_council_id
    and ch.charge_type = 'manual_extra'
  for update;
  if not found then raise exception 'Manual/Extra Charge not found in this Village Council.'; end if;
  if not v_charge.is_active then raise exception 'Manual/Extra Charge is already reversed.'; end if;

  perform 1 from public.council_job_cards j
  where j.village_council_id = p_village_council_id
    and j.job_card_number = v_charge.job_card_number
  for update;

  update public.council_contribution_charges
  set is_active = false, updated_at = now()
  where id = p_charge_id and village_council_id = p_village_council_id;

  select coalesce(max(r.revision_number), 0) + 1 into v_revision
  from public.council_contribution_charge_revisions r
  where r.charge_id = p_charge_id;

  insert into public.council_contribution_charge_revisions (
    village_council_id, charge_id, revision_number, previous_amount, new_amount,
    previous_is_active, new_is_active, reason, actor_id, change_source
  ) values (
    p_village_council_id, p_charge_id, v_revision, v_charge.current_amount,
    v_charge.current_amount, true, false, btrim(p_reason), v_actor, 'reversal'
  );

  insert into public.council_manual_charge_events (
    village_council_id, charge_id, event_type, previous_amount,
    new_amount, reason, actor_id, idempotency_key
  ) values (
    p_village_council_id, p_charge_id, 'reversed', v_charge.current_amount,
    v_charge.current_amount, btrim(p_reason), v_actor, p_idempotency_key
  );

  v_fifo_result := public.run_council_job_card_fifo(
    p_village_council_id, v_charge.job_card_number, 'charge_reversed', v_actor,
    btrim(p_reason)
  );

  return jsonb_build_object('success', true, 'duplicate_request', false, 'charge_id', p_charge_id, 'fifo', v_fifo_result);
end;
$reverse_manual_charge$;

revoke all on function public.create_council_manual_charge(uuid, text, text, numeric, uuid) from public, anon, authenticated;
revoke all on function public.correct_council_manual_charge(uuid, uuid, numeric, text, uuid) from public, anon, authenticated;
revoke all on function public.reverse_council_manual_charge(uuid, uuid, text, boolean, uuid) from public, anon, authenticated;

grant execute on function public.create_council_manual_charge(uuid, text, text, numeric, uuid) to authenticated;
grant execute on function public.correct_council_manual_charge(uuid, uuid, numeric, text, uuid) to authenticated;
grant execute on function public.reverse_council_manual_charge(uuid, uuid, text, boolean, uuid) to authenticated;

commit;
