// Which NAS password the Windows render agent receives (#179 item 3a).
// The Vault value wins whenever it is non-empty. An RPC error, a null, or an
// empty string falls back to the admin_config row, so a failed or unset Vault
// read can never blank a working credential.
export function pickWindowsNasPassword(vaultValue: unknown, fallback: unknown): string {
  if (typeof vaultValue === "string" && vaultValue !== "") return vaultValue;
  return typeof fallback === "string" ? fallback : "";
}
