// Issue #3458: the steppable-refresh migration must assert the CONCURRENTLY
// unique-index invariant on style_guide_file_groups without requiring one
// exact index name (preview and production carry sgfg_group_key_uidx, not the
// conditionally created sgfilegroups_group_uidx), while never weakening the
// unique / valid / plain-column / non-partial requirements.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const migration = readFileSync(
  new URL('../supabase/migrations/20260928003740_popsg_refresh_steps_under_ceiling.sql', import.meta.url),
  'utf8',
);
const ephemeral = readFileSync(
  new URL('../supabase/tests/issue_3458_steppable_refresh_ephemeral.sql', import.meta.url),
  'utf8',
);

function guardBlock(relation) {
  const marker = `c.oid = '${relation}'::regclass`;
  const at = migration.indexOf(marker);
  assert.ok(at > 0, `guard for ${relation} is present`);
  const start = migration.lastIndexOf('select 1 from pg_index i', at);
  const end = migration.indexOf(')', migration.indexOf('i.indpred is null', at));
  return migration.slice(start, end + 1);
}

const invariant = ['i.indisunique', 'i.indisvalid', 'i.indexprs is null', 'i.indpred is null'];

test('file_groups guard keeps every CONCURRENTLY requirement', () => {
  const block = guardBlock('public.style_guide_file_groups');
  for (const clause of invariant) assert.ok(block.includes(clause), clause);
});

test('file_groups guard does not require one exact index name', () => {
  const block = guardBlock('public.style_guide_file_groups');
  assert.ok(!/relname\s*=/.test(block), 'no exact-name requirement');
  assert.ok(!migration.includes("relname = 'sgfilegroups_group_uidx'"));
});

test('file_groups guard has no disjunction that could bypass it', () => {
  const block = guardBlock('public.style_guide_file_groups');
  assert.ok(!/\bor\b/i.test(block), 'no OR inside the guard predicate');
  assert.ok(!/\btrue\b/i.test(block), 'no literal true inside the guard predicate');
});

test('folders guard is unchanged and still strict', () => {
  const block = guardBlock('public.style_guide_folders');
  for (const clause of invariant) assert.ok(block.includes(clause), clause);
  assert.ok(block.includes("ic.relname = 'sgfolders_licensor_property_uidx'"));
});

test('ephemeral test covers missing, alternate-name, partial and expression indexes', () => {
  for (const needle of [
    'missing unique index was accepted',
    'valid unique index with alternate name was rejected',
    'partial unique index was accepted',
    'expression unique index was accepted',
  ]) assert.ok(ephemeral.includes(needle), needle);
});

test('no statement timeout is raised in any form', () => {
  assert.ok(!/statement_timeout/i.test(migration), 'migration never names statement_timeout');
  assert.ok(!/alter\s+role/i.test(migration), 'migration never alters a role');
});
