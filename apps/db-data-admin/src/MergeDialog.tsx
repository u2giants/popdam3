import { CheckCircle2, GitMerge, Search, X } from 'lucide-react'
import { useState } from 'react'
import type { AdminRow, EntityKind, MergePreviewResult, MergeResult } from './lib/data-admin'

type Props = {
  kind: EntityKind; survivor: AdminRow; candidates: AdminRow[]; onCancel: () => void
  onPreview: (loserId: string) => Promise<MergePreviewResult>
  onMerge: (loserId: string, token: string, reason: string, resolutions: Record<string, 'survivor' | 'loser'>) => Promise<MergeResult>
  onMerged: (result: MergeResult, loserId: string) => void
  onSearchCandidates?: (term: string) => Promise<AdminRow[]>
}

const label = (row: AdminRow) => String(row.display_name ?? row.name ?? row.id)
const value = (input: unknown) => input == null ? 'Blank' : typeof input === 'object' ? JSON.stringify(input) : String(input)

export function MergeDialog({ kind, survivor, candidates, onCancel, onPreview, onMerge, onMerged, onSearchCandidates }: Props) {
  const [options, setOptions] = useState<AdminRow[]>(candidates)
  const [searchTerm, setSearchTerm] = useState('')
  const [searching, setSearching] = useState(false)
  const [loserId, setLoserId] = useState('')
  const [preview, setPreview] = useState<MergePreviewResult | null>(null)
  const [resolutions, setResolutions] = useState<Record<string, 'survivor' | 'loser'>>({})
  const [reason, setReason] = useState('')
  const [confirmed, setConfirmed] = useState(false)
  const [state, setState] = useState<'idle' | 'loading' | 'merging' | 'error'>('idle')
  const [message, setMessage] = useState('')
  const [receipt, setReceipt] = useState<{ result: MergeResult; loserLabel: string } | null>(null)

  const runSearch = async () => {
    if (!onSearchCandidates || !searchTerm.trim()) return
    setSearching(true)
    try {
      const found = await onSearchCandidates(searchTerm.trim())
      setOptions(current => {
        const seen = new Set(current.map(row => row.id))
        return [...current, ...found.filter(row => row.id !== survivor.id && !seen.has(row.id))]
      })
      if (found.length === 0) setMessage('No other records matched that search.')
    } catch (cause) { setMessage(cause instanceof Error ? cause.message : 'Candidate search failed.') }
    finally { setSearching(false) }
  }

  const choose = async (id: string) => {
    setLoserId(id); setPreview(null); setResolutions({}); setConfirmed(false); setMessage('')
    if (!id) return
    setState('loading')
    try { const result = await onPreview(id); setPreview(result); if (!result.success) setMessage(result.message ?? result.code ?? 'Preview failed.') }
    catch (cause) { setMessage(cause instanceof Error ? cause.message : 'Preview failed.') }
    finally { setState('idle') }
  }
  const submit = async () => {
    const conflicts = preview?.preview?.conflicts ?? []
    if (!reason.trim()) { setMessage('Explain why these records are duplicates.'); setState('error'); return }
    if (conflicts.some(conflict => !resolutions[conflict.key])) { setMessage('Choose a value for every conflict.'); setState('error'); return }
    if (!confirmed || !preview?.preview_token) { setMessage('Confirm that the duplicate will be absorbed.'); setState('error'); return }
    setState('merging'); setMessage('')
    try {
      const result = await onMerge(loserId, preview.preview_token, reason.trim(), resolutions)
      if (!result.success) { setMessage(result.code === 'stale_preview' ? 'The records changed. Generate a new preview before merging.' : result.message ?? result.code ?? 'Merge failed.'); setState('error'); return }
      // Refresh the parent grid/detail, then keep the dialog open with a
      // persistent success receipt (audit ID + final survivor) per §8.3.6.
      onMerged(result, loserId)
      setReceipt({ result, loserLabel: loser ? label(loser) : 'the duplicate' })
      setState('idle')
    } catch (cause) { setMessage(cause instanceof Error ? cause.message : 'Merge failed.'); setState('error') }
  }
  const loser = options.find(row => row.id === loserId)
  const counts = Object.entries(preview?.preview?.affected_counts ?? {}).filter(([, count]) => count > 0)
  const movingAliases = preview?.preview?.moving_aliases ?? []
  const movingSourceRefs = preview?.preview?.moving_source_refs ?? []

  if (receipt) {
    const finalSurvivor = receipt.result.survivor
    return <div className="editor-backdrop"><div className="editor merge-dialog" role="dialog" aria-modal="true" aria-labelledby="merge-receipt-title">
      <div className="editor-title"><h2 id="merge-receipt-title">Merge complete</h2><button className="close" aria-label="Close merge" onClick={onCancel}><X /></button></div>
      <div className="merge-receipt" role="status">
        <p className="merge-receipt-headline"><CheckCircle2 aria-hidden="true" /> {receipt.loserLabel} was absorbed.</p>
        <dl>
          <dt>Final survivor</dt>
          <dd>{finalSurvivor ? label(finalSurvivor) : label(survivor)}{finalSurvivor?.status ? <span className="muted"> · {String(finalSurvivor.status)}</span> : null}</dd>
          <dt>Audit / operation ID</dt>
          <dd><code>{receipt.result.audit_id ?? 'unknown'}</code></dd>
        </dl>
        <p className="muted">This merge is recorded in the immutable audit history and cannot be automatically undone. The duplicate's old codes and names now resolve through the survivor's aliases and source references.</p>
      </div>
      <div className="editor-actions"><button className="primary" onClick={onCancel}>Done</button></div>
    </div></div>
  }

  return <div className="editor-backdrop"><div className="editor merge-dialog" role="dialog" aria-modal="true" aria-labelledby="merge-title">
    <div className="editor-title"><h2 id="merge-title">Merge duplicate {kind === 'customer' ? 'Customer' : 'Vendor'}</h2><button className="close" aria-label="Close merge" onClick={onCancel}><X /></button></div>
    <div className="merge-survivor"><span>Keep this record</span><strong>{label(survivor)}</strong></div>
    {onSearchCandidates && <div className="merge-candidate-search"><label className="search"><Search aria-hidden="true" /><span className="sr-only">Search for a duplicate not in the loaded grid</span>
      <input placeholder={`Search all ${kind}s for a duplicate…`} value={searchTerm} onChange={event => setSearchTerm(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') void runSearch() }} /></label>
      <button className="secondary" type="button" disabled={searching || !searchTerm.trim()} onClick={() => void runSearch()}>{searching ? 'Searching…' : 'Find duplicates'}</button></div>}
    <label>Duplicate to absorb<select aria-label="Duplicate to absorb" value={loserId} onChange={event => void choose(event.target.value)}><option value="">Select a duplicate…</option>{options.map(row => <option key={row.id} value={row.id}>{label(row)}</option>)}</select></label>
    {state === 'loading' && <p>Building a fresh preview…</p>}
    {preview?.success && loser && <>
      <div className="merge-direction"><strong>{label(loser)}</strong><span>will be absorbed into</span><strong>{label(survivor)}</strong></div>
      <h3>Affected links</h3>{counts.length ? <ul className="merge-counts">{counts.map(([name, count]) => <li key={name}><span>{name}</span><strong>{count}</strong></li>)}</ul> : <p className="muted">No dependent links were found.</p>}
      <h3>Aliases that will move to the survivor</h3>
      {movingAliases.length ? <ul className="merge-moving merge-aliases">{movingAliases.map((alias, index) => <li key={`${alias.alias}-${index}`}><span className="tree-label">{alias.alias}</span>{alias.origin === 'loser_name' ? <span className="badge badge-warn">duplicate's current name</span> : <span className="muted">{alias.alias_type ?? 'alias'}{alias.source_system ? ` · ${alias.source_system}` : ''}</span>}</li>)}</ul> : <p className="muted">No aliases will move.</p>}
      <h3>Source references that will move to the survivor</h3>
      {movingSourceRefs.length ? <ul className="merge-moving merge-source-refs">{movingSourceRefs.map((ref, index) => <li key={`${ref.source_system}-${ref.source_id ?? index}`}><span className="mono">{ref.source_system}{ref.source_table ? `/${ref.source_table}` : ''}</span>{ref.source_code ? <span className="muted"> · {ref.source_code}</span> : null}{ref.source_name ? <span className="muted"> · {ref.source_name}</span> : null}</li>)}</ul> : <p className="muted">No source references will move.</p>}
      {(preview.preview?.conflicts ?? []).length > 0 && <><h3>Resolve every conflict</h3><div className="merge-conflicts">{preview.preview!.conflicts.map(conflict => <fieldset key={conflict.key}><legend>{conflict.app.toUpperCase()} · {conflict.field.replaceAll('_', ' ')}</legend><label><input type="radio" name={conflict.key} checked={resolutions[conflict.key] === 'survivor'} onChange={() => setResolutions(current => ({ ...current, [conflict.key]: 'survivor' }))} /> Keep: {value(conflict.survivor)}</label><label><input type="radio" name={conflict.key} checked={resolutions[conflict.key] === 'loser'} onChange={() => setResolutions(current => ({ ...current, [conflict.key]: 'loser' }))} /> Use duplicate: {value(conflict.loser)}</label></fieldset>)}</div></>}
      <label>Reason<textarea value={reason} onChange={event => setReason(event.target.value)} placeholder="Required for the permanent audit history" /></label>
      <label className="check destructive-confirm"><input type="checkbox" checked={confirmed} onChange={event => setConfirmed(event.target.checked)} /> I confirm the duplicate record will be permanently absorbed. This cannot be automatically undone.</label>
    </>}
    {message && <div className="save-state error" role="alert">{message}</div>}
    <div className="editor-actions"><button className="secondary" onClick={onCancel}>Cancel</button><button className="primary destructive" disabled={!preview?.success || state === 'merging'} onClick={() => void submit()}><GitMerge /> {state === 'merging' ? 'Merging…' : 'Merge records'}</button></div>
  </div></div>
}
