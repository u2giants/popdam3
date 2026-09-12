-- #2741: reconstruct the historical preview differences in an isolated rollback.
-- No shared target is used by CI. This test never changes licensed fixture rows.
BEGIN;
CREATE TEMP TABLE forward_catalog_before AS
SELECT p.proname,pg_get_functiondef(p.oid) definition FROM pg_proc p
JOIN pg_namespace n ON n.oid=p.pronamespace
WHERE n.nspname='core' AND p.proname IN
('guard_taxonomy_source_ref_identity','guard_character_alias_licensor','bump_taxonomy_source_ref_last_seen');
CREATE TEMP TABLE forward_rows_before AS SELECT to_jsonb(t) AS row_value FROM core.taxonomy_source_ref t;
CREATE TEMP VIEW forward_catalog_now AS
SELECT 'constraint'::text AS kind,conrelid::regclass::text AS object_name,conname AS member,
 pg_get_constraintdef(oid)||' validated='||convalidated AS definition
FROM pg_constraint WHERE conrelid IN ('core.character'::regclass,to_regclass('core.character_alias'),'core.taxonomy_source_ref'::regclass)
UNION ALL
SELECT 'index',schemaname||'.'||tablename,indexname,indexdef FROM pg_indexes
WHERE schemaname='core' AND tablename IN ('character','character_alias','taxonomy_source_ref')
UNION ALL
SELECT 'relation',oid::regclass::text,'security',relrowsecurity::text||'|'||coalesce(relacl::text,'')
FROM pg_class WHERE oid IN ('core.character'::regclass,to_regclass('core.character_alias'),'core.taxonomy_source_ref'::regclass)
UNION ALL
SELECT 'policy',schemaname||'.'||tablename,policyname,roles::text||'|'||cmd||'|'||coalesce(qual,'')||'|'||coalesce(with_check,'')
FROM pg_policies WHERE schemaname='core' AND tablename IN ('character','character_alias','taxonomy_source_ref');
CREATE TEMP TABLE forward_schema_before AS SELECT * FROM forward_catalog_now;
ALTER TABLE core.taxonomy_source_ref ADD COLUMN is_current boolean GENERATED ALWAYS AS (missing_since IS NULL) STORED;
ALTER TABLE core.character_alias DROP CONSTRAINT character_alias_parent_matches_character;
DROP INDEX core.character_id_licensor_id_key;
DROP TRIGGER b_taxonomy_source_ref_last_seen ON core.taxonomy_source_ref;
create or replace function core.guard_taxonomy_source_ref_identity()
returns trigger
language plpgsql
security definer
set search_path = core, pg_catalog
as $guard$
declare
  v_target_regclass regclass;
  v_target_exists   boolean;
  v_derived         uuid;
  v_old_derived     uuid;
  v_target_changed  boolean;
  v_last_seen_given boolean;
  v_licensor_scoped constant text[] := array['licensor', 'property', 'character', 'franchise'];
