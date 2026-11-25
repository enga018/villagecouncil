-- Normalize FTO dates stored as Government dd/mm/yyyy text into ISO dates.
begin;

drop function if exists public.normalize_council_fto_dates();

create or replace function public.parse_government_date(value text)
returns date
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_text text;
begin
  v_text = trim(btrim(value));
  if v_text = '' or length(v_text) < 8 then
    return null;
  end if;
  if v_text !~ '^[0-9]{1,2}[\/\-][0-9]{1,2}[\/\-][0-9]{4}$' then
    return null;
  end if;
  return make_date(
    substring(v_text from '^[0-9]{1,2}[\/\-][0-9]{1,2}[\/\-]([0-9]{4})')::int,
    substring(v_text from '^[0-9]{1,2}[\/\-]([0-9]{1,2})')::int,
    substring(v_text from '^([0-9]{1,2})')::int
  );
end;
$$;

revoke execute on function public.parse_government_date(text) from public, anon;
grant execute on function public.parse_government_date(text) to authenticated;

update public.council_ftos
set fto_date = public.parse_government_date(btrim(coalesce(fto_date, '')))
where btrim(coalesce(fto_date, '')) <> ''
  and btrim(coalesce(fto_date, '')) !~ '^\d{4}-\d{2}-\d{2}$';

create or replace function public.normalize_council_fto_dates()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer := 0;
begin
  select count(*) into v_count
  from public.council_ftos
  where btrim(coalesce(fto_date, '')) <> ''
    and btrim(coalesce(fto_date, '')) !~ '^\d{4}-\d{2}-\d{2}$';
  update public.council_ftos
  set fto_date = public.parse_government_date(btrim(coalesce(fto_date, '')))
  where btrim(coalesce(fto_date, '')) <> ''
    and btrim(coalesce(fto_date, '')) !~ '^\d{4}-\d{2}-\d{2}$';
  return v_count;
end;
$$;

revoke execute on function public.normalize_council_fto_dates() from public, anon;
grant execute on function public.normalize_council_fto_dates() to authenticated;

commit;
