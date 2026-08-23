-- Issue #1374 (narrow early portion of #1238).
--
-- Retire only the two empty Universe A character tables.  The source landing
-- tables remain intact; only their obsolete nullable reconciliation foreign
-- keys are removed.  core.property and core.licensor are deliberately untouched.
--
-- Reversal: because every precondition below requires the retired tables and
-- every referencing value to be empty, rollback is structural only. Recreate
-- core.character from 20260621150815_app_core.sql, including its updated_at
-- trigger; restore its RLS/policies/authenticated grant from
-- 20260621151155_api_rls_realtime.sql and service_role grant from
-- 20260621164759_service_role_grants.sql. Recreate core.property_character in
-- full from 20260807170000_opa_property_character_landing.sql (index, comments,
-- RLS, policies and grants included), then restore the six or seven named FKs
-- with their original ON DELETE actions. Restore the list RPC from
-- 20260722005000_db_data_admin_read_contracts.sql AND apply its latest safe UUID
-- cursor correction from 20260722005200_fix_db_data_admin_uuid_cursor_aggregates.sql.
-- Restore the tree RPC from 20260814000000_licensing_manager_gate.sql, whose body
-- already carries the preceding division-context fixes. The focused contract
-- rehearses table/FK/index/trigger/RLS/policy/grant reconstruction inside a
-- rolled-back transaction.

do $migration$
declare
  v_count bigint;
  v_definition text;
  v_rewritten text;
  v_function regprocedure;
begin
  -- These locks close the check/drop race.  Every writer is held until this
  -- transaction either commits the complete change or rolls it all back.
  lock table core.character in access exclusive mode;
  lock table core.property_character in access exclusive mode;
  lock table core.style_guide_character in access exclusive mode;
  lock table dam.asset_character in access exclusive mode;
  lock table plm.nbcu_character in access exclusive mode;
  lock table plm.opa_character in access exclusive mode;
  lock table plm.pmt_character in access exclusive mode;
  if to_regclass('plm.source_resolution') is not null then
    execute 'lock table plm.source_resolution in access exclusive mode';
  end if;

  select count(*) into v_count from core.character;
  if v_count <> 0 then
    raise exception 'Universe A character retirement refused: core.character has % row(s)', v_count;
  end if;

  select count(*) into v_count from core.property_character;
  if v_count <> 0 then
    raise exception 'Universe A character retirement refused: core.property_character has % row(s)', v_count;
  end if;

  select count(*) into v_count from core.style_guide_character;
  if v_count <> 0 then
    raise exception 'Universe A character retirement refused: core.style_guide_character has % row(s)', v_count;
  end if;

  select count(*) into v_count from dam.asset_character;
  if v_count <> 0 then
    raise exception 'Universe A character retirement refused: dam.asset_character has % row(s)', v_count;
  end if;

  select count(*) into v_count from plm.nbcu_character where core_character_id is not null;
  if v_count <> 0 then
    raise exception 'Universe A character retirement refused: plm.nbcu_character has % populated core_character_id value(s)', v_count;
  end if;

  select count(*) into v_count from plm.opa_character where core_character_id is not null;
  if v_count <> 0 then
    raise exception 'Universe A character retirement refused: plm.opa_character has % populated core_character_id value(s)', v_count;
  end if;

  select count(*) into v_count from plm.pmt_character where core_character_id is not null;
  if v_count <> 0 then
    raise exception 'Universe A character retirement refused: plm.pmt_character has % populated core_character_id value(s)', v_count;
  end if;

  if to_regclass('plm.source_resolution') is not null then
    execute 'select count(*) from plm.source_resolution where core_character_id is not null'
      into v_count;
    if v_count <> 0 then
      raise exception 'Universe A character retirement refused: plm.source_resolution has % populated core_character_id value(s)', v_count;
    end if;

    execute 'alter table plm.source_resolution drop constraint if exists source_resolution_core_character_id_fkey';
  end if;

  -- Preserve each current API definition byte-for-byte except for the two
  -- character-count subqueries.  Assert the expected shape before execution so
  -- a future function change cannot be silently rewritten incorrectly.
  foreach v_function in array array[
    'api.db_data_admin_licensor_property_list(text,boolean,text,integer)'::regprocedure,
    'api.db_data_admin_licensor_property_tree(text,boolean,text,integer)'::regprocedure
  ] loop
    select pg_get_functiondef(v_function) into v_definition;

    if (length(v_definition) - length(replace(v_definition, 'core.character', '')))
       / length('core.character') <> 2 then
      raise exception 'Universe A character retirement refused: % has an unexpected core.character dependency count', v_function;
    end if;

    v_rewritten := regexp_replace(
      v_definition,
      '\(\s*SELECT count\(\*\)::integer(?: AS count)?\s+FROM core\.character ch\s+WHERE (?:\(ch\.property_id = (?:op|p)\.id\)|ch\.property_id = (?:op|p)\.id)\s*\)',
      '0',
      'gi'
    );

    if position('core.character' in v_rewritten) <> 0 then
      raise exception 'Universe A character retirement refused: % rewrite left a core.character dependency', v_function;
    end if;

    execute v_rewritten;
  end loop;
end
$migration$;

alter table core.style_guide_character
  drop constraint style_guide_character_character_id_fkey;
alter table dam.asset_character
  drop constraint asset_character_character_id_fkey;
alter table plm.nbcu_character
  drop constraint nbcu_character_core_character_id_fkey;
alter table plm.opa_character
  drop constraint opa_character_core_character_id_fkey;
alter table plm.pmt_character
  drop constraint pmt_character_core_character_id_fkey;
drop table core.property_character restrict;
drop table core.character restrict;

comment on function api.db_data_admin_licensor_property_list(text, boolean, text, integer) is
  'DB Data Admin only. Read-only Licensor -> Property hierarchy with source context, PLM division/type context, and loud orphan surfacing. Character counts remain present as zero for response compatibility after Universe A character retirement. Pages over Licensors by name; orphan_properties is always the complete anomaly list. Returns {licensors, orphan_properties, next_cursor, page_size}.';

comment on function api.db_data_admin_licensor_property_tree(text, boolean, text, integer) is
  'Licensing Manager read-only Licensor -> Property hierarchy and readiness snapshot with source context and PLM division/type context (division id, division name, and external company-division code). Character counts remain present as zero for response compatibility after Universe A character retirement. Pages over Licensors by name; orphan_properties is always the complete anomaly list. Returns {snapshot, reconciliation, licensors, orphan_properties, next_cursor, page_size}.';
