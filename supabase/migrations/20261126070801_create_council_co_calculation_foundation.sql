begin;

create table public.council_co_settings (
  village_council_id uuid primary key references public.council_tenants(id) on delete restrict,
  divisor integer not null default 300 check (divisor > 0),
  multiplier integer not null default 100 check (multiplier > 0),
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now()
);
insert into public.council_co_settings (village_council_id)
select id from public.council_tenants on conflict (village_council_id) do nothing;

create table public.council_co_settings_history (
  id uuid primary key default gen_random_uuid(),
  village_council_id uuid not null references public.council_tenants(id) on delete restrict,
  previous_divisor integer not null check (previous_divisor > 0),
  previous_multiplier integer not null check (previous_multiplier > 0),
  new_divisor integer not null check (new_divisor > 0),
  new_multiplier integer not null check (new_multiplier > 0),
  reason text not null check (length(btrim(reason)) between 3 and 1000),
  changed_by uuid not null references auth.users(id) on delete restrict,
  changed_at timestamptz not null default now()
);

create table public.council_co_tags (
  id uuid primary key default gen_random_uuid(),
  village_council_id uuid not null references public.council_tenants(id) on delete restrict,
  name text not null check (length(btrim(name)) between 1 and 60),
  is_archived boolean not null default false,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, village_council_id)
);
create unique index council_co_tags_tenant_name_unique
  on public.council_co_tags (village_council_id, lower(btrim(name)));

create table public.council_co_tag_events (
  id uuid primary key default gen_random_uuid(),
  village_council_id uuid not null references public.council_tenants(id) on delete restrict,
  fto_id uuid,
  tag_id uuid,
  previous_tag_id uuid,
  action text not null check (action in ('created','renamed','assigned','reassigned','archived','restored')),
  previous_name text,
  new_name text,
  actor_id uuid not null references auth.users(id) on delete restrict,
  reason text,
  created_at timestamptz not null default now(),
  foreign key (fto_id, village_council_id) references public.council_ftos(id, village_council_id) on delete restrict,
  foreign key (tag_id, village_council_id) references public.council_co_tags(id, village_council_id) on delete restrict,
  foreign key (previous_tag_id, village_council_id) references public.council_co_tags(id, village_council_id) on delete restrict
);

create table public.council_co_exemption_intervals (
  id uuid primary key default gen_random_uuid(),
  village_council_id uuid not null references public.council_tenants(id) on delete restrict,
  job_card_number text not null,
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  add_reason text not null check (length(btrim(add_reason)) between 3 and 1000),
  remove_reason text,
  added_by uuid not null references auth.users(id) on delete restrict,
  removed_by uuid references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, village_council_id),
  foreign key (village_council_id, job_card_number) references public.council_job_cards(village_council_id, job_card_number) on delete restrict,
  check (ended_at is null or ended_at > started_at),
  check ((ended_at is null and remove_reason is null and removed_by is null)
      or (ended_at is not null and length(btrim(coalesce(remove_reason,''))) >= 3 and removed_by is not null))
);
create unique index council_co_one_open_exemption_per_job_card
  on public.council_co_exemption_intervals (village_council_id, job_card_number)
  where ended_at is null;

alter table public.council_fto_transactions
  add constraint council_fto_transactions_id_tenant_unique unique (id, village_council_id);

create table public.council_co_exempt_transactions (
  id uuid primary key default gen_random_uuid(),
  village_council_id uuid not null references public.council_tenants(id) on delete restrict,
  fto_transaction_id uuid not null,
  exemption_interval_id uuid not null,
  first_imported_at timestamptz not null,
  marked_by uuid references auth.users(id) on delete set null,
  marked_at timestamptz not null default now(),
  unique (fto_transaction_id),
  foreign key (fto_transaction_id, village_council_id) references public.council_fto_transactions(id, village_council_id) on delete restrict,
  foreign key (exemption_interval_id, village_council_id) references public.council_co_exemption_intervals(id, village_council_id) on delete restrict
);

