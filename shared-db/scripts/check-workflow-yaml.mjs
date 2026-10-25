#!/usr/bin/env node
//
// WORKFLOW YAML VALIDITY GUARD (2026-10-23 incident)
// =================================================
//
// On 2026-10-23 conflict markers were committed into
// .github/workflows/tools-offline-tests.yml. The file could not parse, so the
// workflow created ZERO jobs for every event. Required checks never started
// and every pull request sat unmergeable for hours — and nothing failed
// loudly, because a workflow file that cannot parse produces no red check;
// it produces silence. This guard is the loud failure that was missing.
//
// WHAT IT REFUSES
// ---------------
//   1. Any .github/workflows/*.yml|*.yaml that is not valid YAML (real parse,
//      not a regex skim of the shape).
//   2. Any conflict-marker line at column 0 — /^<{3,}/ (ours), /^>{3,}/
//      (theirs) or /^={3,}$/ (separator) — reported independently of the
//      parse, because markers are the diagnosis even when the parse error is
//      the symptom. Column 0 cannot be block-scalar content (content is
//      always indented), so a raw-line scan has no false positives.
//   3. A workflow directory with no files at all: a vacuous pass is the
//      silence this guard exists to end.
//
// PARSER CHOICE (deliberate, and it matters for reviewers)
// --------------------------------------------------------
// Node has no built-in YAML parser and this repository has no package.json,
// so js-yaml cannot be imported. This repository's CI does NOT run any
// python-yaml step (verified: no `import yaml`/`yaml.safe_load` in any
// workflow or script; the "openai.yaml" hits are string literals), so
// shelling out to `python3 -c` would add an undeclared dependency on runner
// image contents instead of the repository's own tooling. The parser below
// is therefore VENDORED: a minimal indentation-based YAML parser, zero
// dependencies, byte-identical behaviour on a laptop and on an ubuntu CI
// runner. Its acceptance rules were pinned against libyaml (PyYAML 6,
// safe_load) on every workflow file in this repository plus a battery of
// edge cases: plain scalars containing ": " are refused (even inside inner
// quotes — libyaml refuses `run: echo "foo: bar"`), a plain key may contain
// quotes and spaces (`echo "foo: bar` parses as one key + value), a
// sequence may sit at the same indent as its key, multi-line plain scalars,
// trailing commas and multi-line flow collections are accepted, tabs in
// indentation are refused, anchors/tags/duplicate keys are accepted. It
// validates STRUCTURE, not GitHub's workflow schema — a file that parses
// here but violates the actions schema still fails in GitHub's own
// validation.
//
// Run: node scripts/check-workflow-yaml.mjs [directory]
// Exit 0 prints one OK line; exit 1 names every file, line and problem.

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export class WorkflowYamlError extends Error {
  constructor(message, line) {
    super(line ? `${message} (line ${line})` : message)
    this.name = 'WorkflowYamlError'
    this.line = line ?? null
  }
}

// ---------------------------------------------------------------------------
// Conflict markers (raw lines, column 0 only — see header).
// ---------------------------------------------------------------------------

export const CONFLICT_MARKER_RULES = [
  { kind: 'conflict-ours', description: 'ours marker (<<<<<<<)', re: /^<{3,}/ },
  { kind: 'conflict-separator', description: 'separator marker (=======)', re: /^={3,}$/ },
  { kind: 'conflict-theirs', description: 'theirs marker (>>>>>>>)', re: /^>{3,}/ },
]

export function findConflictMarkers(text) {
  const found = []
  const lines = String(text).replace(/^\uFEFF/, '').split(/\r?\n/)
  lines.forEach((raw, index) => {
    for (const rule of CONFLICT_MARKER_RULES) {
      if (rule.re.test(raw)) {
        found.push({ line: index + 1, kind: rule.kind, description: rule.description, raw })
        break
      }
    }
  })
  return found
}

