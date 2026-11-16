-- #6410: retire 3 plain (non-unique) btree indexes that are definition-identical
-- twins of another index on the same table and column. Part of the #2326
-- program (plan Step 5, candidate family 3, split by the 2026-11-15 triage).
--
-- WHY
-- ---
-- Each pair is two unconstrained btrees on the same single column — pure write
-- amplification on every INSERT/UPDATE of that column. The keeper is pinned by
-- a repository contract test where one exists, otherwise by first-captured
-- provenance:
--   plm.production_order:       drop plm_production_order_number_idx,
--                               keep production_order_number_idx
--                               (dam_order_list_contract.sql names the keeper)
--   plm.opa_property_character: drop plm_opa_property_character_character_idx,
--                               keep idx_opa_property_character_character_id
--                               (opa_property_character_landing_contracts.sql)
--   public.app_access:          drop app_access_user_id_idx,
--                               keep idx_app_access_user_id
--                               (ci-bootstrap 010_pre_adoption_baseline.sql)
--
-- The optional scope extension in #6410 (drop idx_app_access_user_id too, if
-- the composite app_access_user_id_app_key proves to serve the user_id path)
-- is preview-proof gated and NOT assumed here. It can be a follow-up issue with
-- its own EXPLAIN proof.
--
-- ROLLBACK (named, per index)
-- ---------------------------
-- Forward migration restoring the exact captured definitions:
--   CREATE INDEX plm_production_order_number_idx ON plm.production_order (production_order_number);
--   CREATE INDEX plm_opa_property_character_character_idx ON plm.opa_property_character (character_id);
--   CREATE INDEX app_access_user_id_idx ON public.app_access (user_id);
--
-- Existence-guarded per object (repository pattern 20260729130000): the same
-- names live on more than one governed environment and a bare drop against an
-- absent relation aborts the transaction. Keeper assertion is definition-based
-- (a btree on the same column must remain), which also survives keeper-name
-- divergence across environments.

begin;

set local lock_timeout = '5s';

do $$
declare
  t record;
  dropped integer := 0;
  skipped text := '';
  missing text := '';
begin
  for t in
    select * from (values
      ('plm', 'plm_production_order_number_idx', 'plm', 'production_order', 'production_order_number'),
      ('plm', 'plm_opa_property_character_character_idx', 'plm', 'opa_property_character', 'character_id'),
      ('public', 'app_access_user_id_idx', 'public', 'app_access', 'user_id')
    ) as v(sch, idx, tsch, tbl, col)
  loop
    if exists (
      select 1 from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = v.sch and c.relname = v.idx and c.relkind = 'i'
    ) then
      execute format('drop index if exists %I.%I', v.sch, v.idx);
      dropped := dropped + 1;
    else
      skipped := skipped || v.sch || '.' || v.idx || '; ';
    end if;

    if exists (
      select 1 from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = v.tsch and c.relname = v.tbl and c.relkind = 'r'
    ) then
      if not exists (
        select 1
        from pg_index ix
        join pg_class i on i.oid = ix.indexrelid
        join pg_class c on c.oid = ix.indrelid
        join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = v.tsch and c.relname = v.tbl
          and i.relname <> v.idx
          and (select array_agg(a.attname order by u.ord)
               from unnest(ix.indkey) with ordinality as u(attnum, ord)
               join pg_attribute a on a.attrelid = ix.indrelid and a.attnum = u.attnum
              ) = array[v.col]
      ) then
        missing := missing || v.tsch || '.' || v.tbl || '(' || v.col || '); ';
      end if;
    end if;
  end loop;

  raise notice '#6410: dropped % twin index(es); absent here: %', dropped, skipped;

  if missing <> '' then
    raise exception '#6410 keeper missing after twin drops: %', missing;
  end if;
end $$;

commit;
