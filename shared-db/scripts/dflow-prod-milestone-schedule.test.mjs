import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { isAbsolute } from 'node:path';
import { spawnSync } from 'node:child_process';
// Synthetic PostgreSQL container only; no production connection is accepted.
const container=process.env.DFLOW_TRACKING_TEST_CONTAINER;
const path=process.env.DFLOW_TRACKING_PROD_MIGRATION || new URL('../supabase/migrations/20261025125632_dflow_prod_milestone_schedule.sql',import.meta.url).pathname;
if(path) assert.ok(isAbsolute(path),'migration path must be absolute');
const migration=path?readFileSync(path,'utf8'):null;
const skip=!container||!migration;
function query(sql){return spawnSync('docker',['exec','-i',container,'psql','-U','postgres','-X','-q','-At','-v','ON_ERROR_STOP=1'],{input:sql,encoding:'utf8',timeout:30000,maxBuffer:4*1024*1024});}
function succeeds(sql){const r=query(sql);assert.equal(r.status,0,r.stderr||String(r.error));return r.stdout.trim();}
function fails(sql,pattern){const r=query(sql);assert.notEqual(r.status,0,'expected refusal');assert.match(r.stderr||String(r.error),pattern);}
function json(sql){return JSON.parse(succeeds(sql).split('\n').filter(Boolean).at(-1));}
const fixture=`
DROP SCHEMA IF EXISTS dflow_prod CASCADE;
CREATE SCHEMA dflow_prod AUTHORIZATION postgres;
DO $$ DECLARE r text; BEGIN
 FOREACH r IN ARRAY ARRAY['anon','authenticated','service_role','designflow_prod_tracking_grants','designflow_prod_backend_grants','designflow_prod_item_master_grants','designflow_prod_data_sync_grants','designflow_prod_backend_runtime','designflow_prod_tracking_runtime','designflow_prod_item_master_runtime','designflow_prod_data_sync_runtime'] LOOP
  IF NOT EXISTS(SELECT FROM pg_roles WHERE rolname=r) THEN EXECUTE format('CREATE ROLE %I',r); END IF;
 END LOOP;
END $$;
ALTER ROLE designflow_prod_tracking_grants NOLOGIN NOSUPERUSER NOBYPASSRLS NOCREATEROLE NOCREATEDB NOREPLICATION;
GRANT designflow_prod_tracking_grants TO designflow_prod_backend_runtime,designflow_prod_tracking_runtime;
GRANT USAGE ON SCHEMA dflow_prod TO designflow_prod_tracking_grants;
CREATE TABLE dflow_prod."ProdOrderHeader"(id integer NOT NULL,"prodOrderNo" varchar PRIMARY KEY);
CREATE UNIQUE INDEX foreign_header_id_uidx ON dflow_prod."ProdOrderHeader"(id);
CREATE TABLE dflow_prod."FactoryTime"(id integer PRIMARY KEY,name text);
INSERT INTO dflow_prod."ProdOrderHeader" VALUES(1,'synthetic-101');
INSERT INTO dflow_prod."FactoryTime" VALUES(1,'synthetic template');
`;
function setup(extra=''){succeeds(fixture+extra+migration);}
function shape(table){return json(`SELECT json_agg(json_build_array(attname,format_type(atttypid,atttypmod)) ORDER BY attnum) FROM pg_attribute WHERE attrelid='dflow_prod.${table}'::regclass AND attnum>0 AND NOT attisdropped;`);}

