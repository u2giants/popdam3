-- #4379 phase A. Synthetic only; database-contract CI wraps BEGIN/ROLLBACK.
DO $$
DECLARE
  po integer;
  legacy_id bigint;
  before_actual date;
  before_receipt timestamptz;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid='plm.prod_order_milestone_schedule'::regclass
    AND attname='stage_id' AND atttypid='integer'::regtype AND NOT attnotnull AND NOT attisdropped) THEN
    RAISE EXCEPTION 'stage_id must be nullable integer';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_constraint c JOIN pg_attribute a ON a.attrelid=c.conrelid AND a.attnum=ANY(c.conkey)
    WHERE c.conrelid='plm.prod_order_milestone_schedule'::regclass AND c.contype='f' AND a.attname='stage_id') THEN
    RAISE EXCEPTION 'historical stage identity must not acquire a live-row FK';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_index WHERE indexrelid='plm.prod_order_milestone_schedule_upsert_key'::regclass
    AND indisunique AND indpred IS NULL) THEN
    RAISE EXCEPTION 'phase A must retain the global name key for old writers';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_index WHERE indexrelid='plm.prod_order_milestone_schedule_catalog_stage_key'::regclass
    AND indisunique AND pg_get_expr(indpred,indrelid)='(stage_id IS NOT NULL)'
    AND pg_get_indexdef(indexrelid) LIKE '%(prod_order_header_id, stage_id, sku)%') THEN
    RAISE EXCEPTION 'catalog partial identity key missing';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_index WHERE indexrelid='plm.prod_order_milestone_schedule_legacy_name_key'::regclass
    AND indisunique AND pg_get_expr(indpred,indrelid)='(stage_id IS NULL)'
    AND pg_get_indexdef(indexrelid) LIKE '%(prod_order_header_id, stage_name, sku)%') THEN
    RAISE EXCEPTION 'legacy partial name key missing';
  END IF;

  INSERT INTO plm."ProdOrderHeader"("prodOrderNo") VALUES('zztest-4379-identity') RETURNING id INTO po;
  INSERT INTO plm.prod_order_milestone_schedule(prod_order_header_id,stage_name,status,actual_date,first_past_due_at)
    VALUES(po,'zztest Legacy','Complete',DATE '2026-01-01',TIMESTAMPTZ '2026-01-02 00:00:00+00')
    RETURNING id,actual_date,first_past_due_at INTO legacy_id,before_actual,before_receipt;
  -- The old writer's unqualified conflict target remains usable.
  INSERT INTO plm.prod_order_milestone_schedule(prod_order_header_id,stage_name,status)
    VALUES(po,'zztest Legacy','Complete') ON CONFLICT(prod_order_header_id,stage_name,sku)
    DO UPDATE SET status=excluded.status;
  IF NOT EXISTS (SELECT 1 FROM plm.prod_order_milestone_schedule WHERE id=legacy_id AND stage_id IS NULL
    AND actual_date=before_actual AND first_past_due_at=before_receipt) THEN
    RAISE EXCEPTION 'legacy identity/completion/notification history changed';
  END IF;
  -- A compatible legacy writer can already infer the new partial key.
  INSERT INTO plm.prod_order_milestone_schedule(prod_order_header_id,stage_name,status,stage_id)
    VALUES(po,'zztest Legacy','Complete',NULL) ON CONFLICT(prod_order_header_id,stage_name,sku) WHERE stage_id IS NULL
    DO UPDATE SET status=excluded.status;
  -- Orphan historical identity is intentional, not a missing live-catalog fixture.
  INSERT INTO plm.prod_order_milestone_schedule(prod_order_header_id,stage_name,status,stage_id)
    VALUES(po,'zztest Catalog','Pending',2147483001);
  BEGIN
    INSERT INTO plm.prod_order_milestone_schedule(prod_order_header_id,stage_name,status,stage_id)
      VALUES(po,'zztest Same ID renamed','Pending',2147483001);
    RAISE EXCEPTION 'duplicate catalog identity was accepted';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;
  BEGIN
    INSERT INTO plm.prod_order_milestone_schedule(prod_order_header_id,stage_name,status,stage_id)
      VALUES(po,'zztest Catalog','Pending',2147483002);
    RAISE EXCEPTION 'phase A unexpectedly removed old global name protection';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;
  BEGIN
    INSERT INTO plm.prod_order_milestone_schedule(prod_order_header_id,stage_name,status,stage_id)
      VALUES(po,'zztest Zero','Pending',0);
    RAISE EXCEPTION 'zero catalog identity was accepted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    INSERT INTO plm.prod_order_milestone_schedule(prod_order_header_id,stage_name,status,stage_id)
      VALUES(po,'zztest Negative','Pending',-1);
    RAISE EXCEPTION 'negative catalog identity was accepted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  IF (SELECT count(*) FROM plm.prod_order_milestone_schedule WHERE prod_order_header_id=po)<>2 THEN
    RAISE EXCEPTION 'legacy and catalog fixture rows must remain distinct';
  END IF;
END $$;