// ---------------------------------------------------------------------------
// Vendored minimal YAML parser.
//
// Line-oriented recursive descent over the block structure, with dedicated
// scanners for quoted scalars, block scalars (| and >) and flow collections
// ([], {}). Errors carry the offending 1-based line. `contIndent` is the
// indent a MULTI-LINE plain/quoted scalar continuation must beat: the key's
// indent for mapping values, the dash's indent for sequence items, -1 at
// document root.
// ---------------------------------------------------------------------------

const BLOCK_SCALAR_HEADER = /^([|>])([+-]?\d*|\d*[+-]?)?\s*(?:#.*)?$/
const REF_NAME = /^[A-Za-z_][\w-]*$/

function isDocMarker(text) {
  return text === '---' || text.startsWith('--- ') || text === '...' || text.startsWith('... ') || /^%/.test(text)
}

class Cursor {
  constructor(text) {
    this.lines = String(text).replace(/^\uFEFF/, '').split(/\r?\n/)
    this.i = 0
  }

  // Advance past blank and comment-only lines; return the next content line
  // without consuming it, or null at end of input. Tabs in the indentation
  // of a content line are a parse error, exactly as libyaml refuses them.
  peek() {
    while (this.i < this.lines.length) {
      const raw = this.lines[this.i]
      if (raw.trim() === '') { this.i += 1; continue }
      if (/^[\t ]*\t/.test(raw)) {
        throw new WorkflowYamlError('found a tab character in indentation — YAML refuses tabs in indentation', this.i + 1)
      }
      if (raw.trimStart().startsWith('#')) { this.i += 1; continue }
      const indent = /^ */.exec(raw)[0].length
      return { raw, text: raw.slice(indent), indent, line: this.i + 1 }
    }
    return null
  }
}

function isSeqEntry(text) {
  return text === '-' || /^-[\t ]/.test(text)
}

// Length of a quoted token that starts at text[0] (the opening quote is
// text[0]; the return value is the index just past its closing quote).
function quotedTokenEnd(text, line) {
  const quote = text[0]
  for (let i = 1; i < text.length; i += 1) {
    if (quote === "'" && text[i] === "'") {
      if (text[i + 1] === "'") { i += 1; continue }
      return i + 1
    }
    if (quote === '"' && text[i] === '\\') { i += 1; continue }
    if (quote === '"' && text[i] === '"') return i + 1
  }
  throw new WorkflowYamlError('unterminated quoted scalar', line)
}

// Index of the colon that separates a key from its value: the first ':'
// followed by a space or end-of-line. When the line STARTS with a quote the
// key is quoted and the colon must follow the closing quote; otherwise the
// key is plain and inner quotes are inert content (libyaml parses
// `echo "foo: bar` as key `echo "foo`). A comment (` #`) before any colon
// means the line carries no mapping colon. Returns { keyEnd, rest } or
// null. An empty PLAIN key (`: value`) is a refusal, matching libyaml.
function findKeyColon(text, line) {
  if (text[0] === "'" || text[0] === '"') {
    const end = quotedTokenEnd(text, line)
    let i = end
    while (i < text.length && /[\t ]/.test(text[i])) i += 1
    if (text[i] === ':' && (text[i + 1] === undefined || text[i + 1] === ' ' || text[i + 1] === '\t')) {
      return { keyEnd: i, rest: text.slice(i + 1).replace(/^[\t ]+/, '') }
    }
    return null
  }
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i]
    if (ch === '#' && i > 0 && /[\t ]/.test(text[i - 1])) return null
    if (ch === ':') {
      const next = text[i + 1]
      if (next === undefined || next === ' ' || next === '\t') {
        if (i === 0) throw new WorkflowYamlError('expected a mapping key, found a lone colon', line)
        return { keyEnd: i, rest: text.slice(i + 1).replace(/^[\t ]+/, '') }
      }
    }
  }
  return null
}