test('scope is milestone-only; no projections, parent-index creation, source checks or sequence grants', {skip:!migration},()=>{
 assert.doesNotMatch(migration,/CREATE\s+(?:OR\s+REPLACE\s+)?VIEW|coldlion\.|GRANT[^;]*ON\s+SEQUENCE/ig);
 assert.doesNotMatch(migration,/CREATE\s+UNIQUE\s+INDEX[^;]*ON\s+dflow_prod\.\"ProdOrderHeader\"/ig);
});
test('uses existing valid unique parent id index regardless of its name and leaves parent rows/indexes untouched',{skip},()=>{
 succeeds(fixture);
 const before=json(`SELECT json_build_object('oid','dflow_prod.foreign_header_id_uidx'::regclass::oid,'indexes',(SELECT json_agg(indexdef ORDER BY indexname) FROM pg_indexes WHERE schemaname='dflow_prod' AND tablename='ProdOrderHeader'),'rows',(SELECT json_agg(row_to_json(h)) FROM dflow_prod."ProdOrderHeader" h));`);
 succeeds(migration);
 const after=json(`SELECT json_build_object('oid','dflow_prod.foreign_header_id_uidx'::regclass::oid,'indexes',(SELECT json_agg(indexdef ORDER BY indexname) FROM pg_indexes WHERE schemaname='dflow_prod' AND tablename='ProdOrderHeader'),'rows',(SELECT json_agg(row_to_json(h)) FROM dflow_prod."ProdOrderHeader" h));`);
 assert.deepEqual(after,before);
 assert.equal(succeeds(`SELECT count(*) FROM dflow_prod.prod_order_milestone_schedule;`),'0');
 assert.equal(succeeds(`SELECT count(*) FROM pg_views WHERE schemaname='dflow_prod';`),'0');
});
const milestoneColumns = [
 ['id','bigint'],['prod_order_header_id','integer'],['sku','text'],['stage_name','text'],['needed_date','date'],
 ['estimated_date','date'],['actual_date','date'],['status','text'],['anchor_type','text'],['anchor_date','date'],
 ['factory_time_id','integer'],['sampling_days','integer'],['mass_production_days','integer'],['template_source','text'],
 ['computed_at','timestamp with time zone'],['first_past_due_at','timestamp with time zone'],['stage_id','integer'],
];
test('milestone fields/defaults/indexes match both legacy writer and phase-A identity', { skip }, () => {
 setup();assert.deepEqual(shape('prod_order_milestone_schedule'),milestoneColumns);
 const indexes=json(`SELECT json_object_agg(indexrelid::regclass::text,pg_get_indexdef(indexrelid)) FROM pg_index WHERE indrelid='dflow_prod.prod_order_milestone_schedule'::regclass;`);
 const definitions=Object.values(indexes);
 assert.ok(definitions.some(s=>/UNIQUE.*\(prod_order_header_id, stage_name, sku\)$/.test(s)), 'unpredicated legacy conflict key');
 assert.ok(definitions.some(s=>/\(status, needed_date\)/.test(s)));
 assert.ok(definitions.some(s=>/\(factory_time_id\)/.test(s)));
 assert.ok(definitions.some(s=>/UNIQUE.*\(prod_order_header_id, stage_id, sku\).*WHERE \(stage_id IS NOT NULL\)/.test(s)));
 assert.ok(definitions.some(s=>/UNIQUE.*\(prod_order_header_id, stage_name, sku\).*WHERE \(stage_id IS NULL\)/.test(s)));
 assert.equal(succeeds(`SELECT is_identity||':'||identity_generation FROM information_schema.columns WHERE table_schema='dflow_prod' AND table_name='prod_order_milestone_schedule' AND column_name='id';`),'YES:ALWAYS');
 assert.equal(succeeds(`INSERT INTO dflow_prod.prod_order_milestone_schedule(prod_order_header_id,stage_name,status) VALUES(1,'Shipping','Pending') RETURNING sku='' AND computed_at IS NOT NULL AND stage_id IS NULL;`),'t');
 assert.equal(succeeds(`SELECT count(*) FROM pg_constraint WHERE conrelid='dflow_prod.prod_order_milestone_schedule'::regclass AND contype='f' AND pg_get_constraintdef(oid) ILIKE '%stage_id%';`),'0');
});
test('legacy upserts preserve claim timestamp; scan claims once and transaction rollback restores claim', { skip }, () => {
 setup();
 succeeds(`SET ROLE designflow_prod_backend_runtime;
 INSERT INTO dflow_prod.prod_order_milestone_schedule(prod_order_header_id,sku,stage_name,status,needed_date,factory_time_id)
 VALUES(1,'','Shipping','Pending',DATE '2026-01-01',1)
 ON CONFLICT(prod_order_header_id,stage_name,sku) DO UPDATE SET needed_date=EXCLUDED.needed_date;
 UPDATE dflow_prod.prod_order_milestone_schedule SET first_past_due_at='2026-02-01T00:00:00Z' WHERE needed_date<DATE '2026-02-01' AND actual_date IS NULL AND first_past_due_at IS NULL;
 INSERT INTO dflow_prod.prod_order_milestone_schedule(prod_order_header_id,sku,stage_name,status,needed_date,first_past_due_at)
 VALUES(1,'','Shipping','Pending',DATE '2026-01-02',NULL)
 ON CONFLICT(prod_order_header_id,stage_name,sku) DO UPDATE SET needed_date=EXCLUDED.needed_date,
 first_past_due_at=COALESCE(prod_order_milestone_schedule.first_past_due_at,EXCLUDED.first_past_due_at);
 RESET ROLE;`);
 assert.equal(succeeds(`SELECT count(*)=1 AND bool_and(first_past_due_at='2026-02-01T00:00:00Z') FROM dflow_prod.prod_order_milestone_schedule;`),'t');
 assert.equal(succeeds(`WITH m AS(UPDATE dflow_prod.prod_order_milestone_schedule SET first_past_due_at=now() WHERE first_past_due_at IS NULL RETURNING id) SELECT count(*) FROM m;`),'0');
 succeeds(`UPDATE dflow_prod.prod_order_milestone_schedule SET first_past_due_at=NULL;
 BEGIN; SET LOCAL ROLE designflow_prod_backend_runtime;
 UPDATE dflow_prod.prod_order_milestone_schedule SET first_past_due_at=now() WHERE first_past_due_at IS NULL; ROLLBACK;`);
 assert.equal(succeeds(`SELECT first_past_due_at IS NULL FROM dflow_prod.prod_order_milestone_schedule;`),'t');
 succeeds(`DELETE FROM dflow_prod."FactoryTime" WHERE id=1;`);
 assert.equal(succeeds(`SELECT factory_time_id IS NULL FROM dflow_prod.prod_order_milestone_schedule;`),'t');
 succeeds(`DELETE FROM dflow_prod."ProdOrderHeader" WHERE id=1;`);
 assert.equal(succeeds(`SELECT count(*) FROM dflow_prod.prod_order_milestone_schedule;`),'0');
 fails(`INSERT INTO dflow_prod.prod_order_milestone_schedule(prod_order_header_id,stage_name,status) VALUES(999,'Shipping','Pending');`,/foreign key/i);
});
for (const [name,extra] of [
 ['blank stage',`stage_name=''`],['untrimmed SKU',`sku=' x '`],['blank status',`status=' '`],
 ['negative sampling days',`sampling_days=-1`],['negative mass days',`mass_production_days=-1`],['nonpositive stage identity',`stage_id=0`],
]) test(`milestone rejects ${name}`,{skip},()=>{
 setup();succeeds(`INSERT INTO dflow_prod.prod_order_milestone_schedule(prod_order_header_id,stage_name,status) VALUES(1,'Shipping','Pending');`);
 fails(`UPDATE dflow_prod.prod_order_milestone_schedule SET ${extra};`,/check constraint/i);
});


test('runtime identity INSERT works without sequence grants; table access is minimum and browser denied',{skip},()=>{
 setup();
 succeeds(`SET ROLE designflow_prod_backend_runtime;
 INSERT INTO dflow_prod.prod_order_milestone_schedule(prod_order_header_id,stage_name,status) VALUES(1,'Shipping','Pending');
 SELECT id,sku,computed_at FROM dflow_prod.prod_order_milestone_schedule;
 UPDATE dflow_prod.prod_order_milestone_schedule SET status='Complete'; RESET ROLE;`);
 fails(`SET ROLE designflow_prod_backend_runtime; DELETE FROM dflow_prod.prod_order_milestone_schedule;`,/permission denied/i);
 fails(`SET ROLE designflow_prod_backend_runtime; SELECT nextval('dflow_prod.prod_order_milestone_schedule_id_seq');`,/permission denied/i);
 const privileges=json(`SELECT json_agg(json_build_array(p,has_table_privilege('designflow_prod_tracking_grants','dflow_prod.prod_order_milestone_schedule',p))) FROM unnest(ARRAY['SELECT','INSERT','UPDATE','DELETE']) p;`);
 assert.deepEqual(privileges,[['SELECT',true],['INSERT',true],['UPDATE',true],['DELETE',false]]);
 for(const role of ['anon','authenticated','service_role','designflow_prod_backend_grants','designflow_prod_item_master_grants','designflow_prod_data_sync_grants']){
  assert.equal(succeeds(`SELECT has_table_privilege('${role}','dflow_prod.prod_order_milestone_schedule','SELECT') OR has_table_privilege('${role}','dflow_prod.prod_order_milestone_schedule','INSERT') OR has_table_privilege('${role}','dflow_prod.prod_order_milestone_schedule','UPDATE') OR has_table_privilege('${role}','dflow_prod.prod_order_milestone_schedule','DELETE');`),'f');
  fails(`SET ROLE ${role}; SELECT * FROM dflow_prod.prod_order_milestone_schedule;`,/permission denied/i);
 }
 for(const role of ['anon','authenticated','service_role','designflow_prod_tracking_grants','designflow_prod_backend_runtime'])
  assert.equal(succeeds(`SELECT has_sequence_privilege('${role}','dflow_prod.prod_order_milestone_schedule_id_seq','SELECT') OR has_sequence_privilege('${role}','dflow_prod.prod_order_milestone_schedule_id_seq','USAGE') OR has_sequence_privilege('${role}','dflow_prod.prod_order_milestone_schedule_id_seq','UPDATE');`),'f');
});
test('overdue predicate ignores received/future/already-claimed rows; rollback leaves claim retryable',{skip},()=>{
 setup();
 succeeds(`INSERT INTO dflow_prod.prod_order_milestone_schedule(prod_order_header_id,stage_name,status,needed_date,actual_date,first_past_due_at) VALUES
 (1,'late','Pending','2026-01-01',NULL,NULL),(1,'received','Complete','2026-01-01','2026-01-02',NULL),
 (1,'future','Pending','2026-04-01',NULL,NULL),(1,'claimed','Pending','2026-01-01',NULL,'2026-02-01T00:00:00Z');`);
 const predicate=`needed_date<DATE '2026-03-01' AND actual_date IS NULL AND first_past_due_at IS NULL`;
 assert.equal(succeeds(`SELECT string_agg(stage_name,',') FROM dflow_prod.prod_order_milestone_schedule WHERE ${predicate};`),'late');
 succeeds(`BEGIN;SET LOCAL ROLE designflow_prod_backend_runtime;UPDATE dflow_prod.prod_order_milestone_schedule SET first_past_due_at=now() WHERE ${predicate};ROLLBACK;`);
 assert.equal(succeeds(`SELECT string_agg(stage_name,',') FROM dflow_prod.prod_order_milestone_schedule WHERE ${predicate};`),'late');
 assert.equal(succeeds(`WITH m AS(UPDATE dflow_prod.prod_order_milestone_schedule SET first_past_due_at=now() WHERE ${predicate} RETURNING id) SELECT count(*) FROM m;`),'1');
 assert.equal(succeeds(`WITH m AS(UPDATE dflow_prod.prod_order_milestone_schedule SET first_past_due_at=now() WHERE ${predicate} RETURNING id) SELECT count(*) FROM m;`),'0');
});
for(const [name,mutation,pattern] of [
 ['missing parent unique index',`DROP INDEX dflow_prod.foreign_header_id_uidx;`,/valid plain unique parent id index/i],
 ['same-name nonunique index',`DROP INDEX dflow_prod.foreign_header_id_uidx;CREATE INDEX foreign_header_id_uidx ON dflow_prod."ProdOrderHeader"(id);`,/valid plain unique parent id index/i],
 ['partial unique parent index',`DROP INDEX dflow_prod.foreign_header_id_uidx;CREATE UNIQUE INDEX foreign_header_id_uidx ON dflow_prod."ProdOrderHeader"(id) WHERE id>0;`,/valid plain unique parent id index/i],
 ['composite unique parent index',`DROP INDEX dflow_prod.foreign_header_id_uidx;CREATE UNIQUE INDEX foreign_header_id_uidx ON dflow_prod."ProdOrderHeader"(id,"prodOrderNo");`,/valid plain unique parent id index/i],
 ['expression unique parent index',`DROP INDEX dflow_prod.foreign_header_id_uidx;CREATE UNIQUE INDEX foreign_header_id_uidx ON dflow_prod."ProdOrderHeader"((id+0));`,/valid plain unique parent id index/i],
 ['missing FactoryTime',`DROP TABLE dflow_prod."FactoryTime";`,/FactoryTime integer id/i],
 ['changed grant role login',`ALTER ROLE designflow_prod_tracking_grants LOGIN;`,/grant role shape/i],
 ['changed grant role bypass',`ALTER ROLE designflow_prod_tracking_grants BYPASSRLS;`,/grant role shape/i],
])test(`refuses ${name} without partial milestone objects or repair`,{skip},()=>{
 succeeds(fixture+mutation);
 const before=succeeds(`SELECT coalesce(string_agg(indexdef,';' ORDER BY indexname),'') FROM pg_indexes WHERE schemaname='dflow_prod' AND tablename='ProdOrderHeader';`);
 fails(migration,pattern);
 assert.equal(succeeds(`SELECT to_regclass('dflow_prod.prod_order_milestone_schedule') IS NULL AND to_regclass('dflow_prod.prod_order_milestone_schedule_id_seq') IS NULL;`),'t');
 assert.equal(succeeds(`SELECT coalesce(string_agg(indexdef,';' ORDER BY indexname),'') FROM pg_indexes WHERE schemaname='dflow_prod' AND tablename='ProdOrderHeader';`),before);
});

// Additional direct intended-role and stage-key behavior coverage. Isolated fixture ONLY.
test('direct tracking runtime inserts identity, selects and updates while delete and sequence calls refuse',{skip},()=>{
 setup();
 succeeds(`SET ROLE designflow_prod_tracking_runtime; INSERT INTO dflow_prod.prod_order_milestone_schedule(prod_order_header_id,stage_name,status) VALUES(1,'Shipping','Pending'); UPDATE dflow_prod.prod_order_milestone_schedule SET status='Complete' WHERE stage_name='Shipping'; SELECT id,status FROM dflow_prod.prod_order_milestone_schedule; RESET ROLE;`);
 fails(`SET ROLE designflow_prod_tracking_runtime; DELETE FROM dflow_prod.prod_order_milestone_schedule WHERE false;`,/permission denied/i);
 fails(`SET ROLE designflow_prod_tracking_runtime; SELECT nextval('dflow_prod.prod_order_milestone_schedule_id_seq');`,/permission denied/i);
});
test('catalog stage uniqueness prevents renamed duplicate while legacy key remains compatible',{skip},()=>{
 setup();
 succeeds(`INSERT INTO dflow_prod.prod_order_milestone_schedule(prod_order_header_id,stage_name,status,stage_id) VALUES(1,'Shipping','Pending',11);`);
 fails(`INSERT INTO dflow_prod.prod_order_milestone_schedule(prod_order_header_id,stage_name,status,stage_id) VALUES(1,'Renamed Shipping','Pending',11);`,/unique constraint/i);
 succeeds(`INSERT INTO dflow_prod.prod_order_milestone_schedule(prod_order_header_id,stage_name,status) VALUES(1,'Legacy stage','Pending') ON CONFLICT(prod_order_header_id,stage_name,sku) DO UPDATE SET status=EXCLUDED.status;`);
 assert.equal(succeeds(`SELECT count(*) FROM dflow_prod.prod_order_milestone_schedule;`),'2');
});

test('published role proof accepts scoped runtime access and rejects browser, DELETE and sequence mutations',{skip},()=>{
 const proof=readFileSync(new URL('./proofs/2873-role-contract.sql',import.meta.url),'utf8');
 const block=proof.match(/do \$milestone\$[\s\S]*?end \$milestone\$;/)[0];
 setup();succeeds(block);
 for(const [mutation,pattern] of [
  ['GRANT SELECT ON dflow_prod.prod_order_milestone_schedule TO authenticated;',/unintended milestone access/i],
  ['GRANT DELETE ON dflow_prod.prod_order_milestone_schedule TO designflow_prod_tracking_grants;',/runtime privilege boundary/i],
  ['GRANT USAGE ON SEQUENCE dflow_prod.prod_order_milestone_schedule_id_seq TO designflow_prod_tracking_grants;',/direct identity sequence access/i],
 ]) {setup();succeeds(mutation);fails(block,pattern);}
});

test('frozen production baseline counts exclude only the separately tested milestone additions', { skip }, () => {
 const baseline=readFileSync(new URL('../supabase/tests/dflow_prod_contract.sql',import.meta.url),'utf8');
 const executable=baseline.replace(/--[^\n]*/g,'');
 const tableQuery=executable.match(/select count\(\*\) into v_tables[\s\S]*?;/)[0].replace(' into v_tables','');
 const sequenceQuery=executable.match(/select count\(\*\) into v_sequences[\s\S]*?;/)[0].replace(' into v_sequences','');
 succeeds(fixture);
 const before=[succeeds(tableQuery),succeeds(sequenceQuery)];
 succeeds(migration);
 assert.deepEqual([succeeds(tableQuery),succeeds(sequenceQuery)],before);
 succeeds('CREATE TABLE dflow_prod.unexpected_new_table(id bigint GENERATED ALWAYS AS IDENTITY);');
 assert.deepEqual([Number(succeeds(tableQuery)),Number(succeeds(sequenceQuery))],before.map(x=>Number(x)+1));
 succeeds('DROP TABLE dflow_prod.unexpected_new_table;');
 assert.match(baseline,/if v_tables <> 103 then/);assert.match(baseline,/if v_sequences <> 97 then/);
});
