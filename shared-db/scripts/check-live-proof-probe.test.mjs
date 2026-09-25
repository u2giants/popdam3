import test from 'node:test'
import assert from 'node:assert/strict'
import { evaluateProbe, main, parseNameStatus, ProbeCheckError, probeShapeProblem, probeStatementText, scopeField } from './check-live-proof-probe.mjs'

const scope = (returnTo) => `x\n\`\`\`db-work-scope\nwork_type: structural\napplication_return_to: ${returnTo}\nlive_assertion: a\n\`\`\`\n`
const contract = { work_type: 'structural', work_issue: 3043 }
const migration = ['supabase/migrations/20260916120643_x.sql', '.agent/contract.json']
const PROBE = 'select (count(*) = 1) as passed from plm.production_lane_canary;'
const never = () => { throw new Error('must not read') }

test('refuses a shared-db outcome migration without its probe', () => {
  assert.throws(() => evaluateProbe({ contract, changedFiles: migration, readIssueBody: () => scope('u2giants/shared-db'), readProbe: () => null }),
    (e) => e instanceof ProbeCheckError && /\.github\/live-proofs\/3043\.sql/.test(e.message))
})

test('accepts the probe carried in the pull request or already on main', () => {
  const seen = []
  const r = evaluateProbe({ contract, changedFiles: migration, readIssueBody: () => scope('u2giants/shared-db'), readProbe: (p) => { seen.push(p); return PROBE } })
  assert.equal(r.relevant, true)
  assert.deepEqual(seen, ['.github/live-proofs/3043.sql'])
})

test('refuses a probe that selects no passed column', () => {
  assert.throws(() => evaluateProbe({ contract, changedFiles: migration, readIssueBody: () => scope('u2giants/shared-db'), readProbe: () => '' }), /passed/)
})

test('application-return outcomes are not judged here', () => {
  const r = evaluateProbe({ contract, changedFiles: migration, readIssueBody: () => scope('u2giants/popdam3'), readProbe: never })
  assert.equal(r.relevant, false)
})

test('no migration, non-structural contract or code-truth restoration is not applicable', () => {
  assert.equal(evaluateProbe({ contract, changedFiles: ['docs/a.md'], readIssueBody: never, readProbe: never }).relevant, false)
  assert.equal(evaluateProbe({ contract: { work_type: 'repo-maintenance', work_issue: 1 }, changedFiles: migration, readIssueBody: never, readProbe: never }).relevant, false)
  assert.equal(evaluateProbe({ contract: null, changedFiles: migration, readIssueBody: never, readProbe: never, isCodeTruthRestoration: () => true }).relevant, false)
})

test('fails closed on a missing contract, work issue or return address', () => {
  assert.throws(() => evaluateProbe({ contract: null, changedFiles: migration, readIssueBody: never, readProbe: never }), ProbeCheckError)
  assert.throws(() => evaluateProbe({ contract: { work_type: 'structural' }, changedFiles: migration, readIssueBody: never, readProbe: never }), ProbeCheckError)
  assert.throws(() => evaluateProbe({ contract, changedFiles: migration, readIssueBody: () => '```db-work-scope\nwork_type: structural\n```', readProbe: never }), /application_return_to/)
  assert.throws(() => scopeField(scope('a/b') + scope('c/d'), 'application_return_to'), ProbeCheckError)
})

test('a transferred repository name and the historical name both count as this repository (#2530)', () => {
  for (const returnTo of ['popcre/shared-db', 'u2giants/shared-db']) {
    assert.throws(() => evaluateProbe({ contract, changedFiles: migration, readIssueBody: () => scope(returnTo), readProbe: () => null, repository: 'popcre/shared-db' }), ProbeCheckError)
  }
  const r = evaluateProbe({ contract, changedFiles: migration, readIssueBody: () => scope('popcre/popdam3'), readProbe: never, repository: 'popcre/shared-db' })
  assert.equal(r.relevant, false)
})

// ---- #3147 follow-ups ----

test('refuses a pull request that deletes or renames away its own probe, even though main still has it', () => {
  assert.throws(() => evaluateProbe({ contract, changedFiles: migration, removedFiles: ['.github/live-proofs/3043.sql'], readIssueBody: () => scope('u2giants/shared-db'), readProbe: () => PROBE }),
    (e) => e instanceof ProbeCheckError && /deletes or renames/.test(e.message))
  const parsed = parseNameStatus('R100\t.github/live-proofs/3043.sql\t.github/live-proofs/old.sql\nD\tdocs/x.md\nA\tsupabase/migrations/1_x.sql\n')
  assert.deepEqual(parsed.removed, ['.github/live-proofs/3043.sql', 'docs/x.md'])
  assert.deepEqual(parsed.changed, ['.github/live-proofs/old.sql', 'supabase/migrations/1_x.sql'])
})

