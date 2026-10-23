import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
function assertSyntheticContainer(name) {
 assert.match(name,/^dflow-(?:tracking-access|upc)-[a-zA-Z0-9][a-zA-Z0-9_.-]*$/,'Only dedicated synthetic tracking-access or UPC containers are permitted');
}
const container=process.env.DFLOW_TRACKING_ACCESS_TEST_CONTAINER;
if(container)assertSyntheticContainer(container);
test('container guard rejects shared, empty and malformed names before Docker access',()=>{
 for(const name of ['postgres','production','dflow-release-gate-01a164d2','dflow-upc-','dflow-tracking-access-','dflow-upc-ci;other',''])assert.throws(()=>assertSyntheticContainer(name));
 for(const name of ['dflow-tracking-access-15','dflow-upc-ci-123'])assert.doesNotThrow(()=>assertSyntheticContainer(name));
});
const catalog=readFileSync(new URL('./2873-catalog.sql',import.meta.url),'utf8');
function q(sql,db='postgres'){return spawnSync('docker',['exec','-i',container,'psql','-U','postgres','-d',db,'-X','-At','-v','ON_ERROR_STOP=1'],{input:sql,encoding:'utf8'});}
function ok(sql,db){const r=q(sql,db);assert.equal(r.status,0,r.stderr);return r.stdout.trim();}
const setup=`DO $$DECLARE s text; BEGIN FOREACH s IN ARRAY ARRAY['backend','item_master','tracking','data_sync'] LOOP
 IF NOT EXISTS(SELECT FROM pg_roles WHERE rolname='designflow_prod_'||s||'_grants') THEN EXECUTE format('CREATE ROLE %I NOLOGIN NOINHERIT','designflow_prod_'||s||'_grants');END IF;
 IF NOT EXISTS(SELECT FROM pg_roles WHERE rolname='designflow_prod_'||s||'_runtime') THEN EXECUTE format('CREATE ROLE %I LOGIN INHERIT','designflow_prod_'||s||'_runtime');END IF;
 EXECUTE format('GRANT %I TO %I','designflow_prod_'||s||'_grants','designflow_prod_'||s||'_runtime');END LOOP; END$$;
GRANT designflow_prod_tracking_grants TO designflow_prod_backend_runtime;`;
const fixture=`CREATE SCHEMA dflow_prod;CREATE SCHEMA plm;CREATE SCHEMA coldlion;CREATE SCHEMA dflow;CREATE SCHEMA hts_rag;
GRANT USAGE ON SCHEMA dflow_prod TO designflow_prod_backend_grants,designflow_prod_item_master_grants,designflow_prod_tracking_grants,designflow_prod_data_sync_grants;
GRANT USAGE ON SCHEMA plm TO designflow_prod_tracking_runtime;
GRANT USAGE ON SCHEMA coldlion TO designflow_prod_tracking_grants;
CREATE TABLE coldlion.order_history_line(id int);CREATE TABLE coldlion.prod_history_line(id int);CREATE TABLE coldlion.unrelated(id int);
INSERT INTO coldlion.order_history_line VALUES(1); INSERT INTO coldlion.prod_history_line VALUES(2);
ALTER TABLE coldlion.order_history_line ENABLE ROW LEVEL SECURITY;ALTER TABLE coldlion.prod_history_line ENABLE ROW LEVEL SECURITY;
CREATE POLICY coldlion_history_tracking_read ON coldlion.order_history_line FOR SELECT TO designflow_prod_tracking_grants USING(true);
CREATE POLICY coldlion_history_tracking_read ON coldlion.prod_history_line FOR SELECT TO designflow_prod_tracking_grants USING(true);
GRANT SELECT ON coldlion.order_history_line,coldlion.prod_history_line TO designflow_prod_tracking_grants;
CREATE VIEW dflow_prod.v_prod_order_sales_order_link WITH(security_invoker=true) AS SELECT id FROM coldlion.order_history_line;
GRANT SELECT ON dflow_prod.v_prod_order_sales_order_link TO designflow_prod_tracking_grants;`;
function denied(sql,db){const r=q(sql,db);assert.notEqual(r.status,0);assert.match(r.stderr,/permission denied/);}
test('exact scoped history read is usable while mutations and unrelated access remain refused',{skip:!container},async t=>{
 ok(setup+`DO $$ BEGIN IF NOT EXISTS(SELECT FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role;END IF;END$$;`);let serial=0;
 async function scenario(name,change,verify){await t.test(name,()=>{const db=`tracking_access_${process.pid}_${++serial}`;ok(`CREATE DATABASE ${db};`);try{ok(fixture,db);if(change)ok(change,db);verify(db,JSON.parse(ok(catalog,db)));}finally{ok(`DROP DATABASE ${db} WITH(FORCE);`);}});}
 await scenario('actual inherited and intended readers work; unrelated membership drift stays visible','',(db,c)=>{
  for(const role of ['designflow_prod_tracking_runtime','designflow_prod_backend_runtime']){
   assert.equal(ok(`SET ROLE ${role};SELECT id FROM dflow_prod.v_prod_order_sales_order_link;`,db),'SET\n1');
   denied(`SET ROLE ${role};SELECT * FROM coldlion.unrelated;`,db);
   for(const statement of ['INSERT INTO coldlion.order_history_line VALUES(8)','UPDATE coldlion.order_history_line SET id=9','DELETE FROM coldlion.order_history_line','CREATE TABLE coldlion.forbidden(id int)'])denied(`SET ROLE ${role};${statement};`,db);
  }
  const roleSql=readFileSync(new URL('./2873-role-contract.sql',import.meta.url),'utf8');
  const policyBlock=roleSql.match(/do \$tracking_history\$[\s\S]*?end \$tracking_history\$;/i)?.[0];assert.ok(policyBlock);ok(policyBlock,db);
  assert.equal(c.schema_exact,true);assert.equal(c.forbidden_schemas_closed,true);assert.equal(c.tracking_history_policies_exact,true);assert.equal(c.effective_relations_exact,true);
  assert.equal(c.memberships_exact,false,'known backend bridge is not blessed as own-membership-only');
  for(const role of ['designflow_prod_item_master_runtime','designflow_prod_data_sync_runtime','anon','authenticated','service_role'])denied(`SET ROLE ${role};SELECT * FROM coldlion.order_history_line;`,db);
 });
 for(const [name,change,field] of [
  ['extra schema reader','GRANT USAGE ON SCHEMA coldlion TO designflow_prod_item_master_grants;','forbidden_schemas_closed'],
  ['schema grant option','GRANT USAGE ON SCHEMA coldlion TO designflow_prod_tracking_grants WITH GRANT OPTION;','schema_exact'],
  ['missing intended schema usage','REVOKE USAGE ON SCHEMA coldlion FROM designflow_prod_tracking_grants;','forbidden_schemas_closed'],
  ['schema create','GRANT CREATE ON SCHEMA coldlion TO designflow_prod_tracking_grants;','global_no_create'],
  ['unrelated table read','GRANT SELECT ON coldlion.unrelated TO designflow_prod_tracking_grants;','effective_relations_exact'],
  ['history write','GRANT UPDATE ON coldlion.order_history_line TO designflow_prod_tracking_grants;','effective_relations_exact'],
  ['missing table read','REVOKE SELECT ON coldlion.order_history_line FROM designflow_prod_tracking_grants;','effective_relations_exact'],
  ['foreign application policy','CREATE POLICY foreign_read ON coldlion.order_history_line FOR SELECT TO designflow_prod_item_master_grants USING(true);','tracking_history_policies_exact'],
  ['public policy','CREATE POLICY public_read ON coldlion.order_history_line FOR SELECT TO PUBLIC USING(true);','tracking_history_policies_exact'],
  ['missing companion source read','REVOKE SELECT ON coldlion.prod_history_line FROM designflow_prod_tracking_grants;','effective_relations_exact'],
  ['missing link read','REVOKE SELECT ON dflow_prod.v_prod_order_sales_order_link FROM designflow_prod_tracking_grants;','effective_relations_exact'],
  ['policy command widened','DROP POLICY coldlion_history_tracking_read ON coldlion.order_history_line;CREATE POLICY coldlion_history_tracking_read ON coldlion.order_history_line FOR ALL TO designflow_prod_tracking_grants USING(true);','tracking_history_policies_exact'],
  ['RLS disabled','ALTER TABLE coldlion.order_history_line DISABLE ROW LEVEL SECURITY;','tracking_history_policies_exact'],
  ['policy restrictive expression','ALTER POLICY coldlion_history_tracking_read ON coldlion.order_history_line USING(false);','tracking_history_policies_exact'],
  ['policy role widened','ALTER POLICY coldlion_history_tracking_read ON coldlion.order_history_line TO designflow_prod_tracking_grants,designflow_prod_backend_grants;','tracking_history_policies_exact'],
  ['extra tracking write policy','CREATE POLICY extra_write ON coldlion.order_history_line FOR UPDATE TO designflow_prod_tracking_grants USING(true);','tracking_history_policies_exact'],
  ['unrelated backend permission','CREATE TABLE dflow_prod.unrelated(id int);GRANT SELECT ON dflow_prod.unrelated TO designflow_prod_tracking_grants;','effective_relations_exact'],
 ])await scenario(name,change,(_db,c)=>assert.equal(c[field],false));
});