alter table public.council_ftos
  add column current_co_tag_id uuid,
  add column latest_co_calculation_id uuid,
  add column co_calculation_version integer not null default 0 check (co_calculation_version >= 0);
alter table public.council_ftos
  add constraint council_ftos_current_co_tag_fk
  foreign key (current_co_tag_id, village_council_id) references public.council_co_tags(id, village_council_id) on delete restrict;

create table public.council_fto_co_calculations (
  id uuid primary key default gen_random_uuid(),
  village_council_id uuid not null references public.council_tenants(id) on delete restrict,
  fto_id uuid not null,
  version integer not null check (version > 0),
  tag_id uuid not null,
  tag_name_snapshot text not null,
  divisor integer not null check (divisor > 0),
  multiplier integer not null check (multiplier > 0),
  transaction_count integer not null check (transaction_count >= 0),
  total_credit_amount numeric(16,2) not null check (total_credit_amount >= 0),
  total_co_amount numeric(16,2) not null check (total_co_amount >= 0),
  exempt_count integer not null check (exempt_count >= 0),
  chargeable_count integer not null check (chargeable_count >= 0),
  idempotency_key uuid not null,
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  unique (id, village_council_id),
  unique (fto_id, version),
  unique (village_council_id, idempotency_key),
  foreign key (fto_id, village_council_id) references public.council_ftos(id, village_council_id) on delete restrict,
  foreign key (tag_id, village_council_id) references public.council_co_tags(id, village_council_id) on delete restrict
);

create table public.council_fto_co_calculation_items (
  id uuid primary key default gen_random_uuid(),
  village_council_id uuid not null references public.council_tenants(id) on delete restrict,
  calculation_id uuid not null,
  fto_transaction_id uuid not null,
  job_card_number text not null,
  applicant_name text,
  credit_amount numeric(16,2) not null check (credit_amount >= 0),
  co_amount numeric(16,2) not null check (co_amount >= 0),
  is_exempt boolean not null default false,
  exemption_interval_id uuid,
  first_imported_at timestamptz not null,
  created_at timestamptz not null default now(),
  unique (calculation_id, fto_transaction_id),
  foreign key (calculation_id, village_council_id) references public.council_fto_co_calculations(id, village_council_id) on delete restrict,
  foreign key (fto_transaction_id, village_council_id) references public.council_fto_transactions(id, village_council_id) on delete restrict,
  foreign key (exemption_interval_id, village_council_id) references public.council_co_exemption_intervals(id, village_council_id) on delete restrict
);
alter table public.council_ftos
  add constraint council_ftos_latest_co_calculation_fk
  foreign key (latest_co_calculation_id, village_council_id) references public.council_fto_co_calculations(id, village_council_id) on delete restrict;

create index council_fto_co_calculations_fto_version_idx on public.council_fto_co_calculations (village_council_id, fto_id, version desc);
create index council_fto_co_calculation_items_transaction_idx on public.council_fto_co_calculation_items (village_council_id, fto_transaction_id);
create index council_co_exemption_intervals_job_card_idx on public.council_co_exemption_intervals (village_council_id, job_card_number, started_at desc);

alter table public.council_co_settings enable row level security;
alter table public.council_co_settings_history enable row level security;
alter table public.council_co_tags enable row level security;
alter table public.council_co_tag_events enable row level security;
alter table public.council_co_exemption_intervals enable row level security;
alter table public.council_co_exempt_transactions enable row level security;
alter table public.council_fto_co_calculations enable row level security;
alter table public.council_fto_co_calculation_items enable row level security;

