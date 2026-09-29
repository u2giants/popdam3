// Job-level reading of a GitHub Actions workflow file (#3746).
//
// Once several guards became jobs of ONE workflow (pr-guards.yml), a file-wide
// regex no longer proves anything about a specific job: one job's text can
// satisfy an assertion meant for another. These helpers slice the exact job
// block and read that job's own display name and event gate.

// The exact job-level display names a workflow emits. A literal `name:` emits
// itself; a lane-capable name EXPRESSION emits its `|| '<default>'` branch on
// every non-lane run, which is the only form a required context can take.
export function emittedJobNames(text) {
  const names = new Set()
  for (const [, raw] of text.matchAll(/^ {4}name: (.+)$/gm)) {
    const value = raw.trim()
    const expr = /^\$\{\{.*\|\| '([^']+)' \}\}$/.exec(value)
    names.add(expr ? expr[1] : value)
  }
  return names
}

// Every job block under `jobs:`, keyed by job id, as the block's own text.
export function jobBlocks(text) {
  const normalized = text.replace(/\r\n/g, '\n')
  const start = normalized.search(/^jobs:\n/m)
  if (start < 0) return new Map()
  const lines = normalized.slice(start).split('\n').slice(1)
  const blocks = new Map()
  let id = null
  let buffer = []
  const flush = () => { if (id) blocks.set(id, buffer.join('\n')) }
  for (const line of lines) {
    const head = /^ {2}([A-Za-z0-9_-]+):\s*$/.exec(line)
    if (head) { flush(); id = head[1]; buffer = [line]; continue }
    if (/^\S/.test(line)) break
    if (id) buffer.push(line)
  }
  flush()
  return blocks
}

// The one job block whose display name is exactly `name` (null if none, throws if several).
export function jobBlockByName(text, name) {
  const hits = [...jobBlocks(text).values()].filter((block) => emittedJobNames(block).has(name))
  if (hits.length > 1) throw new Error(`more than one job emits "${name}"`)
  return hits[0] ?? null
}

// The events a job admits through its own job-level `if:`. null = no job-level
// `if:` (every workflow event). Any `if:` other than the event-list form is
// returned as the raw string so a caller can refuse it rather than guess.
export function jobEvents(block) {
  const line = /^ {4}if: (.+)$/m.exec(block)?.[1]?.trim()
  if (line === undefined) return null
  // `always()` gates on predecessor results, never on the event: every event.
  if (/^(?:\$\{\{\s*)?always\(\)(?:\s*\}\})?$/.test(line)) return null
  const list = /^contains\(fromJSON\('(\[[^']*\])'\), github\.event_name\)$/.exec(line)
  return list ? JSON.parse(list[1]) : line
}

// A step inside one job block, from its `- name:` line to the next step.
export function stepBlock(block, stepName) {
  const at = block.indexOf(`      - name: ${stepName}\n`)
  if (at < 0) return null
  const next = block.indexOf('\n      - ', at + 1)
  return block.slice(at, next < 0 ? block.length : next)
}
