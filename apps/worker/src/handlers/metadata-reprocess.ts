import { config } from "../config.js";
import type { BatchResult, OpState } from "../types.js";

type FetchLike = typeof fetch;

export async function handleReprocessMetadata(
  op: OpState,
  fetchImpl: FetchLike = fetch,
  edgeKey = config.supabaseSecretKey || config.supabaseServiceRoleKey,
): Promise<BatchResult> {
  const fillMode = op.params?.mode === "fill-missing-licensing";
  if (op.params?.mode !== undefined && op.params?.mode !== null && !fillMode) {
    return { ok: false, done: false, error: `Metadata reprocess failed: unknown mode ${String(op.params.mode)}` };
  }
  if (!fillMode && typeof op.cursor === "string") {
    // A UUID cursor belongs to fill mode; never silently restart a full pass at 0.
    return { ok: false, done: false, error: "Metadata reprocess failed: keyset cursor without fill-missing-licensing mode" };
  }
  const offset = typeof op.cursor === "number" ? op.cursor : 0;
  const payload: Record<string, unknown> = fillMode
    ? { action: "reprocess-asset-metadata", mode: "fill-missing-licensing", after_id: typeof op.cursor === "string" ? op.cursor : null, batch_size: 25 }
    : { action: "reprocess-asset-metadata", offset, batch_size: 25 };
  const response = await fetchImpl(`${config.supabaseUrl}/functions/v1/admin-api`, {
    method: "POST",
    // A hung edge invocation must not block the single worker loop forever.
    signal: AbortSignal.timeout(120_000),
    headers: {
      apikey: edgeKey,
      Authorization: `Bearer ${edgeKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
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
    nextOffset: typeof data.nextOffset === "number" || typeof data.nextOffset === "string" ? data.nextOffset : null,
    checked: Number(data.total ?? 0),
    updated: Number(data.updated ?? 0),
    unresolved_licensor: Number(data.unresolved_licensor ?? 0),
    unresolved_property: Number(data.unresolved_property ?? 0),
    total_count: Number(data.grand_total ?? 0),
  };
}
