import { useCallback, useEffect, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";

export type BulkOperationOutcome =
  | { status: "completed" }
  | { status: "failed"; error: string }
  | { status: "timeout" }
  | { status: "aborted" };

export interface WaitForBulkOperationOptions {
  maxWaitMs?: number;
  pollMs?: number;
}

const sleep = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve) => {
    if (signal.aborted) return resolve();
    const onAbort = () => {
      clearTimeout(t);
      resolve();
    };
    const t = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal.addEventListener("abort", onAbort, { once: true });
  });

/**
 * Poll admin_config.BULK_OPERATIONS until `opKey` completes, fails, the
 * deadline passes, or `signal` aborts. A missing op record counts as completed.
 */
export async function waitForBulkOperation(
  opKey: string,
  signal: AbortSignal,
  { maxWaitMs = 90_000, pollMs = 2_000 }: WaitForBulkOperationOptions = {},
): Promise<BulkOperationOutcome> {
  const start = Date.now();
  while (Date.now() - start < maxWaitMs) {
    await sleep(pollMs, signal);
    if (signal.aborted) return { status: "aborted" };
    const { data: configRow } = await supabase
      .from("admin_config")
      .select("value")
      .eq("key", "BULK_OPERATIONS")
      .maybeSingle();
    if (signal.aborted) return { status: "aborted" };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const ops = configRow?.value as Record<string, any> | undefined;
    const op = ops?.[opKey];
    if (!op || op.status === "completed") return { status: "completed" };
    if (op.status === "failed" || op.status === "interrupted") {
      return { status: "failed", error: op.error || "" };
    }
  }
  return { status: "timeout" };
}

/**
 * Returns a `wait(opKey)` function bound to the component lifecycle: every
 * in-flight poll is aborted on unmount and resolves `{ status: "aborted" }`,
 * so callers can skip state updates and toasts.
 */
export function useBulkOperationWaiter(options?: WaitForBulkOperationOptions) {
  const controllersRef = useRef(new Set<AbortController>());
  const optionsRef = useRef(options);
  optionsRef.current = options;

  useEffect(() => {
    const controllers = controllersRef.current;
    return () => {
      controllers.forEach((c) => c.abort());
      controllers.clear();
    };
  }, []);

  return useCallback(async (opKey: string) => {
    const controller = new AbortController();
    controllersRef.current.add(controller);
    try {
      return await waitForBulkOperation(opKey, controller.signal, optionsRef.current);
    } finally {
      controllersRef.current.delete(controller);
    }
  }, []);
}
