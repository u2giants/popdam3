import { afterEach, describe, expect, it } from 'vitest'
import { readConfig } from './config'

afterEach(() => {
  delete window.__DB_DATA_ADMIN_CONFIG__
})

describe('readConfig', () => {
  it('prefers Coolify-owned runtime configuration', () => {
    window.__DB_DATA_ADMIN_CONFIG__ = {
      supabaseUrl: 'https://preview.example.test',
      supabaseAnonKey: 'public-anon-key',
      authRedirectUrl: 'https://data-dev.designflow.app',
    }

    expect(readConfig()).toEqual({ ...window.__DB_DATA_ADMIN_CONFIG__, allowPasswordLogin: false })
  })

  it('rejects an incomplete runtime configuration', () => {
    window.__DB_DATA_ADMIN_CONFIG__ = { supabaseUrl: 'https://preview.example.test' }
    expect(readConfig()).toBeNull()
  })

  // The password form is a development-only escape hatch. Production leaves the
  // nginx variable unset, which envsubst renders as '' — that must stay disabled.
  it.each([
    ['true', true],
    [true, true],
    ['', false],
    ['false', false],
    ['TRUE', false],
    [undefined, false],
  ])('treats allowPasswordLogin %p as %p', (given, expected) => {
    window.__DB_DATA_ADMIN_CONFIG__ = {
      supabaseUrl: 'https://preview.example.test',
      supabaseAnonKey: 'public-anon-key',
      authRedirectUrl: 'https://data-dev.designflow.app',
      allowPasswordLogin: given as boolean | string | undefined,
    }

    expect(readConfig()?.allowPasswordLogin).toBe(expected)
  })
})
