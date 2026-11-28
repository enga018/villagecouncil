-- Tagged single-Job-Card Manual/Extra Charge creation.
-- The original individual RPC predates charge Tags and is revoked by the
-- tagged batch migration. This RPC preserves its atomic ledger/FIFO behavior
-- while requiring an active Council Tag.

begin;

create or replace function public.create_council_tagged_manual_charge(
  p_village_council_id uuid,
  p_job_card_number text,
  p_description text,
  p_amount numeric,
  p_tag_id uuid,
  p_idempotency_key uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $create_tagged_manual_charge$
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
  if p_tag_id is null or not exists (
    select 1 from public.council_co_tags t
    where t.id = p_tag_id and t.village_council_id = p_village_council_id
      and t.is_archived = false
  ) then
    raise exception 'Select an active Tag belonging to this Village Council.';
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
    v_charge_id := v_existing.charge_id;
    if v_existing.event_type <> 'created' or v_existing.new_amount <> p_amount
       or not exists (
         select 1 from public.council_contribution_charges ch
         where ch.id = v_charge_id
           and ch.village_council_id = p_village_council_id
           and ch.job_card_number = p_job_card_number
           and ch.description = btrim(p_description)
           and ch.tag_id = p_tag_id
       ) then
      raise exception 'This idempotency key was already used for a different Manual/Extra Charge request.';
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
    current_amount, is_active, created_by, tag_id
  ) values (
    p_village_council_id, p_job_card_number, 'manual_extra', btrim(p_description),
    p_amount, true, v_actor, p_tag_id
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
$create_tagged_manual_charge$;

revoke all on function public.create_council_tagged_manual_charge(uuid, text, text, numeric, uuid, uuid) from public, anon, authenticated;
grant execute on function public.create_council_tagged_manual_charge(uuid, text, text, numeric, uuid, uuid) to authenticated;

commit;
