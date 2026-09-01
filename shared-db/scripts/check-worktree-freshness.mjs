#!/usr/bin/env node

import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

export class StaleWorktree extends Error {}

export function requireCurrentMain({ root = repoRoot, run = execFileSync } = {}) {
  const git = (args) => String(run('git', ['-C', root, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })).trim()
  let head, main
  try {
    git(['fetch', '--quiet', '--no-tags', 'origin', '+refs/heads/main:refs/remotes/origin/main'])
    head = git(['rev-parse', 'HEAD']).toLowerCase()
    main = git(['rev-parse', 'refs/remotes/origin/main']).toLowerCase()
  } catch (error) {
    throw new StaleWorktree(`could not refresh live origin/main; refusing a verification read (${error.message})`)
  }
  if (!/^[0-9a-f]{40}$/.test(head) || !/^[0-9a-f]{40}$/.test(main)) throw new StaleWorktree('git returned a malformed commit SHA; refusing a verification read')
  if (head !== main) throw new StaleWorktree(`checked-out commit ${head} is not live origin/main ${main}; refusing a verification read`)
  return { head, main }
}

export function main() {
  try {
    const result = requireCurrentMain()
    process.stdout.write(`FRESH: checked-out commit equals live origin/main ${result.main}\n`)
  } catch (error) {
    process.stderr.write(`STALE OR UNVERIFIABLE: ${error.message}\n`)
    process.exitCode = 2
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main()
