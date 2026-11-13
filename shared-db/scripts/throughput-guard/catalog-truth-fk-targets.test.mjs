import test from 'node:test'; import assert from 'node:assert/strict';
import { classifyForeignKeys, collectFkTargets, FK_SQL } from '../catalog-truth.mjs';
const fk = (constraint_name, source_schema, source_table, target_schema, target_table) => ({ constraint_name, source_schema, source_table, target_schema, target_table });
test('core link to core.merchGroup is flagged in both databases', () => {
  const rows = [fk('mg_cat_fk', 'core', 'mg_category_merch_group', 'core', 'merchGroup')];
  assert.equal(classifyForeignKeys(rows, { appSchema: 'dflow' })[0].kind, 'WRONG_APP_TABLE');
  assert.equal(classifyForeignKeys(rows, { appSchema: 'dflow_prod' })[0].expected, 'dflow_prod.merchGroup');
});
test('link to the app table is clean; dflow link in production is flagged', () => {
  const ok = fk('a', 'core', 'mg_category_merch_group', 'dflow_prod', 'merchGroupHeaders');
  assert.deepEqual(classifyForeignKeys([ok], { appSchema: 'dflow_prod' }), []);
  const bad = fk('b', 'core', 'x', 'dflow', 'merchGroupHeaders');
  assert.equal(classifyForeignKeys([bad], { appSchema: 'dflow_prod' }).length, 1);
});
test('internal links inside a non-app copy are not app-facing', () => {
  assert.deepEqual(classifyForeignKeys([fk('c', 'dflow', 'merchGroup', 'dflow', 'merchGroupHeaders')], { appSchema: 'dflow_prod' }), []);
});
test('retired and stale-copy targets are flagged for any entity', () => {
  const r = classifyForeignKeys([fk('d', 'core', 'x', 'core', 'licensor_retired_2026'), fk('e', 'core', 'y', 'core', 'property_old'), fk('f', 'core', 'z', 'core', 'customer')], { appSchema: 'dflow' });
  assert.deepEqual(r.map(v => v.kind), ['RETIRED_TARGET', 'STALE_COPY_TARGET']);
});
test('collect is read-only, advisory, exits 0 with findings and 2 on outage', async () => {
  const seen = [];
  const r = await collectFkTargets({ queryImpl: async (ref, sql) => { seen.push(sql); if (ref === 'xupnyeifmpsacrqahwwm') throw Error('down'); return [fk('g', 'core', 'm', 'core', 'merchGroup')] } });
  assert.ok(seen.every(s => s === FK_SQL && /^select /.test(s)));
  assert.equal(r.advisory, true); assert.equal(r.databases.production.findings.length, 1);
  assert.equal(r.databases.nonproduction.state, 'UNVERIFIABLE'); assert.equal(r.exitCode, 2);
  const ok = await collectFkTargets({ databases: ['production'], queryImpl: async () => [fk('g', 'core', 'm', 'core', 'merchGroup')] });
  assert.equal(ok.exitCode, 0);
});
test('the other environment app schema is not app-facing (dflow in production)', () => {
  assert.deepEqual(classifyForeignKeys([fk('h', 'dflow', 'art_piece', 'core', 'merchGroup')], { appSchema: 'dflow_prod' }), []);
  assert.equal(classifyForeignKeys([fk('h', 'dflow_prod', 'art_piece', 'core', 'merchGroup')], { appSchema: 'dflow_prod' }).length, 1);
});
