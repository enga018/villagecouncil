-- Tag-aware shared Batch Operations and atomic Manual/Extra Charge batches.
-- Feature-branch migration only. Do not apply to the hosted database without approval.

begin;

-- Tag is classification metadata. It is deliberately not part of FIFO keys.
alter table public.council_payment_batches
  add column tag_id uuid;
alter table public.council_payment_batches
  add constraint council_payment_batches_tag_fk
  foreign key (tag_id, village_council_id)
  references public.council_co_tags(id, village_council_id) on delete restrict;

alter table public.council_payments
  add column tag_id uuid;
alter table public.council_payments
  add constraint council_payments_tag_fk
  foreign key (tag_id, village_council_id)
  references public.council_co_tags(id, village_council_id) on delete restrict;

alter table public.council_contribution_charges
  add column tag_id uuid,
  add column manual_charge_batch_id uuid;
alter table public.council_contribution_charges
  add constraint council_contribution_charges_tag_fk
  foreign key (tag_id, village_council_id)
  references public.council_co_tags(id, village_council_id) on delete restrict;

create table public.council_manual_charge_batches (
  id uuid primary key default gen_random_uuid(),
  village_council_id uuid not null references public.council_tenants(id) on delete restrict,
  batch_reference text not null,
  tag_id uuid not null,
  recorded_by uuid not null references auth.users(id) on delete restrict,
  recorded_at timestamptz not null default now(),
  line_count integer not null check (line_count > 0),
  total_amount numeric(14,2) not null check (total_amount > 0),
  idempotency_key uuid not null,
  payload_hash text not null,
  constraint council_manual_charge_batches_reference_unique unique (village_council_id, batch_reference),
  constraint council_manual_charge_batches_idempotency_unique unique (village_council_id, idempotency_key),
  constraint council_manual_charge_batches_id_tenant_unique unique (id, village_council_id),
  constraint council_manual_charge_batches_tag_fk
    foreign key (tag_id, village_council_id)
    references public.council_co_tags(id, village_council_id) on delete restrict
);

alter table public.council_contribution_charges
  add constraint council_contribution_charges_manual_batch_fk
  foreign key (manual_charge_batch_id, village_council_id)
  references public.council_manual_charge_batches(id, village_council_id) on delete restrict,
  add constraint council_contribution_charges_manual_batch_shape_check
  check (
    (charge_type = 'manual_extra' and manual_charge_batch_id is not null and tag_id is not null)
    or
    (charge_type = 'regular_co' and manual_charge_batch_id is null)
  );

create index council_contribution_charges_tag_idx
  on public.council_contribution_charges(village_council_id, tag_id);
create index council_payment_batches_tag_idx
  on public.council_payment_batches(village_council_id, tag_id);
create index council_manual_charge_batches_tag_idx
  on public.council_manual_charge_batches(village_council_id, tag_id, recorded_at desc);

alter table public.council_manual_charge_batches enable row level security;
revoke all on table public.council_manual_charge_batches from anon, authenticated;
grant select on table public.council_manual_charge_batches to authenticated;
create policy council_manual_charge_batches_active_member_read
  on public.council_manual_charge_batches
  for select to authenticated
  using (exists (
    select 1 from public.council_memberships m
    where m.village_council_id = council_manual_charge_batches.village_council_id
      and m.user_id = (select auth.uid()) and m.is_active = true
  ));

