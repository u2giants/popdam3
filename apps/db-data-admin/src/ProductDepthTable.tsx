// Product Depth maintenance grid — issue #597 Phase 1, owner decision 3.
//
// DB Data Admin is the ONLY place a Product Depth value may be added, renamed,
// activated or deactivated. The old DesignFlow editor is retired. There is
// deliberately no second writer anywhere in this repository.
//
// Everything on this screen goes through the protected RPCs from migration
// 20260809170500 via src/lib/product-depth.ts. This component performs NO
// client-side authorisation: the database gate
// app.require_db_data_admin_product_depth_access() decides, and requires BOTH
// an administrator/designer role AND a non-revoked `admin` app_access row. A
// signed-in user without both sees the access-denied panel below because the
// list RPC itself refuses — not because this file checked anything.
//
// There is no delete path, by design. Deactivating keeps the value visible on
// items that already hold it and simply stops offering it for new selections.

import { RevoGrid, Template, type ColumnRegular } from '@revolist/react-datagrid'
import { Ban, Check, Plus, RefreshCw, Search, X } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { FilterHeader } from './FilterHeader'
import type { ApiClient } from './lib/data-admin'
import { getDistinctColumnValues, rowMatchesFilters } from './lib/grid-filters'
import {
  createProductDepth,
  describeMutationFailure,
  loadProductDepths,
  renameProductDepth,
  setProductDepthStatus,
  type ProductDepthMutationResult,
  type ProductDepthRow,
} from './lib/product-depth'

type Props = { client: ApiClient }

const depthColumns: ColumnRegular[] = [
  { prop: 'code', name: 'Code', size: 130, sortable: true },
  { prop: 'label', name: 'Label', size: 220, sortable: true },
  { prop: 'status', name: 'Status', size: 110, sortable: true },
  { prop: 'legacy_id', name: 'Legacy ID', size: 110, sortable: true },
  { prop: 'source_system', name: 'Source', size: 150, sortable: true },
  { prop: 'updated_at', name: 'Updated', size: 190, sortable: true },
]

// Every mutation demands a written reason; the RPCs record it in the immutable
// audit trail. An empty reason is refused here so the user sees why, rather than
// getting a `validation` code back from the database.
const MIN_REASON = 3

