// Single-flight, coalescing gate around public.refresh_style_group_counts_batch
// (and its companion refresh_style_group_primaries). See issue #294.
//
// The RPC waits forever on style_groups row locks (lock_timeout = 0), so
// overlapping callers stack unbounded waits. Within one edge-function isolate
// this module guarantees:
//   - at most one refresh RPC in flight at a time;
//   - requests arriving while one is in flight are merged (deduplicated) into
//     a single follow-up run, so duplicate delivery costs one call, not many;
//   - group ids are sorted so concurrent sessions lock rows in the same order;
//   - transient failures are retried with backoff, and the final failure is
//     returned (never swallowed) so callers can surface it.
// Cross-process serialization against the nightly pg_cron job needs a DB-side
// advisory lock; that is tracked in popcre/shared-db (linked on #294).

export interface RpcClient {
  rpc(fn: string, args: Record<string, unknown>): PromiseLike<{ error: { message: string } | null }>;
}

export interface RefreshResult {
  ok: boolean;
  groups: number;
  attempts: number;
  error?: string;
}

export interface RefreshOptions {
  includePrimaries?: boolean;
  maxAttempts?: number;
  backoffMs?: number;
  chunkSize?: number;
  sleep?: (ms: number) => Promise<void>;
}

interface Waiter {
  ids: Set<string>;
  primaries: boolean;
  resolve: (r: RefreshResult) => void;
}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export function createStyleGroupCountsRefresher(opts: RefreshOptions = {}) {
  const maxAttempts = opts.maxAttempts ?? 3;
  const backoffMs = opts.backoffMs ?? 500;
  const chunkSize = opts.chunkSize ?? 1000;
  const sleep = opts.sleep ?? defaultSleep;

  let running: Promise<void> | null = null;
  let pending: Waiter[] = [];
  let pendingClient: RpcClient | null = null;

  async function callWithRetry(db: RpcClient, fn: string, ids: string[]): Promise<{ error?: string; attempts: number }> {
    let last = "";
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        const { error } = await db.rpc(fn, { p_group_ids: ids });
        if (!error) return { attempts: attempt };
        last = error.message;
      } catch (e) {
        last = (e as Error).message;
      }
      if (attempt < maxAttempts) await sleep(backoffMs * 2 ** (attempt - 1));
    }
    return { error: `${fn} failed after ${maxAttempts} attempts: ${last}`, attempts: maxAttempts };
  }

  async function runBatch(db: RpcClient, waiters: Waiter[]) {
    const all = new Set<string>();
    const prim = new Set<string>();
    for (const w of waiters) for (const id of w.ids) {
      all.add(id);
      if (w.primaries) prim.add(id);
    }
    const sorted = [...all].sort();
    const failed = new Map<string, string>();
    let attempts = 0;
    for (let i = 0; i < sorted.length; i += chunkSize) {
      const chunk = sorted.slice(i, i + chunkSize);
      const c = await callWithRetry(db, "refresh_style_group_counts_batch", chunk);
      attempts += c.attempts;
      if (c.error) { for (const id of chunk) failed.set(id, c.error); continue; }
      const primChunk = chunk.filter((id) => prim.has(id));
      if (primChunk.length > 0) {
        const p = await callWithRetry(db, "refresh_style_group_primaries", primChunk);
        attempts += p.attempts;
        if (p.error) for (const id of primChunk) failed.set(id, p.error);
      }
    }
    for (const w of waiters) {
      const err = [...w.ids].map((id) => failed.get(id)).find(Boolean);
      if (err) console.error(`style-group counts refresh failed for ${w.ids.size} group(s): ${err}`);
      w.resolve({ ok: !err, groups: w.ids.size, attempts, ...(err ? { error: err } : {}) });
    }
  }

  async function drain() {
    while (pending.length > 0) {
      const batch = pending;
      const db = pendingClient!;
      pending = [];
      pendingClient = null;
      try {
        await runBatch(db, batch);
      } catch (e) {
        for (const w of batch) w.resolve({ ok: false, groups: w.ids.size, attempts: 0, error: (e as Error).message });
      }
    }
    running = null;
  }

  return function refresh(db: RpcClient, groupIds: Iterable<string | null | undefined>, o: { includePrimaries?: boolean } = {}): Promise<RefreshResult> {
    const ids = new Set<string>();
    for (const id of groupIds) if (id) ids.add(id);
    if (ids.size === 0) return Promise.resolve({ ok: true, groups: 0, attempts: 0 });
    return new Promise<RefreshResult>((resolve) => {
      pending.push({ ids, primaries: o.includePrimaries ?? opts.includePrimaries ?? true, resolve });
      pendingClient = pendingClient ?? db;
      if (!running) running = Promise.resolve().then(drain);
    });
  };
}

/** Process-wide (per-isolate) refresher shared by every admin handler. */
export const refreshStyleGroupCounts = createStyleGroupCountsRefresher();
