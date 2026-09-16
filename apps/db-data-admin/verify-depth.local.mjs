// Visual + behavioural verification of the Product Depth grid against PREVIEW
// rjyboqwcdzcocqgmsyel. The tester password is injected by `op run` and never printed.
// Local-only helper; not committed (see .gitignore entry verify-depth.local.mjs).
import { chromium } from '@playwright/test'

const BASE = process.env.BASE_URL ?? 'http://localhost:5177'
const OUT = process.env.OUT_DIR ?? '.'
const user = process.env.DDA_USER
const pass = process.env.DDA_PASS
if (!user || !pass) { console.error('missing credentials in env'); process.exit(2) }

// A FRESH code every run. The first version of this script used a fixed
// 'ZZ-B8-VERIFY', which worked exactly once: the row it adds is never deleted
// (this screen deactivates, it does not delete), so every later run hit the
// duplicate-code guard on the add step and stalled with the drawer still open.
// The fixed code is kept below purely to prove that guard still fires.
const RUN_ID = new Date().toISOString().replace(/[-:T.]/g, '').slice(0, 14)
const TEST_CODE = `ZZ-B8-${RUN_ID}`
const DUPLICATE_PROBE_CODE = 'ZZ-B8-VERIFY'
const TEST_LABEL = 'B8 verification value'
const TEST_LABEL_2 = 'B8 verification value (renamed)'

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
const log = []
page.on('console', m => log.push(`[console.${m.type()}] ${m.text()}`))

const codeBox = () => page.getByRole('textbox', { name: 'Code', exact: true })
const labelBox = () => page.getByRole('textbox', { name: 'Label', exact: true })
const reasonBox = () => page.getByRole('textbox', { name: /Reason/i })
const footer = async () => (await page.locator('.grid-footer').first().innerText()).replace(/\n/g, ' ')
// RevoGrid renders the row-header pin element first and it is invisible, so
// .first() never resolves to a clickable cell. The repo's own browser tests
// (tests/browser/grid.spec.ts) select a row by its visible cell text instead.
const selectTestRow = async () => { await page.getByText(TEST_CODE, { exact: true }).first().click(); }
const banner = async (sel) => await page.locator(sel).first().innerText().catch(() => '(none)')

await page.goto(BASE, { waitUntil: 'networkidle' })
await page.getByRole('textbox').first().fill(user)
await page.locator('input[type=password]').fill(pass)
await page.getByRole('button', { name: /Sign in with email/i }).click()
await page.waitForSelector('nav.tabs', { timeout: 30000 })
await page.screenshot({ path: `${OUT}/01-signed-in.png` })

await page.getByRole('button', { name: 'Product Depth', exact: true }).click()
await page.waitForSelector('.grid-footer', { timeout: 30000 })
await page.waitForTimeout(2500)
await page.screenshot({ path: `${OUT}/02-product-depth-grid.png` })
console.log('BASELINE FOOTER:', await footer())
console.log('ACCESS_DENIED_PANEL:', await page.locator('.access-denied').count())

// --- 1. reason guard fires before any RPC -------------------------------------
await page.getByRole('button', { name: /Add depth value/i }).click()
await page.waitForTimeout(400)
await codeBox().fill(TEST_CODE)
await labelBox().fill(TEST_LABEL)
await page.screenshot({ path: `${OUT}/03-add-form.png` })
await page.getByRole('button', { name: /Add value/i }).click()
await page.waitForTimeout(700)
console.log('REASON_GUARD:', await banner('.inline-error'))
await page.screenshot({ path: `${OUT}/04-reason-required.png` })

// --- 1b. duplicate-code guard fires (uses the row left by an earlier run) ------
await reasonBox().fill('B8 UI verification: prove duplicate guard')
await codeBox().fill(DUPLICATE_PROBE_CODE)
await page.getByRole('button', { name: /Add value/i }).click()
await page.waitForTimeout(1500)
console.log('DUPLICATE_GUARD:', await banner('.inline-error'))
await page.screenshot({ path: `${OUT}/04b-duplicate-guard.png` })
await codeBox().fill(TEST_CODE)

// --- 2. ADD --------------------------------------------------------------------
await reasonBox().fill('B8 UI verification: prove add path')
await page.getByRole('button', { name: /Add value/i }).click()
await page.waitForTimeout(3000)
console.log('AFTER ADD notice:', await banner('.inline-edit-message'))
console.log('AFTER ADD error :', await banner('.inline-error'))
console.log('AFTER ADD FOOTER:', await footer())
await page.screenshot({ path: `${OUT}/05-after-add.png` })

// --- 3. RENAME -----------------------------------------------------------------
// The per-column "Filter Code" textbox only exists once its funnel is opened;
// the always-present search box narrows the grid just as well.
await page.getByPlaceholder('Search depth values').fill(TEST_CODE)
await page.waitForTimeout(1200)
await selectTestRow()
await page.waitForTimeout(900)
await page.screenshot({ path: `${OUT}/06-row-selected.png` })
await labelBox().fill(TEST_LABEL_2)
await reasonBox().fill('B8 UI verification: prove rename path')
await page.getByRole('button', { name: /Save changes/i }).click()
await page.waitForTimeout(3000)
console.log('AFTER RENAME notice:', await banner('.inline-edit-message'))
console.log('AFTER RENAME error :', await banner('.inline-error'))
await page.screenshot({ path: `${OUT}/07-after-rename.png` })

// --- 4. DEACTIVATE -------------------------------------------------------------
await selectTestRow()
await page.waitForTimeout(900)
await reasonBox().fill('B8 UI verification: prove deactivate path')
await page.getByRole('button', { name: /Deactivate/i }).click()
await page.waitForTimeout(3000)
console.log('AFTER DEACTIVATE notice:', await banner('.inline-edit-message'))
console.log('AFTER DEACTIVATE error :', await banner('.inline-error'))
await page.screenshot({ path: `${OUT}/08-after-deactivate.png` })

// --- 5. REACTIVATE then leave it inactive --------------------------------------
await selectTestRow()
await page.waitForTimeout(900)
await reasonBox().fill('B8 UI verification: prove activate path')
const activate = page.getByRole('button', { name: /^Activate$/i })
if (await activate.count()) {
  await activate.click()
  await page.waitForTimeout(3000)
  console.log('AFTER ACTIVATE notice:', await banner('.inline-edit-message'))
  await page.screenshot({ path: `${OUT}/09-after-activate.png` })
  // Leave the verification row INACTIVE so it can never be offered in a picker.
  await selectTestRow()
  await page.waitForTimeout(900)
  await reasonBox().fill('B8 UI verification: leave verification row retired')
  await page.getByRole('button', { name: /Deactivate/i }).click()
  await page.waitForTimeout(3000)
  console.log('FINAL notice:', await banner('.inline-edit-message'))
  await page.screenshot({ path: `${OUT}/10-final-inactive.png` })
} else {
  console.log('ACTIVATE BUTTON NOT FOUND — status did not flip to inactive')
}

console.log('FINAL FOOTER:', await footer())
console.log('--- console ---')
for (const line of log.slice(0, 40)) console.log(line)
await browser.close()
