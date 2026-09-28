export class StyleRowSavedBridgeRefreshError extends Error {
  readonly rowSaved = true;

  constructor(message: string) {
    super(message);
    this.name = "StyleRowSavedBridgeRefreshError";
  }
}

export function bridgeWriteCounts(data: unknown, error: unknown): {
  attempted_rows: number; succeeded_rows: number; inserted_rows: number;
  updated_rows: number; base_total_rows: number;
} | null {
  if (error || !Array.isArray(data) || data.length !== 1 || !data[0] || typeof data[0] !== "object") return null;
  const row = data[0] as Record<string, unknown>;
  for (const field of ["inserted_count", "updated_count", "total_count"]) {
    const value = row[field];
    if ((typeof value !== "number" && typeof value !== "string") || String(value).trim() === "") return null;
  }
  const inserted = Number(row.inserted_count);
  const updated = Number(row.updated_count);
  const total = Number(row.total_count);
  if (![inserted, updated, total, inserted + updated].every(Number.isSafeInteger) ||
      inserted < 0 || updated < 0 || total < 0 || inserted + updated < total) return null;
  return { attempted_rows: inserted + updated, succeeded_rows: inserted + updated,
    inserted_rows: inserted, updated_rows: updated, base_total_rows: total };
}

type RpcResult = { error: { message?: string } | null };

export async function refreshStyleTrackerBridgeWithRetry(
  refresh: () => Promise<RpcResult>,
  options: { attempts?: number; delay?: (milliseconds: number) => Promise<void> } = {},
): Promise<void> {
  const attempts = Math.max(1, options.attempts ?? 3);
  const delay = options.delay ?? ((milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
  let lastMessage = "Unknown bridge refresh error";

  for (let attempt = 1; attempt <= attempts; attempt++) {
    const result = await refresh();
    if (!result.error) return;
    lastMessage = result.error.message?.trim() || lastMessage;
    if (attempt < attempts) await delay(250 * 2 ** (attempt - 1));
  }

  throw new StyleRowSavedBridgeRefreshError(
    `The style row was saved, but linked item data could not refresh after ${attempts} attempts: ${lastMessage}`,
  );
}