// Strip a trailing ` #comment` from a plain scalar (the `#` must be preceded
// by whitespace, or begin the scalar). A `#` glued to content stays content.
function stripPlainComment(s) {
  const m = /(^|\s)#.*$/.exec(s)
  return m ? s.slice(0, m.index).replace(/\s+$/, '') : s.replace(/\s+$/, '')
}

// A plain scalar in BLOCK context may not contain ': ' and may not end with
// ':', because either would start a mapping value — libyaml refuses both.
function assertNoMappingColon(scalar, line) {
  if (/:[\t ]/.test(scalar) || /:$/.test(scalar)) {
    throw new WorkflowYamlError('mapping values are not allowed here (a ": " inside an unquoted scalar)', line)
  }
}

export function parseWorkflowYaml(text) {
  return parseDocument(new Cursor(text))
}

function parseDocument(cursor) {
  // Directives and document markers at column 0. `--- content` puts the
  // document's first node on the marker line itself.
  for (;;) {
    const head = cursor.peek()
    if (!head || head.indent !== 0 || !isDocMarker(head.text)) break
    if (head.text.startsWith('--- ')) {
      cursor.lines[cursor.i] = '    ' + head.text.slice(4)
      break
    }
    cursor.i += 1
  }
  if (!cursor.peek()) return null
  const value = parseBlock(cursor, 0, -1)
  // Anything left must be document markers; other content is a refusal.
  for (;;) {
    const rest = cursor.peek()
    if (!rest) break
    if (rest.indent === 0 && isDocMarker(rest.text)) {
      if (rest.text.startsWith('--- ')) throw new WorkflowYamlError('content on a --- marker line is only valid at the start of a document', rest.line)
      cursor.i += 1
      continue
    }
    throw new WorkflowYamlError('could not parse this line inside the document (stray content after a completed node)', rest.line)
  }
  return value
}

function parseBlock(cursor, minIndent, contIndent) {
  const entry = cursor.peek()
  if (!entry || entry.indent < minIndent) return null
  if (isSeqEntry(entry.text)) return parseSequence(cursor, entry.indent)
  if (findKeyColon(entry.text, entry.line) !== null) return parseMapping(cursor, entry.indent)
  if (/^\?[\t ]/.test(entry.text) || entry.text === '?') return parseMapping(cursor, entry.indent)
  return parseScalarNode(cursor, entry, contIndent)
}

// A block value for a key (or a bare `-`) whose value starts on a later
// line: a block at deeper indent, or a sequence at the SAME indent as its
// key (`key:` then `- a`), else null.
function parseValueBlock(cursor, parentIndent) {
  const entry = cursor.peek()
  if (!entry) return null
  if (entry.indent > parentIndent) return parseBlock(cursor, entry.indent, parentIndent)
  if (entry.indent === parentIndent && isSeqEntry(entry.text)) return parseSequence(cursor, parentIndent)
  return null
}

