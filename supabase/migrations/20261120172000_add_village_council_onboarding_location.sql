alter table public.village_councils
  add column if not exists state text,
  add column if not exists district text,
  add column if not exists block text,
  add column if not exists village text,
  add column if not exists onboarding_completed_at timestamptz;

alter table public.village_councils
  add constraint village_councils_location_lengths_check
  check (
    (state is null or length(trim(state)) between 1 and 100)
    and (district is null or length(trim(district)) between 1 and 100)
    and (block is null or length(trim(block)) between 1 and 100)
    and (village is null or length(trim(village)) between 1 and 120)
  );

alter table public.village_councils
  add constraint village_councils_onboarding_complete_check
  check (
    onboarding_completed_at is null
    or (
      nullif(trim(state), '') is not null
      and nullif(trim(district), '') is not null
      and nullif(trim(block), '') is not null
      and nullif(trim(village), '') is not null
    )
  );

grant update (state, district, block, village, onboarding_completed_at, updated_at)
on public.village_councils to authenticated;

create policy "VC members can complete their own council onboarding"
on public.village_councils
for update
to authenticated
using (
  exists (
    select 1 from public.memberships m
    where m.village_council_id = village_councils.id
      and m.user_id = (select auth.uid())
      and m.is_active = true
  )
)
with check (
  exists (
    select 1 from public.memberships m
    where m.village_council_id = village_councils.id
      and m.user_id = (select auth.uid())
      and m.is_active = true
  )
);
