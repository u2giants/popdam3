import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { checkProposalBody, findDestructiveSql, findMarkedDestructiveSql, checkMarkerIssue, classifyStatement, REQUIRED_HEADINGS } from './lib/destructive-analysis-guard.mjs'
import { main } from './check-destructive-analysis.mjs'

const complete = REQUIRED_HEADINGS.map((h) => `## ${h}\n\nfilled in\n`).join('\n')

function run(argv, files = {}, diff = '') {
  const out = []; const err = []
  const code = main(argv, { readFile: (p) => files[p], diff: () => diff, log: (m) => out.push(m), error: (m) => err.push(m) })
  return { code, out: out.join('\n'), err: err.join('\n') }
}

test('complete checklist passes', () => assert.equal(checkProposalBody(complete).ok, true))

test('absent heading fails and is named', () => {
  const r = checkProposalBody(complete.replace('## Positive control', '## Something else'))
  assert.equal(r.ok, false)
  assert.deepEqual(r.absent, ['Positive control'])
})

test('heading left with only the template comment is empty', () => {
  const r = checkProposalBody(complete.replace('## Evidence class\n\nfilled in', '## Evidence class\n\n<!-- structural or usage -->'))
  assert.deepEqual(r.empty, ['Evidence class'])
})

test('the shipped issue template has every heading but fails until filled', () => {
  const template = readFileSync(new URL('../.github/ISSUE_TEMPLATE/destructive-proposal.md', import.meta.url), 'utf8')
  assert.match(template, /labels: destructive-proposal/)
  const r = checkProposalBody(template)
  assert.deepEqual(r.absent, [])
  assert.deepEqual(r.empty, REQUIRED_HEADINGS)
})

test('CLI: unlabeled issue is not checked; labeled incomplete issue fails', () => {
  assert.equal(run(['--issue-body-file', 'b', '--labels', 'db-work'], { b: '' }).code, 0)
  const r = run(['--issue-body-file', 'b', '--labels', 'db-work,destructive-proposal'], { b: '## Proposed action\ndrop x' })
  assert.equal(r.code, 1)
  assert.match(r.err, /absent heading\(s\): Observation window/)
  assert.equal(run(['--issue-body-file', 'b', '--labels', 'Destructive-Proposal'], { b: complete }).code, 0)
})

const diffFor = (path, lines) => `diff --git a/${path} b/${path}\n--- a/${path}\n+++ b/${path}\n@@ -0,0 +1 @@\n${lines.map((l) => `+${l}`).join('\n')}\n`

test('statement classification', () => {
  assert.deepEqual(classifyStatement('DROP INDEX CONCURRENTLY x'), ['DROP'])
  assert.deepEqual(classifyStatement('truncate plm.x'), ['TRUNCATE'])
  assert.deepEqual(classifyStatement('vacuum (full, analyze) t'), ['VACUUM FULL'])
  assert.deepEqual(classifyStatement('delete from t'), ['DELETE without WHERE'])
  assert.deepEqual(classifyStatement('delete from t where id = 1'), [])
  assert.deepEqual(classifyStatement('vacuum analyze t'), [])
})

test('DROP of code, enforcement, access and type objects is destructive (GLM review of PR #2895)', () => {
  for (const s of [
    'drop function f()', 'DROP PROCEDURE p()', 'drop routine r', 'drop aggregate a(int)',
    'drop trigger t on x', 'drop event trigger e', 'drop policy p on x', 'alter table x drop constraint c',
    'drop rule r on x', 'drop role r', 'drop user u', 'drop group g', 'drop type t', 'drop domain d',
    'drop extension if exists e', 'drop sequence s', 'drop owned by r', 'drop publication p',
    'drop subscription s', 'drop foreign table f', 'drop server s',
  ]) assert.deepEqual(classifyStatement(s), ['DROP'], s)
  assert.deepEqual(classifyStatement('alter table x alter column c drop default'), [])
  assert.deepEqual(classifyStatement('alter table x alter column c drop not null'), [])
  assert.deepEqual(classifyStatement('select dropped_function from t'), [])
})

