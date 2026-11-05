/** Complete catalog format is a picture-search hint, never product identity. */
export const CATALOG_CODE_FORMAT_TIMEOUT_MS = 1000;

export function completeCatalogCodeFormat(query: string): string | null {
  const code = query.trim();
  // Current catalog formats are 7–20 characters; the installed reader accepts
  // complete ASCII shapes up to 64. Short unknown partials retain old behavior.
  if (!/^[A-Za-z0-9]{7,64}$/.test(code) || !/[A-Za-z]/.test(code) || !/[0-9]/.test(code)) return null;
  return code.replace(/[A-Za-z]/g, "A").replace(/[0-9]/g, "9");
}

export interface CatalogCodeFormatReply { data: unknown; error: unknown }
export type CatalogCodeFormatReader = (format: string, signal: AbortSignal) => PromiseLike<CatalogCodeFormatReply>;

/** Required hint reads fail loudly; an unavailable catalog is never false. */
export async function hasCatalogCodeFormat(query: string, read: CatalogCodeFormatReader, requestSignal: AbortSignal): Promise<boolean> {
  const format = completeCatalogCodeFormat(query);
  if (!format) return false;
  requestSignal.throwIfAborted();
  const controller = new AbortController();
  const abort = () => controller.abort(requestSignal.reason);
  requestSignal.addEventListener("abort", abort, { once: true });
  let stop!: () => void;
  const stopped = new Promise<never>((_resolve, reject) => {
    stop = () => reject(controller.signal.reason ?? new DOMException("Search cancelled", "AbortError"));
    controller.signal.addEventListener("abort", stop, { once: true });
  });
  const timer = setTimeout(() => controller.abort(new DOMException("Catalog format deadline exceeded", "TimeoutError")), CATALOG_CODE_FORMAT_TIMEOUT_MS);
  try {
    const reply = await Promise.race([read(format, controller.signal), stopped]);
    controller.signal.throwIfAborted();
    if (reply.error || typeof reply.data !== "boolean") throw new Error("Catalog format unavailable");
    return reply.data;
  } finally {
    clearTimeout(timer);
    requestSignal.removeEventListener("abort", abort);
    controller.signal.removeEventListener("abort", stop);
    controller.abort();
  }
}