function parseMapping(cursor, indent) {
  const map = {}
  const anchors = cursor.anchors ?? (cursor.anchors = new Map())
  for (;;) {
    const entry = cursor.peek()
    if (!entry || entry.indent < indent) break
    if (entry.indent === 0 && isDocMarker(entry.text)) break // parseDocument decides about markers
    if (entry.indent > indent) {
      throw new WorkflowYamlError(`bad indentation of a mapping entry (expected indent ${indent}, found ${entry.indent})`, entry.line)
    }
    if (isSeqEntry(entry.text)) {
      throw new WorkflowYamlError('a sequence entry appeared where a mapping key was expected (missing ":" on the line above, or a stray "- ")', entry.line)
    }
    let key, rest
    if (/^\?[\t ]?/.test(entry.text)) {
      // Complex key `? scalar` with the value on a following `:` line.
      key = entry.text.replace(/^\?[\t ]?/, '').trim() || null
      cursor.i += 1
      const colonLine = cursor.peek()
      if (!colonLine || colonLine.indent !== indent || !/^:[\t ]?/.test(colonLine.text)) {
        throw new WorkflowYamlError('a complex key (`? ...`) needs a `:` value line at the same indent', entry.line)
      }
      rest = colonLine.text.replace(/^:[\t ]?/, '')
    } else {
      const split = findKeyColon(entry.text, entry.line)
      if (!split) throw new WorkflowYamlError('could not find expected ":" while parsing a mapping entry', entry.line)
      key = unquoteKey(entry.text.slice(0, split.keyEnd).trim(), entry.line)
      rest = split.rest
    }
    // Anchors and tags on the value.
    let anchor = null
    for (;;) {
      const token = /^([&!][^\s]*)\s*/.exec(rest)
      if (!token) break
      if (token[1][0] === '&') anchor = token[1].slice(1)
      rest = rest.slice(token[0].length)
    }
    let value
    const lineOfEntry = entry.line
    if (rest === '' || rest.startsWith('#')) {
      cursor.i += 1
      value = parseValueBlock(cursor, indent)
    } else if (rest[0] === '|' || rest[0] === '>') {
      value = parseBlockScalar(cursor, rest, indent, lineOfEntry)
    } else if (rest[0] === '[' || rest[0] === '{') {
      value = parseFlowValue(cursor, rest, lineOfEntry)
    } else if (rest[0] === '*') {
      const name = stripPlainComment(rest.slice(1)).trim()
      if (!REF_NAME.test(name)) throw new WorkflowYamlError(`unreadable alias: ${rest}`, lineOfEntry)
      if (!anchors.has(name)) throw new WorkflowYamlError(`found undefined alias ${name}`, lineOfEntry)
      value = anchors.get(name)
      cursor.i += 1
    } else if (rest[0] === "'" || rest[0] === '"') {
      value = parseQuotedValue(cursor, rest, indent, lineOfEntry)
    } else {
      value = parsePlainValue(cursor, rest, indent, lineOfEntry)
    }
    if (anchor) anchors.set(anchor, value)
    map[key] = value
  }
  return map
}

function parseSequence(cursor, indent) {
  const list = []
  for (;;) {
    const entry = cursor.peek()
    if (!entry || entry.indent < indent) break
    if (entry.indent === 0 && isDocMarker(entry.text)) break
    if (entry.indent > indent) {
      throw new WorkflowYamlError(`bad indentation of a sequence entry (expected indent ${indent}, found ${entry.indent})`, entry.line)
    }
    if (!isSeqEntry(entry.text)) break // e.g. mapping keys resume at this indent
    if (/^-[\t ]*$/.test(entry.text)) {
      cursor.i += 1
      const nested = cursor.peek()
      list.push(nested && nested.indent > indent ? parseBlock(cursor, nested.indent, indent) : null)
      continue
    }
    const after = /^-[\t ]+/.exec(entry.text)[0]
    const content = entry.text.slice(after.length)
    const contentIndent = entry.indent + after.length
    if (content === '' || content.startsWith('#')) {
      cursor.i += 1
      const nested = cursor.peek()
      list.push(nested && nested.indent > indent ? parseBlock(cursor, nested.indent, indent) : null)
      continue
    }
    if (content[0] === '|' || content[0] === '>') {
      list.push(parseBlockScalar(cursor, content, indent, entry.line))
      continue
    }
    // Rewrite the line as if the dash were spaces, so the item parses as an
    // ordinary node whose first line is this one.
    cursor.lines[cursor.i] = ' '.repeat(contentIndent) + content
    list.push(parseBlock(cursor, contentIndent, indent))
  }
  return list
}

