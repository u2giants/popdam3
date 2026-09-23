export function isDirectGeminiBatchModelId(value: unknown): value is string {
  // Trim like the worker does, so padding cannot bypass the Google-key check.
  if (typeof value !== "string") return false;
  const id = value.trim();
  return id.startsWith("google-direct/") && id.endsWith(":batch");
}

/** Any provider's asynchronous `:batch` variant (OpenRouter or direct Gemini). */
export function isBatchOnlyModelId(value: unknown): value is string {
  return typeof value === "string" && value.trim().endsWith(":batch");
}

/** Batch-only models run only through the durable primary Image Tagging path. */
export function directGeminiBatchAllowedForServerConsumer(value: unknown, consumer: string): boolean {
  return !isBatchOnlyModelId(value) || consumer === "vision_tagging_primary";
}

export function directGeminiBatchSelectionHasKey(taskModels: unknown, googleKey: unknown): boolean {
  if (!taskModels || typeof taskModels !== "object" || Array.isArray(taskModels)) return true;
  const selected = (taskModels as Record<string, unknown>).vision_tagging;
  return !isDirectGeminiBatchModelId(selected) || (typeof googleKey === "string" && googleKey.trim().length > 0);
}

export async function safeSecretFingerprint(secret: string): Promise<string> {
  if (!secret) return "none";
  const bytes = new TextEncoder().encode(secret);
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return `sha256:${Array.from(new Uint8Array(digest)).slice(0, 12).map((value) => value.toString(16).padStart(2, "0")).join("")}`;
}
