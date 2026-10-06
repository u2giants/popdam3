#!/usr/bin/env node
// Re-target a pre-split patch of scripts/manage-migration-author-lanes.mjs onto
// the split layout (issue #3726). Every hunk is moved to the ONE current file
// whose text contains the hunk's old side (context + removed lines) verbatim, so
// a pull request written before the split can be replayed mechanically:
//
//   git diff "$(git merge-base origin/main HEAD~0)" HEAD -- scripts/manage-migration-author-lanes.mjs > /tmp/lane.patch
//   node scripts/route-lane-manager-patch.mjs /tmp/lane.patch > /tmp/routed.patch
//   git apply --3way /tmp/routed.patch
//
// A hunk that straddles a moved boundary is split per changed run; a run whose
// old side locates in no file, or in more than one place, is REFUSED and named
// and must be applied by hand. Read-only: this
// prints a patch and never writes the working tree.
import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

export const ENTRY = 'scripts/manage-migration-author-lanes.mjs'
export const LANES_DIR = 'scripts/lib/lanes'

export function parseHunks(patchText) {
  const hunks = []
  let current = null
  for (const line of patchText.split('\n')) {
    if (line.startsWith('@@')) { current = { header: line, lines: [] }; hunks.push(current); continue }
    if (!current) continue
    if (line.startsWith('diff --git') || line.startsWith('--- ') || line.startsWith('+++ ') || line.startsWith('index ')) { current = null; continue }
    if (line === '' && current.lines.length && current === hunks.at(-1)) { current.lines.push(' '); continue }
    current.lines.push(line)
  }
  for (const hunk of hunks) while (hunk.lines.length && hunk.lines.at(-1) === ' ') hunk.lines.pop()
  return hunks
}

function occurrences(text, needle) {
  let count = 0, at = -1, index = text.indexOf(needle)
  while (index !== -1) { count += 1; at = index; index = text.indexOf(needle, index + 1) }
  return { count, at }
}

// The unique place in the current files whose text is exactly this old side.
function locate(lines, files) {
  const needle = lines.filter((line) => line[0] === ' ' || line[0] === '-').map((line) => line.slice(1)).join('\n')
  if (!needle) return null
  // Whole lines only: a needle may not begin or end inside a longer line.
  const hits = Object.entries(files).map(([file, text]) => ({ file, text: `\n${text}`, ...occurrences(`\n${text}${text.endsWith('\n') ? '' : '\n'}`, `\n${needle}\n`) })).filter((hit) => hit.count > 0)
  if (hits.length !== 1 || hits[0].count !== 1) return null
  return { file: hits[0].file, start: hits[0].text.slice(0, hits[0].at + 1).split('\n').length - 1 }
}

// A hunk whose context straddles a moved boundary is split into one piece per
// run of changed lines, each keeping as much of its own context as still
// locates uniquely. Context is only trimmed, never invented.
function pieces(hunk) {
  const runs = []
  hunk.lines.forEach((line, index) => {
    if (line[0] !== '+' && line[0] !== '-') return
    const last = runs.at(-1)
    if (last && last.end === index) last.end = index + 1
    else runs.push({ begin: index, end: index + 1 })
  })
  return runs.map((run, i) => {
    const floor = i === 0 ? 0 : runs[i - 1].end, ceil = i === runs.length - 1 ? hunk.lines.length : runs[i + 1].begin
    return { run, floor, ceil }
  })
}

// The split exported module-private declarations so the entrypoint can import
// them: `function x(` became `export function x(`. A pre-split hunk that names
// such a line is retried with that prefix on every top-level declaration line.
const TOP_LEVEL_DECLARATION = /^(?:async function|function|const|let|class) /
export function withExportPrefix(lines) {
  return lines.map((line) => TOP_LEVEL_DECLARATION.test(line.slice(1)) ? `${line[0]}export ${line.slice(1)}` : line)
}

function locateEither(lines, files) {
  const plain = locate(lines, files)
  if (plain) return { found: plain, lines }
  const prefixed = withExportPrefix(lines)
  const hit = locate(prefixed, files)
  return hit ? { found: hit, lines: prefixed } : null
}

