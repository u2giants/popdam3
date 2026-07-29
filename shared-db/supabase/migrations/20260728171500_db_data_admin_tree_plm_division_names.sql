-- DB Data Admin: name the PLM divisions in the Licensor -> Property tree payload.
--
-- Why: the tree's `plm_context` entries identify a division only by its raw
-- PLM id, so the Properties table rendered rows like
--
--     1 · property · GS, 8 · property · GS
--
-- which no administrator can read. `1` and `8` are `plm."divisionCode"."divCode_id"`
-- values — POP Lic (CW001) and Spruce Lic (SP001). This adds the division's
-- human name and its external company-division code to every `plm_context`
-- entry so the UI can render "POP Lic (CW001) · GS" instead.
--
-- ADDITIVE ONLY. Two new keys per entry; `division_code`, `mg_type`, `mg_code`
-- and `mg_category` all keep their current meaning and position, so any existing
-- consumer of this contract is unaffected.
--
-- Deliberate omissions (do not "fix" these):
--   * `mg_type` stays in the payload even though it is a fixed literal per
--     branch ('licensor' / 'property'). Removing a key is a breaking contract
--     change; the UI simply stops displaying it.
--   * The lookup is a scalar subquery, not a join. `plm."divisionCode"` holds 5
--     rows and the id may be absent, so a join risks dropping a PLM context
--     entry — the exact failure this contract exists to make loud. A missing
--     division yields nulls and the UI falls back to the raw code.
--   * `divCode_id` 1 and 7 share the division_name 'POP Lic', which is why the
--     external code (CW001 / SP001) is carried alongside the name rather than
--     instead of it.
--
-- Method follows migration 20260722203100: the preceding tree migrations are
-- already applied to preview, so history stays immutable and only the live
-- function definition is re-issued via CREATE OR REPLACE, which retains the
-- attached grants and comment. The guards below fail loudly rather than
-- silently no-op if the definition has drifted from what this patch expects.

do $$
declare
  v_function regprocedure := 'api.db_data_admin_licensor_property_tree(text,boolean,text,integer)'::regprocedure;
  v_definition text;
  v_property_anchor text := '''division_code'', pi.division_code,';
  v_licensor_anchor text := '''division_code'', li.division_code,';
  v_property_patch text :=
    '''division_code'', pi.division_code,
             ''division_name'', (
               select d.division_name from plm."divisionCode" d
               where d."divCode_id"::text = pi.division_code
             ),
             ''division_external_code'', (
               select d.external_divisoncode from plm."divisionCode" d
               where d."divCode_id"::text = pi.division_code
             ),';
  v_licensor_patch text :=
    '''division_code'', li.division_code,
             ''division_name'', (
               select d.division_name from plm."divisionCode" d
               where d."divCode_id"::text = li.division_code
             ),
             ''division_external_code'', (
               select d.external_divisoncode from plm."divisionCode" d
               where d."divCode_id"::text = li.division_code
             ),';
  v_property_hits integer;
  v_licensor_hits integer;
begin
  v_definition := pg_get_functiondef(v_function);

  -- Two property branches (orphan properties, and properties nested under a
  -- licensor) plus one licensor branch. Any other count means the definition
  -- drifted and this patch must be re-derived rather than applied blind.
  v_property_hits := (length(v_definition) - length(replace(v_definition, v_property_anchor, ''))) / length(v_property_anchor);
  v_licensor_hits := (length(v_definition) - length(replace(v_definition, v_licensor_anchor, ''))) / length(v_licensor_anchor);

  if v_property_hits <> 2 then
    raise exception 'expected 2 property plm_context blocks in %, found %', v_function, v_property_hits;
  end if;
  if v_licensor_hits <> 1 then
    raise exception 'expected 1 licensor plm_context block in %, found %', v_function, v_licensor_hits;
  end if;
  if position('division_name' in v_definition) > 0 then
    raise exception 'division_name already present in %; this patch is not idempotent-safe against a patched body', v_function;
  end if;

  v_definition := replace(v_definition, v_property_anchor, v_property_patch);
  v_definition := replace(v_definition, v_licensor_anchor, v_licensor_patch);
  execute v_definition;
end $$;

comment on function api.db_data_admin_licensor_property_tree(text, boolean, text, integer) is
  'DB Data Admin only. Read-only Licensor -> Property hierarchy with source context, PLM division/type context (division id, division name, and external company-division code), character counts, and loud orphan surfacing. Pages over Licensors by name; orphan_properties is always the complete anomaly list. Returns {snapshot, reconciliation, licensors, orphan_properties, next_cursor, page_size}.';
