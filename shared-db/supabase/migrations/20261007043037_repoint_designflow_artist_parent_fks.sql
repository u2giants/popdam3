-- #4010 / #3882 child2c. Claim4012. No row/column/access changes.
-- Recovery to original parents requires fresh orphan checks before reversal.
-- derived-from: none
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='60s';
LOCK TABLE dflow.artists IN SHARE ROW EXCLUSIVE MODE;
DO $guard$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint c JOIN pg_attribute a ON a.attrelid=c.conrelid AND a.attname='art_source_id' JOIN pg_attribute p ON p.attrelid=c.confrelid AND p.attname='mg_id' WHERE c.conrelid='dflow.artists'::regclass AND c.conname='artists_art_source_id_fkey' AND c.contype='f' AND c.confrelid='dflow."merchGroup"'::regclass AND c.conkey=ARRAY[a.attnum] AND c.confkey=ARRAY[p.attnum] AND c.confupdtype='a' AND c.confdeltype='a' AND c.confmatchtype='s' AND c.convalidated AND NOT c.condeferrable AND NOT c.condeferred) THEN
    RAISE EXCEPTION 'Unexpected original artists_art_source_id_fkey';
  END IF;
  IF EXISTS (SELECT 1 FROM dflow.artists a WHERE a."art_source_id" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM core."merchGroup" p WHERE p."mg_id"=a."art_source_id")) THEN
    RAISE EXCEPTION 'Missing mapped parent for artists_art_source_id_fkey';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint c JOIN pg_attribute a ON a.attrelid=c.conrelid AND a.attname='artist_type_id' JOIN pg_attribute p ON p.attrelid=c.confrelid AND p.attname='id' WHERE c.conrelid='dflow.artists'::regclass AND c.conname='artists_artist_type_id_fkey' AND c.contype='f' AND c.confrelid='dflow.artist_types'::regclass AND c.conkey=ARRAY[a.attnum] AND c.confkey=ARRAY[p.attnum] AND c.confupdtype='a' AND c.confdeltype='a' AND c.confmatchtype='s' AND c.convalidated AND NOT c.condeferrable AND NOT c.condeferred) THEN
    RAISE EXCEPTION 'Unexpected original artists_artist_type_id_fkey';
  END IF;
  IF EXISTS (SELECT 1 FROM dflow.artists a WHERE a."artist_type_id" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM core.artist_types p WHERE p."id"=a."artist_type_id")) THEN
    RAISE EXCEPTION 'Missing mapped parent for artists_artist_type_id_fkey';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint c JOIN pg_attribute a ON a.attrelid=c.conrelid AND a.attname='divisioncode_id' JOIN pg_attribute p ON p.attrelid=c.confrelid AND p.attname='divCode_id' WHERE c.conrelid='dflow.artists'::regclass AND c.conname='artists_divisioncode_id_fkey' AND c.contype='f' AND c.confrelid='dflow."divisionCode"'::regclass AND c.conkey=ARRAY[a.attnum] AND c.confkey=ARRAY[p.attnum] AND c.confupdtype='a' AND c.confdeltype='a' AND c.confmatchtype='s' AND c.convalidated AND NOT c.condeferrable AND NOT c.condeferred) THEN
    RAISE EXCEPTION 'Unexpected original artists_divisioncode_id_fkey';
  END IF;
  IF EXISTS (SELECT 1 FROM dflow.artists a WHERE a."divisioncode_id" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM plm."divisionCode" p WHERE p."divCode_id"=a."divisioncode_id")) THEN
    RAISE EXCEPTION 'Missing mapped parent for artists_divisioncode_id_fkey';
  END IF;
END
$guard$;
ALTER TABLE dflow.artists DROP CONSTRAINT artists_art_source_id_fkey;
ALTER TABLE dflow.artists ADD CONSTRAINT artists_art_source_id_fkey FOREIGN KEY ("art_source_id") REFERENCES core."merchGroup"("mg_id");
ALTER TABLE dflow.artists DROP CONSTRAINT artists_artist_type_id_fkey;
ALTER TABLE dflow.artists ADD CONSTRAINT artists_artist_type_id_fkey FOREIGN KEY ("artist_type_id") REFERENCES core.artist_types("id");
ALTER TABLE dflow.artists DROP CONSTRAINT artists_divisioncode_id_fkey;
ALTER TABLE dflow.artists ADD CONSTRAINT artists_divisioncode_id_fkey FOREIGN KEY ("divisioncode_id") REFERENCES plm."divisionCode"("divCode_id");
COMMIT;