revoke all on public.council_co_settings from anon, authenticated;
revoke all on public.council_co_settings_history from anon, authenticated;
revoke all on public.council_co_tags from anon, authenticated;
revoke all on public.council_co_tag_events from anon, authenticated;
revoke all on public.council_co_exemption_intervals from anon, authenticated;
revoke all on public.council_co_exempt_transactions from anon, authenticated;
revoke all on public.council_fto_co_calculations from anon, authenticated;
revoke all on public.council_fto_co_calculation_items from anon, authenticated;
grant select on public.council_co_settings to authenticated;
grant select on public.council_co_settings_history to authenticated;
grant select on public.council_co_tags to authenticated;
grant select on public.council_co_tag_events to authenticated;
grant select on public.council_co_exemption_intervals to authenticated;
grant select on public.council_co_exempt_transactions to authenticated;
grant select on public.council_fto_co_calculations to authenticated;
grant select on public.council_fto_co_calculation_items to authenticated;

create policy "Council members can read their CO settings" on public.council_co_settings for select to authenticated
using (exists (select 1 from public.council_memberships m where m.village_council_id = council_co_settings.village_council_id and m.user_id = (select auth.uid()) and m.is_active = true));
create policy "Council members can read their CO settings history" on public.council_co_settings_history for select to authenticated
using (exists (select 1 from public.council_memberships m where m.village_council_id = council_co_settings_history.village_council_id and m.user_id = (select auth.uid()) and m.is_active = true));
create policy "Council members can read their CO tags" on public.council_co_tags for select to authenticated
using (exists (select 1 from public.council_memberships m where m.village_council_id = council_co_tags.village_council_id and m.user_id = (select auth.uid()) and m.is_active = true));
create policy "Council members can read their CO tag events" on public.council_co_tag_events for select to authenticated
using (exists (select 1 from public.council_memberships m where m.village_council_id = council_co_tag_events.village_council_id and m.user_id = (select auth.uid()) and m.is_active = true));
create policy "Council members can read their CO exemption intervals" on public.council_co_exemption_intervals for select to authenticated
using (exists (select 1 from public.council_memberships m where m.village_council_id = council_co_exemption_intervals.village_council_id and m.user_id = (select auth.uid()) and m.is_active = true));
create policy "Council members can read their permanent CO exemption marks" on public.council_co_exempt_transactions for select to authenticated
using (exists (select 1 from public.council_memberships m where m.village_council_id = council_co_exempt_transactions.village_council_id and m.user_id = (select auth.uid()) and m.is_active = true));
create policy "Council members can read their FTO CO calculations" on public.council_fto_co_calculations for select to authenticated
using (exists (select 1 from public.council_memberships m where m.village_council_id = council_fto_co_calculations.village_council_id and m.user_id = (select auth.uid()) and m.is_active = true));
create policy "Council members can read their FTO CO calculation items" on public.council_fto_co_calculation_items for select to authenticated
using (exists (select 1 from public.council_memberships m where m.village_council_id = council_fto_co_calculation_items.village_council_id and m.user_id = (select auth.uid()) and m.is_active = true));

create or replace function public.apply_council_fto_co_calculation(
  p_actor_id uuid, p_fto_id uuid, p_tag_id uuid,
  p_expected_settings_updated_at timestamptz,
  p_expected_transaction_count integer,
  p_expected_latest_transaction_updated_at timestamptz,
  p_idempotency_key uuid
) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_tenant_id uuid;
  v_fto public.council_ftos%rowtype;
  v_settings public.council_co_settings%rowtype;
  v_tag public.council_co_tags%rowtype;
  v_transaction_count integer;
  v_latest_transaction_updated_at timestamptz;
  v_version integer;
  v_calculation_id uuid;
  v_total_credit numeric(16,2);
  v_total_co numeric(16,2);
  v_exempt_count integer;
  v_actor uuid := p_actor_id;
