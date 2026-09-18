#!/usr/bin/env node
// Self-service additive lane boundary classifier (issue #3199 Phase B1/B3).
//
// WHAT THIS DECIDES
// -----------------
// A pull request whose linked work issue declares `route: self-service-additive`
// may merge WITHOUT orchestrator triage only when EVERY named object of EVERY
// statement lives in one of the app-owned schemas {crm, pim, dam} and every
// statement is an additive, low-lock shape. The boundary is the whole safety of
// the lane: a `CREATE TABLE crm.foo (… REFERENCES core.customer(id))` creates an
// in-boundary object yet locks a shared table, a SECURITY DEFINER function can
// write anywhere, and a GRANT on a browser-exposed crm/pim table with no RLS is
// a material access change. Each of those has a fixture in the test file.
//
// FAIL CLOSED, ALWAYS. Any unrecognized statement, any parse doubt, any mention
// of a non-boundary schema anywhere outside a string literal, any file that is
// not a brand-new migration → refuse with the named reason. Refusals return
// instantly when the route is removed from the lane machinery; nothing here is
// a gate for orchestrator-routed pull requests.
//
// NO THIRD PARSER (plan §6.5). Statement splitting, comment stripping and
// literal neutralisation come from the production gate's own tokenizer
// (scripts/production_business_risk_gate.py, #2758 classifier) via one spawned
// interpreter, in the two views that tokenizer now offers: the folded view the
// ALLOWLIST shapes consume, and the keep_dollar_quoted view that preserves
// routine bodies for reference scanning. The shapes below are ports of the
// production ALLOWLIST patterns, restricted to boundary-qualified names and, for
// functions, REQUIRING security invoker. If the production patterns tighten,
// these must be re-derived from them.
//
// MERGE-TIME INVOCATION (Phase B3): `--pr <n>` reads the pull request's files,
// finds its claim and that claim's work issue, and applies the classifier only
// when that issue's route is `self-service-additive`. Orchestrator-routed pull
// requests exit 0 "not applicable" — this classifier never judges them.
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { runGitHubCommand } from './lib/github-transport.mjs'
import { createTreeReader } from './lib/github-tree.mjs'
import { isDocumentPath } from './lib/documents-only-change.mjs'
import { REPO, parseQueueScope, derivePrOperationRoute } from './manage-migration-author-lanes.mjs'

export const SELF_SERVICE_ROUTE = 'self-service-additive'
export const BOUNDARY_SCHEMAS = Object.freeze(['crm', 'pim', 'dam'])
// crm and pim are browser-exposed through PostgREST (AGENTS.md §8.1); a grant
// to a browser role on either without RLS is a material access change.
export const BROWSER_EXPOSED_SCHEMAS = Object.freeze(['crm', 'pim'])
export const BROWSER_ROLES = Object.freeze(['anon', 'authenticated', 'public'])
// System schemas a routine body may legitimately reference without crossing the
// application boundary. Every other schema-qualified reference must be boundary.
const SYSTEM_SCHEMAS = Object.freeze(['pg_catalog', 'information_schema'])

export class LaneBoundaryError extends Error {}

// --- ALLOWLIST shape ports (run on the FOLDED view) -------------------------
// _ALLOW_IDENT/_ALLOW_QUALIFIED/_ALLOW_ARGS/_ALLOW_ROUTINE_OPTION and each shape
// are derived from ALLOWLIST in scripts/production_business_risk_gate.py; the
// BOUNDARY prefix pins the schema to the lane's three app-owned schemas.
const IDENT = '(?:"[^"]+"|[a-z_][a-z0-9_]*)'
const BOUNDARY_SCHEMA = '(?:"?(?:crm|pim|dam)"?)'
const BOUNDARY_QUALIFIED = `${BOUNDARY_SCHEMA}\\.${IDENT}`
const BUILTIN_COLUMN_TYPE = (
  '(?:text|citext|uuid|jsonb?|bytea|boolean|bool|date|interval|inet|cidr|macaddr|money|xml|tsvector'
  + '|smallint|integer|int|int2|int4|int8|bigint|real|float4|float8|double precision'
  + '|(?:numeric|decimal)(?: ?\\( ?\\d+ ?(?:, ?\\d+ ?)? ?\\))?'
  + '|(?:varchar|character varying|char|character|bit|bit varying|varbit)(?: ?\\( ?\\d+ ?\\))?'
  + '|(?:timestamp|time)(?: ?\\( ?\\d ?\\))?(?: with(?:out)? time zone)?|timestamptz|timetz)'
  + '(?: ?\\[ ?\\])*'
)
const ARGS = '\\((?![^)]*\\bdefault\\b)(?:[a-z0-9_ ,\\[\\]]*)\\)'
const ROUTINE_OPTION = '(?:language (?:sql|plpgsql)|immutable|stable|volatile|strict|security invoker)'

