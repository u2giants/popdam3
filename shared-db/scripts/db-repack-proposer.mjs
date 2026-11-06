// Governed automatic compaction (popcre/shared-db#5758, plan_db-anti-bloat-safeguards.md Step 7).
//
// Called by the weekly health check (scripts/db-bloat-weekly.mjs). It NEVER
// touches the database: for at most ONE table it opens a claim issue and a pull
// request that adds a `table-repack/v1` operation to
// config/nontransactional-index-maintenance.json, then queues that PR to merge
// (auto-merge into the merge queue). The existing route then repacks preview
// first, then production, with every refusal of scripts/table_repack_maintenance.py.
//
// A table qualifies when it is on config/table-repack-allowlist.json with
// automatic=true, its heap/live ratio is > 2.5 (flagged, or free space from
// deletes), its heap is within the allowlisted limit, and free disk >= heap +
// indexes + 1 GiB. Never two repacks at once: nothing is proposed while any
// repack operation in the policy has not completed. public.assets is manual-only
// (#5747). Test mode (preview only, workflow_dispatch) skips the ratio threshold
// for one named table and marks the operation preview_only, so it never reaches
// production.
import { readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { runGitHubCommand } from './lib/github-transport.mjs'
import { createHash } from 'node:crypto'
import { Unknown } from './db-flow/read-preview-ledger.mjs'

export const REPACK_RATIO = 2.5
export const DISK_HEADROOM = 1 << 30
export const POLICY_PATH = 'config/nontransactional-index-maintenance.json'
const ROOT = new URL('../', import.meta.url)
export const loadAllowlist = () => JSON.parse(readFileSync(new URL('config/table-repack-allowlist.json', ROOT))).tables
export const loadPolicy = () => JSON.parse(readFileSync(new URL(POLICY_PATH, ROOT)))
export const CLAIM_TITLE = (work, table) => `CLAIM: #${work} automatic online repack ${table} (weekly database health)`

export function operationId(table, day) {
  return `repack-${day.replace(/-/g, '')}-${createHash('sha256').update(table).digest('hex').slice(0, 8)}`
}

// Pure choice. results: evaluate() output; ctx: {policy, allowlist, done(opId, entry), openClaims, diskAvail, testTable}
export function choose(results, { policy, allowlist, done, openClaims, diskAvail, testTable = null }) {
  const log = []
  const pending = Object.entries(policy.operations).filter(([id, e]) => id.startsWith('repack-') && !done(id, e))
  if (pending.length) return { candidate: null, log: [`repack ${pending[0][0]} has not completed; never two repacks at once`] }
  const allow = new Map(allowlist.filter((a) => a.automatic).map((a) => [a.table, a]))
  const rows = testTable ? results.filter((r) => r.tbl === testTable) : results
  if (testTable && !allow.has(testTable)) return { candidate: null, log: [`test table ${testTable} is not an automatic allowlist entry`] }
  if (testTable && !rows.length) return { candidate: null, log: [`test table ${testTable} is not in the reading`] }
  for (const r of [...rows].sort((a, b) => (b.ratio ?? 0) - (a.ratio ?? 0))) {
    const a = allow.get(r.tbl)
    if (!a) continue
    if (!testTable && !(r.flags.length || r.notes.length)) continue
    if (!testTable && !(r.ratio > REPACK_RATIO)) { log.push(`${r.tbl}: ratio ${r.ratio?.toFixed(2)} not > ${REPACK_RATIO}`); continue }
    if (r.heap_bytes > a.max_heap_mb * 1048576) { log.push(`${r.tbl}: heap over allowlisted ${a.max_heap_mb} MB`); continue }
    if (!(diskAvail >= r.heap_bytes + r.index_bytes + DISK_HEADROOM)) { log.push(`${r.tbl}: free disk below heap + indexes + 1 GiB`); continue }
    if (openClaims.some((c) => (c.body ?? '').includes(`table ${r.tbl}`))) { log.push(`${r.tbl}: another open claim names it`); continue }
    return { candidate: r, log }
  }
  return { candidate: null, log: log.length ? log : ['no allowlisted table needs compaction'] }
}

export function buildEntry(policy, { table, pr, claim, work, previewOnly }) {
  const pinned = Object.values(policy.operations).find((e) => e.kind === 'table-repack/v1')?.client_sha256
  if (!/^[a-f0-9]{64}$/.test(pinned ?? '')) throw new Unknown('no pinned pg_repack client digest in the policy')
  const entry = { kind: 'table-repack/v1', source_pr: pr, work_issue: work, claim_issue: claim, table, client_sha256: pinned, wait_timeout_s: 30, total_timeout_s: 3300 }
  if (previewOnly) entry.preview_only = true
  return entry
}

// ---- GitHub side effects (gh CLI). REPACK_GH_TOKEN (SYNC_TOKEN) so required checks run on the PR;
// a PR opened by the workflow's own token would never start CI. ----
const repackToken = () => process.env.REPACK_GH_TOKEN || process.env.GH_TOKEN
// Reads retry through the shared transport; writes run once (never replayed).
const gh = (args) => {
  const saved = process.env.GH_TOKEN; process.env.GH_TOKEN = repackToken()
  try { return runGitHubCommand(args, { attempts: args[0] === 'api' && !args.includes('-X') ? 4 : 1 }) } finally { process.env.GH_TOKEN = saved }
}
const git = (...args) => execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] })
const api = (path, ...rest) => JSON.parse(gh(['api', path, ...rest]) || 'null')

