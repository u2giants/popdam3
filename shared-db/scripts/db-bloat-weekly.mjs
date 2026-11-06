#!/usr/bin/env node
// Weekly bloat/churn check (popcre/shared-db#5758, plan_db-anti-bloat-safeguards.md Step 6).
//
// Read-only: one constant SELECT through the Supabase Management API. Every user
// table over 100 MB gets: heap / estimated-live ratio, index/heap ratio and its
// week-over-week growth, HOT %, updates per row per day. The previous reading is
// kept in ONE edited ledger comment on the standing "Weekly database health"
// issue (no table: fewest moving parts). Each run posts one reading comment.
//
// Flags (plan Step 6): heap/live > 2.0; index/heap grew > 50% week-over-week;
// HOT < 50% with > 0.2 updates/row/day. A table whose excess space is explained
// by DELETES (rows removed, e.g. coldlion.change_log rotation) and not by
// updates is reported as reclaimable free space, never as a writer problem.
// Live bytes = reltuples x (28 + sum(pg_stats.avg_width)) — the Step 0 estimate
// (pgstattuple is not installed). Owner: shared-db maintainers. Supersedes the
// public.assets monitor of #5747's plan once both run (retire that with a note
// on #5747). Never writes to the database; public.assets is only read.
import { PROJECT_REFS, Unknown } from './db-flow/read-preview-ledger.mjs'
import * as repack from './db-repack-proposer.mjs'

export const HEALTH_ISSUE = '5886'
export const MIN_BYTES = 100 * 1048576
export const RATIO_LIMIT = 2.0
export const INDEX_GROWTH_LIMIT = 0.5
export const HOT_LIMIT = 0.5
export const UPD_PER_ROW_DAY_LIMIT = 0.2
// Tables whose deletes are an intended retention job; free space there is expected.
export const ROTATED_TABLES = new Set(['coldlion.change_log'])
export const LEDGER_MARKER = '<!-- db-bloat-weekly:ledger -->'
const DAY = 86400000

export const readingSql = (include = null) => `with t as (
 select c.oid, n.nspname, c.relname, n.nspname||'.'||c.relname as tbl,
  pg_relation_size(c.oid)::bigint as heap_bytes, pg_indexes_size(c.oid)::bigint as index_bytes,
  greatest(c.reltuples,0)::bigint as est_rows,
  (greatest(c.reltuples,0)*(28+coalesce((select sum(s.avg_width) from pg_stats s where s.schemaname=n.nspname and s.tablename=c.relname),0)))::bigint as live_bytes,
  st.n_tup_ins::bigint, st.n_tup_upd::bigint, st.n_tup_hot_upd::bigint, st.n_tup_del::bigint
 from pg_class c join pg_namespace n on n.oid=c.relnamespace join pg_stat_user_tables st on st.relid=c.oid
 where c.relkind='r' and (pg_relation_size(c.oid) > ${MIN_BYTES}${include ? ` or n.nspname||'.'||c.relname = '${include}'` : ''}))
select t.tbl, t.heap_bytes, t.index_bytes, t.est_rows, t.live_bytes, t.n_tup_ins, t.n_tup_upd, t.n_tup_hot_upd, t.n_tup_del,
 coalesce((select left(regexp_replace(q.query,'\\s+',' ','g'),160) from extensions.pg_stat_statements q
   where q.rows > 0 and q.query ~* ('\\m(update|insert\\s+into|delete\\s+from)\\s+("?' || t.nspname || '"?\\.)?"?' || t.relname || '"?\\M')
   order by q.rows desc limit 1),
  -- writers wrapped in functions: the busiest statement naming the table at all
  (select left(regexp_replace(q.query,'\\s+',' ','g'),160) from extensions.pg_stat_statements q
   where q.rows > 0 and q.query ~* ('\\m' || t.relname || '\\M') and q.query !~* '^\\s*select\\s+.*\\mfrom\\M' 
   order by q.calls desc limit 1)) as top_writer,
 (select stats_reset from pg_stat_database where datname=current_database()) as stats_reset,
 now() as read_at
from t order by t.heap_bytes desc`
export const READING_SQL = readingSql()

