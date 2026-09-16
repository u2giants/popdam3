import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { DataAdmin } from './DataAdmin'

afterEach(cleanup)

describe('Property Status navigation', () => {
  it('offers the narrow status control without restoring the removed Properties screen', () => {
    render(<DataAdmin client={{ rpc: async () => ({ data: [], error: null }) } as never} email="owner@example.com" environmentLabel="Test" onSignOut={() => undefined} />)
    expect(screen.getByRole('button', { name: 'Property Status' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Properties' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Licensors' })).not.toBeInTheDocument()
  })
})
