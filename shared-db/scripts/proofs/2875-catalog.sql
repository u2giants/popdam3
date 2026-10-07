-- Canonical PUBLIC execute on trigger-only functions is fingerprinted unchanged; it cannot call a trigger as an RPC.
-- Same-issue #2875 catalog only; fixed complete canonical fingerprints and six operations.
BEGIN READ ONLY; WITH t2875_rel(name) as (values ('sample_approval_event'), ('sample_approval_current'), ('sample_balance_by_location'), ('sample_carrier'), ('sample_creation_batch'), ('sample_factory_visit'), ('sample_factory_visit_event'), ('sample_global_status'), ('sample_import_job'), ('sample_import_row'), ('sample_inventory_balance'), ('sample_inventory'), ('sample_in_transit'), ('sample_movement'), ('sample_open_stop_work'), ('sample_path_revision'), ('sample_piece_lineage'), ('sample_receipt_discrepancy'), ('sample_remote_request'), ('sample_remote_request_history'), ('sample_remote_request_item'), ('sample_reservation'), ('sample_shipment'), ('sample_shipment_line'), ('sample_stop_closeout'), ('sample_visit_plan'), ('sample_workflow')),
t2875_fn(name) as (values ('apply_sample_factory_visit_event'), ('apply_sample_path_revision'), ('pack_sample_reservation'), ('post_sample_approval_event'), ('post_sample_movement'), ('post_sample_piece_split'), ('post_sample_remote_request_event'), ('prevent_sample_shipment_route_drift'), ('project_sample_inventory_movement'), ('reject_sample_approval_event_mutation'), ('reject_sample_factory_visit_event_mutation'), ('reject_sample_movement_mutation'), ('reject_sample_path_revision_mutation'), ('require_sample_factory_visit_event'), ('require_sample_path_revision'), ('reserve_sample_remote_request_item'), ('sample_movement_auto_office_inventory'), ('sample_movement_guard'), ('touch_sample_factory_visit_updated_at'), ('validate_sample_approval_event'), ('validate_sample_factory_visit'), ('validate_sample_factory_visit_event'), ('validate_sample_movement_shipment_identity'), ('validate_sample_path_revision'), ('validate_sample_piece_lineage'), ('validate_sample_shipment_line_header')),
t2875_delta(item) as (values ('sample.quantity_migration_state'), ('sample_box.owner_factory_id_fk'),
  ('sample_box.ownership_state'), ('sample_box.current_custody_type'),
  ('sample_box.current_custody_id'), ('sample_shipment_item.quantity_intended'),
  ('sample.sample_quantity_migration_state_check'), ('sample_box.sample_box_custody_pair_check'),
  ('sample_box.sample_box_ownership_state_check'), ('sample_box.sample_box_owner_factory_fkey'),
  ('sample_shipment_item.sample_shipment_item_quantity_positive'),
  ('sample_shipment_item.sample_shipment_item_sample_box_uniq'),
  ('sample.sample_quantity_migration_state_idx'), ('sample_box.sample_box_active_name_custody_uniq'),
  ('sample_box.sample_box_owner_factory_idx'), ('sample_shipment_item.sample_shipment_item_box_id_fk_idx'),
  ('sample_shipment_item.sample_shipment_item_sample_id_fk_idx')),
