/** Browser and Deno shared code: keep this dependency-free. Access denial never selects another route. */
export function searchAccessStatus(error: unknown): 401 | 403 | null {
  if (!error || typeof error !== "object") return null;
  const row = error as { status?: unknown; context?: { status?: unknown }; code?: unknown };
  const status = row.context?.status ?? row.status;
  if (status === 401 || row.code === "PGRST301" || row.code === "PGRST302" || row.code === "28000") return 401;
  if (status === 403 || row.code === "42501") return 403;
  return null;
}

type ReadResult = { data: unknown; error: unknown };

/** Use exactly the ranked-search authority, including its canonical administrator bypass. */
export async function loadDamSearchMode(
  caller: { rpc(name: "require_dam_access"): PromiseLike<ReadResult> },
  readMode: () => PromiseLike<ReadResult>,
): Promise<"keyword" | "hybrid"> {
  const access = await caller.rpc("require_dam_access");
  if (access.error) throw access.error;
  if (access.data !== true) throw Object.assign(new Error("DAM access required"), { status: 403 });
  const config = await readMode();
  if (config.error) throw config.error;
  const row = config.data as { value?: unknown } | null;
  const value = row?.value;
  const unwrapped = value && typeof value === "object" && "value" in value ? (value as { value: unknown }).value : value;
  return unwrapped === "hybrid" ? "hybrid" : "keyword";
}
