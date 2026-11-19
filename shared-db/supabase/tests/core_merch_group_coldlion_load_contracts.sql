-- =====================================================================================
-- core.merch_group load from coldlion.merch_group_detail -- migration 20261225010507,
-- popcre/shared-db#4706.
--
-- Proves, on invented ZZ fixtures added beside whatever rows the replay already holds:
--   A. a DesignFlow ID matching exactly one feed row on full identity is attached;
--   B. two DesignFlow IDs sharing one feed identity are both held 'ambiguous' and the
--      feed row carries no DesignFlow ID;
--   C. a DesignFlow ID whose category differs (code + type alone match) is held
--      'unmatched' -- code-and-type does not establish identity;
--   D. every L4 row has an L3 parent, every attached ID exists in dflow_prod;
--   E. re-running the migration adds 0 rows;
--   F. anon/authenticated cannot read the review hold.
-- EVERY VALUE IN THIS FILE IS INVENTED. One transaction, ends in ROLLBACK.
-- =====================================================================================

\set mig `cat supabase/migrations/20261225010507_core_merch_group_load_from_coldlion.sql`

begin;

do $fx$
declare
  v_run uuid;
  h text := repeat('a', 64);
begin
  if to_regclass('dflow_prod."merchGroup"') is null then
    raise exception 'fixture: needs the production-shaped CI replay (dflow_prod."merchGroup")';
  end if;
  insert into coldlion.sync_run (endpoint, requested_by) values ('/zz4706', 'zz4706-test')
    returning id into v_run;
  insert into coldlion.merch_group_header (company_code, division_code, mg_type_code, run_id,
      fetched_at, source_hash, first_seen_at, last_seen_at)
    values ('ZZC', 'ZZ001', 'Z9', v_run, now(), h, now(), now());
  insert into coldlion.merch_group_detail (company_code, division_code, mg_type_code, mg_category,
      mg_code, mg_desc, active, run_id, fetched_at, source_hash, first_seen_at, last_seen_at)
    values ('ZZC', 'ZZ001', 'Z9', 'ZCAT', 'ZA', 'zz one', 'Y', v_run, now(), h, now(), now()),
           ('ZZC', 'ZZ001', 'Z9', 'ZCAT', 'ZB', 'zz two', 'Y', v_run, now(), h, now(), now());
  insert into dflow_prod."merchGroup" (mg_id, "companyCode_fk", "divisionCode_fk", "mgTypeCode",
      mg_code, "mgCategory") overriding system value
    values (-470601, 'ZZC', 'ZZ001', 'Z9', 'ZA', 'ZCAT'),
           (-470602, 'ZZC', 'ZZ001', 'Z9', 'ZB', 'ZCAT'),
           (-470603, 'ZZC', 'ZZ001', 'Z9', 'ZB', 'ZCAT'),
           (-470604, 'ZZC', 'ZZ001', 'Z9', 'ZA', 'ZOTHER');
end
$fx$;

:mig

select set_config('zz.rows_after_first', (select count(*) from core.merch_group)::text, true);
select set_config('zz.hold_after_first', (select count(*) from core.merch_group_review_hold)::text, true);

:mig

do $chk$
declare
  v_a core.merch_group;
  v_b core.merch_group;
begin
  select * into v_a from core.merch_group where metadata->>'source_identity' = 'L4|ZZC|ZZ001|Z9|ZCAT|ZA';
  select * into v_b from core.merch_group where metadata->>'source_identity' = 'L4|ZZC|ZZ001|Z9|ZCAT|ZB';
  -- A
  if v_a.id is null or (v_a.metadata->>'dflow_mg_id')::int is distinct from -470601 or v_a.level <> 4 then
    raise exception 'A: unique full-identity match not attached';
  end if;
  -- B
  if v_b.id is null or v_b.metadata ? 'dflow_mg_id' then
    raise exception 'B: ambiguous feed row must carry no DesignFlow ID';
  end if;
  if (select count(*) from core.merch_group_review_hold
      where dflow_mg_id in (-470602, -470603) and reason = 'ambiguous'
        and candidate_merch_group_id = v_b.id and shared_with_count = 1) <> 2 then
    raise exception 'B: both ambiguous IDs must be held with the shared candidate';
  end if;
  -- C
  if not exists (select 1 from core.merch_group_review_hold
                 where dflow_mg_id = -470604 and reason = 'unmatched' and candidate_merch_group_id is null) then
    raise exception 'C: category mismatch must be held unmatched';
  end if;
  -- D
  if exists (select 1 from core.merch_group c where c.level = 4
               and metadata->>'source' = 'coldlion.merch_group_detail'
               and not exists (select 1 from core.merch_group p where p.id = c.parent_id and p.level = 3)) then
    raise exception 'D: L4 row without an L3 parent';
  end if;
  if exists (select 1 from core.merch_group c where c.metadata ? 'dflow_mg_id'
               and not exists (select 1 from dflow_prod."merchGroup" d
                               where d.mg_id = (c.metadata->>'dflow_mg_id')::int)) then
    raise exception 'D: orphan DesignFlow ID';
  end if;
  -- E
  if (select count(*) from core.merch_group)::text <> current_setting('zz.rows_after_first')
     or (select count(*) from core.merch_group_review_hold)::text <> current_setting('zz.hold_after_first') then
    raise exception 'E: re-run added rows';
  end if;
  -- F
  if has_table_privilege('anon', 'core.merch_group_review_hold', 'select')
     or has_table_privilege('authenticated', 'core.merch_group_review_hold', 'select') then
    raise exception 'F: review hold readable by anon/authenticated';
  end if;
  raise notice 'core_merch_group_coldlion_load_contracts: all assertions passed';
end
$chk$;

rollback;
