begin;

create or replace function public.create_council_co_tag(p_actor_id uuid, p_name text)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_tenant_id uuid;
  v_tag public.council_co_tags%rowtype;
  v_name text := btrim(coalesce(p_name,''));
begin
  if p_actor_id is null then raise exception 'An authenticated actor is required.'; end if;
  if length(v_name) < 1 or length(v_name) > 60 then raise exception 'Tag name must be between 1 and 60 characters.'; end if;
  select m.village_council_id into v_tenant_id from public.council_memberships m
  where m.user_id = p_actor_id and m.is_active = true limit 1;
  if v_tenant_id is null then raise exception 'No active Village Council membership was found.'; end if;
  insert into public.council_co_tags (village_council_id, name, created_by)
  values (v_tenant_id, v_name, p_actor_id) returning * into v_tag;
  insert into public.council_co_tag_events (village_council_id, tag_id, action, new_name, actor_id)
  values (v_tenant_id, v_tag.id, 'created', v_tag.name, p_actor_id);
  return jsonb_build_object('id', v_tag.id, 'name', v_tag.name, 'is_archived', v_tag.is_archived, 'created_at', v_tag.created_at);
exception when unique_violation then
  raise exception 'A tag with this name already exists in this Council.';
end;
$$;

create or replace function public.set_council_fto_tag(p_actor_id uuid, p_fto_id uuid, p_tag_id uuid)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_tenant_id uuid;
  v_fto public.council_ftos%rowtype;
  v_tag public.council_co_tags%rowtype;
begin
  if p_actor_id is null then raise exception 'An authenticated actor is required.'; end if;
  select m.village_council_id into v_tenant_id from public.council_memberships m
  where m.user_id = p_actor_id and m.is_active = true limit 1;
  if v_tenant_id is null then raise exception 'No active Village Council membership was found.'; end if;
  select * into v_fto from public.council_ftos f
  where f.id = p_fto_id and f.village_council_id = v_tenant_id and f.status = 'active' for update;
  if not found then raise exception 'FTO not found or not available to this Village Council.'; end if;
  select * into v_tag from public.council_co_tags t
  where t.id = p_tag_id and t.village_council_id = v_tenant_id and t.is_archived = false;
  if not found then raise exception 'Select an active FTO tag.'; end if;
  if v_fto.current_co_tag_id is distinct from v_tag.id then
    update public.council_ftos set current_co_tag_id = v_tag.id, updated_at = now()
    where id = p_fto_id and village_council_id = v_tenant_id;
    insert into public.council_co_tag_events (village_council_id, fto_id, tag_id, previous_tag_id, action, actor_id)
    values (v_tenant_id, p_fto_id, v_tag.id, v_fto.current_co_tag_id,
      case when v_fto.current_co_tag_id is null then 'assigned' else 'reassigned' end, p_actor_id);
  end if;
  return jsonb_build_object('success', true, 'tag_id', v_tag.id, 'tag_name', v_tag.name);
end;
$$;

create or replace function public.rename_council_co_tag(p_actor_id uuid, p_tag_id uuid, p_name text)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_tenant_id uuid;
  v_tag public.council_co_tags%rowtype;
  v_name text := btrim(coalesce(p_name,''));
  v_previous_name text;
begin
  if p_actor_id is null then raise exception 'An authenticated actor is required.'; end if;
  if length(v_name) < 1 or length(v_name) > 60 then raise exception 'Tag name must be between 1 and 60 characters.'; end if;
  select m.village_council_id into v_tenant_id from public.council_memberships m
  where m.user_id = p_actor_id and m.is_active = true limit 1;
  if v_tenant_id is null then raise exception 'No active Village Council membership was found.'; end if;
  select * into v_tag from public.council_co_tags t
  where t.id = p_tag_id and t.village_council_id = v_tenant_id for update;
  if not found then raise exception 'FTO tag not found.'; end if;
  v_previous_name := v_tag.name;
  update public.council_co_tags set name = v_name, updated_at = now()
  where id = p_tag_id and village_council_id = v_tenant_id returning * into v_tag;
  if v_previous_name is distinct from v_tag.name then
    insert into public.council_co_tag_events (village_council_id, tag_id, action, previous_name, new_name, actor_id)
    values (v_tenant_id, v_tag.id, 'renamed', v_previous_name, v_tag.name, p_actor_id);
  end if;
  return jsonb_build_object('id', v_tag.id, 'name', v_tag.name, 'is_archived', v_tag.is_archived);
exception when unique_violation then
  raise exception 'A tag with this name already exists in this Council.';
end;
$$;

revoke execute on function public.create_council_co_tag(uuid,text) from public, anon, authenticated;
grant execute on function public.create_council_co_tag(uuid,text) to service_role;
revoke execute on function public.set_council_fto_tag(uuid,uuid,uuid) from public, anon, authenticated;
grant execute on function public.set_council_fto_tag(uuid,uuid,uuid) to service_role;
revoke execute on function public.rename_council_co_tag(uuid,uuid,text) from public, anon, authenticated;
grant execute on function public.rename_council_co_tag(uuid,uuid,text) to service_role;

commit;