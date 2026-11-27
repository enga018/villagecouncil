-- Keep Regular CO charge grouping synchronized with each source FTO's current Tag.
-- Historical calculation tag snapshots remain unchanged.
begin;

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
begin
  if p_change_source not in ('co_recalculation', 'government_status', 'permanent_exempt_mark') then
    raise exception 'Unsupported Regular CO charge synchronization source.';
  end if;

  select
    t.id,
    t.village_council_id,
    t.job_card_number,
    t.normalized_status,
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

  select i.calculation_id, i.co_amount, i.is_exempt, c.created_by
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

  v_eligible := v_tx.normalized_status = 'processed'
    and not v_item.is_exempt
    and not exists (
      select 1
      from public.council_co_exempt_transactions x
      where x.village_council_id = p_village_council_id
        and x.fto_transaction_id = p_fto_transaction_id
    );

  v_new_amount := case when v_eligible then v_item.co_amount else 0 end;
  v_new_active := v_eligible;
  v_actor := coalesce(p_actor_id, v_item.created_by);

  select * into v_charge
  from public.council_contribution_charges ch
  where ch.village_council_id = p_village_council_id
    and ch.fto_transaction_id = p_fto_transaction_id
    and ch.charge_type = 'regular_co'
  for update;

  if not found then
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

create or replace function public.set_council_fto_tag(
  p_actor_id uuid,
  p_fto_id uuid,
  p_tag_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_tenant_id uuid;
  v_fto public.council_ftos%rowtype;
  v_tag public.council_co_tags%rowtype;
  v_updated_charge_count integer := 0;
begin
  if p_actor_id is null then raise exception 'An authenticated actor is required.'; end if;

  select m.village_council_id into v_tenant_id
  from public.council_memberships m
  where m.user_id = p_actor_id and m.is_active = true limit 1;
  if v_tenant_id is null then raise exception 'No active Village Council membership was found.'; end if;

  select * into v_fto
  from public.council_ftos f
  where f.id = p_fto_id and f.village_council_id = v_tenant_id and f.status = 'active'
  for update;
  if not found then raise exception 'FTO not found or not available to this Village Council.'; end if;

  select * into v_tag
  from public.council_co_tags t
  where t.id = p_tag_id and t.village_council_id = v_tenant_id and t.is_archived = false;
  if not found then raise exception 'Select an active FTO tag.'; end if;

  if v_fto.current_co_tag_id is distinct from v_tag.id then
    update public.council_ftos
    set current_co_tag_id = v_tag.id, updated_at = now()
    where id = p_fto_id and village_council_id = v_tenant_id;

    insert into public.council_co_tag_events (
      village_council_id, fto_id, tag_id, previous_tag_id, action, actor_id
    ) values (
      v_tenant_id, p_fto_id, v_tag.id, v_fto.current_co_tag_id,
      case when v_fto.current_co_tag_id is null then 'assigned' else 'reassigned' end,
      p_actor_id
    );

    update public.council_contribution_charges
    set tag_id = v_tag.id, updated_at = now()
    where village_council_id = v_tenant_id
      and charge_type = 'regular_co'
      and fto_transaction_id in (
        select t.id
        from public.council_fto_transactions t
        where t.village_council_id = v_tenant_id and t.fto_id = p_fto_id
      )
      and tag_id is distinct from v_tag.id;

    get diagnostics v_updated_charge_count = row_count;
  end if;

  return jsonb_build_object(
    'success', true,
    'tag_id', v_tag.id,
    'tag_name', v_tag.name,
    'updated_regular_charge_count', v_updated_charge_count
  );
end;
$function$;

-- Reconcile existing Regular CO charges to the current FTO-level Tag.
-- This changes grouping metadata only; amounts, payment records, allocations,
-- calculation snapshots and charge chronology are untouched.
update public.council_contribution_charges ch
set tag_id = f.current_co_tag_id,
    updated_at = now()
from public.council_fto_transactions tx
join public.council_ftos f
  on f.id = tx.fto_id and f.village_council_id = tx.village_council_id
where ch.village_council_id = tx.village_council_id
  and ch.fto_transaction_id = tx.id
  and ch.charge_type = 'regular_co'
  and f.current_co_tag_id is not null
  and ch.tag_id is distinct from f.current_co_tag_id;

revoke execute on function public.set_council_fto_tag(uuid,uuid,uuid) from public, anon, authenticated;
grant execute on function public.set_council_fto_tag(uuid,uuid,uuid) to service_role;

commit;
