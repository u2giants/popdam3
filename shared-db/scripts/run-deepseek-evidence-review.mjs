#!/usr/bin/env node
// Launch only after the governed allocator assigns DeepSeek. Example:
// node scripts/run-deepseek-evidence-review.mjs --issue 1772 --pr 1853 \
//   --head-sha <exact-head> --worktree <path> --prompt-file <short-prompt> \
//   --evidence-file <migration> --evidence-file <test> --evidence-file <base>
// The durable bundle keeps full evidence out of the Windows argument list. This
// launcher never allocates, replaces, releases, records a verdict, or edits refs.
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync, spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { ACTIVE_REVIEWERS, resolveCommandPath } from './manage-migration-author-lanes.mjs'
import { VERDICT_CONTRACT_FLAG_WRAPPERS, wrapperBaseName } from './lib/reviewer-capabilities.mjs'
import { reviewCallerEnvironment } from './lib/reviewer-caller-env.mjs'

// #3764: never hard-code the reviewer name. 'deepseek-chat' was retired and every
// preflight refused; the active DeepSeek row is whatever the allocator says it is.
export function activeDeepSeekReviewer(wrapper = 'ai-deepseek-agent', active = ACTIVE_REVIEWERS) {
  const rows = active.filter((row) => row.provider === 'deepseek' && row.wrapper === wrapper)
  if (rows.length !== 1) throw new Error(`expected exactly one active DeepSeek reviewer for ${wrapper}; found ${rows.length}`)
  return rows[0].name
}

// The model the active DeepSeek row was qualified on (registry evidence for
// deepseek-v4.1-flash, 2026-09-23). The registry has no model field, so this is
// the one literal; the test pins it to that row's recorded evidence.
// `--model deepseek-flash` is the ai-deepseek-agent formal-review flag documented in
// the deepseek-second-opinion skill ("A formal assigned review adds --governed-verdict
// <exact-head-sha> and --model deepseek-flash"), and was exercised live on 2026-09-28
// for PR #3744's governed DeepSeek verdicts.
export const DEEPSEEK_REVIEW_MODEL = 'deepseek-flash'

export function assertVerdictContractWrapper(wrapper) {
  if (!VERDICT_CONTRACT_FLAG_WRAPPERS.includes(wrapperBaseName(wrapper))) throw new Error('wrapper does not take the --governed-verdict contract')
}

export function deepSeekLaunchArgs(bundlePath, headSha) {
  return ['send', 'Review the attached governed evidence packet completely.', '--file', bundlePath, '--review', '--governed-verdict', headSha, '--model', DEEPSEEK_REVIEW_MODEL]
}

// Caller identity comes from the ONE authority (lib/reviewer-caller-env.mjs), the
// same path the governed runner and doctor probe use; codex stays the historical
// default when nothing names or detects a caller.
export function deepSeekChildEnv(wrapper, env = process.env) {
  return { ...env, AI_DEEPSEEK_CALLER: 'codex', ...reviewCallerEnvironment(wrapper, env, { required: false }) }
}

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex')

export function parseArgs(argv) {
  const out = { evidenceFiles: [] }
  const value = (i) => { if (i + 1 >= argv.length) throw new Error(`${argv[i]} needs a value`); return argv[i + 1] }
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === '--issue') out.issue = Number(value(i++))
    else if (arg === '--pr') out.pr = Number(value(i++))
    else if (arg === '--head-sha') out.headSha = value(i++)
    else if (arg === '--worktree') out.worktree = value(i++)
    else if (arg === '--prompt-file') out.promptFile = value(i++)
    else if (arg === '--evidence-file') out.evidenceFiles.push(value(i++))
    else if (arg === '--wrapper') out.wrapper = value(i++)
    else throw new Error(`unknown argument: ${arg}`)
  }
  return out
}

function inside(base, candidate) {
  const relative = path.relative(base, candidate)
  return relative !== '' && !relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative)
}

export function requireRegularNonSymlink(stat, name) {
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`evidence must be a regular non-symlink file: ${name}`)
}

function exactRepoFile(worktree, name) {
  const lexical = path.resolve(worktree, name)
  if (!inside(worktree, lexical)) throw new Error(`evidence path escapes the worktree: ${name}`)
  const stat = fs.lstatSync(lexical)
  requireRegularNonSymlink(stat, name)
  const real = fs.realpathSync(lexical)
  if (!inside(fs.realpathSync(worktree), real)) throw new Error(`evidence resolves outside the worktree: ${name}`)
  return { absolute: real, relative: path.relative(worktree, lexical).replaceAll('\\', '/') }
}