begin
  if v_actor is null then raise exception 'An authenticated actor is required.'; end if;
  select m.village_council_id into v_tenant_id from public.council_memberships m where m.user_id = v_actor and m.is_active = true limit 1;
  if v_tenant_id is null then raise exception 'No active Village Council membership was found.'; end if;

  select * into v_fto from public.council_ftos f
  where f.id = p_fto_id and f.village_council_id = v_tenant_id and f.status = 'active' for update;
  if not found then raise exception 'FTO not found or not available to this Village Council.'; end if;

  select c.id into v_calculation_id from public.council_fto_co_calculations c
  where c.village_council_id = v_tenant_id and c.idempotency_key = p_idempotency_key;
  if v_calculation_id is not null then
    return jsonb_build_object('success', true, 'idempotent_replay', true, 'calculation_id', v_calculation_id);
  end if;

  select * into v_settings from public.council_co_settings s where s.village_council_id = v_tenant_id for share;
  if not found then raise exception 'CO formula settings are not configured.'; end if;
  if v_settings.updated_at is distinct from p_expected_settings_updated_at then
    raise exception 'CO formula settings changed after preview. Generate a new preview.';
  end if;

  select count(*)::integer, max(t.updated_at) into v_transaction_count, v_latest_transaction_updated_at
  from public.council_fto_transactions t where t.village_council_id = v_tenant_id and t.fto_id = p_fto_id;
  if v_transaction_count <> p_expected_transaction_count or v_latest_transaction_updated_at is distinct from p_expected_latest_transaction_updated_at then
    raise exception 'FTO transaction data changed after preview. Generate a new preview.';
  end if;
  if v_transaction_count = 0 then raise exception 'This FTO has no imported transactions to calculate.'; end if;
  if exists (select 1 from public.council_fto_transactions t where t.village_council_id = v_tenant_id and t.fto_id = p_fto_id and (t.credit_amount is null or t.credit_amount < 0)) then
    raise exception 'One or more transactions have an invalid Credit Amount. Calculation cannot continue.';
  end if;

  select * into v_tag from public.council_co_tags t
  where t.id = p_tag_id and t.village_council_id = v_tenant_id and t.is_archived = false;
  if not found then raise exception 'Select an active FTO tag before applying CO calculation.'; end if;

  insert into public.council_co_exempt_transactions (village_council_id, fto_transaction_id, exemption_interval_id, first_imported_at, marked_by)
  select t.village_council_id, t.id, e.id, t.first_imported_at, v_actor
  from public.council_fto_transactions t
  join lateral (
    select x.id from public.council_co_exemption_intervals x
    where x.village_council_id = t.village_council_id and x.job_card_number = t.job_card_number
      and t.first_imported_at >= x.started_at and (x.ended_at is null or t.first_imported_at < x.ended_at)
    order by x.started_at desc limit 1
  ) e on true
  where t.village_council_id = v_tenant_id and t.fto_id = p_fto_id
  on conflict (fto_transaction_id) do nothing;

  v_version := v_fto.co_calculation_version + 1;
  select
    coalesce(sum(t.credit_amount), 0)::numeric(16,2),
    coalesce(sum(round((t.credit_amount / v_settings.divisor::numeric) * v_settings.multiplier, 2)), 0)::numeric(16,2),
    count(*) filter (where x.fto_transaction_id is not null)::integer
  into v_total_credit, v_total_co, v_exempt_count
  from public.council_fto_transactions t
  left join public.council_co_exempt_transactions x on x.village_council_id = t.village_council_id and x.fto_transaction_id = t.id
  where t.village_council_id = v_tenant_id and t.fto_id = p_fto_id;

  insert into public.council_fto_co_calculations (
    village_council_id, fto_id, version, tag_id, tag_name_snapshot, divisor, multiplier,
    transaction_count, total_credit_amount, total_co_amount, exempt_count, chargeable_count, idempotency_key, created_by
  ) values (
    v_tenant_id, p_fto_id, v_version, v_tag.id, v_tag.name, v_settings.divisor, v_settings.multiplier,
    v_transaction_count, v_total_credit, v_total_co, v_exempt_count, v_transaction_count - v_exempt_count, p_idempotency_key, v_actor
  ) returning id into v_calculation_id;

  insert into public.council_fto_co_calculation_items (
    village_council_id, calculation_id, fto_transaction_id, job_card_number, applicant_name,
    credit_amount, co_amount, is_exempt, exemption_interval_id, first_imported_at
  )
  select t.village_council_id, v_calculation_id, t.id, t.job_card_number,
    coalesce(nullif(btrim(t.applicant_name), ''), nullif(btrim(t.primary_account_holder), '')),
    t.credit_amount, round((t.credit_amount / v_settings.divisor::numeric) * v_settings.multiplier, 2),
    (x.fto_transaction_id is not null), x.exemption_interval_id, t.first_imported_at
  from public.council_fto_transactions t
  left join public.council_co_exempt_transactions x on x.village_council_id = t.village_council_id and x.fto_transaction_id = t.id
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
    'divisor', v_settings.divisor, 'multiplier', v_settings.multiplier, 'tag_id', v_tag.id, 'tag_name', v_tag.name);