export function routeHunks(hunks, files) {
  const routed = new Map(), refused = []
  const place = (found, piece) => {
    // Top up context to three lines each side from the destination file
    // itself, so git never anchors a short-context piece to a file edge.
    const target = files[found.file].split('\n')
    const lead = piece.findIndex((line) => line[0] !== ' '), trail = [...piece].reverse().findIndex((line) => line[0] !== ' ')
    const oldLength = piece.filter((line) => line[0] !== '+').length
    const addBefore = Math.max(0, Math.min(3 - lead, found.start - 1))
    const endLine = found.start - 1 + oldLength
    const addAfter = Math.max(0, Math.min(3 - trail, target.length - endLine - (files[found.file].endsWith('\n') ? 1 : 0)))
    const lines = [...target.slice(found.start - 1 - addBefore, found.start - 1).map((line) => ` ${line}`), ...piece, ...target.slice(endLine, endLine + addAfter).map((line) => ` ${line}`)]
    found = { ...found, start: found.start - addBefore }
    if (!routed.has(found.file)) routed.set(found.file, [])
    routed.get(found.file).push({ start: found.start, oldCount: lines.filter((line) => line[0] !== '+').length, newCount: lines.filter((line) => line[0] !== '-').length, lines })
  }
  for (const hunk of hunks) {
    const whole = locateEither(hunk.lines, files)
    if (whole) { place(whole.found, whole.lines); continue }
    for (const { run, floor, ceil } of pieces(hunk)) {
      let found = null, chosen = null
      // Symmetric context first: git anchors a hunk with less leading than
      // trailing context to the start of the file.
      const maxBefore = Math.min(3, run.begin - floor), maxAfter = Math.min(3, ceil - run.end)
      const shapes = []
      for (let size = 3; size >= 1; size -= 1) if (size <= maxBefore && size <= maxAfter) shapes.push([size, size])
      for (let before = maxBefore; before >= 0; before -= 1) for (let after = maxAfter; after >= 0; after -= 1) if (before + after > 0 && before !== after) shapes.push([before, after])
      for (const [before, after] of shapes) {
        const lines = hunk.lines.slice(run.begin - before, run.end + after)
        const hit = locateEither(lines, files)
        if (hit) { found = hit.found; chosen = hit.lines; break }
      }
      if (found) place(found, chosen)
      else refused.push({ header: hunk.header, owners: [] })
    }
  }
  let out = ''
  for (const [file, list] of routed) {
    out += `diff --git a/${file} b/${file}\n--- a/${file}\n+++ b/${file}\n`
    let shift = 0
    // Pieces cut from one hunk may share context lines, and git refuses
    // overlapping hunks. Overlapping pieces are rejoined line by line against
    // the destination text: each old line is deleted if either piece deletes
    // it, and insertions keep their order. Two pieces rewriting the same line
    // differently cannot happen in one source patch; it is refused if seen.
    const target = files[file].split('\n')
    const groups = []
    for (const h of list.sort((x, y) => x.start - y.start)) {
      const last = groups.at(-1)
      if (last && h.start <= last.end) { last.members.push(h); last.end = Math.max(last.end, h.start + h.oldCount) }
      else groups.push({ start: h.start, end: h.start + h.oldCount, members: [h] })
    }
    const merged = groups.map((group) => {
      if (group.members.length === 1) return group.members[0]
      const deleted = new Set(), inserts = new Map()
      for (const h of group.members) {
        let old = h.start
        for (const line of h.lines) {
          if (line[0] === '+') { if (!inserts.has(old)) inserts.set(old, []); inserts.get(old).push(line) }
          else { if (line[0] === '-') deleted.add(old); old += 1 }
        }
      }
      const lines = []
      for (let old = group.start; old <= group.end; old += 1) {
        for (const line of inserts.get(old) ?? []) lines.push(line)
        if (old < group.end) lines.push(`${deleted.has(old) ? '-' : ' '}${target[old - 1]}`)
      }
      return { start: group.start, oldCount: lines.filter((line) => line[0] !== '+').length, newCount: lines.filter((line) => line[0] !== '-').length, lines }
    })
    for (const h of merged) {
      out += `@@ -${h.start},${h.oldCount} +${h.start + shift},${h.newCount} @@\n${h.lines.join('\n')}\n`
      shift += h.newCount - h.oldCount
    }
  }
  return { patch: out, refused }
}

export function currentFiles(root) {
  const files = { [ENTRY]: readFileSync(path.join(root, ENTRY), 'utf8') }
  for (const name of readdirSync(path.join(root, LANES_DIR)).filter((n) => n.endsWith('.mjs')).sort()) files[`${LANES_DIR}/${name}`] = readFileSync(path.join(root, LANES_DIR, name), 'utf8')
  return files
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
  const { patch, refused } = routeHunks(parseHunks(readFileSync(process.argv[2], 'utf8')), currentFiles(root))
  process.stdout.write(patch)
  for (const r of refused) process.stderr.write(`REFUSED part of hunk ${r.header}: its old side does not locate uniquely in the split files; apply by hand\n`)
  process.exitCode = refused.length ? 2 : 0
}