export function receiptExists(repo, ref) {
  try { gh(['api', `repos/${repo}/git/ref/${ref.replace(/^refs\//, '')}`]); return true } catch { return false }
}
export const completed = (repo) => (id, e) =>
  receiptExists(repo, `refs/db-index-maintenance/${id}/${e.preview_only ? 'preview' : 'production'}/complete`)

export function openDbClaims(repo) {
  return api(`repos/${repo}/issues?state=open&labels=db-claim&per_page=100`).filter((x) => !x.pull_request)
}

export async function diskAvailable(projectRef, token = process.env.SUPABASE_ACCESS_TOKEN) {
  const res = await fetch(`https://api.supabase.com/v1/projects/${projectRef}/config/disk/util`, { headers: { Authorization: `Bearer ${token}` } })
  if (!res.ok) throw new Unknown(`disk utilization returned ${res.status}`)
  const v = (await res.json())?.metrics?.fs_avail_bytes
  if (!Number.isSafeInteger(v) || v < 0) throw new Unknown('disk utilization proof unavailable')
  return v
}

// Close this check's own claim issues once their operation completed (keeps claims honest).
export function closeFinishedClaims(repo, policy, done, claims, signature) {
  for (const [id, e] of Object.entries(policy.operations)) {
    if (!id.startsWith('repack-') || !done(id, e)) continue
    const c = claims.find((x) => x.number === e.claim_issue && x.title.includes('automatic online repack'))
    if (!c) continue
    gh(['issue', 'close', String(c.number), '--repo', repo, '--comment', `Operation \`${id}\` completed (${e.preview_only ? 'preview only' : 'preview and production'}); claim released.\n\n${signature}`])
  }
}

export function openRepackPr(repo, { table, work, previewOnly, day, reason, signature }) {
  const policy = loadPolicy()
  const id = operationId(table, day)
  const version = new Date().toISOString().replace(/\D/g, '').slice(0, 14)
  const claimUrl = gh(['issue', 'create', '--repo', repo, '--label', 'db-claim', '--title', CLAIM_TITLE(work, table), '--body',
    `\`\`\`db-claim\nversion: ${version}\nobjects:\n- table ${table}\n\`\`\`\nOpened by the weekly database health check (plan_db-anti-bloat-safeguards.md Step 7). Covers one online \`pg_repack\` of \`${table}\` through \`table-repack/v1\` (operation \`${id}\`). Closed automatically once the operation completes.\n\n${signature}`]).trim()
  const claim = Number(claimUrl.split('/').pop())
  const branch = `auto/${id}`
  // Local git commits on the checked-out main, pushed with the proposer token (no per-file contents API).
  const remote = `https://x-access-token:${repackToken()}@github.com/${repo}.git`
  git('config', 'user.name', 'db-bloat-weekly'); git('config', 'user.email', '41898282+github-actions[bot]@users.noreply.github.com')
  git('checkout', '-B', branch)
  const put = (entry, message) => {
    const next = loadPolicy(); next.operations[id] = entry
    writeFileSync(new URL(POLICY_PATH, ROOT), JSON.stringify(next, null, 2) + '\n')
    git('commit', '-q', '-m', message, '--', POLICY_PATH)
    git('push', '-q', remote, `HEAD:refs/heads/${branch}`)
  }
  // The entry must name its own PR; the PR number exists only after the PR does.
  put(buildEntry(policy, { table, pr: 1, claim, work, previewOnly }), `Propose online repack of ${table} (${id})`)
  const prUrl = gh(['pr', 'create', '--repo', repo, '--base', 'main', '--head', branch, '--title', `Automatic online repack: ${table}${previewOnly ? ' (preview-only test)' : ''}`,
    '--body', `Opened by the weekly database health check (popcre/shared-db#5758 Step 7, health issue #${work}).\n\n${reason}\n\nAdds operation \`${id}\` (\`table-repack/v1\`) for \`${table}\`; claim #${claim}. The existing maintenance route repacks preview first${previewOnly ? ' and stops there (preview_only test run)' : ', then production'}. No migration, no manual database command.\n\n${signature}`]).trim()
  const pr = Number(prUrl.split('/').pop())
  put(buildEntry(policy, { table, pr, claim, work, previewOnly }), `Bind ${id} to its source PR #${pr}`)
  gh(['pr', 'merge', String(pr), '--repo', repo, '--auto', '--merge'])
  return { id, pr, prUrl, claim }
}