export function ProductDepthTable({ client }: Props) {
  const [rows, setRows] = useState<ProductDepthRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [denied, setDenied] = useState(false)
  const [includeInactive, setIncludeInactive] = useState(true)
  const [search, setSearch] = useState('')
  const [term, setTerm] = useState('')
  const [filters, setFilters] = useState<Record<string, string>>({})
  const [activeFilters, setActiveFilters] = useState<Record<string, string>>({})
  const [setFiltersState, setSetFiltersState] = useState<Record<string, ReadonlySet<string> | null>>({})
  const [selected, setSelected] = useState<ProductDepthRow | null>(null)
  const [creating, setCreating] = useState(false)
  const [draftCode, setDraftCode] = useState('')
  const [draftLabel, setDraftLabel] = useState('')
  const [reason, setReason] = useState('')
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    setLoading(true); setError(null); setDenied(false)
    try {
      setRows(await loadProductDepths(client, { includeInactive }))
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : ''
      if (/permission|privilege|administrator|designer|access/i.test(message)) setDenied(true)
      else setError(message || 'Product Depth values could not be loaded.')
    } finally {
      setLoading(false)
    }
  }, [client, includeInactive])

  // Matches PropertyTable/LicensorTree: `load` flips loading synchronously so the
  // spinner appears on the same render as the request.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void load() }, [load])

  useEffect(() => {
    const handle = setTimeout(() => setTerm(search.trim().toLowerCase()), 250)
    return () => clearTimeout(handle)
  }, [search])

  const updateFilter = useCallback((prop: string, value: string) => {
    setFilters(current => ({ ...current, [prop]: value }))
    setActiveFilters(current => ({ ...current, [prop]: value }))
  }, [])

  const updateSetFilter = useCallback((prop: string, next: Set<string> | null) => {
    setSetFiltersState(current => ({ ...current, [prop]: next }))
  }, [])

  const distinctValues = useMemo(() => {
    const map: Record<string, string[]> = {}
    for (const column of depthColumns) {
      const prop = String(column.prop)
      map[prop] = getDistinctColumnValues(rows, prop)
    }
    return map
  }, [rows])

  const columns = useMemo(
    () => depthColumns.map(column => ({
      ...column,
      readonly: true,
      columnTemplate: Template(FilterHeader, {
        filters,
        onFilter: updateFilter,
        setFilters: setFiltersState,
        onSetFilter: updateSetFilter,
        distinctValues,
        scope: 'product-depth',
        key: `product-depth-${String(column.prop)}`,
      }),
    })),
    [distinctValues, filters, setFiltersState, updateFilter, updateSetFilter],
  )

  const visibleRows = useMemo(
    () => rows
      .filter(row => rowMatchesFilters(row, activeFilters, setFiltersState))
      .filter(row => !term || `${row.code} ${row.label}`.toLowerCase().includes(term)),
    [rows, activeFilters, setFiltersState, term],
  )

  const activeCount = useMemo(() => rows.filter(row => row.status === 'active').length, [rows])

  const closeForm = () => {
    setSelected(null); setCreating(false)
    setDraftCode(''); setDraftLabel(''); setReason('')
    setError(null)
  }

  const openRow = (row: ProductDepthRow) => {
    setCreating(false); setNotice(null); setError(null)
    setSelected(row); setDraftCode(row.code); setDraftLabel(row.label); setReason('')
  }

  const openCreate = () => {
    setSelected(null); setNotice(null); setError(null)
    setCreating(true); setDraftCode(''); setDraftLabel(''); setReason('')
  }

  // A committed `success: false` is an expected outcome, not an exception. It
  // MUST be rendered — a silent failure here is the exact thing the RPC contract
  // was designed to prevent.
  const applyResult = async (result: ProductDepthMutationResult, successMessage: string) => {
    const failure = describeMutationFailure(result)
    if (failure) {
      // Reload FIRST, then report. `load()` clears the error banner on entry, so
      // setting the message before the reload silently erased it — which is the
      // exact silent-failure this screen exists to avoid. Found by its own test.
      await load()
      setError(failure)
      return false
    }
    setNotice(result.idempotent_replay ? `${successMessage} (already applied)` : successMessage)
    closeForm()
    await load()
    return true
  }

  const submitForm = async (event: React.FormEvent) => {
    event.preventDefault()
    if (saving) return
    if (reason.trim().length < MIN_REASON) { setError('Give a reason for this change; it is recorded in the audit trail.'); return }
    setSaving(true); setError(null); setNotice(null)
    try {
      if (creating) {
        const result = await createProductDepth(client, {
          code: draftCode.trim(), label: draftLabel.trim(), reason: reason.trim(),
        })
        await applyResult(result, `Product Depth “${draftLabel.trim()}” added.`)
      } else if (selected) {
        const result = await renameProductDepth(client, {
          id: selected.id,
          code: draftCode.trim(),
          label: draftLabel.trim(),
          reason: reason.trim(),
          expectedUpdatedAt: selected.updated_at,
        })
        await applyResult(result, `Product Depth “${draftLabel.trim()}” saved.`)
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The change could not be saved.')
    } finally {
      setSaving(false)
    }
  }

  const changeStatus = async (next: 'active' | 'inactive') => {
    if (!selected || saving) return
    if (reason.trim().length < MIN_REASON) { setError('Give a reason for this change; it is recorded in the audit trail.'); return }
    setSaving(true); setError(null); setNotice(null)
    try {
      const result = await setProductDepthStatus(client, {
        id: selected.id, status: next, reason: reason.trim(), expectedUpdatedAt: selected.updated_at,
      })
      await applyResult(result, next === 'active'
        ? `Product Depth “${selected.label}” activated.`
        : `Product Depth “${selected.label}” deactivated. Existing items keep it.`)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The status could not be changed.')
    } finally {
      setSaving(false)
    }
  }

  if (denied) return <section className="access-denied" role="alert">
    <h1>Access denied</h1>
    <p>
      You are signed in, but Product Depth maintenance needs both an Administrator or Designer
      role and an active DB Data Admin (<code>admin</code>) grant. Ask for the missing grant.
    </p>
  </section>

  return <section className="workspace">
    <div className="controls">
      <label className="search"><Search aria-hidden="true" /><span className="sr-only">Search product depths</span>
        <input placeholder="Search depth values" value={search} onChange={event => setSearch(event.target.value)} />
      </label>
      <label className="check">
        <input type="checkbox" checked={includeInactive} onChange={event => setIncludeInactive(event.target.checked)} /> Include inactive
      </label>
      <button className="primary" type="button" onClick={openCreate}><Plus aria-hidden="true" /> Add depth value</button>
      <button className="icon-button" aria-label="Refresh product depths" title="Refresh product depths" onClick={() => void load()}><RefreshCw /></button>
    </div>

    <p className="muted">
      This screen is the only place Product Depth is maintained. Values are never deleted:
      deactivating one keeps it on items that already use it and stops it being offered for new
      selections. Legacy DesignFlow IDs never change.
    </p>

    {error && <div className="inline-error" role="alert">{error}</div>}
    {notice && <div className="inline-edit-message" role="status">{notice}</div>}

    <div className="grid-wrap" aria-busy={loading}>
      <RevoGrid
        theme="material"
        readonly
        accessible
        resize
        columns={columns}
        source={visibleRows}
        rowHeaders
        onBeforecellfocus={(event: CustomEvent<{ rowIndex: number }>) => {
          const row = visibleRows[event.detail.rowIndex]
          if (row) openRow(row)
        }}
      />
      {loading && <div className="grid-loading">Loading…</div>}
    </div>
    <footer className="grid-footer">
      <span>{visibleRows.length} of {rows.length} depth values · {activeCount} active</span>
    </footer>

    {(creating || selected) && (
      <aside className="detail-panel" aria-label={creating ? 'Add product depth' : 'Edit product depth'}>
        <button className="close" aria-label="Close" onClick={closeForm}><X /></button>
        <h2>{creating ? 'Add depth value' : selected?.label}</h2>
        <form onSubmit={event => void submitForm(event)}>
          <label>
            <span>Code</span>
            <input required value={draftCode} onChange={event => setDraftCode(event.target.value)} />
          </label>
          <label>
            <span>Label</span>
            <input required value={draftLabel} onChange={event => setDraftLabel(event.target.value)} />
          </label>
          <label>
            <span>Reason (recorded in the audit trail)</span>
            {/* Deliberately not `required`: the browser's built-in bubble is
                easy to miss and says nothing about the audit trail. The submit
                handler validates and explains instead. */}
            <input value={reason} onChange={event => setReason(event.target.value)} />
          </label>
          {!creating && selected && (
            <p className="muted">
              Legacy ID {selected.legacy_id ?? '—'} · status {selected.status} · source {selected.source_system}
            </p>
          )}
          <div className="detail-actions">
            <button className="primary" type="submit" disabled={saving}>
              <Check aria-hidden="true" /> {saving ? 'Saving…' : creating ? 'Add value' : 'Save changes'}
            </button>
            {!creating && selected?.status === 'active' && (
              <button className="secondary" type="button" disabled={saving} onClick={() => void changeStatus('inactive')}>
                <Ban aria-hidden="true" /> Deactivate
              </button>
            )}
            {!creating && selected && selected.status !== 'active' && (
              <button className="secondary" type="button" disabled={saving} onClick={() => void changeStatus('active')}>
                <Check aria-hidden="true" /> Activate
              </button>
            )}
          </div>
        </form>
      </aside>
    )}
  </section>
}
