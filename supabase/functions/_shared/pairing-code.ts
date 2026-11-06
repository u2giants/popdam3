/**
 * Single generator for human-typed agent pairing / bootstrap / repair codes (#708).
 *
 * 16 chars from an ambiguous-character-free alphabet (no I/O/0/1), grouped as
 * XXXX-XXXX-XXXX-XXXX. Previously four byte-identical copies lived in
 * agent-handlers.ts and install-bundle-handler.ts; callers keep their own
 * TTL and persistence logic.
 */
export function generatePairingCode(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  let raw = "";
  for (let i = 0; i < 16; i++) raw += chars[bytes[i] % chars.length];
  return `${raw.slice(0, 4)}-${raw.slice(4, 8)}-${raw.slice(8, 12)}-${raw.slice(12, 16)}`;
}
