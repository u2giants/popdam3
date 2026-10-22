import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
const sql = readFileSync(new URL('../supabase/migrations/20261022182809_dflow_prod_application_model_prerequisites.sql', import.meta.url), 'utf8');
const container = process.env.DFLOW_MODEL_TEST_CONTAINER;
function query(text) {
  return spawnSync('docker', ['exec', '-i', container, 'psql', '-U', 'postgres', '-X', '-At', '-v', 'ON_ERROR_STOP=1'], { input: text, encoding: 'utf8' });
}
const fixture = `
DROP SCHEMA IF EXISTS dflow_prod CASCADE;
CREATE SCHEMA dflow_prod;
DO $$ BEGIN
  IF NOT EXISTS(SELECT FROM pg_roles WHERE rolname='designflow_prod_backend_grants') THEN
    CREATE ROLE designflow_prod_backend_grants;
    CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
  END IF;
END $$;
CREATE TABLE dflow_prod.users(id integer PRIMARY KEY,email varchar,level varchar);
INSERT INTO dflow_prod.users VALUES (1,'synthetic-admin@example.invalid','admin'),(2,NULL,'designer'),(3,NULL,'production'),(4,NULL,'sales'),(5,NULL,'sourcing_manager'),(6,NULL,'vendor');
CREATE TABLE dflow_prod."Roles"("Id" serial PRIMARY KEY,"Name" varchar NOT NULL);
INSERT INTO dflow_prod."Roles"("Name") VALUES ('admin'),('designer'),('production'),('sales'),('sourcing_manager');
CREATE TABLE dflow_prod."RolePermissions"("Id" serial PRIMARY KEY,"RoleId" integer NOT NULL,"UserId" integer,"ElementId" integer NOT NULL,"Access" boolean NOT NULL);
INSERT INTO dflow_prod."RolePermissions"("RoleId","UserId","ElementId","Access") VALUES (2,2,100,true),(3,3,101,false),(4,4,102,true);
CREATE TABLE dflow_prod.artists(id integer PRIMARY KEY);
CREATE TABLE dflow_prod."FactoryTime"(id integer PRIMARY KEY,name text);
INSERT INTO dflow_prod."FactoryTime" VALUES (1,'existing');
CREATE TABLE dflow_prod."itemDetail"(id integer PRIMARY KEY);
INSERT INTO dflow_prod."itemDetail" VALUES (1);
GRANT USAGE ON SCHEMA dflow_prod TO designflow_prod_backend_grants;
GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA dflow_prod TO designflow_prod_backend_grants;
`;
test('production prerequisite change is bounded and preserves legacy access paths', () => {
  assert.match(sql, /-- derived-from: none/);
  assert.doesNotMatch(sql, /\b(?:DROP TABLE|DROP SCHEMA|TRUNCATE|DELETE FROM|ALTER TABLE dflow\.)\b/i);
  assert.match(sql, /user lost reachable role-level permissions/);
  assert.match(sql, /GRANT SELECT, INSERT, UPDATE, DELETE ON dflow_prod.user_roles TO designflow_prod_backend_grants/);
});
test('representative production data keeps IDs, old levels and permissions; runtime reads new columns', {skip: !container}, () => {
  const r=query(fixture+sql+`
DO $$ BEGIN
 IF (SELECT count(*) FROM dflow_prod.users)<>6 OR (SELECT level FROM dflow_prod.users WHERE id=2)<>'designer' THEN RAISE EXCEPTION 'users changed'; END IF;
 IF (SELECT "Name" FROM dflow_prod."Roles" WHERE "Id"=2)<>'designer' THEN RAISE EXCEPTION 'role IDs changed'; END IF;
 IF NOT EXISTS(SELECT FROM dflow_prod."RolePermissions" WHERE "Id"=3 AND "UserId"=4 AND "Access") THEN RAISE EXCEPTION 'per-user override changed'; END IF;
 IF (SELECT tags FROM dflow_prod."FactoryTime" WHERE id=1) IS DISTINCT FROM '{}'::text[] THEN RAISE EXCEPTION 'existing template default wrong'; END IF;
 IF (SELECT count(*) FROM dflow_prod.user_roles ur JOIN dflow_prod."Roles" r ON ur.role_id=r."Id" WHERE r."Name"='admin')<>1 THEN RAISE EXCEPTION 'admin expanded'; END IF;
 IF has_table_privilege('anon','dflow_prod.user_roles','SELECT') OR has_table_privilege('authenticated','dflow_prod.user_roles','INSERT') THEN RAISE EXCEPTION 'browser access widened'; END IF;
END $$;
SET ROLE designflow_prod_backend_grants;
SELECT kind,parent_id,is_active,app_role_id FROM dflow_prod."Roles" LIMIT 0;
SELECT * FROM dflow_prod.user_roles LIMIT 0;
SELECT core_artist_id FROM dflow_prod.artists LIMIT 0;
SELECT description,tags,updated_by FROM dflow_prod."FactoryTime" LIMIT 0;
SELECT item_num_id,compan_code_fk,div_code_fk,coldlion_synced_at FROM dflow_prod."itemDetail" LIMIT 0;
RESET ROLE;
`);
  assert.equal(r.status,0,r.stderr);
});
for(const [name,mutation,error] of [
 ['unknown legacy level',`UPDATE dflow_prod.users SET level='unmapped' WHERE id=2;`,/unknown users.level/],
 ['duplicate role name',`INSERT INTO dflow_prod."Roles"("Name") VALUES ('designer');`,/duplicate.*Roles/],
 ['orphan permission',`INSERT INTO dflow_prod."RolePermissions"("RoleId","UserId","ElementId","Access") VALUES (999,1,7,true);`,/orphan RoleId/],
 ['preexisting role-level permission',`INSERT INTO dflow_prod."RolePermissions"("RoleId","ElementId","Access") VALUES (2,100,false);`,/preexisting role-level permissions/],
 ['wrong existing role-column type',`ALTER TABLE dflow_prod."Roles" ADD COLUMN kind integer;`,/shape mismatch/],
 ['wrong existing bridge-column type',`ALTER TABLE dflow_prod.artists ADD COLUMN core_artist_id integer;`,/model-column shape mismatches/],
 ['wrong existing tags array type',`ALTER TABLE dflow_prod."FactoryTime" ADD COLUMN tags integer[] NOT NULL DEFAULT '{}';`,/array_position|text\[\]/],
]) test(`refuses ${name} without partial role changes`,{skip:!container},()=>{
 const r=query(fixture+mutation+sql);assert.notEqual(r.status,0);assert.match(r.stderr,error);
 const after=query(`SELECT count(*)=0 AS unchanged FROM information_schema.columns WHERE table_schema='dflow_prod' AND table_name='Roles' AND column_name='parent_id';`);
 assert.equal(after.status,0,after.stderr);assert.equal(after.stdout.trim(),'t');
});
