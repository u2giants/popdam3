import { render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AppConfig } from './lib/config'

// Mutable so each test can flip allowPasswordLogin before rendering.
const config: AppConfig = {
  supabaseUrl: 'https://preview.example.test',
  supabaseAnonKey: 'public-anon-key',
  authRedirectUrl: 'https://data-dev.designflow.app',
  allowPasswordLogin: false,
}

vi.mock('./lib/config', () => ({ readConfig: () => config }))

vi.mock('./lib/supabase', () => ({
  createSupabase: () => ({
    auth: {
      getSession: () => Promise.resolve({ data: { session: null } }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }),
      signInWithOAuth: () => Promise.resolve({ error: null }),
      signInWithPassword: () => Promise.resolve({ error: null }),
    },
  }),
}))

const { App } = await import('./App')

afterEach(() => {
  config.allowPasswordLogin = false
})

describe('internal password sign-in gate', () => {
  it('hides the password form when the deployment does not opt in', async () => {
    config.allowPasswordLogin = false
    render(<App />)

    // Microsoft SSO remains the only way in.
    await waitFor(() => expect(screen.getByRole('button', { name: /sign in with microsoft/i })).toBeInTheDocument())
    expect(screen.queryByRole('button', { name: /sign in with email/i })).not.toBeInTheDocument()
    expect(screen.queryByLabelText(/password/i)).not.toBeInTheDocument()
  })

  it('shows the password form alongside SSO only when opted in', async () => {
    config.allowPasswordLogin = true
    render(<App />)

    await waitFor(() => expect(screen.getByRole('button', { name: /sign in with email/i })).toBeInTheDocument())
    expect(screen.getByLabelText('Email')).toHaveAttribute('type', 'email')
    expect(screen.getByLabelText('Password')).toHaveAttribute('type', 'password')
    // SSO must never be replaced by the escape hatch.
    expect(screen.getByRole('button', { name: /sign in with microsoft/i })).toBeInTheDocument()
  })
})
