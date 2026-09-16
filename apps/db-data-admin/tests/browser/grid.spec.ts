import { expect, test, type Page, type Route } from '@playwright/test'

const customers = [
  { id: '11111111-1111-1111-1111-111111111111', display_name: 'Acme Retail', status: 'active', crm_status: 'active', pm_status: 'active', dam_status: 'inactive', plm_status: 'ACTIVE', erp_active: true, alias_count: 2, updated_at: '2026-07-22T12:00:00Z' },
  { id: '22222222-2222-2222-2222-222222222222', display_name: 'Northwind Stores', status: 'active', crm_status: 'active', pm_status: 'inactive', dam_status: 'active', plm_status: null, erp_active: true, alias_count: 1, updated_at: '2026-07-21T12:00:00Z' },
  // The common shape in production: no curated display_name override, only the
  // canonical name. The Name column must still show it (regression: the column
  // read display_name directly and left these rows blank).
  { id: '55555555-5555-5555-5555-555555555555', name: 'Zeta Imports', display_name: null, status: 'active', crm_status: 'active', pm_status: 'active', dam_status: 'active', plm_status: null, erp_active: true, alias_count: 0, updated_at: '2026-07-19T12:00:00Z' },
]
const vendors = [{ id: '33333333-3333-3333-3333-333333333333', display_name: 'Atlas Manufacturing', status: 'active', crm_status: 'active', pm_status: 'active', dam_status: 'active', plm_status: null, erp_active: true, alias_count: 3, updated_at: '2026-07-20T12:00:00Z' }]
const scrapedProperties = [
  { row_key: 'disney-creative-1', entity_kind: 'property', licensor_key: 'disney', licensor_group_key: 'disney', licensor_group_name: 'Disney', licensor_name: 'Disney - Creative (DCP Vault)', source_purpose: 'Creative', display_label: 'Frozen', source_system: 'disney_dcpvault', source_table: 'plm.dcp_property', source_id: 'd-1', source_status: 'active', latest_seen_at: null, capture_marker: 'run-1', mapping_state: 'unmapped' },
  { row_key: 'disney-submissions-1', entity_kind: 'property', licensor_key: 'disney-opa', licensor_group_key: 'disney', licensor_group_name: 'Disney', licensor_name: 'Disney - Submissions (OPA)', source_purpose: 'Submissions', display_label: 'Frozen', source_system: 'disney_opa', source_table: 'plm.opa_property', source_id: 'opa-1', source_status: 'active', latest_seen_at: null, capture_marker: 'run-2', mapping_state: null },
  { row_key: 'marvel-creative-1', entity_kind: 'property', licensor_key: 'marvel-asgard-creative', licensor_group_key: 'marvel', licensor_group_name: 'Marvel', licensor_name: 'Marvel - Creative (ASGARD)', source_purpose: 'Creative', display_label: 'Lilo test fixture', source_system: 'marvel_asgard', source_table: 'plm.marvel_asgard_style_guide', source_id: 'm-1', source_status: 'active', latest_seen_at: null, capture_marker: 'run-3', mapping_state: 'mapped' },
  { row_key: 'star-wars-creative-1', entity_kind: 'property', licensor_key: 'lucasfilm-star-wars', licensor_group_key: 'lucasfilm-star-wars', licensor_group_name: 'Lucasfilm / Star Wars', licensor_name: 'Star Wars - Creative (DCP Vault)', source_purpose: 'Creative', display_label: 'The Mandalorian', source_system: 'lucasfilm_dcpvault', source_table: 'plm.lucasfilm_dcp_property', source_id: 'sw-1', source_status: 'active', latest_seen_at: null, capture_marker: 'run-4', mapping_state: 'unmapped' },
  { row_key: 'sega-creative-1', entity_kind: 'property', licensor_key: 'sega-creative', licensor_group_key: 'sega', licensor_group_name: 'Sega', licensor_name: 'Sega - Creative (DSI)', source_purpose: 'Creative', display_label: 'Sonic', source_system: 'sega_dsi', source_table: 'plm.sega_property', source_id: 'sega-1', source_status: 'active', latest_seen_at: null, capture_marker: 'run-5', mapping_state: 'unmapped' },
  { row_key: 'sega-submissions-1', entity_kind: 'property', licensor_key: 'sega-submissions', licensor_group_key: 'sega', licensor_group_name: 'Sega', licensor_name: 'Sega - Submissions (Product Approval)', source_purpose: 'Submissions', display_label: 'Sonic', source_system: 'sega_product_approval', source_table: 'plm.sega_submission_property', source_id: 'sega-1', source_status: 'active', latest_seen_at: null, capture_marker: 'run-6', mapping_state: null },
]
const scrapedCharacters = [{ ...scrapedProperties[0], row_key: 'character-1', entity_kind: 'character', display_label: 'Elsa', source_id: 'character-1', mapping_state: null }]
const scrapedStyleGuides = [{ ...scrapedProperties[0], row_key: 'guide-1', entity_kind: 'style_guide', display_label: 'Frozen Core Style Guide', source_id: 'guide-1', mapping_state: null }]