export async function fetchReading(projectRef, token = process.env.SUPABASE_ACCESS_TOKEN, { fetchImpl = fetch, include = null } = {}) {
  // include: one allowlisted table (test mode); names come only from the allowlist file.
  if (include && !repack.loadAllowlist().some((a) => a.table === include && a.automatic)) throw new Unknown(`${include} is not an automatic allowlist entry`)
  if (!token) throw new Unknown('SUPABASE_ACCESS_TOKEN is not set; no reading was taken')
  const res = await fetchImpl(`https://api.supabase.com/v1/projects/${projectRef}/database/query`, {
    method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: readingSql(include) }),
  })
  const body = await res.text()
  if (!res.ok) throw new Unknown(`Management API returned ${res.status}: ${body.slice(0, 300)}`)
  const rows = JSON.parse(body)
  if (!Array.isArray(rows) || rows.length === 0) throw new Unknown('expected at least one table row')
  const num = (r, k) => { const v = Number(r[k]); if (!Number.isFinite(v)) throw new Unknown(`column ${k} is absent for ${r.tbl}`); return v }
  return {
    read_at: new Date(rows[0].read_at).toISOString(),
    stats_reset: rows[0].stats_reset ? new Date(rows[0].stats_reset).toISOString() : null,
    tables: rows.map((r) => ({ tbl: r.tbl, heap_bytes: num(r, 'heap_bytes'), index_bytes: num(r, 'index_bytes'), est_rows: num(r, 'est_rows'),
      live_bytes: num(r, 'live_bytes'), n_tup_ins: num(r, 'n_tup_ins'), n_tup_upd: num(r, 'n_tup_upd'), n_tup_hot_upd: num(r, 'n_tup_hot_upd'),
      n_tup_del: num(r, 'n_tup_del'), top_writer: r.top_writer ?? null })),
  }
}

// prev: the previous reading (ledger) or null. Counter deltas are used only when
// stats were not reset in between and no counter went backwards.
export function evaluate(reading, prev) {
  const days = prev ? (Date.parse(reading.read_at) - Date.parse(prev.read_at)) / DAY : 0
  const sameStats = prev && days >= 0.5 && (prev.stats_reset ?? null) === (reading.stats_reset ?? null)
  return reading.tables.map((t) => {
    const p = prev?.tables?.find((x) => x.tbl === t.tbl) ?? null
    const ratio = t.live_bytes > 0 ? t.heap_bytes / t.live_bytes : null
    const idxRatio = t.heap_bytes > 0 ? t.index_bytes / t.heap_bytes : null
    const pIdx = p && p.heap_bytes > 0 ? p.index_bytes / p.heap_bytes : null
    const idxGrowth = idxRatio !== null && pIdx ? idxRatio / pIdx - 1 : null
    let d = null
    if (sameStats && p && t.n_tup_upd >= p.n_tup_upd && t.n_tup_del >= p.n_tup_del && t.n_tup_hot_upd >= p.n_tup_hot_upd)
      d = { upd: t.n_tup_upd - p.n_tup_upd, hot: t.n_tup_hot_upd - p.n_tup_hot_upd, del: t.n_tup_del - p.n_tup_del, days }
    const hot = d ? (d.upd > 0 ? d.hot / d.upd : null) : (t.n_tup_upd > 0 ? t.n_tup_hot_upd / t.n_tup_upd : null)
    const updPerRowDay = d && t.est_rows > 0 ? d.upd / t.est_rows / d.days : null
    // Space explained by deletes (retention/cleanup) rather than updates.
    const delExplained = ROTATED_TABLES.has(t.tbl) || (d ? d.del > d.upd : t.n_tup_del > t.n_tup_upd)
    const flags = []; const notes = []
    if (ratio !== null && ratio > RATIO_LIMIT) {
      if (delExplained) notes.push(`free space ${ratio.toFixed(2)}x live from deleted rows — reclaimable, not a writer problem`)
      else flags.push(`heap/live ${ratio.toFixed(2)} > ${RATIO_LIMIT}`)
    }
    if (idxGrowth !== null && idxGrowth > INDEX_GROWTH_LIMIT) flags.push(`index/heap grew ${(idxGrowth * 100).toFixed(0)}% week-over-week`)
    if (hot !== null && updPerRowDay !== null && hot < HOT_LIMIT && updPerRowDay > UPD_PER_ROW_DAY_LIMIT)
      flags.push(`HOT ${(hot * 100).toFixed(0)}% with ${updPerRowDay.toFixed(2)} updates/row/day`)
    return { ...t, ratio, idxRatio, idxGrowth, hot, hotWindow: Boolean(d), updPerRowDay, flags, notes }
  })
}

