-- Use neutral tenant table names, separate from legacy survey tables.
begin;

alter table public.village_councils rename to council_tenants;
alter table public.memberships rename to council_memberships;

alter table public.council_tenants rename constraint village_councils_pkey to council_tenants_pkey;
alter table public.council_tenants rename constraint village_councils_slug_key to council_tenants_slug_key;

alter table public.council_memberships rename constraint memberships_pkey to council_memberships_pkey;
alter table public.council_memberships rename constraint memberships_user_id_fkey to council_memberships_user_id_fkey;
alter table public.council_memberships rename constraint memberships_user_id_key to council_memberships_user_id_key;
alter table public.council_memberships rename constraint memberships_user_id_village_council_id_key to council_memberships_user_council_key;
alter table public.council_memberships rename constraint memberships_village_council_id_fkey to council_memberships_council_id_fkey;
alter table public.council_memberships rename constraint memberships_village_council_id_key to council_memberships_council_id_key;

do $$
declare
  c record;
  definition text;
begin
  for c in
    select oid, conname
    from pg_constraint
    where conrelid = 'public.council_tenants'::regclass
      and contype = 'c'
      and (
        pg_get_constraintdef(oid) like '%length(TRIM(BOTH FROM name))%'
        or pg_get_constraintdef(oid) like '%slug = lower(slug)%'
      )
  loop
    definition := pg_get_constraintdef(c.oid);
    if definition like '%length(TRIM(BOTH FROM name))%' then
      execute format('alter table public.council_tenants rename constraint %I to council_tenants_name_check', c.conname);
    else
      execute format('alter table public.council_tenants rename constraint %I to council_tenants_slug_check', c.conname);
    end if;
  end loop;
end $$;

comment on table public.council_tenants is 'Village Council tenant registry.';
comment on table public.council_memberships is 'Trusted account-to-tenant mapping. Provisioned outside the public client.';

commit;
