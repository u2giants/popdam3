#!/usr/bin/env node
// Re-bloat monitor for public.assets (popcre/shared-db#5747, plan Step 6).
//
// Read-only: one constant SELECT through the Supabase Management API. It keeps a
// rolling ledger of daily readings in ONE edited comment on the monitor issue
// (so the 7-day HOT ratio can be computed from counter deltas), and posts a NEW
// comment only when a threshold is breached (throttled to one per 7 days) or
// when asked to post a reading (workflow_dispatch dry run).
//
// Thresholds (plan §9 Step 6): heap / live-tuple bytes > 2.0, or HOT ratio over
// the last 7 days < 70%.
// Owner: shared-db maintainers. Retirement: delete this script, its test and the
// workflow job after 60 consecutive in-threshold days, with a note on #5747.
import { PROJECT_REFS, Unknown } from './db-flow/read-preview-ledger.mjs'

export const READING_SQL = `select pg_relation_size('public.assets')::bigint as heap_bytes,
 (select coalesce(sum(pg_column_size(a.*)),0) + count(*)*28 from public.assets a)::bigint as live_bytes,
 (select count(*) from public.assets)::bigint as live_rows,
 pg_indexes_size('public.assets')::bigint as index_bytes,
 s.n_tup_upd::bigint, s.n_tup_hot_upd::bigint, s.n_dead_tup::bigint,
 s.last_autovacuum, now() as read_at
 from pg_stat_user_tables s where s.relid = 'public.assets'::regclass`

export const RATIO_LIMIT = 2.0
export const HOT_LIMIT = 0.70
export const WINDOW_DAYS = 7
export const LEDGER_MARKER = '<!-- assets-bloat-monitor:ledger -->'
export const ALERT_MARKER = '<!-- assets-bloat-monitor:alert -->'
const DAY = 86400000

export async function fetchReading(projectRef, token = process.env.SUPABASE_ACCESS_TOKEN, { fetchImpl = fetch } = {}) {
  if (!token) throw new Unknown('SUPABASE_ACCESS_TOKEN is not set; no reading was taken')
  const res = await fetchImpl(`https://api.supabase.com/v1/projects/${projectRef}/database/query`, {
    method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: READING_SQL }),
  })
  const body = await res.text()
  if (!res.ok) throw new Unknown(`Management API returned ${res.status}: ${body.slice(0, 300)}`)
  const rows = JSON.parse(body)
  if (!Array.isArray(rows) || rows.length !== 1) throw new Unknown('expected exactly one reading row')
  const r = rows[0]
  const n = (k) => { const v = Number(r[k]); if (!Number.isFinite(v)) throw new Unknown(`reading column ${k} is absent`); return v }
  return { read_at: new Date(r.read_at).toISOString(), heap_bytes: n('heap_bytes'), live_bytes: n('live_bytes'), live_rows: n('live_rows'),
    index_bytes: n('index_bytes'), n_tup_upd: n('n_tup_upd'), n_tup_hot_upd: n('n_tup_hot_upd'), n_dead_tup: n('n_dead_tup'),
    last_autovacuum: r.last_autovacuum ?? null }
}

// Pick the oldest prior reading inside the window whose counters are not past
// the current ones (a stats reset makes deltas meaningless).
export function evaluate(reading, history) {
  const now = Date.parse(reading.read_at)
  if (!(reading.live_bytes > 0)) throw new Unknown('live bytes is zero; refusing to compute a ratio')
  const ratio = reading.heap_bytes / reading.live_bytes
  const base = history
    .filter((h) => now - Date.parse(h.read_at) <= (WINDOW_DAYS + 1) * DAY && now - Date.parse(h.read_at) >= DAY / 2)
    .filter((h) => h.n_tup_upd <= reading.n_tup_upd && h.n_tup_hot_upd <= reading.n_tup_hot_upd)
    .sort((a, b) => Date.parse(a.read_at) - Date.parse(b.read_at))[0]
  let hot = null
  if (base) {
    const upd = reading.n_tup_upd - base.n_tup_upd
    hot = { since: base.read_at, updates: upd, ratio: upd > 0 ? (reading.n_tup_hot_upd - base.n_tup_hot_upd) / upd : null,
      days: (now - Date.parse(base.read_at)) / DAY }
  }
  const cumulativeHot = reading.n_tup_upd > 0 ? reading.n_tup_hot_upd / reading.n_tup_upd : null
  const breaches = []
  if (ratio > RATIO_LIMIT) breaches.push(`heap/live ratio ${ratio.toFixed(2)} > ${RATIO_LIMIT}`)
  if (hot && hot.ratio !== null && hot.days >= WINDOW_DAYS - 0.5 && hot.ratio < HOT_LIMIT)
    breaches.push(`HOT ratio ${(hot.ratio * 100).toFixed(1)}% < ${HOT_LIMIT * 100}% over ${hot.days.toFixed(1)} days`)
  return { ratio, hot, cumulativeHot, breaches }
}