const mb = (b) => `${Math.round(b / 1048576).toLocaleString('en-US')} MB`
const pct = (v) => (v === null ? 'n/a' : `${(v * 100).toFixed(0)}%`)
export function est(iso) {
  return new Date(iso).toLocaleString('en-US', { timeZone: 'America/New_York', dateStyle: 'medium', timeStyle: 'short' }) + ' ET (America/New_York)'
}

export function renderReading(reading, results, prev, { target, runUrl }) {
  const flagged = results.filter((r) => r.flags.length)
  const freed = results.filter((r) => r.notes.length)
  const out = [`**Weekly database health — ${target}, ${est(reading.read_at)}**`, '',
    `${results.length} user tables over 100 MB. Stats reset: ${reading.stats_reset ? est(reading.stats_reset) : 'never (counters cumulative)'}. ` +
    (prev ? `Previous reading: ${est(prev.read_at)}.` : 'No previous reading yet; week-over-week growth and updates/row/day start next week.'), '']
  out.push(flagged.length ? `**Flagged (${flagged.length}):**` : '**Flagged: none.**')
  for (const r of flagged) out.push(`- \`${r.tbl}\`: ${r.flags.join('; ')}. Likely writer: ${r.top_writer ? '`' + r.top_writer.replace(/`/g, "'") + '`' : 'no matching statement in pg_stat_statements'}`)
  if (freed.length) { out.push('', '**Free space from deletes (no writer action; compaction candidate):**'); for (const r of freed) out.push(`- \`${r.tbl}\`: ${r.notes.join('; ')}`) }
  out.push('', '| table | heap | live est. | ratio | index | idx/heap | Δ idx/heap | HOT | upd/row/day |', '|---|---:|---:|---:|---:|---:|---:|---:|---:|')
  for (const r of results)
    out.push(`| ${r.tbl} | ${mb(r.heap_bytes)} | ${mb(r.live_bytes)} | ${r.ratio === null ? 'n/a' : r.ratio.toFixed(2)} | ${mb(r.index_bytes)} | ${r.idxRatio === null ? 'n/a' : r.idxRatio.toFixed(2)} | ${r.idxGrowth === null ? 'n/a' : (r.idxGrowth >= 0 ? '+' : '') + pct(r.idxGrowth)} | ${pct(r.hot)}${r.hotWindow ? '' : '*'} | ${r.updPerRowDay === null ? 'n/a' : r.updPerRowDay.toFixed(2)} |`)
  out.push('', `\\* HOT since stats reset (no weekly window yet). Thresholds: ratio > ${RATIO_LIMIT}; idx/heap growth > ${INDEX_GROWTH_LIMIT * 100}%; HOT < ${HOT_LIMIT * 100}% with > ${UPD_PER_ROW_DAY_LIMIT} upd/row/day. Live = reltuples × (28 + Σ avg_width). Run: ${runUrl}`)
  return out.join('\n')
}

export function parseLedger(body) {
  const m = /```json\n([\s\S]*?)\n```/.exec(body ?? '')
  if (!m) return null
  try { const v = JSON.parse(m[1]); return v && Array.isArray(v.tables) ? v : null } catch { return null }
}
export function renderLedger(reading) {
  return `${LEDGER_MARKER}\nLast reading kept by the weekly database health check (edited in place; do not hand-edit).\n\n\`\`\`json\n${JSON.stringify({ ...reading, tables: reading.tables.map(({ top_writer, ...t }) => t) })}\n\`\`\``
}

async function gh(path, { method = 'GET', body } = {}) {
  const res = await fetch(`https://api.github.com/${path}`, { method,
    headers: { Authorization: `Bearer ${process.env.GH_TOKEN}`, Accept: 'application/vnd.github+json', 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined })
  if (!res.ok) throw new Unknown(`GitHub ${method} ${path} returned ${res.status}`)
  return res.json()
}
async function listComments(repo, issue) {
  const out = []
  for (let page = 1; ; page++) { const c = await gh(`repos/${repo}/issues/${issue}/comments?per_page=100&page=${page}`); out.push(...c); if (c.length < 100) return out }
}

async function main() {
  const args = Object.fromEntries(process.argv.slice(2).map((a) => a.replace(/^--/, '').split('=')))
  const target = args.target ?? 'production'
  const projectRef = PROJECT_REFS[target]
  if (!projectRef) throw new Unknown(`unknown target ${target}`)
  const repo = process.env.GITHUB_REPOSITORY ?? 'popcre/shared-db'
  const issue = args.issue ?? HEALTH_ISSUE
  const post = args.post !== 'false'
  const runUrl = process.env.RUN_URL ?? '(local run)'
  const signature = `Posted by db-bloat-weekly workflow (${runUrl})`

  const reading = await fetchReading(projectRef, undefined, { include: args['test-table'] ?? null })
  const useGitHub = Boolean(process.env.GH_TOKEN) && target === 'production'
  const comments = useGitHub ? await listComments(repo, issue) : []
  const ledger = comments.find((c) => c.body?.startsWith(LEDGER_MARKER))
  const prev = ledger ? parseLedger(ledger.body) : null
  const results = evaluate(reading, prev)
  const text = renderReading(reading, results, prev, { target, runUrl })
  console.log(text)
  const code = results.some((r) => r.flags.length) ? 1 : 0
  const propose = async () => {
    // Step 7 (after the reading is posted, so a proposal failure never loses it): propose at most one governed online repack (PR + claim; never a DB write).
    const testTable = args['test-table'] ?? null
    if (testTable && target !== 'preview') throw new Unknown('test mode runs against preview only')
    if (args.propose === 'true') {
      if (!process.env.REPACK_GH_TOKEN) throw new Unknown('REPACK_GH_TOKEN is not set; no repack proposal was considered')
      const policy = repack.loadPolicy(); const done = repack.completed(repo); const claims = repack.openDbClaims(repo)
      repack.closeFinishedClaims(repo, policy, done, claims, signature)
      const { candidate, log } = repack.choose(results, { policy, allowlist: repack.loadAllowlist(), done,
        openClaims: repack.openDbClaims(repo), diskAvail: await repack.diskAvailable(projectRef), testTable })
      for (const line of log) console.log(`repack: ${line}`)
      if (candidate) {
        const reason = testTable
          ? `Preview-only test-mode run (plan Step 7 gate) for \`${candidate.tbl}\`: heap ${mb(candidate.heap_bytes)}, ratio ${candidate.ratio?.toFixed(2)}.`
          : `\`${candidate.tbl}\` heap ${mb(candidate.heap_bytes)} is ${candidate.ratio.toFixed(2)}x its estimated live size (> ${repack.REPACK_RATIO}) on ${target}.`
        const opened = repack.openRepackPr(repo, { table: candidate.tbl, work: Number(HEALTH_ISSUE), previewOnly: Boolean(testTable),
          day: reading.read_at.slice(0, 10), reason, signature })
        console.log(`repack: opened ${opened.prUrl} (operation ${opened.id}, claim #${opened.claim}), queued to merge`)
      }
    }
  }
  if (!useGitHub) { await propose(); return code }
  if (ledger) await gh(`repos/${repo}/issues/comments/${ledger.id}`, { method: 'PATCH', body: { body: renderLedger(reading) } })
  else await gh(`repos/${repo}/issues/${issue}/comments`, { method: 'POST', body: { body: renderLedger(reading) } })
  if (post) await gh(`repos/${repo}/issues/${issue}/comments`, { method: 'POST', body: { body: `${text}\n\n${signature}` } })
  await propose()
  return code
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().then((code) => process.exit(code)).catch((e) => { console.error(`db-bloat-weekly could not take a reading: ${e.message}`); process.exit(2) })
}