t2875_all as (with rel as (
  select n.nspname s, c.oid, c.relname, c.relkind
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname in ('dflow', 'dflow_prod')
    and (c.relname in (select name from t2875_rel)
         or c.relname in ('sample', 'sample_box', 'sample_shipment_item'))
), fn as (
  select n.nspname s, p.oid, p.proname
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname in ('dflow', 'dflow_prod') and p.proname in (select name from t2875_fn)
)
select s::text s, 'relation'::text k, relname::text nm, relkind::text || ' acl=' || coalesce((select relacl::text from pg_class where oid = rel.oid), '-')
       || ' rls=' || (select relrowsecurity::text from pg_class where oid = rel.oid)
       || ' opts=' || coalesce((select reloptions::text from pg_class where oid = rel.oid), '-')
       || ' cmt=' || coalesce(obj_description(oid, 'pg_class'), '-') d
from rel where relname in (select name from t2875_rel)
union all
select r.s, 'column', r.relname || '.' || a.attname,
       format_type(a.atttypid, a.atttypmod) || ' nn=' || a.attnotnull || ' id=' || a.attidentity::text || ' gen=' || a.attgenerated::text
       || ' def=' || coalesce(pg_get_expr(d.adbin, d.adrelid), '-') || ' acl=' || coalesce(a.attacl::text, '-')
       || ' cmt=' || coalesce(col_description(r.oid, a.attnum), '-')
from rel r join pg_attribute a on a.attrelid = r.oid and a.attnum > 0 and not a.attisdropped
left join pg_attrdef d on d.adrelid = r.oid and d.adnum = a.attnum
where r.relkind in ('r', 'v')
union all
select r.s, 'constraint', r.relname || '.' || co.conname,
       pg_get_constraintdef(co.oid) || ' cmt=' || coalesce(obj_description(co.oid, 'pg_constraint'), '-')
from rel r join pg_constraint co on co.conrelid = r.oid and co.contype <> 'n'
union all
select r.s, 'index', r.relname || '.' || i.relname,
       pg_get_indexdef(i.oid) || ' cmt=' || coalesce(obj_description(i.oid, 'pg_class'), '-')
from rel r join pg_index x on x.indrelid = r.oid join pg_class i on i.oid = x.indexrelid
union all
select r.s, 'trigger', r.relname || '.' || t.tgname,
       pg_get_triggerdef(t.oid) || ' en=' || t.tgenabled::text || ' cmt=' || coalesce(obj_description(t.oid, 'pg_trigger'), '-')
from rel r join pg_trigger t on t.tgrelid = r.oid and not t.tgisinternal
union all
select r.s, 'view', r.relname, pg_get_viewdef(r.oid)
from rel r where r.relkind = 'v'
union all
select f.s, 'function', f.proname || '(' || pg_get_function_identity_arguments(f.oid) || ')',
       pg_get_functiondef(f.oid) || ' acl=' || coalesce((select proacl::text from pg_proc where oid = f.oid), '-')
       || ' cmt=' || coalesce(obj_description(f.oid, 'pg_proc'), '-')
from fn f),
t2875_def as (select * from t2875_all
where k in ('relation', 'view', 'function')
   or split_part(nm, '.', 1) in (select name from t2875_rel)
   or nm in (select item from t2875_delta)),
fingerprints as (select k,nm,md5(d) h from t2875_def where s='dflow_prod'),
funcs as (select p.* from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='dflow_prod' and p.proname in ('pack_sample_reservation','post_sample_approval_event','post_sample_movement','post_sample_piece_split','post_sample_remote_request_event','reserve_sample_remote_request_item')),
return_rels as (select c.* from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='dflow_prod' and c.relname in ('sample_reservation','sample_approval_event','sample_movement','sample_piece_lineage','sample_remote_request_history'))
SELECT jsonb_build_object(
 'fingerprint_count',(select count(*) from fingerprints),
 'definitions_sha256',(select encode(sha256(convert_to(string_agg(k||E'\t'||nm||E'\t'||h,E'\n' ORDER BY k COLLATE "C",nm COLLATE "C"),'UTF8')),'hex') from fingerprints),
 'client_access_closed', NOT EXISTS (select 1 from pg_roles where rolname in ('anon','authenticated','service_role') and has_schema_privilege(rolname,'dflow_prod','USAGE'))
   AND NOT EXISTS (select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace cross join lateral aclexplode(c.relacl) acl where n.nspname='dflow_prod' and c.relname in (select name from t2875_rel) and (acl.grantee=0 or acl.grantee in (select oid from pg_roles where rolname in ('anon','authenticated'))))
   AND NOT EXISTS (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace cross join lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) acl where n.nspname='dflow_prod' and p.proname in (select name from t2875_fn) and p.prorettype<>'trigger'::regtype and (acl.grantee=0 or acl.grantee in (select oid from pg_roles where rolname in ('anon','authenticated')))),
 'functions',(select jsonb_agg(jsonb_build_object(
  'name',p.proname,
  'argument_names',coalesce(to_jsonb(p.proargnames),'[]'::jsonb),
  'argument_types',(select coalesce(jsonb_agg(format_type(t.oid,NULL) order by a.ordinal),'[]'::jsonb) from unnest(p.proargtypes::oid[]) with ordinality a(oid,ordinal) join pg_type t on t.oid=a.oid),
  'default_count',p.pronargdefaults,'return_type',format_type(p.prorettype,NULL),
  'return_set',p.proretset
 ) order by p.proname) from funcs p),
 'return_relations',(select jsonb_agg(jsonb_build_object('name',r.relname,'columns',
  (select jsonb_agg(jsonb_build_array(a.attname,format_type(a.atttypid,a.atttypmod),NOT a.attnotnull) order by a.attnum)
   from pg_attribute a where a.attrelid=r.oid and a.attnum>0 and NOT a.attisdropped)) order by r.relname) from return_rels r)
) AS catalog; COMMIT;