const mb = (b) => `${(b / 1048576).toFixed(0)} MB`
export function est(iso) {
  return new Date(iso).toLocaleString('en-US', { timeZone: 'America/New_York', dateStyle: 'medium', timeStyle: 'short' }) + ' ET (America/New_York)'
}

export function renderReading(reading, result, { target, runUrl }) {
  const hotLine = result.hot
    ? `${result.hot.ratio === null ? 'n/a (no updates)' : (result.hot.ratio * 100).toFixed(1) + '%'} over ${result.hot.days.toFixed(1)} days (${result.hot.updates} updates since ${est(result.hot.since)})`
    : `no prior reading in the ${WINDOW_DAYS}-day window yet; cumulative since stats reset ${result.cumulativeHot === null ? 'n/a' : (result.cumulativeHot * 100).toFixed(1) + '%'}`
  return [
    `**public.assets bloat reading — ${target}, ${est(reading.read_at)}**`, '',
    `- Heap ${mb(reading.heap_bytes)} vs live tuple bytes ${mb(reading.live_bytes)} (${reading.live_rows} rows): ratio **${result.ratio.toFixed(2)}** (limit ${RATIO_LIMIT})`,
    `- HOT update ratio: ${hotLine} (limit ${HOT_LIMIT * 100}% over ${WINDOW_DAYS} days)`,
    `- Indexes ${mb(reading.index_bytes)}; dead tuples ${reading.n_dead_tup}; last autovacuum ${reading.last_autovacuum ? est(reading.last_autovacuum) : 'never'}`,
    `- Verdict: ${result.breaches.length ? 'OVER THRESHOLD — ' + result.breaches.join('; ') : 'within thresholds'}`,
    '', `Live bytes = sum(pg_column_size(row)) + 28 bytes header/line pointer per row (pgstattuple is not installed). Run: ${runUrl}`,
  ].join('\n')
}

export function parseLedger(body) {
  const m = /```json\n([\s\S]*?)\n```/.exec(body ?? '')
  if (!m) return []
  try { const v = JSON.parse(m[1]); return Array.isArray(v) ? v : [] } catch { return [] }
}
export function renderLedger(history) {
  return `${LEDGER_MARKER}\nRolling readings kept by the assets bloat monitor (edited in place; do not hand-edit).\n\n\`\`\`json\n${JSON.stringify(history.slice(-14))}\n\`\`\``
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
  const issue = args.issue ?? '5747'
  const post = args.post === 'true'
  const runUrl = process.env.RUN_URL ?? '(local run)'
  const signature = process.env.AI_GH_SIGNATURE ?? `Posted by assets-bloat-monitor workflow (${runUrl})`

  const reading = await fetchReading(projectRef)
  const useGitHub = Boolean(process.env.GH_TOKEN) && target === 'production'
  const comments = useGitHub ? await listComments(repo, issue) : []
  const ledger = comments.find((c) => c.body?.startsWith(LEDGER_MARKER))
  const history = ledger ? parseLedger(ledger.body) : []
  const result = evaluate(reading, history)
  const text = renderReading(reading, result, { target, runUrl })
  console.log(text)
  if (!useGitHub) return result.breaches.length ? 1 : 0

  const newHistory = [...history, reading]
  if (ledger) await gh(`repos/${repo}/issues/comments/${ledger.id}`, { method: 'PATCH', body: { body: renderLedger(newHistory) } })
  else await gh(`repos/${repo}/issues/${issue}/comments`, { method: 'POST', body: { body: renderLedger(newHistory) } })

  const lastAlert = comments.filter((c) => c.body?.startsWith(ALERT_MARKER)).map((c) => Date.parse(c.created_at)).sort().pop()
  const alertDue = result.breaches.length && (!lastAlert || Date.parse(reading.read_at) - lastAlert >= WINDOW_DAYS * DAY)
  if (post || alertDue) {
    const marker = result.breaches.length && alertDue ? ALERT_MARKER + '\n' : ''
    await gh(`repos/${repo}/issues/${issue}/comments`, { method: 'POST', body: { body: `${marker}${text}\n\n${signature}` } })
  }
  return result.breaches.length ? 1 : 0
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().then((code) => process.exit(code)).catch((e) => { console.error(`assets-bloat-monitor could not take a reading: ${e.message}`); process.exit(2) })
}