function parseBlockScalar(cursor, header, parentIndent, line) {
  if (!BLOCK_SCALAR_HEADER.test(header)) {
    throw new WorkflowYamlError(`did not find a valid block scalar indicator: ${header.split(/\s/)[0]}`, line)
  }
  cursor.i += 1
  // Content indent: the first non-blank following line's indent (an explicit
  // digit indicator is a minimum, never a refusal when content is deeper).
  let contentIndent = null
  let j = cursor.i
  while (j < cursor.lines.length) {
    const raw = cursor.lines[j]
    if (raw.trim() === '') { j += 1; continue }
    const ind = /^ */.exec(raw)[0].length
    if (ind <= parentIndent) break
    contentIndent = ind
    break
  }
  const collected = []
  while (cursor.i < cursor.lines.length) {
    const raw = cursor.lines[cursor.i]
    if (raw.trim() === '') { collected.push(''); cursor.i += 1; continue }
    const ind = /^ */.exec(raw)[0].length
    if (contentIndent === null || ind < contentIndent) break
    if (/^[\t ]*\t/.test(raw)) {
      throw new WorkflowYamlError('found a tab character in block scalar indentation', cursor.i + 1)
    }
    collected.push(raw.slice(contentIndent))
    cursor.i += 1
  }
  while (collected.length && collected.at(-1) === '') collected.pop()
  // Folding (>) and chomping indicators change the VALUE, not the validity;
  // an approximate join is sufficient for a structure guard.
  return header[0] === '|' ? collected.join('\n') : collected.join(' ')
}

// A quoted scalar value; may continue on following lines until the closing
// quote. Anything after the closing quote must be empty or a comment.
function parseQuotedValue(cursor, rest, contIndent, line) {
  const quote = rest[0]
  let s = rest.slice(1)
  let lineIndex = cursor.i
  let body = ''
  for (;;) {
    let k = 0
    // eslint-disable-next-line no-labels
    scan: while (k < s.length) {
      const ch = s[k]
      if (quote === "'") {
        if (ch === "'" && s[k + 1] === "'") { body += "'"; k += 2; continue }
        if (ch === "'") break scan
        body += ch; k += 1; continue
      }
      if (ch === '\\' && k + 1 < s.length) { body += ch + s[k + 1]; k += 2; continue }
      if (ch === '"') break scan
      body += ch; k += 1
    }
    // eslint-disable-next-line no-labels
    if (k < s.length && s[k] === quote) {
      const tail = s.slice(k + 1).trim()
      if (tail !== '' && !tail.startsWith('#')) {
        throw new WorkflowYamlError(`found content after the closing quote: ${tail.split(/\s/)[0]}`, lineIndex + 1)
      }
      cursor.i = lineIndex + 1
      return quote === "'" ? body : unescapeDouble(body, line)
    }
    // Continue onto the next line (folding).
    lineIndex += 1
    if (lineIndex >= cursor.lines.length) {
      throw new WorkflowYamlError('found unexpected end of stream while scanning a quoted scalar (unterminated quote)', line)
    }
    const next = cursor.lines[lineIndex]
    if (next.trim() === '') { body += '\n'; s = ''; continue }
    const ind = /^ */.exec(next)[0].length
    if (ind <= contIndent) {
      throw new WorkflowYamlError('found unexpected end of stream while scanning a quoted scalar (unterminated quote)', line)
    }
    body += ' '
    s = next.trim()
  }
}

function unescapeDouble(body, line) {
  let out = '', k = 0
  const map = { n: '\n', t: '\t', r: '\r', '0': '\0', '"': '"', '\\': '\\', '/': '/', ' ': ' ', a: '\x07', b: '\b', e: '\x1b', f: '\f' }
  while (k < body.length) {
    const ch = body[k]
    if (ch !== '\\') { out += ch; k += 1; continue }
    const esc = body[k + 1]
    if (esc in map) { out += map[esc]; k += 2; continue }
    if (esc === 'x' && /^[0-9a-fA-F]{2}/.test(body.slice(k + 2))) { out += String.fromCharCode(parseInt(body.slice(k + 2, k + 4), 16)); k += 4; continue }
    if (esc === 'u' && /^[0-9a-fA-F]{4}/.test(body.slice(k + 2))) { out += String.fromCharCode(parseInt(body.slice(k + 2, k + 6), 16)); k += 6; continue }
    // Unknown escapes are kept verbatim; validity is unaffected.
    out += ch + (esc ?? ''); k += 2
  }
  void line
  return out
}

