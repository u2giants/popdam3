#!/usr/bin/env node
// #6574 follow-up: static lint for two PL/pgSQL mistakes that shipped in
// 20261117020001 / 20261117120000 / 20261118020001 and had to be reissued as
// 20261204000000 / 000100 / 000200:
//   1. a `for <rec> in select ... as v(...) loop` body that references the
//      VALUES/subquery alias (`v.col`) instead of the loop record (`rec.col`);
//      the alias is out of scope inside the loop and fails at run time.
//   2. `(select array_agg(...attname...) ...) = <text array>` without a
//      `::name[]` cast; name[] = text[] has no operator and fails at run time.
// Usage: node scripts/lint-plpgsql-migrations.mjs <file.sql>...
// Prints one `file:line: message` per finding; exits 1 when any were found.
// check-sql.sh runs it over the migrations a branch ADDS, as an advisory.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const KEYWORDS = new Set(['select', 'from', 'where', 'loop', 'values', 'join', 'on', 'and', 'or', 'with', 'ordinality', 'lateral', 'as'])

function stripComments(sql) {
  // Keep offsets/line numbers stable: blank out comment characters.
  return sql
    .replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, ' '))
    .replace(/--[^\n]*/g, m => ' '.repeat(m.length))
}

function lineOf(text, index) {
  return text.slice(0, index).split('\n').length
}

function loopBodyEnd(text, start) {
  const re = /\bend\s+loop\b|\bloop\b/gi
  re.lastIndex = start
  let depth = 1
  let m
  while ((m = re.exec(text))) {
    if (/^end/i.test(m[0])) depth -= 1
    else depth += 1
    if (depth === 0) return m.index
  }
  return text.length
}

function definedAliases(segment) {
  const out = new Set()
  for (const m of segment.matchAll(/\)\s*(?:as\s+)?([a-z_][a-z0-9_]*)\s*\(/gi)) out.add(m[1].toLowerCase())
  for (const m of segment.matchAll(/\)\s*as\s+([a-z_][a-z0-9_]*)\b/gi)) out.add(m[1].toLowerCase())
  for (const m of segment.matchAll(/\bas\s+([a-z_][a-z0-9_]*)\s*\(/gi)) out.add(m[1].toLowerCase())
  for (const k of KEYWORDS) out.delete(k)
  return out
}

function bodyAliases(body) {
  // Aliases (re)defined inside the body itself are legitimately in scope there.
  const out = definedAliases(body)
  for (const m of body.matchAll(/\b(?:from|join)\s+(?:[a-z_][a-z0-9_]*\.)?[a-z_][a-z0-9_]*\s+(?:as\s+)?([a-z_][a-z0-9_]*)\b/gi)) out.add(m[1].toLowerCase())
  return out
}

export function lintSql(sql) {
  const text = stripComments(sql)
  const findings = []
  for (const m of text.matchAll(/\bfor\s+([a-z_][a-z0-9_]*)\s+in\b(?!\s+(?:reverse\b|-?\d))/gi)) {
    const rec = m[1].toLowerCase()
    const queryStart = m.index + m[0].length
    const loopRe = /\bloop\b/gi
    loopRe.lastIndex = queryStart
    const loopMatch = loopRe.exec(text)
    if (!loopMatch) continue
    const query = text.slice(queryStart, loopMatch.index)
    const aliases = definedAliases(query)
    aliases.delete(rec)
    if (aliases.size === 0) continue
    const bodyStart = loopMatch.index + loopMatch[0].length
    const body = text.slice(bodyStart, loopBodyEnd(text, bodyStart))
    const inner = bodyAliases(body)
    for (const alias of aliases) {
      if (inner.has(alias)) continue
      const ref = new RegExp(`\\b${alias}\\.[a-z_]`, 'i').exec(body)
      if (ref) {
        findings.push({
          line: lineOf(text, bodyStart + ref.index),
          message: `loop body references query alias "${alias}." which is out of scope inside "for ${rec} in ... loop"; use "${rec}." instead`,
        })
      }
    }
  }
  for (const m of text.matchAll(/\barray_agg\s*\(/gi)) {
    // Walk to the close of array_agg(...).
    let i = m.index + m[0].length
    let depth = 1
    while (i < text.length && depth > 0) {
      if (text[i] === '(') depth += 1
      else if (text[i] === ')') depth -= 1
      i += 1
    }
    const arg = text.slice(m.index + m[0].length, i - 1)
    if (!/\battname\b/i.test(arg) || /::\s*(?:text|varchar|character varying)\b/i.test(arg)) continue
    // Find the close of the enclosing scalar subquery, then the comparison.
    depth = 1
    while (i < text.length && depth > 0) {
      if (text[i] === '(') depth += 1
      else if (text[i] === ')') depth -= 1
      if (text[i] === ';') break
      i += 1
    }
    if (depth !== 0) continue
    const tail = text.slice(i)
    const cmp = /^\s*(?:::\s*name\s*\[\]\s*)?(=|<>|!=|@>|<@)\s*/.exec(tail)
    if (!cmp) continue
    if (/^\s*::\s*name\s*\[\]/i.test(tail)) continue
    const rhs = /^[^\n;]*/.exec(tail.slice(cmp[0].length))[0]
    // Allow a cast on the right-hand side, before any boolean connective.
    const operand = rhs.split(/\b(?:and|or|then)\b/i)[0]
    if (/::\s*name\s*\[\]/i.test(operand)) continue
    findings.push({
      line: lineOf(text, i + cmp.index),
      message: 'array_agg(...attname...) yields name[]; compare it to "::name[]" explicitly (name[] = text[] has no operator)',
    })
  }
  return findings.sort((a, b) => a.line - b.line)
}

export function lintFiles(files) {
  const out = []
  for (const file of files) {
    for (const f of lintSql(fs.readFileSync(file, 'utf8'))) out.push({ file, ...f })
  }
  return out
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const findings = lintFiles(process.argv.slice(2))
  for (const f of findings) console.log(`${f.file}:${f.line}: ${f.message}`)
  process.exit(findings.length ? 1 : 0)
}
