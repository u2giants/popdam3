-- #2045 item 2: an operative determination must carry the classification it
-- authorizes. Production held zero determination rows when this contract was
-- confirmed on 2026-09-07, so no data reconciliation or backfill is needed.
--
-- This deliberately does not add an index on precedent_id. That separate issue
-- has no measured read/update/delete pattern that would justify its write cost.

alter table public.hts_rag_determinations
  add constraint hts_rag_determinations_operative_proposed_hts_chk
  check (
    not operative_eligible
    or nullif(btrim(proposed_hts), '') is not null
  );

comment on constraint hts_rag_determinations_operative_proposed_hts_chk
  on public.hts_rag_determinations is
  'An operative-eligible determination must carry a non-empty proposed HTS classification.';
