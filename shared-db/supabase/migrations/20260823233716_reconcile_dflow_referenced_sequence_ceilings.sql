-- Advance the 18 referenced dflow identity sequences beyond every measured id space.
--
-- Issue #1315 audited the split Supabase dflow schema, the leftover Supabase
-- designflow schema, and live Cloud SQL DesignFlow production. Only ids that are
-- referenced by another table/application/export/URL are included. Seven unreferenced
-- sibling sequences are deliberately excluded: an id discontinuity is permanent, so
-- this migration does not blanket-bump sequences that have no demonstrated collision path.
--
-- The external ceilings below are the highest read-only measurements across Cloud SQL
-- production and the Supabase orphan (where present). The chosen floors clear those
-- ceilings with a visible post-split boundary. At apply time every target is also raised
-- to the current dflow table max, so concurrent growth can never make this migration move
-- a sequence behind its own table.
--
-- Safety properties:
--   * forward-only, with is_called handled when calculating the next issued value;
--   * greatest(evidence-backed floor, current table max(id));
--   * every sequence and table resolved through to_regclass for from-empty replay;
--   * post-change assertions cover the floor, current table max, and measured external
--     ceiling for every included sequence;
--   * no data rows are changed.

do $migration$
declare
  v record;
  v_seq regclass;
  v_table regclass;
  v_current bigint;
  v_is_called boolean;
  v_next bigint;
  v_max_id bigint;
  v_target bigint;
begin
  for v in
    select *
    from (values
      ('dflow."AuditLog_id_seq"',                    'dflow."AuditLog"',          'id',                1000000::bigint,  610745::bigint),
      ('dflow."Factory_id_seq"',                     'dflow."Factory"',           'id',                   1000::bigint,     201::bigint),
      ('dflow."MerchGroup_mg_id_seq"',               'dflow."merchGroup"',        'mg_id',               10000::bigint,    4867::bigint),
      ('dflow."ProdOrderHeader_id_seq"',             'dflow."ProdOrderHeader"',   'id',                 100000::bigint,   15298::bigint),
      ('dflow."RFQContainer_RFQContainer_id_seq"',   'dflow."RFQContainer"',     'RFQContainer_id',       100::bigint,      26::bigint),
      ('dflow."RFQGroup_RFQGroup_id_seq"',           'dflow."RFQGroup"',         'RFQGroup_id',          1000::bigint,     424::bigint),
      ('dflow."RFQItem_rfqItem_id_seq"',             'dflow."RFQItem"',          'rfqItem_id',         100000::bigint,   18128::bigint),
      ('dflow."RFQVendor_RFQVendor_id_seq"',         'dflow."RFQVendor"',        'RFQVendor_id',       100000::bigint,   36912::bigint),
      ('dflow."StandardizedGroup_id_seq"',           'dflow."StandardizedGroup"','id',                   1000::bigint,      94::bigint),
      ('dflow."StandardizedSize_id_seq"',            'dflow."StandardizedSize"', 'id',                   1000::bigint,     644::bigint),
      ('dflow.customers_customers_id_seq',             'dflow.customers',            'customers_id',         1000::bigint,      57::bigint),
      ('dflow."externalCustomer_id_seq"',            'dflow."externalCustomer"', 'id',               30000000::bigint,19142539::bigint),
      ('dflow."externalVendor_id_seq"',              'dflow."externalVendor"',   'id',               20000000::bigint,12258025::bigint),
      ('dflow."licensingStatus_id_seq"',             'dflow."licensingStatus"',  'id',                 100000::bigint,   16468::bigint),
      ('dflow.user_notification_id_seq',               'dflow.user_notification',    'id',                1000000::bigint,  108207::bigint),
      ('dflow.users_id_seq',                           'dflow.users',                'id',                   1000::bigint,      72::bigint),
      ('dflow.vendor_vendor_id_seq',                   'dflow.vendor',               'vendor_id',            1000::bigint,     299::bigint),
      ('dflow."itemHeader_item_num_id_pk _seq"',      'dflow."itemHeader"',        'item_id_pk',          100000::bigint,   19877::bigint)
    ) as audited(sequence_name, table_name, id_column, floor_value, external_ceiling)
  loop
    v_seq := to_regclass(v.sequence_name);
    if v_seq is null then
      raise notice '% is absent; nothing to advance (from-empty replay).', v.sequence_name;
      continue;
    end if;

    v_table := to_regclass(v.table_name);
    if v_table is null then
      v_max_id := 0;
    else
      execute format('select coalesce(max(%I), 0) from %s', v.id_column, v_table)
        into v_max_id;
    end if;

    execute format('select last_value, is_called from %s', v_seq)
      into v_current, v_is_called;
    v_next := case when v_is_called then v_current + 1 else v_current end;
    v_target := greatest(v.floor_value, v_max_id);

    if v_next <= v_target then
      perform setval(v_seq, v_target, true);
      raise notice '% advanced from % to %; next id will be %.',
        v.sequence_name, v_current, v_target, v_target + 1;
    else
      raise notice '% would next issue % (target %); left unchanged. Sequences are never moved backwards.',
        v.sequence_name, v_next, v_target;
    end if;
  end loop;
