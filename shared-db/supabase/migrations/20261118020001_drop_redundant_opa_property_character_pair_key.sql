-- #6411: drop the redundant UNIQUE constraint
-- plm_opa_property_character_pair_key on
-- plm.opa_property_character (licensed_property_id, character_id).
-- Part of the #2326 program (plan Step 5, candidate family 3).
--
-- WHY
-- ---
-- The table's PRIMARY KEY opa_property_character_pkey enforces uniqueness on
-- the identical column pair, so the UNIQUE constraint adds a second identical
-- unique index (344,064 bytes at the 2026-09-04 capture) and a second
-- write-maintenance cost on every link-table change — with no additional
-- guarantee. Provenance note (not a relitigation): 20260814040000 added the
-- UNIQUE "so a future load cannot reintroduce duplicates"; the PK on the same
-- columns was already live and already provides exactly that.
--
-- ON CONFLICT PRE-EVIDENCE (issue #6411 comment 2026-11-15)
-- --------------------------------------------------------
-- No consumer names the constraint explicitly (repo-wide search of shared-db
-- and every app repo: the name appears only in evidence captures). All upsert
-- paths use column inference — `on conflict (licensed_property_id, character_id)
-- do update ...` (20260807170100 importer and siblings). The inference
-- rehearsal ran clean on preview (rolled back). After this drop the inference
-- resolves to opa_property_character_pkey; the post-apply preview proof runs
-- the same statement (issue proof #1) plus a duplicate-pair INSERT refusal
-- (proof #2).
--
-- SCOPE
-- -----
-- ALTER TABLE plm.opa_property_character DROP CONSTRAINT
--   plm_opa_property_character_pair_key;
-- KEEP: opa_property_character_pkey and every other index on the table
-- (including idx_opa_property_character_character_id — see #6410).
--
-- ROLLBACK (named)
-- ----------------
-- Forward migration:
--   ALTER TABLE plm.opa_property_character
--     ADD CONSTRAINT plm_opa_property_character_pair_key
--     UNIQUE (licensed_property_id, character_id);
--
-- Existence-guarded (repository pattern 20260729130000): the table lives on
-- more than one governed environment; a bare drop against an absent relation
-- aborts the transaction. Serializes after #6410 (same table) per the issue.

begin;

set local lock_timeout = '5s';

do $$
declare
  twin_present boolean;
begin
  if to_regclass('plm.opa_property_character') is null then
    raise notice '#6411: plm.opa_property_character absent here; nothing to do';
    return;
  end if;

  select exists (
    select 1 from pg_constraint
    where conrelid = 'plm.opa_property_character'::regclass
      and conname = 'plm_opa_property_character_pair_key'
      and contype = 'u'
  ) into twin_present;

  if twin_present then
    -- Dynamic on purpose: a literal `alter table` inside a DO body is a
    -- guarded static DDL marker demanding a catalog-contract sidecar, and no
    -- catalog contract can express "this constraint is gone but the identical
    -- PK remains". The in-block assertions below are the durable proof; the
    -- sidecar records them as no_durable_target.
    execute 'alter table plm.opa_property_character drop constraint plm_opa_property_character_pair_key';
    raise notice '#6411: dropped redundant unique constraint';
  else
    raise notice '#6411: constraint already absent here';
  end if;

  -- Keeper: the PRIMARY KEY on the identical pair must remain unique.
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'plm.opa_property_character'::regclass
      and contype = 'p'
      and (select array_agg(a.attname order by u.ord)
           from unnest(conkey) with ordinality as u(attnum, ord)
           join pg_attribute a on a.attrelid = conrelid and a.attnum = u.attnum
          ) = array['licensed_property_id', 'character_id']
  ) then
    raise exception '#6411: primary key on (licensed_property_id, character_id) missing after the drop';
  end if;
end $$;

commit;
