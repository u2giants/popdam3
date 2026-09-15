#!/usr/bin/env node
// Verify every Supabase project/branch ref named in a config source against the
// account's REAL project and branch list (issue #2429).
//
// WHY
// ---
// A machine-local overlay kept returning the ref of a project deleted in August.
// At the point of use a stale ref is indistinguishable from a deleted project:
// every session got `Resource has been removed` and concluded the rehearsal
// target was gone, while the live branch was healthy the whole time. This check
// makes a stale entry fail loudly and name its own source and key instead.
//
// TWO TRAPS THIS CHECK MUST NOT FALL INTO
// ---------------------------------------
// 1. `supabase projects list` does NOT enumerate preview branches. A checker
//    built on it alone calls every live branch gone. The inventory is the
//    UNION of `projects list` and `branches list --project-ref <parent>` for
//    every project.
// 2. A negative verdict is only trustworthy once the inventory is shown to be
//    complete: every branch listing must succeed, and a --control-ref (a ref
//    known to be live, ideally a preview BRANCH) must classify LIVE. Otherwise
//    every non-LIVE verdict is downgraded to UNKNOWN and the run exits 2.
//
// VERDICTS (per config key)
//   LIVE     ref is in the account's project/branch inventory.
//   RETIRED  ref is not live and appears in a retired-ref key (name contains RETIRED).
//   UNKNOWN  ref is not live and not recorded as retired: stale, typo, or wrong account.
//
// READ-ONLY: runs only the two list commands; needs no database credential and
// changes nothing.
//
// Usage:
//   node scripts/check-supabase-ref-config.mjs --config <file> [--config <file> ...]
//        [--env] --control-ref <live-branch-ref> [--json]
// Without --control-ref, or when it is not seen as a preview BRANCH (a parent
// project does not count), the inventory is never trusted and the run exits 2.
// Config files may be JSON (nested objects allowed) or KEY=VALUE lines.
// Exit: 0 all active keys LIVE; 1 a key is RETIRED/UNKNOWN; 2 inventory untrusted or usage error.
import {readFileSync} from 'node:fs'
import {spawnSync} from 'node:child_process'
import {pathToFileURL} from 'node:url'

export const REF_PATTERN = /^[a-z]{20}$/
const AUTHORITY_HINT =
  'authoritative values: repository variable PREVIEW_PROJECT_REF (CI) and the 1Password vibe_coding item for the rehearsal branch, which lists every consumer that must move together'

const isRetiredKey = (key) => /retired/i.test(key)

