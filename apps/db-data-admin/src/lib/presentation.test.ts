import { describe, expect, it } from 'vitest'
import { formatBuildLabel, formatEnvironmentLabel, readOAuthCallbackError } from './presentation'

describe('formatEnvironmentLabel', () => {
  it('names the production database when connected to the shared production project', () => {
    expect(formatEnvironmentLabel('https://qsllyeztdwjgirsysgai.supabase.co'))
      .toBe('Production database')
  })

  it('names the preview database when connected to the preview branch project', () => {
    expect(formatEnvironmentLabel('https://rjyboqwcdzcocqgmsyel.supabase.co'))
      .toBe('Preview database')
  })

  // The old literal said "Preview database" everywhere. Production must never be
  // able to render that string again, so assert the inverse explicitly.
  it('never calls the production project a preview', () => {
    expect(formatEnvironmentLabel('https://qsllyeztdwjgirsysgai.supabase.co'))
      .not.toContain('Preview')
  })

  it('reports an unrecognized project rather than guessing', () => {
    expect(formatEnvironmentLabel('https://someotherref123.supabase.co'))
      .toBe('Unrecognized database (someotherref123)')
  })

  it('treats a non-Supabase or empty origin as local', () => {
    expect(formatEnvironmentLabel('http://localhost:54321')).toBe('Local database')
    expect(formatEnvironmentLabel('')).toBe('Local database')
  })
})

describe('readOAuthCallbackError', () => {
  it('reads the Supabase OAuth failure returned in the query string', () => {
    expect(readOAuthCallbackError({
      search: '?error=server_error&error_code=unexpected_failure&error_description=Unable+to+exchange+external+code%3A+1.AX',
      hash: '',
    } as Location)).toEqual({
      code: 'unexpected_failure',
      description: 'Unable to exchange external code: 1.AX',
    })
  })

  it('returns null when the callback contains no error', () => {
    expect(readOAuthCallbackError({ search: '', hash: '' } as Location)).toBeNull()
  })
})

describe('formatBuildLabel', () => {
  it('shows a short commit and readable UTC build date', () => {
    expect(formatBuildLabel('6e1b2cd902676c165eaa11201455c596169807a9', '2026-07-22'))
      .toBe('6e1b2cd · Jul 22, 2026')
  })
})