// Step 10 read-only Licensor -> Property tree fixture. The collide property
// carries mg_code "DNY" (Disney's code) but is parented to Marvel by its
// canonical licensor_id, proving the edge never comes from mg_code.
const licensorTree = {
  snapshot: { snapshot_at: '2026-07-22T12:00:00Z', store: 'core.licensor / core.property (Supabase canonical mirror)', source_system: 'designflow_plm', feeder_last_sync_at: '2026-07-08T03:30:00Z', feeder_last_run_status: 'succeeded', feeder_days_stale: 14, feeder_available: false, live_upstream_reconciliation: false, note: 'Snapshot of the canonical Supabase mirror. The edge is DesignFlow-owned and mirrored via core.property.licensor_id; never inferred from mgTypeCode or mg_code.' },
  reconciliation: { licensor_count: 3, active_licensor_count: 3, property_count: 4, active_property_count: 4, properties_with_licensor: 3, orphan_property_count: 1, expected_orphan_count_is_zero: false, partition_reconciles: true },
  licensors: [
    { id: '44444444-0001-4000-8000-000000000001', name: 'Marvel', code: 'MRV', status: 'active', property_count: 2, updated_at: '2026-07-22T10:00:00Z', source_refs: [{ source_system: 'designflow_plm', source_table: 'merchGroup', source_id: 'mg-mrv', source_code: 'MRV', source_name: 'Marvel' }], plm_context: [{ plm_id: 'li-cw', division_code: 'CW001', mg_code: 'MRV', mg_type: 'licensor', mg_category: 'licensed' }, { plm_id: 'li-sp', division_code: 'SP001', mg_code: 'MRV', mg_type: 'licensor', mg_category: 'licensed' }], properties: [
      { id: '44444444-0002-4000-8000-000000000002', name: 'Avengers', code: 'AVG', status: 'active', updated_at: '2026-07-22T10:00:00Z', character_count: 6, source_refs: [{ source_system: 'designflow_plm', source_table: 'merchGroup', source_id: 'mg-avg', source_code: 'AVG', source_name: 'Avengers' }], plm_context: [{ plm_id: 'pr-avg', division_code: '1', division_name: 'POP Lic', division_external_code: 'CW001', mg_code: 'AVG', mg_type: 'property', mg_category: 'licensed' }, { plm_id: 'pr-avg-sp', division_code: '8', division_name: 'Spruce Lic', division_external_code: 'SP001', mg_code: 'AVG', mg_type: 'property', mg_category: 'licensed' }] },
      { id: '44444444-0003-4000-8000-000000000003', name: 'Spider-Man', code: 'SPD', status: 'active', character_count: 2, source_refs: [], plm_context: [{ plm_id: 'pr-spd', division_code: 'CW001', mg_code: 'DNY', mg_type: 'property', mg_category: 'licensed' }] },
    ] },
    { id: '44444444-0004-4000-8000-000000000004', name: 'Disney', code: 'DNY', status: 'active', property_count: 1, updated_at: '2026-07-22T10:00:00Z', source_refs: [], plm_context: [{ plm_id: 'li-dny', division_code: 'CW001', mg_code: 'DNY', mg_type: 'licensor', mg_category: 'licensed' }], properties: [
      { id: '44444444-0005-4000-8000-000000000005', name: 'Frozen', code: 'FRZ', status: 'active', character_count: 0, source_refs: [], plm_context: [{ plm_id: 'pr-frz', division_code: 'CW001', mg_code: 'FRZ', mg_type: 'property', mg_category: 'licensed' }] },
    ] },
    { id: '44444444-0006-4000-8000-000000000006', name: 'Warner Bros', code: 'WB', status: 'inactive', property_count: 0, updated_at: '2026-07-22T10:00:00Z', source_refs: [], plm_context: [], properties: [] },
  ],
  orphan_properties: [
    { id: '44444444-0007-4000-8000-000000000007', name: 'Unassigned IP', code: 'UNA', status: 'active', licensor_id: null, character_count: 0, source_refs: [], plm_context: [] },
  ],
  next_cursor: null, page_size: 200,
}

