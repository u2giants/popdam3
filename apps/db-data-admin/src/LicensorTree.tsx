import { AlertTriangle, ChevronDown, ChevronRight, Network, RefreshCw, Search } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { loadLicensorTree, type ApiClient, type LoadedTree, type PlmContextEntry, type TaxonomyNode } from './lib/data-admin'
import { formatDivision } from './lib/property-rows'

type Props = { client: ApiClient }

// Initial disclosure cap per node. Every property/orphan beyond this stays
// reachable through an accessible "show all" control that names the exact hidden
// count — never silently truncated. Kept high enough that most licensors render
// fully, low enough to bound DOM for a very large licensor.
const INITIAL_VISIBLE = 50
const ORPHAN_KEY = '__orphans__'

function StatusBadge({ status }: { status: string }) {
  const tone = status === 'active' ? 'ok' : status === 'potential' ? 'warn' : 'off'
  return <span className={`badge badge-${tone}`} aria-label={`Status ${status}`}>{status}</span>
}

function SourceContext({ entries }: { entries: PlmContextEntry[] }) {
  if (!entries.length) return <span className="muted">No PLM source row</span>
  return <span className="ctx-chips">{entries.map((entry, i) => (
    <span className="ctx-chip" key={`${entry.plm_id ?? i}-${entry.division_code ?? ''}-${entry.mg_code ?? ''}`}>
      {formatDivision(entry)}{entry.mg_code ? ` · ${entry.mg_code}` : ''}
    </span>
  ))}</span>
}

function SourceRefs({ refs }: { refs: TaxonomyNode['source_refs'] }) {
  if (!refs.length) return <span className="muted">No source reference</span>
  return <span className="ctx-chips">{refs.map((ref, i) => (
    <span className="ctx-chip muted" key={`${ref.source_system}-${ref.source_table}-${ref.source_id}-${i}`}>
      {ref.source_system}{ref.source_table ? `/${ref.source_table}` : ''}{ref.source_code ? ` · ${ref.source_code}` : ''}
    </span>
  ))}</span>
}

function nodeMatches(node: TaxonomyNode, term: string) {
  if (!term) return true
  const hay = `${node.name} ${node.code ?? ''}`.toLowerCase()
  return hay.includes(term)
}

