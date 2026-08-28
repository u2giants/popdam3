import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { fixtureIndex } from './ledger-lib.mjs';
import { catalogSql, parseIdentity } from '../catalog-truth.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const objectCode=`import json,sys\nsys.path.insert(0,sys.argv[1])\nfrom production_migration_guard import created_objects,dropped_objects\ns=sys.argv[2]\nprint(json.dumps({'created':sorted(created_objects(s)),'dropped':sorted(dropped_objects(s))}))`;
const objects=sql=>JSON.parse(execFileSync('python',['-c',objectCode,path.join(root,'scripts'),sql],{encoding:'utf8'}));

test('every indexed fixture executes a real guard path',async()=>{
  const fixtures=fixtureIndex(root),done=new Set();
  for(const fixture of fixtures){
    if(fixture.id==='sql-lexical-shapes'){
      const code=`import json,sys\nsys.path.insert(0,sys.argv[1])\nfrom production_catalog_verification import dynamic_execution_marker_lines as d\nprint(json.dumps(d(sys.argv[2])))`;
      const sql="create trigger t after insert on x execute function f();\ndo $$ begin execute format('x'); end $$;";
      assert.deepEqual(JSON.parse(execFileSync('python',['-c',code,path.join(root,'scripts'),sql],{encoding:'utf8'})),[2]);
    }else if(fixture.id==='quoted-identities'){
      assert.match(catalogSql(parseIdentity('policy:public.style_group_tags|"Authenticated read style_group_tags"|SELECT')),/policyname='Authenticated read style_group_tags'/);
    }else if(fixture.id==='temporary-cleanup'){
      assert.deepEqual(objects('create table public.temp_t(id int); drop table public.temp_t;'),{created:['public.temp_t'],dropped:['public.temp_t']});
    }else if(fixture.id==='cancelled-and-cascade'){
      execFileSync('python',['-m','unittest','scripts.test_production_business_risk_gate.ProductionBusinessRiskGateTests.test_creating_new_tables_is_not_reported_as_losing_production_data'],{cwd:root,stdio:'pipe'});
      execFileSync(process.execPath,['--test','--test-name-pattern=an unsuccessful outcome blocks','scripts/manage-migration-author-lanes.test.mjs'],{cwd:root,stdio:'pipe'});
    }else if(fixture.id==='incident-1645-dynamic-helper'){
      execFileSync('python',['-m','unittest','scripts.test_production_migration_guard.PreflightNegativeTests.test_applied_dynamic_ddl_creation_contradicts_the_refusal'],{cwd:root,stdio:'pipe'});
    }else assert.fail(`fixture has no executable case: ${fixture.id}`);
    done.add(fixture.id);
  }
  assert.deepEqual(done,new Set(fixtures.map(v=>v.id)));
});