export function buildEvidenceBundle({ worktree, headSha, issue, pr, promptFile, evidenceFiles }) {
  if (!/^[0-9a-f]{40}$/i.test(headSha ?? '')) throw new Error('an exact 40-character head SHA is required')
  if (!evidenceFiles.length) throw new Error('at least one evidence file is required')
  const seen = new Set()
  if (!Number.isInteger(issue) || !Number.isInteger(pr)) throw new Error('exact issue and PR numbers are required')
  const prompt = exactRepoFile(worktree, promptFile)
  const promptBody = fs.readFileSync(prompt.absolute)
  if (!promptBody.length || promptBody.includes(0)) throw new Error('review prompt must be non-empty UTF-8 text without NUL bytes')
  const chunks = [Buffer.from(`GOVERNED REVIEW EVIDENCE v1\nissue=${issue}\npr=${pr}\nhead=${headSha}\nfile_count=${evidenceFiles.length}\n`, 'utf8'),
    Buffer.from(`\n--- BEGIN REVIEW INSTRUCTIONS ${prompt.relative} bytes=${promptBody.length} sha256=${sha256(promptBody)} ---\n`, 'utf8'), promptBody,
    Buffer.from(`\n--- END REVIEW INSTRUCTIONS ${prompt.relative} ---\n`, 'utf8')]
  const manifest = []
  for (const requested of evidenceFiles) {
    const file = exactRepoFile(worktree, requested)
    if (seen.has(file.relative)) throw new Error(`duplicate evidence file: ${file.relative}`)
    seen.add(file.relative)
    const body = fs.readFileSync(file.absolute)
    if (body.includes(0)) throw new Error(`binary/NUL evidence is not supported: ${file.relative}`)
    const digest = sha256(body)
    manifest.push({ path: file.relative, bytes: body.length, sha256: digest })
    chunks.push(Buffer.from(`\n--- BEGIN ${file.relative} bytes=${body.length} sha256=${digest} ---\n`, 'utf8'), body,
      Buffer.from(`\n--- END ${file.relative} ---\n`, 'utf8'))
  }
  const payload = Buffer.concat(chunks)
  return { payload, manifest, digest: sha256(payload) }
}

function commandLineLength(command, args) {
  return [command, ...args].map((part) => `"${String(part).replaceAll('"', '\\"')}"`).join(' ').length
}

export function reviewSpawnPlan(resolved, args, platform = process.platform, comspec = process.env.ComSpec) {
  if (platform === 'win32' && /\.(cmd|bat)$/i.test(resolved)) return { file: comspec || 'cmd.exe', args: ['/d', '/s', '/c', resolved, ...args] }
  return { file: resolved, args }
}

export function safeEvidenceDirectory(worktree) {
  const realWorktree = fs.realpathSync(worktree)
  const aiDir = path.join(worktree, '.ai')
  const evidenceDir = path.join(aiDir, 'governed-review-evidence')
  for (const directory of [aiDir, evidenceDir]) {
    if (!fs.existsSync(directory)) fs.mkdirSync(directory)
    const stat = fs.lstatSync(directory)
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error(`review evidence directory must be a real directory: ${directory}`)
    const real = fs.realpathSync(directory)
    if (!inside(realWorktree, real)) throw new Error(`review evidence directory resolves outside the worktree: ${directory}`)
  }
  return evidenceDir
}

export function runReview(options, deps = {}) {
  const worktree = path.resolve(options.worktree ?? root)
  const wrapper = options.wrapper ?? 'ai-deepseek-agent'
  if (!Number.isInteger(options.issue) || !Number.isInteger(options.pr)) throw new Error('exact issue and PR numbers are required')
  const head = (deps.git ?? ((args) => execFileSync('git', args, { encoding: 'utf8' })))(['-C', worktree, 'rev-parse', 'HEAD']).trim()
  if (head !== options.headSha) throw new Error(`worktree HEAD ${head} does not match assigned head ${options.headSha}`)
  const status = (deps.git ?? ((args) => execFileSync('git', args, { encoding: 'utf8' })))(['-C', worktree, 'status', '--porcelain']).trim()
  if (status && status.split(/\r?\n/).some((line) => !line.slice(3).replaceAll('\\', '/').startsWith('.ai/'))) throw new Error('worktree has non-review changes')
  const bundle = buildEvidenceBundle({ worktree, headSha: options.headSha, issue: options.issue, pr: options.pr, promptFile: options.promptFile, evidenceFiles: options.evidenceFiles })
  const evidenceDir = safeEvidenceDirectory(worktree)
  const bundlePath = path.join(evidenceDir, `${options.headSha}-${bundle.digest}.txt`)
  if (fs.existsSync(bundlePath)) {
    if (!fs.readFileSync(bundlePath).equals(bundle.payload)) throw new Error('existing evidence bundle digest path has different bytes')
  } else fs.writeFileSync(bundlePath, bundle.payload, { flag: 'wx' })
  const wrapperArgs = deepSeekLaunchArgs(bundlePath, options.headSha)
  if (commandLineLength(wrapper, wrapperArgs) > 7000) throw new Error('review launch still exceeds the safe Windows command-line budget')
  assertVerdictContractWrapper(wrapper)
  const childEnv = deepSeekChildEnv(wrapper, deps.env ?? process.env)
  const preflightArgs = ['scripts/manage-migration-author-lanes.mjs', '--reviewer-preflight', '--reviewer', activeDeepSeekReviewer(wrapper, deps.activeReviewers), '--wrapper', wrapper, '--worktree', worktree, '--head-sha', options.headSha]
  ;(deps.preflight ?? ((args) => execFileSync(process.execPath, args, { cwd: worktree, stdio: 'inherit' })))(preflightArgs)
  const run = deps.spawn ?? ((command, args, env) => {
    const resolved = resolveCommandPath(command)
    if (!resolved) return { status: null, error: new Error(`cannot resolve reviewer wrapper: ${command}`) }
    const plan = reviewSpawnPlan(resolved, args)
    return spawnSync(plan.file, plan.args, { cwd: worktree, stdio: 'inherit', env })
  })
  const result = run(wrapper, wrapperArgs, childEnv)
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(`DeepSeek review exited ${result.status}`)
  return { headSha: options.headSha, bundlePath, bundleSha256: bundle.digest, manifest: bundle.manifest, argumentCharacters: commandLineLength(wrapper, wrapperArgs) }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { console.log(JSON.stringify(runReview(parseArgs(process.argv.slice(2))), null, 2)) }
  catch (error) { console.error(`ERROR: ${error.message}`); process.exitCode = 1 }
}
