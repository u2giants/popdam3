-- Migration: 20261225090102_hts_rag_precedents_luna_ruling_basis.sql
-- Purpose: Allow 'luna_ruling_verified' as a promotion_basis on hts_rag.hts_rag_precedents
-- and public.hts_rag_precedents, with a matching provenance + non-operative check constraint
-- and per-determination idempotency index (DesignFlow #278, popcre/shared-db#6922, claim #6938).
--
-- Settled business rule (November 20, 2026, popcre/shared-db#6922):
-- Albert authorized saving Luna-only results as accepted internal precedents when
-- verified rulings support the result. No second model vote is required; accepted
-- entries remain non-operative decision support (enforced by `not operative_eligible`).

-- =====================================================================================
-- 1. hts_rag.hts_rag_precedents (shared HTS RAG store)
-- =====================================================================================
alter table hts_rag.hts_rag_precedents
  drop constraint if exists hts_rag_precedents_promotion_basis_chk;

alter table hts_rag.hts_rag_precedents
  add constraint hts_rag_precedents_promotion_basis_chk
  check (promotion_basis in ('human_review', 'dual_model_verified', 'luna_ruling_verified', 'legacy_unspecified'));

alter table hts_rag.hts_rag_precedents
  drop constraint if exists hts_rag_precedents_luna_ruling_provenance_chk;

alter table hts_rag.hts_rag_precedents
  add constraint hts_rag_precedents_luna_ruling_provenance_chk
  check (
    promotion_basis <> 'luna_ruling_verified'
    or (
      promotion_source_determination_id is not null
      and promotion_policy_version is not null
      and promotion_gate_result is not null
      and (promotion_gate_result ->> 'passed') = 'true'
      and promotion_debate_run_id is null
      and not operative_eligible
    )
  );

create unique index if not exists hts_rag_precedents_luna_source_det_uidx
  on hts_rag.hts_rag_precedents (promotion_source_determination_id)
  where promotion_basis = 'luna_ruling_verified' and promotion_source_determination_id is not null;

-- =====================================================================================
-- 2. public.hts_rag_precedents (legacy/mirror table)
-- =====================================================================================
alter table public.hts_rag_precedents
  drop constraint if exists hts_rag_precedents_promotion_basis_chk;

alter table public.hts_rag_precedents
  add constraint hts_rag_precedents_promotion_basis_chk
  check (promotion_basis in ('human_review', 'dual_model_verified', 'luna_ruling_verified', 'legacy_unspecified'));

alter table public.hts_rag_precedents
  drop constraint if exists hts_rag_precedents_luna_ruling_provenance_chk;

alter table public.hts_rag_precedents
  add constraint hts_rag_precedents_luna_ruling_provenance_chk
  check (
    promotion_basis <> 'luna_ruling_verified'
    or (
      promotion_source_determination_id is not null
      and promotion_policy_version is not null
      and promotion_gate_result is not null
      and (promotion_gate_result ->> 'passed') = 'true'
      and promotion_debate_run_id is null
      and not operative_eligible
    )
  );

create unique index if not exists hts_rag_precedents_luna_source_det_uidx
  on public.hts_rag_precedents (promotion_source_determination_id)
  where promotion_basis = 'luna_ruling_verified' and promotion_source_determination_id is not null;

-- =====================================================================================
-- 3. Post-apply verification
-- =====================================================================================
do $verify$
declare
  v_schema text;
  v_def text;
begin
  foreach v_schema in array array['hts_rag', 'public'] loop
    select pg_get_constraintdef(c.oid) into v_def
    from pg_constraint c
    join pg_class t on t.oid = c.conrelid
    join pg_namespace n on n.oid = t.relnamespace
    where n.nspname = v_schema
      and t.relname = 'hts_rag_precedents'
      and c.conname = 'hts_rag_precedents_promotion_basis_chk';
    if v_def is null or position('luna_ruling_verified' in v_def) = 0 then
      raise exception '%.hts_rag_precedents missing luna_ruling_verified in promotion_basis_chk', v_schema;
    end if;

    if not exists (
      select 1
      from pg_constraint c
      join pg_class t on t.oid = c.conrelid
      join pg_namespace n on n.oid = t.relnamespace
      where n.nspname = v_schema
        and t.relname = 'hts_rag_precedents'
        and c.conname = 'hts_rag_precedents_luna_ruling_provenance_chk'
    ) then
      raise exception '%.hts_rag_precedents missing luna_ruling_provenance_chk', v_schema;
    end if;

    if not exists (
      select 1
      from pg_indexes
      where schemaname = v_schema
        and tablename = 'hts_rag_precedents'
        and indexname = 'hts_rag_precedents_luna_source_det_uidx'
    ) then
      raise exception '%.hts_rag_precedents missing hts_rag_precedents_luna_source_det_uidx', v_schema;
    end if;
  end loop;
end
$verify$;
