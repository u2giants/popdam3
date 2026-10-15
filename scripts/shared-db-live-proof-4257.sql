-- Live proof for popcre/shared-db#4257 (production PO no-reuse).
-- One DO block = one statement = one transaction. It ALWAYS ends with
-- RAISE EXCEPTION, so every probe below (including the guarded attempts) is
-- rolled back and nothing is ever committed. The result travels in the error
-- message as POPDAM_LIVE_PROOF_4257:<json>.
do $proof$
declare
  r jsonb := '{}'::jsonb;
  o record;
  st text;
  cn text;
  n bigint;
begin
  select jsonb_build_object('enabled', t.tgenabled, 'definition', pg_get_triggerdef(t.oid))
    into r from pg_trigger t
   where t.tgrelid = 'plm.production_order'::regclass and t.tgname = 'production_po_no_reuse' and not t.tgisinternal;
  r := jsonb_build_object('trigger', coalesce(r, 'null'::jsonb));

  -- Existing orders remain readable.
  select count(*) into n from plm.production_order;
  r := r || jsonb_build_object('orders_readable', n);
  select p.id, p.production_order_number into o from plm.production_order p
   where p.voided_at is null order by p.updated_at desc, p.id limit 1;
  if o.id is null then raise exception 'POPDAM_LIVE_PROOF_4257_FAILED:no order to probe'; end if;

  -- Existing orders remain editable (same PO, ordinary field change).
  begin
    update plm.production_order set metadata = metadata || '{"live_proof_4257":true}'::jsonb where id = o.id;
    get diagnostics n = row_count;
    r := r || jsonb_build_object('edit_existing', jsonb_build_object('ok', true, 'rows', n));
  exception when others then
    get stacked diagnostics st = returned_sqlstate;
    r := r || jsonb_build_object('edit_existing', jsonb_build_object('ok', false, 'sqlstate', st));
  end;

  -- An existing order's PO number cannot be changed.
  begin
    update plm.production_order set production_order_number = production_order_number || '-live-proof' where id = o.id;
    r := r || jsonb_build_object('change_existing_po', jsonb_build_object('refused', false));
  exception when others then
    get stacked diagnostics st = returned_sqlstate;
    r := r || jsonb_build_object('change_existing_po', jsonb_build_object('refused', true, 'sqlstate', st));
  end;

  -- A new order reusing the number (case and outer-whitespace variant) is refused.
  begin
    insert into plm.production_order(id, production_order_number)
    values (gen_random_uuid(), ' ' || upper(o.production_order_number) || ' ');
    r := r || jsonb_build_object('reuse_variant', jsonb_build_object('refused', false));
  exception when others then
    get stacked diagnostics st = returned_sqlstate, cn = constraint_name;
    r := r || jsonb_build_object('reuse_variant', jsonb_build_object('refused', true, 'sqlstate', st, 'constraint', cn));
  end;

  -- The reservation is permanent: after voiding and then deleting the order,
  -- its number still cannot be reused.
  begin
    update plm.production_order set voided_at = now(), void_reason = 'live proof 4257' where id = o.id;
    begin
      insert into plm.production_order(id, production_order_number) values (gen_random_uuid(), o.production_order_number);
      r := r || jsonb_build_object('reuse_after_void', jsonb_build_object('refused', false));
    exception when others then
      get stacked diagnostics st = returned_sqlstate, cn = constraint_name;
      r := r || jsonb_build_object('reuse_after_void', jsonb_build_object('refused', true, 'sqlstate', st, 'constraint', cn));
    end;
    delete from plm.production_order where id = o.id;
    begin
      insert into plm.production_order(id, production_order_number) values (gen_random_uuid(), o.production_order_number);
      r := r || jsonb_build_object('reuse_after_delete', jsonb_build_object('refused', false));
    exception when others then
      get stacked diagnostics st = returned_sqlstate, cn = constraint_name;
      r := r || jsonb_build_object('reuse_after_delete', jsonb_build_object('refused', true, 'sqlstate', st, 'constraint', cn));
    end;
  exception when others then
    get stacked diagnostics st = returned_sqlstate;
    r := r || jsonb_build_object('void_delete_setup_failed', st);
  end;

  -- Every existing number is reserved.
  select count(*) into n from (
    select distinct plm.normalize_production_po_number(production_order_number) po from plm.production_order
  ) x where not exists (select 1 from plm.production_po_reservation v where v.normalized_po = x.po);
  r := r || jsonb_build_object('unreserved_existing_numbers', n);

  -- Historical exceptions only through sealed exact-order admissions.
  r := r || jsonb_build_object('admission_guard', jsonb_build_object(
    'app_roles_can_write_admissions', (select bool_or(has_table_privilege(x, 'plm.production_po_legacy_admission', 'INSERT,UPDATE,DELETE'))
                                        from unnest(array['anon','authenticated','service_role']) x),
    'app_roles_can_write_reservations', (select bool_or(has_table_privilege(x, 'plm.production_po_reservation', 'INSERT,UPDATE,DELETE'))
                                          from unnest(array['anon','authenticated','service_role']) x),
    'digest_checks', (select count(*) from pg_constraint where conrelid = 'plm.production_po_legacy_admission'::regclass and contype = 'c'
                        and pg_get_constraintdef(oid) ~ 'sha256'),
    'order_id_primary_key', exists (select 1 from pg_constraint where conrelid = 'plm.production_po_legacy_admission'::regclass and contype = 'p')
  ));

  raise exception 'POPDAM_LIVE_PROOF_4257:%', r::text using errcode = 'P0001';
end;
$proof$;
