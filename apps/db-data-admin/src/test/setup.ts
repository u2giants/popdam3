import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterEach } from 'vitest'

// Testing Library only auto-cleans when Vitest runs with `globals: true`, which this
// project does not enable. Without this, every render stays mounted for the rest of the
// file and later queries match elements from earlier tests (a `getBy*` then throws
// "found multiple elements", which pretty-format reports as a confusing
// "Cannot destructure property 'tagName' of 'val' as it is null" crash).
afterEach(() => {
  cleanup()
})
