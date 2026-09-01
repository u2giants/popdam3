-- Review fixes for the HTS RAG durable precedent contract (#2035, follow-on to #2004).
--
-- WHY THIS IS A SEPARATE MIGRATION rather than an edit to 20260831234750.
-- Preview applied 20260831234750 in run 33454217961 from PR #2009 commit bb77fdd4, the
-- body before two High review findings were fixed. Preview therefore already holds the
-- seven hts_rag_* tables from that superseded body, so the corrected body can never be
-- rehearsed there as `create table`, and the production business-risk gate refuses a
-- promotion whose rehearsal digest is not the file on exact main. 20260831234750 is
-- restored on main to the exact bytes preview ran and the corrections are fixed forward
-- here. AGENTS.md section 4 rule 3: fix forward, never edit an applied migration.
--
-- WHY EVERY DROP IS `if exists`. This migration must produce the identical final contract
-- from EITHER starting point -- the superseded body preview holds, or the corrected body
-- currently on main -- because the restoration lands in a separate pull request and each
-- intermediate tree must be green on its own. The `add`/`create` statements stay
-- unconditional, so a constraint or policy that fails to appear still fails loudly, and
-- supabase/tests/hts_rag_durable_precedent_contract.sql asserts the exact end state.

-- 1. HTS notation. The original pattern accepted 6913 and compact 6913.105000 but
--    rejected the ordinary dotted 8- and 10-digit forms 6913.10.50 and 6913.10.50.00.
--    Re-added under the existing auto-generated names so the catalog matches the
--    corrected single-file contract exactly.
alter table public.hts_rag_precedents drop constraint if exists hts_rag_precedents_proposed_hts_check;
alter table public.hts_rag_precedents add constraint hts_rag_precedents_proposed_hts_check
  check (proposed_hts is null or proposed_hts ~ '^[0-9]{4}([.][0-9]{2}){0,3}$');

alter table public.hts_rag_determinations drop constraint if exists hts_rag_determinations_proposed_hts_check;
alter table public.hts_rag_determinations add constraint hts_rag_determinations_proposed_hts_check
  check (proposed_hts is null or proposed_hts ~ '^[0-9]{4}([.][0-9]{2}){0,3}$');

-- 2. A rag_shadow determination with no precedent is not a shadow comparison of anything,
--    yet it could become operative_eligible once classification_state reached
--    provisional_complete.
alter table public.hts_rag_determinations drop constraint if exists hts_rag_determinations_shadow_precedent_chk;
alter table public.hts_rag_determinations
  add constraint hts_rag_determinations_shadow_precedent_chk
  check (method <> 'rag_shadow' or precedent_id is not null);

-- 3. Extraction job state machine. The pending-claim index only sees unclaimed pending
--    rows, so a claimed pending row is invisible to every worker; a running or succeeded
--    row with no claim has no owner; and a succeeded row with no result hash succeeded at
--    nothing.
alter table public.hts_rag_extraction_jobs drop constraint if exists hts_rag_extraction_jobs_pending_unclaimed_chk;
alter table public.hts_rag_extraction_jobs
  add constraint hts_rag_extraction_jobs_pending_unclaimed_chk
  check (status <> 'pending' or claimed_at is null);

alter table public.hts_rag_extraction_jobs drop constraint if exists hts_rag_extraction_jobs_active_claim_chk;
alter table public.hts_rag_extraction_jobs
  add constraint hts_rag_extraction_jobs_active_claim_chk
  check (status not in ('running','succeeded') or claimed_at is not null);

alter table public.hts_rag_extraction_jobs drop constraint if exists hts_rag_extraction_jobs_success_result_chk;
alter table public.hts_rag_extraction_jobs
  add constraint hts_rag_extraction_jobs_success_result_chk
  check (status <> 'succeeded' or result_hash is not null);

-- 4. product_family is already the allowlist primary key, so a partial index on it buys
--    no new access path.
drop index if exists public.hts_rag_product_family_allowlist_enabled_idx;

-- 5. Both tables carry an administrator-gated read policy but were left out of the
--    authenticated SELECT grant, so those policies were inert: administrators could not
--    read the extraction queue or the pilot activation gate at all.
grant select on public.hts_rag_extraction_jobs,
  public.hts_rag_product_family_allowlist to authenticated;

-- 6. The comparison outcome itself is immutable history, but comparison_review_state is a
--    review workflow column with a queue index on it, and service_role held only
--    SELECT, INSERT -- so the index indexed a value nothing could ever transition. This
--    column-scoped grant makes the review queue workable. No other column becomes updatable.
grant update (comparison_review_state) on public.hts_rag_determinations to service_role;

-- 7. The backend policy was FOR ALL with using (true) / with check (true), wider than the
--    grants that enforce immutability. Split so that a later GRANT UPDATE cannot silently
--    inherit unrestricted DELETE from a policy nobody re-read.
drop policy if exists hts_rag_determinations_backend_all on public.hts_rag_determinations;
drop policy if exists hts_rag_determinations_backend_read on public.hts_rag_determinations;
drop policy if exists hts_rag_determinations_backend_insert on public.hts_rag_determinations;
drop policy if exists hts_rag_determinations_backend_review on public.hts_rag_determinations;
create policy hts_rag_determinations_backend_read on public.hts_rag_determinations for select to service_role using (true);
create policy hts_rag_determinations_backend_insert on public.hts_rag_determinations for insert to service_role with check (true);
create policy hts_rag_determinations_backend_review on public.hts_rag_determinations for update to service_role using (true) with check (true);

comment on table public.hts_rag_determinations is 'RAG-shadow and legacy AI/CROSS comparison outcomes. The outcome columns are immutable history: the backend may append and may transition comparison_review_state, but cannot rewrite a result or delete history.';
