#!/usr/bin/env node
// Cross-platform launcher for the project Supabase MCP server (.mcp.json).
// Issue #3659. Routes through the machine's ai-devops secret launcher, which
// injects SUPABASE_ACCESS_TOKEN from 1Password; no secret lives in this repo.
//   Windows: cmd /c %USERPROFILE%\.config\ai-devops\mcp-launch.cmd cmd /c npx ...
//   Linux/macOS: ~/.config/ai-devops/mcp-launch.sh npx ...
// The server is bound to PRODUCTION; --read-only is its only write barrier.
import { spawn } from 'node:child_process'
import { realpathSync, writeSync } from 'node:fs'
import { homedir } from 'node:os'
import { posix, win32 } from 'node:path'
import { fileURLToPath } from 'node:url'

export const SERVER_ARGS = Object.freeze([
  '-y',
  '@supabase/mcp-server-supabase@0.11.0',
  '--read-only',
  '--project-ref',
  'qsllyeztdwjgirsysgai',
])

export function launchPlan(platform = process.platform, home = homedir()) {
  if (platform === 'win32') {
    return {
      command: 'cmd',
      args: ['/c', win32.join(home, '.config', 'ai-devops', 'mcp-launch.cmd'), 'cmd', '/c', 'npx', ...SERVER_ARGS],
    }
  }
  return { command: posix.join(home, '.config', 'ai-devops', 'mcp-launch.sh'), args: ['npx', ...SERVER_ARGS] }
}

export function isMainModule(moduleUrl, argv1, realpath = realpathSync) {
  if (!argv1) return false
  try {
    return realpath(fileURLToPath(moduleUrl)) === realpath(argv1)
  } catch {
    return false
  }
}

function run() {
  const { command, args } = launchPlan()
  const child = spawn(command, args, { stdio: 'inherit', windowsHide: true })
  const forwarded = ['SIGINT', 'SIGTERM', 'SIGHUP']
  for (const s of forwarded) process.on(s, () => child.kill(s))
  child.on('error', (err) => {
    // Synchronous write: console.error to a pipe can be lost on process.exit.
    writeSync(2, `mcp-supabase-launch: cannot start ${command}: ${err.message}\n`)
    process.exit(127)
  })
  child.on('exit', (code, signal) => {
    if (signal) {
      for (const s of forwarded) process.removeAllListeners(s)
      process.kill(process.pid, signal)
      return
    }
    process.exit(code ?? 1)
  })
}

if (isMainModule(import.meta.url, process.argv[1])) run()
