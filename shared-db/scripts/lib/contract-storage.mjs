// #5426: keep immutable report identities while retiring author-lane storage.
// Historical JSON is never rewritten. Only its physical Git ref moves; callers
// still validate the original issue/generation and the original commit bytes.
export const LEGACY_CONTRACT_PREFIX = 'refs/db-contracts'
export const CONTRACT_STORAGE_PREFIX = 'refs/db-evidence/contracts'

export function contractStorageRef(ref) {
  const value = String(ref)
  return value === LEGACY_CONTRACT_PREFIX || value.startsWith(`${LEGACY_CONTRACT_PREFIX}/`)
    ? CONTRACT_STORAGE_PREFIX + value.slice(LEGACY_CONTRACT_PREFIX.length)
    : value
}

export function contractLogicalRef(ref) {
  const value = String(ref)
  return value === CONTRACT_STORAGE_PREFIX || value.startsWith(`${CONTRACT_STORAGE_PREFIX}/`)
    ? LEGACY_CONTRACT_PREFIX + value.slice(CONTRACT_STORAGE_PREFIX.length)
    : value
}
