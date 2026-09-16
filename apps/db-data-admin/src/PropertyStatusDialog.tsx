import { Save, X } from 'lucide-react'
import { useState } from 'react'
import type { PropertyStatus, PropertyStatusResult } from './lib/data-admin'
import type { PropertyRow } from './lib/property-rows'

type Props = {
  property: PropertyRow
  onCancel: () => void
  onSave: (status: PropertyStatus, reason: string) => Promise<PropertyStatusResult>
  onRefresh: () => void
}

export function PropertyStatusDialog({ property, onCancel, onSave, onRefresh }: Props) {
  const [status, setStatus] = useState<PropertyStatus | ''>(
    property.status === 'active' || property.status === 'inactive' ? property.status : '',
  )
  const [reason, setReason] = useState('')
  const [state, setState] = useState<'idle' | 'saving' | 'saved' | 'error' | 'conflict'>('idle')
  const [message, setMessage] = useState('')

  const submit = async () => {
    if (!status) { setState('error'); setMessage('Choose Active or Inactive.'); return }
    if (!reason.trim()) { setState('error'); setMessage('Explain why this status is needed.'); return }
    setState('saving'); setMessage('Saving…')
    try {
      const result = await onSave(status, reason.trim())
      if (!result.success) {
        setState(result.code === 'stale_token' ? 'conflict' : 'error')
        setMessage(result.code === 'stale_token'
          ? 'This Property changed elsewhere. Refresh the list, then try again.'
          : result.message ?? 'The change was not saved.')
        return
      }
      setState('saved')
      setMessage(result.idempotent_replay ? 'Already saved — this exact change was recorded earlier.' : 'Saved and audited.')
    } catch (cause) {
      setState('error')
      setMessage(cause instanceof Error ? cause.message : 'The change could not be saved.')
    }
  }

  return <div className="editor-backdrop"><div className="editor" role="dialog" aria-modal="true" aria-labelledby="property-status-title">
    <div className="editor-title"><h2 id="property-status-title">Set Property status</h2><button className="close" aria-label="Close status dialog" onClick={onCancel}><X /></button></div>
    <p className="muted"><strong>{property.name}</strong>{property.code ? <> · {property.code}</> : null} — currently {property.status}.</p>
    <label>Status<select value={status} onChange={event => setStatus(event.target.value as PropertyStatus)}>
      <option value="" disabled>Choose status…</option>
      <option value="active">Active</option><option value="inactive">Inactive</option>
    </select><small>Only Active and Inactive are controlled here.</small></label>
    <label>Reason<textarea required value={reason} onChange={event => setReason(event.target.value)} placeholder="Required for the audit history" /></label>
    {message && <div className={`save-state ${state}`} role={state === 'error' || state === 'conflict' ? 'alert' : 'status'}>{message}{state === 'conflict' && <button className="link-button reload-record" type="button" onClick={onRefresh}>Refresh list</button>}</div>}
    <div className="editor-actions"><button className="secondary" onClick={onCancel}>Cancel</button><button className="primary" disabled={state === 'saving' || state === 'saved'} onClick={() => void submit()}><Save /> Save status</button></div>
  </div></div>
}