async function mockAdmin(page: Page) {
  await page.addInitScript(() => localStorage.setItem('sb-preview-auth-token', JSON.stringify({ access_token: 'mock-token', refresh_token: 'mock-refresh', expires_at: 4102444800, expires_in: 3600, token_type: 'bearer', user: { id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', email: 'albert@popcre.com', aud: 'authenticated', role: 'authenticated', app_metadata: {}, user_metadata: {}, created_at: '2026-07-22T00:00:00Z' } })))
  await page.route('**/config.js', route => route.fulfill({ contentType: 'application/javascript', body: "window.__DB_DATA_ADMIN_CONFIG__={supabaseUrl:'https://preview.supabase.co',supabaseAnonKey:'mock-anon',authRedirectUrl:'http://127.0.0.1:4173'}" }))
  await page.route('https://preview.supabase.co/rest/v1/rpc/**', async (route: Route) => {
    const name = route.request().url().split('/').pop() ?? ''
    const body = route.request().postDataJSON() as Record<string, unknown> | null
    if (name === 'db_data_admin_channel_list') return route.fulfill({ json: [{ id: 'mass', name: 'Mass' }] })
    if (name === 'db_data_admin_grid_state_get') return route.fulfill({ json: null })
    if (name === 'db_data_admin_grid_state_upsert') return route.fulfill({ json: { version: 1 } })
    if (name === 'db_data_admin_audit_list') return route.fulfill({ json: { rows: [{ id: 'audit-1', action: 'update', reason: 'Curated correction', actor_label: 'Albert', occurred_at: '2026-07-22T12:30:00Z', succeeded: true }], next_cursor: null } })
    if (name === 'db_data_admin_update_customer') return route.fulfill({ json: { success: true, audit_id: 'audit-1', row: { ...customers[0], display_name: 'Acme Retail Group' } } })
    if (name === 'db_data_admin_update_vendor') return route.fulfill({ json: { success: true, audit_id: 'audit-2', row: vendors[0] } })
    if (name === 'db_data_admin_preview_customer_merge') return route.fulfill({ json: { success: true, preview_token: 'preview-token', preview: { entity_type: 'customer', survivor: customers[0], loser: customers[1], affected_counts: { 'core.company_source_ref.company_id': 3, 'crm.department.company_id': 2 }, conflicts: [{ key: 'crm.status', app: 'crm', field: 'status', survivor: 'active', loser: 'inactive' }], moving_aliases: [{ alias: 'Northwind Retail Co', alias_type: 'legacy', source_system: 'coldlion', origin: 'existing_alias' }, { alias: 'Northwind Stores', alias_type: 'merged_name', source_system: 'db_data_admin_merge', origin: 'loser_name' }], moving_source_refs: [{ source_system: 'coldlion', source_table: 'customers', source_id: 'C-201', source_code: 'NW-201', source_name: 'Northwind' }] } } })
    if (name === 'db_data_admin_merge_customer') return route.fulfill({ json: { success: true, audit_id: 'audit-merge', survivor: customers[0] } })
    if (name.endsWith('_detail')) return route.fulfill({ json: { id: body?.p_id, aliases: [{ alias: 'Legacy name', source_system: 'ERP' }], source_refs: [{ source_system: 'Coldlion', source_id: 'C-100' }] } })
    if (name === 'db_data_admin_customer_list') return route.fulfill({ json: { rows: customers, next_cursor: null, page_size: 200 } })
    if (name === 'db_data_admin_vendor_list') return route.fulfill({ json: { rows: vendors, next_cursor: null, page_size: 200 } })
    if (name === 'db_data_admin_licensor_property_tree') return route.fulfill({ json: licensorTree })
    if (name === 'db_data_admin_set_property_status') return route.fulfill({ json: { success: true, idempotent_replay: false } })
    if (name === 'db_data_admin_scraped_source_inventory') {
      const rows = body?.p_entity_kind === 'character' ? scrapedCharacters : body?.p_entity_kind === 'style_guide' ? scrapedStyleGuides : scrapedProperties
      return route.fulfill({ json: { rows, next_cursor: null, page_size: 1000 } })
    }
    return route.fulfill({ json: {} })
  })
}

test('renders persistent customer and vendor grids with lazy details', async ({ page }) => {
  await mockAdmin(page); await page.goto('/')
  await expect(page.getByRole('button', { name: 'Customers' })).toHaveClass(/active/)
  await expect(page.locator('revo-grid')).toBeVisible()
  await expect(page.getByText('Acme Retail')).toBeVisible()
  await page.getByText('Acme Retail').click()
  await expect(page.getByRole('complementary', { name: 'customer details' })).toContainText('Legacy name')
  await page.screenshot({ path: '../../docs/verification/db-data-admin-step8-detail-audit.png', fullPage: true })
  await page.getByRole('button', { name: 'Edit record' }).click()
  await expect(page.getByRole('dialog', { name: 'Edit Customer' })).toBeVisible()
  await page.getByLabel('Curated display name').fill('Acme Retail Group')
  await page.getByLabel('Reason').fill('Curated correction')
  await page.screenshot({ path: '../../docs/verification/db-data-admin-step8-editor.png', fullPage: true })
  await page.getByRole('button', { name: 'Save change' }).click()
  await expect(page.getByRole('status')).toContainText('Saved and audited')
  await page.getByRole('button', { name: 'Close editor' }).click()
  await page.getByRole('button', { name: 'Close details' }).click()
  const filter = page.getByRole('combobox', { name: 'Filter Name' })
  await filter.fill('Acme'); await page.waitForTimeout(350)
  await expect(filter).toBeFocused(); await expect(filter).toHaveValue('Acme')
  await page.getByRole('button', { name: 'Vendors' }).click()
  await expect(page.getByRole('button', { name: 'Vendors' })).toHaveClass(/active/)
  await expect(page.getByText('Atlas Manufacturing')).toBeVisible()
  await page.screenshot({ path: '../../docs/verification/db-data-admin-step7-vendor-wide.png', fullPage: true })
})

test('shows the canonical name when no display_name override is set', async ({ page }) => {
  await mockAdmin(page); await page.goto('/')
  await expect(page.locator('revo-grid')).toBeVisible()
  await expect(page.getByRole('gridcell', { name: 'Zeta Imports' })).toBeVisible()
  // The Name filter reads the same effective value, so it matches too. Scope to
  // the grid: the filter's autocomplete dropdown repeats the name as an option.
  const filter = page.getByRole('combobox', { name: 'Filter Name' })
  await filter.fill('Zeta'); await page.waitForTimeout(350)
  await expect(page.getByRole('gridcell', { name: 'Zeta Imports' })).toBeVisible()
  await expect(page.getByRole('gridcell', { name: 'Acme Retail' })).toHaveCount(0)
})

test('enables in-table editing and saves RevoGrid drag-fill changes', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 })
  await mockAdmin(page)
  const updates: Record<string, unknown>[] = []
  await page.route('https://preview.supabase.co/rest/v1/rpc/db_data_admin_update_customer', async (route: Route) => {
    const body = route.request().postDataJSON() as Record<string, unknown>
    updates.push(body)
    const source = customers.find(row => row.id === body.p_customer_id) ?? customers[0]
    return route.fulfill({
      json: {
        success: true,
        audit_id: 'audit-inline',
        row: {
          ...source,
          ...(body.p_status ? { status: body.p_status } : {}),
          ...(body.p_app ? { [`${body.p_app}_status`]: body.p_app_status } : {}),
          updated_at: '2026-07-28T14:00:00Z',
        },
      },
    })
  })
  await page.goto('/')

  const grid = page.locator('revo-grid')
  await expect(grid).toBeVisible()
  await expect.poll(() => grid.evaluate(element => (element as HTMLElement & { readonly: boolean }).readonly)).toBe(true)
  await page.getByRole('button', { name: 'Edit table' }).click()
  await expect(page.getByRole('button', { name: 'Done editing' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Refresh table' })).toHaveAttribute('title', 'Refresh table')
  const undo = page.getByRole('button', { name: 'Undo last table edit' })
  await expect(undo).toBeDisabled()
  await expect(undo).toHaveAttribute('title', 'Undo last table edit')
  await expect.poll(() => grid.evaluate(element => (element as HTMLElement & { readonly: boolean }).readonly)).toBe(false)
  await expect(page.getByRole('status')).toContainText('Edit mode is on')

  // Name is display-only even while the rest of the approved table fields are editable.
  await page.getByRole('gridcell', { name: 'Acme Retail' }).dblclick()
  await expect(page.locator('revogr-edit input')).toHaveCount(0)

  // Opening a status cell uses a strict select editor, not RevoGrid's default
  // free-text input.
  await page.getByRole('gridcell', { name: 'active', exact: true }).first().dblclick()
  const globalStatus = page.getByRole('combobox', { name: 'Edit Status' })
  await expect(globalStatus).toBeVisible()
  await expect(globalStatus.locator('option')).toHaveText(['Active', 'Potential', 'Inactive'])
  await page.screenshot({ path: '../../docs/verification/db-data-admin-status-dropdown.png', fullPage: true })
  await globalStatus.selectOption('potential')
  await expect.poll(() => updates.length).toBe(1)
  expect(updates[0]).toMatchObject({
    p_customer_id: customers[0].id,
    p_reason: 'Edited in table',
    p_status: 'potential',
  })
  await expect(page.getByRole('status')).toContainText('1 row saved')
  await expect(undo).toBeEnabled()
  await expect(undo).toHaveAttribute('title', 'Undo last table edit (1 available)')

  // RevoGrid emits beforerangeedit for drag-to-copy/autofill. Dispatch the same
  // public event shape here so the test covers our persistence adapter without
  // relying on pixel-sensitive pointer movement inside the grid's shadow DOM.
  await grid.evaluate((element, fixtureRows) => {
    element.dispatchEvent(new CustomEvent('beforerangeedit', {
      bubbles: true,
      cancelable: true,
      detail: {
        data: { 1: { crm_status: 'inactive' } },
        models: { 1: fixtureRows[1] },
        type: 'rgRow',
        oldRange: { x: 2, x1: 2, y: 0, y1: 0 },
        newRange: { x: 2, x1: 2, y: 0, y1: 1 },
      },
    }))
  }, customers)

  await expect.poll(() => updates.length).toBe(2)
  expect(updates[1]).toMatchObject({
    p_customer_id: customers[1].id,
    p_reason: 'Edited in table',
    p_app: 'crm',
    p_app_status: 'inactive',
  })
  await expect(page.getByRole('status')).toContainText('1 row saved')
  await expect(undo).toHaveAttribute('title', 'Undo last table edit (2 available)')

  // A drag-fill is one undo step, followed by the earlier single-cell edit.
  await undo.click()
  await expect.poll(() => updates.length).toBe(3)
  expect(updates[2]).toMatchObject({
    p_customer_id: customers[1].id,
    p_reason: 'Undid table edit',
    p_app: 'crm',
    p_app_status: 'active',
  })
  await expect(undo).toHaveAttribute('title', 'Undo last table edit (1 available)')
  await undo.click()
  await expect.poll(() => updates.length).toBe(4)
  expect(updates[3]).toMatchObject({
    p_customer_id: customers[0].id,
    p_reason: 'Undid table edit',
    p_status: 'active',
  })
  await expect(undo).toBeDisabled()
  await page.screenshot({ path: '../../docs/verification/db-data-admin-inline-edit.png', fullPage: true })
})

test('previews and explicitly confirms a protected duplicate merge', async ({ page }) => {
  // The corrected preview contains the complete moving-detail contract. Use a
  // tall evidence viewport so the screenshot captures the dialog from its
  // title through confirmation without recording an internally scrolled state.
  await page.setViewportSize({ width: 1280, height: 1400 })
  await mockAdmin(page); await page.goto('/')
  await page.getByText('Acme Retail').click()
  await page.getByRole('button', { name: 'Merge duplicate' }).click()
  await page.getByLabel('Duplicate to absorb').selectOption(customers[1].id)
  await expect(page.getByText('Resolve every conflict')).toBeVisible()
  await expect(page.getByText('core.company_source_ref.company_id')).toBeVisible()
  // Step 9 correction: the preview must show the exact aliases and source
  // references that will move, not only affected counts.
  await expect(page.getByText('Aliases that will move to the survivor')).toBeVisible()
  await expect(page.getByText('Northwind Retail Co')).toBeVisible()
  await expect(page.getByText("duplicate's current name")).toBeVisible()
  await expect(page.getByText('Source references that will move to the survivor')).toBeVisible()
  await expect(page.getByText('coldlion/customers')).toBeVisible()
  await page.getByLabel('Keep: active').check()
  await page.getByPlaceholder(/permanent audit/i).fill('Confirmed duplicate company')
  await page.getByLabel(/I confirm/).check()
  await page.screenshot({ path: '../../docs/verification/db-data-admin-step9-moving-detail-preview.png', fullPage: true })
  await page.getByRole('button', { name: 'Merge records' }).click()
  // Step 9 correction: an accessible success receipt with the final survivor and
  // audit/operation ID persists until dismissed.
  await expect(page.getByRole('heading', { name: 'Merge complete' })).toBeVisible()
  const receipt = page.getByRole('status').filter({ hasText: 'was absorbed' })
  await expect(receipt).toBeVisible()
  await expect(page.getByText('audit-merge')).toBeVisible()
  await page.screenshot({ path: '../../docs/verification/db-data-admin-step9-merge-receipt.png', fullPage: true })
  await page.getByRole('button', { name: 'Done' }).click()
  await expect(page.getByRole('gridcell', { name: 'Northwind Stores' })).not.toBeVisible()
})

test('surfaces a stale concurrency-token save failure and recovers after reloading the record', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 1000 })
  await mockAdmin(page)
  // The first save races a concurrent edit and is loudly rejected as stale; the
  // second save (after the editor reloads fresh data) succeeds. Registered after
  // mockAdmin so this exact-URL route takes precedence over its catch-all.
  let updateAttempts = 0
  await page.route('https://preview.supabase.co/rest/v1/rpc/db_data_admin_update_customer', async (route: Route) => {
    updateAttempts += 1
    if (updateAttempts === 1) return route.fulfill({ json: { success: false, code: 'stale_token', current: { ...customers[0], updated_at: '2026-07-22T13:00:00Z' } } })
    return route.fulfill({ json: { success: true, audit_id: 'audit-recovered', row: { ...customers[0], display_name: 'Acme Retail Group' } } })
  })
  await page.goto('/')
  await page.getByText('Acme Retail').click()
  await page.getByRole('button', { name: 'Edit record' }).click()
  await page.getByLabel('Curated display name').fill('Acme Retail Group')
  await page.getByLabel('Reason').fill('Curated correction')
  await page.getByRole('button', { name: 'Save change' }).click()
  // Loud, accessible failure — never a silent overwrite.
  await expect(page.getByRole('alert')).toContainText('changed elsewhere')
  await page.screenshot({ path: '../../docs/verification/db-data-admin-step8-stale-token.png', fullPage: true })
  // One-click recovery: reload re-fetches the record and remounts the editor.
  await page.getByRole('button', { name: 'Reload record' }).click()
  await expect(page.getByRole('dialog', { name: 'Edit Customer' })).toBeVisible()
  await page.getByLabel('Curated display name').fill('Acme Retail Group')
  await page.getByLabel('Reason').fill('Curated correction after reload')
  await page.getByRole('button', { name: 'Save change' }).click()
  await expect(page.getByRole('status')).toContainText('Saved and audited')
  await page.screenshot({ path: '../../docs/verification/db-data-admin-step8-stale-token-recovered.png', fullPage: true })
})

test('keeps the admin grid usable at a narrow viewport', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 }); await mockAdmin(page); await page.goto('/')
  await expect(page.locator('revo-grid')).toBeVisible()
  await expect(page.getByText('Acme Retail')).toBeVisible()
  await page.screenshot({ path: '../../docs/verification/db-data-admin-step7-narrow.png', fullPage: true })
})

