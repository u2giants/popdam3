export interface OAuthCallbackError {
  code: string
  description: string
}

export function readOAuthCallbackError(location: Pick<Location, 'search' | 'hash'>): OAuthCallbackError | null {
  const search = new URLSearchParams(location.search)
  const hash = new URLSearchParams(location.hash.replace(/^#/, ''))
  const code = search.get('error_code') || search.get('error') || hash.get('error_code') || hash.get('error')
  const description = search.get('error_description') || hash.get('error_description')

  if (!code && !description) return null

  return {
    code: code || 'sign_in_failed',
    description: description || 'Microsoft sign-in did not complete.',
  }
}

/**
 * The database this deployment is actually talking to, named for the operator.
 *
 * The workspace bar used to print the literal string "Preview database" no matter
 * where it ran, which would have told every user of DB Data Admin in production at
 * its own hostname data.designflow.app that they were safely poking a preview copy
 * while they edited the database four live applications share. That is exactly the
 * kind of silent mislabel this repository refuses to ship.
 *
 * The label is DERIVED from the Supabase project ref the app is genuinely connected
 * to, never from a separate environment variable someone can set wrong or forget.
 * An unrecognized project is reported as unrecognized rather than guessed at.
 */
export function formatEnvironmentLabel(supabaseUrl: string): string {
  const ref = /^https?:\/\/([a-z0-9-]+)\.supabase\.(co|in)/i.exec(supabaseUrl ?? '')?.[1]

  if (ref === 'qsllyeztdwjgirsysgai') return 'Production database'
  if (ref === 'rjyboqwcdzcocqgmsyel') return 'Preview database'
  if (!ref) return 'Local database'
  return `Unrecognized database (${ref})`
}

export function formatBuildLabel(sha: string, buildDate: string): string {
  const shortSha = sha === 'dev' || sha === 'unknown' ? sha : sha.slice(0, 7)
  if (!buildDate || buildDate === 'dev') return shortSha

  const date = new Date(`${buildDate}T00:00:00Z`)
  if (Number.isNaN(date.valueOf())) return shortSha

  return `${shortSha} · ${new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(date)}`
}