begin
  -- Blank strings are not identifiers. A blank source_id in particular is the classic
  -- way a whole feed collapses onto one provenance row.
  if new.entity_schema is null or length(btrim(new.entity_schema)) = 0 then
    raise exception 'core.taxonomy_source_ref refused: entity_schema must be a real schema name'
      using errcode = 'P0001';
  end if;
  if new.entity_table is null or length(btrim(new.entity_table)) = 0 then
    raise exception 'core.taxonomy_source_ref refused: entity_table must be a real table name'
      using errcode = 'P0001';
  end if;
  if new.source_system is null or length(btrim(new.source_system)) = 0
     or new.source_table is null or length(btrim(new.source_table)) = 0
     or new.source_id is null or length(btrim(new.source_id)) = 0 then
    raise exception
      'core.taxonomy_source_ref refused: source_system, source_table and source_id must all be non-blank -- provenance without a named source is not provenance'
      using errcode = 'P0001';
  end if;

  v_target_changed := tg_op = 'INSERT'
    or (old.entity_schema, old.entity_table, old.entity_id)
         is distinct from (new.entity_schema, new.entity_table, new.entity_id);

  -- KIND-SAFE TARGET INTEGRITY. entity_id is an untyped uuid: nothing in the catalog
  -- stops it naming a row in a completely different table, or no row at all. Checked
  -- only when the target actually changes, so pre-existing rows whose target has since
  -- been retired remain editable for their freshness fields.
  if v_target_changed then
    v_target_regclass := to_regclass(
      quote_ident(btrim(new.entity_schema)) || '.' || quote_ident(btrim(new.entity_table)));
    if v_target_regclass is null then
      raise exception
        'core.taxonomy_source_ref refused: entity_schema/entity_table %.% is not a real table',
        new.entity_schema, new.entity_table
        using errcode = 'P0001';
    end if;
    if new.entity_id is null then
      raise exception 'core.taxonomy_source_ref refused: entity_id must name a row'
        using errcode = 'P0001';
    end if;
  end if;

  -- COLLISION-PROOF SOURCE IDENTITY. Derive the licensor the provenance actually belongs
  -- to, from the entity it points at. A supplied value is checked, never trusted.
  if btrim(new.entity_schema) = 'core' and btrim(new.entity_table) = any (v_licensor_scoped) then
    -- Static, one branch per licensor-scoped kind. No dynamic SQL: the set of kinds
    -- that carry a licensor is a settled business fact, not a runtime lookup, and a
    -- statically written branch is the only form a reviewer can verify by reading it.
    case btrim(new.entity_table)
      when 'licensor' then
        select l.id into v_derived from core.licensor l where l.id = new.entity_id;
      when 'property' then
        select p.licensor_id into v_derived from core.property p where p.id = new.entity_id;
      when 'character' then
        select c.licensor_id into v_derived from core.character c where c.id = new.entity_id;
      when 'franchise' then
        select f.licensor_id into v_derived from core.franchise f where f.id = new.entity_id;
    end case;
    v_target_exists := found;

    -- KIND-SAFE TARGET INTEGRITY. entity_id is an untyped uuid: nothing in the catalog
    -- stops it naming a row in a different table, or no row at all. Checked only when
    -- the target actually changes, so pre-existing rows whose target has since been
    -- retired stay editable for their freshness fields.
    if v_target_changed and not v_target_exists then
      raise exception
        'core.taxonomy_source_ref refused: no row % in %.% -- provenance may not point at a non-existent entity',
        new.entity_id, new.entity_schema, new.entity_table
        using errcode = 'P0001';
    end if;

    if v_derived is null then
      raise exception
        'core.taxonomy_source_ref refused: %.% row % has no licensor, so its provenance has no owner -- source ids are only unique within a licensor and must never be recorded bare',
        new.entity_schema, new.entity_table, new.entity_id
        using errcode = 'P0001';
    end if;

    if new.source_licensor_id is null then
      new.source_licensor_id := v_derived;
    elsif new.source_licensor_id <> v_derived then
      raise exception
        'core.taxonomy_source_ref refused: source_licensor_id % disagrees with the licensor % of the entity it points at',
        new.source_licensor_id, v_derived
        using errcode = 'P0001';
    end if;
  end if;

  -- THE ANTI-COLLISION RULE. The pre-existing unique key
  -- (source_system, source_table, source_id) is global, and every importer upserts into
  -- it with `do update set entity_id = excluded.entity_id`. Left alone, a second licensor
  -- reusing the same small integer id would quietly capture the first licensor's
  -- provenance row. Once a row's licensor is known it is immutable: the second licensor
  -- gets an error instead of the first licensor's evidence.
  if tg_op = 'UPDATE'
     and old.source_licensor_id is not null
     and new.source_licensor_id is distinct from old.source_licensor_id then
    raise exception
      'core.taxonomy_source_ref refused: (%, %, %) is already licensor %''s provenance; repointing it to licensor % would attribute one licensor''s entity to another. Source ids collide across licensors -- record a separate row.',
      new.source_system, new.source_table, new.source_id,
      old.source_licensor_id, new.source_licensor_id
      using errcode = 'P0001';
  end if;

  -- THE SAME RULE FOR THE ROWS WE GRANDFATHERED. Every pre-#2355 row carries
  -- source_licensor_id null, so the rule above -- which keys off the OLD licensor --
  -- has nothing to compare against on the FIRST conflicting upsert, and the block
  -- higher up would simply stamp the incoming licensor onto the stolen row. Those
  -- legacy rows are precisely the ones a colliding importer reaches first, so the
  -- owner is re-derived from the OLD target instead. Deliberately silent when the old
  -- target is gone or was never licensor-scoped: a row whose old entity has since been
  -- retired stays editable for its freshness fields, exactly as before.
  if tg_op = 'UPDATE'
     and old.source_licensor_id is null
     and new.source_licensor_id is not null
     and v_target_changed
     and btrim(old.entity_schema) = 'core'
     and btrim(old.entity_table) = any (v_licensor_scoped) then
    case btrim(old.entity_table)
      when 'licensor' then
        select l.id into v_old_derived from core.licensor l where l.id = old.entity_id;
      when 'property' then
        select p.licensor_id into v_old_derived from core.property p where p.id = old.entity_id;
      when 'character' then
        select c.licensor_id into v_old_derived from core.character c where c.id = old.entity_id;
      when 'franchise' then
        select f.licensor_id into v_old_derived from core.franchise f where f.id = old.entity_id;
    end case;

    if v_old_derived is not null and v_old_derived <> new.source_licensor_id then
      raise exception
        'core.taxonomy_source_ref refused: (%, %, %) is licensor %''s provenance by the entity it already points at; repointing it to licensor % would attribute one licensor''s entity to another. Source ids collide across licensors -- record a separate row.',
        new.source_system, new.source_table, new.source_id,
        v_old_derived, new.source_licensor_id
        using errcode = 'P0001';
    end if;
  end if;

  -- FRESHNESS. Filled here rather than by column defaults so that an explicit null from
  -- an importer still produces a usable row, and so first_seen_at can never be moved
  -- forward by a later sighting.
  if tg_op = 'INSERT' then
    new.first_seen_at := coalesce(new.first_seen_at, now());
    new.last_seen_at  := coalesce(new.last_seen_at, new.first_seen_at);
  else
    -- Did the caller name last_seen_at itself? Decided BEFORE the column is filled in.
    v_last_seen_given := new.last_seen_at is not null
      and new.last_seen_at is distinct from old.last_seen_at;

    new.first_seen_at := coalesce(new.first_seen_at, old.first_seen_at, old.created_at);
    new.last_seen_at  := coalesce(new.last_seen_at, old.last_seen_at, new.first_seen_at);
    if old.first_seen_at is not null and new.first_seen_at > old.first_seen_at then
      -- "First seen" is a fact about the past. A later observation updates last_seen_at.
      new.first_seen_at := old.first_seen_at;
    end if;

    -- A RE-ASSERTION ADVANCES last_seen_at. Every importer in this repository upserts
    -- with `on conflict ... do update set entity_id = excluded.entity_id` and names no
    -- freshness column, so if the guard did not advance it here it could never advance
    -- at all, and "when the source most recently still asserted this" would be a
    -- permanent lie. Two exclusions, both deliberate: an explicit value from a caller
    -- is respected rather than overwritten, and an update that RECORDS ABSENCE
    -- (missing_since present) is not a sighting and must not be logged as one.
    if not v_last_seen_given and new.missing_since is null then
      new.last_seen_at := greatest(new.last_seen_at, now());
    end if;
  end if;

  return new;
