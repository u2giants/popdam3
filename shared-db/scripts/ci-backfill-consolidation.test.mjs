import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
const source=readFileSync('.github/workflows/coldlion-landing-sync.yml','utf8');
test('manual recovery operations cannot be reached by schedule',()=>{
 assert.match(source,/sync:\n    if: github.event_name != 'workflow_dispatch' \|\| inputs.operation == 'refresh'/);
 for(const operation of ['prepack-backfill','prod-detail-backfill']){
  const job=source.split(`  ${operation}:\n`)[1].split(/\n  [a-z][a-z-]+:\n/)[0];
  assert.match(job,new RegExp(`if: github.event_name == 'workflow_dispatch' && inputs.operation == '${operation}'`));
  assert.match(job,/LIMIT: \$\{\{ github.event.inputs.backfill_limit \}\}/);
  assert.ok(job.indexOf('node --test')<job.indexOf('DATABASE_URL:'));
  assert.match(job,/COLDLION_EXPECTED_PROJECT_REF:/);
 }
 assert.match(source,/PAUSE_MS: \$\{\{ github.event.inputs.pause_ms \}\}/);
 assert.match(source,/RECONCILE: \$\{\{ github.event.inputs.reconcile \}\}/);
 assert.match(source,/FROM: \$\{\{ github.event.inputs.from \}\}/);
 assert.match(source,/--mode backfill/);
 assert.match(source,/--mode refresh/);
});
test('retirement retains loaders and historical evidence verification',()=>{
 for(const name of ['coldlion-prepack-backfill','coldlion-prod-detail-backfill','production-owner-decision-evidence'])assert.equal(existsSync(`.github/workflows/${name}.yml`),false);
 for(const file of ['tools/coldlion-landing/sync-prepack-detail.mjs','tools/coldlion-landing/sync-prod-details.mjs','scripts/production_owner_decision_evidence.py','scripts/prove-production-risk-acceptance.mjs'])assert.ok(existsSync(file));
});
