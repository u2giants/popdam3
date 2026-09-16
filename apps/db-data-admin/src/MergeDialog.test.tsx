import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MergeDialog } from './MergeDialog'

afterEach(cleanup)

const survivor = { id: 's', display_name: 'Keep Me' }
const loser = { id: 'l', display_name: 'Duplicate Me' }
const preview = { success: true, preview_token: 'token', preview: { entity_type: 'customer' as const, survivor, loser, affected_counts: { 'core.company_source_ref.company_id': 2 }, conflicts: [{ key: 'crm.status', app: 'crm', field: 'status', survivor: 'active', loser: 'inactive' }] } }

const movingPreview = { success: true, preview_token: 'token', preview: { entity_type: 'customer' as const, survivor, loser, affected_counts: {}, conflicts: [],
  moving_aliases: [
    { alias: 'Legacy Dupe Co', alias_type: 'legacy', source_system: 'coldlion', origin: 'existing_alias' as const },
    { alias: 'Duplicate Me', alias_type: 'merged_name', source_system: 'db_data_admin_merge', origin: 'loser_name' as const },
  ],
  moving_source_refs: [{ source_system: 'coldlion', source_table: 'customers', source_id: 'C-9', source_code: 'OLD-9', source_name: 'Old Dupe' }] } }

describe('MergeDialog', () => {
  it('shows the exact aliases and source references that will move to the survivor', async () => {
    const onPreview = vi.fn().mockResolvedValue(movingPreview)
    render(<MergeDialog kind="customer" survivor={survivor} candidates={[loser]} onCancel={vi.fn()} onPreview={onPreview} onMerge={vi.fn()} onMerged={vi.fn()} />)
    fireEvent.change(screen.getByLabelText('Duplicate to absorb'), { target: { value: 'l' } })
    expect(await screen.findByText('Aliases that will move to the survivor')).toBeInTheDocument()
    expect(screen.getByText('Legacy Dupe Co')).toBeInTheDocument()
    expect(screen.getByText(/duplicate's current name/i)).toBeInTheDocument()
    expect(screen.getByText('Source references that will move to the survivor')).toBeInTheDocument()
    expect(screen.getByText(/coldlion\/customers/)).toBeInTheDocument()
  })

  it('reaches a duplicate outside the loaded grid through candidate search', async () => {
    const outside = { id: 'x', display_name: 'Hidden Dupe' }
    const onSearchCandidates = vi.fn().mockResolvedValue([outside])
    render(<MergeDialog kind="customer" survivor={survivor} candidates={[]} onCancel={vi.fn()} onPreview={vi.fn()} onMerge={vi.fn()} onMerged={vi.fn()} onSearchCandidates={onSearchCandidates} />)
    fireEvent.change(screen.getByPlaceholderText(/search all customers/i), { target: { value: 'hidden' } })
    fireEvent.click(screen.getByRole('button', { name: /find duplicates/i }))
    await waitFor(() => expect(onSearchCandidates).toHaveBeenCalledWith('hidden'))
    expect(await screen.findByRole('option', { name: 'Hidden Dupe' })).toBeInTheDocument()
  })

  it('shows an accessible success receipt with the final survivor and audit ID', async () => {
    const onPreview = vi.fn().mockResolvedValue(movingPreview)
    const onMerge = vi.fn().mockResolvedValue({ success: true, survivor: { id: 's', display_name: 'Keep Me', status: 'active' }, audit_id: 'op-42' })
    const onMerged = vi.fn()
    render(<MergeDialog kind="customer" survivor={survivor} candidates={[loser]} onCancel={vi.fn()} onPreview={onPreview} onMerge={onMerge} onMerged={onMerged} />)
    fireEvent.change(screen.getByLabelText('Duplicate to absorb'), { target: { value: 'l' } })
    await screen.findByText('Aliases that will move to the survivor')
    fireEvent.change(screen.getByPlaceholderText(/permanent audit/i), { target: { value: 'Verified duplicate' } })
    fireEvent.click(screen.getByLabelText(/I confirm/))
    fireEvent.click(screen.getByRole('button', { name: 'Merge records' }))
    const receipt = await screen.findByRole('status')
    expect(receipt).toHaveTextContent('was absorbed')
    expect(screen.getByRole('heading', { name: 'Merge complete' })).toBeInTheDocument()
    expect(screen.getByText('op-42')).toBeInTheDocument()
    expect(screen.getByText('Keep Me')).toBeInTheDocument()
    expect(onMerged).toHaveBeenCalledWith(expect.objectContaining({ audit_id: 'op-42' }), 'l')
  })

  it('requires conflict resolution, reason, and destructive confirmation', async () => {
    const onPreview = vi.fn().mockResolvedValue(preview)
    const onMerge = vi.fn().mockResolvedValue({ success: true, survivor, audit_id: 'audit' })
    render(<MergeDialog kind="customer" survivor={survivor} candidates={[loser]} onCancel={vi.fn()} onPreview={onPreview} onMerge={onMerge} onMerged={vi.fn()} />)
    fireEvent.change(screen.getByLabelText('Duplicate to absorb'), { target: { value: 'l' } })
    await screen.findByText('Resolve every conflict')
    fireEvent.click(screen.getByRole('button', { name: 'Merge records' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Explain why')
    fireEvent.change(screen.getByPlaceholderText(/permanent audit/i), { target: { value: 'Verified duplicate' } })
    fireEvent.click(screen.getByLabelText(/Keep: active/))
    fireEvent.click(screen.getByLabelText(/I confirm/))
    fireEvent.click(screen.getByRole('button', { name: 'Merge records' }))
    await waitFor(() => expect(onMerge).toHaveBeenCalledWith('l', 'token', 'Verified duplicate', { 'crm.status': 'survivor' }))
  })
})
