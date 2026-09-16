import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { App } from './App'

vi.mock('./lib/config', () => ({ readConfig: () => null }))

describe('App', () => {
  it('shows the preview configuration gate without exposing an app surface', () => {
    render(<App />)
    expect(screen.getByRole('heading', { name: /canonical data/i })).toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent('Preview configuration is missing')
    expect(screen.queryByRole('button', { name: /sign in/i })).not.toBeInTheDocument()
  })
})
