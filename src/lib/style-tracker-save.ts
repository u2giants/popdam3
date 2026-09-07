export class StyleRowSavedBridgeRefreshError extends Error {
  readonly rowSaved = true;

  constructor(message: string) {
    super(message);
    this.name = "StyleRowSavedBridgeRefreshError";
  }
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