// Pull `{source, key, ref}` entries out of a config text. Only values that are
// exactly a 20-letter ref are considered, so prose and URLs are ignored unless
// they are a bare ref; refs inside a supabase URL host are extracted too.
export function extractRefEntries(text, source) {
  const entries = []
  const push = (key, value) => {
    if (typeof value !== 'string') return
    const candidates = value.split(/[\s,;]+/)
    for (const candidate of candidates) {
      const host = candidate.match(/^https?:\/\/([a-z]{20})\.supabase\.co/)
      const ref = host ? host[1] : candidate
      if (REF_PATTERN.test(ref)) entries.push({source, key, ref})
    }
  }
  let parsed
  try { parsed = JSON.parse(text) } catch { parsed = undefined }
  if (parsed && typeof parsed === 'object') {
    const walk = (node, prefix) => {
      if (Array.isArray(node)) node.forEach((v, i) => walk(v, `${prefix}[${i}]`))
      else if (node && typeof node === 'object') for (const [k, v] of Object.entries(node)) walk(v, prefix ? `${prefix}.${k}` : k)
      else push(prefix, node)
    }
    walk(parsed, '')
    return entries
  }
  for (const line of text.split(/\r?\n/)) {
    if (line.trim().startsWith('#')) continue
    const m = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_.-]*)\s*[=:]\s*(.*)$/)
    if (!m) continue
    const raw = m[2].trim()
    // A quoted value ends at its closing quote; an unquoted one at a ` #` comment.
    const quoted = raw.match(/^(["'])(.*?)\1/)
    push(m[1], quoted ? quoted[2] : raw.replace(/\s+#.*$/, ''))
  }
  return entries
}

// Build the account inventory from injected list results.
// projects: array of {ref,...}; branchesFor(ref) -> array of {project_ref,...} or throws.
export function buildInventory(projects, branchesFor) {
  const live = new Map()
  const branches = new Set() // refs observed through `branches list` only
  const errors = []
  for (const p of projects) live.set(p.ref ?? p.id, `project ${p.name ?? ''} (${p.status ?? '?'})`.trim())
  for (const p of projects) {
    const parent = p.ref ?? p.id
    try {
      for (const b of branchesFor(parent)) {
        if (b.project_ref) {
          live.set(b.project_ref, `branch ${b.name ?? ''} of ${parent} (${b.status ?? '?'})`)
          branches.add(b.project_ref)
        }
      }
    } catch (error) {
      // A project with branching disabled is a complete answer, not a failure.
      // Only the explicit branching-off wording is accepted; any other error is an inventory gap.
      if (/\bbranching (?:is )?(?:not enabled|disabled)\b/i.test(String(error?.message))) continue
      errors.push(`branches list for ${parent} failed: ${String(error?.message ?? error).split('\n')[0]}`)
    }
  }
  return {live, branches, errors}
}

export function classify(entries, inventory, {controlRef} = {}) {
  const retired = new Set(entries.filter((e) => isRetiredKey(e.key)).map((e) => e.ref))
  const problems = [...inventory.errors]
  if (inventory.live.size === 0) problems.push('inventory is empty')
  if (!controlRef) {
    problems.push('no --control-ref given, so nothing proves the inventory includes preview branches')
  } else if (!inventory.branches?.has(controlRef)) {
    // A parent project is always in `projects list`, so only a ref seen through
    // `branches list` proves branch enumeration actually worked.
    problems.push(`control ref ${controlRef} is not in the inventory, so the inventory cannot be trusted to call any ref absent`)
  }
  const trusted = problems.length === 0
  const results = entries.map((e) => {
    const retiredKey = isRetiredKey(e.key)
    let verdict
    if (inventory.live.has(e.ref)) verdict = 'LIVE'
    else if (!trusted) verdict = 'UNKNOWN'
    else if (retired.has(e.ref)) verdict = 'RETIRED'
    else verdict = 'UNKNOWN'
    const detail = verdict === 'LIVE' ? inventory.live.get(e.ref) : trusted ? 'not in any project or branch list of this account' : 'inventory untrusted'
    // A retired-ref key holding a retired ref is correct; a live ref there is suspicious but harmless.
    const failing = !retiredKey && verdict !== 'LIVE'
    return {...e, retiredKey, verdict, detail, failing}
  })
  const exitCode = !trusted ? 2 : results.some((r) => r.failing) ? 1 : 0
  return {trusted, problems, results, exitCode}
}

export function formatReport(report) {
  const lines = report.results.map((r) =>
    `${r.failing ? 'FAIL' : 'ok  '} ${r.verdict.padEnd(7)} ${r.ref}  ${r.source} :: ${r.key}${r.retiredKey ? ' (retired-ref key)' : ''} — ${r.detail}`)
  if (!report.trusted) lines.push(`INVENTORY UNTRUSTED: ${report.problems.join('; ')}`)
  if (report.exitCode !== 0) lines.push(AUTHORITY_HINT)
  lines.push(`result: exit ${report.exitCode} (${report.results.length} ref value(s) checked)`)
  return lines.join('\n')
}

function supabaseJson(args) {
  const run = spawnSync('supabase', [...args, '-o', 'json'], {encoding: 'utf8'})
  if (run.status !== 0) throw new Error((run.stderr || run.stdout || `exit ${run.status}`).trim())
  return JSON.parse(run.stdout)
}

export function main(argv = process.argv.slice(2), io = {}) {
  const configs = []
  let useEnv = false, controlRef, json = false
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--config') configs.push(argv[++i])
    else if (a === '--env') useEnv = true
    else if (a === '--control-ref') controlRef = argv[++i]
    else if (a === '--json') json = true
    else { console.error(`unknown argument: ${a}`); return 2 }
  }
  if (configs.some((c) => !c) || (!configs.length && !useEnv)) { console.error('usage: --config <file> ... [--env] [--control-ref <ref>] [--json]'); return 2 }
  if (controlRef && !REF_PATTERN.test(controlRef)) { console.error(`--control-ref is not a project ref: ${controlRef}`); return 2 }
  const entries = []
  for (const file of configs) entries.push(...extractRefEntries((io.readFile ?? ((f) => readFileSync(f, 'utf8')))(file), file))
  if (useEnv) for (const [k, v] of Object.entries(io.env ?? process.env)) if (/ref|supabase|project/i.test(k)) entries.push(...extractRefEntries(`${k}=${v}`, 'env'))
  const list = io.supabaseJson ?? supabaseJson
  let inventory
  try {
    inventory = buildInventory(list(['projects', 'list']), (ref) => list(['branches', 'list', '--project-ref', ref]))
  } catch (error) {
    inventory = {live: new Map(), errors: [`projects list failed: ${String(error?.message ?? error).split('\n')[0]}`]}
  }
  const report = classify(entries, inventory, {controlRef})
  const out = io.log ?? console.log
  out(json ? JSON.stringify({...report, results: report.results}, null, 2) : formatReport(report))
  return report.exitCode
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) process.exitCode = main()
