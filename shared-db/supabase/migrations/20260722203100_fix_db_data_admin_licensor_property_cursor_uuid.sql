-- Correct the Step 10 Licensor -> Property tree cursor extraction. PostgreSQL
-- has no max(uuid) aggregate, so the tree's keyset aggregate
--   max(n.id) filter (where n.rn = v_page_size)
-- fails at first RPC execution with `function max(uuid) does not exist`.
--
-- This is the same class of defect already corrected for the Step 6 list
-- contracts in migration 20260722005200; the Step 10 tree function did not
-- exist when that fix landed, so it shipped with the identical aggregate.
--
-- The preceding migration 20260722203000 is already applied to preview, so keep
-- history immutable and replace only the single affected function definition,
-- swapping the UUID aggregate for a deterministic text-keyed expression:
--   (max(n.id::text) filter (where n.rn = v_page_size))::uuid
-- Text comparison of canonical uuid strings is a total order under the "C"
-- collation the surrounding keyset already uses (sort_value collate "C"), so
-- the resulting last-id is deterministic and consistent with the page ordering.
--
-- The function contract, SECURITY DEFINER + pinned search_path, EXECUTE revoked
-- from public / granted only to authenticated, the comment, and the
-- unconditional live_upstream_reconciliation=false behavior are all preserved:
-- this edits one aggregate expression inside the existing body and re-issues it
-- via CREATE OR REPLACE, which retains the already-attached grants and comment.

do $$
declare
  v_function regprocedure := 'api.db_data_admin_licensor_property_tree(text,boolean,text,integer)'::regprocedure;
  v_definition text;
  v_invalid text := 'max(n.id) filter (where n.rn = v_page_size)';
  v_valid text := '(max(n.id::text) filter (where n.rn = v_page_size))::uuid';
begin
  v_definition := pg_get_functiondef(v_function);
  if position(v_invalid in v_definition) = 0 then
    raise exception 'expected UUID cursor aggregate not found in %', v_function;
  end if;
  execute replace(v_definition, v_invalid, v_valid);
end $$;
