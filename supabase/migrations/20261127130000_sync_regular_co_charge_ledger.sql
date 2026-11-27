-- Synchronize the current Regular CO Charge projection from the confirmed
-- FTO calculation and current terminal Government transaction status.

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
as $sync_charge$
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
    f.latest_co_calculation_id
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
      source_calculation_id, current_amount, is_active, created_by
    ) values (
      p_village_council_id, v_tx.job_card_number, 'regular_co', p_fto_transaction_id,
      v_item.calculation_id, v_new_amount, true, v_actor
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
$sync_charge$;

create or replace function public.sync_council_regular_co_charges_for_fto()
returns trigger
language plpgsql
security definer
set search_path = ''
as $sync_fto$
declare
  v_transaction_id uuid;
begin
  for v_transaction_id in
    select t.id
    from public.council_fto_transactions t
    where t.village_council_id = new.village_council_id
      and t.fto_id = new.id
    order by t.id
  loop
    perform public.sync_council_regular_co_charge(
      new.village_council_id, v_transaction_id, 'co_recalculation', auth.uid()
    );
  end loop;
  return new;
end;
$sync_fto$;

create trigger council_fto_sync_regular_charges_after_calculation
after update of latest_co_calculation_id on public.council_ftos
for each row
when (old.latest_co_calculation_id is distinct from new.latest_co_calculation_id)
execute function public.sync_council_regular_co_charges_for_fto();

create or replace function public.sync_council_regular_co_charge_after_status_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $sync_status$
begin
  if old.normalized_status is distinct from new.normalized_status then
    perform public.sync_council_regular_co_charge(
      new.village_council_id, new.id, 'government_status', auth.uid()
    );
  end if;
  return new;
end;
$sync_status$;

create trigger council_fto_transaction_sync_regular_charge_after_status
after update of normalized_status on public.council_fto_transactions
for each row
when (old.normalized_status is distinct from new.normalized_status)
execute function public.sync_council_regular_co_charge_after_status_change();

create or replace function public.sync_council_regular_co_charge_after_exempt_mark()
returns trigger
language plpgsql
security definer
set search_path = ''
as $sync_exempt$
begin
  perform public.sync_council_regular_co_charge(
    new.village_council_id, new.fto_transaction_id, 'permanent_exempt_mark', auth.uid()
  );
  return new;
end;
$sync_exempt$;

create trigger council_fto_transaction_sync_regular_charge_after_exempt_mark
after insert on public.council_co_exempt_transactions
for each row execute function public.sync_council_regular_co_charge_after_exempt_mark();

revoke all on function public.sync_council_regular_co_charge(uuid, uuid, text, uuid) from public, anon, authenticated;
revoke all on function public.sync_council_regular_co_charges_for_fto() from public, anon, authenticated;
revoke all on function public.sync_council_regular_co_charge_after_status_change() from public, anon, authenticated;
revoke all on function public.sync_council_regular_co_charge_after_exempt_mark() from public, anon, authenticated;

commit;
