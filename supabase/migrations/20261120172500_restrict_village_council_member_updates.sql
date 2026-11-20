revoke update on table public.village_councils from authenticated;
grant update (state, district, block, village, onboarding_completed_at, updated_at)
on table public.village_councils to authenticated;