function unquoteKey(token, line) {
  if (token[0] === "'") {
    if (!token.endsWith("'") || token.length < 2) throw new WorkflowYamlError('unterminated single-quoted key', line)
    return token.slice(1, -1).replace(/''/g, "'")
  }
  if (token[0] === '"') {
    if (!token.endsWith('"') || token.length < 2) throw new WorkflowYamlError('unterminated double-quoted key', line)
    return unescapeDouble(token.slice(1, -1), line)
  }
  return token
}

// A plain scalar value, possibly folded across following lines that are more
// indented than contIndent (the key's or the dash's indent). Continuation
// lines containing ': ' or a sequence dash are refusals, matching libyaml.
function parsePlainValue(cursor, rest, contIndent, line) {
  const first = stripPlainComment(rest)
  assertNoMappingColon(first, line)
  const parts = [first]
  cursor.i += 1
  for (;;) {
    let j = cursor.i
    while (j < cursor.lines.length && cursor.lines[j].trim() === '') j += 1
    if (j >= cursor.lines.length) break
    const raw = cursor.lines[j]
    const ind = /^ */.exec(raw)[0].length
    const text = raw.slice(ind)
    if (text.startsWith('#')) break
    if (ind <= contIndent) break
    if (isSeqEntry(text)) {
      throw new WorkflowYamlError('bad indentation of a sequence entry inside a plain scalar', j + 1)
    }
    const piece = stripPlainComment(text)
    assertNoMappingColon(piece, j + 1)
    parts.push(piece)
    cursor.i = j + 1
  }
  return parts.join(' ')
}

function parseScalarNode(cursor, entry, contIndent) {
  const text = entry.text
  if (text[0] === "'" || text[0] === '"') return parseQuotedValue(cursor, text, contIndent, entry.line)
  if (text[0] === '[' || text[0] === '{') return parseFlowValue(cursor, text, entry.line)
  return parsePlainValue(cursor, text, contIndent, entry.line)
}

// ---------------------------------------------------------------------------
// Flow collections ([], {}), possibly spanning lines. The scanner gathers
// text until brackets balance, then a recursive descent parses it.
// ---------------------------------------------------------------------------

function gatherFlow(cursor, rest, line) {
  let text = rest
  let closingLine = cursor.i
  for (;;) {
    let depth = 0, quote = null, closed = false, afterClose = ''
    for (let k = 0; k < text.length; k += 1) {
      const ch = text[k]
      if (quote) {
        if (quote === "'" && ch === "'" && text[k + 1] === "'") { k += 1; continue }
        if (ch === quote) quote = null
        continue
      }
      if (ch === "'" || ch === '"') { quote = ch; continue }
      if (ch === '[' || ch === '{') depth += 1
      else if (ch === ']' || ch === '}') {
        depth -= 1
        if (depth === 0) {
          afterClose = text.slice(k + 1).trim()
          closed = true
          break
        }
        if (depth < 0) throw new WorkflowYamlError(`found an unbalanced "${ch}" while parsing a flow collection`, line)
      }
    }
    if (quote) throw new WorkflowYamlError('found unexpected end of line while scanning a quoted scalar inside a flow collection', line)
    if (closed) {
      if (afterClose !== '' && !afterClose.startsWith('#')) {
        throw new WorkflowYamlError(`found content after the flow collection: ${afterClose.split(/\s/)[0]}`, line)
      }
      cursor.i = closingLine + 1
      return text
    }
    closingLine += 1
    if (closingLine >= cursor.lines.length) {
      throw new WorkflowYamlError('did not find the end of a flow collection ("[" or "{" never closed)', line)
    }
    text += '\n' + cursor.lines[closingLine].trim()
  }
}

