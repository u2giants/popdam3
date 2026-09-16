import { Check, RefreshCw, Search, X } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import type { ApiClient } from './lib/data-admin'
import {
  ReviewQueueUnavailableError,
  decidePropertyMatch,
  defaultSelection,
  describeMatchState,
  loadPropertyMatchQueue,
  loadOpaPropertyOptions,
  matchState,
  type MatchState,
  type PropertyMatchRow,
  type OpaPropertyOption,
} from './lib/property-match'

type Props = { client: ApiClient }

const stateLabel: Record<MatchState, string> = {
  exact: 'One candidate',
  multiple: 'More than one candidate',
  none: 'No candidate',
}

export function PropertyMatchReview({ client }: Props) {
  const [rows, setRows] = useState<PropertyMatchRow[]>([])
  const [chosen, setChosen] = useState<Record<string, number[]>>({})
  const [propertyOptions, setPropertyOptions] = useState<OpaPropertyOption[]>([])
  const [propertySearch, setPropertySearch] = useState<Record<string, string>>({})
  const [reasons, setReasons] = useState<Record<string, string>>({})
  // One request id per row, held until that row's decision succeeds. Retrying a
  // failed call therefore returns the recorded decision instead of appending a
  // second version of it.
  const [requestIds, setRequestIds] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [denied, setDenied] = useState(false)
  const [unavailable, setUnavailable] = useState(false)
  const [search, setSearch] = useState('')
  const [saved, setSaved] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true); setError(null); setDenied(false); setUnavailable(false)
    try {
      const [loaded, options] = await Promise.all([loadPropertyMatchQueue(client), loadOpaPropertyOptions(client)])
      setRows(loaded)
      setPropertyOptions(options)
      setChosen(Object.fromEntries(loaded.map(row => [row.resolution_id, defaultSelection(row)])))
      setRequestIds(Object.fromEntries(loaded.map(row => [row.resolution_id, crypto.randomUUID()])))
    } catch (cause) {
      if (cause instanceof ReviewQueueUnavailableError) setUnavailable(true)
      else {
        const message = cause instanceof Error ? cause.message : ''
        if (/permission|licensing|access/i.test(message)) setDenied(true)
        else setError(message || 'The review queue could not be loaded.')
      }
    } finally { setLoading(false) }
  }, [client])

  // Same pattern as the other mounted review screens: the request owns the
  // loading state from the moment the view mounts.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void load() }, [load])

  const visible = useMemo(() => {
    const term = search.trim().toLowerCase()
    if (!term) return rows
    return rows.filter(row => [
      row.display_label,
      row.source_property_id,
      row.contract_evidence_reference ?? '',
      ...row.candidates.map(c => c.property_name ?? ''),
    ].join(' ').toLowerCase().includes(term))
  }, [rows, search])

  const toggle = (resolutionId: string, licensedPropertyId: number) => setChosen(current => {
    const picked = current[resolutionId] ?? []
    return {
      ...current,
      [resolutionId]: picked.includes(licensedPropertyId)
        ? picked.filter(id => id !== licensedPropertyId)
        : [...picked, licensedPropertyId],
    }
  })

  const optionValue = (option: OpaPropertyOption) => `${option.property_name} · OPA ${option.licensed_property_id}`
  const addProperty = (resolutionId: string, value: string) => {
    const option = propertyOptions.find(candidate => optionValue(candidate) === value)
    if (!option) return
    setChosen(current => ({
      ...current,
      [resolutionId]: [...new Set([...(current[resolutionId] ?? []), option.licensed_property_id])],
    }))
    setPropertySearch(current => ({ ...current, [resolutionId]: '' }))
  }

  const decide = async (row: PropertyMatchRow, decision: 'approve' | 'reject') => {
    setBusy(row.resolution_id); setError(null); setSaved(null)
    try {
      await decidePropertyMatch(client, {
        resolutionId: row.resolution_id,
        decision,
        licensedPropertyIds: chosen[row.resolution_id] ?? [],
        reason: reasons[row.resolution_id] ?? '',
        clientRequestId: requestIds[row.resolution_id] ?? crypto.randomUUID(),
      })
      setRows(current => current.filter(candidate => candidate.resolution_id !== row.resolution_id))
      setSaved(`${row.display_label} — ${decision === 'approve' ? 'decision recorded' : 'rejected'}.`)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The decision was not saved.')
    } finally { setBusy(null) }
  }

  if (denied) return <section className="access-denied" role="alert">
    <h1>Access denied</h1>
    <p>Recording a Property match requires an active Licensing Manager grant.</p>
  </section>

  if (unavailable) return <section className="workspace property-match" aria-live="polite">
    <h1>Property matches</h1>
    <p className="muted">
      This review queue is not enabled on this database yet. The screen is in place and will
      populate as soon as the governed database change that creates the queue is applied.
    </p>
  </section>

  return <section className="workspace property-match">
    <div className="controls">
      <label className="search">
        <Search aria-hidden="true" />
        <span className="sr-only">Search property matches</span>
        <input placeholder="Search property matches" value={search} onChange={event => setSearch(event.target.value)} />
      </label>
      <button className="icon-button" aria-label="Refresh property matches" onClick={() => void load()}><RefreshCw /></button>
    </div>
    <p className="muted">
      Three systems name the same property differently, and this screen reconciles them.
      The heading on each row is the name in the <strong>creative library</strong> (DCP Vault),
      where the artwork and style guides live. The tick boxes are names in the
      <strong>submissions system</strong> (OPA), where product approvals are filed. The
      <strong>signed contract</strong> (K2557) decides which studio the property belongs to,
      because the submissions system cannot tell Marvel from Disney on its own. Pick the
      submissions name (or names) that mean the same property as the creative name.
      Nothing here is placed automatically.
    </p>
    {error && <div className="inline-error" role="alert">{error}</div>}
    {saved && <p className="muted" role="status">{saved}</p>}
    <datalist id="opa-property-options">
      {propertyOptions.map(option => <option key={option.licensed_property_id} value={optionValue(option)} />)}
    </datalist>
    <div aria-busy={loading}>
      {visible.map(row => {
        const picked = chosen[row.resolution_id] ?? []
        const reason = (reasons[row.resolution_id] ?? '').trim()
        const state = matchState(row)
        return <article key={row.resolution_id} className="match-row" aria-labelledby={`match-${row.resolution_id}`}>
          <p className="source-kind">Creative library (DCP Vault)</p>
          <header>
            <h2 id={`match-${row.resolution_id}`}>{row.display_label}</h2>
            <span className={`match-state match-state-${state}`}>{stateLabel[state]}</span>
          </header>
          <p className="muted">{describeMatchState(row)}</p>
          <p className="muted contract-evidence">
            {row.contract_asserted_studio_code && <>Signed contract says this is <strong>{row.contract_asserted_studio_code}</strong>. </>}
            {row.contract_evidence_reference && <>Contract evidence: {row.contract_evidence_reference}. </>}
            
            <span className="source-id">{row.source_property_id}</span>
          </p>
          {row.prior_approval_status && <p className="muted">
            Previously {row.prior_approval_status} at version {row.prior_decision_version}
            {row.prior_contract_asserted_studio_code && <> as {row.prior_contract_asserted_studio_code}</>}.
          </p>}
          <p className="source-kind">Submissions system (OPA) — the name product approvals are filed under</p>
          <label className="property-autocomplete">
            <span>Disney Property</span>
            <input
              list="opa-property-options"
              placeholder="Type to search every Disney Property"
              value={propertySearch[row.resolution_id] ?? ''}
              onChange={event => {
                const value = event.target.value
                setPropertySearch(current => ({ ...current, [row.resolution_id]: value }))
                addProperty(row.resolution_id, value)
              }}
            />
          </label>
          {picked.length === 0
            ? <p className="muted">No submissions-system (OPA) Property selected.</p>
            : <ul className="match-candidates">
              {picked.map(id => {
                const option = propertyOptions.find(candidate => candidate.licensed_property_id === id)
                const suggested = row.candidates.find(candidate => candidate.licensed_property_id === id)
                return <li key={id}>
                  <span>{option?.property_name ?? suggested?.property_name ?? `OPA Property ${id}`} · OPA {id}</span>
                  <button type="button" className="remove-property" onClick={() => toggle(row.resolution_id, id)} aria-label={`Remove OPA Property ${id}`}><X aria-hidden="true" /></button>
                </li>
              })}
            </ul>}
          <label className="match-reason">
            <span>Reason</span>
            <input
              placeholder="Why this decision (recorded with your name)"
              value={reasons[row.resolution_id] ?? ''}
              onChange={event => setReasons(current => ({ ...current, [row.resolution_id]: event.target.value }))}
            />
          </label>
          <div className="match-actions">
            <button
              disabled={busy === row.resolution_id || picked.length === 0 || !reason}
              onClick={() => void decide(row, 'approve')}
            ><Check aria-hidden="true" /> Confirm {picked.length > 1 ? `${picked.length} matches` : 'match'}</button>
            <button
              className="secondary"
              disabled={busy === row.resolution_id || !reason}
              onClick={() => void decide(row, 'reject')}
            ><X aria-hidden="true" /> Not on this contract</button>
          </div>
        </article>
      })}
      {loading && <div className="grid-loading">Loading…</div>}
      {!loading && visible.length === 0 && <p className="muted">Nothing is waiting for a decision.</p>}
    </div>
    <footer className="grid-footer"><span>{visible.length} of {rows.length} awaiting a decision</span></footer>
  </section>
}
