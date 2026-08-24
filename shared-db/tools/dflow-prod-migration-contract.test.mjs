import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const migration = readFileSync(
  new URL('../supabase/migrations/20260824011750_create_dflow_prod_and_audit_archive.sql', import.meta.url),
  'utf8',
);
const prior = readFileSync(
  new URL('../supabase/migrations/20260802194000_fix_style_tracker_rfq_groups_timeout.sql', import.meta.url),
  'utf8',
);

function viewBody(sql) {
  const start = sql.indexOf('create or replace view public.style_tracker_rows_with_bridge as');
  const end = sql.indexOf('\n) rfq on true;', start);
  assert.notEqual(start, -1);
  assert.notEqual(end, -1);
  return sql.slice(start, end + '\n) rfq on true;'.length);
}

test('migration is structure-only and uses the reserved version', () => {
  assert.doesNotMatch(migration, /^\s*(?:insert|update|delete|copy|truncate)\b/im);
  assert.match(migration, /20260823232256|Issue #1352/);
  assert.equal((migration.match(/^CREATE TABLE dflow_prod\./gm) ?? []).length, 103);
  assert.doesNotMatch(migration, /\bdesignflow\./);
  assert.doesNotMatch(migration, /\b(?:DO \$ddl\$|pg_get_constraintdef|pg_get_indexdef|pg_get_functiondef)\b/);
  assert.match(migration, /expected 97 sequences/);
  assert.match(migration, /high-water is id, never actionDate/);
});

test('new Sample Tracking-only surface is excluded fail-closed', () => {
  for (const name of [
    'sample_import_job', 'sample_import_row', 'sample_movement',
    'sample_shipment_line', 'sample_stop_closeout', 'sample_visit',
    'sample_visit_event', 'sample_visit_plan',
  ]) {
    assert.match(migration, new RegExp(`'${name}'`));
    assert.doesNotMatch(migration, new RegExp(`^CREATE TABLE dflow_prod\\."?${name}"?`, 'm'));
  }
});

test('style tracker bridge stays on populated dflow until the guarded data cutover', () => {
  const expected = viewBody(prior);
  assert.equal(viewBody(migration).replaceAll('\r\n', '\n'), expected.replaceAll('\r\n', '\n'));
});

test('audit live/archive search and export contract is indexed', () => {
  assert.match(migration, /CREATE VIEW dflow_prod\."AuditLogHistory"/);
  for (const field of ['"moduleName"', 'ref_id_fk', 'user_id_fk', 'username', '"actionType"', '"actionDate"']) {
    assert.match(migration, new RegExp(field.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
  assert.match(migration, /Indefinite archive/);
});

test('every sequence default and ownership stays inside dflow_prod', () => {
  assert.equal((migration.match(/^CREATE SEQUENCE dflow_prod\./gm) ?? []).length, 17);
  assert.equal((migration.match(/GENERATED (?:ALWAYS|BY DEFAULT) AS IDENTITY/g) ?? []).length, 80);
  assert.doesNotMatch(migration, /nextval\('dflow\./);
  assert.doesNotMatch(migration, /OWNED BY dflow\./);
});