test('shape check rejects writes, extra statements and a missing passed column; accepts comments and quoting', () => {
  assert.equal(probeShapeProblem(PROBE), null)
  assert.equal(probeShapeProblem('-- insert into x\nwith a as (select 1) select (count(*) = 1) as "passed" from a'), null)
  assert.equal(probeShapeProblem("select ('drop table x' <> '') as passed"), null)
  assert.match(probeShapeProblem('select 1 as passed; select 2 as passed'), /more than one statement/)
  assert.match(probeShapeProblem('delete from x returning true as passed'), /SELECT or WITH/)
  assert.match(probeShapeProblem('with d as (delete from x returning 1) select true as passed'), /write keyword/)
  assert.match(probeShapeProblem('select 1 as ok -- passed'), /no column named "passed"/)
  assert.match(probeShapeProblem('/* only */ -- comments'), /empty/)
})

function io({ files = {}, diff = '', mainFiles = {}, body = scope('u2giants/shared-db'), baseMissing = false, fetchable = true } = {}) {
  const out = []
  const deps = {
    fileExists: (p) => p in files,
    readFile: (p) => files[p],
    git: (args) => {
      // Issue #3280: the base ref is resolved before any diff. `baseMissing`
      // reproduces a merge_group checkout, where origin/main does not exist.
      if (args[0] === 'rev-parse') {
        if (args.includes('FETCH_HEAD')) return fetchable ? 'FETCH_HEAD' : (() => { throw new Error('absent') })()
        if (baseMissing) throw new Error('absent')
        return 'origin/main'
      }
      if (args[0] === 'fetch') { if (!fetchable) throw new Error('offline'); return '' }
      if (args[0] === 'diff') return diff
      if (args[0] === 'show') { const p = args[1].replace(/^(origin\/main|FETCH_HEAD):/, ''); if (p in mainFiles) return mainFiles[p]; throw new Error('absent') }
      throw new Error(`unexpected git ${args}`)
    },
    gh: () => body,
    log: (m) => out.push(m),
    error: (m) => out.push(m),
  }
  return { deps, out }
}
const C = JSON.stringify(contract)

test('main() I/O: probe in tree or on main passes; deleted, absent or no contract refuses with exit 2', () => {
  let t = io({ files: { '.agent/contract.json': C, '.github/live-proofs/3043.sql': PROBE }, diff: 'A\tsupabase/migrations/1_x.sql\nA\t.github/live-proofs/3043.sql\n' })
  assert.equal(main(t.deps), 0); assert.match(t.out[0], /probe present/)
  t = io({ files: { '.agent/contract.json': C }, diff: 'A\tsupabase/migrations/1_x.sql\n', mainFiles: { '.github/live-proofs/3043.sql': PROBE } })
  assert.equal(main(t.deps), 0)
  t = io({ files: { '.agent/contract.json': C }, diff: 'A\tsupabase/migrations/1_x.sql\nD\t.github/live-proofs/3043.sql\n', mainFiles: { '.github/live-proofs/3043.sql': PROBE } })
  assert.equal(main(t.deps), 2); assert.match(t.out[0], /REFUSED: .*deletes or renames/)
  t = io({ files: { '.agent/contract.json': C }, diff: 'M\tsupabase/migrations/1_x.sql\n' })
  assert.equal(main(t.deps), 2); assert.match(t.out[0], /REFUSED: .*not in this pull request/)
  t = io({ diff: 'A\tsupabase/migrations/1_x.sql\n' })
  assert.equal(main(t.deps), 2); assert.match(t.out[0], /no \.agent\/contract\.json/)
  t = io({ files: { '.agent/contract.json': C }, diff: 'M\tdocs/a.md\n' })
  assert.equal(main(t.deps), 0); assert.match(t.out[0], /not applicable/)
})