-- Tag-aware payment preview. The selected tag must be active and belong to
-- the same Council as the caller's active membership.
create or replace function public.preview_council_bulk_payment_batch(
  p_village_council_id uuid,
  p_tag_id uuid,
  p_pasted_lines text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $preview_tagged_payment$
declare
  v_actor uuid := auth.uid();
  v_preview jsonb;
begin
  if v_actor is null then raise exception 'Authentication is required.'; end if;
  if not exists (
    select 1 from public.council_memberships m
    where m.village_council_id = p_village_council_id
      and m.user_id = v_actor and m.is_active = true
  ) then raise exception 'You are not an active member of this Village Council.'; end if;
  if not exists (
    select 1 from public.council_co_tags t
    where t.id = p_tag_id and t.village_council_id = p_village_council_id
      and t.is_archived = false
  ) then raise exception 'Select an active Tag belonging to this Village Council.'; end if;

  v_preview := public.preview_council_bulk_payment_batch(p_village_council_id, p_pasted_lines);
  return v_preview || jsonb_build_object('tag_id', p_tag_id);
end;
$preview_tagged_payment$;

revoke all on function public.preview_council_bulk_payment_batch(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.preview_council_bulk_payment_batch(uuid, uuid, text) to authenticated;

-- New confirmation signature requires the selected Tag. The previous
-- untagged entry point is disabled so all new bulk payments carry metadata.
create or replace function public.record_council_bulk_payment_batch(
  p_village_council_id uuid,
  p_payment_method text,
  p_tag_id uuid,
  p_lines jsonb,
  p_idempotency_key uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $record_tagged_bulk_payment$
declare
  v_actor uuid := auth.uid();
  v_existing public.council_payment_batches%rowtype;
  v_batch_id uuid;
  v_batch_reference text;
  v_line_count integer;
  v_total numeric(14,2);
  v_invalid jsonb;
  v_fifo_results jsonb;
  v_payload_hash text := md5(jsonb_build_object(
    'payment_method', p_payment_method, 'tag_id', p_tag_id, 'lines', p_lines
  )::text);
begin
  if v_actor is null then raise exception 'Authentication is required.'; end if;
  if p_payment_method not in ('cash', 'bank') then raise exception 'Payment method must be CASH or BANK.'; end if;
  if p_idempotency_key is null then raise exception 'An idempotency key is required.'; end if;
  if jsonb_typeof(p_lines) is distinct from 'array' or jsonb_array_length(p_lines) = 0 then
    raise exception 'Provide at least one payment line.';
  end if;
  if not exists (
    select 1 from public.council_memberships m
    where m.village_council_id = p_village_council_id
      and m.user_id = v_actor and m.is_active = true
  ) then raise exception 'You are not an active member of this Village Council.'; end if;
  if not exists (
    select 1 from public.council_co_tags t
    where t.id = p_tag_id and t.village_council_id = p_village_council_id
      and t.is_archived = false
  ) then raise exception 'Select an active Tag belonging to this Village Council.'; end if;

  perform pg_advisory_xact_lock(hashtextextended(p_village_council_id::text || ':' || p_idempotency_key::text, 0));
  select * into v_existing from public.council_payment_batches b
  where b.village_council_id = p_village_council_id and b.idempotency_key = p_idempotency_key;
  if found then
    if v_existing.payment_method <> p_payment_method
       or v_existing.tag_id is distinct from p_tag_id
       or v_existing.line_count <> jsonb_array_length(p_lines)
       or v_existing.payload_hash is distinct from v_payload_hash then
      raise exception 'This idempotency key was already used for a different payment batch.';
    end if;
    return jsonb_build_object('success', true, 'duplicate_request', true,
      'batch_id', v_existing.id, 'batch_reference', v_existing.batch_reference,
      'line_count', v_existing.line_count, 'total_amount', v_existing.total_amount);
  end if;

  with submitted as (
    select ordinality::integer as line_number,
      nullif(btrim(value->>'job_card_number'), '') as job_card_number,
      case when coalesce(value->>'amount','') ~ '^[0-9]+([.][0-9]{1,2})?$'
        then (value->>'amount')::numeric(14,2) else null end as amount
    from jsonb_array_elements(p_lines) with ordinality
  ), checked as (
    select s.*,
      count(*) over (partition by s.job_card_number) as duplicate_count,
      exists (select 1 from public.council_job_cards j
        where j.village_council_id = p_village_council_id and j.job_card_number = s.job_card_number) as job_card_exists
    from submitted s
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'line_number', line_number, 'job_card_number', job_card_number, 'amount', amount,
    'issue', case when job_card_number is null then 'Missing Job Card Number.'
      when duplicate_count > 1 then 'Duplicate Job Card Number.'
      when not job_card_exists then 'Job Card not found in this Village Council.'
      when amount is null or amount <= 0 then 'Amount must be positive with at most two decimal places.'
      else null end
  ) order by line_number) filter (
    where job_card_number is null or duplicate_count > 1 or not job_card_exists or amount is null or amount <= 0
  ), '[]'::jsonb) into v_invalid from checked;
  if jsonb_array_length(v_invalid) > 0 then
    raise exception 'Payment batch rejected: every line must be valid. Issues: %', v_invalid;
  end if;

  select count(*), sum((value->>'amount')::numeric(14,2))
  into v_line_count, v_total from jsonb_array_elements(p_lines);

  perform j.job_card_number
  from public.council_job_cards j
  join (select distinct value->>'job_card_number' as job_card_number from jsonb_array_elements(p_lines)) s
    on s.job_card_number = j.job_card_number
  where j.village_council_id = p_village_council_id
  order by j.job_card_number for update of j;

  v_batch_id := gen_random_uuid();
  v_batch_reference := 'PAY-' || to_char(clock_timestamp(), 'YYYYMMDDHH24MISSMS')
    || '-' || upper(substr(replace(v_batch_id::text, '-', ''), 1, 8));

  insert into public.council_payment_batches (
    id, village_council_id, batch_reference, payment_method, tag_id,
    recorded_by, line_count, total_amount, idempotency_key, payload_hash
  ) values (
    v_batch_id, p_village_council_id, v_batch_reference, p_payment_method, p_tag_id,
    v_actor, v_line_count, v_total, p_idempotency_key, v_payload_hash
  );

  insert into public.council_payments (
    village_council_id, job_card_number, batch_id, payment_method,
    amount, recorded_by, idempotency_key, tag_id
  )
  select p_village_council_id, value->>'job_card_number', v_batch_id, p_payment_method,
    (value->>'amount')::numeric(14,2), v_actor, gen_random_uuid(), p_tag_id
  from jsonb_array_elements(p_lines);

  insert into public.council_payment_events (
    village_council_id, payment_id, event_type, new_amount, new_method, actor_id
  )
  select p.village_council_id, p.id, 'created', p.amount, p.payment_method, v_actor
  from public.council_payments p
  where p.village_council_id = p_village_council_id and p.batch_id = v_batch_id;

  select coalesce(jsonb_agg(result order by job_card_number), '[]'::jsonb)
  into v_fifo_results
  from (
    select x.job_card_number,
      public.run_council_job_card_fifo(p_village_council_id, x.job_card_number,
        'payment_created', v_actor, 'Payment batch ' || v_batch_reference) as result
    from (select distinct value->>'job_card_number' as job_card_number from jsonb_array_elements(p_lines)) x
  ) fifo;

  return jsonb_build_object('success', true, 'duplicate_request', false,
    'batch_id', v_batch_id, 'batch_reference', v_batch_reference,
    'line_count', v_line_count, 'total_amount', v_total,
    'payment_method', p_payment_method, 'tag_id', p_tag_id, 'fifo', v_fifo_results);
end;
$record_tagged_bulk_payment$;

revoke all on function public.record_council_bulk_payment_batch(uuid, text, jsonb, uuid) from public, anon, authenticated;
revoke all on function public.record_council_bulk_payment_batch(uuid, text, uuid, jsonb, uuid) from public, anon, authenticated;
grant execute on function public.record_council_bulk_payment_batch(uuid, text, uuid, jsonb, uuid) to authenticated;

-- Preview Manual/Extra Charge lines in the shared Batch Operations workspace.
-- Format: JOB-CARD-NUMBER, DESCRIPTION, AMOUNT
create or replace function public.preview_council_bulk_manual_charge_batch(
  p_village_council_id uuid,
  p_tag_id uuid,
  p_pasted_lines text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $preview_manual_batch$
declare
  v_actor uuid := auth.uid();
  v_result jsonb;
begin
  if v_actor is null then raise exception 'Authentication is required.'; end if;
  if not exists (select 1 from public.council_memberships m
    where m.village_council_id = p_village_council_id and m.user_id = v_actor and m.is_active = true) then
    raise exception 'You are not an active member of this Village Council.';
  end if;
  if not exists (select 1 from public.council_co_tags t
    where t.id = p_tag_id and t.village_council_id = p_village_council_id and t.is_archived = false) then
    raise exception 'Select an active Tag belonging to this Village Council.';
  end if;
  if length(btrim(coalesce(p_pasted_lines,''))) = 0 then raise exception 'Paste at least one charge line.'; end if;

  with raw_lines as (
    select ordinality::integer as line_number, btrim(line_text) as original_line
    from regexp_split_to_table(p_pasted_lines, E'\\r?\\n') with ordinality as t(line_text, ordinality)
    where length(btrim(line_text)) > 0
  ), parsed as (
    select line_number, original_line,
      case when length(original_line)-length(replace(original_line,',','')) = 2
        then btrim(split_part(original_line,',',1)) end as job_card_number,
      case when length(original_line)-length(replace(original_line,',','')) = 2
        then btrim(split_part(original_line,',',2)) end as description,
      case when length(original_line)-length(replace(original_line,',','')) = 2
        then btrim(split_part(original_line,',',3)) end as amount_text
    from raw_lines
  ), evaluated as (
    select p.*,
      case when amount_text ~ '^[0-9]+([.][0-9]{1,2})?$' then amount_text::numeric(14,2) end as amount,
      count(*) filter (where job_card_number is not null and job_card_number <> '') over (partition by job_card_number) as duplicate_count,
      exists (select 1 from public.council_job_cards j where j.village_council_id = p_village_council_id and j.job_card_number = p.job_card_number) as job_card_exists
    from parsed p
  ), classified as (
    select e.*, case
      when job_card_number is null then 'invalid_format'
      when job_card_number = '' then 'missing_job_card'
      when duplicate_count > 1 then 'duplicate_job_card'
      when not job_card_exists then 'job_card_not_found'
      when length(btrim(coalesce(description,''))) = 0 then 'missing_description'
      when amount is null or amount <= 0 then 'invalid_amount'
      else 'valid' end as status
    from evaluated e
  )
  select jsonb_build_object(
    'line_count', count(*),
    'valid_count', count(*) filter (where status='valid'),
    'invalid_count', count(*) filter (where status<>'valid'),
    'valid_total', coalesce(sum(amount) filter (where status='valid'),0),
    'tag_id', p_tag_id,
    'lines', coalesce(jsonb_agg(jsonb_build_object(
      'line_number',line_number,'original_line',original_line,'job_card_number',job_card_number,
      'description',description,'amount',amount,'status',status,
      'issue',case status
        when 'invalid_format' then 'Use JOB-CARD-NUMBER, DESCRIPTION, AMOUNT.'
        when 'missing_job_card' then 'Enter a Job Card Number.'
        when 'duplicate_job_card' then 'This Job Card appears more than once in the batch.'
        when 'job_card_not_found' then 'Job Card was not found in this Village Council.'
        when 'missing_description' then 'Enter a charge description.'
        when 'invalid_amount' then 'Amount must be positive with no more than two decimal places.'
        else null end
    ) order by line_number),'[]'::jsonb)
  ) into v_result from classified;
  return v_result;
end;
$preview_manual_batch$;

create table public.council_manual_charge_batches_placeholder (
  id uuid primary key
);

-- Atomic Manual/Extra Charge batch confirmation.
create or replace function public.record_council_bulk_manual_charge_batch(
  p_village_council_id uuid,
  p_tag_id uuid,
  p_lines jsonb,
  p_idempotency_key uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $record_manual_batch$
declare
  v_actor uuid := auth.uid();
  v_existing public.council_manual_charge_batches%rowtype;
  v_batch_id uuid;
  v_batch_reference text;
  v_line_count integer;
  v_total numeric(14,2);
  v_payload_hash text := md5(jsonb_build_object('tag_id',p_tag_id,'lines',p_lines)::text);
  v_invalid jsonb;
  v_fifo_results jsonb;
begin
  if v_actor is null then raise exception 'Authentication is required.'; end if;
  if p_idempotency_key is null then raise exception 'An idempotency key is required.'; end if;
  if jsonb_typeof(p_lines) is distinct from 'array' or jsonb_array_length(p_lines)=0 then
    raise exception 'Provide at least one charge line.';
  end if;
  if not exists (select 1 from public.council_memberships m
    where m.village_council_id=p_village_council_id and m.user_id=v_actor and m.is_active=true) then
    raise exception 'You are not an active member of this Village Council.';
  end if;
  if not exists (select 1 from public.council_co_tags t
    where t.id=p_tag_id and t.village_council_id=p_village_council_id and t.is_archived=false) then
    raise exception 'Select an active Tag belonging to this Village Council.';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_village_council_id::text||':'||p_idempotency_key::text,0));
  select * into v_existing from public.council_manual_charge_batches b
  where b.village_council_id=p_village_council_id and b.idempotency_key=p_idempotency_key;
  if found then
    if v_existing.tag_id is distinct from p_tag_id
       or v_existing.line_count <> jsonb_array_length(p_lines)
       or v_existing.payload_hash is distinct from v_payload_hash then
      raise exception 'This idempotency key was already used for a different Manual/Extra Charge batch.';
    end if;
    return jsonb_build_object('success',true,'duplicate_request',true,
      'batch_id',v_existing.id,'batch_reference',v_existing.batch_reference,
      'line_count',v_existing.line_count,'total_amount',v_existing.total_amount);
  end if;

  with submitted as (
    select ordinality::integer as line_number,
      nullif(btrim(value->>'job_card_number'),'') as job_card_number,
      nullif(btrim(value->>'description'),'') as description,
      case when coalesce(value->>'amount','') ~ '^[0-9]+([.][0-9]{1,2})?$'
        then (value->>'amount')::numeric(14,2) end as amount
    from jsonb_array_elements(p_lines) with ordinality
  ), checked as (
    select s.*,count(*) over(partition by s.job_card_number) as duplicate_count,
      exists(select 1 from public.council_job_cards j where j.village_council_id=p_village_council_id and j.job_card_number=s.job_card_number) as job_card_exists
    from submitted s
  )
  select coalesce(jsonb_agg(jsonb_build_object('line_number',line_number,'job_card_number',job_card_number,
    'description',description,'amount',amount,
    'issue',case when job_card_number is null then 'Missing Job Card Number.'
      when duplicate_count>1 then 'Duplicate Job Card Number.'
      when not job_card_exists then 'Job Card not found in this Village Council.'
      when description is null then 'Missing charge description.'
      when amount is null or amount<=0 then 'Amount must be positive with at most two decimal places.'
      else null end
  ) order by line_number) filter(where job_card_number is null or duplicate_count>1 or not job_card_exists
    or description is null or amount is null or amount<=0),'[]'::jsonb)
  into v_invalid from checked;
  if jsonb_array_length(v_invalid)>0 then
    raise exception 'Manual/Extra Charge batch rejected: every line must be valid. Issues: %',v_invalid;
  end if;

  select count(*),sum((value->>'amount')::numeric(14,2)) into v_line_count,v_total
  from jsonb_array_elements(p_lines);

  perform j.job_card_number
  from public.council_job_cards j
  join(select distinct value->>'job_card_number' as job_card_number from jsonb_array_elements(p_lines)) s
    on s.job_card_number=j.job_card_number
  where j.village_council_id=p_village_council_id
  order by j.job_card_number for update of j;

  v_batch_id:=gen_random_uuid();
  v_batch_reference:='CHG-'||to_char(clock_timestamp(),'YYYYMMDDHH24MISSMS')
    ||'-'||upper(substr(replace(v_batch_id::text,'-',''),1,8));

  insert into public.council_manual_charge_batches(
    id,village_council_id,batch_reference,tag_id,recorded_by,line_count,total_amount,idempotency_key,payload_hash
  ) values(v_batch_id,p_village_council_id,v_batch_reference,p_tag_id,v_actor,v_line_count,v_total,p_idempotency_key,v_payload_hash);

  with inserted as (
    insert into public.council_contribution_charges(
      village_council_id,job_card_number,charge_type,description,current_amount,is_active,
      created_by,tag_id,manual_charge_batch_id
    )
    select p_village_council_id,value->>'job_card_number','manual_extra',btrim(value->>'description'),
      (value->>'amount')::numeric(14,2),true,v_actor,p_tag_id,v_batch_id
    from jsonb_array_elements(p_lines)
    returning id,village_council_id,job_card_number,current_amount
  ), numbered as (
    select i.*,row_number() over(order by i.job_card_number,i.id)::integer as revision_number
    from inserted i
  )
  insert into public.council_contribution_charge_revisions(
    village_council_id,charge_id,revision_number,previous_amount,new_amount,
    previous_is_active,new_is_active,reason,actor_id,change_source
  )
  select village_council_id,id,1,null,current_amount,null,true,
    'Created in Manual/Extra Charge batch '||v_batch_reference,v_actor,'manual_correction'
  from numbered;

  insert into public.council_manual_charge_events(
    village_council_id,charge_id,event_type,previous_amount,new_amount,reason,actor_id,idempotency_key
  )
  select ch.village_council_id,ch.id,'created',null,ch.current_amount,
    'Created in Manual/Extra Charge batch '||v_batch_reference,v_actor,
    gen_random_uuid()
  from public.council_contribution_charges ch
  where ch.village_council_id=p_village_council_id and ch.manual_charge_batch_id=v_batch_id;

  select coalesce(jsonb_agg(result order by job_card_number),'[]'::jsonb)
  into v_fifo_results
  from (
    select x.job_card_number,
      public.run_council_job_card_fifo(p_village_council_id,x.job_card_number,
        'charge_created',v_actor,'Manual/Extra Charge batch '||v_batch_reference) as result
    from(select distinct value->>'job_card_number' as job_card_number from jsonb_array_elements(p_lines)) x
  ) fifo;

  return jsonb_build_object('success',true,'duplicate_request',false,
    'batch_id',v_batch_id,'batch_reference',v_batch_reference,'line_count',v_line_count,
    'total_amount',v_total,'tag_id',p_tag_id,'fifo',v_fifo_results);
end;
$record_manual_batch$;

revoke all on function public.preview_council_bulk_manual_charge_batch(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.preview_council_bulk_manual_charge_batch(uuid,uuid,text) to authenticated;
revoke all on function public.record_council_bulk_manual_charge_batch(uuid,uuid,jsonb,uuid) from public,anon,authenticated;
grant execute on function public.record_council_bulk_manual_charge_batch(uuid,uuid,jsonb,uuid) to authenticated;

commit;