end
$guard$;
-- Apply the new version to the historical shape, then apply it again as the fresh
-- reviewed-schema path. Both operations must preserve all independently held rows.
\ir ../migrations/20260911152203_character_alias_provenance_forward_repair.sql
\ir ../migrations/20260911152203_character_alias_provenance_forward_repair.sql
DO $verify$
BEGIN
 IF EXISTS ((SELECT * FROM forward_schema_before EXCEPT ALL SELECT * FROM forward_catalog_now)
 UNION ALL (SELECT * FROM forward_catalog_now EXCEPT ALL SELECT * FROM forward_schema_before)) THEN
  RAISE EXCEPTION 'Historical upgrade changed reviewed constraints, indexes, policies or grants';
 END IF;
 IF EXISTS ((SELECT * FROM forward_rows_before EXCEPT ALL SELECT to_jsonb(t) FROM core.taxonomy_source_ref t)
 UNION ALL (SELECT to_jsonb(t) FROM core.taxonomy_source_ref t EXCEPT ALL SELECT * FROM forward_rows_before)) THEN
  RAISE EXCEPTION 'Forward repair changed existing source provenance rows';
 END IF;
 IF EXISTS (SELECT 1 FROM forward_catalog_before b JOIN pg_proc p ON p.proname=b.proname
 JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='core' AND pg_get_functiondef(p.oid)<>b.definition) THEN
  RAISE EXCEPTION 'Historical and fresh paths did not converge to reviewed function definitions';
 END IF;
 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid=to_regclass('core.character_alias')
 AND conname='character_alias_parent_matches_character' AND confupdtype='c' AND convalidated) THEN
  RAISE EXCEPTION 'Parent licensor alias integrity missing after historical upgrade';
 END IF;
