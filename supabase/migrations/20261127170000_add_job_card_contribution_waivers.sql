-- Immutable Job Card contribution waivers.
-- One active Council administrator records and approves each waiver.
-- A mandatory reason and idempotency key protect the audit trail and retries.

begin;

create table public.council_contribution_waivers (
  id uuid primary key default gen_random_uuid(),
  village_council_id uuid not null,
  job_card_number text not null,
  amount numeric(14,2) not null check (amount > 0),
  reason text not null check (length(btrim(reason)) > 0),
  recorded_by uuid not null references auth.users(id) on delete restrict,
  approved_by uuid not null references auth.users(id) on delete restrict,
  recorded_at timestamptz not null default now(),
  approved_at timestamptz not null default now(),
  idempotency_key uuid not null,
  constraint council_contribution_waivers_job_card_fk
    foreign key (village_council_id, job_card_number)
    references public.council_job_cards(village_council_id, job_card_number) on delete restrict,
  constraint council_contribution_waivers_idempotency_unique
    unique (village_council_id, idempotency_key),
  constraint council_contribution_waivers_id_tenant_unique
    unique (id, village_council_id)
);

create index council_contribution_waivers_job_card_idx
  on public.council_contribution_waivers(village_council_id, job_card_number, recorded_at);

create or replace function public.prevent_council_contribution_waiver_mutation()
returns trigger
language plpgsql
set search_path = ''
as $waiver_guard$
begin
  raise exception 'Waiver records cannot be updated or deleted.';
end;
$waiver_guard$;

create trigger council_contribution_waivers_immutable
before update or delete on public.council_contribution_waivers
for each row execute function public.prevent_council_contribution_waiver_mutation();

alter table public.council_contribution_waivers enable row level security;
revoke all on table public.council_contribution_waivers from anon, authenticated;
grant select on table public.council_contribution_waivers to authenticated;
create policy council_contribution_waivers_active_council_member_read
on public.council_contribution_waivers
for select to authenticated
using (exists (
  select 1 from public.council_memberships m
  where m.village_council_id = council_contribution_waivers.village_council_id
    and m.user_id = (select auth.uid()) and m.is_active = true
));

create or replace function public.record_council_job_card_waiver(
  p_village_council_id uuid,
  p_job_card_number text,
  p_amount numeric,
  p_reason text,
  p_idempotency_key uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $record_waiver$
declare
  v_actor uuid := auth.uid();
  v_outstanding numeric(14,2);
  v_waiver_id uuid;
  v_existing public.council_contribution_waivers%rowtype;
  v_fifo_result jsonb;
begin
  if v_actor is null then raise exception 'Authentication is required.'; end if;
  if p_amount is null or p_amount <= 0 or p_amount <> round(p_amount, 2) then
    raise exception 'Waiver amount must be greater than zero and have at most two decimal places.';
  end if;
  if length(btrim(coalesce(p_reason, ''))) = 0 then
    raise exception 'A waiver reason is required.';
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
  from public.council_contribution_waivers w
  where w.village_council_id = p_village_council_id
    and w.idempotency_key = p_idempotency_key;
  if found then
    if v_existing.job_card_number <> p_job_card_number
       or v_existing.amount <> p_amount
       or v_existing.reason <> btrim(p_reason) then
      raise exception 'This idempotency key was already used for a different waiver.';
    end if;
    return jsonb_build_object(
      'success', true, 'duplicate_request', true, 'waiver_id', v_existing.id
    );
  end if;

  perform 1
  from public.council_job_cards j
  where j.village_council_id = p_village_council_id
    and j.job_card_number = p_job_card_number
  for update;
  if not found then raise exception 'Job Card not found in this Village Council.'; end if;

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
    raise exception 'A waiver is available only when the Job Card has a positive outstanding balance.';
  end if;
  if p_amount > v_outstanding then
    raise exception 'Waiver amount exceeds the current outstanding balance of %.', v_outstanding;
  end if;

  insert into public.council_contribution_waivers (
    village_council_id, job_card_number, amount, reason,
    recorded_by, approved_by, idempotency_key
  ) values (
    p_village_council_id, p_job_card_number, p_amount, btrim(p_reason),
    v_actor, v_actor, p_idempotency_key
  ) returning id into v_waiver_id;

  v_fifo_result := public.run_council_job_card_fifo(
    p_village_council_id, p_job_card_number, 'waiver', v_actor,
    btrim(p_reason)
  );

  return jsonb_build_object(
    'success', true, 'duplicate_request', false, 'waiver_id', v_waiver_id,
    'amount', p_amount, 'approved_by', v_actor, 'fifo', v_fifo_result
  );
end;
$record_waiver$;

revoke all on function public.prevent_council_contribution_waiver_mutation() from public, anon, authenticated;
revoke all on function public.record_council_job_card_waiver(uuid, text, numeric, text, uuid) from public, anon, authenticated;
grant execute on function public.record_council_job_card_waiver(uuid, text, numeric, text, uuid) to authenticated;

commit;