const BOUNDARY = (pattern) => new RegExp(`^(?:${pattern})$`, 'i')
// Production applies ALLOWLIST with re.fullmatch; these anchors reproduce that
// exact semantics — a trailing `not null default 0` after a nullable ADD COLUMN
// type must NOT pass by prefix.
// ROLE LIST GRAMMAR: comma-separated identifiers ONLY, terminated before any
// trailing clause. `to authenticated with grant option` must NOT match — a
// loose `[a-z0-9_, ]+` tail swallows `with grant option` into the role list,
// hides the browser role from the RLS-before-grant rule, and lets a
// grant-option escalation pass the whitelist (round-1 review, High).
const ROLE_LIST = '[a-z_][a-z0-9_]*(?: ?, ?[a-z_][a-z0-9_]*)*'
const SHAPES = {
  // No REFERENCES/LIKE/OF/INHERITS/PARTITION/WITH/TABLESPACE/USING/SELECT/
  // EXECUTE/VALUES: a foreign key locks the referenced table (#2758 rule).
  create_table: BOUNDARY(`create table (${BOUNDARY_QUALIFIED}) ?\\((?!.*\\b(?:references|like|of|inherits|partition|with|tablespace|using|select|execute|values)\\b)[^;]*\\)`),
  // Production create_function + `security invoker` REQUIRED (never optional in
  // the lane) and NO `or replace` (the lane never rewrites a live object). The
  // routine-option grammar keeps the production space discipline: options
  // before the invoker are space-terminated, options after it space-prefixed.
  // Round-2 review (Low): the emptied `''` body alternative is deliberately
  // GONE — the file-level single-quoted-body refusal fires first, so the shape
  // itself now only accepts the dollar-quoted empty body and fails closed
  // twice if that refusal is ever removed.
  create_function: BOUNDARY(`create function (${BOUNDARY_QUALIFIED}) ?${ARGS} returns (?:setof )?(?:trigger|${BUILTIN_COLUMN_TYPE}|void) (?:${ROUTINE_OPTION} )*security invoker(?: ${ROUTINE_OPTION})* ?as \\$\\$ \\$\\$(?: ${ROUTINE_OPTION})*`),
  // Round-2 review (Medium), DOCUMENTED DELIBERATELY: this is the only
  // object-mutating shape with no created-here precondition, and it takes an
  // ACCESS EXCLUSIVE lock on the target -- heavier than the CREATE INDEX the
  // lane refuses. That is correct for THIS lane: {crm,pim,dam} are app-owned
  // schemas (AGENTS.md 4.1 per-app extension tables), so the lock's blast
  // radius is the app that authored the change, not a shared-schema consumer.
  // A nullable ADD COLUMN is the lane's core use case; a shared-schema ADD
  // COLUMN never matches the boundary-qualified shape and refuses.
  add_nullable_column: BOUNDARY(`alter table (?:only )?(${BOUNDARY_QUALIFIED}) add column (?:if not exists )?${IDENT} ${BUILTIN_COLUMN_TYPE}(?: null)?`),
  create_index_on_new_table: BOUNDARY(`create (?:unique )?index (?:(?!concurrently )(?!if )(?!on )${IDENT} )?on (${BOUNDARY_QUALIFIED}) ?(?:using [a-z]+ ?)?\\([^;]*\\)`),
  // Round-2 review (Medium): the target must be boundary-qualified and is
  // captured, so `comment on schema core is null` (an undotted target) fails
  // the shape, and a dotted shared-schema target is caught by the reference
  // scan before the shape is even consulted.
  comment_on: BOUNDARY(`comment on [a-z ]+ (${BOUNDARY_QUALIFIED})[^;]* is (?:''|null)`),
  create_sequence: BOUNDARY(`create sequence (${BOUNDARY_QUALIFIED})`),
  create_view: BOUNDARY(`create view (${BOUNDARY_QUALIFIED}) as .+`),
  enable_row_level_security: BOUNDARY(`alter table (?:only )?(${BOUNDARY_QUALIFIED}) enable row level security`),
  // Policy head-match plus a reference scan of the whole statement: the lane's
  // job is the object boundary, not a re-derivation of the policy grammar. The
  // target must be a table this same pull request creates.
  create_policy: BOUNDARY(`create policy (?:if not exists )?${IDENT} on (${BOUNDARY_QUALIFIED})(?: .*)?`),
  grant_on_table: BOUNDARY(`grant (?:[a-z_, ]+|all(?: privileges)?) on (${BOUNDARY_QUALIFIED}) to ${ROLE_LIST}`),
  grant_execute_on_function: BOUNDARY(`grant execute on function (${BOUNDARY_QUALIFIED}) ?${ARGS} to ${ROLE_LIST}`),
}
const OBJECT_OF = (qualified) => String(qualified).replace(/"/g, '').toLowerCase()

// --- named early refusals (before shape matching) ---------------------------
// Each common out-of-lane statement gets its own named reason so the refusal
// tells the author what to do instead of "unrecognized shape".

// --- reference scanning (runs on the keep_dollar_quoted view) ---------------
const QUALIFIED_PAIR = /(?:"([^"]+)"|([a-z_][a-z0-9_]*))\s*\.\s*(?:"([^"]+)"|([a-z_][a-z0-9_]*))/g
const ALIAS_DECLARATION = /(?:\bfrom|\bjoin)\s+(?:"([^"]+)"|([a-z_][a-z0-9_]*))\s*\.\s*(?:"([^"]+)"|([a-z_][a-z0-9_]*))\s+(?:as\s+)?([a-z_][a-z0-9_]*)/g

export function boundaryReferenceViolations(statementText) {
  const text = String(statementText ?? '')
  const aliases = new Set()
  for (const match of text.matchAll(ALIAS_DECLARATION)) aliases.add((match[5] ?? '').toLowerCase())
  const violations = []
  for (const match of text.matchAll(QUALIFIED_PAIR)) {
    const left = (match[1] ?? match[2] ?? '').replace(/"/g, '').toLowerCase()
    if (BOUNDARY_SCHEMAS.includes(left) || SYSTEM_SCHEMAS.includes(left) || aliases.has(left)) continue
    violations.push(`${left}.${(match[3] ?? match[4] ?? '').replace(/"/g, '').toLowerCase()}`)
  }
  return [...new Set(violations)]
}

// --- Python bridge: the ONE tokenizer, two views -----------------------------
const LEXER_PROGRAM = [
  'import json, sys',
  'sys.path.insert(0, "scripts")',
  'import production_business_risk_gate as gate',
  'out = []',
  'for text in json.load(sys.stdin):',
  '    statements = gate.sql_top_level_statements(text)',
  '    references = None if statements is None else gate.sql_top_level_statements(text, keep_dollar_quoted=True)',
  '    out.append({"statements": statements, "references": references})',
  'print(json.dumps(out))',
].join('\n')

export function lexMigrationFiles(files, { python = 'python3' } = {}) {
  const payload = JSON.stringify(files.map((file) => String(file.content ?? '')))
  const run = (interpreter) => spawnSync(interpreter, ['-c', LEXER_PROGRAM], { input: payload, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
  let result = run(python)
  // `python3` is the CI name; a Windows agent without the alias would otherwise
  // fail closed on a naming difference alone (round-1 review, Low), so one
  // bounded retry through plain `python` — only when the spawn itself failed.
  if (result.error?.code === 'ENOENT' && python !== 'python') result = run('python')
  if (result.error || result.status !== 0) {
    return { error: `the production tokenizer could not run (python ${python}: ${result.stderr || result.error?.message || `exit ${result.status}`}) — the boundary classifier refuses to guess` }
  }
  try { return { rows: JSON.parse(result.stdout) } } catch { return { error: 'the production tokenizer returned unparseable output — the boundary classifier refuses to guess' } }
}

// --- the pure core -----------------------------------------------------------
// Inputs are plain data so every refusal is exhaustively testable offline:
//   changedFiles: [{filename, status}] the pull request's full changed-file list
//   migrations:   [{filename, content}] every NEW supabase/migrations/*.sql file
//   mainVersions: iterable of 14-digit versions already present on main
export function classifySelfServiceLane({ changedFiles = [], migrations = [], mainVersions = [] }) {
  const reasons = []
  const refuse = (reason) => ({ verdict: 'refuse', reasons: [...reasons, reason] })
  if (!migrations.length) return refuse('the pull request carries no new migration; the self-service lane is for additive structural changes only')

  for (const file of changedFiles) {
    const name = String(file.filename ?? '')
    if (name.startsWith('supabase/migrations/') && name.endsWith('.sql')) continue
    if (file.status === 'removed') continue
    if (!isDocumentPath(name)) return refuse(`non-migration file rides along outside the lane: ${name} (only prose documents may accompany the migration)`)
  }

  const main = new Set([...mainVersions].map(String))
  for (const file of changedFiles) {
    const name = String(file.filename ?? '')
    if (!name.startsWith('supabase/migrations/')) continue
    const version = name.split('/').pop()?.slice(0, 14) ?? ''
    if (file.status === 'removed') continue
    if (file.status !== 'added') return refuse(`${name} modifies an existing migration; lane migrations must be brand-new files`)
    if (!/^\d{14}$/.test(version)) return refuse(`${name} has no 14-digit migration version`)
    if (main.has(version)) return refuse(`${name} reuses version ${version} already present on main`)
  }

  const lexed = lexMigrationFiles(migrations)
  if (lexed.error) return refuse(lexed.error)

  // State carried across statements in pull-request order: the lane may only
  // index/policy/rls/grant objects this same change creates.
  const createdTables = new Set(), createdFunctions = new Set(), createdSequences = new Set(), rlsEnabled = new Set()
  for (let fileIndex = 0; fileIndex < migrations.length; fileIndex += 1) {
    const { filename } = migrations[fileIndex]
    const { statements, references } = lexed.rows[fileIndex]
    if (statements === null || references === null) return refuse(`${filename} could not be tokenised; parse doubt always refuses`)
    if (statements.length !== references.length) return refuse(`${filename} tokenizer views disagree (${statements.length} folded vs ${references.length} reference statements)`)
    // An unreadable or empty migration file lexes to zero statements; the lane
    // refuses rather than pass vacuously (round-1 review, Medium). This is also
    // what turns an absent blob (`readFileAtRef(...) ?? ''`) into a refusal.
    if (!statements.length) return refuse(`${filename} contains no statements; the lane refuses empty or unreadable migration bytes`)
    // SINGLE-QUOTED ROUTINE BODIES ARE OUTSIDE THE LANE (round-1 review, High).
    // The production tokenizer's reference view preserves dollar-quoted bodies
    // but empties '...' literals, so an `as 'select ... from core.customer'`
    // body is invisible to the boundary reference scan while still matching
    // the create_function shape's emptied `as ''` form. Rather than grow a
    // second parser, the lane requires dollar-quoted bodies, whose contents
    // the scan sees. The raw-text probe is deliberately over-broad: a refusal
    // here costs a reformat, a miss would cost the boundary.
    if (/\bcreate\s+function\b[\s\S]*?\bas\s*'/i.test(String(migrations[fileIndex].content ?? ''))) return refuse(`${filename}: a routine body uses a single-quoted AS literal the reference scan cannot see — dollar-quote the body ($$ ... $$) so every reference is scannable`)
    for (let index = 0; index < statements.length; index += 1) {
      const statement = statements[index]
      const excerpt = statement.length > 80 ? `${statement.slice(0, 80)}…` : statement
      const where = `${filename} statement ${index + 1}`

      if (/\bsecurity\s+definer\b/i.test(statement)) return refuse(`${where}: SECURITY DEFINER is outside the lane (${excerpt})`)
      if (/^create schema\b/i.test(statement)) return refuse(`${where}: CREATE SCHEMA is outside the lane — brand-new schemas need an owner decision (${excerpt})`)
      if (/^create or replace\b/i.test(statement)) return refuse(`${where}: CREATE OR REPLACE is outside the lane — the lane never rewrites an object that may exist on main (${excerpt})`)
      if (/^(insert into|update |delete from|delete |merge into|drop |truncate )/i.test(statement)) return refuse(`${where}: data and destructive statements are outside the lane (${excerpt})`)
      if (/^grant on all tables in schema\b/i.test(statement) || /^revoke\b/i.test(statement) || /^set search_path\b/i.test(statement) || /^do \$/i.test(statement) || /^with /i.test(statement)) return refuse(`${where}: statement shape is not in the lane whitelist (${excerpt})`)
      // WITH GRANT OPTION delegates the lane's own grant authority onward; the
      // grant shapes' role-list grammar already cannot match it, and this named
      // refusal says why instead of a generic shape miss (round-1 review, High).
      if (/^grant\b/i.test(statement) && /\bwith grant option\b/i.test(statement)) return refuse(`${where}: GRANT ... WITH GRANT OPTION is outside the lane — the lane never delegates its grants onward (${excerpt})`)

      // Reference scan FIRST on the keep-dollar view: catches bodies and policy
      // expressions no matter which shape matches below.
      const violations = boundaryReferenceViolations(references[index])
      if (violations.length) return refuse(`${where}: references object(s) outside {crm,pim,dam}: ${violations.join(', ')} (${excerpt})`)

      let matched = null
      let bound = null
      for (const [name, shape] of Object.entries(SHAPES)) {
        const match = shape.exec(statement)
        if (!match) continue
        matched = name
        bound = match[1] ? OBJECT_OF(match[1]) : null
        break
      }
      if (!matched) return refuse(`${where}: statement is not a whitelisted lane shape (${excerpt})`)

      if (matched === 'create_table') {
        createdTables.add(bound)
      } else if (matched === 'create_function') {
        createdFunctions.add(bound)
      } else if (matched === 'create_sequence') {
        createdSequences.add(bound)
      } else if (matched === 'create_index_on_new_table') {
        if (!createdTables.has(bound)) return refuse(`${where}: index on ${bound}, which this change does not create — indexes on existing tables take locks the lane refuses (${excerpt})`)
      } else if (matched === 'enable_row_level_security') {
        if (!createdTables.has(bound)) return refuse(`${where}: row level security enabled on ${bound}, which this change does not create (${excerpt})`)
        rlsEnabled.add(bound)
      } else if (matched === 'create_policy') {
        if (!createdTables.has(bound)) return refuse(`${where}: policy on ${bound}, which this change does not create (${excerpt})`)
      } else if (matched === 'grant_on_table' || matched === 'grant_execute_on_function') {
        if (matched === 'grant_execute_on_function') {
          if (!createdFunctions.has(bound)) return refuse(`${where}: grant on function ${bound}, which this change does not create (${excerpt})`)
        } else if (!createdTables.has(bound) && !createdSequences.has(bound)) {
          return refuse(`${where}: grant on ${bound}, which this change does not create (${excerpt})`)
        }
        const roleList = (statement.split(/\bto\s+/i)[1] ?? '').split(',').map((role) => role.trim().toLowerCase())
        const schema = bound.split('.')[0]
        const browserTarget = BROWSER_EXPOSED_SCHEMAS.includes(schema)
        if (browserTarget && roleList.some((role) => BROWSER_ROLES.includes(role)) && !rlsEnabled.has(bound)) {
          return refuse(`${where}: grant to a browser role on ${bound} before row level security is enabled on it (${excerpt}) — ${schema} is browser-exposed (AGENTS.md §8.1)`)
        }
      }
    }
  }
  return { verdict: 'pass', objects: { tables: [...createdTables].sort(), functions: [...createdFunctions].sort(), sequences: [...createdSequences].sort() } }
}

// --- merge-time CLI (Phase B3) ----------------------------------------------
const ghJson = (args) => {
  const raw = runGitHubCommand(args, { wrapError: (detail) => new LaneBoundaryError(`GitHub read failed: ${detail}`) })
  try { return JSON.parse(raw) } catch { throw new LaneBoundaryError('GitHub returned malformed JSON') }
}
const treeReader = createTreeReader({ wrapError: (detail) => new LaneBoundaryError(`GitHub read failed: ${detail}`) })

export function workIssueRouteOf(pr, { derive = derivePrOperationRoute, getIssue, parseScope } = {}) {
  // THE ROUTING FORK IS `derivePrOperationRoute`, NEVER STRUCTURAL ADMISSION.
  // This gate runs inside the guarded merge for EVERY pull request, and the
  // merge also serves ordinary repository maintenance. The structural
  // admission resolver (`resolveAdmittedIssueForPr`) refuses every
  // non-structural change_type by design, so routing through it made this step
  // fail closed on exactly the repo-maintenance merges that share the workflow
  // — the defect the round-1 review marked Critical. `derivePrOperationRoute`
  // is the fork the rest of the merge machinery already uses: it answers
  // structural-vs-repo-maintenance from the live pull request (any migration
  // path is structural), and the caller then reads the linked issue's scope
  // only to decide self-service applicability. Unreadable input still throws,
  // and main() still maps a throw to a refusal.
  const operation = derive(Number(pr))
  const issue = getIssue(operation.issue)
  const scope = parseScope(issue.body)
  return { number: operation.issue, scope, operationRoute: operation.route }
}

export function main(argv = process.argv.slice(2), { env = process.env } = {}) {
  try {
    const prIndex = argv.indexOf('--pr')
    if (prIndex === -1) throw new LaneBoundaryError('usage: check-self-service-additive-lane.mjs --pr <n>')
    const number = Number(argv[prIndex + 1])
    if (!Number.isInteger(number) || number <= 0) throw new LaneBoundaryError('--pr requires a positive pull request number')
    const pr = ghJson(['api', `repos/${REPO}/pulls/${number}`])
    if (!pr?.head?.sha || !pr?.head?.ref) throw new LaneBoundaryError('pull request head is unreadable')
    const files = []
    for (let page = 1; page <= 30; page += 1) {
      const rows = ghJson(['api', `repos/${REPO}/pulls/${number}/files?per_page=100&page=${page}`])
      files.push(...rows)
      if (rows.length < 100) break
    }
    if (Number(pr.changed_files) !== files.length) throw new LaneBoundaryError(`incomplete PR pagination: expected ${pr.changed_files}, received ${files.length}`)
    const { number: workNumber, scope, operationRoute } = workIssueRouteOf(number, {
      getIssue: (issueNumber) => ghJson(['api', `repos/${REPO}/issues/${issueNumber}`]),
      parseScope: parseQueueScope,
    })
    if (operationRoute === 'repo-maintenance') {
      // The guarded merge serves repository maintenance too; the boundary
      // classifier judges structural self-service work only.
      console.log(`Pull request #${number} is repository maintenance (issue #${workNumber}); the self-service boundary does not apply.`)
      return 0
    }
    if (!scope || scope.route !== SELF_SERVICE_ROUTE) {
      console.log(`Work issue #${workNumber} route is ${scope?.route ?? 'unclassified'}; the self-service boundary does not apply.`)
      return 0
    }
    const migrations = files
      .filter((file) => file.filename?.startsWith('supabase/migrations/') && file.filename.endsWith('.sql') && file.status !== 'removed')
      .map((file) => ({ filename: file.filename, content: treeReader.readFileAtRef(REPO, file.filename, pr.head.sha) ?? '' }))
    const mainTree = treeReader.pathsAtRef(REPO, pr.base?.sha ?? 'main')
    const mainVersions = mainTree.filter((path) => /^supabase\/migrations\/\d{14}_/.test(path)).map((path) => path.split('/').pop().slice(0, 14))
    const result = classifySelfServiceLane({ changedFiles: files, migrations, mainVersions })
    if (result.verdict === 'refuse') {
      console.error('SELF-SERVICE BOUNDARY REFUSED:')
      for (const reason of result.reasons) console.error(`  - ${reason}`)
      return 2
    }
    console.log(`Self-service additive boundary holds: ${migrations.map((file) => file.filename).join(', ')}`)
    return 0
  } catch (error) {
    console.error(`REFUSED: ${error.message}`)
    return 2
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) process.exitCode = main()