end
$migration$;

-- Apply-time contract verification. Cloud SQL is a different database and cannot be
-- queried here, so its read-only measured maxima are constants in the audited list. The
-- assertions prove that the resulting next value clears each external ceiling as well as
-- the live dflow table maximum.
do $verification$
declare
  v record;
  v_seq regclass;
  v_table regclass;
  v_current bigint;
  v_is_called boolean;
  v_next bigint;
  v_max_id bigint;
begin
  for v in
    select *
    from (values
      ('dflow."AuditLog_id_seq"',                    'dflow."AuditLog"',          'id',                1000000::bigint,  610745::bigint),
      ('dflow."Factory_id_seq"',                     'dflow."Factory"',           'id',                   1000::bigint,     201::bigint),
      ('dflow."MerchGroup_mg_id_seq"',               'dflow."merchGroup"',        'mg_id',               10000::bigint,    4867::bigint),
      ('dflow."ProdOrderHeader_id_seq"',             'dflow."ProdOrderHeader"',   'id',                 100000::bigint,   15298::bigint),
      ('dflow."RFQContainer_RFQContainer_id_seq"',   'dflow."RFQContainer"',     'RFQContainer_id',       100::bigint,      26::bigint),
      ('dflow."RFQGroup_RFQGroup_id_seq"',           'dflow."RFQGroup"',         'RFQGroup_id',          1000::bigint,     424::bigint),
      ('dflow."RFQItem_rfqItem_id_seq"',             'dflow."RFQItem"',          'rfqItem_id',         100000::bigint,   18128::bigint),
      ('dflow."RFQVendor_RFQVendor_id_seq"',         'dflow."RFQVendor"',        'RFQVendor_id',       100000::bigint,   36912::bigint),
      ('dflow."StandardizedGroup_id_seq"',           'dflow."StandardizedGroup"','id',                   1000::bigint,      94::bigint),
      ('dflow."StandardizedSize_id_seq"',            'dflow."StandardizedSize"', 'id',                   1000::bigint,     644::bigint),
      ('dflow.customers_customers_id_seq',             'dflow.customers',            'customers_id',         1000::bigint,      57::bigint),
      ('dflow."externalCustomer_id_seq"',            'dflow."externalCustomer"', 'id',               30000000::bigint,19142539::bigint),
      ('dflow."externalVendor_id_seq"',              'dflow."externalVendor"',   'id',               20000000::bigint,12258025::bigint),
      ('dflow."licensingStatus_id_seq"',             'dflow."licensingStatus"',  'id',                 100000::bigint,   16468::bigint),
      ('dflow.user_notification_id_seq',               'dflow.user_notification',    'id',                1000000::bigint,  108207::bigint),
      ('dflow.users_id_seq',                           'dflow.users',                'id',                   1000::bigint,      72::bigint),
      ('dflow.vendor_vendor_id_seq',                   'dflow.vendor',               'vendor_id',            1000::bigint,     299::bigint),
      ('dflow."itemHeader_item_num_id_pk _seq"',      'dflow."itemHeader"',        'item_id_pk',          100000::bigint,   19877::bigint)
    ) as audited(sequence_name, table_name, id_column, floor_value, external_ceiling)
  loop
    v_seq := to_regclass(v.sequence_name);
    if v_seq is null then
      raise notice 'verification skipped: % is absent.', v.sequence_name;
      continue;
    end if;

    execute format('select last_value, is_called from %s', v_seq)
      into v_current, v_is_called;
    v_next := case when v_is_called then v_current + 1 else v_current end;

    v_table := to_regclass(v.table_name);
    if v_table is null then
      v_max_id := 0;
    else
      execute format('select coalesce(max(%I), 0) from %s', v.id_column, v_table)
        into v_max_id;
    end if;

    if v_current < v.floor_value then
      raise exception 'sequence_below_floor: % is at %, expected at least %.',
        v.sequence_name, v_current, v.floor_value;
    end if;
    if v_next <= v_max_id then
      raise exception 'sequence_next_below_table_max: % would issue %, but % already uses id %.',
        v.sequence_name, v_next, v.table_name, v_max_id;
    end if;
    if v_next <= v.external_ceiling then
      raise exception 'sequence_next_below_external_ceiling: % would issue %, but the measured external id ceiling is %.',
        v.sequence_name, v_next, v.external_ceiling;
    end if;

    raise notice 'VERIFIED: % is at %, next %, table max %, external ceiling %, floor %.',
      v.sequence_name, v_current, v_next, v_max_id, v.external_ceiling, v.floor_value;
  end loop;
end
$verification$;