function parseFlowValue(cursor, rest, line) {
  const text = gatherFlow(cursor, rest, line)
  const parser = { s: text, pos: 0 }
  const value = flowValue(parser, line)
  flowSkipWs(parser)
  if (parser.pos !== parser.s.length) {
    throw new WorkflowYamlError(`could not parse the remainder of a flow collection: ${parser.s.slice(parser.pos).slice(0, 30)}`, line)
  }
  return value
}

function flowSkipWs(p) { while (p.pos < p.s.length && /[\s]/.test(p.s[p.pos])) p.pos += 1 }

function flowValue(p, line) {
  flowSkipWs(p)
  if (p.pos >= p.s.length) return null
  const ch = p.s[p.pos]
  if (ch === '[') return flowSeq(p, line)
  if (ch === '{') return flowMap(p, line)
  if (ch === ']' || ch === '}' || ch === ',') return null
  if (ch === "'" || ch === '"') return flowQuoted(p, line)
  return flowPlain(p, line)
}

function flowSeq(p, line) {
  p.pos += 1
  const out = []
  for (;;) {
    flowSkipWs(p)
    if (p.pos >= p.s.length) throw new WorkflowYamlError('did not find expected "]"', line)
    if (p.s[p.pos] === ']') { p.pos += 1; return out }
    const entryValue = flowValue(p, line)
    flowSkipWs(p)
    // `[key: value]` is a single-pair mapping inside a flow sequence. A ':'
    // here is always a separator: flowPlain only stops at a colon followed
    // by a space or a flow indicator, and a glued colon (`a:b`) was already
    // consumed as scalar content.
    if (p.s[p.pos] === ':') {
      p.pos += 1
      const pairValue = flowValue(p, line)
      flowSkipWs(p)
      out.push({ [String(entryValue)]: pairValue })
    } else {
      out.push(entryValue)
    }
    if (p.s[p.pos] === ',') { p.pos += 1; continue }
    if (p.s[p.pos] === ']') { p.pos += 1; return out }
    throw new WorkflowYamlError(`did not find expected "," or "]" (found ${JSON.stringify(p.s[p.pos])})`, line)
  }
}

function flowMap(p, line) {
  p.pos += 1
  const out = {}
  for (;;) {
    flowSkipWs(p)
    if (p.pos >= p.s.length) throw new WorkflowYamlError('did not find expected "}"', line)
    if (p.s[p.pos] === '}') { p.pos += 1; return out }
    let key
    if (p.s[p.pos] === "'" || p.s[p.pos] === '"') key = flowQuoted(p, line)
    else key = flowPlainKey(p, line)
    flowSkipWs(p)
    let value = null
    if (p.s[p.pos] === ':') {
      p.pos += 1
      value = flowValue(p, line)
      flowSkipWs(p)
    }
    out[key] = value
    if (p.s[p.pos] === ',') { p.pos += 1; continue }
    if (p.s[p.pos] === '}') { p.pos += 1; return out }
    throw new WorkflowYamlError(`did not find expected "," or "}" (found ${JSON.stringify(p.s[p.pos])})`, line)
  }
}

function flowQuoted(p, line) {
  const quote = p.s[p.pos]
  p.pos += 1
  let out = ''
  while (p.pos < p.s.length) {
    const ch = p.s[p.pos]
    if (quote === "'") {
      if (ch === "'" && p.s[p.pos + 1] === "'") { out += "'"; p.pos += 2; continue }
      if (ch === "'") { p.pos += 1; return out }
      out += ch; p.pos += 1; continue
    }
    if (ch === '\\' && p.pos + 1 < p.s.length) { out += ch + p.s[p.pos + 1]; p.pos += 2; continue }
    if (ch === '"') { p.pos += 1; return out }
    out += ch; p.pos += 1
  }
  throw new WorkflowYamlError('found unexpected end of flow collection while scanning a quoted scalar', line)
}

