-- Issue #3595: finish the final plm homes created by #3498 (migration
-- 20260925222635) before DesignFlow writes the first row into them.
-- derived-from: 20260901221310, 20260905053422
--
-- Structure only, additive. Both tables are empty in every environment at
-- authoring time; the four indexes are built inside the transaction.
--   1. The four source lookup-only indexes deferred by #3498, with exactly the
--      definitions live on dflow.item_user_assignment / dflow.item_workflow_action.
--   2. Append-only enforcement matching the dflow source triggers byte-for-byte
--      in behavior: workflow actions reject every UPDATE and DELETE; assignment
--      history rejects DELETE and allows only the single close of an active
--      assignment (effective_to NULL -> non-NULL, every other fact unchanged).
--      The only correction route, as in the source, is a table owner disabling
--      the trigger for one reviewed statement block (see 20260905053422).
--      INSERT is untouched, so the DesignFlow identity-preserving row move
--      (including already-closed assignments) is unaffected.
--   Consequence carried from the source: item_user_assignment's FK to
--   plm."RFQItem" is ON DELETE CASCADE, so deleting an RFQItem that has
--   assignment history is refused by this trigger (SQLSTATE 55000), exactly as
--   it is on dflow today.
-- Out of scope here (still open on #3595, each waiting on a decision):
--   user-id foreign keys (target user table not yet decided) and backend-role
--   grants/RLS policies (which service identity writes plm not yet decided).
--   Both tables stay deny-by-default until then.

BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '5min';

CREATE INDEX item_user_assignment_active_lookup
  ON plm.item_user_assignment (rfq_item_id, function_key, effective_from, id)
  INCLUDE (user_id)
  WHERE effective_to IS NULL;

CREATE INDEX item_workflow_action_item_time
  ON plm.item_workflow_action (rfq_item_id, occurred_at, id);

CREATE INDEX item_workflow_action_open_handoff_lookup
  ON plm.item_workflow_action (rfq_item_id, occurred_at DESC, id DESC)
  INCLUDE (actor_user_id);

CREATE INDEX item_workflow_action_admin_review
  ON plm.item_workflow_action (rfq_item_id, occurred_at)
  WHERE requires_admin_review;

CREATE FUNCTION plm.reject_item_assignment_history_rewrite()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, plm
AS $function$
begin
  if tg_op = 'DELETE' then
    raise exception 'item assignment history is append-only' using errcode = '55000';
  end if;

  if new.id is distinct from old.id
     or new.rfq_item_id is distinct from old.rfq_item_id
     or new.function_key is distinct from old.function_key
     or new.user_id is distinct from old.user_id
     or new.assigned_by_user_id is distinct from old.assigned_by_user_id
     or new.effective_from is distinct from old.effective_from
     or new.assignment_context is distinct from old.assignment_context
     or new.created_at is distinct from old.created_at
     or old.effective_to is not null
     or new.effective_to is null then
    raise exception 'assignment facts are immutable; only close an active assignment once' using errcode = '55000';
  end if;
  return new;
end
$function$;

CREATE TRIGGER item_user_assignment_immutable_history
BEFORE UPDATE OR DELETE ON plm.item_user_assignment
FOR EACH ROW EXECUTE FUNCTION plm.reject_item_assignment_history_rewrite();

CREATE FUNCTION plm.reject_item_workflow_action_rewrite()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, plm
AS $function$
begin
  raise exception 'workflow action history is append-only' using errcode = '55000';
end
$function$;

CREATE TRIGGER item_workflow_action_immutable
BEFORE UPDATE OR DELETE ON plm.item_workflow_action
FOR EACH ROW EXECUTE FUNCTION plm.reject_item_workflow_action_rewrite();

-- Trigger functions are never called directly.
REVOKE ALL ON FUNCTION plm.reject_item_assignment_history_rewrite() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION plm.reject_item_workflow_action_rewrite() FROM PUBLIC, anon, authenticated, service_role;

COMMENT ON FUNCTION plm.reject_item_assignment_history_rewrite() IS
  'Append-only guard for plm.item_user_assignment (#3595): rejects DELETE and any UPDATE except closing an active assignment once. Mirrors dflow.reject_item_assignment_history_rewrite.';
COMMENT ON FUNCTION plm.reject_item_workflow_action_rewrite() IS
  'Append-only guard for plm.item_workflow_action (#3595): rejects every UPDATE and DELETE. Mirrors dflow.reject_item_workflow_action_rewrite.';

COMMENT ON TABLE plm.item_user_assignment IS
  'Final plm item-master home for dflow.item_user_assignment (issues #3498, #3595). Item function-role assignment history; append-only enforced (only closing an active assignment once is allowed). Column shapes, indexes and append-only behavior match the dflow source. Row movement is a separate DesignFlow migration. User-id foreign keys and backend grants are still pending on #3595; deny-by-default until then.';
COMMENT ON TABLE plm.item_workflow_action IS
  'Final plm item-master home for dflow.item_workflow_action (issues #3498, #3595). Workflow action history; append-only enforced (UPDATE and DELETE refused). A return names source_action_id and never rewrites the original actor. Actor identity source is supabase_auth or designflow_jwt; backend email is normalized. Column shapes, indexes and append-only behavior match the dflow source. Row movement is a separate DesignFlow migration. User-id foreign keys and backend grants are still pending on #3595; deny-by-default until then.';

-- Catalogue verification: each new index has exactly its dflow source
-- definition (literal text, so it does not depend on dflow surviving or on the
-- session search_path), plus the triggers, function hardening and access boundary.
DO $verify$
DECLARE
  r record;
BEGIN
  FOR r IN SELECT * FROM (VALUES
    ('item_user_assignment_active_lookup',
     'CREATE INDEX item_user_assignment_active_lookup ON plm.item_user_assignment USING btree (rfq_item_id, function_key, effective_from, id) INCLUDE (user_id) WHERE (effective_to IS NULL)'),
    ('item_workflow_action_item_time',
     'CREATE INDEX item_workflow_action_item_time ON plm.item_workflow_action USING btree (rfq_item_id, occurred_at, id)'),
    ('item_workflow_action_open_handoff_lookup',
     'CREATE INDEX item_workflow_action_open_handoff_lookup ON plm.item_workflow_action USING btree (rfq_item_id, occurred_at DESC, id DESC) INCLUDE (actor_user_id)'),
    ('item_workflow_action_admin_review',
     'CREATE INDEX item_workflow_action_admin_review ON plm.item_workflow_action USING btree (rfq_item_id, occurred_at) WHERE requires_admin_review')
  ) AS e(name, def) LOOP
    IF pg_catalog.pg_get_indexdef(pg_catalog.to_regclass('plm.' || r.name)) IS DISTINCT FROM r.def THEN
      RAISE EXCEPTION 'index plm.% is %, expected %', r.name,
        pg_catalog.pg_get_indexdef(pg_catalog.to_regclass('plm.' || r.name)), r.def;
    END IF;
  END LOOP;

  IF EXISTS (
    SELECT 1 FROM unnest(ARRAY['anon','authenticated','service_role']) AS ro(role_name)
    CROSS JOIN unnest(ARRAY['plm.reject_item_assignment_history_rewrite()',
                            'plm.reject_item_workflow_action_rewrite()']) AS f(sig)
    WHERE pg_catalog.has_function_privilege(ro.role_name, f.sig, 'EXECUTE')
  ) OR (
    SELECT count(*) FROM pg_catalog.pg_proc
     WHERE oid IN ('plm.reject_item_assignment_history_rewrite()'::regprocedure,
                   'plm.reject_item_workflow_action_rewrite()'::regprocedure)
       AND proconfig @> ARRAY['search_path=pg_catalog, plm']
  ) <> 2 THEN
    RAISE EXCEPTION 'guard functions must pin search_path and not be executable by API roles';
  END IF;

  IF (SELECT count(*) FROM pg_catalog.pg_trigger t
       WHERE NOT t.tgisinternal AND t.tgenabled = 'O'
         AND ((t.tgrelid = 'plm.item_user_assignment'::regclass
               AND t.tgname = 'item_user_assignment_immutable_history'
               AND t.tgfoid = 'plm.reject_item_assignment_history_rewrite()'::regprocedure)
           OR (t.tgrelid = 'plm.item_workflow_action'::regclass
               AND t.tgname = 'item_workflow_action_immutable'
               AND t.tgfoid = 'plm.reject_item_workflow_action_rewrite()'::regprocedure))
         AND t.tgtype = 27  -- ROW(1) | BEFORE(2) | DELETE(8) | UPDATE(16)
     ) <> 2 THEN
    RAISE EXCEPTION 'append-only triggers missing or not BEFORE UPDATE OR DELETE FOR EACH ROW';
  END IF;

  IF EXISTS (
    SELECT 1 FROM unnest(ARRAY['anon','authenticated','service_role']) AS ro(role_name)
    CROSS JOIN unnest(ARRAY['plm.item_user_assignment','plm.item_workflow_action']) AS t(rel)
    CROSS JOIN unnest(ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) AS p(priv)
    WHERE pg_catalog.has_table_privilege(ro.role_name, t.rel, p.priv)
  ) THEN
    RAISE EXCEPTION 'deny-by-default privilege boundary changed';
  END IF;
END
$verify$;

COMMIT;