test('shows licensing source data only through Scraped Properties', async ({ page }) => {
  await mockAdmin(page); await page.goto('/')
  await expect(page.getByRole('button', { name: 'Scraped Properties' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Licensors' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Properties', exact: true })).toHaveCount(0)
})

test('offers a status-only Property control without restoring the retired licensing screens', async ({ page }) => {
  await mockAdmin(page); await page.goto('/')
  await page.getByRole('button', { name: 'Property Status' }).click()
  await expect(page.getByText('Status only.')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Licensors' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Properties', exact: true })).toHaveCount(0)
  await expect.poll(() => page.locator('revo-grid').evaluate(element => (
    element as HTMLElement & { columns: Array<{ name: string }> }
  ).columns.map(column => column.name))).toEqual(['Property', 'Code', 'Status'])
  await page.getByRole('gridcell', { name: 'Avengers' }).click()
  await page.getByRole('button', { name: 'Set status…' }).click()
  await expect(page.getByRole('dialog', { name: 'Set Property status' })).toBeVisible()
  await expect(page.getByLabel(/^Status/)).toHaveValue('active')
  await page.getByLabel(/^Status/).selectOption('inactive')
  await page.getByLabel('Reason').fill('Licence lapsed')
  const saveRequest = page.waitForRequest(request => request.url().endsWith('/rpc/db_data_admin_set_property_status'))
  await page.getByRole('button', { name: 'Save status' }).click()
  const body = (await saveRequest).postDataJSON()
  expect(body).toMatchObject({
    p_property_id: '44444444-0002-4000-8000-000000000002',
    p_status: 'inactive', p_expected_updated_at: '2026-07-22T10:00:00Z', p_reason: 'Licence lapsed',
  })
  await expect(page.getByRole('status').filter({ hasText: 'Saved and audited' })).toBeVisible()
})