export function LicensorTree({ client }: Props) {
  const [data, setData] = useState<LoadedTree | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [denied, setDenied] = useState(false)
  const [search, setSearch] = useState('')
  const [term, setTerm] = useState('')
  const [includeInactive, setIncludeInactive] = useState(false)
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})
  // Per-node "show every item" toggles (licensor id, plus ORPHAN_KEY).
  const [showAllItems, setShowAllItems] = useState<Record<string, boolean>>({})
  const showAllFor = useCallback((id: string) => Boolean(showAllItems[id]), [showAllItems])
  const toggleShowAll = (id: string) => setShowAllItems(current => ({ ...current, [id]: !current[id] }))

  const load = useCallback(async () => {
    setLoading(true); setError(null); setDenied(false)
    try {
      const tree = await loadLicensorTree(client, { includeInactive })
      setData(tree)
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : ''
      if (/permission|administrator|access/i.test(message)) setDenied(true)
      else setError(message || 'The Licensor/Property tree could not be loaded.')
    } finally {
      setLoading(false)
    }
  }, [client, includeInactive])

  // `load` flips the loading/error flags synchronously so the spinner appears on
  // the same render as the request; the alternative leaves stale rows on screen.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void load() }, [load])

  useEffect(() => {
    const handle = setTimeout(() => setTerm(search.trim().toLowerCase()), 250)
    return () => clearTimeout(handle)
  }, [search])

  const filtered = useMemo(() => {
    if (!data) return [] as LoadedTree['licensors']
    if (!term) return data.licensors
    return data.licensors
      .map(licensor => ({ ...licensor, properties: licensor.properties.filter(property => nodeMatches(property, term)) }))
      .filter(licensor => nodeMatches(licensor, term) || licensor.properties.length > 0)
  }, [data, term])

  // While searching, every surviving licensor is expanded so matches are visible.
  const isOpen = useCallback((id: string) => (term ? true : Boolean(expanded[id])), [term, expanded])

  const allOpen = filtered.length > 0 && filtered.every(licensor => isOpen(licensor.id))
  const expandAll = () => setExpanded(Object.fromEntries(filtered.map(licensor => [licensor.id, true])))
  const collapseAll = () => setExpanded({})
  const toggle = (id: string) => setExpanded(current => ({ ...current, [id]: !current[id] }))

  if (denied) return <section className="access-denied" role="alert"><h1>Access denied</h1><p>You are signed in, but DB Data Admin requires an active Administrator grant.</p></section>

  const snapshot = data?.snapshot
  const reconciliation = data?.reconciliation
  const orphans = data?.orphanProperties ?? []
  const feederDown = snapshot ? !snapshot.feeder_available : false
  // Observed feeder recency and live upstream reconciliation are two distinct
  // facts: a recent successful feeder run justifies feeder_available=true but
  // never proves live reconciliation, which the RPC reports as always false.
  const liveReconciled = snapshot ? snapshot.live_upstream_reconciliation : false

  return <section className="taxonomy workspace">
    <div className="tree-controls controls">
      <label className="search"><Search aria-hidden="true" /><span className="sr-only">Search licensors and properties</span>
        <input placeholder="Search licensors or properties" value={search} onChange={event => setSearch(event.target.value)} />
      </label>
      <button className="secondary" onClick={() => { if (allOpen) collapseAll(); else expandAll() }} disabled={!filtered.length}>
        {allOpen ? 'Collapse all' : 'Expand all'}
      </button>
      <label className="check"><input type="checkbox" checked={includeInactive} onChange={event => setIncludeInactive(event.target.checked)} /> Include inactive</label>
      <button className="icon-button" aria-label="Refresh tree" onClick={() => void load()}><RefreshCw /></button>
    </div>

    {error && <div className="inline-error" role="alert">{error}</div>}

    {snapshot && reconciliation && (
      <div className="tree-meta">
        <div className="tree-meta-row">
          <strong><Network aria-hidden="true" /> Reconciliation</strong>
          <span>{reconciliation.licensor_count} licensors</span>
          <span>{reconciliation.property_count} properties</span>
          <span>{reconciliation.properties_with_licensor} parented</span>
          <span className={reconciliation.expected_orphan_count_is_zero ? 'muted' : 'loud'}>
            {reconciliation.orphan_property_count} orphan{reconciliation.orphan_property_count === 1 ? '' : 's'}
          </span>
          {reconciliation.partition_reconciles
            ? <span className="muted">parented + orphans = total ✓</span>
            : <span className="loud">partition does not reconcile</span>}
        </div>
        <div className="tree-meta-row muted">
          <span>Snapshot {new Date(snapshot.snapshot_at).toLocaleString()}</span>
          <span>Store: canonical Supabase mirror</span>
          {feederDown
            ? <span className="loud" title={snapshot.note}>Upstream feeder unavailable (observed mirror only)</span>
            : <span title={snapshot.note}>Upstream feeder recently observed (mirror only)</span>}
          <span className={liveReconciled ? 'muted' : 'loud'} title={snapshot.note}>{liveReconciled ? 'Live upstream reconciliation claimed' : 'Live upstream reconciliation not claimed (no live DesignFlow comparison)'}</span>
          {snapshot.feeder_last_run_status && <span>last run {snapshot.feeder_last_run_status}{snapshot.feeder_days_stale == null ? '' : ` · ${snapshot.feeder_days_stale}d ago`}</span>}
        </div>
      </div>
    )}

    {orphans.length > 0 && (
      <div className="orphan-alert" role="alert">
        <h2><AlertTriangle aria-hidden="true" /> {orphans.length} orphan propert{orphans.length === 1 ? 'y' : 'ies'} — no Licensor</h2>
        <p>Every canonical Property is expected to sit under exactly one Licensor. These have a null <code>licensor_id</code>. The relationship is DesignFlow-owned; do not repair it here.</p>
        {(() => {
          const showingAll = showAllFor(ORPHAN_KEY)
          const visible = showingAll ? orphans : orphans.slice(0, INITIAL_VISIBLE)
          const hidden = orphans.length - visible.length
          return <>
            <ul className="orphan-list">
              {visible.map(orphan => (
                <li key={orphan.id}><strong>{orphan.name}</strong>{orphan.code ? <span className="muted"> · {orphan.code}</span> : null}<StatusBadge status={orphan.status} /></li>
              ))}
            </ul>
            {(hidden > 0 || showingAll) && orphans.length > INITIAL_VISIBLE && (
              <button className="link-button show-all" onClick={() => toggleShowAll(ORPHAN_KEY)}>
                {hidden > 0 ? `Show all ${orphans.length} orphans (${hidden} hidden)` : 'Show fewer orphans'}
              </button>
            )}
          </>
        })()}
      </div>
    )}

    <div className="tree-wrap" aria-busy={loading}>
      {loading ? <div className="grid-loading">Loading…</div>
        : filtered.length === 0 ? <p className="muted tree-empty">No licensors match “{search}”.</p>
        : <ul role="tree" aria-label="Licensors and their properties" className="tree">
          {filtered.map(licensor => {
            const open = isOpen(licensor.id)
            return <li role="treeitem" aria-expanded={open} key={licensor.id} className="tree-licensor">
              <button className="tree-row tree-row-licensor" aria-label={`${open ? 'Collapse' : 'Expand'} licensor ${licensor.name}`} onClick={() => toggle(licensor.id)}>
                {open ? <ChevronDown aria-hidden="true" /> : <ChevronRight aria-hidden="true" />}
                <span className="tree-label">{licensor.name}</span>
                {licensor.code && <span className="muted mono">{licensor.code}</span>}
                <StatusBadge status={licensor.status} />
                <span className="count">{licensor.property_count} propert{licensor.property_count === 1 ? 'y' : 'ies'}</span>
              </button>
              <div className="tree-context"><SourceContext entries={licensor.plm_context} /><SourceRefs refs={licensor.source_refs} /></div>
              {open && (() => {
                // When searching, properties are already narrowed to matches, so
                // show them all; otherwise cap at INITIAL_VISIBLE with a
                // reachable, count-disclosing "show all" control.
                const showingAll = Boolean(term) || showAllFor(licensor.id)
                const visibleProps = showingAll ? licensor.properties : licensor.properties.slice(0, INITIAL_VISIBLE)
                const hiddenProps = licensor.properties.length - visibleProps.length
                return <ul role="group" aria-label={`Properties of ${licensor.name}`} className="tree tree-properties">
                  {licensor.properties.length === 0 && <li className="muted tree-empty">No visible properties.</li>}
                  {visibleProps.map(property => (
                    <li role="treeitem" key={property.id} className="tree-property">
                      <div className="tree-row tree-row-property">
                        <span className="tree-bullet" aria-hidden="true">•</span>
                        <span className="tree-label">{property.name}</span>
                        {property.code && <span className="muted mono">{property.code}</span>}
                        <StatusBadge status={property.status} />
                        {typeof property.character_count === 'number' && property.character_count > 0 && <span className="count">{property.character_count} character{property.character_count === 1 ? '' : 's'}</span>}
                      </div>
                      <div className="tree-context"><SourceContext entries={property.plm_context} /><SourceRefs refs={property.source_refs} /></div>
                    </li>
                  ))}
                  {!term && licensor.properties.length > INITIAL_VISIBLE && (
                    <li className="tree-show-all">
                      <button className="link-button show-all" onClick={() => toggleShowAll(licensor.id)}>
                        {hiddenProps > 0 ? `Show all ${licensor.properties.length} properties (${hiddenProps} hidden)` : 'Show fewer properties'}
                      </button>
                    </li>
                  )}
                </ul>
              })()}
            </li>
          })}
        </ul>}
    </div>
  </section>
}
