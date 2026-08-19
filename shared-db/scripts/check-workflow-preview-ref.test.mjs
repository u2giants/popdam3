// Guard: no workflow may PIN itself to a preview Supabase project ref.
//
// The preview branch is rebuilt from time to time and its project ref CHANGES
// when it is. On 2026-08-18 `rjyboqwcdzcocqgmsyel` was deleted and replaced.
// Five workflows had the old ref baked in as an env value, and three of them
// asserted equality against that same literal, so they were pinned to a
// database that no longer exists and could only fail. The ref must come from
// the repository variable PREVIEW_PROJECT_REF, and an unset value must be
// REFUSED rather than defaulted (AGENTS.md rule 2).
//
// Run: node --test scripts/check-workflow-preview-ref.test.mjs
import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync, readdirSync} from 'node:fs'
import path from 'node:path'

const DIR = path.join(process.cwd(), '.github', 'workflows')
const FILES = readdirSync(DIR).filter((f) => f.endsWith('.yml') || f.endsWith('.yaml'))
const PROJECT_REF = /^[a-z]{20}$/
const PRODUCTION_REF = 'qsllyeztdwjgirsysgai'

// Strip full-line and trailing comments: prose ABOUT the deleted ref is fine,
// an executable reference to it is not.
const codeLines = (text) =>
  text.split(/\r?\n/).map((line, i) => [i + 1, line.replace(/(^|\s)#.*$/, '')])

test('there is at least one workflow to check', () => {
  assert.ok(FILES.length > 0, 'no workflow files found; this guard would pass vacuously')
})

for (const file of FILES) {
  const text = readFileSync(path.join(DIR, file), 'utf8')
  const lines = codeLines(text)

  test(`${file}: PREVIEW_PROJECT_REF is configured, never a literal`, () => {
    const assignments = lines.filter(([, l]) => /(^|\s)(PREVIEW_PROJECT_REF|EXPECTED_PROJECT_REF):/.test(l))
    for (const [n, line] of assignments) {
      const value = line.slice(line.indexOf(':') + 1).trim().replace(/^["']|["']$/g, '')
      if (value === '' || value.startsWith('$')) continue // empty maps and shell/step wiring
      // Production is deliberately pinned: it never changes and lanes assert it.
      if (value === PRODUCTION_REF) continue
      assert.ok(
        !PROJECT_REF.test(value),
        `${file}:${n} pins a preview project ref literal (${value}). ` +
          'Read the repository variable PREVIEW_PROJECT_REF instead.',
      )
      assert.ok(
        value.includes('vars.PREVIEW_PROJECT_REF'),
        `${file}:${n} sets a preview ref from something other than vars.PREVIEW_PROJECT_REF: ${value}`,
      )
    }
  })

  test(`${file}: no executable use of the deleted preview ref`, () => {
    for (const [n, line] of lines) {
      assert.ok(
        !line.includes('rjyboqwcdzcocqgmsyel'),
        `${file}:${n} still references the preview project deleted on 2026-08-18.`,
      )
    }
  })

  test(`${file}: a workflow that reads the preview ref refuses an unset one`, () => {
    if (!text.includes('vars.PREVIEW_PROJECT_REF')) return
    assert.match(
      text,
      /-z "\$\{PREVIEW_PROJECT_REF\/\/ \/\}"/,
      `${file} reads PREVIEW_PROJECT_REF but never refuses an unset value; an unset ref must never be treated as a default.`,
    )
  })
}
