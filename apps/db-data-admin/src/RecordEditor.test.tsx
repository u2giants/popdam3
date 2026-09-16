import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { RecordEditor } from './RecordEditor'

const row = { id: '1', display_name: 'Acme', status: 'active', updated_at: '2026-07-22T12:00:00Z', channels: [] }
afterEach(cleanup)

describe('RecordEditor', () => {
  it('requires an audit reason before calling the update RPC', () => {
    const onSave = vi.fn()
    render(<RecordEditor kind="customer" row={row} channels={[]} onCancel={() => undefined} onSave={onSave} />)
    fireEvent.click(screen.getByRole('button', { name: /save change/i }))
    expect(screen.getByRole('alert')).toHaveTextContent('Explain why')
    expect(onSave).not.toHaveBeenCalled()
  })

  it('shows a loud conflict state for a stale token and offers reload recovery', async () => {
    const onSave = vi.fn().mockResolvedValue({ success: false, code: 'stale_token' })
    const onReload = vi.fn()
    render(<RecordEditor kind="vendor" row={row} channels={[]} onCancel={() => undefined} onSave={onSave} onReload={onReload} />)
    fireEvent.change(screen.getByLabelText('Reason'), { target: { value: 'Correct the name' } })
    fireEvent.click(screen.getByRole('button', { name: /save change/i }))
    expect(await screen.findByRole('alert')).toHaveTextContent('changed elsewhere')
    fireEvent.click(screen.getByRole('button', { name: /reload record/i }))
    expect(onReload).toHaveBeenCalledTimes(1)
  })

  it('reflects an application’s current status instead of silently defaulting to Active', () => {
    // Selecting PM must adopt the record's current PM status (inactive), so a
    // save never accidentally reactivates a currently-inactive application.
    const inactivePm = { ...row, pm_status: 'inactive' }
    render(<RecordEditor kind="customer" row={inactivePm} channels={[]} onCancel={() => undefined} onSave={vi.fn()} />)
    const appStatus = screen.getByLabelText('Application status') as HTMLSelectElement
    expect(appStatus.value).toBe('active')
    fireEvent.change(screen.getByLabelText('Application'), { target: { value: 'pm' } })
    expect(appStatus.value).toBe('inactive')
    expect(screen.getByText(/currently inactive in pm/i)).toBeInTheDocument()
  })
})
