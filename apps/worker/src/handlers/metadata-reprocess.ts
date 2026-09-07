import { config } from "../config.js";
import type { BatchResult, OpState } from "../types.js";

type FetchLike = typeof fetch;

export async function handleReprocessMetadata(
  op: OpState,
  fetchImpl: FetchLike = fetch,
): Promise<BatchResult> {
  const offset = typeof op.cursor === "number" ? op.cursor : 0;
  const response = await fetchImpl(`${config.supabaseUrl}/functions/v1/admin-api`, {
    method: "POST",
    headers: {
      apikey: config.supabaseServiceRoleKey,
      Authorization: `Bearer ${config.supabaseServiceRoleKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      action: "reprocess-asset-metadata",
      offset,
      batch_size: 25,
    }),
  });

  const text = await response.text();
  let data: Record<string, unknown> = {};
  try {
    data = JSON.parse(text) as Record<string, unknown>;
  } catch {
    // The caller needs a useful error even when an upstream gateway returns HTML.
  }

  if (!response.ok || data.ok === false) {
    const detail = typeof data.error === "string" && data.error.trim()
      ? data.error.trim()
      : `HTTP ${response.status}`;
    return { ok: false, done: false, error: `Metadata reprocess failed: ${detail}` };
  }

  return {
    ok: true,
    done: data.done === true,
    nextOffset: typeof data.nextOffset === "number" ? data.nextOffset : null,
    checked: Number(data.total ?? 0),
    updated: Number(data.updated ?? 0),
    unresolved_licensor: Number(data.unresolved_licensor ?? 0),
    unresolved_property: Number(data.unresolved_property ?? 0),
    total_count: Number(data.grand_total ?? 0),
  };
}
