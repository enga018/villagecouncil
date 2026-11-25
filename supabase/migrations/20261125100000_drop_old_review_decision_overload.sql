-- Keep only the 4-arg version of set_council_fto_review_decision.
begin;

drop function if exists public.set_council_fto_review_decision(text, text, text);

commit;