// Plain scalar in flow context: ends at , ] } or at ':' followed by a space,
// a flow indicator or the end — so `x:y` stays one token, `{b: c}` splits.
function flowPlain(p, line) {
  const start = p.pos
  while (p.pos < p.s.length) {
    const ch = p.s[p.pos]
    if (ch === ',' || ch === ']' || ch === '}') break
    if (ch === ':') {
      const next = p.s[p.pos + 1]
      if (next === undefined || next === ' ' || next === '\t' || next === '\n' || next === ',' || next === ']' || next === '}') break
    }
    p.pos += 1
  }
  const raw = p.s.slice(start, p.pos).replace(/[\s]+$/, '')
  if (raw !== '' && /:[\t ]|:$/.test(raw.trim())) {
    throw new WorkflowYamlError('mapping values are not allowed here (a ": " inside an unquoted flow scalar)', line)
  }
  return raw === '' ? null : raw
}

function flowPlainKey(p, line) {
  const value = flowPlain(p, line)
  if (value === null) throw new WorkflowYamlError('expected a key in a flow mapping', line)
  return value
}

// ---------------------------------------------------------------------------
// Guard entry points.
// ---------------------------------------------------------------------------

export function checkWorkflowText(name, text) {
  const problems = []
  for (const marker of findConflictMarkers(text)) {
    problems.push({ file: name, line: marker.line, message: `conflict marker ${marker.description} at column 0: ${marker.raw.slice(0, 40)}` })
  }
  try {
    parseWorkflowYaml(text)
  } catch (error) {
    if (!(error instanceof WorkflowYamlError)) throw error
    problems.push({ file: name, line: error.line ?? 0, message: error.message })
  }
  return problems
}

export function listWorkflowFiles(dir) {
  return fs.readdirSync(dir)
    .filter((f) => f.endsWith('.yml') || f.endsWith('.yaml'))
    .sort()
}

export function checkWorkflowDirectory(dir) {
  const files = listWorkflowFiles(dir)
  if (files.length === 0) {
    return { ok: false, files: [], problems: [{ file: dir, line: 0, message: `no *.yml or *.yaml files found under ${dir} — a vacuous pass is refused (deleted or unreadable workflow directory?)` }] }
  }
  const problems = []
  for (const file of files) {
    const full = path.join(dir, file)
    let text
    try {
      text = fs.readFileSync(full, 'utf8')
    } catch (error) {
      problems.push({ file, line: 0, message: `could not read the file: ${error.message}` })
      continue
    }
    problems.push(...checkWorkflowText(file, text))
  }
  return { ok: problems.length === 0, files, problems }
}

const HERE = path.dirname(fileURLToPath(import.meta.url))
const DEFAULT_DIR = path.resolve(HERE, '..', '.github', 'workflows')

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const argv = process.argv.slice(2)
  if (argv.some((a) => a === '--help' || a === '-h')) {
    console.log('usage: node scripts/check-workflow-yaml.mjs [directory]')
    process.exit(0)
  }
  const dir = argv.find((a) => !a.startsWith('--')) ?? DEFAULT_DIR
  let result
  try {
    result = checkWorkflowDirectory(dir)
  } catch (error) {
    console.error(`workflow YAML guard: ${dir}: ${error.message}`)
    process.exit(1)
  }
  if (!result.ok) {
    console.error('WORKFLOW YAML GUARD REFUSED:')
    for (const problem of result.problems) {
      console.error(`  ${problem.file}${problem.line ? `:${problem.line}` : ''}: ${problem.message}`)
    }
    process.exit(1)
  }
  console.log(`OK: ${result.files.length} workflow YAML file${result.files.length === 1 ? '' : 's'} parse clean with no conflict markers (${dir})`)
}
