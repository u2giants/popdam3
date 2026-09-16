/**
 * jsdom stand-in for `@revolist/react-datagrid`.
 *
 * WHY THIS EXISTS (issue #1186). RevoGrid is a Stencil web component. Under jsdom it
 * hydrates asynchronously and keeps timers alive that can outlive the environment, at
 * which point a debounced resize fires against a torn-down DOM and throws
 * "Failed to execute 'dispatchEvent' on 'EventTarget'". Vitest counts that unhandled
 * rejection against the run, so `npm test` exited non-zero while all 104 tests passed —
 * and `verify` is a REQUIRED check, so a coin-flip gate was teaching every session to
 * hit re-run instead of reading the failure.
 *
 * WHY THIS LOSES NO COVERAGE. No jsdom test asserts anything the real grid renders; they
 * assert our own surrounding UI (row counts, orphan warnings, the workspace bar) and our
 * column/row builders, which are unit-tested directly under `src/lib/`. The real grid is
 * covered by the Playwright suite in `tests/browser/grid.spec.ts`, which runs in a real
 * browser where the component actually works.
 *
 * WHY IT IS NOT A SILENT FAILURE. This stub does not swallow errors — it removes the
 * component that produced them. The alternative considered and rejected was a Vitest
 * `onUnhandledError` filter, which would have hidden genuine unhandled errors too and
 * traded a visible flake for an invisible one. The stub also renders its row count, so a
 * test that cares how many rows reached the grid can still assert on it.
 *
 * Wired in by the `resolve.alias` entry in `vite.config.ts`, which applies to the test
 * run only. The real package is still what the application bundles and ships.
 */
import type { ReactNode } from 'react'

type StubGridProps = {
  source?: unknown[]
  columns?: unknown[]
  [key: string]: unknown
}

export function RevoGrid({ source, columns }: StubGridProps): ReactNode {
  return (
    <div
      data-testid="revogrid-stub"
      data-row-count={String(source?.length ?? 0)}
      data-column-count={String(columns?.length ?? 0)}
    />
  )
}

/** Passthrough. The stub grid never renders column templates, so this is never invoked. */
export function Template<T>(component: T, props?: unknown): unknown {
  return { component, props }
}

/** Passthrough. The stub grid never instantiates editors, so this is never invoked. */
export function Editor<T>(component: T): unknown {
  return component
}
