\set ON_ERROR_STOP on
-- popdam3#95: classify the 11 active AAH62NBEX01 assets to WARNER BROS / Exorcist, The (1973)
-- Run ONLY via: psql "postgresql://postgres.qsllyeztdwjgirsysgai@aws-1-us-east-1.pooler.supabase.com:5432/postgres"
-- Target identity is asserted in-transaction: cluster system_identifier of production project
-- qsllyeztdwjgirsysgai (Virginia) = 7642734024280108049 (read 2026-10-11); the retired Ohio
-- project has a different cluster and lacks the 2026-10-11 property row, so either check aborts there.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';
DO $$
BEGIN
  IF (SELECT system_identifier FROM pg_control_system()) <> 7642734024280108049 THEN
    RAISE EXCEPTION 'not production project qsllyeztdwjgirsysgai';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM core.property p JOIN core.licensor l ON l.id=p.licensor_id
     WHERE p.id='14de1396-0c6b-48f2-a7a4-f912d160d7b2' AND p.status='active' AND p.name='Exorcist, The (1973)'
       AND l.id='88313675-0089-4072-87be-5b989df8a3fc' AND l.name='WARNER BROS') THEN
    RAISE EXCEPTION 'target property/licensor not as expected';
  END IF;
END $$;
-- before: counts only
SELECT count(*) AS active_rows, count(licensor_id) AS with_licensor_id, count(property_id) AS with_property_id
FROM public.assets WHERE sku='AAH62NBEX01' AND NOT is_deleted;
WITH target(id) AS (VALUES
 ('22c5c37d-1f03-416b-ba90-3b36f992800b'::uuid),('50046097-6cce-42d8-a62b-7f2b655b449e'),('7c69beb5-6869-49a9-a4bf-a34782d54334'),
 ('7f11677a-b996-4c6b-b5f5-c19660cc2bab'),('8d1b09ec-bdd9-422d-b853-1e606e11d917'),('958108f2-cbb5-451d-a834-4648fbe3a21a'),
 ('c5361705-abf4-474a-8a2b-8a63789ff03c'),('d1d54641-c458-45ca-b4af-fd7d9f394017'),('d2e7e440-f4c3-4b32-8443-e0809ad6253b'),
 ('d906773e-7792-40ff-9c67-089949a5d09d'),('f3142015-6145-4c67-ad72-198aaa6a3fab')),
upd AS (
  UPDATE public.assets a SET licensor_id='88313675-0089-4072-87be-5b989df8a3fc', licensor_code='WB', licensor_name='WARNER BROS',
         property_id='14de1396-0c6b-48f2-a7a4-f912d160d7b2', property_code=NULL, property_name='Exorcist, The (1973)'
  FROM target t WHERE a.id=t.id AND a.sku='AAH62NBEX01' AND NOT a.is_deleted AND a.licensor_id IS NULL AND a.property_id IS NULL
  RETURNING a.id)
SELECT count(*) AS updated FROM upd \gset
-- row-count assertion: aborts (division by zero, ON_ERROR_STOP) unless exactly 11 rows updated
SELECT :updated AS updated_rows, CASE WHEN :updated <> 11 THEN 1/0 ELSE 1 END AS assert_11;
DO $$ BEGIN IF (SELECT count(*) FROM public.assets WHERE sku='AAH62NBEX01' AND NOT is_deleted
   AND property_id='14de1396-0c6b-48f2-a7a4-f912d160d7b2' AND licensor_id='88313675-0089-4072-87be-5b989df8a3fc') <> 11
   OR (SELECT count(*) FROM public.assets WHERE sku='AAH62NBEX01' AND NOT is_deleted) <> 11 THEN RAISE EXCEPTION 'after-check failed'; END IF; END $$;
-- after: counts only
SELECT count(*) AS active_rows, count(*) FILTER (WHERE property_id='14de1396-0c6b-48f2-a7a4-f912d160d7b2') AS classified
FROM public.assets WHERE sku='AAH62NBEX01' AND NOT is_deleted;
COMMIT;
