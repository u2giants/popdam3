-- #3907 / #3882: finish the single mapped DesignFlow user-list contract.
-- Claim #4004. No row, column, action or privilege change; app.users is preserved.
-- Recovery to app.users requires proving all child keys still exist there first.
-- derived-from: none
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';
LOCK TABLE app."RolePermissions", plm.art_piece_attachment IN SHARE ROW EXCLUSIVE MODE;
DO $guard$
DECLARE
  expected record;
BEGIN
  FOR expected IN SELECT * FROM (VALUES
    ('app."RolePermissions"', 'RolePermissions_UserId_fkey', 'UserId'),
    ('plm.art_piece_attachment', 'art_piece_attachment_created_by_fkey', 'created_by'),
    ('plm.art_piece_attachment', 'art_piece_attachment_updated_by_fkey', 'updated_by')
  ) AS v(child_table, constraint_name, child_column)
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint c
      JOIN pg_attribute child ON child.attrelid = c.conrelid
        AND child.attname = expected.child_column
      JOIN pg_attribute parent ON parent.attrelid = c.confrelid
        AND parent.attname = 'id'
      WHERE c.conrelid = to_regclass(expected.child_table)
        AND c.conname = expected.constraint_name AND c.contype = 'f'
        AND c.confrelid = to_regclass('app.users')
        AND c.conkey = ARRAY[child.attnum] AND c.confkey = ARRAY[parent.attnum]
        AND c.confupdtype = 'a' AND c.confdeltype = 'a' AND c.confmatchtype = 's'
        AND c.convalidated AND NOT c.condeferrable AND NOT c.condeferred
    ) THEN
      RAISE EXCEPTION 'Unexpected original foreign key: %.%', expected.child_table, expected.constraint_name;
    END IF;
  END LOOP;
  IF EXISTS (SELECT 1 FROM app."RolePermissions" child WHERE child."UserId" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM dflow.users parent WHERE parent.id = child."UserId")) THEN
    RAISE EXCEPTION 'User relationship has missing mapped parents: app."RolePermissions"."UserId"';
  END IF;
  IF EXISTS (SELECT 1 FROM plm.art_piece_attachment child WHERE child.created_by IS NOT NULL AND NOT EXISTS (SELECT 1 FROM dflow.users parent WHERE parent.id = child.created_by)) THEN
    RAISE EXCEPTION 'User relationship has missing mapped parents: plm.art_piece_attachment.created_by';
  END IF;
  IF EXISTS (SELECT 1 FROM plm.art_piece_attachment child WHERE child.updated_by IS NOT NULL AND NOT EXISTS (SELECT 1 FROM dflow.users parent WHERE parent.id = child.updated_by)) THEN
    RAISE EXCEPTION 'User relationship has missing mapped parents: plm.art_piece_attachment.updated_by';
  END IF;
END
$guard$;
ALTER TABLE app."RolePermissions" DROP CONSTRAINT "RolePermissions_UserId_fkey";
ALTER TABLE app."RolePermissions" ADD CONSTRAINT "RolePermissions_UserId_fkey"
  FOREIGN KEY ("UserId") REFERENCES dflow.users(id);
ALTER TABLE plm.art_piece_attachment DROP CONSTRAINT art_piece_attachment_created_by_fkey;
ALTER TABLE plm.art_piece_attachment ADD CONSTRAINT art_piece_attachment_created_by_fkey
  FOREIGN KEY (created_by) REFERENCES dflow.users(id);
ALTER TABLE plm.art_piece_attachment DROP CONSTRAINT art_piece_attachment_updated_by_fkey;
ALTER TABLE plm.art_piece_attachment ADD CONSTRAINT art_piece_attachment_updated_by_fkey
  FOREIGN KEY (updated_by) REFERENCES dflow.users(id);
COMMIT;
