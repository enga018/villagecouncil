-- Bulk payment paste preview.
-- This migration intentionally implements validation only. Batch confirmation
-- is held until the Council decides how invalid lines affect a submitted batch.

begin;

create or replace function public.preview_council_bulk_payment_batch(
  p_village_council_id uuid,
  p_pasted_lines text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $preview_bulk_payment$
declare
  v_actor uuid := auth.uid();
  v_result jsonb;
begin
  if v_actor is null then
    raise exception 'Authentication is required.';
  end if;

  if not exists (
    select 1
    from public.council_memberships m
    where m.village_council_id = p_village_council_id
      and m.user_id = v_actor
      and m.is_active = true
  ) then
    raise exception 'You are not an active member of this Village Council.';
  end if;

  if length(btrim(coalesce(p_pasted_lines, ''))) = 0 then
    raise exception 'Paste at least one Job Card Number and amount.';
  end if;

  with raw_lines as (
    select
      ordinality::integer as line_number,
      btrim(line_text) as original_line
    from regexp_split_to_table(p_pasted_lines, E'\\\\r?\\\\n') with ordinality as t(line_text, ordinality)
    where length(btrim(line_text)) > 0
  ),
  parsed as (
    select
      r.line_number,
      r.original_line,
      case
        when length(r.original_line) - length(replace(r.original_line, ',', '')) = 1
        then btrim(split_part(r.original_line, ',', 1))
        else null
      end as job_card_number,
      case
        when length(r.original_line) - length(replace(r.original_line, ',', '')) = 1
        then btrim(split_part(r.original_line, ',', 2))
        else null
      end as amount_text
    from raw_lines r
  ),
  evaluated as (
    select
      p.*,
      case when p.amount_text ~ '^[0-9]+([.][0-9]{1,2})?$'
        then p.amount_text::numeric(14,2) else null end as amount,
      count(*) filter (where p.job_card_number is not null and p.job_card_number <> '')
        over (partition by p.job_card_number) as duplicate_count,
      exists (
        select 1
        from public.council_job_cards j
        where j.village_council_id = p_village_council_id
          and j.job_card_number = p.job_card_number
      ) as job_card_exists
    from parsed p
  ),
  classified as (
    select
      e.*,
      case
        when e.job_card_number is null then 'invalid_format'
        when e.job_card_number = '' then 'missing_job_card'
        when e.duplicate_count > 1 then 'duplicate_job_card'
        when not e.job_card_exists then 'job_card_not_found'
        when e.amount_text is null or e.amount_text = '' then 'missing_amount'
        when e.amount is null or e.amount <= 0 then 'invalid_amount'
        else 'valid'
      end as status
    from evaluated e
  )
  select jsonb_build_object(
    'line_count', count(*),
    'valid_count', count(*) filter (where status = 'valid'),
    'invalid_count', count(*) filter (where status <> 'valid'),
    'valid_total', coalesce(sum(amount) filter (where status = 'valid'), 0),
    'lines', coalesce(
      jsonb_agg(
        jsonb_build_object(
          'line_number', line_number,
          'original_line', original_line,
          'job_card_number', job_card_number,
          'amount', amount,
          'status', status,
          'issue', case status
            when 'invalid_format' then 'Use JOB-CARD-NUMBER, AMOUNT.'
            when 'duplicate_job_card' then 'This Job Card appears more than once in the pasted batch.'
            when 'job_card_not_found' then 'Job Card was not found in this Village Council.'
            when 'missing_job_card' then 'Enter a Job Card Number before the comma.'
            when 'missing_amount' then 'Enter an amount after the comma.'
            when 'invalid_amount' then 'Amount must be a positive number with no more than two decimal places.'
            else null
          end
        ) order by line_number
      ),
      '[]'::jsonb
    )
  )
  into v_result
  from classified;

  return v_result;
end;
$preview_bulk_payment$;

revoke all on function public.preview_council_bulk_payment_batch(uuid, text) from public, anon, authenticated;
grant execute on function public.preview_council_bulk_payment_batch(uuid, text) to authenticated;

commit;