end;
$$;

create or replace function public.save_council_co_settings(p_actor_id uuid, p_divisor integer, p_multiplier integer, p_reason text)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_tenant_id uuid;
  v_settings public.council_co_settings%rowtype;
begin
  if p_actor_id is null then raise exception 'An authenticated actor is required.'; end if;
  if p_divisor is null or p_divisor <= 0 or p_multiplier is null or p_multiplier <= 0 then
    raise exception 'Divisor and multiplier must be positive whole numbers.';
  end if;
  if length(btrim(coalesce(p_reason,''))) < 3 then raise exception 'A reason is required when changing the CO formula.'; end if;
  select m.village_council_id into v_tenant_id from public.council_memberships m
  where m.user_id = p_actor_id and m.is_active = true limit 1;
  if v_tenant_id is null then raise exception 'No active Village Council membership was found.'; end if;
  insert into public.council_co_settings (village_council_id) values (v_tenant_id) on conflict (village_council_id) do nothing;
  select * into v_settings from public.council_co_settings s where s.village_council_id = v_tenant_id for update;
  if v_settings.divisor = p_divisor and v_settings.multiplier = p_multiplier then
    return jsonb_build_object('success', true, 'changed', false, 'divisor', p_divisor, 'multiplier', p_multiplier);
  end if;
  insert into public.council_co_settings_history (
    village_council_id, previous_divisor, previous_multiplier, new_divisor, new_multiplier, reason, changed_by
  ) values (v_tenant_id, v_settings.divisor, v_settings.multiplier, p_divisor, p_multiplier, btrim(p_reason), p_actor_id);
  update public.council_co_settings set divisor = p_divisor, multiplier = p_multiplier,
    updated_by = p_actor_id, updated_at = now() where village_council_id = v_tenant_id;
  return jsonb_build_object('success', true, 'changed', true, 'divisor', p_divisor, 'multiplier', p_multiplier);
end;
$$;

revoke execute on function public.apply_council_fto_co_calculation(uuid,uuid,uuid,timestamptz,integer,timestamptz,uuid) from public, anon, authenticated;
grant execute on function public.apply_council_fto_co_calculation(uuid,uuid,uuid,timestamptz,integer,timestamptz,uuid) to service_role;
revoke execute on function public.save_council_co_settings(uuid,integer,integer,text) from public, anon, authenticated;
grant execute on function public.save_council_co_settings(uuid,integer,integer,text) to service_role;

comment on table public.council_fto_co_calculations is 'Immutable versioned CO calculation snapshots for an FTO. Government status is intentionally not stored here.';
comment on table public.council_fto_co_calculation_items is 'Transaction-level CO amount and exemption snapshots. Government status remains exclusively in council_fto_transactions.';
comment on column public.council_ftos.current_co_tag_id is 'Current editable FTO-level grouping tag; changing it does not change calculation amounts.';
comment on column public.council_ftos.latest_co_calculation_id is 'Latest applied CO calculation version for this FTO. Earlier versions remain immutable.';
comment on table public.council_co_exempt_transactions is 'Permanent transaction-level exemption marks based on immutable first_imported_at and exemption interval history.';

commit;