// Issue #3280 governed review round 2 (muse-spark-1.3-contributor). This guard
// hardcodes origin/main with no --base override and runs on the merge queue
// path, where that ref does not exist. It must fetch the branch, and must still
// refuse rather than pass when it cannot.
test('main() resolves its base ref on a merge_group checkout, and refuses when it cannot (#3280)', () => {
  const files = { '.agent/contract.json': C, '.github/live-proofs/3043.sql': PROBE }
  const diff = ['A	supabase/migrations/1_x.sql','A	.github/live-proofs/3043.sql',''].join(String.fromCharCode(10))
  let t = io({ files, diff, baseMissing: true, fetchable: true })
  assert.equal(main(t.deps), 0, 'a merge_group checkout must resolve its base by fetching the branch')
  t = io({ files, diff, baseMissing: true, fetchable: false })
  assert.equal(main(t.deps), 2, 'an unresolvable base must refuse, never pass')
})

test('lexical boundaries never let quoted comment markers hide extra statements', () => {
  for (const literal of ["'as passed --'", "'/* as passed */'", "E'as passed --'", '$$as passed --$$', '$tag$/*as passed*/$tag$', '"as passed --"']) {
    assert.match(probeShapeProblem(`SELECT ${literal}; COMMIT; SELECT true AS passed;`), /more than one statement/)
    assert.match(probeShapeProblem(`SELECT ${literal}`), /no column/)
  }
})

test('single-pass scanner accepts inert literal contents and nested comments', () => {
  for (const literal of ["'-- ; /* delete */'", "'it''s ; --'", String.raw`E'it\'s ; --'`, '$$; COMMIT; --$$', '$tag$; /* DROP */$tag$']) {
    assert.equal(probeShapeProblem(`SELECT (${literal} IS NOT NULL) AS passed; -- ending`), null, literal)
  }
  assert.equal(probeShapeProblem('/* outer /* nested */ outer */ SELECT true AS passed;'), null)
  assert.equal(probeShapeProblem('-- comment\rSELECT true AS passed'), null)
  assert.match(probeShapeProblem('SELECT true AS passed /* outer /* nested */'), /unterminated/)
  assert.match(probeShapeProblem('SELECT true AS passed; /* nested /* */ */ COMMIT'), /more than one statement/)
})

test('malformed or setting-dependent literals fail closed', () => {
  for (const sql of ["SELECT 'unterminated AS passed", 'SELECT "unterminated AS passed', 'SELECT $$unterminated AS passed', 'SELECT $a$wrong$b$ AS passed', String.raw`SELECT E'escaped\' AS passed`, "SELECT true AS passed /*", 'SELECT true AS passed\0']) {
    assert.notEqual(probeShapeProblem(sql), null, sql)
  }
  assert.match(probeShapeProblem(String.raw`SELECT '\' AS passed; COMMIT; --'`), /ambiguous backslash/)
  assert.match(probeShapeProblem(String.raw`SELECT true AS U&"passed"`), /unsupported/)
  assert.match(probeShapeProblem('SELECT true AS "PASSED"'), /no column/)
})

test('identifier and token boundaries cannot manufacture a keyword or dollar quote', () => {
  assert.match(probeShapeProblem('SEL/* comment */ECT true AS passed'), /SELECT or WITH/)
  assert.match(probeShapeProblem('SELECT true A/**/S passed'), /no column/)
  assert.match(probeShapeProblem('SELECT value$tag$; COMMIT; SELECT true AS passed'), /more than one statement/)
  assert.match(probeShapeProblem('SELECT true AS passed;;'), /more than one statement/)
  assert.equal(probeShapeProblem('SELECT "delete" IS NULL AS passed'), null)
})


test('statement extraction removes only the lexical terminal delimiter', () => {
  const prefix = " \r\n/* ; lead */ SELECT ('x;--' IS NOT NULL) AS \"passed\""
  const suffix = ' \r\n-- trailing ; comment\r\n/* nested /* ; */ end */  '
  assert.equal(probeStatementText(prefix + ';' + suffix), prefix + suffix)
  assert.equal(probeStatementText(prefix + suffix), prefix + suffix)
  assert.equal(probeStatementText('SELECT true AS passed;-- EOF comment'), 'SELECT true AS passed-- EOF comment')
  assert.equal(probeStatementText('SELECT $$;$$ IS NOT NULL AS passed;'), 'SELECT $$;$$ IS NOT NULL AS passed')
  for (const sql of ["SELECT 'as passed --'; COMMIT; SELECT true AS passed;", 'SELECT true AS passed;;', "SELECT 'unterminated AS passed", 'SELECT true AS wrong']) {
    assert.throws(() => probeStatementText(sql), ProbeCheckError)
  }
})
