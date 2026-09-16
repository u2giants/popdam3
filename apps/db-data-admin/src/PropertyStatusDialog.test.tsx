import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PropertyStatusDialog } from './PropertyStatusDialog'
import type { PropertyRow } from './lib/property-rows'

const property: PropertyRow = {
  id: 'p-avengers', name: 'Avengers', code: 'AVG', status: 'active',
  licensor_name: 'Marvel', licensor_code: 'MRV', character_count: 5,
  source_display: '', plm_display: '', is_orphan: false,
  updated_at: '2026-08-20T12:00:00Z',
}

afterEach(cleanup)

describe('PropertyStatusDialog', () => {
  it('offers only Active and Inactive and requires a reason', () => {
    const onSave = vi.fn()
    render(<PropertyStatusDialog property={property} onCancel={() => undefined} onSave={onSave} onRefresh={() => undefined} />)
    const select = screen.getByLabelText(/^Status/) as HTMLSelectElement
    expect([...select.options].map(option => option.value)).toEqual(['', 'active', 'inactive'])
    expect(select.options[0].disabled).toBe(true)
    expect(select.value).toBe('active')
    fireEvent.click(screen.getByRole('button', { name: /save status/i }))
    expect(screen.getByRole('alert')).toHaveTextContent('Explain why this status is needed.')
    expect(onSave).not.toHaveBeenCalled()
  })

  it('requires an explicit choice for a potential Property', () => {
    const onSave = vi.fn()
    render(<PropertyStatusDialog property={{ ...property, status: 'potential' }} onCancel={() => undefined} onSave={onSave} onRefresh={() => undefined} />)
    fireEvent.change(screen.getByLabelText('Reason'), { target: { value: 'Owner decision' } })
    fireEvent.click(screen.getByRole('button', { name: /save status/i }))
    expect(screen.getByRole('alert')).toHaveTextContent('Choose Active or Inactive.')
    expect(onSave).not.toHaveBeenCalled()
  })

  it('submits the transition with a trimmed reason', async () => {
    const onSave = vi.fn().mockResolvedValue({ success: true, idempotent_replay: false })
    render(<PropertyStatusDialog property={property} onCancel={() => undefined} onSave={onSave} onRefresh={() => undefined} />)
    fireEvent.change(screen.getByLabelText(/^Status/), { target: { value: 'inactive' } })
    fireEvent.change(screen.getByLabelText('Reason'), { target: { value: '  Licence lapsed  ' } })
    fireEvent.click(screen.getByRole('button', { name: /save status/i }))
    await screen.findByText('Saved and audited.')
    expect(onSave).toHaveBeenCalledWith('inactive', 'Licence lapsed')
  })

  it('requires an explicit refresh after a stale-row refusal', async () => {
    const onSave = vi.fn().mockResolvedValue({ success: false, code: 'stale_token' })
    const onRefresh = vi.fn()
    render(<PropertyStatusDialog property={property} onCancel={() => undefined} onSave={onSave} onRefresh={onRefresh} />)
    fireEvent.change(screen.getByLabelText('Reason'), { target: { value: 'Licence lapsed' } })
    fireEvent.click(screen.getByRole('button', { name: /save status/i }))
    expect(await screen.findByRole('alert')).toHaveTextContent('changed elsewhere')
    fireEvent.click(screen.getByRole('button', { name: /refresh list/i }))
    expect(onRefresh).toHaveBeenCalledOnce()
  })
})
