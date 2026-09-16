import { Save, X } from 'lucide-react'
import { useMemo, useState } from 'react'
import type { AdminRow, EntityKind, UpdateInput, UpdateResult } from './lib/data-admin'

type Channel = { id: string; name: string }
type Props = { kind: EntityKind; row: AdminRow; channels: Channel[]; onCancel: () => void; onSave: (input: UpdateInput) => Promise<UpdateResult>; onReload?: () => void }

// The record carries each app's current status; reflect it when an app is
// selected so opening the editor never silently defaults a currently-inactive
// app back to Active (which would be an accidental reactivation on save).
function currentAppStatus(row: AdminRow, app: 'crm' | 'pm' | 'dam'): 'active' | 'inactive' {
  return String(row[`${app}_status`] ?? 'active') === 'inactive' ? 'inactive' : 'active'
}

export function RecordEditor({ kind, row, channels, onCancel, onSave, onReload }: Props) {
  const originalChannels = useMemo(() => Array.isArray(row.channels) ? row.channels as Array<{ id: string }> : [], [row.channels])
  const [displayName, setDisplayName] = useState(String(row.display_name ?? ''))
  const [status, setStatus] = useState(String(row.status ?? 'active'))
  const [app, setApp] = useState<'' | 'crm' | 'pm' | 'dam'>('')
  const [appStatus, setAppStatus] = useState<'active' | 'inactive'>('active')
  const [channelIds, setChannelIds] = useState(originalChannels.map(channel => channel.id))
  const [reason, setReason] = useState('')
  const [state, setState] = useState<'idle' | 'saving' | 'saved' | 'error' | 'conflict'>('idle')
  const [message, setMessage] = useState('')

  const submit = async () => {
    if (!reason.trim()) { setState('error'); setMessage('Explain why this change is needed.'); return }
    setState('saving'); setMessage('Saving…')
    try {
      const result = await onSave({
        expectedUpdatedAt: String(row.updated_at), reason: reason.trim(),
        displayName: displayName === String(row.display_name ?? '') ? null : displayName,
        status: status === String(row.status ?? '') ? null : status,
        app: app || null, appStatus: app ? appStatus : null,
        channelIds: kind === 'customer' && channelIds.join(',') !== originalChannels.map(channel => channel.id).join(',') ? channelIds : null,
      })
      if (!result.success) {
        setState(result.code === 'stale_token' ? 'conflict' : 'error')
        setMessage(result.code === 'stale_token' ? 'This record changed elsewhere. Reload it before saving.' : result.message ?? 'The change was not saved.')
        return
      }
      setState('saved'); setMessage('Saved and audited.')
    } catch (cause) { setState('error'); setMessage(cause instanceof Error ? cause.message : 'The change could not be saved.') }
  }

  return <div className="editor-backdrop"><div className="editor" role="dialog" aria-modal="true" aria-labelledby="editor-title">
    <div className="editor-title"><h2 id="editor-title">Edit {kind === 'customer' ? 'Customer' : 'Vendor'}</h2><button className="close" aria-label="Close editor" onClick={onCancel}><X /></button></div>
    <label>Curated display name<input value={displayName} onChange={event => setDisplayName(event.target.value)} /></label>
    <label>Global status<select value={status} onChange={event => setStatus(event.target.value)}><option value="active">Active</option><option value="potential">Potential</option><option value="inactive">Inactive</option></select><small>Affects every application.</small></label>
    <div className="editor-split"><label>Application<select value={app} onChange={event => { const next = event.target.value as typeof app; setApp(next); if (next) setAppStatus(currentAppStatus(row, next)) }}><option value="">No app-status change</option><option value="crm">CRM</option><option value="pm">PM/PIM</option><option value="dam">DAM</option></select></label><label>Application status<select disabled={!app} value={appStatus} onChange={event => setAppStatus(event.target.value as typeof appStatus)}><option value="active">Active</option><option value="inactive">Inactive</option></select>{app && <small>Currently {currentAppStatus(row, app)} in {app.toUpperCase()}.</small>}</label></div>
    {kind === 'customer' && <fieldset><legend>Channels</legend>{channels.map(channel => <label className="check" key={channel.id}><input type="checkbox" checked={channelIds.includes(channel.id)} onChange={event => setChannelIds(current => event.target.checked ? [...current, channel.id] : current.filter(id => id !== channel.id))} />{channel.name}</label>)}</fieldset>}
    <label>Reason<textarea required value={reason} onChange={event => setReason(event.target.value)} placeholder="Required for the audit history" /></label>
    {message && <div className={`save-state ${state}`} role={state === 'error' || state === 'conflict' ? 'alert' : 'status'}>{message}{state === 'conflict' && onReload && <button className="link-button reload-record" type="button" onClick={onReload}>Reload record</button>}</div>}
    <div className="editor-actions"><button className="secondary" onClick={onCancel}>Cancel</button><button className="primary" disabled={state === 'saving' || state === 'saved'} onClick={() => void submit()}><Save /> Save change</button></div>
  </div></div>
}
