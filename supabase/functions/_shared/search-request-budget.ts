/** Same deadline as the existing browser search request; never reset per batch. */
export const SEARCH_REQUEST_TIMEOUT_MS = 30_000;

export function searchRequestBudget(requestSignal: AbortSignal) {
  const controller = new AbortController();
  const abort = () => controller.abort(requestSignal.reason);
  const timer = setTimeout(() => controller.abort(new DOMException("Search request deadline exceeded", "TimeoutError")), SEARCH_REQUEST_TIMEOUT_MS);
  if (requestSignal.aborted) abort();
  else requestSignal.addEventListener("abort", abort, { once: true });
  return {
    signal: controller.signal,
    close() {
      clearTimeout(timer);
      requestSignal.removeEventListener("abort", abort);
      controller.abort();
    },
  };
}

export async function withSearchRequestBudget<T>(request: Request, work: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const budget = searchRequestBudget(request.signal);
  try {
    return await work(budget.signal);
  } finally {
    budget.close();
  }
}