test('destructive SQL outside migrations fails; migrations, tests, comments and strings do not', () => {
  assert.deepEqual(findDestructiveSql(diffFor('docs/q/cleanup.sql', ['drop table plm.old;'])), [{ file: 'docs/q/cleanup.sql', kinds: ['DROP'] }])
  assert.deepEqual(findDestructiveSql(diffFor('supabase/migrations/20990101000000_x.sql', ['drop table plm.old;'])), [])
  assert.deepEqual(findDestructiveSql(diffFor('supabase/tests/x.sql', ['truncate t;'])), [])
  assert.deepEqual(findDestructiveSql(diffFor('scripts/x.sql', ['-- drop table t', "select 'truncate';"])), [])
  assert.deepEqual(findDestructiveSql(diffFor('scripts/x.sql', ['delete from t', '  where id = 1;'])), [])
})

test('marker naming an issue permits the statement', () => {
  assert.deepEqual(findDestructiveSql(diffFor('scripts/x.sql', ['-- destructive-proposal: #2427', 'drop index plm.i;'])), [])
  assert.equal(findDestructiveSql(diffFor('scripts/x.sql', ['-- destructive-proposal: soon', 'drop index plm.i;'])).length, 1)
})

test('CLI diff mode exit codes', () => {
  assert.equal(run(['--diff-base', 'origin/main'], {}, diffFor('a.sql', ['vacuum full t;'])).code, 1)
  assert.equal(run(['--diff-base', 'origin/main'], {}, '').code, 0)
  assert.equal(run([]).code, 2)
})

const marked = (n) => diffFor('scripts/x.sql', [`-- destructive-proposal: #${n}`, 'drop index plm.i;'])

function runMarked(diff, issues) {
  const out = []; const err = []; const asked = []
  const fetchIssue = (n) => { asked.push(n); const v = issues[n]; if (v instanceof Error) throw v; return v ?? null }
  const code = main(['--diff-base', 'origin/main'], { readFile: () => '', diff: () => diff, fetchIssue, log: (m) => out.push(m), error: (m) => err.push(m) })
  return { code, out: out.join('\n'), err: err.join('\n'), asked }
}

const goodIssue = { labels: ['db-work', 'Destructive-Proposal'], body: complete, isPullRequest: false }

test('marker issue verification', () => {
  assert.equal(checkMarkerIssue(goodIssue), null)
  assert.equal(checkMarkerIssue(null), 'does not exist')
  assert.match(checkMarkerIssue({ ...goodIssue, isPullRequest: true }), /pull request/)
  assert.match(checkMarkerIssue({ ...goodIssue, labels: ['db-work'] }), /not labeled destructive-proposal/)
  assert.match(checkMarkerIssue({ ...goodIssue, body: '' }), /incomplete checklist/)
  assert.deepEqual(findMarkedDestructiveSql(marked(7)), [{ file: 'scripts/x.sql', kinds: ['DROP'], issues: [7] }])
  assert.deepEqual(findMarkedDestructiveSql(diffFor('scripts/x.sql', ['-- destructive-proposal: #7', 'select 1;'])), [])
})

test('CLI: a marker excuses the file only when its issue verifies', () => {
  assert.equal(runMarked(marked(7), { 7: goodIssue }).code, 0)
  for (const [issue, reason] of [
    [undefined, /#7 does not exist/],
    [{ ...goodIssue, labels: [] }, /#7 is not labeled/],
    [{ ...goodIssue, body: '## Proposed action\ndrop it' }, /#7 has an incomplete checklist/],
    [{ ...goodIssue, isPullRequest: true }, /#7 is a pull request/],
    [new Error('HTTP 502'), /#7 could not be verified \(HTTP 502\)/],
  ]) {
    const r = runMarked(marked(7), { 7: issue })
    assert.equal(r.code, 1)
    assert.match(r.err, reason)
  }
  const both = runMarked(diffFor('scripts/x.sql', ['-- destructive-proposal: #7', '-- destructive-proposal: #8', 'drop index i;']), { 7: goodIssue })
  assert.equal(both.code, 1, 'every named issue must verify')
  assert.match(both.err, /#8 does not exist/)
  const noDestructive = runMarked(diffFor('scripts/x.sql', ['-- destructive-proposal: #9', 'select 1;']), {})
  assert.equal(noDestructive.code, 0)
  assert.deepEqual(noDestructive.asked, [], 'a marker on a harmless file is not looked up')
})