END
$verify$;
-- Full existing behavioral suite includes C10 re-licensing, cross-licensor refusal,
-- legacy freshness, RLS/grants and preservation of the original circuit breakers.
\ir character_alias_and_source_provenance_contracts.sql
ROLLBACK;

-- Production has never applied #2355. Reconstruct that pre-2355 schema while
-- retaining every older provenance field, then prove the replacement stands alone.
BEGIN;
CREATE TEMP VIEW forward_catalog_now AS
SELECT 'constraint'::text AS kind,conrelid::regclass::text AS object_name,conname AS member,
 pg_get_constraintdef(oid)||' validated='||convalidated AS definition
FROM pg_constraint WHERE conrelid IN ('core.character'::regclass,to_regclass('core.character_alias'),'core.taxonomy_source_ref'::regclass)
UNION ALL
SELECT 'index',schemaname||'.'||tablename,indexname,indexdef FROM pg_indexes
WHERE schemaname='core' AND tablename IN ('character','character_alias','taxonomy_source_ref')
UNION ALL
SELECT 'relation',oid::regclass::text,'security',relrowsecurity::text||'|'||coalesce(relacl::text,'')
FROM pg_class WHERE oid IN ('core.character'::regclass,to_regclass('core.character_alias'),'core.taxonomy_source_ref'::regclass)
UNION ALL
SELECT 'policy',schemaname||'.'||tablename,policyname,roles::text||'|'||cmd||'|'||coalesce(qual,'')||'|'||coalesce(with_check,'')
FROM pg_policies WHERE schemaname='core' AND tablename IN ('character','character_alias','taxonomy_source_ref');

CREATE TEMP TABLE fresh_expected_schema AS SELECT * FROM forward_catalog_now;
CREATE TEMP TABLE fresh_base_rows AS
SELECT to_jsonb(t)-ARRAY['source_licensor_id','first_seen_at','last_seen_at','missing_since'] AS row_value
FROM core.taxonomy_source_ref t;
DO $empty_alias_fixture$
BEGIN
 IF EXISTS(SELECT 1 FROM core.character_alias) THEN
  RAISE EXCEPTION 'Fresh-shape fixture requires an empty synthetic alias table';
 END IF;
END
$empty_alias_fixture$;
DROP TABLE core.character_alias RESTRICT;
DROP INDEX core.character_id_licensor_id_key;
DROP TRIGGER a_taxonomy_source_ref_identity_guard ON core.taxonomy_source_ref;
DROP TRIGGER b_taxonomy_source_ref_last_seen ON core.taxonomy_source_ref;
DROP FUNCTION core.guard_character_alias_licensor() RESTRICT;
DROP FUNCTION core.guard_taxonomy_source_ref_identity() RESTRICT;
DROP FUNCTION core.bump_taxonomy_source_ref_last_seen() RESTRICT;
ALTER TABLE core.taxonomy_source_ref
 DROP COLUMN source_licensor_id RESTRICT,
 DROP COLUMN first_seen_at RESTRICT,
 DROP COLUMN last_seen_at RESTRICT,
 DROP COLUMN missing_since RESTRICT;
\ir ../migrations/20260911152203_character_alias_provenance_forward_repair.sql
DO $fresh_verify$
BEGIN
 IF EXISTS ((SELECT * FROM fresh_base_rows EXCEPT ALL
 SELECT to_jsonb(t)-ARRAY['source_licensor_id','first_seen_at','last_seen_at','missing_since'] FROM core.taxonomy_source_ref t)
 UNION ALL (SELECT to_jsonb(t)-ARRAY['source_licensor_id','first_seen_at','last_seen_at','missing_since'] FROM core.taxonomy_source_ref t
 EXCEPT ALL SELECT * FROM fresh_base_rows)) THEN
  RAISE EXCEPTION 'Fresh replacement changed pre-existing provenance fields';
 END IF;
 IF EXISTS ((SELECT * FROM fresh_expected_schema EXCEPT ALL SELECT * FROM forward_catalog_now)
 UNION ALL (SELECT * FROM forward_catalog_now EXCEPT ALL SELECT * FROM fresh_expected_schema)) THEN
  RAISE EXCEPTION 'Fresh standalone replacement differs from final reviewed schema';
 END IF;
END
$fresh_verify$;
\ir character_alias_and_source_provenance_contracts.sql
ROLLBACK;