test('renders raw scrape inventory with two scoped sections per Licensor', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1100 })
  await mockAdmin(page); await page.goto('/')
  await page.getByRole('button', { name: 'Scraped Properties' }).click()
  await expect(page.getByRole('button', { name: 'Properties', exact: true })).toHaveClass(/active/)
  await expect(page.getByRole('button', { name: 'Properties', exact: true })).toHaveCSS('color', 'rgb(32, 77, 189)')
  await expect(page.getByRole('button', { name: 'Characters' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Style Guides' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Disney', exact: true })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Marvel', exact: true })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Lucasfilm / Star Wars', exact: true })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Sega', exact: true })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Creative', exact: true })).toHaveCount(4)
  await expect(page.getByRole('heading', { name: 'Submissions', exact: true })).toHaveCount(4)
  await expect(page.getByText('6 of 6 scraped properties')).toBeVisible()
  const scrapedGrid = page.locator('revo-grid').first()
  await expect.poll(() => scrapedGrid.evaluate(element => (
    element as HTMLElement & { columns: Array<{ name: string }> }
  ).columns.slice(0, 4).map(column => column.name))).toEqual(['Property', 'Mapping', 'Source system', 'Source ID'])
  await expect.poll(() => scrapedGrid.evaluate(element => (element as HTMLElement & { rowSize: number }).rowSize)).toBe(58)
  // Purpose-encoded RPC keys collapse to one heading per Licensor.
  await expect(page.locator('.scraped-property-group')).toHaveCount(4)
  await page.getByRole('gridcell', { name: 'The Mandalorian' }).scrollIntoViewIfNeeded()
  await expect(page.getByRole('gridcell', { name: 'The Mandalorian' })).toBeVisible()
  const unmappedCell = page.getByRole('gridcell', { name: 'Frozen' }).first()
  await expect(unmappedCell).toHaveCSS('background-color', 'rgb(255, 240, 240)')
  await expect(unmappedCell).toHaveCSS('color', 'rgb(138, 28, 28)')
  await expect.poll(() => page.locator('revo-grid').evaluateAll(elements => elements.some(element => (
    element as HTMLElement & { source: Array<{ source_system: string }> }
  ).source.some(row => row.source_system === 'lucasfilm_dcpvault')))).toBe(true)
  await expect(page.getByText(/matching decisions are made in Property Matching/i)).toBeVisible()
  await expect(page.getByText(/review reason/i)).toHaveCount(0)

  // Regression: a filter in Disney Creative must only see and filter Disney
  // Creative rows. A Marvel value must not be suggested there or filter every grid.
  const disneyCreative = page.locator('#scraped-property-disney-creative').locator('..')
  await disneyCreative.getByRole('combobox', { name: 'Filter Property' }).fill('Lilo')
  // Suggestions are portalled to document.body, so assert page-wide: a leaked
  // Marvel value would appear in the Property suggestions listbox.
  await expect(page.getByRole('listbox', { name: 'Property suggestions' }).getByRole('option', { name: 'Lilo test fixture' })).toHaveCount(0)
  await expect.poll(() => disneyCreative.locator('revo-grid').evaluate(element => (
    element as HTMLElement & { source: unknown[] }
  ).source.length)).toBe(0)
  await expect(page.locator('#scraped-property-marvel-creative').locator('..').getByRole('gridcell', { name: 'Lilo test fixture' })).toBeVisible()

  await disneyCreative.getByRole('combobox', { name: 'Filter Property' }).fill('')
  await disneyCreative.getByRole('button', { name: 'Set filter Property' }).click()
  const propertyOptions = page.getByRole('dialog', { name: 'Set filter options for Property' })
  await expect(propertyOptions.getByText('Frozen', { exact: true })).toBeVisible()
  await expect(propertyOptions.getByText('Lilo test fixture', { exact: true })).toHaveCount(0)
  await propertyOptions.getByRole('button', { name: 'Clear' }).click()
  await expect.poll(() => disneyCreative.locator('revo-grid').evaluate(element => (
    element as HTMLElement & { source: unknown[] }
  ).source.length)).toBe(0)
  await expect(page.locator('#scraped-property-marvel-creative').locator('..').getByRole('gridcell', { name: 'Lilo test fixture' })).toBeVisible()
  await page.screenshot({ path: '../../docs/verification/db-data-admin-scraped-properties.png', fullPage: true })
})

test('shows a licensing-manager denial only on the Scraped Properties screen', async ({ page }) => {
  await mockAdmin(page)
  await page.route('https://preview.supabase.co/rest/v1/rpc/db_data_admin_scraped_source_inventory', route => route.fulfill({ status: 403, json: { message: 'licensing manager access required' } }))
  await page.goto('/')
  await page.getByRole('button', { name: 'Scraped Properties' }).click()
  await expect(page.getByRole('alert')).toContainText('Licensing Manager')
  await expect(page.getByRole('button', { name: 'Customers' })).toBeVisible()
})
