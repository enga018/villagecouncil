create schema if not exists private;
revoke all on schema private from public, anon;
grant usage on schema private to authenticated;
alter function public.is_platform_superadmin() set schema private;
revoke all on function private.is_platform_superadmin() from public, anon;
grant execute on function private.is_platform_superadmin() to authenticated;

drop policy if exists "Authenticated users can read active states" on public.location_states;
drop policy if exists "Superadmins manage states" on public.location_states;
create policy "Read active states or manage as superadmin" on public.location_states for select to authenticated using (is_active or (select private.is_platform_superadmin()));
create policy "Superadmins insert states" on public.location_states for insert to authenticated with check ((select private.is_platform_superadmin()));
create policy "Superadmins update states" on public.location_states for update to authenticated using ((select private.is_platform_superadmin())) with check ((select private.is_platform_superadmin()));

drop policy if exists "Authenticated users can read active districts" on public.location_districts;
drop policy if exists "Superadmins manage districts" on public.location_districts;
create policy "Read active districts or manage as superadmin" on public.location_districts for select to authenticated using ((is_active and exists (select 1 from public.location_states s where s.id = state_id and s.is_active)) or (select private.is_platform_superadmin()));
create policy "Superadmins insert districts" on public.location_districts for insert to authenticated with check ((select private.is_platform_superadmin()));
create policy "Superadmins update districts" on public.location_districts for update to authenticated using ((select private.is_platform_superadmin())) with check ((select private.is_platform_superadmin()));

drop policy if exists "Authenticated users can read active blocks" on public.location_blocks;
drop policy if exists "Superadmins manage blocks" on public.location_blocks;
create policy "Read active blocks or manage as superadmin" on public.location_blocks for select to authenticated using ((is_active and exists (select 1 from public.location_districts d join public.location_states s on s.id = d.state_id where d.id = district_id and d.is_active and s.is_active)) or (select private.is_platform_superadmin()));
create policy "Superadmins insert blocks" on public.location_blocks for insert to authenticated with check ((select private.is_platform_superadmin()));
create policy "Superadmins update blocks" on public.location_blocks for update to authenticated using ((select private.is_platform_superadmin())) with check ((select private.is_platform_superadmin()));

drop policy if exists "Authenticated users can read active panchayats" on public.location_panchayats;
drop policy if exists "Superadmins manage panchayats" on public.location_panchayats;
create policy "Read active panchayats or manage as superadmin" on public.location_panchayats for select to authenticated using ((is_active and exists (select 1 from public.location_blocks b join public.location_districts d on d.id = b.district_id join public.location_states s on s.id = d.state_id where b.id = block_id and b.is_active and d.is_active and s.is_active)) or (select private.is_platform_superadmin()));
create policy "Superadmins insert panchayats" on public.location_panchayats for insert to authenticated with check ((select private.is_platform_superadmin()));
create policy "Superadmins update panchayats" on public.location_panchayats for update to authenticated using ((select private.is_platform_superadmin())) with check ((select private.is_platform_superadmin()));
