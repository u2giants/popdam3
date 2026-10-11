/** Lowercase hex encoding of raw bytes. */
export function toHex(bytes: Uint8Array): string {
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** SHA-256 of a UTF-8 string, returned as lowercase hex. */
export async function sha256Hex(message: string): Promise<string> {
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(message));
  return toHex(new Uint8Array(hash));
}
